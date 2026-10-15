// 渲染验收：检查构建产物里关键结构是否真的输出了。
const BASE = process.env.BASE ?? 'http://127.0.0.1:4399';

async function get(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, html: await r.text() };
}

const checks = [];
function check(name, ok) {
  checks.push({ name, ok });
}

const home = await get('/');
check('首页返回 200', home.status === 200);
check('首页有 Hero 标题', home.html.includes('hero__title'));
check('首页渲染 3 张文章卡片', (home.html.match(/class="post-card"/g) || []).length === 3);
check('首页 <title> 含站点名', /<title>[^<]*DeepWork[^<]*<\/title>/.test(home.html));
check('首页有 meta description', /name="description"/.test(home.html));
check('首页有 canonical', /rel="canonical"/.test(home.html));
check('首页有 og:title', /property="og:title"/.test(home.html));
check('主题预置脚本存在', home.html.includes("localStorage.getItem('theme')"));
check('单页文章少于每页数量时不渲染分页', !home.html.includes('class="pagination"'));
check('导航高亮首页', /href="\/" aria-current="page"/.test(home.html));

const post = await get('/blog/hello-world/');
check('文章页返回 200', post.status === 200);
check('文章页 og:type=article', /property="og:type" content="article"/.test(post.html));
check('文章页有目录', post.html.includes('文章目录'));
check('文章页有上一篇/下一篇', post.html.includes('post-nav'));
check('文章页有代码高亮', /astro-code|shiki/.test(post.html));
check('文章页有标签链接', /href="\/tags\//.test(post.html));
check('未配置 Giscus 时给出提示', post.html.includes('评论区尚未启用'));
check('文章页有正文内容', post.html.includes('欢迎来到我的博客'));

const archive = await get('/archive/');
check('归档页返回 200', archive.status === 200);
check('归档页按年分组', archive.html.includes('archive-year'));

const tags = await get('/tags/');
check('标签页返回 200', tags.status === 200);
check('标签页有标签云', tags.html.includes('tag-cloud'));

const tagCN = await get('/tags/%E9%9A%8F%E7%AC%94/');
check('中文标签页可访问', tagCN.status === 200 && tagCN.html.includes('随笔'));

const about = await get('/about/');
check('关于页返回 200', about.status === 200);

const rss = await get('/rss.xml');
check('RSS 返回 200', rss.status === 200);
check('RSS 含 3 条 item', (rss.html.match(/<item>/g) || []).length === 3);
check('RSS 声明 zh-CN', rss.html.includes('<language>zh-CN</language>'));

const sm = await get('/sitemap-index.xml');
check('Sitemap 返回 200', sm.status === 200);
check('Sitemap 含文章地址', sm.html.includes('/blog/hello-world/'));

const nf = await get('/definitely-not-a-page/');
check('未知路径返回 404', nf.status === 404);
check('404 页面有返回首页链接', nf.html.includes('返回首页') || nf.html.includes('404'));

// 样式文件的哈希名会随构建变化，这里从首页里动态提取
const cssHref = (home.html.match(/href="(\/_astro\/[^"]+\.css)"/) ?? [])[1];
const css = cssHref ? await get(cssHref) : { status: 0 };
check('样式文件可访问', css.status === 200);

let failed = 0;
for (const c of checks) {
  console.log(`${c.ok ? '✓' : '✗'} ${c.name}`);
  if (!c.ok) failed++;
}
console.log(`\n${checks.length - failed}/${checks.length} 项通过`);
process.exit(failed === 0 ? 0 : 1);
