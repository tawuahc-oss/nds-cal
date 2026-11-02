import http from 'node:http';
import { readFile } from 'node:fs/promises';
const pages = new Set(['index.html', 'login-test.html', 'categories-admin.html', 'events-admin.html', 'recurrences-admin.html']);
const server = http.createServer(async (req, res) => {
  if (!['GET', 'HEAD'].includes(req.method)) { res.writeHead(405); res.end(); return; }
  const path = new URL(req.url, 'http://localhost').pathname;
  const name = path === '/' ? 'index.html' : path.slice(1);
  const asset=/^assets\/[\w./-]+\.(?:js|css|json|ttf)$/.test(name) && !name.split('/').includes('..');
  if (!pages.has(name) && !asset) { res.writeHead(404); res.end('Not found'); return; }
  try {
    const body = await readFile(new URL(name, import.meta.url));
    const type=name.endsWith('.js')?'text/javascript':name.endsWith('.css')?'text/css':name.endsWith('.json')?'application/json':name.endsWith('.ttf')?'font/ttf':'text/html';
    res.writeHead(200, {'Content-Type': type+'; charset=utf-8', 'Cache-Control': 'no-store'});
    res.end(req.method === 'HEAD' ? undefined : body);
  } catch { res.writeHead(500); res.end('Unable to read page'); }
});
server.on('error', error => { console.error(error.message); process.exitCode = 1; });
server.listen(8080, '127.0.0.1', () => console.log('nds-cal: http://127.0.0.1:8080'));
