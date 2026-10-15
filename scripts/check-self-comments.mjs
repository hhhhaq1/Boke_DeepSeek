// 检查自建评论模式下的产物：容器、脚本、关键逻辑是否都随页面输出。
import fs from 'node:fs';

const file = '.edgeone/assets/blog/hello-world/index.html';
const html = fs.readFileSync(file, 'utf8');

const checks = [
  ['评论容器 id="self-comments"', html.includes('id="self-comments"')],
  ['评论表单', html.includes('self-comments-form')],
  ['评论列表容器', html.includes('self-comments-list')],
  ['调用 /api/comments', html.includes('/api/comments')],
  ['前端转义逻辑', html.includes('&amp;') || html.includes('replace(/&/g')],
  ['相对时间函数文案', html.includes('刚刚')],
  ['加载失败提示', html.includes('评论加载失败')],
  ['有内联 module 脚本', /<script type="module">/.test(html)],
  ['不再渲染 Giscus 占位', !html.includes('评论区尚未启用')],
];

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
}
console.log(`\n页面大小: ${(html.length / 1024).toFixed(1)} KB`);
console.log(`${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed ? 1 : 0);
