/**
 * 个性化组件入口。
 *
 * 只在 BaseLayout 里 import 一次，Astro 会打包成单个模块脚本并 defer 加载，
 * 不会产生额外请求。每个功能自己检查所需的 DOM 是否存在，不存在就立即返回，
 * 所以这个脚本在任意页面引入都是安全的。
 *
 * 开关在 src/config.ts 的 EFFECTS 里。
 */
import { EFFECTS } from '../config';

const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
/** 只有真正的鼠标才启用跟随类效果，触屏设备跳过 */
const finePointer = window.matchMedia('(hover: hover) and (pointer: fine)').matches;

/** 当前页面已滚过的比例（0–1） */
function scrollRatio(): number {
  const max = document.documentElement.scrollHeight - window.innerHeight;
  if (max <= 0) return 0;
  return Math.min(1, Math.max(0, window.scrollY / max));
}

/* ------------------------------------------------------------------ *
 * 1. 阅读进度条
 * ------------------------------------------------------------------ */
function initReadingProgress() {
  const bar = document.querySelector<HTMLElement>('[data-reading-progress]');
  if (!bar) return;

  const update = () => {
    // 用 scaleX 而不是 width，避免每帧触发布局
    bar.style.transform = `scaleX(${scrollRatio()})`;
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });
}

/* ------------------------------------------------------------------ *
 * 2. 返回顶部（带进度环）
 * ------------------------------------------------------------------ */
function initBackToTop() {
  const btn = document.querySelector<HTMLButtonElement>('[data-back-to-top]');
  if (!btn) return;

  const ring = btn.querySelector<SVGCircleElement>('[data-back-to-top-ring]');
  const circumference = ring ? ring.r.baseVal.value * 2 * Math.PI : 0;
  if (ring) ring.style.strokeDasharray = String(circumference);

  const update = () => {
    const ratio = scrollRatio();
    btn.classList.toggle('is-visible', window.scrollY > 400);
    if (ring) ring.style.strokeDashoffset = String(circumference * (1 - ratio));
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update, { passive: true });

  btn.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  });
}

/* ------------------------------------------------------------------ *
 * 3. 目录跟随高亮
 * ------------------------------------------------------------------ */
function initTocHighlight() {
  const toc = document.querySelector<HTMLElement>('[data-toc]');
  if (!toc) return;

  /** slug -> 目录里的链接 */
  const links = new Map<string, HTMLAnchorElement>();
  toc.querySelectorAll<HTMLAnchorElement>('a[href^="#"]').forEach((a) => {
    const href = a.getAttribute('href');
    if (href) links.set(href.slice(1), a);
  });
  if (links.size === 0) return;

  // Astro 渲染 Markdown 时会给标题加上与 slug 一致的 id
  const headings = Array.from(
    document.querySelectorAll<HTMLElement>('.prose h2[id], .prose h3[id]')
  ).filter((h) => links.has(h.id));
  if (headings.length === 0) return;

  let activeId: string | null = null;

  const pick = () => {
    // 取最后一个已经越过「视口上方 22% 基准线」的标题
    const line = window.innerHeight * 0.22;
    let current = headings[0].id;
    for (const h of headings) {
      if (h.getBoundingClientRect().top <= line) current = h.id;
      else break;
    }

    // 滚到底部时强制高亮最后一项，否则最后几节永远选不中
    if (scrollRatio() > 0.995) current = headings[headings.length - 1].id;

    if (current === activeId) return;
    activeId = current;
    links.forEach((a, slug) => a.classList.toggle('is-active', slug === current));
  };

  pick();
  window.addEventListener('scroll', pick, { passive: true });
  window.addEventListener('resize', pick, { passive: true });
}

/* ------------------------------------------------------------------ *
 * 4. 图片灯箱
 * ------------------------------------------------------------------ */
