/**
 * 站点级配置：改这里就能换掉全站文案，不必翻模板。
 */
export const SITE = {
  title: 'DeepWork',
  /** 首页大标题 */
  heading: 'DeepWork',
  description: '记录技术、思考与生活的地方。',
  author: '站长',
  /** 页脚版权起始年份 */
  since: 2026,
  /** 每页文章数 */
  pageSize: 6,
  /** 导航栏；如需增删改这里即可 */
  nav: [
    { text: '首页', href: '/' },
    { text: '归档', href: '/archive' },
    { text: '标签', href: '/tags' },
    { text: '关于', href: '/about' },
  ],
  /** 社交链接，留空则不显示 */
  social: {
    github: '',   // 例: 'https://github.com/yourname'
    email: '',    // 例: 'you@example.com'
    rss: '/rss.xml',
  },
  /**
   * 评论系统开关
   * - 'giscus'  : GitHub Discussions，零后端（默认）
   * - 'self'    : 自建 EdgeOne 边缘函数 + KV，国内访问快
   * - 'none'    : 关闭评论
   */
  comments: {
    mode: 'giscus',
    giscus: {
      repo: '',            // 'yourname/yourrepo'
      repoId: '',
      category: 'Announcements',
      categoryId: '',
      mapping: 'pathname',
      lang: 'zh-CN',
      reactionsEnabled: '1',
      inputPosition: 'top',
      loading: 'lazy',
    },
  },
} as const;

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 把标题转成可用于锚点的 slug */
export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[\s]+/g, '-')
    .replace(/[^\w\u4e00-\u9fa5-]/g, '');
}

/** 估算中文友好的阅读时长（分钟） */
export function readingTime(body: string): number {
  const chars = body.replace(/\s/g, '').length;
  return Math.max(1, Math.round(chars / 400));
}
