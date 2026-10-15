import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * 博客文章集合
 * 新增文章：在 src/content/blog/ 下新建 .md 文件即可，无需改动任何代码。
 */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),
    /** 发布日期 */
    pubDate: z.coerce.date(),
    /** 最后更新日期，可选 */
    updatedDate: z.coerce.date().optional(),
    /** 作者 */
    author: z.string().default('站长'),
    /** 标签 */
    tags: z.array(z.string()).default([]),
    /** 封面图（public/ 或外链） */
    cover: z.string().optional(),
    /** 摘要是否隐藏 */
    draft: z.boolean().default(false),
    /** 是否开启评论区 */
    comments: z.boolean().default(true),
  }),
});

export const collections = { blog };
