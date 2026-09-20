// Minimal static file server. Shared by the screenshot harness and the test
// runner. ES modules will not load over file://, so every tool that opens a
// page in a browser needs this.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, resolve } from 'node:path';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.woff2': 'font/woff2',
};

/**
 * Start a static server on an ephemeral port.
 * @param {string} root directory to serve
 * @returns {Promise<{port:number, url:string, close:()=>Promise<void>}>}
 */
export function serve(root = '.') {
  const base = resolve(root);
  const server = createServer(async (req, res) => {
    const path = decodeURIComponent(req.url.split('?')[0]);
    const file = join(base, normalize(path === '/' ? '/index.html' : path));
    if (!file.startsWith(base)) { res.writeHead(403).end('forbidden'); return; }
    try {
      const body = await readFile(file);
      res.writeHead(200, {
        'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
        'cache-control': 'no-store',
      });
      res.end(body);
    } catch {
      res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
    }
  });
  return new Promise(ok => server.listen(0, '127.0.0.1', () => {
    const { port } = server.address();
    ok({
      port,
      url: `http://127.0.0.1:${port}`,
      close: () => new Promise(done => server.close(done)),
    });
  }));
}

/** The Chromium that ships with this environment. */
export const CHROMIUM = process.env.UNFOLD_CHROMIUM ?? '/opt/pw-browsers/chromium';