function initLightbox() {
  // 正文配图和说说的九宫格都能点开看大图。
  // 按容器分组：一篇正文 / 一条说说的图各自成组，左右键只在组内切换，
  // 不会翻到隔壁那条说说去。
  const groups = Array.from(
    document.querySelectorAll<HTMLElement>('.prose, .note')
  )
    .map((box) => Array.from(box.querySelectorAll<HTMLImageElement>('img')))
    .filter((list) => list.length > 0);
  if (groups.length === 0) return;

  const dialog = document.createElement('dialog');
  dialog.className = 'lightbox';
  dialog.innerHTML = `
    <button class="lightbox__close" type="button" aria-label="关闭">&#215;</button>
    <button class="lightbox__nav lightbox__nav--prev" type="button" aria-label="上一张">&#8249;</button>
    <img class="lightbox__img" alt="" />
    <button class="lightbox__nav lightbox__nav--next" type="button" aria-label="下一张">&#8250;</button>
    <p class="lightbox__count" aria-live="polite"></p>
  `;
  document.body.appendChild(dialog);

  const img = dialog.querySelector<HTMLImageElement>('.lightbox__img');
  const count = dialog.querySelector<HTMLElement>('.lightbox__count');
  const prev = dialog.querySelector<HTMLElement>('.lightbox__nav--prev');
  const next = dialog.querySelector<HTMLElement>('.lightbox__nav--next');
  if (!img || !count) return;

  /** 当前正在浏览的那一组，以及组内下标 */
  let current: HTMLImageElement[] = [];
  let index = 0;

  const show = (i: number) => {
    if (current.length === 0) return;
    index = (i + current.length) % current.length;
    const source = current[index];
    // currentSrc 能拿到 <img> 实际加载的那个尺寸
    img.src = source.currentSrc || source.src;
    img.alt = source.alt ?? '';
    count.textContent = `${index + 1} / ${current.length}`;
    const single = current.length < 2;
    if (prev) prev.hidden = single;
    if (next) next.hidden = single;
  };

  for (const list of groups) {
    list.forEach((el, i) => {
      el.classList.add('is-zoomable');
      el.addEventListener('click', () => {
        current = list;
        show(i);
        dialog.showModal();
        document.body.classList.add('is-lightbox-open');
      });
    });
  }

  dialog.addEventListener('close', () => {
    document.body.classList.remove('is-lightbox-open');
  });

  dialog.querySelector('.lightbox__close')?.addEventListener('click', () => dialog.close());
  prev?.addEventListener('click', () => show(index - 1));
  next?.addEventListener('click', () => show(index + 1));

  // 点图片以外的空白处关闭
  dialog.addEventListener('click', (e) => {
    if (e.target === dialog) dialog.close();
  });

  // 左右键切换；ESC 由 <dialog> 原生处理
  dialog.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft') show(index - 1);
    if (e.key === 'ArrowRight') show(index + 1);
  });
}

/* ------------------------------------------------------------------ *
 * 5. 首页打字机
 * ------------------------------------------------------------------ */
function initTypewriter() {
  const el = document.querySelector<HTMLElement>('[data-typewriter]');
  if (!el) return;

  // 完整文案本来就写在 HTML 里，这里读出来再逐字打一遍，SEO 不受影响
  const full = (el.textContent ?? '').trim();
  if (!full) return;

  // 系统开了「减少动效」：直接呈现完整文案，连光标都不要。
  // 注意别加 is-typing——那会让光标一直闪下去。
  if (reduceMotion) {
    el.classList.add('is-done');
    return;
  }

  el.classList.add('is-typing');
  el.textContent = '';
  let i = 0;

  const step = () => {
    el.textContent = full.slice(0, ++i);
    if (i < full.length) {
      window.setTimeout(step, 52 + Math.random() * 46);
    } else {
      // 打完就收掉光标：移除 is-typing 让 ::after 不再存在，再加 is-done 保持可见
      el.classList.remove('is-typing');
      el.classList.add('is-done');
    }
  };

  window.setTimeout(step, 280);
}

/* ------------------------------------------------------------------ *
 * 6. 滚动淡入
 * ------------------------------------------------------------------ */
function initScrollReveal() {
  const items = Array.from(document.querySelectorAll<HTMLElement>('.reveal'));
  if (items.length === 0) return;

  if (reduceMotion) {
    items.forEach((el) => el.classList.add('is-visible'));
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        entry.target.classList.add('is-visible');
        observer.unobserve(entry.target);
      }
    },
    { rootMargin: '0px 0px -6% 0px', threshold: 0.05 }
  );

  // 同一容器内的元素依次错开一点，做出瀑布式的节奏
  const counter = new Map<Element, number>();
  items.forEach((el) => {
    const parent = el.parentElement ?? document.body;
    const n = counter.get(parent) ?? 0;
    counter.set(parent, n + 1);
    el.style.setProperty('--reveal-delay', `${Math.min(n, 6) * 70}ms`);
    observer.observe(el);
  });
}

/* ------------------------------------------------------------------ *
 * 7. 光标跟随光斑
 * ------------------------------------------------------------------ */
