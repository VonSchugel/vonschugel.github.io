import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { ROOT } from './build.mjs';

const root = path.resolve(ROOT, process.argv.includes('--dist') ? 'dist' : '.');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 4173);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be a number between 1 and 65535.');
const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.ico': 'image/x-icon', '.pdf': 'application/pdf', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8' };

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }).end(); return; }
  let requested;
  try { requested = decodeURIComponent(new URL(request.url, 'http://localhost').pathname); } catch { response.writeHead(400).end('Bad request'); return; }
  let file = path.resolve(root, `.${requested}`);
  if (file !== root && !file.startsWith(`${root}${path.sep}`)) { response.writeHead(403).end('Forbidden'); return; }
  try {
    if ((await stat(file)).isDirectory()) file = path.join(file, 'index.html');
    const content = await readFile(file);
    response.writeHead(200, { 'Content-Type': types[path.extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : content);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Page not found'); }
});
server.listen(port, '127.0.0.1', () => console.log(`Portfolio preview: http://127.0.0.1:${port} (${process.argv.includes('--dist') ? 'built site' : 'source'})`));
