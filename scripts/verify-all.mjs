/**
 * 一键验收：起静态服务 → 跑构建校验 → 跑冒烟测试 → 关服务。
 *
 * 为什么需要它？
 * smoke-test.mjs 要发 HTTP 请求，必须有个服务在跑；
 * 而 serve.mjs 和 smoke-test 的端口默认值原本不一致，手动跑很容易踩空。
 * 这里统一在一个进程里起服务、注入 BASE，跑完自动清理。
 *
 * 单独跑某一项仍然可以：
 *   node scripts/verify-build.mjs
 *   BASE=http://127.0.0.1:4321 node scripts/smoke-test.mjs
 */
import { spawn } from 'node:child_process';

const PORT = Number(process.env.VERIFY_PORT ?? 4399);
const BASE = `http://127.0.0.1:${PORT}`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const server = spawn(
  process.execPath,
  ['scripts/serve.mjs', String(PORT), '.edgeone/assets'],
  { stdio: 'ignore' }
);

/** 等服务起来，最多等 10 秒 */
async function waitUp() {
  for (let i = 0; i < 40; i++) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return true;
    } catch {
      /* 还没起来 */
    }
    await sleep(250);
  }
  return false;
}

function run(script) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [script], {
      stdio: 'inherit',
      env: { ...process.env, BASE },
    });
    child.on('exit', (code) => resolve(code ?? 1));
  });
}

let failed = 0;
try {
  if (!(await waitUp())) {
    console.error(`\n✗ 静态服务没能在 ${PORT} 端口启动，请确认已经执行过 npm run build`);
    process.exit(1);
  }

  failed += await run('scripts/verify-build.mjs');
  failed += await run('scripts/smoke-test.mjs');
} finally {
  server.kill();
}

console.log(
  failed === 0 ? '\n✓ 全部验收通过' : `\n✗ 有 ${failed} 项检查未通过`
);
process.exit(failed === 0 ? 0 : 1);
