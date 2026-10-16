/**
 * 文章读取与排序的公共逻辑，避免各页面重复实现。
 */
import { getCollection, type CollectionEntry } from 'astro:content';

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
