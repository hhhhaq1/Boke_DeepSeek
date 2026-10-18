#!/usr/bin/env node
/**
 * 本地写作台（Studio）
 * ------------------------------------------------------------------
 * 解决三件事：手写 frontmatter、手动搬图片、手动 git 提交。
 *
 *   pnpm studio   →  http://127.0.0.1:4322
 *
 * 设计原则：
 *   · 零依赖：只用 Node 内置模块。图片压缩在浏览器端用 Canvas 做，
 *     所以不需要 sharp / imagemagick，也不需要 pnpm install 之外的东西。
 *   · 只写文件、不改代码：产出物就是 src/content/{notes,blog}/*.md
 *     和 public/images/**，和手写完全等价，随时可以不用它。
 *   · 只监听 127.0.0.1，不对外暴露。
 */
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const UI_DIR = path.join(HERE, 'studio');
const PORT = Number(process.env.STUDIO_PORT || 4322);
const HOST = '127.0.0.1';
const MAX_UPLOAD = 30 * 1024 * 1024;

const DIRS = {
  note: {
    content: path.join(ROOT, 'src/content/notes'),
    images: path.join(ROOT, 'public/images/notes'),
    label: '说说',
  },
  post: {
    content: path.join(ROOT, 'src/content/blog'),
    images: path.join(ROOT, 'public/images/blog'),
    label: '文章',
  },
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

const pad = (n) => String(n).padStart(2, '0');
const dateKey = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const timeKey = (d = new Date()) => `${pad(d.getHours())}${pad(d.getMinutes())}`;
const stampKey = (d = new Date()) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;

async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch {
    return false;
  }
}

