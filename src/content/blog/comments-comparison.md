---
title: 静态博客的评论区该怎么选
description: 对比 Giscus 与自建 EdgeOne 边缘函数两种评论方案，说明各自适合的场景、成本与取舍。
pubDate: 2026-02-01
author: 站长
tags: ['评论系统', 'EdgeOne', '建站']
comments: true
---

静态站点没有后端，所以「接受访客评论」这件事通常有两种解法：**接第三方**，或者**自己补一个后端**。

## 先想清楚要什么

评论功能的需求差异很大，先问自己几个问题：

- 读者是谁？**国内读者为主**的话，能访问 GitHub 是前提
- 要不要审核？有没有被垃圾评论轰炸的可能？
- 愿不愿意维护一个存储服务？

不同答案对应不同方案。本站把两种都实现了，用配置切换。

## 方案一：Giscus

原理是把评论存在 **GitHub Discussions** 里，页面通过 iframe 嵌入。

### 优点

- **零成本、零维护**——没有后端、没有数据库
- **自带反垃圾**——必须用 GitHub 账号登录，机器人成本高
- **自带通知**——有人回复会在 GitHub 收到提醒
- **数据在你自己仓库里**，不怕服务商跑路

### 缺点

- 读者要有 GitHub 账号，**门槛较高**
- 国内访问 GitHub 的体验不稳定，评论区可能加载失败或很慢

### 配置

到 [giscus.app](https://giscus.app/zh-CN) 按提示生成配置，把 `repo`、`repoId`、`categoryId` 填进 `src/config.ts`：

```ts
comments: {
  mode: 'giscus',
  giscus: {
    repo: 'yourname/yourrepo',
    repoId: 'R_kgDOxxxxxxx',
    category: 'Announcements',
    categoryId: 'DIC_kwDOxxxxxxxx',
  },
}
```

## 方案二：自建边缘函数 + KV

用 EdgeOne Pages 的**边缘函数**做 API，用 **KV** 存评论。

### 优点

- **完全自控**——数据、审核规则、展示样式全在自己手里
- **国内访问快**——流量不出境，延迟低
- **无登录门槛**——填个昵称就能评论

### 缺点

- 需要开通 KV、绑定命名空间，**多几步配置**
- **自己负责反垃圾**——代码里做了基础防护（频率限制、蜜罐字段、长度限制），但没有验证码
- 有免费额度限制（当前免费版 1GB 存储）

### 数据结构

KV 里以文章为单位聚合存储：

```
key:   c:<slug>          -> [{ id, author, content, createdAt }, ...]
key:   rl:<ip>           -> 上次提交时间戳（用于限流）
```

按文章聚合而不是一评论一键，是为了用一次读操作取回整篇文章的评论，减少 KV 读取次数。

### 基础防护

边缘函数里做了四层过滤：

```js
// 1. 长度截断 + 控制字符清理
const content = sanitize(payload.content, 2000);

// 2. 同源校验
if (new URL(origin).host !== url.host) return forbidden();

// 3. 蜜罐字段（正常用户看不到这个输入框）
if (sanitize(payload.website, 50)) return json({ error: '提交被拒绝' }, 400);

// 4. 同 IP 提交间隔限制
if (elapsed < RATE_LIMIT_MS) return json({ error: '发得太快了' }, 429);
```

这能挡掉绝大多数脚本刷评论，但**挡不住人工灌水**。如果被盯上，最省事的办法是先切成 `mode: 'giscus'`，或者加一个简单的数学验证码。

## 对比

| 维度 | Giscus | 自建 KV |
| --- | --- | --- |
| 维护成本 | 无 | 需配置 KV |
| 读者门槛 | 需 GitHub 账号 | 无 |
| 国内速度 | 一般 | 快 |
| 反垃圾 | 强（登录门槛） | 中（需自己加） |
| 数据归属 | 你的 GitHub 仓库 | 你的 KV |
| 费用 | 免费 | 免费额度内免费 |

## 怎么选

- **读者以国内为主、希望人人能评论** → 自建
- **读者主要是开发者、不想管后端** → Giscus

本站默认用 Giscus（配置最省事），需要时把 `src/config.ts` 里的 `mode` 改成 `'self'` 即可切换，**两种实现都已就绪**：

```ts
comments: {
  mode: 'giscus',  // 改成 'self' 或 'none'
}
```

## 一个务实的建议

评论区的价值在于**反馈质量**，不在于数量。如果一篇文章本来就没多少人看，评论功能带来的更多是垃圾评论的维护负担。

可以先只上 Giscus——它零维护，等你确实需要降低读者门槛时，再切到自建方案。代码已经写好了，切换成本就是一个字符串。
