// Headless check of the major breakthrough presentation (D97): the real Cocos web build in headless Chrome, the Tâm Ma overlay, the Lôi Kiếp
// overlay, procedural lightning bolts and the result card, fed with server-shaped messages through `window.__vgtdMajor` (the dev server
// cannot be asked to run a breakthrough for a bot; the server side is covered by apps/server/tests/major-breakthrough.test.ts).
//
//   npm run major:vfx -w client-cocos -- [--skip-build] [--out <dir>]
//
// Writes screenshots (default <tmpdir>/vgtd-major-vfx). Exit code 1 on a failed check or a page error.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createReadStream, existsSync, mkdirSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const out = resolve(opt('out', join(tmpdir(), 'vgtd-major-vfx')));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function findBrowser() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const found = candidates.find((p) => existsSync(p));
  if (!found) throw new Error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser executable.');
  return found;
}

function freePort() {
  return new Promise((res, rej) => {
    const s = createNetServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = s.address().port;
      s.close(() => res(p));
    });
  });
}

if (!args.includes('--skip-build')) {
  const b = spawnSync(process.execPath, [join(root, 'scripts/build-web.mjs')], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const webDir = join(root, 'build/web-mobile');
if (!existsSync(join(webDir, 'index.html'))) throw new Error('build/web-mobile missing: run without --skip-build');

const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};
const web = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let f = join(webDir, p || 'index.html');
  if (!f.startsWith(webDir) || !existsSync(f)) return void res.writeHead(404).end();
  if (statSync(f).isDirectory()) f = join(f, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => web.listen(0, '127.0.0.1', r)); // loopback only
const webPort = web.address().port;
const gwPort = await freePort();

// the game server: local-only, throw-away accounts, monsters + combat on
const server = spawn(process.execPath, [join(root, '../server/scripts/dev.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PORT: String(gwPort),
    HOST: '127.0.0.1',
    CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
    REGISTER_PER_IP_PER_DAY: '0',
    MOBS: '1',
    COMBAT: '1',
  },
});
await new Promise((resolveReady, reject) => {
  const t = setTimeout(() => reject(new Error('server did not start in 60 s')), 60_000);
  server.stdout.on('data', (d) => {
    if (String(d).includes('listening')) {
      clearTimeout(t);
      resolveReady();
    }
  });
  server.on('exit', (c) => reject(new Error(`server exited with ${c}`)));
});

let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: 'new',
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1 },
  protocolTimeout: 600000,
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  await page.goto(
    `http://127.0.0.1:${webPort}/?online=1&combat=1&npcs=0&class=kiem&server=127.0.0.1:${gwPort}&name=major${Date.now() % 100000}`,
  );
  await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdMajor', {
    timeout: 120000,
    polling: 250,
  });
  await sleep(2500);
  mkdirSync(out, { recursive: true });
  const st = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdMajor.state()))');
  const ev = (o) =>
    page.evaluate(
      `window.__vgtdMajor.event(${JSON.stringify({ type: 'major_event', wave: 0, waves: 3, remainingMs: 0, strengthPct: 120, result: 0, tier: 0, expLostPct: 0, lockMin: 0, tamMaId: 0, ...o })})`,
    );
  let s = await st();
  check(!s.active && !s.tint && !s.titleShown, 'nothing is drawn while no event runs');

  await ev({ phase: 1, remainingMs: 90000, tamMaId: 2000000 });
  await sleep(400);
  s = await st();
  check(s.active && s.tint && s.titleShown && /Tâm Ma/.test(s.title), `Tâm Ma overlay: tint + headline ("${s.title}")`);
  await page.screenshot({ path: join(out, 'tam-ma.png') });

  await ev({ phase: 3, wave: 1, remainingMs: 0 });
  await sleep(200);
  const me = await page.evaluate('window.__vgtdOnline().self'); // strike where the player stands so the bolt is on screen
  await page.evaluate(
    `window.__vgtdMajor.strike({ wave: 1, waves: 3, strike: 0, qi: ${Math.round(me.i * 32)}, qj: ${Math.round(me.j * 32)}, damage: 4200 })`,
  );
  await sleep(120);
  s = await st();
  check(/Lôi Kiếp: đạo 1\/3/.test(s.title), `Lôi Kiếp headline ("${s.title}")`);
  check(s.bolts >= 1, 'a lightning bolt is drawn when the server reports a hit');
  await page.screenshot({ path: join(out, 'lightning.png') });
  await sleep(900);
  s = await st();
  check(s.bolts === 0, 'the bolt fades away');

  await ev({ phase: 4, result: 1 });
  await sleep(300);
  s = await st();
  check(!s.active && !s.tint && s.cardShown && /thành công/.test(s.card), `success card ("${s.card}")`);
  await page.screenshot({ path: join(out, 'result-success.png') });
  await ev({ phase: 4, result: 4, tier: 3, expLostPct: 50, lockMin: 1440, wave: 0 });
  await sleep(300);
  s = await st();
  check(
    s.cardShown && /Nặng/.test(s.card) && /50%/.test(s.card) && /24 giờ/.test(s.card),
    `Nặng result card ("${s.card.replace(/\n/g, ' | ')}")`,
  );
  console.log(`screenshots: ${out}`);
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
