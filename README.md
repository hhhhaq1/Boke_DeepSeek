# DeepWork — Astro 个人博客

一个可直接部署到 **腾讯云 EdgeOne Pages** 的静态个人博客，支持后续持续更新与访客评论。

技术组合：**Astro 6（静态站点生成器）+ EdgeOne Pages（国内托管）+ 已备案域名**。

---

## 目录

- [部署上线（手把手）](#部署上线手把手)
- [环境要求](#环境要求)
- [本地开发](#本地开发)
- [写一篇新文章](#写一篇新文章)
- [个性化配置](#个性化配置)
- [评论系统](#评论系统)
- [部署到 EdgeOne Pages](#部署到-edgeone-pages)
- [绑定已备案域名](#绑定已备案域名)
- [日常更新流程](#日常更新流程)
- [项目结构](#项目结构)
- [常见问题](#常见问题)

---

## 部署上线（手把手）

> 💡 **没有域名也能先上线。** EdgeOne Pages 会给每个项目一个免费临时域名
> （形如 `xxx.edgeone.app`），**不需要备案**即可访问。
> 备案只影响「绑定自己的域名」这一步，可以晚点再做。
>
> 推荐顺序：**先买域名并提交备案 → 同时用临时域名把网站部署上线**，两件事并行。

### 第 0 步：准备工作（约 10 分钟）

| 需要 | 说明 |
| --- | --- |
| **Git** | 本机安装：<https://git-scm.com/download/win> （一路下一步即可） |
| **GitHub 账号** | 免费注册：<https://github.com/signup> |
| **腾讯云账号** | 用于 EdgeOne Pages，可用微信登录 |

### 第 1 步：把项目推送到 GitHub

在项目根目录 `D:\DeepWork` 打开终端（PowerShell），依次执行：

```bash
# 初始化仓库（只需一次）
git init
git add .
git commit -m "feat: 初始化博客"

# 关联你在 GitHub 上新建的空仓库（把 URL 换成你自己的）
git branch -M main
git remote add origin https://github.com/你的用户名/你的仓库名.git

# 推送
git push -u origin main
```

> 在 GitHub 网页点 **New repository** 建一个空仓库（**不要**勾选 README / .gitignore，
> 否则会和本地冲突）。仓库设为 Public 或 Private 都可以。

### 第 2 步：在 EdgeOne Pages 导入仓库

1. 打开 <https://console.cloud.tencent.com/edgeone/pages>
2. 点击 **创建项目** → 选择 **导入 Git 仓库**
3. 首次使用需授权 EdgeOne 访问你的 GitHub，按提示完成授权
4. 选中刚才推送的仓库

### 第 3 步：确认构建配置

平台通常会自动识别为 Astro 项目。**若需要手动填写，按下表填**：

| 配置项 | 值 |
| --- | --- |
| 框架预设 | `Astro` |
| 安装命令 | `npm install` |
| 构建命令 | `npm run build` |
| **输出目录** | **`.edgeone`** |
| Node 版本 | `22.11.0` |

> ⚠️ **输出目录必须是 `.edgeone`**（不是 Astro 默认的 `dist`）。
> 这是 EdgeOne 适配器约定的目录，填错会导致部署后页面 404。
>
> 这些值已写在项目根目录的 `edgeone.json` 里，平台会优先读取它，一般无需手填。

### 第 4 步：点击部署

等待 1~3 分钟构建完成，即可获得一个 `xxx.edgeone.app` 的临时域名，**立刻就能访问**。

### 第 5 步：测试

打开临时域名，确认：

- [ ] 首页能看到文章列表
- [ ] 点进文章能正常阅读
- [ ] 右上角能切换深色模式
- [ ] `/archive/`、`/tags/`、`/about/` 都能打开
- [ ] 手机浏览器打开，布局正常

### 第 6 步（可选，等备案完成后）：绑定自己的域名

见下方 [绑定已备案域名](#绑定已备案域名)。

绑定后记得把站点地址同步过去：

- **推荐**：在 EdgeOne 控制台 → 项目设置 → 环境变量，添加 `SITE_URL = https://你的域名`，然后重新部署
- **或者**：修改 `astro.config.mjs` 里的 `SITE` 常量

`robots.txt` 和 `sitemap` 会自动跟随这个地址，**不需要手动改**。

---

## 环境要求

| 项目 | 版本 | 说明 |
| --- | --- | --- |
| Node.js | **≥ 22.12.0** | Astro 6 的要求；EdgeOne 构建环境为 Node 22 |
| 包管理器 | npm / pnpm 均可 | 仓库内两者都能跑通 |


> ⚠️ **关于 Astro 版本的重要说明**
> 本项目锁定在 **Astro 6.x**，而不是最新的 7.x。
> 原因是腾讯官方的 EdgeOne 适配器 `@edgeone/astro`（当前 1.1.5）声明的 peer 依赖是 `astro: ^5.0.0 || ^6.0.0`，**尚未支持 Astro 7**。
> 强行升级到 Astro 7 可能导致部署构建失败。等官方适配器跟进后再升级。

## 本地开发

```bash
# 安装依赖
npm install

# 启动开发服务器（默认 http://localhost:4321）
npm run dev

# 构建静态产物到 .edgeone/
npm run build

# 本地预览构建产物（http://localhost:4321）
npm run preview
```

其他可用脚本：

```bash
npm run check      # Astro 类型检查
npm run verify     # 校验构建产物的站内链接与关键文件（需先 build）
npm run test:fn    # 自测自建评论的边缘函数逻辑
```

## 写一篇新文章

在 `src/content/blog/` 下新建一个 `.md` 文件即可，**文件名就是网址**。

```markdown
---
title: 我的第一篇文章
description: 一句话摘要，会显示在文章列表和搜索结果里
pubDate: 2026-03-01
author: 站长
tags: ['随笔', '技术']
comments: true
---

正文从这里开始，用标准 Markdown 书写。
```

### frontmatter 字段

| 字段 | 必填 | 类型 | 说明 |
| --- | --- | --- | --- |
| `title` | ✅ | string | 标题，最长 120 字 |
| `description` | ✅ | string | 摘要，最长 300 字 |
| `pubDate` | ✅ | date | 发布日期，`YYYY-MM-DD` |
| `updatedDate` | | date | 最后更新日期 |
| `author` | | string | 作者，默认「站长」 |
| `tags` | | string[] | 标签数组 |
| `cover` | | string | 封面图路径 |
| `draft` | | boolean | 设为 `true` 则**生产构建时隐藏**（本地预览仍可见） |
| `comments` | | boolean | 是否开启评论区，默认 `true` |

字段填错（比如日期格式不对）会在**构建时直接报错**，不会静默显示成 `undefined`。

### 新增文章后会自动更新

- 首页列表与分页
- `/archive` 归档页（按年份分组）
- `/tags` 标签页与各标签详情页
- `/rss.xml` 订阅源
- `/sitemap-index.xml` 站点地图

**这些都不需要改代码。**

## 个性化配置

绝大多数站点级文案集中在 **`src/config.ts`**：

```ts
export const SITE = {
  title: 'DeepWork',                    // 站点名（页头、页脚、RSS）
  heading: 'DeepWork',                  // 首页大标题
  description: '记录技术、思考与生活的地方。',  // 站点描述 / SEO
  author: '站长',                        // 作者署名
  since: 2026,                          // 页脚版权起始年份
  pageSize: 6,                          // 每页文章数
  nav: [ /* 导航栏 */ ],
  social: {
    github: '',                         // 填上就显示，留空则隐藏
    email: '',
    rss: '/rss.xml',
  },
  comments: { /* 见下一节 */ },
};
```

**另外需要设置站点地址（二选一）：**

**方式一（推荐）** —— 在 EdgeOne 控制台 → 项目设置 → 环境变量中添加：

```
SITE_URL = https://你的域名
```

改完重新部署即可。**不用改代码**，适合以后换域名。

**方式二** —— 直接改 `astro.config.mjs` 里的 `SITE` 常量：

```js
const SITE = process.env.SITE_URL || 'https://your-domain.com';
```

它决定 canonical、sitemap、RSS 和 `robots.txt` 里的绝对地址。
**`robots.txt` 和 `sitemap` 会自动跟随，无需单独修改。**

> 还没有域名时保持默认（`https://example.com`）也能正常部署，
> 只是 SEO 元信息里的地址不是你的正式域名。等域名就绪再设置即可。

## 评论系统

支持两种方案，通过 `src/config.ts` 里的一个字段切换：

```ts
comments: {
  mode: 'giscus',   // 'giscus' | 'self' | 'none'
}
```

### 方案 A：Giscus（默认，零后端）

评论存在 **GitHub Discussions**，无需任何后端或数据库。

1. 在 GitHub 建一个 **public** 仓库，并开启 Discussions 功能
2. 安装 [giscus App](https://github.com/apps/giscus) 到该仓库
3. 打开 [giscus.app/zh-CN](https://giscus.app/zh-CN)，填入仓库名，页面会生成配置
4. 把生成的四项回填到 `src/config.ts`：

```ts
comments: {
  mode: 'giscus',
  giscus: {
    repo: 'yourname/yourrepo',        // 仓库全名
    repoId: 'R_kgDOxxxxxxx',          // 由 giscus.app 生成
    category: 'Announcements',        // Discussions 分类名
    categoryId: 'DIC_kwDOxxxxxxxx',   // 由 giscus.app 生成
    mapping: 'pathname',
    lang: 'zh-CN',
  },
}
```

未填写时，文章页会显示一段**明确的配置提示**，而不是空白或报错。

**优点**：零维护、自带反垃圾（需 GitHub 登录）、数据在你自己仓库。
**注意**：读者需要 GitHub 账号，且国内访问 github.com 的稳定性一般。

### 方案 B：自建边缘函数 + KV（国内访问快、无登录门槛）

评论存在 EdgeOne 的 KV 存储里，通过边缘函数提供 API。

#### 1. 切换到 self 模式

```ts
comments: { mode: 'self' }
```

#### 2. 开通 KV 并创建命名空间

在 EdgeOne Pages 控制台进入 **存储 → KV**：

1. 点击「立即申请」开通 KV 账号（免费版 1GB）
2. 创建一个命名空间，例如 `blog-comments`

#### 3. 把命名空间绑定到项目

在项目详情页找到 **KV 存储 → 绑定命名空间**，选择刚创建的命名空间。

> ⚠️ **绑定时填写的「变量名」必须是 `comments_kv`**（与 `functions/api/comments.js` 里的 `KV_BINDING` 保持一致）。
> 如果你用了别的名字，请同步修改该文件里的 `KV_BINDING` 常量。

#### 4. 部署

提交代码后 EdgeOne 会自动部署，`functions/api/comments.js` 会被识别为边缘函数，路由为 `/api/comments`。

> 本地 `npm run dev` 时边缘函数**不会运行**，评论区会提示「评论加载失败」，这是正常的。
> 前端逻辑可用 `npm run test:fn` 单独验证（用内存 KV 模拟运行时）。

#### 已内置的基础防护

| 防护 | 说明 |
| --- | --- |
| 长度限制 | 昵称 ≤ 40 字，内容 ≤ 2000 字（超出截断） |
| 控制字符清理 | 移除不可见字符，防止绕过 |
| 同源校验 | 拒绝来自其他站点的提交（403） |
| 蜜罐字段 | 隐藏的 `website` 字段被填写即判定为机器人 |
| 频率限制 | 同一 IP 15 秒内只能提交一次（429） |

> 这些能挡住绝大多数脚本刷评论，但**挡不住人工灌水**。若被盯上，最省事的做法是先切回 `mode: 'giscus'`。

#### 数据存储结构

```
c:<slug>   -> [{ id, author, content, createdAt }, ...]   每篇文章的评论数组
rl:<ip>    -> 上次提交时间戳                                用于频率限制
```

单篇文章最多保留 500 条评论，防止 KV 单值过大。

### 方案 C：关闭评论

```ts
comments: { mode: 'none' }
```

## 部署到 EdgeOne Pages

### 方式一：连接 Git 仓库（推荐，可自动部署）

1. 把项目推送到 GitHub / GitLab / Gitee
2. 登录 [EdgeOne Pages 控制台](https://console.cloud.tencent.com/edgeone/pages)，选择「导入 Git 仓库」
3. 选择你的仓库，构建配置**通常会被自动识别**。若需手填：

   | 配置项 | 值 |
   | --- | --- |
   | 框架预设 | Astro |
   | 构建命令 | `npm run build` |
   | 安装命令 | `npm install` |
   | 输出目录 | `.edgeone` |
   | Node 版本 | `22.11.0` |

   这些同样写在项目根目录的 **`edgeone.json`** 中，控制台会读取它作为默认值。

4. 点击部署，等待构建完成即可获得一个 `*.edgeone.app` 的临时域名

之后每次 `git push` 都会自动重新构建并发布。

### 方式二：CLI 部署

```bash
npm i -g edgeone
edgeone login
edgeone makers deploy
```

> EdgeOne CLI 版本需 **≥ 1.2.4**。CLI 会先自动构建项目，再上传 `.edgeone` 目录。

### 关于输出目录 `.edgeone`

`@edgeone/astro` 适配器会把构建产物整理到 `.edgeone/`（而不是 Astro 默认的 `dist/`）。
它包含静态资源与边缘函数入口，**部署时必须指向这个目录**。

## 绑定已备案域名

> 🇨🇳 国内托管平台绑定自定义域名，域名**必须完成 ICP 备案**，否则会被拦截。

1. **完成备案** —— 在域名服务商（腾讯云 / 阿里云等）提交 ICP 备案，通常需 1–20 个工作日。备案是针对**域名**的，换托管平台无需重新备案。

2. **添加自定义域名** —— EdgeOne Pages 控制台 → 你的项目 → **域名管理** → 添加自定义域名，填写你的域名（如 `blog.example.com`）。

3. **配置 DNS** —— 到域名解析服务商处，按控制台提示添加 **CNAME 记录**，指向 EdgeOne 提供的目标地址。

4. **等待证书签发** —— 平台会**自动申请并部署免费 HTTPS 证书**，通常几分钟内完成，期间状态会显示「部署中」。

5. **更新站点地址** —— 在 EdgeOne 控制台添加环境变量 `SITE_URL = https://你的域名`，然后重新部署。
   sitemap / canonical / RSS / robots.txt 会自动使用新地址。

> 💡 **还没有域名？** 完全不影响部署。先用平台分配的 `xxx.edgeone.app` 临时域名，
> 等域名买好、备案通过后再回来做这几步。备案期间网站可正常访问和更新。

## 日常更新流程

```bash
# 1. 写新文章
#    新建 src/content/blog/my-new-post.md

# 2. 本地预览
npm run dev

# 3. 提交并推送（自动触发 EdgeOne 构建）
git add .
git commit -m "post: 新增文章 my-new-post"
git push
```

推送后 EdgeOne 会自动构建并发布，通常 1–2 分钟生效。

## 项目结构

```
.
├── astro.config.mjs           # Astro 配置（⚠️ 修改 site 为你的域名）
├── edgeone.json               # EdgeOne 构建配置（构建命令 / 输出目录 / Node 版本）
├── pnpm-workspace.yaml        # pnpm 的构建脚本放行配置（esbuild / sharp）
├── functions/
│   └── api/
│       └── comments.js        # 自建评论 API（EdgeOne 边缘函数）
├── public/                    # 静态资源，原样复制到产物根目录
│   ├── favicon.svg
│   └── og-default.svg
├── scripts/
│   ├── serve.mjs              # 本地预览构建产物
│   ├── verify-build.mjs       # 校验产物站内链接
│   ├── smoke-test.mjs         # 页面渲染验收
│   ├── test-comments-fn.mjs   # 边缘函数逻辑自测
│   ├── test-ratelimit.mjs     # 限流专项测试
│   ├── shoot.mjs              # 截图（明暗主题）
│   └── shoot-mobile.mjs       # 截图（响应式）
├── src/
│   ├── config.ts              # ⭐ 站点配置（文案 / 导航 / 评论开关）
│   ├── content.config.ts      # 内容集合的 Zod schema
│   ├── content/
│   │   └── blog/              # ⭐ 文章都放这里（Markdown）
│   ├── components/            # Header / Footer / PostCard / Pagination / Comments
│   ├── layouts/
│   │   └── BaseLayout.astro   # 页面骨架、SEO meta、主题初始化
│   ├── pages/
│   │   ├── index.astro            # 首页（含分页第 1 页）
│   │   ├── page/[page].astro      # 分页 2..N
│   │   ├── blog/[slug].astro      # 文章详情
│   │   ├── archive.astro          # 归档
│   │   ├── tags/index.astro       # 标签云
│   │   ├── tags/[tag].astro       # 单标签文章列表
│   │   ├── about.astro            # 关于
│   │   ├── 404.astro              # 404 页面
│   │   ├── rss.xml.ts             # RSS 订阅源
│   │   ├── robots.txt.ts          # robots.txt（地址自动跟随 site）
│   │   └── sitemap-index.xml.ts   # 站点地图
│   ├── scripts/
│   │   └── comments.ts        # 自建评论的前端逻辑
│   ├── styles/
│   │   └── global.css         # 全局样式与设计令牌（含深色模式）
│   └── utils/
│       └── posts.ts           # 文章排序 / 标签 / 归档 / 分页工具
└── package.json
```

## 常见问题

### 为什么不用 `@astrojs/sitemap`？

该集成在构建的**较晚阶段**才把 sitemap 写入 `dist/`，而此时 `@edgeone/astro` 已经把静态资源复制进了 `.edgeone/assets`。
结果就是 sitemap **只存在于 `dist/`，不会进入实际部署产物**，线上访问 `/sitemap-index.xml` 会 404。

因此本项目改用 `src/pages/sitemap-index.xml.ts` 自行生成，让它参与正常的预渲染流程，确保一定被部署。

### 本地开发时评论区报错 / 一直显示「正在加载评论…」

使用 `mode: 'self'` 时，边缘函数**只在 EdgeOne 运行时执行**，本地 `astro dev` 不存在 `/api/comments`，属于正常现象。
部署后即可正常工作。前端逻辑可用 `npm run test:fn` 验证。

### 构建报 `ERR_PNPM_IGNORED_BUILDS`（esbuild / sharp）

`esbuild` 和 `sharp` 需要在安装后执行脚本下载平台二进制。项目已在 `pnpm-workspace.yaml` 里放行：

```yaml
allowBuilds:
  esbuild: true
  sharp: true
```

若你用的是 npm，一般不会遇到该问题。

### 部署后样式丢失或 404

确认控制台的**输出目录填的是 `.edgeone`**（不是 `dist`）。这是 EdgeOne 适配器约定的目录。

### 深色模式闪烁（首屏白闪）

已在 `BaseLayout.astro` 的 `<head>` 中用内联脚本**在首帧之前**读取 `localStorage` 并设置 `data-theme`，避免闪烁。该脚本必须保持内联（使用 `is:inline`），不要改成外部文件。

### 想换评论方案要改哪些地方？

只改 `src/config.ts` 里的 `comments.mode` 一个字段，然后重新构建。两种实现都已就绪。

---

## 许可

代码可自由使用与修改。文章内容版权归作者所有。