function initCursorGlow() {
  if (!finePointer || reduceMotion) return;

  const glow = document.querySelector<HTMLElement>('[data-cursor-glow]');
  if (!glow) return;

  let targetX = window.innerWidth / 2;
  let targetY = window.innerHeight * 0.35;
  let x = targetX;
  let y = targetY;
  let running = false;

  const tick = () => {
    // 缓动跟随，光斑会略微滞后于指针，看起来更柔和
    x += (targetX - x) * 0.14;
    y += (targetY - y) * 0.14;
    glow.style.transform = `translate3d(${x}px, ${y}px, 0)`;

    if (Math.abs(targetX - x) > 0.4 || Math.abs(targetY - y) > 0.4) {
      requestAnimationFrame(tick);
    } else {
      running = false;
    }
  };

  window.addEventListener('pointermove', (e) => {
    if ((e as PointerEvent).pointerType !== 'mouse') return;
    targetX = (e as PointerEvent).clientX;
    targetY = (e as PointerEvent).clientY;
    glow.classList.add('is-active');
    if (!running) {
      running = true;
      requestAnimationFrame(tick);
    }
  }, { passive: true });

  document.addEventListener('pointerleave', () => glow.classList.remove('is-active'));
}

/* ------------------------------------------------------------------ *
 * 8. 文章搜索
 * ------------------------------------------------------------------ */
function escapeHtml(text: string): string {
  const map: Record<string, string> = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
  };
  return text.replace(/[&<>"]/g, (c) => map[c]);
}

function initSearch() {
  const input = document.querySelector<HTMLInputElement>('[data-search-input]');
  const list = document.querySelector<HTMLElement>('[data-search-list]');
  if (!input || !list) return;

  const items = Array.from(list.querySelectorAll<HTMLElement>('[data-post-id]'));
  if (items.length === 0) return;

  const status = document.querySelector<HTMLElement>('[data-search-status]');
  const empty = document.querySelector<HTMLElement>('[data-search-empty]');
  const clearBtn = document.querySelector<HTMLButtonElement>('[data-search-clear]');
  const total = items.length;

  /** 标题原文留一份，用于还原高亮 */
  const titles = new Map<string, string>();
  for (const el of items) {
    const title = el.querySelector<HTMLElement>('.post-card__title');
    const key = el.dataset.postId;
    if (title && key) titles.set(key, title.innerHTML);
  }

  /** postId -> 可搜索文本（已转小写）。首次输入时才拉取，不拖慢首屏 */
  let index: Map<string, string> | null = null;
  let fetching: Promise<void> | null = null;

  const loadIndex = (): Promise<void> => {
    if (index) return Promise.resolve();
    if (fetching) return fetching;
    fetching = fetch('/search-index.json')
      .then((r) => (r.ok ? r.json() : []))
      .then(
        (
          rows: {
            id: string;
            title: string;
            description: string;
            tags: string[];
            text: string;
          }[]
        ) => {
          index = new Map(
            rows.map((row) => [
              row.id,
              [row.title, row.description, (row.tags ?? []).join(' '), row.text]
                .join(' ')
                .toLowerCase(),
            ])
          );
        }
      )
      .catch(() => {
        // 索引拉不到就退化成「只搜页面上已有的文字」，功能不至于全废
        index = new Map();
      });
    return fetching;
  };

  const highlight = (el: HTMLElement, query: string) => {
    const key = el.dataset.postId;
    const title = el.querySelector<HTMLElement>('.post-card__title');
    if (!key || !title) return;

    const original = titles.get(key) ?? title.innerHTML;
    if (!query) {
      title.innerHTML = original;
      return;
    }

    // 标题里基本不会有内联标签，按纯文本重建就够了
    const plain = title.textContent ?? '';
    const at = plain.toLowerCase().indexOf(query);
    if (at < 0) {
      title.innerHTML = original;
      return;
    }
    title.innerHTML =
      `${escapeHtml(plain.slice(0, at))}<mark>` +
      `${escapeHtml(plain.slice(at, at + query.length))}</mark>` +
      escapeHtml(plain.slice(at + query.length));
  };

  const apply = () => {
    const raw = input.value.trim();
    const query = raw.toLowerCase();
    let hits = 0;

    for (const el of items) {
      const key = el.dataset.postId ?? '';
      const haystack = index?.get(key) ?? (el.textContent ?? '').toLowerCase();
      const matched = query === '' || haystack.includes(query);
      el.hidden = !matched;
      if (matched) {
        hits++;
        // 被过滤掉再显示回来的卡片可能没赶上滚动淡入，这里补上
        el.classList.add('is-visible');
      }
      highlight(el, query);
    }

    if (status) status.textContent = query ? `找到 ${hits} 篇` : `共 ${total} 篇`;
    if (empty) empty.hidden = hits > 0;
    if (clearBtn) clearBtn.hidden = query === '';

    // 关键词写进地址栏，刷新和分享都能保留
    const url = new URL(window.location.href);
    if (query) url.searchParams.set('q', raw);
    else url.searchParams.delete('q');
    window.history.replaceState(null, '', url);
  };

  let timer = 0;
  input.addEventListener('input', () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      loadIndex().then(apply);
    }, 120);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      apply();
    }
  });

  clearBtn?.addEventListener('click', () => {
    input.value = '';
    input.focus();
    apply();
  });

  // 按 / 快速聚焦搜索框；已经在输入框里就不劫持
  document.addEventListener('keydown', (e) => {
    const ke = e as KeyboardEvent;
    if (ke.key !== '/' || ke.metaKey || ke.ctrlKey || ke.altKey) return;
    const target = ke.target as HTMLElement | null;
    if (
      target &&
      (target.tagName === 'INPUT' ||
        target.tagName === 'TEXTAREA' ||
        target.isContentEditable)
    ) {
      return;
    }
    ke.preventDefault();
    input.focus();
  });

  // 支持 /posts/?q=关键词 直接进入搜索状态
  const initial = new URL(window.location.href).searchParams.get('q');
  if (initial) {
    input.value = initial;
    loadIndex().then(apply);
  }
}

