/**
 * 自建点赞 API —— EdgeOne Pages 边缘函数（Edge Function）。
 *
 * 部署方式：EdgeOne Pages 会自动识别项目根目录下的 `functions/` 目录，
 * 文件名即路由：functions/api/likes.js  ->  /api/likes
 *
 * 依赖 KV：
 *   优先使用绑定名为 `likes_kv` 的 KV 命名空间；
 *   如果没绑，会自动回退到评论用的 `comments_kv`（键前缀不同，互不干扰）。
 *   也就是说——**只要评论能跑，点赞就能跑，不需要额外配置**。
 *   想给点赞单独用一个命名空间：在控制台绑定为 likes_kv 即可。
 *
 * 接口约定：
 *   GET  /api/likes?slug=a&slug=b&visitor=<id>
 *        -> { likes: { a: { count, liked }, b: { count, liked } } }
 *        可一次问多个（最多 50 个），说说列表页一次拉全部，避免 N 个请求。
 *        带 visitor 时才会算 liked；不带则 liked 恒为 false。
 *
 *   POST /api/likes
 *        body: { slug, visitor, action: 'like' | 'unlike' }
 *        -> { slug, count, liked }
 *
 * 存储结构（KV）：
 *   like:<slug>                  -> 数字字符串，该内容的赞数
 *   like:<slug>:v:<visitor>      -> '1'，标记这个访客赞过（用来防重复）
 *
 * ⚠️ 关于计数精度：KV 没有原子自增，这里是「读 → 改 → 写」。
 *    极端并发下（同一瞬间多人点同一条）可能少记 1～2 个赞。
 *    个人博客的量级完全够用；要绝对精确得改成「一赞一键 + 前缀统计」，
 *    那样每次读取都要 list，更慢也更贵，不划算。
 */

const MAX_SLUG = 120;
/** 一次最多查多少个 slug（说说列表页 12 条，留足余量） */
const MAX_SLUGS_PER_QUERY = 50;
/** 访客标识长度上限 */
const MAX_VISITOR = 64;
/** 限流窗口长度（毫秒） */
const RATE_WINDOW_MS = 60_000;
/** 单个 IP 在一个窗口内允许的最大写入次数 */
const RATE_MAX_WRITES = 30;

/**
 * KV 绑定名，按顺序探测。
 * 想单独给点赞开一个命名空间：在控制台绑定为 likes_kv。
 */
const KV_BINDINGS = ['likes_kv', 'comments_kv'];

/** 取运行时注入的 KV；都没绑定则返回 undefined */
function getKV() {
  for (const name of KV_BINDINGS) {
    try {
      // eslint-disable-next-line no-undef
      const kv = globalThis[name];
      if (kv && typeof kv.get === 'function') return kv;
    } catch {
      /* 忽略 */
    }
  }
  return undefined;
}

/** 清理控制字符并截断长度 */
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

/** 允许字母、数字、-、_、/ 以及中日韩字符 */
function isValidSlug(slug) {
  return (
    slug.length > 0 &&
    slug.length <= MAX_SLUG &&
    /^[\w\-/\u4e00-\u9fa5]+$/.test(slug)
  );
}

/** 访客标识：前端生成的随机串，只允许 URL 安全字符 */
function isValidVisitor(visitor) {
  return visitor.length >= 8 && /^[A-Za-z0-9_-]+$/.test(visitor);
}

const countKey = (slug) => `like:${slug}`;
const visitorKey = (slug, visitor) => `like:${slug}:v:${visitor}`;

