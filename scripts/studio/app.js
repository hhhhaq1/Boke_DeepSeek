/* 写作台前端逻辑：表单 → md → git，全部走本地 API。 */

const $ = (id) => document.getElementById(id);

const state = {
  type: 'note',
  filename: '',
  images: [],
  categories: [],
  items: { note: [], post: [] },
  defaultAuthor: '',
  author: '',
  avatar: '',
  settingsAvatar: '',
  busy: false,
  dirty: false,
  libFilter: 'all',
};

const MOODS = ['☀️', '🌧️', '🌙', '😄', '😮‍💨', '🍺', '📚', '🍜'];
const SETTINGS_KEY = 'studio-settings';

/* ---------------- 基础工具 ---------------- */

const pad = (n) => String(n).padStart(2, '0');

function nowLocal() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function toStamp(v) {
  if (!v) return '';
  const s = v.replace('T', ' ');
  return s.length === 16 ? `${s}:00` : s;
}

function fromStamp(v) {
  if (!v) return '';
  const s = String(v).trim().replace(' ', 'T');
  return s.length >= 16 ? s.slice(0, 16) : `${s.slice(0, 10)}T00:00`;
}

function splitTags(v) {
  return [...new Set(String(v).split(/[,，、]/).map((s) => s.trim()).filter(Boolean))];
}

function kb(n) {
  return n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)}MB` : `${Math.round(n / 1024)}KB`;
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* 轻量 Markdown 渲染：离线可用，不依赖任何外部库。
   先转义 HTML 再套用行内/块级规则，避免 XSS。覆盖标题、粗体、斜体、
   行内代码、代码块、链接、图片、引用、分割线、有序/无序列表、段落。 */
function inlineMd(src) {
  let s = src;
  s = s.replace(/!\[([^\]]*)\]\(([^)\s]+)\)/g, (m, alt, url) => `<img src="${url}" alt="${alt}">`);
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, url) => `<a href="${url}" target="_blank" rel="noopener">${t}</a>`);
  s = s.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  s = s.replace(/__([^_]+)__/g, '<strong>$1</strong>');
  s = s.replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>');
  s = s.replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
  s = s.replace(/`([^`]+)`/g, '<code>$1</code>');
  return s;
}

