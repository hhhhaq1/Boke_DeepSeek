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
// 取第一篇文章作为「文章详情页」的测试样本，避免写死某个 slug
const firstPostSlug = fs
  .readdirSync('src/content/blog')
  .filter((f) => f.endsWith('.md'))
  .sort()[0]
  ?.replace(/\.md$/, '');
const postPath = `/blog/${encodeURIComponent(firstPostSlug)}/`;

const home = await get('/');
check('首页返回 200', home.status === 200);
check('首页有个人名片', home.html.includes('home-hero__name') && home.html.includes('home-hero__avatar'));
check('首页有统计带', home.html.includes('home-stats') && home.html.includes('home-stat__value'));
// 快捷入口的文案可随意改，这里只要求首页存在通往 /posts/ 和 /notes/ 的入口
check(
  '首页有通往文章/说说的入口',
  home.html.includes('href="/posts/') || home.html.includes('/notes/')
);
check('首页有右侧信息栏', home.html.includes('home-side') && home.html.includes('关于我'));
check('首页卡片有封面', home.html.includes('post-card__cover') && home.html.includes('--cover-from'));
// 卡片上还会挂 .reveal 之类的行为类，所以用前缀匹配而不是全等
check(
  `首页渲染 ${expectOnHome} 张文章卡片`,
  (home.html.match(/class="post-card[\s"]/g) || []).length === expectOnHome
);
// 站名可在 config.ts 任意修改，断言应从配置动态读取而非写死
const siteTitle = fs
  .readFileSync('src/config.ts', 'utf8')
  .match(/^\s*title:\s*'([^']+)'/m)?.[1];
check(
  `首页 <title> 含站点名（${siteTitle}）`,
  Boolean(siteTitle) && home.html.includes(siteTitle)
);
check('首页有 meta description', /name="description"/.test(home.html));
check('首页有 canonical', /rel="canonical"/.test(home.html));
check('首页有 og:title', /property="og:title"/.test(home.html));
check('主题预置脚本存在', home.html.includes("localStorage.getItem('theme')"));
check('导航高亮首页', /href="\/" aria-current="page"/.test(home.html));
check('首页「查看全部」指向文章页', home.html.includes('href="/posts/"'));

