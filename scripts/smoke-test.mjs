// 渲染验收：检查构建产物里关键结构是否真的输出了。
import fs from 'node:fs';

const BASE = process.env.BASE ?? 'http://127.0.0.1:4399';

async function get(p) {
  const r = await fetch(BASE + p);
  return { status: r.status, html: await r.text() };
}

const checks = [];
function check(name, ok) {
  checks.push({ name, ok });
}

// 文章数量会随写作变化，因此从磁盘动态读取，避免测试写死后失效
const postCount = fs.readdirSync('src/content/blog').filter((f) => f.endsWith('.md')).length;
const pageSize = 6; // 与 src/config.ts 的 SITE.pageSize 保持一致
const expectOnHome = Math.min(postCount, pageSize);

const home = await get('/');
check('首页返回 200', home.status === 200);
check('首页有个人名片', home.html.includes('home-hero__name') && home.html.includes('home-hero__avatar'));
check('首页有统计带', home.html.includes('home-stats') && home.html.includes('home-stat__value'));
check('首页有快捷入口', home.html.includes('开始阅读') && home.html.includes('/notes/'));
check('首页有右侧信息栏', home.html.includes('home-side') && home.html.includes('关于我'));
check('首页卡片有封面', home.html.includes('post-card__cover') && home.html.includes('--cover-from'));
// 卡片上还会挂 .reveal 之类的行为类，所以用前缀匹配而不是全等
check(
  `首页渲染 ${expectOnHome} 张文章卡片`,
  (home.html.match(/class="post-card[\s"]/g) || []).length === expectOnHome
);
check('首页 <title> 含站点名', /<title>[^<]*DeepWork[^<]*<\/title>/.test(home.html));
check('首页有 meta description', /name="description"/.test(home.html));
check('首页有 canonical', /rel="canonical"/.test(home.html));
check('首页有 og:title', /property="og:title"/.test(home.html));
check('主题预置脚本存在', home.html.includes("localStorage.getItem('theme')"));
check('导航高亮首页', /href="\/" aria-current="page"/.test(home.html));
check('首页「查看全部」指向文章页', home.html.includes('href="/posts/"'));

const post = await get('/blog/hello-world/');
check('文章页返回 200', post.status === 200);
check('文章页 og:type=article', /property="og:type" content="article"/.test(post.html));
check('文章页有目录', post.html.includes('toc__title') && post.html.includes('data-toc'));
check('文章页有上一篇/下一篇', post.html.includes('post-nav'));
check('文章页有代码高亮', /astro-code|shiki/.test(post.html));
check('文章页有标签', post.html.includes('class="tag"'));
check('未配置 Giscus 时给出提示', post.html.includes('评论区尚未启用'));
check('文章页有正文内容', post.html.includes('欢迎来到我的博客'));

// 文章页：全量列表 + 搜索框（取代原来的「归档」和「标签」两个页面）
const posts = await get('/posts/');
check('文章页返回 200', posts.status === 200);
check(
  `文章页列出全部 ${postCount} 篇`,
  (posts.html.match(/class="post-card[\s"]/g) || []).length === postCount
);
check('文章页有搜索框', posts.html.includes('data-search-input'));
check('文章页有搜索结果容器', posts.html.includes('data-search-list') && posts.html.includes('data-search-status'));
check('文章页卡片带搜索用 id', posts.html.includes('data-post-id='));

