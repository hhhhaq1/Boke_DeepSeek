// 截说说页分类筛选的效果图：默认态 + 点击「旅行」后的筛选态（明/暗各一张）。
// 用法: node scripts/shoot-notes.mjs   （需先有服务跑在 4399）
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('.preview');
const PORT = 9223;
const BASE = 'http://127.0.0.1:4399';

fs.mkdirSync(OUT, { recursive: true });

const profile = path.join(process.env.TEMP ?? '.', 'shot-notes-' + Date.now());
const chrome = spawn(
  CHROME,
  [
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--headless=new',
    '--disable-gpu',
    '--hide-scrollbars',
    '--no-first-run',
    '--no-default-browser-check',
    '--window-size=1280,1400',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpUrl() {
  for (let i = 0; i < 45; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/json/version`);
      const j = await res.json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch {
      /* 还没起来 */
    }
    await sleep(300);
  }
  throw new Error('Chrome CDP 未就绪');
}

const wsUrl = await cdpUrl();

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0;
    this.pending = new Map();
    this.ready = new Promise((res, rej) => {
      this.ws.onopen = res;
      this.ws.onerror = rej;
    });
    this.ws.onmessage = (e) => {
      const msg = JSON.parse(e.data);
      const p = this.pending.get(msg.id);
      if (p) {
        this.pending.delete(msg.id);
        msg.error ? p.reject(new Error(JSON.stringify(msg.error))) : p.resolve(msg.result);
      }
    };
  }
  async send(method, params = {}, sessionId) {
    await this.ready;
    const id = ++this.id;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify({ id, method, params, sessionId }));
    });
  }
}

const cdp = new CDP(wsUrl);
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

async function evaluate(expression) {
  const { result } = await cdp.send(
    'Runtime.evaluate',
    { expression, returnByValue: true, awaitPromise: true },
    sessionId
  );
  return result.value;
}

async function shoot(name, { height = 1400 } = {}) {
  await cdp.send(
    'Emulation.setDeviceMetricsOverride',
    { width: 1280, height, deviceScaleFactor: 1, mobile: false },
    sessionId
  );
  await sleep(500);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`✓ ${name}.png  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

/** 打开说说页并应用主题 */
async function open(theme) {
  await cdp.send('Page.navigate', { url: `${BASE}/notes/` }, sessionId);
  await sleep(1400);
  await evaluate(`(() => {
    localStorage.setItem('theme', '${theme}');
    document.documentElement.setAttribute('data-theme', '${theme}');
  })()`);
  await sleep(500);
  // 主题值必须是 glass / neon，否则内联脚本会回退，截图会张冠李戴
  const applied = await evaluate(`document.documentElement.getAttribute('data-theme')`);
  if (applied !== theme) {
    throw new Error(`主题未生效：期望 ${theme}，实际 ${applied}`);
  }
}

// 默认态：亮色（glass = 日间，neon = 夜间，见 BaseLayout）
await open('glass');
await shoot('notes-cat-all-light');

// 点击「旅行」→ 筛选态：亮色
await evaluate(`(() => {
  const chip = document.querySelector('[data-cat-chip="旅行"]');
  if (chip) chip.click();
})()`);
await sleep(900);
const filtered = await evaluate(
  `JSON.stringify({
     active: document.querySelector('.cat-chip.is-active')?.dataset.catChip,
     count: document.querySelector('[data-notes-count]')?.textContent.trim(),
     visible: Array.from(document.querySelectorAll('.notes-timeline [data-cat]')).filter(el => !el.hidden).length,
     url: location.search,
   })`
);
console.log('  筛选态:', filtered);
await shoot('notes-cat-travel-light');

// 暗色：默认态
await open('neon');
await shoot('notes-cat-all-dark');

// 暗色：筛选态
await evaluate(`(() => {
  const chip = document.querySelector('[data-cat-chip="喝酒"]');
  if (chip) chip.click();
})()`);
await sleep(900);
await shoot('notes-cat-drink-dark');

chrome.kill();
// Chrome 退出时偶尔还占着临时目录，清理失败不影响截图结果
try {
  fs.rmSync(profile, { recursive: true, force: true, maxRetries: 3 });
} catch {
  /* 忽略 */
}
console.log('完成');
process.exit(0);