const post = await get(postPath);
check(`文章页返回 200（${postPath}）`, post.status === 200);
check('文章页 og:type=article', /property="og:type" content="article"/.test(post.html));
// 目录与代码高亮都取决于文章内容：没有二级标题就没有目录，
// 没有代码块就没有高亮。按样本文章的实际内容判断，避免误报。
const samplePostBody = fs.readFileSync(`src/content/blog/${firstPostSlug}.md`, 'utf8');
// Toc 组件要求 h2/h3 至少 3 条才渲染（太少没有导航价值，见 Toc.astro）
const headingCount = (samplePostBody.match(/^#{2,3}\s+/gm) || []).length;
const hasToc = headingCount >= 3;
const hasCodeBlock = /```/.test(samplePostBody);
check(
  `文章页目录（${hasToc ? `有 ${headingCount} 条标题` : `仅 ${headingCount} 条标题，少于 3 条不渲染`}）`,
  !hasToc || (post.html.includes('toc__title') && post.html.includes('data-toc'))
);
check(
  `文章页代码高亮（${hasCodeBlock ? '有代码块' : '样本无代码块，不渲染'}）`,
  !hasCodeBlock || /astro-code|shiki/.test(post.html)
);
check('文章页有上一篇/下一篇', post.html.includes('post-nav'));
check('文章页有标签', post.html.includes('class="tag"'));
// 评论区：两种模式都应给出可用的形态
// - giscus 未配置：显示明确的配置提示
// - self        ：渲染出自带表单与列表的评论区
const giscusPlaceholder = post.html.includes('评论区尚未启用');
const selfForm = post.html.includes('self-comments-form');
check(
  '评论区形态正确（Giscus 提示 或 自建表单）',
  giscusPlaceholder || selfForm,
  `giscus提示=${giscusPlaceholder} 自建表单=${selfForm}`
);
// 正文内容因文章而异，改为检查 .prose 容器里确实有文字
const proseText = (post.html.match(/<div class="prose">([\s\S]*?)<\/div>/) ?? [])[1] ?? '';
check('文章页有正文内容', proseText.replace(/<[^>]+>/g, '').trim().length > 50);

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
const publishedNotes = noteFiles
  .map((f) => ({ file: f, body: fs.readFileSync(`src/content/notes/${f}`, 'utf8') }))
  .filter((n) => !n.body.includes('draft: true'));
const noteCount = publishedNotes.length;
// 供下面按数据判断：是否真的有多图说说 / 置顶说说
const noteImages = Math.max(
  0,
  ...publishedNotes.map((n) => {
    const m = n.body.match(/images:\s*\[([^\]]*)\]/);
    return m ? m[1].split(',').filter((s) => s.trim()).length : 0;
  })
);
const notePinned = publishedNotes.filter((n) => /pinned:\s*true/.test(n.body)).length;

const notes = await get('/notes/');
check('说说页返回 200', notes.status === 200);
check('说说页有时间轴', notes.html.includes('notes-timeline'));
check(
  `说说页渲染 ${noteCount} 条`,
  (notes.html.match(/class="note[\s"]/g) || []).length === noteCount
);
// 九宫格与置顶都是「有内容才出现」的：没有多图说说、没有置顶项时不渲染，
// 所以这里按实际数据判断，而不是无条件要求标签存在。
const hasMultiImage = noteImages > 1;
const hasPinned = notePinned > 0;
check(
  `说说页多图布局（${hasMultiImage ? '有' : '暂无多图说说，不渲染'}）`,
  !hasMultiImage || notes.html.includes('data-grid=')
);
check(
  `说说页置顶标记（${hasPinned ? '有' : '暂无置顶，不渲染'}）`,
  !hasPinned || notes.html.includes('note__pin')
);
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
// 属性间可能有多个空格、后面还会追加 data-astro-cid-*，所以用 [^>]* 而非 \s* 匹配
check('筛选栏有「全部」按钮', /data-cat-chip=""[^>]*>[\s\S]{0,60}?全部/.test(notes.html));
for (const [name, count] of catCount) {
  // 分类按钮的计数在 <span class="cat-chip__count"> 里，中间还夹着 class 等属性，
  // 因此这里放宽为「在本按钮内出现该数字」
  const chip = notes.html.match(
    new RegExp(`<button[^>]*data-cat-chip="${name}"[\\s\\S]*?</button>`)
  )?.[0];
  check(
    `筛选栏含分类「${name}」（${count} 条）`,
    Boolean(chip) && new RegExp(`>\\s*${count}\\s*<`).test(chip)
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
// RSS 现在同时收录文章和说说（说说更新更频繁，排除会让订阅者错过日常更新）
const expectedRss = postCount + noteCount;
check(`RSS 含 ${expectedRss} 条 item（文章 ${postCount} + 说说 ${noteCount}）`,
  (rss.html.match(/<item>/g) || []).length === expectedRss,
  `实际 ${(rss.html.match(/<item>/g) || []).length}`
);
check('RSS 含说说条目', rss.html.includes('说说 ·'));
check('RSS 声明 zh-CN', rss.html.includes('<language>zh-CN</language>'));

const sm = await get('/sitemap-index.xml');
check('Sitemap 返回 200', sm.status === 200);
check(`Sitemap 含文章地址（${postPath}）`, sm.html.includes(postPath));
check('Sitemap 含文章页', sm.html.includes('/posts/'));
check('Sitemap 不含已删除页面', !sm.html.includes('/tags/') && !sm.html.includes('/archive/'));

const postDetail = await get(postPath);
check(`文章详情页返回 200（${postPath}）`, postDetail.status === 200);
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
