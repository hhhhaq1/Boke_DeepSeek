// 点赞功能的端到端验证 + 截图。
//
// 边缘函数只在 EdgeOne 运行时存在，本地 astro dev 下 /api/likes 是 404，
// 所以这里自己起一个服务：静态资源来自 .edgeone/assets，
// /api/likes 则直接调用**真实的** functions/api/likes.js（配内存 KV）。
// 也就是说，截图里看到的行为就是线上行为，不是桩。
//
// 用法: node scripts/shoot-likes.mjs   （需先 npm run build）
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { onRequest } from '../functions/api/likes.js';

const PORT = 4398;
const ROOT = path.resolve('.edgeone/assets');
const OUT = path.resolve('.preview');
const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

fs.mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ *
 * 内存 KV + 预置赞数（截图里才有数字可看）
 * ------------------------------------------------------------------ */
const store = new Map();
globalThis.likes_kv = {
  async get(key, type) {
    const v = store.get(key);
    if (v === undefined) return null;
    return type === 'json' ? JSON.parse(v) : v;
  },
  async put(key, value) {
    store.set(key, value);
  },
  async delete(key) {
    store.delete(key);
  },
};

const SEED = {
  '2026-10-03-reading': 12,
  '2026-10-16-morning': 5,
  '2026-10-15-coffee': 3,
  '2026-10-12-mountain': 8,
  '2026-10-11-whisky': 2,
  '2026-10-05-trip': 21,
  '2026-10-08-rain': 1,
  'hello-world': 7,
  'astro-blog-guide': 34,
};
for (const [slug, n] of Object.entries(SEED)) store.set(`like:${slug}`, String(n));

/* ------------------------------------------------------------------ *
 * 静态资源 + /api/likes
 * ------------------------------------------------------------------ */
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