function parseMarkdown(md) {
  const lines = String(md).replace(/\r\n/g, '\n').split('\n');
  let html = '';
  let i = 0;
  let listType = null;

  const flushList = () => {
    if (listType) {
      html += `</${listType}>`;
      listType = null;
    }
  };

  const isSpecial = (ln) =>
    /^(#{1,6})\s/.test(ln) ||
    /^>\s?/.test(ln) ||
    /^\s*[-*]\s+/.test(ln) ||
    /^\s*\d+\.\s+/.test(ln) ||
    /^```/.test(ln) ||
    /^---+$/.test(ln.trim());

  while (i < lines.length) {
    const line = lines[i];

    const fence = /^```(.*)$/.exec(line);
    if (fence) {
      const buf = [];
      i += 1;
      while (i < lines.length && !/^```/.test(lines[i])) {
        buf.push(lines[i]);
        i += 1;
      }
      i += 1;
      flushList();
      html += `<pre><code>${escapeHtml(buf.join('\n'))}</code></pre>`;
      continue;
    }

    if (/^\s*$/.test(line)) {
      flushList();
      i += 1;
      continue;
    }

    if (/^---+$/.test(line.trim())) {
      flushList();
      html += '<hr>';
      i += 1;
      continue;
    }

    const h = /^(#{1,6})\s+(.*)$/.exec(line);
    if (h) {
      flushList();
      const lvl = h[1].length;
      html += `<h${lvl}>${inlineMd(escapeHtml(h[2].trim()))}</h${lvl}>`;
      i += 1;
      continue;
    }

    if (/^>\s?/.test(line)) {
      const buf = [];
      while (i < lines.length && /^>\s?/.test(lines[i])) {
        buf.push(lines[i].replace(/^>\s?/, ''));
        i += 1;
      }
      flushList();
      html += `<blockquote>${parseMarkdown(buf.join('\n'))}</blockquote>`;
      continue;
    }

    const ul = /^\s*[-*]\s+(.*)$/.exec(line);
    const ol = /^\s*\d+\.\s+(.*)$/.exec(line);
    if (ul || ol) {
      const type = ul ? 'ul' : 'ol';
      if (listType !== type) {
        flushList();
        html += `<${type}>`;
        listType = type;
      }
      const content = ul ? ul[1] : ol[1];
      html += `<li>${inlineMd(escapeHtml(content))}</li>`;
      i += 1;
      continue;
    }

    const buf = [];
    while (i < lines.length && !/^\s*$/.test(lines[i]) && !isSpecial(lines[i])) {
      buf.push(lines[i]);
      i += 1;
    }
    flushList();
    html += `<p>${inlineMd(escapeHtml(buf.join('\n'))).replace(/\n/g, '<br>')}</p>`;
  }

  flushList();
  return html;
}

let statusTimer = null;
function status(msg, kind = '') {
  const el = $('status');
  el.textContent = msg;
  el.className = `status${kind ? ` is-${kind}` : ''}`;
  clearTimeout(statusTimer);
  if (kind !== 'busy') {
    statusTimer = setTimeout(() => {
      el.className = 'status';
    }, 6000);
  }
}

async function api(url, options) {
  const res = await fetch(url, options);
  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (data.error) throw new Error(data.error);
  return data;
}

const postJSON = (url, payload) =>
  api(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });

/* ---------------- 设置（作者 / 头像） ---------------- */

function loadSettings() {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}');
    state.author = typeof raw.author === 'string' ? raw.author : '';
    state.settingsAvatar = typeof raw.avatar === 'string' ? raw.avatar : '';
    state.avatar = state.settingsAvatar;
  } catch {
    state.author = '';
    state.settingsAvatar = '';
    state.avatar = '';
  }
}

function saveSettings() {
  try {
    localStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ author: state.author, avatar: state.settingsAvatar })
    );
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 表单读写 ---------------- */

function collect() {
  const tags = splitTags($('fTags').value);

  if (state.type === 'note') {
    return {
      pubDate: toStamp($('fDate').value),
      category: $('fCategory').value,
      location: $('fLocation').value.trim(),
      mood: $('fMood').value.trim(),
      author: $('fAuthor').value.trim(),
      avatar: state.avatar,
      tags,
      images: state.images,
      pinned: $('fPinned').checked,
      draft: $('fDraft').checked,
    };
  }

  return {
    title: $('fTitle').value.trim(),
    description: $('fDesc').value.trim(),
    slug: $('fSlug').value.trim(),
    pubDate: $('fDate').value,
    tags,
    cover: $('fCover').value.trim(),
    author: $('fAuthor').value.trim(),
    comments: $('fComments').checked,
    draft: $('fDraft').checked,
  };
}

function applyItem(data) {
  $('fDate').value =
    state.type === 'note' ? fromStamp(data.pubDate) : String(data.pubDate || '').slice(0, 10);
  $('fAuthor').value = data.author || state.author || state.defaultAuthor || '';

  if (state.type === 'note') {
    const cat = data.category || '杂项';
    if (![...$('fCategory').options].some((o) => o.value === cat)) {
      $('fCategory').add(new Option(cat, cat));
    }
    $('fCategory').value = cat;
    $('fLocation').value = data.location || '';
    $('fMood').value = data.mood || '';
    $('fPinned').checked = data.pinned === true;
    state.images = Array.isArray(data.images) ? data.images.filter(Boolean) : [];
    state.avatar = data.avatar || state.settingsAvatar || '';
  } else {
    $('fTitle').value = data.title || '';
    $('fDesc').value = data.description || '';
    $('fCover').value = data.cover || '';
    $('fComments').checked = data.comments !== false;
  }

  $('fTags').value = Array.isArray(data.tags) ? data.tags.join(', ') : '';
  $('fDraft').checked = data.draft === true;
}

function resetForm(keepDate = false) {
  state.filename = '';
  state.images = [];
  setDirty(false);
  state.avatar = state.settingsAvatar;
  $('body').value = '';
  ['fTitle', 'fDesc', 'fSlug', 'fLocation', 'fMood', 'fCover', 'fTags'].forEach((id) => {
    $(id).value = '';
  });
  $('fAuthor').value = state.author || state.defaultAuthor || '';
  $('fCategory').value = state.categories.includes('杂项') ? '杂项' : state.categories[0] || '杂项';
  $('fPinned').checked = false;
  $('fDraft').checked = false;
  $('fComments').checked = true;
  if (!keepDate) $('fDate').value = state.type === 'note' ? nowLocal() : nowLocal().slice(0, 10);
  renderAvatar();
  renderThumbs();
  renderPreview();
}

/* ---------------- 头像 ---------------- */

function renderAvatar() {
  const initial = ($('fAuthor').value.trim() || state.defaultAuthor || '站').slice(0, 1);

  const preview = $('avatarPreview');
  preview.innerHTML = state.avatar ? `<img src="${state.avatar}" alt="" />` : escapeHtml(initial);

  const pv = $('pvAvatar');
  pv.innerHTML = state.avatar ? `<img src="${state.avatar}" alt="" />` : escapeHtml(initial);

  $('avatarPath').textContent = state.avatar ? state.avatar : '未设置，用作者名首字';
}

async function uploadAvatar(file) {
  try {
    status('处理头像…', 'busy');
    const { blob, ext, from, to } = await compress(file, 320, 0.9);
    const data = await api(`/api/avatar?ext=${ext}`, { method: 'POST', body: blob });
    state.avatar = data.url;
    state.settingsAvatar = data.url;
    saveSettings();
    renderAvatar();
    markDirty();
    status(`头像已更新：${kb(from)} → ${kb(to)}`, 'ok');
  } catch (err) {
    status(err.message, 'err');
  }
}

/* ---------------- 预览 ---------------- */

function renderPreview() {
  const md = $('body').value;
  const empty = !md.trim();
  const html = empty ? '<p class="empty-hint">正文还是空的</p>' : parseMarkdown(md);

  if (state.type === 'note') {
    $('notePreview').hidden = false;
    $('postPreview').hidden = true;

    const cat = $('fCategory').value || '杂项';
    $('pvCat').textContent = cat;
    $('pvAuthor').textContent = $('fAuthor').value.trim() || state.defaultAuthor || '站长';
    $('pvMood').textContent = $('fMood').value.trim();
    $('pvTime').textContent = $('fDate').value.replace('T', ' ') || '—';
    $('pvLoc').textContent = $('fLocation').value.trim();
    $('pvBody').innerHTML = html;

    const grid = $('pvGrid');
    grid.dataset.count = String(state.images.length);
    grid.innerHTML = state.images.map((src) => `<img src="${src}" alt="" loading="lazy" />`).join('');

    $('metaLine').textContent = `${cat} · ${state.images.length} 张图`;
    renderAvatar();
  } else {
    $('notePreview').hidden = true;
    $('postPreview').hidden = false;
    $('pvTitle').textContent = $('fTitle').value.trim() || '无标题';
    $('pvDesc').textContent = $('fDesc').value.trim();
    $('pvPostBody').innerHTML = html;
    $('metaLine').textContent = `/blog/${$('fSlug').value.trim() || '…'}/`;
  }
  renderLiveStats();
}

function renderThumbs() {
  const box = $('thumbs');
  if (state.type === 'post') {
    box.innerHTML = '<p class="thumbs__empty">文章图片直接插进正文，不需要在这里管理</p>';
    return;
  }
  if (!state.images.length) {
    box.innerHTML = '<p class="thumbs__empty">还没有配图，拖到编辑区即可</p>';
    return;
  }
  box.innerHTML = state.images
    .map(
      (src, i) => `
      <div class="thumb" data-i="${i}">
        <img src="${src}" alt="" loading="lazy" />
        <span class="thumb__idx">${i + 1}</span>
        <button class="thumb__del" type="button" data-del="${i}" title="移除">×</button>
      </div>`
    )
    .join('');
}

/* ---------------- Markdown 工具栏 ---------------- */

function afterEdit(start, end) {
  const ta = $('body');
  ta.focus();
  ta.setSelectionRange(start, end);
  markDirty();
  renderPreview();
}

function surround(before, after, placeholder) {
  const ta = $('body');
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const sel = ta.value.slice(start, end) || placeholder;
  ta.value = ta.value.slice(0, start) + before + sel + after + ta.value.slice(end);
  afterEdit(start + before.length, start + before.length + sel.length);
}

function prefixLines(prefix) {
  const ta = $('body');
  const v = ta.value;
  const start = ta.selectionStart;
  const end = ta.selectionEnd;

  const lineStart = v.lastIndexOf('\n', start - 1) + 1;
  let lineEnd = v.indexOf('\n', end);
  if (lineEnd === -1) lineEnd = v.length;

  const block = v.slice(lineStart, lineEnd);
  const lines = block.split('\n');
  const allPrefixed = lines.every((l) => l.startsWith(prefix));
  const next = lines
    .map((l) => (allPrefixed ? l.slice(prefix.length) : `${prefix}${l}`))
    .join('\n');

  ta.value = v.slice(0, lineStart) + next + v.slice(lineEnd);
  afterEdit(lineStart, lineStart + next.length);
}

function insertBlock(text, cursorOffset) {
  const ta = $('body');
  const pos = ta.selectionStart;
  const before = ta.value.slice(0, pos);
  const after = ta.value.slice(ta.selectionEnd);

  let lead = '';
  if (before && !before.endsWith('\n\n')) lead = before.endsWith('\n') ? '\n' : '\n\n';

  ta.value = before + lead + text + after;
  const caret = pos + lead.length + (cursorOffset ?? text.length);
  afterEdit(caret, caret);
}

function runToolbar(action) {
  switch (action) {
    case 'h2':
      return prefixLines('## ');
    case 'h3':
      return prefixLines('### ');
    case 'bold':
      return surround('**', '**', '粗体文字');
    case 'italic':
      return surround('*', '*', '斜体文字');
    case 'quote':
      return prefixLines('> ');
    case 'code':
      return surround('`', '`', 'code');
    case 'codeblock':
      return insertBlock('```\n\n```', 4);
    case 'link':
      return surround('[', '](https://)', '链接文字');
    case 'ul':
      return prefixLines('- ');
    case 'ol':
      return prefixLines('1. ');
    case 'hr':
      return insertBlock('---');
    case 'image':
      return $('filePicker').click();
    default:
      return undefined;
  }
}

/* ---------------- 图片：压缩 + 上传 ---------------- */

async function compress(file, maxEdge = 1600, quality = 0.82) {
  let bitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`无法读取 ${file.name}（HEIC 等格式请先转成 jpg/png）`);
  }

  const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, w, h);
  bitmap.close?.();

  let blob = await new Promise((r) => canvas.toBlob(r, 'image/webp', quality));
  let ext = 'webp';
  if (!blob || blob.type !== 'image/webp') {
    blob = await new Promise((r) => canvas.toBlob(r, 'image/jpeg', quality));
    ext = 'jpg';
  }
  if (!blob) throw new Error(`${file.name} 压缩失败`);

  return { blob, ext, from: file.size, to: blob.size, w, h };
}

function uploadSlug() {
  if (state.type === 'post') {
    return ($('fSlug').value.trim() || 'post').replace(/[^a-zA-Z0-9_-]/g, '-') || 'post';
  }
  return 'note';
}

function insertIntoBody(text) {
  const ta = $('body');
  const start = ta.selectionStart ?? ta.value.length;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(ta.selectionEnd ?? start);
  const needNl = before && !before.endsWith('\n') ? '\n\n' : '';
  ta.value = `${before}${needNl}${text}\n${after}`;
  const pos = before.length + needNl.length + text.length + 1;
  ta.setSelectionRange(pos, pos);
}

async function uploadFiles(fileList) {
  const files = [...fileList].filter((f) => f.type.startsWith('image/'));
  if (!files.length) {
    status('没有识别到图片文件', 'err');
    return;
  }

  for (const file of files) {
    try {
      status(`压缩 ${file.name}…`, 'busy');
      const { blob, ext, from, to } = await compress(file);
      const qs = new URLSearchParams({ type: state.type, slug: uploadSlug(), ext });
      const data = await api(`/api/upload?${qs}`, { method: 'POST', body: blob });

      if (state.type === 'note') state.images.push(data.url);
      else insertIntoBody(`![](${data.url})`);

      status(`${file.name}：${kb(from)} → ${kb(to)}`, 'ok');
    } catch (err) {
      status(err.message, 'err');
    }
  }

  renderThumbs();
  renderPreview();
  markDirty();
}

/* ---------------- 保存 / 发布 ---------------- */

function validate() {
  if (!/^\d{4}-\d{2}-\d{2}/.test($('fDate').value || '')) return '请先选时间';

  if (state.type === 'post') {
    if (!$('fTitle').value.trim()) return '标题不能为空';
    if (!$('fDesc').value.trim()) return '描述不能为空（列表和 SEO 会用到）';
    if ($('fTitle').value.trim().length > 120) return '标题超过 120 字';
    if ($('fDesc').value.trim().length > 300) return '描述超过 300 字';
  } else {
    const cat = $('fCategory').value;
    if (!cat) return '请选择分类';
    if (cat.length > 12) return '分类名超过 12 字';
    if ($('fLocation').value.trim().length > 60) return '地点超过 60 字';
    if ($('fMood').value.trim().length > 8) return '心情只放一个 emoji';
    if (!$('fDraft').checked && !$('body').value.trim() && !state.images.length) {
      return '正文和配图都空着，加点什么再发';
    }
  }
  return '';
}

function commitMessage() {
  if (state.type === 'note') {
    const cat = $('fCategory').value || '说说';
    return `note: ${cat} · ${$('fDate').value.replace('T', ' ')}`;
  }
  return `post: ${$('fTitle').value.trim() || '无标题'}`;
}

async function save(publish) {
  if (state.busy) return;

  const problem = validate();
  if (problem) {
    status(problem, 'err');
    return;
  }

  state.busy = true;
  setButtons(true);

  try {
    state.author = $('fAuthor').value.trim();
    saveSettings();

    const payload = { type: state.type, filename: state.filename, data: collect(), body: $('body').value };
    status('保存中…', 'busy');
    const res = await postJSON('/api/save', payload);
    state.filename = res.filename;
    setDirty(false);
    clearDraft();
    status(`已保存 ${res.path}`, 'ok');
    await refreshList();

    if (publish) {
      status('提交并推送到 GitHub…', 'busy');
      const out = await postJSON('/api/publish', { message: commitMessage() });
      if (!out.ok) {
        status(`发布失败（${out.step}）：${out.output.split('\n').filter(Boolean).slice(-2).join(' ')}`, 'err');
        console.warn(out.output);
      } else if (out.step === 'noop') {
        status('已保存，但没有需要提交的改动', 'ok');
      } else {
        status('已推送，EdgeOne 会自动重新构建', 'ok');
      }
      await refreshGit();
    }
  } catch (err) {
    status(err.message, 'err');
  } finally {
    state.busy = false;
    setButtons(false);
  }
}

function setButtons(disabled) {
  ['btnSave', 'btnSaveDraft', 'btnPublish'].forEach((id) => {
    $(id).disabled = disabled;
  });
}

/* ---------------- 列表 / git ---------------- */

async function refreshList() {
  const data = await api('/api/list');
  state.items = { note: data.notes, post: data.posts };
  state.categories = data.categories.length ? data.categories : ['杂项'];
  state.defaultAuthor = data.defaultAuthor || '站长';

  const catSelect = $('fCategory');
  if (!catSelect.options.length) {
    state.categories.forEach((c) => catSelect.add(new Option(c, c)));
    catSelect.value = state.categories.includes('杂项') ? '杂项' : state.categories[0];
  }

  if (!$('fAuthor').value.trim()) $('fAuthor').value = state.author || state.defaultAuthor;

  updateGitPill(data.git);
  if ($('overlay').classList.contains('is-open')) renderLibrary();
}

function updateGitPill(git) {
  const parts = [git.branch];
  if (git.dirty) parts.push(`${git.dirty} 处改动`);
  if (git.ahead) parts.push(`待推送 ${git.ahead}`);
  const pill = $('gitPill');
  pill.textContent = parts.join(' · ');
  pill.classList.toggle('is-dirty', Boolean(git.dirty || git.ahead));
  pill.title = git.files.length ? git.files.join('\n') : '工作区干净';
}

async function refreshGit() {
  try {
    updateGitPill(await api('/api/git'));
  } catch {
    /* 忽略 */
  }
}

/* ---------------- 内容库 ---------------- */

function openLibrary() {
  $('overlay').classList.add('is-open');
  $('libSearch').value = '';
  renderLibrary();
  setTimeout(() => $('libSearch').focus(), 30);
}

function closeLibrary() {
  $('overlay').classList.remove('is-open');
}

function renderLibrary() {
  const q = $('libSearch').value.trim().toLowerCase();
  const filter = state.libFilter;

  const rows = [];
  for (const type of ['note', 'post']) {
    if (filter === 'note' || filter === 'post') {
      if (filter !== type) continue;
    }
    for (const it of state.items[type] || []) {
      if (filter === 'draft' && !it.draft) continue;
      const hay = `${it.title} ${it.summary} ${it.pubDate} ${it.filename} ${it.category || ''}`.toLowerCase();
      if (q && !hay.includes(q)) continue;
      rows.push(it);
    }
  }

  rows.sort((a, b) => String(b.pubDate).localeCompare(String(a.pubDate)));

  const list = $('libList');
  if (!rows.length) {
    list.innerHTML = `<p class="library__empty">${q ? '没有匹配的内容' : '还没有内容'}</p>`;
    $('libCount').textContent = '0 条';
    return;
  }

  list.innerHTML = rows
    .map((it) => {
      const label = it.type === 'note' ? '说说' : '文章';
      const title = it.type === 'post' ? it.title : `${it.category || '说说'}${it.summary ? ` · ${it.summary}` : ''}`;
      const bits = [it.pubDate || '—'];
      if (it.type === 'note' && it.imageCount) bits.push(`${it.imageCount} 张图`);
      return `
        <div class="lib-row" data-type="${it.type}" data-file="${escapeHtml(it.filename)}">
          <span class="lib-badge${it.type === 'post' ? ' lib-badge--post' : ''}">${label}</span>
          <div class="lib-row__meta">
            <div class="lib-row__title">${escapeHtml(title)}${it.draft ? '<span class="lib-row__draft">草稿</span>' : ''}</div>
            <div class="lib-row__sub">${escapeHtml(bits.join(' · '))}　${escapeHtml(it.filename)}</div>
          </div>
          <button class="lib-row__del" type="button" data-del="${escapeHtml(it.filename)}" data-type="${it.type}">删除</button>
        </div>`;
    })
    .join('');

  $('libCount').textContent = `共 ${rows.length} 条`;
}

async function openItem(type, filename) {
  if (state.dirty && !confirm('打开其他内容会丢掉当前未保存的修改，继续？')) return;
  try {
    setType(type, { force: true });
    const data = await api(`/api/item?type=${type}&filename=${encodeURIComponent(filename)}`);
    state.filename = data.filename;
    applyItem(data.data);
    $('body').value = data.body.trim();
    if (type === 'post') $('fSlug').value = data.filename.replace(/\.mdx?$/, '');
    setDirty(false);
    clearDraft();
    renderAvatar();
    renderThumbs();
    renderPreview();
    closeLibrary();
    status(`已打开 ${filename}`, 'ok');
  } catch (err) {
    status(err.message, 'err');
  }
}

async function deleteItem(type, filename) {
  if (!confirm(`删除「${filename}」？\n\n文件会移到 .trash/ 目录，需要时可以手动恢复。`)) return;
  try {
    const res = await postJSON('/api/delete', { type, filename });
    if (state.filename === filename) {
      state.filename = '';
      state.dirty = false;
    }
    await refreshList();
    renderLibrary();
    status(`已删除，移到 ${res.trashed}`, 'ok');
  } catch (err) {
    status(err.message, 'err');
  }
}

/* ---------------- 主题 ---------------- */

function applyTheme(next) {
  const root = document.documentElement;
  root.classList.add('is-switching');
  setTimeout(() => root.classList.remove('is-switching'), 220);
  root.setAttribute('data-theme', next);
  try {
    localStorage.setItem('studio-theme', next);
  } catch {
    /* 忽略 */
  }
}

function toggleTheme() {
  const current = document.documentElement.getAttribute('data-theme');
  applyTheme(current === 'dark' ? 'light' : 'dark');
}

/* ---------------- 类型切换 ---------------- */

function isDirty() {
  return state.dirty;
}

function setDirty(v) {
  state.dirty = Boolean(v);
  const flag = $('dirtyFlag');
  if (flag) flag.classList.toggle('is-on', state.dirty);
  const dot = document.querySelector('.brand__dot');
  if (dot) dot.classList.toggle('is-dirty', state.dirty);
  if (state.dirty) scheduleDraft();
}

function markDirty() {
  setDirty(true);
}

/* ---------------- 自动保存草稿（localStorage，30s 防抖） ---------------- */

const DRAFT_KEY = 'studio-draft';
let draftTimer = null;

function scheduleDraft() {
  clearTimeout(draftTimer);
  draftTimer = setTimeout(persistDraft, 30000);
}

function persistDraft() {
  try {
    localStorage.setItem(
      DRAFT_KEY,
      JSON.stringify({
        type: state.type,
        filename: state.filename,
        body: $('body').value,
        fields: {
          fTitle: $('fTitle').value,
          fDesc: $('fDesc').value,
          fSlug: $('fSlug').value,
          fCategory: $('fCategory').value,
          fLocation: $('fLocation').value,
          fMood: $('fMood').value,
          fDate: $('fDate').value,
          fTags: $('fTags').value,
          fAuthor: $('fAuthor').value,
          fCover: $('fCover').value,
          fPinned: $('fPinned').checked,
          fDraft: $('fDraft').checked,
          fComments: $('fComments').checked,
          images: state.images,
          avatar: state.avatar,
        },
      })
    );
  } catch {
    /* 忽略 */
  }
}

function clearDraft() {
  try {
    localStorage.removeItem(DRAFT_KEY);
  } catch {
    /* 忽略 */
  }
}

function renderLiveStats() {
  const t = $('body').value;
  const chars = t.replace(/\s/g, '').length;
  const paras = t.trim() ? t.trim().split(/\n\s*\n/).filter(Boolean).length : 0;
  const mins = Math.max(1, Math.round(chars / 400));
  const el = $('liveStats');
  if (el) el.textContent = `${chars} 字 · ${paras} 段 · 约 ${mins} 分钟`;
}

function restoreDraft() {
  let raw;
  try {
    raw = localStorage.getItem(DRAFT_KEY);
  } catch {
    return false;
  }
  if (!raw) return false;
  let d;
  try {
    d = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!d || !d.body || !d.body.trim()) return false;
  if (
    !confirm('检测到上次未保存的草稿，是否恢复？\n（选「取消」会保留当前空白，草稿将在下次编辑时被覆盖）')
  ) {
    clearDraft();
    return false;
  }
  setType(d.type === 'post' ? 'post' : 'note', { force: true });
  const f = d.fields || {};
  $('fTitle').value = f.fTitle || '';
  $('fDesc').value = f.fDesc || '';
  $('fSlug').value = f.fSlug || '';
  $('fCategory').value = f.fCategory || '杂项';
  $('fLocation').value = f.fLocation || '';
  $('fMood').value = f.fMood || '';
  $('fDate').value = f.fDate || '';
  $('fTags').value = f.fTags || '';
  $('fAuthor').value = f.fAuthor || '';
  $('fCover').value = f.fCover || '';
  $('fPinned').checked = Boolean(f.fPinned);
  $('fDraft').checked = Boolean(f.fDraft);
  $('fComments').checked = Boolean(f.fComments);
  state.images = Array.isArray(f.images) ? f.images.filter(Boolean) : [];
  state.avatar = f.avatar || state.settingsAvatar || '';
  $('body').value = d.body;
  state.filename = d.filename || '';
  setDirty(true);
  renderAvatar();
  renderThumbs();
  renderPreview();
  return true;
}

function setType(type, { force = false } = {}) {
  if (type === state.type && !force) return;
  if (isDirty() && !force && !confirm('切换类型会清空当前内容，继续？')) return;

  state.type = type;
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('is-active', t.dataset.type === type));

  document.querySelectorAll('[data-for]').forEach((el) => {
    el.style.display = el.dataset.for === type ? '' : 'none';
  });

  $('dateLabel').textContent = type === 'note' ? '时间' : '发布日期';
  $('fDate').type = type === 'note' ? 'datetime-local' : 'date';
  $('dropHint').textContent = type === 'note' ? '说说：进九宫格' : '文章：插入正文';
  $('imgHint').textContent = type === 'note' ? '自动转 webp · 长边压到 1600' : '插入正文的图片同样会压缩';

  resetForm();
  $('body').placeholder = type === 'note' ? '随便写点什么…' : '正文从这里开始，支持 Markdown';
  status(type === 'note' ? '新建说说' : '新建文章');
}

/* ---------------- 事件绑定 ---------------- */

function bind() {
  document.querySelectorAll('.tab').forEach((tab) => {
    tab.addEventListener('click', () => setType(tab.dataset.type));
  });

  $('btnTheme').addEventListener('click', toggleTheme);

  $('btnPreviewToggle').addEventListener('click', () => {
    const app = document.querySelector('.app');
    const on = app.classList.toggle('show-preview');
    $('btnPreviewToggle').textContent = on ? '隐藏预览' : '预览';
  });

  $('btnNew').addEventListener('click', () => {
    if (isDirty() && !confirm('新建会清空当前内容，继续？')) return;
    resetForm();
    clearDraft();
    status('已清空，开始写新的');
  });

  $('btnLibrary').addEventListener('click', openLibrary);
  $('overlay').addEventListener('click', (e) => {
    if (e.target === $('overlay')) closeLibrary();
  });

  $('libSearch').addEventListener('input', renderLibrary);

  $('libFilters').addEventListener('click', (e) => {
    const chip = e.target.closest('[data-filter]');
    if (!chip) return;
    state.libFilter = chip.dataset.filter;
    $('libFilters').querySelectorAll('.chip').forEach((c) => c.classList.toggle('is-active', c === chip));
    renderLibrary();
  });

  $('libList').addEventListener('click', (e) => {
    const del = e.target.closest('[data-del]');
    if (del) {
      e.stopPropagation();
      deleteItem(del.dataset.type, del.dataset.del);
      return;
    }
    const row = e.target.closest('.lib-row');
    if (row) openItem(row.dataset.type, row.dataset.file);
  });

  ['fCategory', 'fMood', 'fLocation', 'fDate', 'fTitle', 'fDesc', 'fSlug', 'fAuthor'].forEach((id) => {
    $(id).addEventListener('input', () => {
      markDirty();
      renderPreview();
    });
    $(id).addEventListener('change', renderPreview);
  });

  $('fTitle').addEventListener('input', () => {
    if (state.type !== 'post' || $('fSlug').value.trim()) return;
    const s = $('fTitle').value.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
    $('slugPreview').textContent = s || 'slug';
  });

  $('fSlug').addEventListener('input', () => {
    $('slugPreview').textContent = $('fSlug').value.trim() || 'slug';
  });

  $('body').addEventListener('input', () => {
    markDirty();
    renderPreview();
  });

  $('fTags').addEventListener('input', markDirty);
  $('fPinned').addEventListener('change', markDirty);
  $('fDraft').addEventListener('change', markDirty);
  $('fComments').addEventListener('change', markDirty);
  $('fCover').addEventListener('input', markDirty);

  $('toolbar').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-md]');
    if (btn) runToolbar(btn.dataset.md);
  });

  $('thumbs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-del]');
    if (!btn) return;
    state.images.splice(Number(btn.dataset.del), 1);
    markDirty();
    renderThumbs();
    renderPreview();
  });

  $('btnPick').addEventListener('click', () => $('filePicker').click());
  $('filePicker').addEventListener('change', (e) => {
    uploadFiles(e.target.files);
    e.target.value = '';
  });

  $('btnAvatar').addEventListener('click', () => $('avatarPicker').click());
  $('avatarPicker').addEventListener('change', (e) => {
    if (e.target.files[0]) uploadAvatar(e.target.files[0]);
    e.target.value = '';
  });
  $('btnAvatarClear').addEventListener('click', () => {
    state.avatar = '';
    state.settingsAvatar = '';
    saveSettings();
    renderAvatar();
    markDirty();
  });

  const dz = $('dropzone');
  ['dragenter', 'dragover'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.add('is-over');
    })
  );
  ['dragleave', 'drop'].forEach((ev) =>
    dz.addEventListener(ev, (e) => {
      e.preventDefault();
      dz.classList.remove('is-over');
    })
  );
  dz.addEventListener('drop', (e) => uploadFiles(e.dataTransfer.files));

  $('body').addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (!files.length) return;
    e.preventDefault();
    uploadFiles(files);
  });

  $('btnSave').addEventListener('click', () => save(false));
  $('btnSaveDraft').addEventListener('click', () => {
    $('fDraft').checked = true;
    save(false);
  });
  $('btnPublish').addEventListener('click', () => save(true));

  document.addEventListener('keydown', (e) => {
    const mod = e.ctrlKey || e.metaKey;

    if (e.key === 'Escape') {
      closeLibrary();
      return;
    }

    if (mod && e.key.toLowerCase() === 'k') {
      e.preventDefault();
      openLibrary();
      return;
    }

    if (mod && e.key.toLowerCase() === 's') {
      e.preventDefault();
      save(false);
      return;
    }

    if (mod && document.activeElement === $('body')) {
      const k = e.key.toLowerCase();
      if (k === 'b') {
        e.preventDefault();
        runToolbar('bold');
      } else if (k === 'i') {
        e.preventDefault();
        runToolbar('italic');
      }
    }
  });

  window.addEventListener('beforeunload', (e) => {
    if (isDirty()) e.preventDefault();
  });
}

/* ---------------- 启动 ---------------- */

async function boot() {
  loadSettings();

  $('moodQuick').innerHTML = MOODS.map((m) => `<button type="button" data-mood="${m}">${m}</button>`).join('');
  $('moodQuick').addEventListener('click', (e) => {
    const b = e.target.closest('[data-mood]');
    if (!b) return;
    $('fMood').value = $('fMood').value === b.dataset.mood ? '' : b.dataset.mood;
    markDirty();
    renderPreview();
  });

  bind();
  const initial = location.hash.replace('#', '');
  setType(initial === 'post' ? 'post' : 'note', { force: true });

  try {
    await refreshList();
    renderPreview();
    const restored = restoreDraft();
    status(restored ? '已恢复上次未保存的草稿' : '就绪 · Ctrl+K 内容库 · Ctrl+S 保存');
  } catch (err) {
    status(`读取失败：${err.message}`, 'err');
  }
}

boot();
