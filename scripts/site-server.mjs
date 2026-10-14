import { createServer } from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { repository } from './site-build.mjs';

export function siteServer({ root = path.join(repository, '_site'), base = '/echo/' } = {}) {
  if (!/^\/(?:[a-zA-Z0-9_-]+\/)*$/.test(base)) throw new Error('Base must be a slash-delimited absolute URL path');
  const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json', '.png': 'image/png', '.webp': 'image/webp', '.avif': 'image/avif', '.ico': 'image/x-icon', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };
  return createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      // Inspect the raw path before URL normalization can erase traversal.
      const raw = decodeURIComponent(request.url.split('?')[0]);
      if (!raw.startsWith(base) || raw.includes('\\') || raw.split('/').includes('..') || raw.includes('\0')) {
        response.writeHead(404).end('Not found'); return;
      }
      const relative = raw.slice(base.length) || 'index.html';
      const filename = path.resolve(root, relative);
      const realRoot = await realpath(root);
      const realFile = await realpath(filename);
      if (!filename.startsWith(path.resolve(root) + path.sep) || !realFile.startsWith(realRoot + path.sep) || !(await stat(filename)).isFile()) {
        response.writeHead(404).end('Not found'); return;
      }
      const content = await readFile(filename);
      response.writeHead(200, { 'Content-Type': types[path.extname(filename)] ?? 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
      response.end(request.method === 'HEAD' ? undefined : content);
    } catch { response.writeHead(404).end('Not found'); }
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT ?? 4173);
  const base = process.env.SITE_BASE ?? '/echo/';
  siteServer({ base }).listen(port, '127.0.0.1', () => console.log(`Serving _site at http://127.0.0.1:${port}${base}`));
}
