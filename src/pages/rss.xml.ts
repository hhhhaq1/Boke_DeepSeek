/**
 * RSS 订阅源：/rss.xml
 *
 * 同时收录文章和说说，按发布时间倒序混排。
 * 说说的更新频率比文章高，把它排除在外会让订阅者错过日常更新。
 *
 * 注意：这是 API 端点（.ts），不是 Astro 组件，因此不能写 `---` frontmatter 分隔符。
 */
import rss from '@astrojs/rss';
import type { APIContext } from 'astro';
import { SITE } from '../config';
import { getSortedPosts } from '../utils/posts';
import { getSortedNotes } from '../utils/notes';

/** 取正文纯文本作为 RSS 描述（说说没有 description 字段） */
function excerpt(body: string | undefined, max = 120): string {
  const text = (body ?? '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*_`>#~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export async function GET(context: APIContext) {
  const site = context.site ?? 'https://example.com';

  const [posts, notes] = await Promise.all([getSortedPosts(), getSortedNotes()]);

  const items = [
    ...posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
      categories: post.data.tags,
      author: post.data.author,
    })),
    ...notes.map((note) => ({
      // 用「说说」前缀，让订阅者一眼分出长短内容
      title: `说说 · ${note.id}`,
      description: excerpt(note.body) || '一张图，几句话。',
      pubDate: note.data.pubDate,
      link: `/notes/${note.id}/`,
      categories: [note.data.category],
      author: note.data.author,
    })),
  ]
    // 时间倒序，新的在前
    .sort((a, b) => b.pubDate.valueOf() - a.pubDate.valueOf())
    // 订阅源只保留最近 50 条，避免文件无限增长
    .slice(0, 50);

  return rss({
    title: SITE.title,
    description: SITE.description,
    site,
    items,
    customData: '<language>zh-CN</language>',
  });
}
