// 对边缘函数 functions/api/comments.js 做一次逻辑自测：
// 用一个内存版 KV 冒充 EdgeOne 运行时，验证读写、校验、限流等行为。
//
// 运行: node scripts/test-comments-fn.mjs
import { onRequest } from '../functions/api/comments.js';

/** 内存 KV，模拟 EdgeOne 注入的 comments_kv */
function makeKV() {
  const store = new Map();
  return {
    async get(key, type) {
      const v = store.get(key);
      if (v === undefined) return null;
      return type === 'json' ? JSON.parse(v) : v;
    },
    async put(key, value) {
      store.set(key, value);
    },
    _store: store,
  };
}

const checks = [];
const check = (name, ok, extra = '') => checks.push({ name, ok, extra });

function req(method, { body, query = '', headers = {} } = {}) {
  const url = `https://blog.example.com/api/comments${query}`;
  return {
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }),
  };
}

// ---------- 1. KV 未绑定时应报 503 ----------
{
  globalThis.comments_kv = undefined;
  const r = await onRequest(req('GET', { query: '?slug=hello' }).request);
  check('未绑定 KV 时返回 503', r.status === 503, `实际 ${r.status}`);
}

// ---------- 绑定内存 KV ----------
const kv = makeKV();
globalThis.comments_kv = kv;

// ---------- 2. 空文章返回空数组 ----------
{
  const r = await onRequest({ request: req('GET', { query: '?slug=hello-world' }).request });
  const j = await r.json();
  check('空评论区返回 200 和空数组', r.status === 200 && Array.isArray(j.comments) && j.comments.length === 0);
}

// ---------- 3. 缺少 slug 应 400 ----------
{
  const r = await onRequest({ request: req('GET').request });
  check('缺少 slug 返回 400', r.status === 400, `实际 ${r.status}`);
}

// ---------- 4. 发表评论 ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'hello-world', author: '张三', content: '写得不错！' },
      headers: { 'eo-connecting-ip': '1.2.3.4' },
    }).request,
  });
  const j = await r.json();
  check('发表评论返回 201', r.status === 201, `实际 ${r.status}`);
  check('返回体含评论对象', Boolean(j.comment && j.comment.id && j.comment.author === '张三'));
  check('响应不包含邮箱字段', j.comment && !('email' in j.comment));
}

// ---------- 5. 评论可被读回 ----------
{
  const r = await onRequest({ request: req('GET', { query: '?slug=hello-world' }).request });
  const j = await r.json();
  check('读回 1 条评论', j.comments.length === 1, `实际 ${j.comments.length}`);
  check('评论内容正确', j.comments[0]?.content === '写得不错！');
}

// ---------- 6. 频率限制（同一 IP 连续提交） ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'hello-world', author: '李四', content: '第二条' },
      headers: { 'eo-connecting-ip': '1.2.3.4' }, // 与上一条相同 IP
    }).request,
  });
  check('同一 IP 15 秒内重复提交被限流(429)', r.status === 429, `实际 ${r.status}`);
}

// ---------- 7. 校验：空昵称 / 空内容 ----------
{
  const a = await onRequest({
    request: req('POST', { body: { slug: 'hello-world', author: '', content: 'x' }, headers: { 'eo-connecting-ip': '9.9.9.9' } }).request,
  });
  check('空昵称被拒(400)', a.status === 400, `实际 ${a.status}`);

  const b = await onRequest({
    request: req('POST', { body: { slug: 'hello-world', author: 'x', content: '   ' }, headers: { 'eo-connecting-ip': '9.9.9.8' } }).request,
  });
  check('空白内容被拒(400)', b.status === 400, `实际 ${b.status}`);
}

// ---------- 8. 蜜罐字段 ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'hello-world', author: 'bot', content: 'spam', website: 'http://spam.example' },
      headers: { 'eo-connecting-ip': '9.9.9.7' },
    }).request,
  });
  check('蜜罐字段命中被拒(400)', r.status === 400, `实际 ${r.status}`);
}

// ---------- 9. 跨源请求被拒 ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'hello-world', author: 'x', content: 'y' },
      headers: { origin: 'https://evil.example', 'eo-connecting-ip': '9.9.9.6' },
    }).request,
  });
  check('跨源提交被拒(403)', r.status === 403, `实际 ${r.status}`);
}

// ---------- 10. 非法 slug ----------
{
  const r = await onRequest({ request: req('GET', { query: '?slug=' + encodeURIComponent('bad slug!!') }).request });
  check('非法 slug 返回 400', r.status === 400, `实际 ${r.status}`);
}

// ---------- 11. 超长内容被截断 ----------
{
  const long = 'a'.repeat(3000);
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'long-post', author: 'x', content: long },
      headers: { 'eo-connecting-ip': '8.8.8.8' },
    }).request,
  });
  const j = await r.json();
  check('超长内容被截断到 2000 字', r.status === 201 && j.comment.content.length === 2000, `长度 ${j.comment?.content?.length}`);
}

// ---------- 12. 不支持的方法 ----------
{
  const r = await onRequest({ request: req('DELETE', { query: '?slug=x' }).request });
  check('DELETE 返回 405', r.status === 405, `实际 ${r.status}`);
}

// ---------- 13. 中文 slug ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: '中文文章-测试', author: '中文用户', content: '中文内容' },
      headers: { 'eo-connecting-ip': '7.7.7.7' },
    }).request,
  });
  check('中文 slug 可以发表评论', r.status === 201, `实际 ${r.status}`);
  const g = await onRequest({ request: req('GET', { query: '?slug=' + encodeURIComponent('中文文章-测试') }).request });
  const j = await g.json();
  check('中文 slug 评论可读回', j.comments?.length === 1);
}

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.extra ? '' : '  [' + c.extra + ']'}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