/* ------------------------------------------------------------------ *
 * 9. 说说分类筛选
 * ------------------------------------------------------------------ */
function initNoteCategoryFilter() {
  const bar = document.querySelector<HTMLElement>('[data-cat-filter-bar], .cat-filter');
  const timeline = document.querySelector<HTMLElement>('.notes-timeline');
  if (!bar || !timeline) return;

  const chips = Array.from(bar.querySelectorAll<HTMLButtonElement>('[data-cat-chip]'));
  const items = Array.from(timeline.querySelectorAll<HTMLElement>('[data-cat]'));
  if (chips.length === 0 || items.length === 0) return;

  const months = Array.from(timeline.querySelectorAll<HTMLElement>('.notes-month'));
  const countEl = document.querySelector<HTMLElement>('[data-notes-count]');
  const total = items.length;

  const apply = (value: string) => {
    let hits = 0;

    for (const el of items) {
      const matched = value === '' || el.dataset.cat === value;
      el.hidden = !matched;
      if (matched) {
        hits++;
        // 被过滤掉再显示回来的卡片可能没赶上滚动淡入，这里补上
        el.classList.add('is-visible');
      }
    }

    // 整月都没有命中就收起整个月份区块，避免留下一串空标题
    for (const month of months) {
      month.hidden = !Array.from(month.querySelectorAll<HTMLElement>('[data-cat]')).some(
        (el) => !el.hidden
      );
    }

    for (const chip of chips) {
      const active = (chip.dataset.catChip ?? '') === value;
      chip.classList.toggle('is-active', active);
      chip.setAttribute('aria-pressed', active ? 'true' : 'false');
    }

    if (countEl) {
      countEl.innerHTML =
        value === ''
          ? `共 <strong>${total}</strong> 条`
          : `${value} · <strong>${hits}</strong> 条`;
    }

    // 分类写进地址栏，刷新和分享都能保留
    const url = new URL(window.location.href);
    if (value) url.searchParams.set('cat', value);
    else url.searchParams.delete('cat');
    window.history.replaceState(null, '', url);
  };

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      const value = chip.dataset.catChip ?? '';
      // 再点一次当前分类就取消筛选，回到全部
      apply(chip.classList.contains('is-active') ? '' : value);
    });
  }

  // 支持 /notes/?cat=读书 直接进入筛选状态
  const initial = new URL(window.location.href).searchParams.get('cat');
  if (initial && chips.some((c) => c.dataset.catChip === initial)) {
    apply(initial);
  }
}

/* ------------------------------------------------------------------ *
 * 10. 点赞
 * ------------------------------------------------------------------ */
