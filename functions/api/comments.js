/**
 * 自建评论 API —— EdgeOne Pages 边缘函数（Edge Function）。
 *
 * 部署方式：EdgeOne Pages 会自动识别项目根目录下的 `functions/` 目录，
 * 文件名即路由：functions/api/comments.js  ->  /api/comments
 *
 * 依赖 KV：需要先在控制台创建 KV 命名空间，并绑定到本项目，
 * 绑定时填写的「变量名」要与此处使用的 `comments_kv` 保持一致。
 *
 * 接口约定：
 *   GET  /api/comments?slug=<slug>  -> { comments: Comment[] }
 *   POST /api/comments              -> { comment: Comment }
 *        body: { slug, author, email, content }
 *
 * 存储结构（KV）：
 *   key: `c:<slug>`  -> JSON 字符串，值为该文章下的评论数组
 */

const MAX_SLUG = 120;
const MAX_AUTHOR = 40;
const MAX_EMAIL = 120;
const MAX_CONTENT = 2000;
/** 单篇文章最多保留的评论数，防止 KV 值无限增长（KV 单值上限 25MB） */
const MAX_COMMENTS_PER_POST = 500;
/** 同一 IP 的提交间隔（毫秒），简单防刷 */
const RATE_LIMIT_MS = 15_000;

/**
 * KV 绑定名。若你在控制台绑定时用了别的变量名，改下面的 KV_BINDING。
 * 注意：边缘函数运行时会把绑定的 KV 命名空间作为全局变量注入。
 */
const KV_BINDING = 'comments_kv';

/** 取运行时注入的 KV；未绑定则返回 undefined */
function getKV() {
  try {
    // eslint-disable-next-line no-undef
    return typeof globalThis[KV_BINDING] !== 'undefined' ? globalThis[KV_BINDING] : undefined;
  } catch {
    return undefined;
  }
}

/** 评论对象结构（仅文档用途，实际为普通对象）：
 *  { id, slug, author, content, createdAt }
 */

/** 清理控制字符并截断长度（前端也会再转义一次，双重保险） */
function sanitize(input, maxLength) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, maxLength);
}

function json(body, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      ...extraHeaders,
    },
  });
}

function isValidSlug(slug) {
  // 允许字母、数字、-、_、/ 以及中日韩字符
  return slug.length > 0 && slug.length <= MAX_SLUG && /^[\w\-/\u4e00-\u9fa5]+$/.test(slug);
}

async function readComments(kv, slug) {
  const raw = await kv.get(`c:${slug}`, 'text');
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function onRequest(context) {
  const { request } = context;
  const kv = getKV();

  if (!kv) {
    return json(
      {
        error:
          'KV 未绑定：请在 EdgeOne Pages 控制台为本项目绑定 KV 命名空间，变量名设为 comments_kv。',
      },
      503
    );
  }

  const url = new URL(request.url);

  // ---------- 读取评论 ----------
  if (request.method === 'GET') {
    const slug = sanitize(url.searchParams.get('slug'), MAX_SLUG);
    if (!isValidSlug(slug)) {
      return json({ error: 'slug 参数缺失或非法' }, 400);
    }
    const comments = await readComments(kv, slug);
    return json({ comments });
  }

  // ---------- 发表评论 ----------
  if (request.method === 'POST') {
    // 简单同源校验，降低被外部站点滥用的风险
    const origin = request.headers.get('origin');
    if (origin) {
      try {
        if (new URL(origin).host !== url.host) {
          return json({ error: '不允许的请求来源' }, 403);
        }
      } catch {
        return json({ error: '非法来源' }, 403);
      }
    }

    // 蜜罐字段：正常用户看不到，填了即视为机器人
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }
    if (!payload || typeof payload !== 'object') {
      return json({ error: '请求体格式不正确' }, 400);
    }

    if (sanitize(payload.website, 50)) {
      return json({ error: '提交被拒绝' }, 400);
    }

    const slug = sanitize(payload.slug, MAX_SLUG);
    const author = sanitize(payload.author, MAX_AUTHOR);
    const content = sanitize(payload.content, MAX_CONTENT);
    // 邮箱仅用于将来接入 Gravatar / 通知，不落库、不返回
    const email = sanitize(payload.email, MAX_EMAIL);

    if (!isValidSlug(slug)) return json({ error: '文章标识非法' }, 400);
    if (!author) return json({ error: '请填写昵称' }, 400);
    if (!content) return json({ error: '请填写评论内容' }, 400);
    if (content.length > MAX_CONTENT) {
      return json({ error: `评论内容不能超过 ${MAX_CONTENT} 字` }, 400);
    }
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      return json({ error: '邮箱格式不正确' }, 400);
    }

    // 频率限制：以 IP 为维度，记录上次提交时间
    const ip =
      request.headers.get('eo-connecting-ip') ||
      request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
      'unknown';
    const rlKey = `rl:${ip}`;
    const last = await kv.get(rlKey, 'text');
    if (last) {
      const elapsed = Date.now() - Number(last);
      if (Number.isFinite(elapsed) && elapsed < RATE_LIMIT_MS) {
        const wait = Math.ceil((RATE_LIMIT_MS - elapsed) / 1000);
        return json({ error: `发得太快了，请 ${wait} 秒后再试` }, 429);
      }
    }

    const comments = await readComments(kv, slug);
    const comment = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      slug,
      author,
      content,
      createdAt: new Date().toISOString(),
    };

    // 新的排在前面
    const next = [comment, ...comments].slice(0, MAX_COMMENTS_PER_POST);

    await kv.put(`c:${slug}`, JSON.stringify(next));
    await kv.put(rlKey, String(Date.now()));

    return json({ comment }, 201);
  }

  return json({ error: 'Method Not Allowed' }, 405, { allow: 'GET, POST' });
}
