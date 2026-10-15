// @ts-check
import { defineConfig } from 'astro/config';
import edgeone from '@edgeone/astro';

/**
 * 站点全局配置
 * ------------------------------------------------------------------
 * `site` 决定 canonical、sitemap、RSS 里使用的绝对地址。
 *
 * 取值优先级：
 *   1. 环境变量 SITE_URL（在 EdgeOne 控制台或 .env 里配置，无需改代码）
 *   2. 下面的 SITE 常量
 *
 * 你还没有域名时：保持现状即可，先用 EdgeOne 分配的临时域名访问。
 * 域名备案通过后：把 SITE 改成正式域名（必须带 https://），或在
 * EdgeOne 控制台加一个 SITE_URL 环境变量，然后重新部署。
 */
const SITE = process.env.SITE_URL || 'https://example.com';

export default defineConfig({
  site: SITE,

  // 'static' = 纯静态输出（推荐，最省心、最快）。
  // 如需自建评论 API（EdgeOne 边缘函数），本文件中的 output 不需要改成 'server'，
  // 边缘函数会以独立方式随项目一起部署，详见 README 的「评论系统」章节。
  output: 'static',

  adapter: edgeone(),

  // 注意：这里没有使用 @astrojs/sitemap。
  // 该集成在构建较晚阶段才写入 dist/，而 @edgeone/astro 早已把静态资源
  // 复制到 .edgeone/assets，导致 sitemap 不会进入部署产物。
  // 因此改由 src/pages/sitemap-index.xml.ts 自行生成，确保随预渲染一起输出。

  markdown: {
    shikiConfig: {
      themes: { light: 'github-light', dark: 'github-dark' },
      wrap: true,
    },
  },

  build: {
    // 生成 /about/index.html 这类整洁 URL
    format: 'directory',
  },

  devToolbar: {
    enabled: false,
  },
});