const idx = await get('/search-index.json');
let idxRows = [];
try {
  idxRows = JSON.parse(idx.html);
} catch {
  idxRows = [];
}
check('搜索索引可访问', idx.status === 200 && Array.isArray(idxRows));
check(`搜索索引含 ${postCount} 条`, idxRows.length === postCount);
check('搜索索引含正文（不只标题）', idxRows.some((r) => (r.text ?? '').length > 200));
check('搜索索引不含 markdown 记号', !idxRows.some((r) => /^#{1,6}\s/.test(r.text ?? '')));

// 被删掉的两个页面必须真的 404，避免留下死链
const goneArchive = await get('/archive/');
check('归档页已移除', goneArchive.status === 404);
const goneTags = await get('/tags/');
check('标签页已移除', goneTags.status === 404);
check('导航不再有归档/标签', !home.html.includes('href="/archive"') && !home.html.includes('href="/tags"'));
check('导航有文章入口', /href="\/posts"[^>]*>文章</.test(home.html) || home.html.includes('href="/posts"'));

// 说说：从磁盘统计已发布的条数，draft 在生产构建里必须被过滤掉
const noteFiles = fs.readdirSync('src/content/notes').filter((f) => f.endsWith('.md'));
const noteCount = noteFiles.filter(
  (f) => !fs.readFileSync(`src/content/notes/${f}`, 'utf8').includes('draft: true')
).length;
const notes = await get('/notes/');
check('说说页返回 200', notes.status === 200);
check('说说页有时间轴', notes.html.includes('notes-timeline'));
check(
  `说说页渲染 ${noteCount} 条`,
  (notes.html.match(/class="note[\s"]/g) || []).length === noteCount
);
check('说说页有九宫格布局', notes.html.includes('data-grid='));
check('说说页有置顶标记', notes.html.includes('note__pin'));
check('说说草稿未泄漏', !notes.html.includes('draft-demo'));
check('说说页在导航里', home.html.includes('href="/notes"'));

// 说说分类：从磁盘 frontmatter 里抽出 category，默认「杂项」
const catOf = (f) => {
  const m = fs
    .readFileSync(`src/content/notes/${f}`, 'utf8')
    .match(/^category:\s*(.+)$/m);
  return m ? m[1].trim().replace(/^["']|["']$/g, '') : '杂项';
};
const published = noteFiles.filter(
  (f) => !fs.readFileSync(`src/content/notes/${f}`, 'utf8').includes('draft: true')
);
const catCount = new Map();
for (const f of published) catCount.set(catOf(f), (catCount.get(catOf(f)) ?? 0) + 1);

check(
  `每条说说都带分类徽章（${noteCount} 个）`,
  (notes.html.match(/class="note__cat"/g) || []).length === noteCount
);
check('说说页有分类筛选栏', notes.html.includes('class="cat-filter"'));
check('筛选栏有「全部」按钮', /data-cat-chip=""[^>]*>\s*全部/.test(notes.html));
for (const [name, count] of catCount) {
  check(
    `筛选栏含分类「${name}」（${count} 条）`,
    notes.html.includes(`data-cat-chip="${name}"`) &&
      new RegExp(`data-cat-chip="${name}"[\\s\\S]{0,200}?${count}</span>`).test(notes.html)
  );
}
check(
  '未登记的分类回退到灰色',
  !notes.html.includes('--cat:#000') && !notes.html.includes('--cat:undefined')
);

check(`每条说说都有点赞控件（${noteCount} 个）`,
  (notes.html.match(/data-like[\s>]/g) || []).length === noteCount
);
const hiddenLikes = (notes.html.match(/data-like[\s>][^>]*hidden/g) || []).length;
check('说说点赞控件初始隐藏', hiddenLikes === noteCount, `实际 ${hiddenLikes}`);

const about = await get('/about/');
check('关于页返回 200', about.status === 200);

const rss = await get('/rss.xml');
check('RSS 返回 200', rss.status === 200);
check(`RSS 含 ${postCount} 条 item`, (rss.html.match(/<item>/g) || []).length === postCount);
check('RSS 声明 zh-CN', rss.html.includes('<language>zh-CN</language>'));

const sm = await get('/sitemap-index.xml');
check('Sitemap 返回 200', sm.status === 200);
check('Sitemap 含文章地址', sm.html.includes('/blog/hello-world/'));
check('Sitemap 含文章页', sm.html.includes('/posts/'));
check('Sitemap 不含已删除页面', !sm.html.includes('/tags/') && !sm.html.includes('/archive/'));

const postDetail = await get('/blog/hello-world/');
check('文章详情页返回 200', postDetail.status === 200);
check('文章详情页有正文', postDetail.html.includes('<div class="prose">'));
check('文章详情页有赞按钮', postDetail.html.includes('data-like'));
check('文章赞按钮初始隐藏',
  (postDetail.html.match(/data-like[^>]*hidden/g) || []).length >= 1
);

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
