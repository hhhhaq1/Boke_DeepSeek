/**
 * 文章读取与排序的公共逻辑，避免各页面重复实现。
 */
import { getCollection, type CollectionEntry } from 'astro:content';
import { SITE } from '../config';

export type Post = CollectionEntry<'blog'>;

/**
 * 取全部已发布文章，按发布日期倒序。
 * 开发环境会包含 draft 文章方便预览，生产构建则过滤掉。
 */
export async function getSortedPosts(): Promise<Post[]> {
  const posts = await getCollection('blog', ({ data }) => {
    return import.meta.env.PROD ? !data.draft : true;
  });

  return posts.sort(
    (a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf()
  );
}

/** 统计所有标签及其出现次数，按次数倒序 */
export function collectTags(posts: Post[]): { tag: string; count: number }[] {
  const map = new Map<string, number>();
  for (const post of posts) {
    for (const tag of post.data.tags) {
      map.set(tag, (map.get(tag) ?? 0) + 1);
    }
  }
  return [...map.entries()]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag));
}

/** 按年份分组，用于归档页 */
export function groupByYear(posts: Post[]): { year: number; posts: Post[] }[] {
  const map = new Map<number, Post[]>();
  for (const post of posts) {
    const year = post.data.pubDate.getFullYear();
    const list = map.get(year);
    if (list) list.push(post);
    else map.set(year, [post]);
  }
  return [...map.entries()]
    .map(([year, list]) => ({ year, posts: list }))
    .sort((a, b) => b.year - a.year);
}

/** 计算分页总页数 */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / SITE.pageSize));
}

/** 取第 page 页（从 1 开始）的数据 */
export function paginate<T>(items: T[], page: number, size = SITE.pageSize): T[] {
  const start = (page - 1) * size;
  return items.slice(start, start + size);
}
