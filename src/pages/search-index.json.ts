/**
 * 搜索索引：/search-index.json
 *
 * 静态站没有后端，所以索引在**构建时**生成，浏览器只在用户第一次输入时拉一次。
 * 这样既能把正文也纳入搜索，又不会把几千字塞进 HTML 里拖慢首屏。
 *
 * 注意：这是 API 端点（.ts），不是 Astro 组件，因此不能写 `---` frontmatter 分隔符。
 */
import type { APIContext } from 'astro';
import { getSortedPosts } from '../utils/posts';

/** 把 markdown 压成纯文本，只用于匹配，不用于展示 */
function toPlainText(markdown: string): string {
  return markdown
    .replace(/```[\s\S]*?```/g, ' ') // 代码块
    .replace(/`[^`]*`/g, ' ') // 行内代码
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ') // 图片
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // 链接保留文字
    .replace(/^\s{0,3}#{1,6}\s+/gm, ' ') // 标题记号
    .replace(/^\s{0,3}>\s?/gm, ' ') // 引用记号
    .replace(/^\s{0,3}[-*+]\s+/gm, ' ') // 列表记号
    .replace(/[*_~]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export async function GET(_context: APIContext) {
  const posts = await getSortedPosts();

  const index = posts.map((post) => ({
    id: post.id,
    title: post.data.title,
    description: post.data.description,
    tags: post.data.tags,
    /** 正文压平后截断，够搜到即可 */
    text: toPlainText(post.body ?? '').slice(0, 1500),
  }));

  return new Response(JSON.stringify(index), {
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'public, max-age=3600',
    },
  });
}
