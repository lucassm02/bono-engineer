/**
 * `npm run site:serve`: servidor estático simples para ver o site (porta 5180, ou SITE_PORT).
 * Serve `site/dist` na raiz e também sob `/bono-engineer/`, como no GitHub Pages; um caminho que
 * não existe devolve `404.html` com status 404, igual ao Pages.
 */
import { existsSync, readFileSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SITE, SITE_DIR } from './config.mjs';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
};

export function startServer({
  dir = join(SITE_DIR, 'dist'),
  port = Number(process.env.SITE_PORT ?? 5180),
} = {}) {
  const server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? '/', 'http://x').pathname);
    if (path === SITE.base || path.startsWith(`${SITE.base}/`))
      path = path.slice(SITE.base.length) || '/';
    let file = normalize(join(dir, path));
    if (!file.startsWith(dir)) file = join(dir, '404.html');
    if (existsSync(file) && statSync(file).isDirectory()) {
      if (!path.endsWith('/')) {
        res.writeHead(301, { location: `${req.url}/` }).end();
        return;
      }
      file = join(file, 'index.html');
    }
    const found = existsSync(file);
    const target = found ? file : join(dir, '404.html');
    res.writeHead(found ? 200 : 404, {
      'content-type': TYPES[extname(target)] ?? 'application/octet-stream',
      'cache-control': 'no-store',
    });
    res.end(existsSync(target) ? readFileSync(target) : 'site não gerado: rode npm run site:build');
  });
  return new Promise((resolve) => server.listen(port, () => resolve(server)));
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const server = await startServer();
  console.log(`[site] http://localhost:${server.address().port}/  (e /bono-engineer/)`);
}
