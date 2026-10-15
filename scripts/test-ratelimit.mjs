// 专项验证限流：同一 IP 连续提交应被拦下。
import { onRequest } from '../functions/api/comments.js';

function makeKV() {
  const store = new Map();
  return {
    async get(k, t) { const v = store.get(k); return v === undefined ? null : t === 'json' ? JSON.parse(v) : v; },
    async put(k, v) { store.set(k, v); },
  };
}
globalThis.comments_kv = makeKV();

const post = (ip, n) =>
  onRequest({
    request: new Request('https://blog.example.com/api/comments', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'eo-connecting-ip': ip },
      body: JSON.stringify({ slug: 'rl-test', author: 'u', content: 'c' + n }),
    }),
  });

const first = await post('5.5.5.5', 1);
console.log('同一 IP 第 1 次:', first.status, '(期望 201)');

const second = await post('5.5.5.5', 2);
console.log('同一 IP 第 2 次:', second.status, '(期望 429)');

const other = await post('6.6.6.6', 3);
console.log('不同 IP   第 1 次:', other.status, '(期望 201)');

// 无 IP 头的情况（本地/异常请求）也不应绕过限流
const a = await onRequest({
  request: new Request('https://blog.example.com/api/comments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'rl-test2', author: 'u', content: 'x' }),
  }),
});
const b = await onRequest({
  request: new Request('https://blog.example.com/api/comments', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ slug: 'rl-test2', author: 'u', content: 'y' }),
  }),
});
console.log('无 IP 头 第 1 次:', a.status, '(期望 201)');
console.log('无 IP 头 第 2 次:', b.status, '(期望 429)');

const ok = first.status === 201 && second.status === 429 && other.status === 201 && a.status === 201 && b.status === 429;
console.log(ok ? '\n✓ 限流工作正常' : '\n✗ 限流未按预期工作');
process.exit(ok ? 0 : 1);
