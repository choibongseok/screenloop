// dist 를 /screenloop/ 아래에 서빙한다(GitHub Pages 프로젝트 사이트와 같은 경로 구조).
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize } from 'node:path';

const port = Number(process.env.PORT || 4274);
const root = join(import.meta.dirname, 'dist');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json' };

createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  if (!url.pathname.startsWith('/screenloop/')) {
    res.writeHead(url.pathname === '/' ? 302 : 404, { Location: '/screenloop/' }).end();
    return;
  }
  let p = normalize(url.pathname.slice('/screenloop/'.length));
  if (p === '.' || p === '' || p.endsWith('/')) p = join(p === '.' ? '' : p, 'index.html');
  if (p.startsWith('..')) {
    res.writeHead(400).end();
    return;
  }
  try {
    const b = await readFile(join(root, p));
    res.writeHead(200, { 'Content-Type': types[extname(p)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(b);
  } catch {
    res.writeHead(404).end('not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}/screenloop/`));
