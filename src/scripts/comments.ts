/**
 * 自建评论区前端逻辑（配合 EdgeOne 边缘函数 /api/comments 使用）。
 *
 * 仅在 SITE.comments.mode === 'self' 时，文章页会加载本模块。
 *
 * 后端约定：
 *   GET  /api/comments?slug=<slug>  -> { comments: Comment[] }
 *   POST /api/comments              -> { comment: Comment }
 *        body: { slug, author, email, content }
 *
 * 安全说明：前端校验只是为了「尽快告诉用户问题在哪」，
 * 真正起防护作用的是后端（functions/api/comments.js）——
 * 任何客户端校验都能被绕过，不能作为唯一防线。
 */

export interface Comment {
  id: string;
  slug: string;
  author: string;
  content: string;
  createdAt: string;
}

const MAX_AUTHOR = 40;
const MAX_CONTENT = 2000;

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** 相对时间，超过 30 天显示日期 */
function relativeTime(iso: string): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const min = Math.floor(diff / 60000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return formatTime(iso);
}

function renderComment(c: Comment): string {
  const initial = escapeHtml((c.author || '?').trim().charAt(0).toUpperCase());
  return `
    <li class="comment-item">
      <div class="comment-item__avatar" aria-hidden="true">${initial}</div>
      <div class="comment-item__body">
        <div class="comment-item__head">
          <strong class="comment-item__author">${escapeHtml(c.author)}</strong>
          <time
            class="comment-item__time"
            datetime="${escapeHtml(c.createdAt)}"
            title="${escapeHtml(formatTime(c.createdAt))}"
          >${escapeHtml(relativeTime(c.createdAt))}</time>
        </div>
        <p class="comment-item__text">${escapeHtml(c.content)}</p>
      </div>
    </li>`;
}

function init(): void {
  const root = document.getElementById('self-comments');
  if (!root) return;

  const slug = root.dataset.slug ?? '';
  const list = document.getElementById('self-comments-list');
  const form = document.getElementById('self-comments-form') as HTMLFormElement | null;
  const status = document.getElementById('self-comments-status');
  const msg = document.getElementById('self-comments-msg');
  const counter = document.getElementById('comment-count');
  const textarea = form?.querySelector('textarea[name="content"]') as HTMLTextAreaElement | null;

  const setStatus = (text: string) => {
    if (status) status.textContent = text;
  };

  const setMsg = (text: string, kind: 'ok' | 'err' | 'info' = 'info') => {
    if (!msg) return;
    msg.textContent = text;
    msg.dataset.kind = kind;
  };

  // 实时字数统计，让用户写之前就知道上限
  if (textarea && counter) {
    const updateCount = () => {
      counter.textContent = String(textarea.value.length);
      counter.parentElement?.toggleAttribute('data-over', textarea.value.length > MAX_CONTENT);
    };
    textarea.addEventListener('input', updateCount);
    updateCount();
  }

  async function load() {
    try {
      const res = await fetch(`/api/comments?slug=${encodeURIComponent(slug)}`, {
        headers: { accept: 'application/json' },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { comments?: Comment[] };
      const comments = Array.isArray(data.comments) ? data.comments : [];

      if (list) {
        list.innerHTML = comments.length
          ? comments.map(renderComment).join('')
          : '<li class="comment-list__empty">还没有评论，来做第一个吧。</li>';
      }
      status?.remove();
      if (form) form.hidden = false;
    } catch (err) {
      // 后端未部署 / KV 未绑定时的兜底提示
      setStatus(
        `评论加载失败：${(err as Error).message}。请确认已部署 /api/comments 并绑定 KV 命名空间（详见 README）。`
      );
    }
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const author = String(data.get('author') ?? '').trim();
    const email = String(data.get('email') ?? '').trim();
    const content = String(data.get('content') ?? '').trim();

    // 前端只做最基本的非空/长度检查，提示友好；真正的过滤在后端
    if (!author) {
      setMsg('请填写昵称', 'err');
      return;
    }
    if (!content) {
      setMsg('请填写评论内容', 'err');
      return;
    }
    if (author.length > MAX_AUTHOR) {
      setMsg(`昵称请控制在 ${MAX_AUTHOR} 字以内`, 'err');
      return;
    }
    if (content.length > MAX_CONTENT) {
      setMsg(`内容请控制在 ${MAX_CONTENT} 字以内`, 'err');
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (submitBtn) submitBtn.disabled = true;
    setMsg('提交中…', 'info');

    try {
      const res = await fetch('/api/comments', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, author, email, content }),
      });
      const payload = (await res.json().catch(() => ({}))) as {
        comment?: Comment;
        error?: string;
      };
      if (!res.ok) throw new Error(payload.error || `HTTP ${res.status}`);

      if (payload.comment && list) {
        // 首次评论时清掉空状态提示
        list.querySelector('.comment-list__empty')?.remove();
        list.insertAdjacentHTML('afterbegin', renderComment(payload.comment));
      }
      form.reset();
      if (counter) counter.textContent = '0';
      setMsg('发表成功，感谢留言！', 'ok');
    } catch (err) {
      setMsg(`提交失败：${(err as Error).message}`, 'err');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });

  void load();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init, { once: true });
} else {
  init();
}
