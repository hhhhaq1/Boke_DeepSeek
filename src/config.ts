/**
 * 站点级配置：改这里就能换掉全站文案，不必翻模板。
 */
export const SITE = {
  /** 站名：Header 品牌、og:site_name、RSS 标题都用它 */
  title: '渐鸿的个人博客',
  /**
   * 首页大标题（H1）。
   * 和站名保持一致——同一屏出现「Duhui Blog / Blog / 渐鸿.」三个名字
   * 是模板感最重的一处，这里收敛成一个人。
   */
  heading: '渐鸿',
  /** 首页 <title> 用的短标语，拼成「渐鸿 · 记录」 */
  tagline: '记录',
  description: '记录生活还有思想的地方。',
  author: '渐鸿',
  /** 页脚版权起始年份 */
  since: 2026,
  /**
   * 建站日期（完整日期，用于首页「运行 N 天」统计）。
   * 写成 YYYY-MM-DD，统计就会从这天开始算，而不是年初。
   * 例：2026-10-15 建站，则当天显示 1 天，次日 2 天，以此类推。
   */
  foundedAt: '2026-10-15',
  /** 首页「最新文章」显示几条；完整列表在 /posts/ */
  pageSize: 6,
  /** 导航栏；如需增删改这里即可 */
  nav: [
    { text: '首页', href: '/' },
    { text: '文章', href: '/posts' },
    { text: '说说', href: '/notes' },
    { text: '关于', href: '/about' },
  ],
  /** 社交链接，留空则不显示 */
  social: {
    github: 'https://github.com/hhhhaq1',   // 例: 'https://github.com/yourname'
    email: 'q1364825940@163.com',    // 例: 'you@example.com'
    rss: '/rss.xml',
  },
  /**
   * 首页个人名片 + 侧栏「关于我」。
   * 这是整站最像「你」的地方，建议都填上。
   */
  profile: {
    /** 头像：放 public/ 下的图片路径，例如 '/avatar.jpg'。留空则用下面的文字生成圆形色块 */
    avatar: '/head.jpg',
    /** 没有头像图时，圆形色块里显示的字。留空则取站点名首字 */
    avatarText: '',
    /** 站名旁的小状态徽章，留空则不显示 */
    status: '摸鱼中',
    /** 侧栏「关于我」的自我介绍，支持多句 */
    bio: '白天当牛马，抽空写点别的。长文放在文章里，碎片放在说说里。',
    /** 所在地，留空则不显示 */
    location: '北京',
  },
  /**
   * 评论系统开关
   * - 'self'    : 自建 EdgeOne 边缘函数 + KV（当前使用）
   * - 'giscus'  : GitHub Discussions，零后端。注意：要求仓库是**公开**的
   * - 'none'    : 关闭评论
   *
   * 用 'self' 需要在 EdgeOne 控制台把 KV 命名空间绑定为 `comments_kv`，
   * 点赞会复用同一个命名空间（绑定 `likes_kv` 可单独分开）。
   */
  comments: {
    mode: 'self',
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
  /**
   * 点赞开关
   * - 'api'  : 调用自建 EdgeOne 边缘函数 /api/likes，赞数存在 KV 里，全站可见（推荐）
   * - 'none' : 不显示点赞按钮
   *
   * 用 'api' 时需要在 EdgeOne 控制台绑定一个 KV 命名空间。
   * 点赞会优先用名为 `likes_kv` 的绑定；没绑就自动复用评论的 `comments_kv`，
   * 所以**只要评论能跑，点赞不用额外配置**。
   *
   * 注意：边缘函数只在 EdgeOne 运行时存在。本地 `npm run dev` 下
   * /api/likes 是 404，点赞按钮会自动隐藏（不会显示一个点了没反应的按钮）。
   * 逻辑自测：npm run test:fn
   */
  likes: {
    mode: 'api',
  },
  /**
   * 背景音乐：嵌入网易云音乐官方播放器。
   *
   * 为什么用嵌入而不是自己托管 mp3：
   *   自己放音乐文件，一旦放了商业歌曲，版权风险由站主承担；
   *   用官方播放器，音乐经网易云的分发体系提供，版权由平台处理。
   *   代价是样式受限于对方，只能决定宽度/高度。
   *
   * 怎么配置：
   *   1. 打开网易云网页版，进入一个歌单（或单曲）页面
   *   2. 点「分享」→「生成外链播放器」，复制 iframe 的 src
   *   3. 从 src 里取出 type 和 id，填到下面（也可以把整条 src 粘进 embedUrl）
   *
   *   type: 0 = 歌单（推荐，能放多首、可切歌）
   *         2 = 单曲
   *   id  : 歌单/单曲的数字 ID，在页面地址里能找到
   *         歌单 https://music.163.com/playlist?id=3778678  → 3778678
   *         单曲 https://music.163.com/song?id=186016        → 186016
   *
   * enabled 为 false，或没填 id 且没有 embedUrl 时，整块不渲染。
   */
  music: {
    enabled: true,
    /** 'playlist' 歌单 | 'song' 单曲 */
    kind: 'playlist' as 'playlist' | 'song',
    /** 网易云歌单 / 单曲的 ID */
    id: '8466367532',
    /**
     * 可选：直接贴外链播放器完整 src，填了它就以它为准，
     * 上面的 kind / id 会被忽略。适合用了非歌单的场景。
     */
    embedUrl: '',
    /** 面板标题，显示在播放器上方 */
    title: '华语',
  },
} as const;

/**
 * 个性化组件开关。
 * 不想用某个效果就把它设为 false——对应的脚本会直接跳过，
 * 页面上的相关 DOM 也不会渲染。所有效果都不依赖后端。
 */
export const EFFECTS: Record<
  | 'readingProgress'
  | 'tocHighlight'
  | 'lightbox'
  | 'typewriter'
  | 'scrollReveal'
  | 'cursorGlow'
  | 'search'
  | 'noteCategoryFilter',
  boolean
> = {
  /** 文章页顶部阅读进度条 + 右下角带进度环的返回顶部按钮 */
  readingProgress: true,
  /** 文章目录：滚动时自动高亮当前章节，宽屏吸附在正文右侧 */
  tocHighlight: true,
  /** 点击正文图片全屏放大，支持 ESC 关闭、左右键切换 */
  lightbox: true,
  /** 首页 Hero 副标题打字机效果 */
  typewriter: true,
  /** 元素进入视口时上浮淡入 */
  scrollReveal: true,
  /** 光标跟随的柔和光斑（仅桌面端，触屏与减少动效时不启用） */
  cursorGlow: true,
  /** 「文章」页的搜索框：静态站也能搜正文，索引在构建时生成 */
  search: true,
  /** 「说说」页顶部的分类筛选栏（喝酒 / 读书 / 旅行 / 杂项） */
  noteCategoryFilter: true,
};

/**
 * 文章封面的渐变色板。
 * 按标题哈希取一组，所以同一篇文章永远得到同一套颜色，改标题才会变。
 * 想换成自己的照片：在文章 frontmatter 里写 cover: '/images/covers/xxx.jpg' 即可覆盖。
 *
 * 配色原则：只取「靛蓝 → 紫 → 青」这一小段冷色。
 * 之前是 8 组高饱和彩虹色，随机抽到橙色时会和夜间主题的紫青底完全打架；
 * 收敛到主题同色系后，列表整体有秩序，封面仍然每篇不同。
 *
 * 另外每条的两端都压得比较深：封面上压着白色的大号日期，
 * 亮色端（比如 #0ea5e9）配白字的对比度只有 2.6:1，读不清。
 * 现在四组对白字都在 5:1 以上，日期和标题一样能看清。
 */
export const COVER_GRADIENTS: readonly (readonly [string, string])[] = [
  ['#4338ca', '#7c3aed'], // 靛蓝 → 紫
  ['#1d4ed8', '#0369a1'], // 宝蓝 → 深天青
  ['#6d28d9', '#9333ea'], // 紫罗兰 → 紫
  ['#0e7490', '#0f766e'], // 青 → 蓝绿
];

/**
 * 说说分类。
 *
 * - 数组顺序 = 说说页筛选栏的排列顺序
 * - `color` 只用来画分类小圆点和徽章底色，**不当文字颜色用**（这些饱和度当文字对比度不够）
 * - 想加分类就在这里加一行；就算不加，说说里直接写也能用，只是颜色走默认灰
 * - 「杂项」建议放在最后，它是兜底分类
 */
export const NOTE_CATEGORIES: readonly { name: string; color: string }[] = [
  { name: '喝酒', color: '#f59e0b' },
  { name: '读书', color: '#8b5cf6' },
  { name: '旅行', color: '#0ea5e9' },
  { name: '杂项', color: '#94a3b8' },
];

/** 没在 NOTE_CATEGORIES 里登记过的分类用它 */
export const CATEGORY_FALLBACK_COLOR = '#94a3b8';

/** 取分类对应的颜色 */
export function categoryColor(name: string): string {
  return NOTE_CATEGORIES.find((c) => c.name === name)?.color ?? CATEGORY_FALLBACK_COLOR;
}

/** 分类排序权重：登记过的按登记顺序，没登记的排在最后 */
export function categoryOrder(name: string): number {
  const i = NOTE_CATEGORIES.findIndex((c) => c.name === name);
  return i === -1 ? NOTE_CATEGORIES.length : i;
}

/** djb2 字符串哈希，够稳定也够快 */
function hashCode(text: string): number {
  let h = 5381;
  for (let i = 0; i < text.length; i++) {
    h = ((h << 5) + h + text.charCodeAt(i)) >>> 0;
  }
  return h;
}

/** 由标题（或任意种子）取一组封面渐变色 */
export function coverGradient(seed: string): { from: string; to: string } {
  const [from, to] = COVER_GRADIENTS[hashCode(seed) % COVER_GRADIENTS.length];
  return { from, to };
}

/**
 * 给一整列文章分配封面渐变。
 * 单篇用哈希是稳定的（改标题才换色），但两篇撞到同一组时会挨在一起很难看，
 * 所以这里在列表层面做一次去重：与上一张重复就顺延一格。
 */
export function assignCovers(titles: string[]): { from: string; to: string }[] {
  const total = COVER_GRADIENTS.length;
  let prev = -1;
  return titles.map((title) => {
    let i = hashCode(title) % total;
    if (i === prev) i = (i + 1) % total;
    prev = i;
    const [from, to] = COVER_GRADIENTS[i];
    return { from, to };
  });
}

/** 圆形头像里显示的字：优先 profile.avatarText，其次站点名首字 */
export function avatarText(): string {
  const raw = SITE.profile.avatarText || SITE.heading || SITE.author;
  return raw.trim().slice(0, 1) || '·';
}

/**
 * 从建站日期算起的天数。
 *
 * 接受两种写法：
 *   - 数字年份：`2026`            → 该年 1 月 1 日起算
 *   - 完整日期：`'2026-10-15'`    → 精确到当天
 *
 * 建站当天返回 1，之后每过一天 +1；未来日期同样返回 1（不会出现 0 或负数）。
 */
export function daysSince(iso: string | number | Date): number {
  // 数字按「该年 1 月 1 日」处理，保持向后兼容
  const start =
    typeof iso === 'number'
      ? new Date(iso, 0, 1)
      : // 去掉时间部分，按本地日历天计算，避免 8 小时时区偏移导致少一天
        new Date(new Date(iso).getFullYear(), new Date(iso).getMonth(), new Date(iso).getDate());

  if (Number.isNaN(start.getTime())) return 1;

  const days = Math.floor((Date.now() - start.getTime()) / 86400000) + 1;
  return Math.max(1, days);
}

/** 格式化日期为 YYYY-MM-DD */
export function formatDate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/** 格式化日期时间为「YYYY-MM-DD HH:mm」，说说的语境里时间点比日期更重要 */
export function formatDateTime(date: Date): string {
  const h = String(date.getHours()).padStart(2, '0');
  const min = String(date.getMinutes()).padStart(2, '0');
  return `${formatDate(date)} ${h}:${min}`;
}

/** 相对时间，例如「3 小时前」「2 天前」，超过 30 天回退成具体日期 */
export function fromNow(date: Date): string {
  const diff = Date.now() - date.valueOf();
  if (diff < 0) return formatDate(date);
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatDate(date);
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
