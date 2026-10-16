// 移动端截图（窄视口），用于验收响应式布局。
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const OUT = path.resolve('.preview');
const PORT = 9223;
const BASE = 'http://127.0.0.1:4399';

fs.mkdirSync(OUT, { recursive: true });
const profile = path.join(process.env.TEMP ?? '.', 'shotm-' + Date.now());
const chrome = spawn(CHROME, [
  `--remote-debugging-port=${PORT}`,
  `--user-data-dir=${profile}`,
  '--headless=new', '--disable-gpu', '--hide-scrollbars',
  '--no-first-run', '--no-default-browser-check', 'about:blank',
], { stdio: 'ignore' });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function cdpUrl() {
  for (let i = 0; i < 45; i++) {
    try {
      const j = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
      if (j.webSocketDebuggerUrl) return j.webSocketDebuggerUrl;
    } catch { /* 未就绪 */ }
    await sleep(300);
  }
  throw new Error('CDP 未就绪');
}

class CDP {
  constructor(url) {
    this.ws = new WebSocket(url);
    this.id = 0; this.pending = new Map();
    this.ready = new Promise((res, rej) => { this.ws.onopen = res; this.ws.onerror = rej; });
    this.ws.onmessage = (e) => {
      const m = JSON.parse(e.data);
      const p = this.pending.get(m.id);
      if (p) { this.pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
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

const cdp = new CDP(await cdpUrl());
const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
await cdp.send('Page.enable', {}, sessionId);
await cdp.send('Runtime.enable', {}, sessionId);

async function shoot(name, url, w, h, theme = 'glass') {
  await cdp.send('Emulation.setDeviceMetricsOverride',
    { width: w, height: h, deviceScaleFactor: 1, mobile: w < 500 }, sessionId);
  await cdp.send('Page.navigate', { url }, sessionId);
  await sleep(1300);
  await cdp.send('Runtime.evaluate', {
    expression: `document.documentElement.setAttribute('data-theme','${theme}');localStorage.setItem('theme','${theme}');`,
  }, sessionId);
  await sleep(350);
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' }, sessionId);
  fs.writeFileSync(path.join(OUT, `${name}.png`), Buffer.from(shot.data, 'base64'));
  console.log(`✓ ${name}.png (${w}x${h})`);
}

await shoot('m-home', `${BASE}/`, 390, 844);
await shoot('m-post', `${BASE}/blog/hello-world/`, 390, 844);
await shoot('m-posts', `${BASE}/posts/`, 390, 844);
await shoot('m-dark', `${BASE}/blog/comments-comparison/`, 390, 844, 'dark');
await shoot('tablet-home', `${BASE}/`, 820, 900);
await shoot('wide-post', `${BASE}/blog/astro-blog-guide/`, 1600, 1000);

chrome.kill();
console.log('完成');
process.exit(0);
