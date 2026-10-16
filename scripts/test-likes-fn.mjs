// 对边缘函数 functions/api/likes.js 做一次逻辑自测：
// 用一个内存版 KV 冒充 EdgeOne 运行时，验证读写、幂等、取消、限流等行为。
//
// 运行: node scripts/test-likes-fn.mjs
import { onRequest } from '../functions/api/likes.js';

/** 内存 KV，模拟 EdgeOne 注入的 KV 命名空间 */
function makeKV({ withDelete = true } = {}) {
  const store = new Map();
  const kv = {
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
  if (withDelete) {
    kv.delete = async (key) => {
      store.delete(key);
    };
  }
  return kv;
}

const checks = [];
const check = (name, ok, extra = '') => checks.push({ name, ok, extra });

function req(method, { body, query = '', headers = {} } = {}) {
  const url = `https://blog.example.com/api/likes${query}`;
  return {
    request: new Request(url, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body ? JSON.stringify(body) : undefined,
    }),
  };
}

const IP = { 'eo-connecting-ip': '1.2.3.4' };
const V1 = 'visitor-aaaaaaaa';
const V2 = 'visitor-bbbbbbbb';

/** 发一次点赞/取消，返回 { status, body } */
async function act(payload, headers = IP) {
  const r = await onRequest({ request: req('POST', { body: payload, headers }).request });
  return { status: r.status, body: await r.json() };
}

/** 查一次赞数，返回 { status, body } */
async function query(qs) {
  const r = await onRequest({ request: req('GET', { query: qs }).request });
  return { status: r.status, body: await r.json() };
}

// ---------- 1. KV 未绑定时应报 503 ----------
{
  globalThis.likes_kv = undefined;
  globalThis.comments_kv = undefined;
  const r = await onRequest({ request: req('GET', { query: '?slug=hello' }).request });
  check('未绑定 KV 时返回 503', r.status === 503, `实际 ${r.status}`);
}

// ---------- 2. 优先使用 likes_kv，缺失时回退 comments_kv ----------
const commentsKV = makeKV();
globalThis.likes_kv = undefined;
globalThis.comments_kv = commentsKV;
{
  const r = await onRequest({ request: req('GET', { query: '?slug=fallback' }).request });
  check('未绑 likes_kv 时回退到 comments_kv', r.status === 200, `实际 ${r.status}`);
}
{
  const dedicated = makeKV();
  globalThis.likes_kv = dedicated;
  await onRequest({ request: req('GET', { query: '?slug=x' }).request });
  check('绑了 likes_kv 时优先用它', dedicated._store.size === 0 && commentsKV._store.size === 0);
}

const kv = makeKV();
globalThis.likes_kv = kv;
globalThis.comments_kv = undefined;

// ---------- 3. 空内容返回 0 ----------
{
  const { status, body } = await query('?slug=hello-world');
  check('未点赞的内容返回 count 0', status === 200 && body.likes['hello-world'].count === 0);
  check('未点赞时 liked 为 false', body.likes['hello-world'].liked === false);
}

// ---------- 4. 缺少 slug 应 400 ----------
{
  const r = await onRequest({ request: req('GET').request });
  check('缺少 slug 返回 400', r.status === 400, `实际 ${r.status}`);
}

// ---------- 5. 非法 slug ----------
{
  const r = await onRequest({ request: req('GET', { query: '?slug=' + encodeURIComponent('bad slug!!') }).request });
  check('非法 slug 返回 400', r.status === 400, `实际 ${r.status}`);
}

// ---------- 6. 点赞 ----------
{
  const { status, body } = await act({ slug: 'hello-world', visitor: V1, action: 'like' });
  check('点赞返回 200', status === 200, `实际 ${status}`);
  check('点赞后 count 为 1', body.count === 1, `实际 ${body.count}`);
  check('点赞后 liked 为 true', body.liked === true);
}

// ---------- 7. 重复点赞幂等 ----------
{
  const { body } = await act({ slug: 'hello-world', visitor: V1, action: 'like' });
  check('同一访客重复点赞不重复计数', body.count === 1, `实际 ${body.count}`);
}

// ---------- 8. 换个访客再赞 ----------
{
  const { body } = await act({ slug: 'hello-world', visitor: V2, action: 'like' });
  check('第二个访客点赞后 count 为 2', body.count === 2, `实际 ${body.count}`);
}

// ---------- 9. liked 状态跟着访客走 ----------
{
  const a = await query(`?slug=hello-world&visitor=${V1}`);
  check('V1 查询 liked 为 true', a.body.likes['hello-world'].liked === true);
  const b = await query('?slug=hello-world&visitor=visitor-cccccccc');
  check('未赞过的访客 liked 为 false', b.body.likes['hello-world'].liked === false);
  const c = await query('?slug=hello-world');
  check('不带 visitor 时 liked 恒为 false', c.body.likes['hello-world'].liked === false);
}

// ---------- 10. 取消赞 ----------
{
  const { body } = await act({ slug: 'hello-world', visitor: V2, action: 'unlike' });
  check('取消赞后 count 回到 1', body.count === 1, `实际 ${body.count}`);
  check('取消赞后 liked 为 false', body.liked === false);
}

// ---------- 11. 重复取消幂等 ----------
{
  const { body } = await act({ slug: 'hello-world', visitor: V2, action: 'unlike' });
  check('重复取消不把计数减成负数', body.count === 1, `实际 ${body.count}`);
}

// ---------- 12. 非法 visitor ----------
{
  const a = await act({ slug: 'hello-world', visitor: 'short', action: 'like' });
  check('过短的 visitor 被拒(400)', a.status === 400, `实际 ${a.status}`);
  const b = await act({ slug: 'hello-world', visitor: 'has space in it', action: 'like' });
  check('含非法字符的 visitor 被拒(400)', b.status === 400, `实际 ${b.status}`);
}