function unquote(v) {
  const s = v.trim();
  if (s.length >= 2 && s[0] === "'" && s[s.length - 1] === "'") return s.slice(1, -1).replace(/''/g, "'");
  if (s.length >= 2 && s[0] === '"' && s[s.length - 1] === '"') return s.slice(1, -1).replace(/\\"/g, '"');
  return s;
}

/** YAML 单引号风格：内部单引号写成两个 */
const q = (s) => `'${String(s).replace(/'/g, "''")}'`;

/** 只在必要时加引号，保持 md 干净可读 */
function scalar(s) {
  const str = String(s);
  if (str === '') return "''";
  if (/[:#\[\]{}&*!|>'"%@`]/.test(str) || /^\s|\s$/.test(str) || /^[-?]/.test(str)) return q(str);
  return str;
}

const inlineArray = (arr) => `[${(arr || []).filter(Boolean).map(q).join(', ')}]`;

function splitInlineArray(raw) {
  const inner = raw.slice(1, -1).trim();
  if (!inner) return [];
  const out = [];
  let buf = '';
  let quote = null;
  for (const ch of inner) {
    if (quote) {
      if (ch === quote) quote = null;
      else buf += ch;
    } else if (ch === "'" || ch === '"') {
      quote = ch;
    } else if (ch === ',') {
      out.push(unquote(buf));
      buf = '';
    } else {
      buf += ch;
    }
  }
  if (buf.trim()) out.push(unquote(buf));
  return out.map((s) => s.trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ */
/* frontmatter 读写                                                    */
/* ------------------------------------------------------------------ */

const ARRAY_KEYS = new Set(['tags', 'images']);

function parseFrontmatter(raw) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?/.exec(raw);
  if (!m) return { data: {}, body: raw };

  const data = {};
  let key = null;

  for (const line of m[1].split(/\r?\n/)) {
    if (!line.trim() || /^\s*#/.test(line)) continue;

    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      if (!Array.isArray(data[key])) data[key] = [];
      data[key].push(unquote(item[1]));
      continue;
    }

    const kv = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) continue;

    key = kv[1];
    const val = kv[2].trim();

    if (val === '') {
      data[key] = [];           // 后面可能跟块状列表
    } else if (val.startsWith('[') && val.endsWith(']')) {
      data[key] = splitInlineArray(val);
    } else if (val === 'true' || val === 'false') {
      data[key] = val === 'true';
    } else {
      data[key] = unquote(val);
    }
  }

  // 标量字段被解析成空数组时还原为空字符串
  for (const [k, v] of Object.entries(data)) {
    if (Array.isArray(v) && v.length === 0 && !ARRAY_KEYS.has(k)) data[k] = '';
  }

  return { data, body: raw.slice(m[0].length) };
}

function buildNoteMd(d, body) {
  const L = ['---'];
  L.push(`pubDate: ${q(d.pubDate)}`);
  if (d.category) L.push(`category: ${scalar(d.category)}`);
  if (d.author) L.push(`author: ${scalar(d.author)}`);
  if (d.avatar) L.push(`avatar: ${scalar(d.avatar)}`);
  if (d.location) L.push(`location: ${scalar(d.location)}`);
  if (d.mood) L.push(`mood: ${scalar(d.mood)}`);
  L.push(`tags: ${inlineArray(d.tags)}`);
  const images = (d.images || []).filter(Boolean);
  if (images.length) {
    L.push('images:');
    for (const img of images) L.push(`  - ${img}`);
  }
  if (d.pinned) L.push('pinned: true');
  L.push(`draft: ${d.draft ? 'true' : 'false'}`);
  L.push('---');
  return `${L.join('\n')}\n\n${String(body || '').trim()}\n`;
}

function buildPostMd(d, body) {
  const L = ['---'];
  L.push(`title: ${scalar(d.title || '无标题')}`);
  L.push(`description: ${scalar(d.description || '')}`);
  L.push(`pubDate: ${d.pubDate.slice(0, 10)}`);
  if (d.updatedDate) L.push(`updatedDate: ${String(d.updatedDate).slice(0, 10)}`);
  if (d.author) L.push(`author: ${scalar(d.author)}`);
  L.push(`tags: ${inlineArray(d.tags)}`);
  if (d.cover) L.push(`cover: ${d.cover}`);
  if (d.draft) L.push('draft: true');
  L.push(`comments: ${d.comments === false ? 'false' : 'true'}`);
  L.push('---');
  return `${L.join('\n')}\n\n${String(body || '').trim()}\n`;
}

/* ------------------------------------------------------------------ */
/* 内容读取                                                            */
/* ------------------------------------------------------------------ */

async function readCategories() {
  try {
    const src = await fs.readFile(path.join(ROOT, 'src/config.ts'), 'utf8');
    const block = /NOTE_CATEGORIES[^=]*=\s*\[([\s\S]*?)\];/.exec(src);
    if (!block) return [];
    return [...block[1].matchAll(/name:\s*'([^']+)'/g)].map((m) => m[1]);
  } catch {
    return [];
  }
}

/** 从 src/config.ts 的 SITE 对象里读默认作者，让写作台的默认值跟站点一致 */
async function readDefaultAuthor() {
  try {
    const src = await fs.readFile(path.join(ROOT, 'src/config.ts'), 'utf8');
    const site = /export const SITE = \{([\s\S]*?)\n\};/.exec(src);
    const m = /^\s*author:\s*'([^']*)'/m.exec(site ? site[1] : src);
    return m ? m[1] : '站长';
  } catch {
    return '站长';
  }
}

async function listType(type) {
  const dir = DIRS[type].content;
  let files = [];
  try {
    files = await fs.readdir(dir);
  } catch {
    return [];
  }

  const items = [];
  for (const f of files) {
    if (!/\.mdx?$/.test(f)) continue;
    let data = {};
    try {
      ({ data } = parseFrontmatter(await fs.readFile(path.join(dir, f), 'utf8')));
    } catch {
      /* 读不了的跳过 */
    }
    const pub = String(data.pubDate || '');
    items.push({
      type,
      filename: f,
      id: f.replace(/\.mdx?$/, ''),
      title: type === 'post' ? data.title || f : data.category || '说说',
      summary: type === 'post' ? data.description || '' : '',
      category: data.category || '',
      imageCount: Array.isArray(data.images) ? data.images.length : 0,
      pubDate: pub.slice(0, 16),
      draft: data.draft === true,
    });
  }

  return items.sort((a, b) => (b.pubDate || '').localeCompare(a.pubDate || ''));
}

/* ------------------------------------------------------------------ */
/* git                                                                 */
/* ------------------------------------------------------------------ */

function run(cmd, args, timeout = 180000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      resolve({ ok: !err, code: err?.code ?? 0, stdout: stdout || '', stderr: stderr || '', error: err?.message || '' });
    });
  });
}

async function gitSummary() {
  const branch = await run('git', ['rev-parse', '--abbrev-ref', 'HEAD'], 10000);
  const status = await run('git', ['status', '--porcelain'], 10000);
  const ahead = await run('git', ['rev-list', '--count', '@{u}..HEAD'], 10000);
  const lines = status.stdout.split(/\r?\n/).filter(Boolean);
  return {
    branch: branch.ok ? branch.stdout.trim() : '—',
    dirty: lines.length,
    ahead: ahead.ok ? Number(ahead.stdout.trim()) || 0 : 0,
    files: lines.slice(0, 8),
  };
}

/* ------------------------------------------------------------------ */
/* HTTP                                                                */
/* ------------------------------------------------------------------ */

function json(res, code, payload) {
  const buf = Buffer.from(JSON.stringify(payload), 'utf8');
  res.writeHead(code, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': buf.length,
    'cache-control': 'no-store',
  });
  res.end(buf);
}