/** 把 Node 的 IncomingMessage 转成 Web Request，交给真实的边缘函数 */
async function toRequest(nodeReq) {
  const headers = {};
  for (const [k, v] of Object.entries(nodeReq.headers)) {
    if (typeof v === 'string') headers[k] = v;
  }
  const chunks = [];
  for await (const chunk of nodeReq) chunks.push(chunk);
  const method = nodeReq.method ?? 'GET';
  return new Request(`http://127.0.0.1:${PORT}${nodeReq.url}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : Buffer.concat(chunks),
  });
}

const server = http.createServer(async (req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  if (pathname === '/api/likes') {
    const response = await onRequest({ request: await toRequest(req) });
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(Buffer.from(await response.arrayBuffer()));
    return;
  }

  const candidates = [
    path.join(ROOT, pathname),
    path.join(ROOT, pathname, 'index.html'),
    path.join(ROOT, `${pathname}.html`),
  ];
  for (const candidate of candidates) {
    if (!candidate.startsWith(ROOT)) break;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      res.writeHead(200, {
        'content-type': MIME[path.extname(candidate).toLowerCase()] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(candidate).pipe(res);
      return;
    }
  }
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' }).end('404');
});

await new Promise((r) => server.listen(PORT, '127.0.0.1', r));
console.log(`服务已启动: http://127.0.0.1:${PORT}/`);

const BASE = `http://127.0.0.1:${PORT}`;

/* ------------------------------------------------------------------ *
 * CDP
 * ------------------------------------------------------------------ */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const CDP_PORT = 9224;
const profile = path.join(process.env.TEMP ?? '.', 'shot-likes-' + Date.now());

const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${CDP_PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,1400',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

async function cdpUrl() {
  for (let i = 0; i < 45; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${CDP_PORT}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪');
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    };
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const cdp = new CDP(await cdpUrl());
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

async function evaluate(expression) {
  const { result } = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  return result.value;
}

async function goto(url, theme) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height: 1400, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(1500);
  await evaluate(`(() => {
    localStorage.setItem('theme', '${theme}');
    document.documentElement.setAttribute('data-theme', '${theme}');
  })()`);
  await sleep(400);
  const applied = await evaluate('document.documentElement.getAttribute("data-theme")');
  if (applied !== theme) throw new Error(`主题未生效：期望 ${theme}，实际 ${applied}`);
}

async function shoot(name) {
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`  ✓ ${name}.png  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

const checks = [];
const check = (name, ok, extra = '') => checks.push({ name, ok, extra });

/** 读某个点赞控件当前状态 */
const readLike = (sel) => evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  if (!el) return null;
  return JSON.stringify({
    slug: el.dataset.slug,
    count: Number(el.querySelector('[data-like-count]').textContent),
    liked: el.classList.contains('is-liked'),
    pressed: el.querySelector('[data-like-btn]').getAttribute('aria-pressed'),
    visible: !el.hidden,
  });
})()`).then((s) => (s ? JSON.parse(s) : null));

/* ------------------------------------------------------------------ *
 * 1. 说说页
 * ------------------------------------------------------------------ */
console.log('\n[1] 说说页');
await goto(`${BASE}/notes/`, 'glass');

const total = await evaluate(`document.querySelectorAll('[data-like]').length`);
const shown = await evaluate(`document.querySelectorAll('[data-like]:not([hidden])').length`);
check(`12 个点赞控件全部显示（${shown}/${total}）`, shown === 12 && total === 12);

const pinnedSel = '[data-slug="2026-10-03-reading"]';
const pinned = await readLike(pinnedSel);
check('预置赞数正确渲染（12）', pinned?.count === 12, `实际 ${pinned?.count}`);
check('初始未点赞', pinned?.liked === false && pinned?.pressed === 'false');

// 滚到卡片再截图（卡片有滚动淡入）
await evaluate(`document.querySelector(${JSON.stringify(pinnedSel)}).closest('.note').scrollIntoView({block:'center'})`);
await sleep(900);
await shoot('likes-notes-idle-light');

// 点一下
await evaluate(`document.querySelector(${JSON.stringify(pinnedSel)}).querySelector('[data-like-btn]').click()`);
await sleep(800);
const afterLike = await readLike(pinnedSel);
check('点赞后计数 +1', afterLike?.count === 13, `实际 ${afterLike?.count}`);
check('点赞后进入已赞态', afterLike?.liked === true && afterLike?.pressed === 'true');
await shoot('likes-notes-liked-light');

// 再点一下取消
await evaluate(`document.querySelector(${JSON.stringify(pinnedSel)}).querySelector('[data-like-btn]').click()`);
await sleep(800);
const afterUnlike = await readLike(pinnedSel);
check('再点一次取消，计数回到 12', afterUnlike?.count === 12, `实际 ${afterUnlike?.count}`);
check('取消后回到未赞态', afterUnlike?.liked === false && afterUnlike?.pressed === 'false');

// 服务端也确认一下（防止只是本地乐观更新）
const serverCount = await fetch(`${BASE}/api/likes?slug=2026-10-03-reading`).then((r) => r.json());
check('服务端计数与界面一致', serverCount.likes['2026-10-03-reading'].count === 12,
  `实际 ${serverCount.likes['2026-10-03-reading'].count}`);

// 夜间
await goto(`${BASE}/notes/`, 'neon');
await evaluate(`document.querySelector(${JSON.stringify(pinnedSel)}).closest('.note').scrollIntoView({block:'center'})`);
await sleep(900);
await shoot('likes-notes-idle-dark');

/* ------------------------------------------------------------------ *
 * 2. 文章页
 * ------------------------------------------------------------------ */
console.log('\n[2] 文章页');
await goto(`${BASE}/blog/hello-world/`, 'glass');

const postSel = '.post-like [data-like]';
const post = await readLike(postSel);
check('文章页点赞控件显示', post?.visible === true);
check('文章页预置赞数正确（7）', post?.count === 7, `实际 ${post?.count}`);

await evaluate(`document.querySelector('.post-like').scrollIntoView({block:'center'})`);
await sleep(900);
await shoot('likes-post-idle-light');

await evaluate(`document.querySelector(${JSON.stringify(postSel)}).querySelector('[data-like-btn]').click()`);
await sleep(800);
const postLiked = await readLike(postSel);
check('文章点赞后计数 +1', postLiked?.count === 8, `实际 ${postLiked?.count}`);
await shoot('likes-post-liked-light');

await goto(`${BASE}/blog/hello-world/`, 'neon');
await evaluate(`document.querySelector('.post-like').scrollIntoView({block:'center'})`);
await sleep(900);
await shoot('likes-post-idle-dark');

/* ------------------------------------------------------------------ *
 * 3. API 不可用时的降级（本地 dev 就是这个场景）
 * ------------------------------------------------------------------ */
console.log('\n[3] API 不可用时的降级');
await cdp.send('Network.enable', {}, sessionId);
await cdp.send('Network.setBlockedURLs', { urls: ['*/api/likes*'] }, sessionId);
await cdp.send('Page.reload', {}, sessionId);
await sleep(1800);
const hiddenWhenOffline = await evaluate(
  `document.querySelectorAll('[data-like]:not([hidden])').length`
);
check('拉不到赞数时点赞按钮保持隐藏', hiddenWhenOffline === 0, `实际显示了 ${hiddenWhenOffline} 个`);
await cdp.send('Network.setBlockedURLs', { urls: [] }, sessionId);

/* ------------------------------------------------------------------ *
 * 汇总
 * ------------------------------------------------------------------ */
chrome.kill();
server.close();
try {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
} catch {
  /* 忽略 */
}

console.log('');
let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.extra ? '' : '  [' + c.extra + ']'}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
