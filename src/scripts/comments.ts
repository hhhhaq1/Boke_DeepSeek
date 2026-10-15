/**
 * 自建评论区前端逻辑（配合 EdgeOne 边缘函数 /api/comments 使用）。
 *
 * 仅在 SITE.comments.mode === 'self' 时，文章页会加载本模块。
 * 后端约定：
 *   GET  /api/comments?slug=<slug>  -> { comments: Comment[] }
 *   POST /api/comments              -> { comment: Comment }
 *        body: { slug, author, email, content }
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
    <li style="display:flex;gap:.75rem;padding:1rem 1.1rem;border:1px solid var(--border);border-radius:12px;background:var(--bg-elev)">
      <div aria-hidden="true" style="flex:0 0 2.25rem;width:2.25rem;height:2.25rem;border-radius:50%;background:var(--accent-soft);color:var(--accent);display:flex;align-items:center;justify-content:center;font-weight:700">${initial}</div>
      <div style="min-width:0;flex:1">
        <div style="display:flex;gap:.6rem;align-items:baseline;flex-wrap:wrap;margin-bottom:.2rem">
          <strong style="font-size:.9375rem">${escapeHtml(c.author)}</strong>
          <time datetime="${escapeHtml(c.createdAt)}" title="${escapeHtml(formatTime(c.createdAt))}" style="font-size:.8125rem;color:var(--text-faint)">${escapeHtml(relativeTime(c.createdAt))}</time>
        </div>
        <p style="margin:0;white-space:pre-wrap;overflow-wrap:anywhere;color:var(--text-soft)">${escapeHtml(c.content)}</p>
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

  const setStatus = (text: string) => {
    if (status) status.textContent = text;
  };
  const setMsg = (text: string, ok = false) => {
    if (!msg) return;
    msg.textContent = text;
    msg.style.color = ok ? 'var(--accent)' : '#d9534f';
  };

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
          : '<li style="color:var(--text-faint);padding:.5rem 0">还没有评论，来做第一个吧。</li>';
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

    if (!author || !content) {
      setMsg('昵称和内容不能为空');
      return;
    }
    if (author.length > MAX_AUTHOR) {
      setMsg(`昵称请控制在 ${MAX_AUTHOR} 字以内`);
      return;
    }
    if (content.length > MAX_CONTENT) {
      setMsg(`内容请控制在 ${MAX_CONTENT} 字以内`);
      return;
    }

    const submitBtn = form.querySelector('button[type="submit"]') as HTMLButtonElement | null;
    if (submitBtn) submitBtn.disabled = true;
    setMsg('提交中…', true);

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
        // 首次评论时清掉空状态
        list.querySelector('li[style*="text-faint"]')?.remove();
        list.insertAdjacentHTML('afterbegin', renderComment(payload.comment));
      }
      form.reset();
      setMsg('发表成功，感谢留言！', true);
    } catch (err) {
      setMsg(`提交失败：${(err as Error).message}`);
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

export {};
