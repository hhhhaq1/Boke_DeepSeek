/**
 * 自建评论 API —— EdgeOne Pages 边缘函数（Edge Function）。
 *
 * 部署方式：EdgeOne Pages 会自动识别项目根目录下的 `functions/` 目录，
 * 文件名即路由：functions/api/comments.js  ->  /api/comments
 *
 * 依赖 KV：需要先在控制台创建 KV 命名空间，并绑定到本项目，
 * 绑定时填写的「变量名」要与此处使用的 `comments_kv` 保持一致。
 * （点赞接口复用同一命名空间，或单独绑定 `likes_kv`，见 functions/api/likes.js）
 *
 * 接口约定：
 *   GET  /api/comments?slug=<slug>  -> { comments: Comment[] }
 *   POST /api/comments              -> { comment: Comment }
 *        body: { slug, author, email, content }
 *
 * 存储结构（KV）：
 *   key: `c:<slug>`   -> JSON 字符串，该文章下的评论数组
 *   key: `rl:<ip>`    -> 上次提交时间戳（频率限制）
 *
 * ------------------------------------------------------------------
 * 安全设计（按「能挡住什么」分层说明，详见 README「评论安全」）
 *
 *   1. 刷评论   同源校验 + 蜜罐字段 + IP 频率限制 + 重复内容检测
 *   2. 注入类   内容按纯文本存储与返回，前端渲染时再次转义（双重保险）
 *   3. 垃圾广告  链接数量与短链密度限制 + 敏感词过滤
 *   4. 人工审核  可选的 REVIEW_MODE：开启后评论先入待审状态，不公开显示
 * ------------------------------------------------------------------
 */

const MAX_SLUG = 120;
const MAX_AUTHOR = 40;
const MAX_EMAIL = 120;
const MAX_CONTENT = 2000;
/** 单篇文章最多保留的评论数，防止 KV 值无限增长（KV 单值上限 25MB） */
const MAX_COMMENTS_PER_POST = 500;
/** 同一 IP 的提交间隔（毫秒），简单防刷 */
const RATE_LIMIT_MS = 15_000;
/** 单条评论允许的最大链接数，超过判为广告 */
const MAX_LINKS = 2;
/** 纯链接/短链占比超过此值判为垃圾评论 */
const MAX_LINK_RATIO = 0.5;

/**
 * 审核模式。
 * - false：评论即时公开（默认）
 * - true ：评论存入 KV 但标记 status='pending'，前端不展示，
 *          你可在 KV 控制台看到并手动改为 approved 后才会显示。
 */
const REVIEW_MODE = false;

/**
 * 敏感词表。
 * 说明：这是一份**基础**列表，目的是挡住最常见的恶意与广告内容。
 * 它不可能完备——变体、拼音、拆字都能绕过。若你被有针对性的人盯上，
 * 请改为开启 REVIEW_MODE 人工审核，那才是可靠手段。
 */
const BLOCKED_WORDS = [
  // 违法与低俗
  '法轮', '冰毒', '麻古', 'k粉', '摇头丸', '迷药', '迷奸',
  '代孕', '卖淫', '嫖娼', '裸聊', '裸照', '色情', '情色', '黄片', 'a片',
  '赌博', '博彩', '六合彩', '时时彩', '百家乐', '赌球', '网赌',
  '高利贷', '套路贷', '洗钱', '传销', '走私', '假币',
  // 常见垃圾广告
  '加微信', '加v信', '威信', 'vx', 'v信', '私聊', '点击链接', '点击进入',
  '免费领取', '限时领取', '日入过万', '日赚', '月入过万', '轻松赚钱',
  '招嫖', '同城约', '约炮', '一夜情', '一夜qing',
  '代开发票', '办证', '刻章', '发票代办', '论文代写',
  '减肥药', '壮阳', '增大增粗', '根治',
];

/** 昵称里同样要过滤，防止顶着脏名字发言 */
const BLOCKED_AUTHOR_WORDS = ['admin', '管理员', '官方', '客服', '系统'];

/**
 * KV 绑定名。若你在控制台绑定时用了别的变量名，改下面的 KV_BINDING。
 */
const KV_BINDING = 'comments_kv';

/** 取运行时注入的 KV；未绑定则返回 undefined */
function getKV() {
  try {
    return typeof globalThis[KV_BINDING] !== 'undefined' ? globalThis[KV_BINDING] : undefined;
  } catch {
    return undefined;
  }
}

/** 清理控制字符并截断长度（前端也会再转义一次，双重保险） */
function sanitize(input, maxLength) {
  if (typeof input !== 'string') return '';
  return input
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '')
    .trim()
    .slice(0, maxLength);
}

/** 去掉容易造成混淆的全角空格、零宽字符等 */
function normalizeText(text) {
  return text
    .replace(/[\u200b-\u200d\ufeff]/g, '') // 零宽字符
    .replace(/[\u3000]/g, ' ')
    .replace(/\s+/g, ' ')
    .toLowerCase();
}

