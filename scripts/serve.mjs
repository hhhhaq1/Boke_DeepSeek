// 极简静态服务器，用于本地验收构建产物（仅依赖 Node 内置模块）。
// 用法: node scripts/serve.mjs [port] [dir]
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const port = Number(process.argv[2] ?? 4321);
const root = path.resolve(process.argv[3] ?? '.edgeone/assets');

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

const server = http.createServer((req, res) => {
  let pathname;
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad Request');
    return;
  }

  // 依次尝试：原文件 -> 作为目录取 index.html -> 补 .html -> 404
  const candidates = [
    path.join(root, pathname),
    path.join(root, pathname, 'index.html'),
    path.join(root, `${pathname}.html`),
  ];

  for (const candidate of candidates) {
    // 防目录穿越
    if (!candidate.startsWith(root)) break;
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) {
      const ext = path.extname(candidate).toLowerCase();
      res.writeHead(200, {
        'content-type': MIME[ext] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      fs.createReadStream(candidate).pipe(res);
      return;
    }
  }

  const notFound = path.join(root, '404.html');
  res.writeHead(404, { 'content-type': 'text/html; charset=utf-8' });
  if (fs.existsSync(notFound)) fs.createReadStream(notFound).pipe(res);
  else res.end('404 Not Found');
});

server.listen(port, '127.0.0.1', () => {
  console.log(`静态服务器已启动: http://127.0.0.1:${port}/  (根目录: ${root})`);
});
