// Tiny static server for build/web-mobile: node scripts/serve.mjs [port]
import { createServer } from 'node:http';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { networkInterfaces } from 'node:os';
import { fileURLToPath } from 'node:url';

const dir = resolve(dirname(fileURLToPath(import.meta.url)), '../build/web-mobile');
const port = Number(process.argv[2] || 8456);
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};
createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let f = join(dir, p || 'index.html');
  if (!f.startsWith(dir)) {
    res.writeHead(403).end();
    return;
  }
  if (existsSync(f) && statSync(f).isDirectory()) f = join(f, 'index.html');
  if (!existsSync(f)) {
    res.writeHead(404).end('not found');
    return;
  }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
}).listen(port, () => {
  console.log(`serving ${dir} on http://localhost:${port}`);
  // listens on all interfaces: open one of these on a phone on the same Wi-Fi (e.g. ?npcs=20 for the P1 perf scene)
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? [])
      if (a.family === 'IPv4' && !a.internal) console.log(`  LAN: http://${a.address}:${port}/?npcs=20`);
  }
});