/** 是否命中敏感词（大小写、全半角、零宽字符都不影响判定） */
function hasBlockedWord(text) {
  const normalized = normalizeText(text);
  return BLOCKED_WORDS.some((word) => normalized.includes(word.toLowerCase()));
}

/** 昵称是否使用了误导性身份（如伪装成管理员） */
function isSpoofedAuthor(author) {
  const normalized = normalizeText(author);
  return BLOCKED_AUTHOR_WORDS.some((word) => normalized === word.toLowerCase());
}

/** 提取文本中的链接（http/https 与裸域名） */
function extractLinks(text) {
  const matches = text.match(
    /https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9-]+\.(com|cn|net|org|io|xyz|top|vip|cc|me)\b[^\s]*/gi
  );
  return matches ?? [];
}

/** 内容是否以链接为主（典型广告特征） */
function isLinkSpam(content) {
  const links = extractLinks(content);
  if (links.length === 0) return false;
  if (links.length > MAX_LINKS) return true;

  // 去掉链接后的纯文本长度，占比过低则判为垃圾
  const withoutLinks = content.replace(
    /https?:\/\/[^\s]+|www\.[^\s]+|[a-z0-9-]+\.(com|cn|net|org|io|xyz|top|vip|cc|me)\b[^\s]*/gi,
    ''
  );
  const textLength = withoutLinks.replace(/\s/g, '').length;
  if (textLength === 0) return true;

  const linkChars = links.join('').length;
  return linkChars / (linkChars + textLength) > MAX_LINK_RATIO;
}

/**
 * 内容是否由极少字符反复构成（刷屏特征）。
 * 注意：必须先判断字符多样性，否则 'aaaa...' 这类正常长文会被误判。
 */
function isRepeatedSpam(content) {
  const compact = content.replace(/\s/g, '');
  if (compact.length < 20) return false;

  // 唯一字符过少（如纯 'a'、纯 '哈'）才有刷屏嫌疑
  const unique = new Set(compact).size;
  if (unique > 5) return false;

  // 单一字符占比过高，判为刷屏
  const counts = {};
  for (const ch of compact) counts[ch] = (counts[ch] ?? 0) + 1;
  const top = Math.max(...Object.values(counts));
  return top / compact.length > 0.8;
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

/** 去掉仅供内部使用的字段，避免泄漏到前端 */
function stripInternal(comment) {
  if (!comment) return comment;
  const { _hash, status, ...rest } = comment;
  return rest;
}

/**
 * 只返回已通过审核的评论；审核中的不下发给前端。
 * 同时剔除内部字段，前端不该看到 _hash。
 */
function visibleComments(comments) {
  const filtered = REVIEW_MODE
    ? comments.filter((c) => c && c.status === 'approved')
    : comments;
  return filtered.map(stripInternal);
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
    const comments = visibleComments(await readComments(kv, slug));
    return json({ comments });
  }

  // ---------- 发表评论 ----------
  if (request.method === 'POST') {
    // 1) 同源校验：拒绝来自其他站点的提交
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

    // 2) 解析请求体
    let payload;
    try {
      payload = await request.json();
    } catch {
      return json({ error: '请求体不是合法 JSON' }, 400);
    }
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return json({ error: '请求体格式不正确' }, 400);
    }

    // 3) 蜜罐字段：正常用户看不到，填了即视为机器人
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

    // 4) 内容过滤：低俗 / 违法 / 广告
    if (hasBlockedWord(content)) {
      return json({ error: '评论内容包含不允许的词汇' }, 400);
    }
    if (isSpoofedAuthor(author)) {
      return json({ error: '请换一个昵称' }, 400);
    }
    if (isLinkSpam(content)) {
      return json({ error: '评论中链接过多，疑似广告' }, 400);
    }
    if (isRepeatedSpam(content)) {
      return json({ error: '评论内容重复度过高' }, 400);
    }

    // 5) 频率限制：同一 IP 15 秒内只能提交一次
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

    // 6) 重复内容检测：同一 IP 在 1 小时内发过完全相同的内容则拒绝
    const existing = await readComments(kv, slug);
    const contentHash = `${ip}|${content}`;
    const recentDuplicate = existing.some(
      (c) =>
        c &&
        c._hash === contentHash &&
        Date.now() - new Date(c.createdAt).getTime() < 3_600_000
    );
    if (recentDuplicate) {
      return json({ error: '你已经发过相同的评论了' }, 400);
    }

    const comment = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      slug,
      author,
      content,
      createdAt: new Date().toISOString(),
      // 审核状态：REVIEW_MODE 关闭时直接公开
      ...(REVIEW_MODE ? { status: 'pending' } : {}),
      // 仅用于重复检测，不会返回给前端
      _hash: contentHash,
    };

    // 新的排在前面
    const next = [comment, ...existing].slice(0, MAX_COMMENTS_PER_POST);

    await kv.put(`c:${slug}`, JSON.stringify(next));
    await kv.put(rlKey, String(Date.now()));

    // 返回给前端的对象去掉内部字段
    const { _hash, ...publicComment } = comment;
    return json({ comment: publicComment }, 201);
  }

  return json({ error: 'Method Not Allowed' }, 405, { allow: 'GET, POST' });
}
