import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';
import { SITE } from './config';

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
    author: z.string().default(SITE.author),
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

/**
 * 说说集合（朋友圈式的短内容）
 * 新增一条：在 src/content/notes/ 下新建 .md 文件即可，无需改动任何代码。
 */
const notes = defineCollection({
  loader: glob({ pattern: '**/*.{md,mdx}', base: './src/content/notes' }),
  schema: z.object({
    /** 发布时刻，带时间更贴合短内容的语境 */
    pubDate: z.coerce.date(),
    /**
     * 分类，一条说说只属于一个分类。
     * 可选项在 src/config.ts 的 NOTE_CATEGORIES 里登记（喝酒 / 读书 / 旅行 / 杂项），
     * 不填默认归到「杂项」。写没登记过的分类也能用，只是颜色是默认灰。
     */
    category: z.string().max(12).default('杂项'),
    /** 作者，不填就用 src/config.ts 里的 SITE.author */
    author: z.string().default(SITE.author),
    /**
     * 头像图片路径，例如 /images/avatar/me.webp（放在 public/ 下）。
     * 不填就用作者名首字生成圆形色块。
     */
    avatar: z.string().optional(),
    /** 地点，可选，例如「杭州 · 西湖」 */
    location: z.string().max(60).optional(),
    /** 心情，一个 emoji，可选 */
    mood: z.string().max(8).optional(),
    /**
     * 配图。放在 public/images/notes/ 下，这里写 /images/notes/xxx.jpg
     * 数量决定布局：1 张大图、2 张两列、3 张三列、4 张 2×2、5–9 张三列正方形
     */
    images: z.array(z.string()).default([]),
    tags: z.array(z.string()).default([]),
    /** 置顶，会排在最前面 */
    pinned: z.boolean().default(false),
    draft: z.boolean().default(false),
  }),
});

export const collections = { blog, notes };