/** 读赞数；键不存在或值损坏都当 0 */
async function readCount(kv, slug) {
  const raw = await kv.get(countKey(slug), 'text');
  const n = Number.parseInt(raw ?? '', 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/**
 * 判断访客是否赞过。
 * 值写空字符串表示「已取消」，所以空值一律当没赞过——
 * 这样即使运行时没有 delete，取消赞也能正常工作。
 */
async function hasLiked(kv, slug, visitor) {
  if (!visitor) return false;
  const raw = await kv.get(visitorKey(slug, visitor), 'text');
  return Boolean(raw);
}

/** 清除访客标记；有 delete 就用，没有就写空串 */
async function clearVisitor(kv, slug, visitor) {
  const key = visitorKey(slug, visitor);
  if (typeof kv.delete === 'function') {
    await kv.delete(key);
    return;
  }
  await kv.put(key, '');
}

/** 取客户端 IP，用于限流 */
function clientIp(request) {
  return (
    request.headers.get('eo-connecting-ip') ||
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    'unknown'
  );
}

/**
 * 读某个 IP 在当前窗口内的写入次数。
 *
 * 为什么按「次数」而不是「最小间隔」：如果用最小间隔，用户点完赞马上取消
 * 就会被挡住——那是正常操作，不是刷。按次数则允许快速来回切，只挡住洪水。
 *
 * 存储格式：`<次数>:<窗口起点时间戳>`
 * 返回的 commit() 在真正发生写入后调用，累加计数。
 */
async function readWindow(kv, ip) {
  const key = `rl:like:${ip}`;
  const now = Date.now();
  let n = 0;
  let start = now;

  const raw = await kv.get(key, 'text');
  if (raw) {
    const [prevN, prevT] = raw.split(':');
    const t = Number.parseInt(prevT ?? '', 10);
    // 窗口过期就重新计数
    if (Number.isFinite(t) && now - t < RATE_WINDOW_MS) {
      const parsed = Number.parseInt(prevN ?? '', 10);
      n = Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
      start = t;
    }
  }

  return {
    blocked: n >= RATE_MAX_WRITES,
    commit: () => kv.put(key, `${n + 1}:${start}`),
  };
}

export async function onRequest(context) {
  const { request } = context;
  const kv = getKV();

  if (!kv) {
    return json(
      {
        error:
          'KV 未绑定：请在 EdgeOne Pages 控制台为本项目绑定 KV 命名空间，变量名设为 likes_kv（或复用评论的 comments_kv）。',
      },
      503
    );
  }

  const url = new URL(request.url);

  // ---------- 读取赞数（支持批量） ----------
  if (request.method === 'GET') {
    const slugs = url.searchParams
      .getAll('slug')
      .map((s) => sanitize(s, MAX_SLUG))
      .filter((s) => s.length > 0);

    if (slugs.length === 0) return json({ error: 'slug 参数缺失' }, 400);
    if (slugs.length > MAX_SLUGS_PER_QUERY) {
      return json({ error: `一次最多查询 ${MAX_SLUGS_PER_QUERY} 个 slug` }, 400);
    }
    const bad = slugs.find((s) => !isValidSlug(s));
    if (bad) return json({ error: `slug 非法：${bad}` }, 400);

    const visitor = sanitize(url.searchParams.get('visitor'), MAX_VISITOR);

    const entries = await Promise.all(
      slugs.map(async (slug) => {
        const [count, liked] = await Promise.all([
          readCount(kv, slug),
          hasLiked(kv, slug, visitor),
        ]);
        return [slug, { count, liked }];
      })
    );

    return json({ likes: Object.fromEntries(entries) });
  }

  // ---------- 点赞 / 取消 ----------
  if (request.method === 'POST') {
    // 同源校验：降低被外部站点滥用的风险
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

    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }
    if (!payload || typeof payload !== 'object') {
      return json({ error: '请求体格式不正确' }, 400);
    }

    const slug = sanitize(payload.slug, MAX_SLUG);
    const visitor = sanitize(payload.visitor, MAX_VISITOR);
    const action = payload.action === 'unlike' ? 'unlike' : 'like';

    if (!isValidSlug(slug)) return json({ error: '内容标识非法' }, 400);
    if (!isValidVisitor(visitor)) return json({ error: '访客标识非法' }, 400);

    const liked = await hasLiked(kv, slug, visitor);
    let count = await readCount(kv, slug);

    // 幂等：状态本来就是这个值，直接返回，既不写 KV 也不消耗限流额度
    const willChange = action === 'like' ? !liked : liked;
    if (!willChange) return json({ slug, count, liked });

    // 真正要改数据了，才计入限流
    const window = await readWindow(kv, clientIp(request));
    if (window.blocked) {
      return json({ error: '操作过于频繁，请稍后再试' }, 429);
    }

    if (action === 'like') {
      await kv.put(visitorKey(slug, visitor), '1');
      count += 1;
    } else {
      await clearVisitor(kv, slug, visitor);
      count = Math.max(0, count - 1);
    }
    await kv.put(countKey(slug), String(count));
    await window.commit();

    return json({ slug, count, liked: action === 'like' });
  }

  return json({ error: 'Method Not Allowed' }, 405, { allow: 'GET, POST' });
}