function initLikes() {
  const roots = Array.from(document.querySelectorAll<HTMLElement>('[data-like]'));
  if (roots.length === 0) return;

  const ENDPOINT = '/api/likes';
  const VISITOR_KEY = 'visitor';

  /**
   * 取（或首次生成）访客标识，用来防重复赞。
   * 只存一个随机串，不含任何个人信息；用户清掉就相当于「换了个新访客」。
   */
  function visitorId(): string {
    const fresh = () =>
      (globalThis.crypto?.randomUUID?.() ??
        `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`
      ).replace(/-/g, '');

    try {
      const saved = localStorage.getItem(VISITOR_KEY);
      if (saved && /^[A-Za-z0-9_-]{8,64}$/.test(saved)) return saved;
      const created = fresh().slice(0, 32);
      localStorage.setItem(VISITOR_KEY, created);
      return created;
    } catch {
      // 无痕模式下 localStorage 可能直接抛错，退化成一次性 ID
      return fresh().slice(0, 32);
    }
  }

  const visitor = visitorId();

  interface Item {
    root: HTMLElement;
    slug: string;
    btn: HTMLButtonElement;
    countEl: HTMLElement | null;
    count: number;
    liked: boolean;
    busy: boolean;
  }

  const items = roots
    .map((root): Item | null => {
      const slug = root.dataset.slug ?? '';
      const btn = root.querySelector<HTMLButtonElement>('[data-like-btn]');
      if (!slug || !btn) return null;
      return {
        root,
        slug,
        btn,
        countEl: root.querySelector<HTMLElement>('[data-like-count]'),
        count: 0,
        liked: false,
        busy: false,
      };
    })
    .filter((x): x is Item => x !== null);

  if (items.length === 0) return;

  const paint = (item: Item) => {
    item.root.classList.toggle('is-liked', item.liked);
    item.btn.setAttribute('aria-pressed', item.liked ? 'true' : 'false');
    if (item.countEl) item.countEl.textContent = String(item.count);
    item.btn.disabled = item.busy;
  };

  // 初始状态：一次把本页所有 slug 问完，而不是每条发一个请求
  const slugs = [...new Set(items.map((i) => i.slug))];
  const query = slugs.map((s) => `slug=${encodeURIComponent(s)}`).join('&');

  fetch(`${ENDPOINT}?${query}&visitor=${encodeURIComponent(visitor)}`)
    .then((res) => (res.ok ? res.json() : Promise.reject(new Error(String(res.status)))))
    .then((data) => {
      for (const item of items) {
        const info = data?.likes?.[item.slug];
        item.count = Number(info?.count) || 0;
        item.liked = Boolean(info?.liked);
        paint(item);
        item.root.hidden = false;
      }
    })
    .catch(() => {
      // 边缘函数不可用（本地 astro dev 就是这样）。
      // 保持 hidden，不给用户一个点了没反应的按钮。
    });

  for (const item of items) {
    item.btn.addEventListener('click', async () => {
      if (item.busy) return;

      const action = item.liked ? 'unlike' : 'like';
      const before = { count: item.count, liked: item.liked };

      // 乐观更新：先动 UI，请求失败再回滚。点赞这种小操作不该等一个来回。
      item.liked = action === 'like';
      item.count = Math.max(0, item.count + (action === 'like' ? 1 : -1));
      item.busy = true;
      paint(item);

      if (action === 'like') {
        item.root.classList.add('is-popping');
        window.setTimeout(() => item.root.classList.remove('is-popping'), 360);
      }

      try {
        const res = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ slug: item.slug, visitor, action }),
        });
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        // 以服务端返回为准：别人同时也在赞，数字可能比本地算的多
        item.count = Number(data?.count) || 0;
        item.liked = Boolean(data?.liked);
      } catch {
        item.count = before.count;
        item.liked = before.liked;
      } finally {
        item.busy = false;
        paint(item);
      }
    });
  }
}

/* ------------------------------------------------------------------ *
 * 启动
 * ------------------------------------------------------------------ */
try {
  if (EFFECTS.readingProgress) {
    initReadingProgress();
    initBackToTop();
  }
  if (EFFECTS.tocHighlight) initTocHighlight();
  if (EFFECTS.lightbox) initLightbox();
  if (EFFECTS.typewriter) initTypewriter();
  if (EFFECTS.scrollReveal) initScrollReveal();
  if (EFFECTS.cursorGlow) initCursorGlow();
  if (EFFECTS.search) initSearch();
  if (EFFECTS.noteCategoryFilter) initNoteCategoryFilter();
  // 点赞没有 EFFECTS 开关：关掉的方式是 SITE.likes.mode = 'none'，
  // 那样页面上根本不会渲染 [data-like]，这里自然就空转返回了。
  initLikes();

  // 标记脚本已成功执行，head 里的兜底定时器据此决定要不要强制显示内容
  document.documentElement.setAttribute('data-enhanced', '');
} catch (err) {
  console.error('[enhance]', err);
}
