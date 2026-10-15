---
title: 用 Astro 搭建静态博客：从选型到部署
description: 记录一次完整的建站过程，包括为什么选 Astro、内容集合怎么用、以及如何部署到 EdgeOne Pages 并绑定已备案域名。
pubDate: 2026-01-15
author: 站长
tags: ['Astro', '建站', '部署']
comments: true
---

这篇文章记录本站的搭建过程，重点说清楚**为什么这么选**，而不只是**怎么做**。

## 选型的三个约束

开始之前先明确约束，选型才有依据：

1. **要好维护**——没有服务器、没有数据库要管
2. **国内要能快速访问**——目标读者主要在国内
3. **要能长期存活**——内容不能被某个平台的存亡绑定

这三条基本排除了动态博客（要维护服务器）和纯 SaaS 写作平台（内容被平台绑死）。

## 为什么是 Astro

静态站点生成器（SSG）不少，Hugo、Hexo、Eleventy 都能用。选 Astro 主要看中三点：

### 默认零 JavaScript

Astro 会把页面渲染成纯 HTML，**默认不给客户端发送任何 JS**。对于以阅读为主的博客，这是最理想的形态——首屏快，也不会有 hydration 带来的各种问题。

需要交互的地方（比如评论区），再单独引入脚本即可。

### 内容集合带类型校验

`src/content.config.ts` 里用 Zod 定义 frontmatter 的结构：

```ts
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: z.object({
    title: z.string().max(120),
    description: z.string().max(300),
    pubDate: z.coerce.date(),
    tags: z.array(z.string()).default([]),
  }),
});
```

写了不合规的 frontmatter，构建时就会直接报错，而不是等到页面上显示成 `undefined`。

### 迁移成本低

内容就是 Markdown 文件。哪天想换框架，正文一个字都不用改。

## 内容组织

文章放在 `src/content/blog/`，**文件名即路径**：

```
src/content/blog/
├── hello-world.md        ->  /blog/hello-world/
└── astro-blog-guide.md   ->  /blog/astro-blog-guide/
```

取文章列表用 `getCollection`：

```astro
---
import { getCollection } from 'astro:content';

const posts = (await getCollection('blog', ({ data }) => !data.draft))
  .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
---
```

新增文章不需要改任何代码，构建时自动进列表、归档、标签页和 RSS。

## 部署到 EdgeOne Pages

把代码推到 GitHub，然后在 EdgeOne Pages 控制台导入仓库即可。关键配置：

| 配置项 | 值 |
| --- | --- |
| 构建命令 | `npm run build` |
| 输出目录 | `.edgeone` |
| Node 版本 | 22.11.0 |

这些已经写在项目根目录的 `edgeone.json` 里，控制台会自动读取，一般不用手填。

### 关于版本的一个坑

搭建时 Astro 的最新版是 7.x，但腾讯官方的 `@edgeone/astro` 适配器**只声明支持 Astro 5 和 6**。所以这里把 Astro 锁在了 6.x：

```json
{
  "dependencies": {
    "astro": "^6.4.8",
    "@edgeone/astro": "^1.1.5"
  }
}
```

选型时**先看托管平台支持什么，再决定框架用哪个版本**，比反过来省事得多。

## 绑定已备案域名

国内托管平台绑定自定义域名，域名必须已完成 ICP 备案，否则会被拦截。流程大致是：

1. 在域名服务商处完成备案（通常需要 1–20 个工作日）
2. EdgeOne 控制台 → 项目 → 域名管理 → 添加自定义域名
3. 按提示到 DNS 服务商添加 CNAME 记录
4. 等待证书签发（免费证书自动申请）

备案是针对**域名**的，换托管平台不用重新备案，只要接入商信息一致即可。

## 后续更新

日常写作流程就三步：

```bash
# 1. 写新文章
vim src/content/blog/new-post.md

# 2. 本地预览
npm run dev

# 3. 提交，自动部署
git add . && git commit -m "post: new post" && git push
```

推上去之后 EdgeOne 会自动重新构建并发布，通常一两分钟就能看到新内容。

## 小结

静态博客的核心优势是**简单**：没有运行时、没有数据库、没有需要打补丁的服务器。把复杂度降到最低，才能把精力留给写作本身。
