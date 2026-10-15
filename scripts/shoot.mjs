// 用 Chrome DevTools Protocol 截图，可精确控制主题（localStorage / data-theme）。
// 用法: node scripts/shoot.mjs
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('.preview');
const PORT = 9222;
const BASE = 'http://127.0.0.1:4399';

fs.mkdirSync(OUT, { recursive: true });

const profile = path.join(process.env.TEMP ?? '.', 'shot-' + Date.now());
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
    '--window-size=1280,1200',
    'about:blank',
  ],
  { stdio: 'ignore' }
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 等待 CDP 就绪并取回 websocket 调试地址 */
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

// 极简 CDP 客户端（Node 22+ 自带 WebSocket）
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

// 挂到 browser target，再创建一个 page target
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });

await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);
await cdp.send('Emulation.setDeviceMetricsOverride',
  { width: 1280, height: 1200, deviceScaleFactor: 1, mobile: false }, sessionId);

async function shoot(name, url, { theme, height = 1200, fullPage = false } = {}) {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: 1280, height, deviceScaleFactor: 1, mobile: false }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(1400);

  if (theme) {
    // 写入 localStorage 并立即应用，确保截图反映真实主题
    await cdp.send('Runtime.evaluate', {
      expression: `(() => {
        localStorage.setItem('theme', '${theme}');
        document.documentElement.setAttribute('data-theme', '${theme}');
      })()`,
    }, sessionId);
    await sleep(500);
  }

  let clip;
  if (fullPage) {
    const { result } = await cdp.send('Runtime.evaluate', {
      expression: 'JSON.stringify({w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight})',
      returnByValue: true,
    }, sessionId);
    const { w, h } = JSON.parse(result.value);
    await cdp.send('Emulation.setDeviceMetricsOverride',
      { width: 1280, height: Math.min(h, 8000), deviceScaleFactor: 1, mobile: false }, sessionId);
    await sleep(400);
    clip = { x: 0, y: 0, width: w, height: Math.min(h, 8000), scale: 1 };
  }

  const shot = await cdp.send('Page.captureScreenshot',
    { format: 'png', captureBeyondViewport: fullPage, ...(clip ? { clip } : {}) }, sessionId);
  const file = path.join(OUT, `${name}.png`);
  fs.writeFileSync(file, Buffer.from(shot.data, 'base64'));
  console.log(`✓ ${name}.png  (${(fs.statSync(file).size / 1024).toFixed(0)} KB)`);
}

await shoot('light-home', `${BASE}/`, { theme: 'light' });
await shoot('dark-home', `${BASE}/`, { theme: 'dark' });
await shoot('dark-post', `${BASE}/blog/astro-blog-guide/`, { theme: 'dark' });
await shoot('mobile-home', `${BASE}/`, { theme: 'light', height: 900 });

// 移动端：窄视口
await cdp.send('Emulation.setDeviceMetricsOverride',
  { width: 390, height: 900, deviceScaleFactor: 1, mobile: true }, sessionId);
await cdp.send('Page.navigate', { url: `${BASE}/blog/hello-world/` }, sessionId);
await sleep(1500);
{
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(OUT, 'mobile-post.png'), Buffer.from(shot.data, 'base64'));
  console.log('✓ mobile-post.png');
}

chrome.kill();
fs.rmSync(profile, { recursive: true, force: true });
console.log('完成');
process.exit(0);