// ---------- 13. 跨源请求被拒 ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'hello-world', visitor: V1, action: 'like' },
      headers: { origin: 'https://evil.example', ...IP },
    }).request,
  });
  check('跨源提交被拒(403)', r.status === 403, `实际 ${r.status}`);
}

// ---------- 14. 同源请求放行 ----------
{
  const r = await onRequest({
    request: req('POST', {
      body: { slug: 'origin-ok', visitor: V1, action: 'like' },
      headers: { origin: 'https://blog.example.com', 'eo-connecting-ip': '5.5.5.5' },
    }).request,
  });
  check('同源提交放行(200)', r.status === 200, `实际 ${r.status}`);
}

// ---------- 15. 快速来回切换不该被限流 ----------
{
  const ip = { 'eo-connecting-ip': '6.6.6.6' };
  const a = await act({ slug: 'toggle', visitor: V1, action: 'like' }, ip);
  const b = await act({ slug: 'toggle', visitor: V1, action: 'unlike' }, ip);
  const c = await act({ slug: 'toggle', visitor: V1, action: 'like' }, ip);
  check(
    '点赞后立刻取消不会被限流',
    a.status === 200 && b.status === 200 && c.status === 200,
    `${a.status}/${b.status}/${c.status}`
  );
  check('来回切换后计数正确', c.body.count === 1, `实际 ${c.body.count}`);
}

// ---------- 16. 写入次数超限被限流 ----------
{
  const ip = { 'eo-connecting-ip': '2.2.2.2' };
  let last = null;
  for (let i = 0; i < 31; i++) {
    last = await act({ slug: `flood-${i}`, visitor: V1, action: 'like' }, ip);
  }
  check('同一 IP 一分钟内第 31 次写入被限流(429)', last.status === 429, `实际 ${last.status}`);
}

// ---------- 17. 限流不误伤：同一 IP 赞不同内容 ----------
{
  const a = await act({ slug: 'rl-a', visitor: V1, action: 'like' }, { 'eo-connecting-ip': '7.7.7.7' });
  const b = await act({ slug: 'rl-b', visitor: V1, action: 'like' }, { 'eo-connecting-ip': '7.7.7.7' });
  check('同一 IP 连着赞不同内容不被限流', a.status === 200 && b.status === 200, `${a.status}/${b.status}`);
}

// ---------- 18. 批量查询 ----------
{
  const { status, body } = await query('?slug=hello-world&slug=rl-a&slug=never-touched');
  const ok =
    status === 200 &&
    Object.keys(body.likes).length === 3 &&
    body.likes['hello-world'].count === 1 &&
    body.likes['rl-a'].count === 1 &&
    body.likes['never-touched'].count === 0;
  check('批量查询一次返回全部结果', ok, JSON.stringify(body.likes));
}

// ---------- 19. 批量上限 ----------
{
  const many = Array.from({ length: 51 }, (_, i) => `slug-${i}`)
    .map((s) => `slug=${s}`)
    .join('&');
  const r = await onRequest({ request: req('GET', { query: `?${many}` }).request });
  check('超过 50 个 slug 返回 400', r.status === 400, `实际 ${r.status}`);
}

// ---------- 20. 没有 delete 的 KV 也能取消赞（回退到写空串） ----------
{
  const noDeleteKV = makeKV({ withDelete: false });
  globalThis.likes_kv = noDeleteKV;
  globalThis.comments_kv = undefined;

  const a = await act({ slug: 'nodelete', visitor: V1, action: 'like' }, { 'eo-connecting-ip': '9.9.9.9' });
  const b = await act({ slug: 'nodelete', visitor: V1, action: 'unlike' }, { 'eo-connecting-ip': '9.9.9.10' });
  check('无 delete 时点赞 count 为 1', a.body.count === 1, `实际 ${a.body.count}`);
  check('无 delete 时取消赞 count 回到 0', b.body.count === 0, `实际 ${b.body.count}`);
  const c = await query(`?slug=nodelete&visitor=${V1}`);
  check('无 delete 时取消后 liked 为 false', c.body.likes.nodelete.liked === false);

  globalThis.likes_kv = kv;
}

// ---------- 21. 中文 slug ----------
{
  const { status, body } = await act(
    { slug: '中文说说-测试', visitor: V1, action: 'like' },
    { 'eo-connecting-ip': '4.4.4.4' }
  );
  check('中文 slug 可以点赞', status === 200 && body.count === 1, `实际 ${status}/${body.count}`);
  const g = await query(`?slug=${encodeURIComponent('中文说说-测试')}&visitor=${V1}`);
  check('中文 slug 可以读回', g.body.likes['中文说说-测试'].liked === true);
}

// ---------- 22. 不支持的请求体 / 方法 ----------
{
  const r = await onRequest({
    request: req('POST', { body: undefined, headers: IP }).request,
  });
  check('空请求体返回 400', r.status === 400, `实际 ${r.status}`);

  const d = await onRequest({ request: req('DELETE', { query: '?slug=x' }).request });
  check('DELETE 返回 405', d.status === 405, `实际 ${d.status}`);
}

// ---------- 23. 非法 action 当作点赞处理 ----------
{
  const { body } = await act(
    { slug: 'bad-action', visitor: V1, action: 'explode' },
    { 'eo-connecting-ip': '3.3.3.3' }
  );
  check('未知 action 按点赞处理', body.count === 1 && body.liked === true, JSON.stringify(body));
}

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.ok || !c.extra ? '' : '  [' + c.extra + ']'}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
