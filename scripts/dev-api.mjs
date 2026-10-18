/**
 * 开发期的 /api 模拟实现（只在本机 `astro dev` 生效）
 * ------------------------------------------------------------------
 * 为什么需要它：
 *   `functions/api/*.js` 是 EdgeOne 的边缘函数，只在 EdgeOne 运行时存在。
 *   本地 `astro dev` 里 /api/likes 会 404，于是点赞按钮一直隐藏、
 *   评论区显示「加载失败」——看起来像功能没做，其实只是后端不在。
 *
 * 实现方式：一个 Vite 插件，在 Astro 路由之前接管 /api/*。
 *   不用 src/middleware.ts，因为 Astro 的 404 兜底会把未匹配路由的
 *   URL 重建（丢掉查询串），中间件里拿不到 ?slug=。
 *
 * 行为与边缘函数对齐：
 *   GET  /api/likes?slug=a&slug=b&visitor=<id>
 *   POST /api/likes    { slug, visitor, action: 'like' | 'unlike' }
 *   GET  /api/comments?slug=<slug>
 *   POST /api/comments { slug, author, email, content }
 *
 * 数据存 .local/dev-api.json（已 gitignore），重启 dev 也还在。
 * 生产构建不会包含本文件。
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const STORE_FILE = path.resolve('.local/dev-api.json');

let cache = null;

async function load() {
  if (cache) return cache;
  try {
    const parsed = JSON.parse(await fs.readFile(STORE_FILE, 'utf8'));
    cache = {
      likes: parsed.likes ?? {},
      liked: parsed.liked ?? {},
      comments: parsed.comments ?? {},
    };
  } catch {
    cache = { likes: {}, liked: {}, comments: {} };
  }
  return cache;
}

async function persist() {
  const snapshot = JSON.stringify(cache, null, 2);
  await fs.mkdir(path.dirname(STORE_FILE), { recursive: true });
  await fs.writeFile(STORE_FILE, snapshot, 'utf8');
}

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  });

const clamp = (s, max) => String(s ?? '').trim().slice(0, max);

async function readJsonBody(request) {
  try {
    return await request.json();
  } catch {
    return {};
  }
}

async function handleLikes(request, url) {
  const store = await load();

  if (request.method === 'GET') {
    const slugs = url.searchParams.getAll('slug').slice(0, 50);
    const visitor = clamp(url.searchParams.get('visitor'), 64);
    const likes = {};
    for (const slug of slugs) {
      likes[slug] = {
        count: store.likes[slug] ?? 0,
        liked: visitor ? Boolean(store.liked[`${slug}:${visitor}`]) : false,
      };
    }
    return json({ likes });
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    const slug = clamp(body.slug, 120);
    const visitor = clamp(body.visitor, 64);
    const action = body.action === 'unlike' ? 'unlike' : 'like';
    if (!slug) return json({ error: '缺少 slug' }, 400);

    const key = `${slug}:${visitor}`;
    if (action === 'like') {
      if (!store.liked[key]) {
        store.liked[key] = true;
        store.likes[slug] = (store.likes[slug] ?? 0) + 1;
      }
    } else if (store.liked[key]) {
      delete store.liked[key];
      store.likes[slug] = Math.max(0, (store.likes[slug] ?? 1) - 1);
    }

    await persist();
    return json({ slug, count: store.likes[slug] ?? 0, liked: action === 'like' });
  }

  return json({ error: '不支持的方法' }, 405);
}

async function handleComments(request, url) {
  const store = await load();

  if (request.method === 'GET') {
    const slug = clamp(url.searchParams.get('slug'), 120);
    if (!slug) return json({ error: '缺少 slug' }, 400);
    return json({ comments: store.comments[slug] ?? [] });
  }

  if (request.method === 'POST') {
    const body = await readJsonBody(request);
    const slug = clamp(body.slug, 120);
    const author = clamp(body.author, 40);
    const content = clamp(body.content, 2000);
    if (!slug) return json({ error: '缺少 slug' }, 400);
    if (!author || !content) return json({ error: '昵称和内容不能为空' }, 400);

    const comment = {
      id: `c_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      slug,
      author,
      content,
      createdAt: new Date().toISOString(),
    };

    const list = store.comments[slug] ?? [];
    list.unshift(comment);
    store.comments[slug] = list.slice(0, 500);

    await persist();
    return json({ comment });
  }

  return json({ error: '不支持的方法' }, 405);
}

/** 返回 Response 表示已接管；返回 null 表示交给后续中间件 */
export async function handleDevApi(request, url) {
  if (url.pathname === '/api/likes') return handleLikes(request, url);
  if (url.pathname === '/api/comments') return handleComments(request, url);
  return null;
}

/** Vite 插件：仅 dev 生效，在 Astro 路由之前接管 /api/* */
export function devApiMock() {
  return {
    name: 'dev-api-mock',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        if (!url.pathname.startsWith('/api/')) return next();

        (async () => {
          const chunks = [];
          for await (const chunk of req) chunks.push(chunk);

          const hasBody = req.method !== 'GET' && req.method !== 'HEAD';
          const request = new Request(url, {
            method: req.method,
            headers: req.headers,
            body: hasBody ? Buffer.concat(chunks) : undefined,
          });

          const response = await handleDevApi(request, url);
          if (!response) return next();

          res.statusCode = response.status;
          response.headers.forEach((value, key) => res.setHeader(key, value));
          res.end(Buffer.from(await response.arrayBuffer()));
        })().catch(next);
      });
    },
  };
}
