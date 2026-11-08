// Headless play-test capture of the playable slice with the chibi actor walking in several directions.
//   npm run capture:play -w client-cocos -- [--out <dir>] [--class the-tu] [--dirs E,S,SE,N] [--skip-build]
// Opens the Bootstrap scene with `?class=<id>#chibiwalk=<dirs>` (scripted input, 1.5 s per direction), screenshots the
// viewport every 0.75 s and writes frames + a contact sheet. Prints the actor state (`window.__vgtdChibi`) per shot and
// exits 1 on a page error or when the actor did not move.
import { spawnSync } from 'node:child_process';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { contactSheet, decodePng, encodePng } from './capture-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const out = resolve(opt('out', join(tmpdir(), 'vgtd-capture-play')));
const cls = opt('class', 'the-tu');
const dirs = opt('dirs', 'E,S,SE,N');
const shots = Number(opt('shots', dirs.split(',').length * 2));

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser executable.');

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
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let f = join(webDir, p || 'index.html');
  if (!f.startsWith(webDir) || !existsSync(f)) return void res.writeHead(404).end();
  if (statSync(f).isDirectory()) f = join(f, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); // loopback only
const port = server.address().port;

mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath,
  headless: 'new',
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 2 },
  protocolTimeout: 600000,
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  const url = `http://127.0.0.1:${port}/?class=${cls}#chibiwalk=${dirs}`;
  console.log('opening', url);
  await page.goto(url);
  await page.waitForFunction('window.__vgtdChibi && window.__vgtdChibi.state().shown.drawn', {
    timeout: 180000,
    polling: 250,
  });
  const images = [];
  const first = await page.evaluate('window.__vgtdChibi.state()');
  let last = first;
  for (let n = 0; n < shots; n++) {
    await sleep(750);
    const st = await page.evaluate('window.__vgtdChibi.state()');
    const png = await page.screenshot({ clip: { x: 500, y: 215, width: 280, height: 220 } });
    writeFileSync(join(out, `shot-${String(n).padStart(2, '0')}.png`), png);
    images.push(decodePng(Buffer.from(png)));
    console.log(
      `shot ${n}: ${st.shown.drawn}/${st.shown.clip} pos (${st.pos.i.toFixed(1)}, ${st.pos.j.toFixed(1)}) | ${st.note}`,
    );
    last = st;
  }
  writeFileSync(join(out, 'contact.png'), encodePng(contactSheet(images, 4)));
  const moved = Math.hypot(last.pos.i - first.pos.i, last.pos.j - first.pos.j);
  console.log(`moved ${moved.toFixed(1)} tiles; frames in ${out}`);
  if (moved < 1) {
    console.error('actor did not move');
    failures++;
  }
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
