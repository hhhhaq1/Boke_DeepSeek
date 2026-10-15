// 构建校验脚本：检查内部链接是否都有对应的产物文件。
// 用法: node scripts/verify-build.mjs
import fs from 'node:fs';
import path from 'node:path';

const ROOT = '.edgeone/assets';
let checked = 0;
let missing = 0;
const problems = [];

if (!fs.existsSync(ROOT)) {
  console.error(`✗ 找不到构建产物目录 ${ROOT}，请先运行构建。`);
  process.exit(1);
}

/** 递归收集所有 html 文件 */
function walk(dir) {
  const out = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...walk(full));
    else if (entry.name.endsWith('.html')) out.push(full);
  }
  return out;
}

/** 判断某个站内路径在产物中是否存在 */
function resolveTarget(href) {
  const clean = href.split('#')[0].split('?')[0];
  if (!clean.startsWith('/')) return null; // 外链/锚点，跳过
  let decoded;
  try {
    decoded = decodeURIComponent(clean);
  } catch {
    decoded = clean;
  }
  const base = path.join(ROOT, decoded);
  // 依次尝试：原样文件、补 .html、当作目录取 index.html
  const candidates = [base, `${base}.html`, path.join(base, 'index.html')];
  // 带扩展名但并非 html 的资源（如 /rss.xml、/sitemap-index.xml），只按原样判断
  if (path.extname(decoded)) {
    return fs.existsSync(base) ? true : decoded;
  }
  return candidates.some((c) => fs.existsSync(c)) ? true : decoded;
}

const htmlFiles = walk(ROOT);
for (const file of htmlFiles) {
  const html = fs.readFileSync(file, 'utf8');
  const hrefs = [...html.matchAll(/href="([^"]+)"/g)].map((m) => m[1]);
  for (const href of hrefs) {
    if (/^(https?:|mailto:|#|\/\/)/.test(href)) continue;
    checked++;
    const result = resolveTarget(href);
    if (result !== null && result !== true) {
      missing++;
      problems.push(`  ${path.relative(ROOT, file)} -> ${href}  (期望文件: ${result})`);
    }
  }
}

console.log(`扫描 ${htmlFiles.length} 个 HTML 文件，检查 ${checked} 个站内链接。`);
if (missing === 0) {
  console.log('✓ 所有站内链接都有对应的产物文件。');
} else {
  console.log(`✗ ${missing} 个链接找不到目标：`);
  console.log([...new Set(problems)].join('\n'));
  process.exit(1);
}

// 顺带确认关键文件都在
const required = ['index.html', '404.html', 'rss.xml', 'robots.txt', 'sitemap-index.xml'];
const absent = required.filter((f) => !fs.existsSync(path.join(ROOT, f)));
if (absent.length) {
  console.log(`✗ 缺少关键文件: ${absent.join(', ')}`);
  process.exit(1);
}
console.log('✓ 关键文件齐全:', required.join(', '));
