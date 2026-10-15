/**
 * 站点地图：/sitemap-index.xml
 *
 * 为什么不用 @astrojs/sitemap？
 * 该集成在构建的较晚阶段才把文件写进 dist/，而 @edgeone/astro 适配器
 * 在此之前已把静态资源复制到 .edgeone/assets，结果 sitemap 只留在 dist 里，
 * 部署产物（.edgeone）中缺失，线上会 404。
 * 这里改用 Astro 自身的端点，让 sitemap 参与正常的预渲染流程，确保一定被部署。
 */
import type { APIContext } from 'astro';
import { getSortedPosts, collectTags } from '../utils/posts';

/** 把 URL 片段安全地编码（保留斜杠） */
function encodePath(p: string): string {
  return p
    .split('/')
    .map((seg) => encodeURIComponent(seg))
    .join('/');
}

export async function GET(context: APIContext) {
  const site = (context.site ?? new URL('https://example.com')).href.replace(/\/$/, '');
  const posts = await getSortedPosts();
  const tags = collectTags(posts);

  /** 静态页面 */
  const staticPaths = ['/', '/archive/', '/tags/', '/about/'];
  /** 分页 */
  const pageCount = Math.max(1, Math.ceil(posts.length / 6));
  const pagePaths = Array.from({ length: pageCount - 1 }, (_, i) => `/page/${i + 2}/`);

  const urls: { loc: string; lastmod?: string; priority: string }[] = [
    ...staticPaths.map((p) => ({ loc: `${site}${p}`, priority: p === '/' ? '1.0' : '0.6' })),
    ...posts.map((post) => ({
      loc: `${site}/blog/${encodePath(post.id)}/`,
      lastmod: (post.data.updatedDate ?? post.data.pubDate).toISOString(),
      priority: '0.8',
    })),
    ...tags.map(({ tag }) => ({
      loc: `${site}/tags/${encodeURIComponent(tag)}/`,
      priority: '0.4',
    })),
    ...pagePaths.map((p) => ({ loc: `${site}${p}`, priority: '0.3' })),
  ];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls
  .map(
    (u) =>
      `  <url><loc>${u.loc}</loc>${u.lastmod ? `<lastmod>${u.lastmod}</lastmod>` : ''}<priority>${u.priority}</priority></url>`
  )
  .join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: {
      'content-type': 'application/xml; charset=utf-8',
    },
  });
}
