/**
 * RSS 订阅源：/rss.xml
 *
 * 注意：这是 API 端点（.ts），不是 Astro 组件，因此不能写 `---` frontmatter 分隔符。
 */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../config';
import { getSortedPosts } from '../utils/posts';

export async function GET(context: APIContext) {
  const posts = await getSortedPosts();

  return rss({
    title: SITE.title,
    description: SITE.description,
    site: context.site ?? 'https://example.com',
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
      author: post.data.author,
    })),
    customData: '<language>zh-CN</language>',
  });
}