function readBody(req, limit = 4 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`内容超过 ${Math.round(limit / 1024 / 1024)}MB 上限`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJson(req) {
  const buf = await readBody(req);
  if (!buf.length) return {};
  return JSON.parse(buf.toString('utf8'));
}

const PUBLIC_DIR = path.join(ROOT, 'public');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
};

async function serveStatic(res, pathname) {
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  const candidates = [path.join(UI_DIR, rel), path.join(PUBLIC_DIR, rel)];
  for (const file of candidates) {
    const norm = path.normalize(file);
    const allowed = norm.startsWith(UI_DIR) || norm.startsWith(PUBLIC_DIR);
    if (!allowed) continue;
    try {
      const buf = await fs.readFile(file);
      res.writeHead(200, {
        'content-type': MIME[path.extname(file)] || 'application/octet-stream',
        'content-length': buf.length,
        'cache-control': 'no-store',
      });
      res.end(buf);
      return;
    } catch {
      /* 试下一个 */
    }
  }
  res.writeHead(404).end('not found');
}

function sanitizeSlug(input) {
  return String(input || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

function asciiSlug(input) {
  const s = String(input || '')
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
  return s;
}

async function handleUpload(req, url) {
  const type = url.searchParams.get('type') === 'post' ? 'post' : 'note';
  const slug = sanitizeSlug(url.searchParams.get('slug') || 'img') || 'img';
  const ext = (url.searchParams.get('ext') || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
  const buf = await readBody(req, MAX_UPLOAD);
  if (!buf.length) throw new Error('空文件');

  const dir = type === 'post' ? path.join(DIRS.post.images, slug) : DIRS.note.images;
  await fs.mkdir(dir, { recursive: true });

  const stamp = stampKey();
  let n = 1;
  let name;
  do {
    name = `${stamp}-${slug}-${pad(n)}.${ext}`;
    n += 1;
  } while (await exists(path.join(dir, name)));

  await fs.writeFile(path.join(dir, name), buf);

  const rel = '/' + path.relative(path.join(ROOT, 'public'), path.join(dir, name)).split(path.sep).join('/');
  return { url: rel, bytes: buf.length };
}

async function handleAvatar(req, url) {
  const ext = (url.searchParams.get('ext') || 'webp').toLowerCase().replace(/[^a-z0-9]/g, '') || 'webp';
  const buf = await readBody(req, MAX_UPLOAD);
  if (!buf.length) throw new Error('空文件');

  const dir = path.join(ROOT, 'public/images/avatar');
  await fs.mkdir(dir, { recursive: true });

  const name = `avatar-${Date.now()}.${ext}`;
  await fs.writeFile(path.join(dir, name), buf);

  return { url: `/images/avatar/${name}`, bytes: buf.length };
}

/** 这张图是否还被别的 md 引用（删除说说时避免误删共用图） */
async function isReferencedElsewhere(imgPath, exceptFile) {
  for (const type of ['note', 'post']) {
    const dir = DIRS[type].content;
    let files = [];
    try {
      files = await fs.readdir(dir);
    } catch {
      continue;
    }
    for (const f of files) {
      if (!/\.mdx?$/.test(f) || f === exceptFile) continue;
      try {
        if ((await fs.readFile(path.join(dir, f), 'utf8')).includes(imgPath)) return true;
      } catch {
        /* 跳过 */
      }
    }
  }
  return false;
}

async function handleDelete(payload) {
  const type = payload.type === 'post' ? 'post' : 'note';
  const filename = path.basename(String(payload.filename || ''));
  const dir = DIRS[type].content;
  const file = path.join(dir, filename);

  if (!filename || !/\.mdx?$/.test(filename) || !file.startsWith(dir)) throw new Error('文件名不合法');
  if (!(await exists(file))) throw new Error('文件不存在');

  const { data } = parseFrontmatter(await fs.readFile(file, 'utf8'));

  const now = new Date();
  const stamp = `${stampKey(now)}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;
  const trashDir = path.join(ROOT, '.trash', stamp);
  await fs.mkdir(trashDir, { recursive: true });
  await fs.rename(file, path.join(trashDir, filename));

  // 配图一起移入回收站，但仍被其他内容引用的图保留
  const moved = [];
  for (const img of Array.isArray(data.images) ? data.images : []) {
    if (typeof img !== 'string' || !img.startsWith('/images/')) continue;
    if (await isReferencedElsewhere(img, filename)) continue;
    const src = path.join(ROOT, 'public', img.slice(1));
    if (!(await exists(src))) continue;
    const dest = path.join(trashDir, 'images', path.basename(src));
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.rename(src, dest);
    moved.push(img);
  }

  return {
    ok: true,
    trashed: path.relative(ROOT, trashDir).split(path.sep).join('/'),
    images: moved,
  };
}

async function handleSave(payload) {
  const type = payload.type === 'post' ? 'post' : 'note';
  const d = payload.data || {};
  const body = payload.body || '';
  const dir = DIRS[type].content;
  await fs.mkdir(dir, { recursive: true });

  const editing = Boolean(payload.filename);
  let filename = payload.filename;

  if (!filename) {
    if (type === 'note') {
      const stamp = (d.pubDate || '').slice(0, 10) || dateKey();
      const clock = (d.pubDate || '').slice(11, 16).replace(':', '') || timeKey();
      const tail = sanitizeSlug(d.slug) || clock;
      filename = `${stamp}-${tail}.md`;
    } else {
      filename = `${asciiSlug(d.slug) || `post-${stampKey()}`}.md`;
    }

    // 不覆盖已有文件
    const base = filename.replace(/\.md$/, '');
    let i = 2;
    while (await exists(path.join(dir, filename))) {
      filename = `${base}-${i}.md`;
      i += 1;
    }
  }

  if (!/\.mdx?$/.test(filename)) filename += '.md';

  const md = type === 'note' ? buildNoteMd(d, body) : buildPostMd(d, body);
  await fs.writeFile(path.join(dir, filename), md, 'utf8');

  return {
    filename,
    id: filename.replace(/\.mdx?$/, ''),
    path: path.relative(ROOT, path.join(dir, filename)).split(path.sep).join('/'),
    created: !editing,
  };
}

async function handlePublish(payload) {
  const message = (payload.message || '').trim() || `content: 更新内容 ${new Date().toLocaleString('zh-CN')}`;
  const log = [];

  const add = await run('git', ['add', '-A']);
  log.push(add.stdout + add.stderr);
  if (!add.ok) return { ok: false, step: 'git add', output: log.join('\n') };

  const staged = await run('git', ['diff', '--cached', '--quiet']);
  if (staged.ok) {
    return { ok: true, step: 'noop', output: '没有需要提交的改动。' };
  }

  const commit = await run('git', ['commit', '-m', message]);
  log.push(commit.stdout + commit.stderr);
  if (!commit.ok) return { ok: false, step: 'git commit', output: log.join('\n') };

  const push = await run('git', ['push'], 240000);
  log.push(push.stdout + push.stderr);
  if (!push.ok) return { ok: false, step: 'git push', output: log.join('\n') };

  return { ok: true, step: 'done', output: log.join('\n').trim() };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${HOST}:${PORT}`);
  const p = url.pathname;

  try {
    if (req.method === 'GET' && p === '/api/list') {
      const [notes, posts, categories, defaultAuthor, git] = await Promise.all([
        listType('note'),
        listType('post'),
        readCategories(),
        readDefaultAuthor(),
        gitSummary(),
      ]);
      return json(res, 200, { notes, posts, categories, defaultAuthor, git });
    }

    if (req.method === 'GET' && p === '/api/item') {
      const type = url.searchParams.get('type') === 'post' ? 'post' : 'note';
      const filename = path.basename(url.searchParams.get('filename') || '');
      const file = path.join(DIRS[type].content, filename);
      if (!filename || !file.startsWith(DIRS[type].content)) return json(res, 400, { error: '文件名不合法' });
      const raw = await fs.readFile(file, 'utf8');
      const { data, body } = parseFrontmatter(raw);
      return json(res, 200, { filename, data, body });
    }

    if (req.method === 'POST' && p === '/api/upload') {
      return json(res, 200, await handleUpload(req, url));
    }

    if (req.method === 'POST' && p === '/api/avatar') {
      return json(res, 200, await handleAvatar(req, url));
    }

    if (req.method === 'POST' && p === '/api/delete') {
      return json(res, 200, await handleDelete(await readJson(req)));
    }

    if (req.method === 'POST' && p === '/api/save') {
      return json(res, 200, await handleSave(await readJson(req)));
    }

    if (req.method === 'POST' && p === '/api/publish') {
      return json(res, 200, await handlePublish(await readJson(req)));
    }

    if (req.method === 'GET' && p === '/api/git') {
      return json(res, 200, await gitSummary());
    }

    if (req.method === 'GET') return serveStatic(res, p);

    return json(res, 405, { error: '不支持的方法' });
  } catch (err) {
    return json(res, 500, { error: err?.message || String(err) });
  }
});

server.listen(PORT, HOST, () => {
  console.log(`\n  写作台已启动  →  http://${HOST}:${PORT}\n`);
  console.log(`  仓库目录      ${ROOT}`);
  console.log(`  说说          src/content/notes/`);
  console.log(`  文章          src/content/blog/`);
  console.log(`  图片          public/images/notes/  ·  public/images/blog/\n`);
  console.log('  写完点「保存并发布」，会自动 git commit + push。Ctrl+C 退出。\n');
});
