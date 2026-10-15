/**
 * robots.txt：/robots.txt
 *
 * 为什么不放 public/robots.txt？
 * 静态文件无法读取构建时的站点地址，换了域名就得手动改一遍。
 * 这里改为动态生成，Sitemap 地址自动跟随 astro.config.mjs 的 site，
 * 换域名时无需再手动同步。
 */
import type { APIContext } from 'astro';

export async function GET(context: APIContext) {
  const site = (context.site ?? new URL('https://example.com')).href.replace(/\/$/, '');

  const body = `User-agent: *
Allow: /

# 评论 API 不需要被索引
Disallow: /api/

Sitemap: ${site}/sitemap-index.xml
`;

  return new Response(body, {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
}
