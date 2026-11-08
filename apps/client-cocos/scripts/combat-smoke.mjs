// Headless smoke test of the combat HUD skeleton (`?combat=1`, offline mock combat loop, P3 client groundwork).
//
//   npm run combat:smoke -w client-cocos -- [--skip-build] [--class kiem-tu] [--out <dir>]
//
// Builds web-mobile (unless --skip-build), opens `/?combat=1&npcs=0` in headless Chrome / Edge (CHROME_PATH overrides), then
// drives the real keyboard: Tab selects a target, keys 1-8 cast, and checks through `window.__vgtdCombat.state()` that the
// target is set, MP is spent, cooldown + GCD run, damage reaches the target and Esc clears the target. Writes a screenshot
// (default <tmpdir>/vgtd-combat, not committed). Exit code 1 on a failed check or a page error.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-combat')));
const cls = opt('class', 'kiem-tu');

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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
let failures = 0;
const check = (ok, what) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failures++;
};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  await page.goto(`http://127.0.0.1:${port}/?combat=1&npcs=0&class=${cls}`);
  await page.waitForFunction('window.__vgtdCombat && window.__vgtdPerf && window.__vgtdPerf.fps > 0', {
    timeout: 180000,
    polling: 250,
  });
  await sleep(1500);
  const st = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdCombat.state()))');
  let s = await st();
  console.log(`class ${cls} -> path ${s.path}, slots: ${s.slots.map((x) => x.id).join(', ')}`);
  check(s.slots.length === 8, 'hotbar has 8 slots');
  check(s.target === null, 'no target at start');
  await page.keyboard.press('Tab');
  await sleep(300);
  s = await st();
  check(s.target !== null, 'Tab selects the nearest enemy');
  const target = s.target;
  const mp0 = s.mp;
  // press castable keys in order until one is accepted (a cooldown starts); blocked ones (range / MP) just flash
  for (let k = 0; k < 8; k++) {
    if (!s.slots[k].castable) continue;
    await page.keyboard.press(String(k + 1));
    await sleep(150);
    const cur = await st();
    if (cur.slots[k].cdMs > 0) break;
  }
  s = await st();
  check(s.mp < mp0, `MP spent by a cast (${mp0.toFixed(0)} -> ${s.mp.toFixed(0)})`);
  check(
    s.slots.some((x) => x.cdMs > 0),
    'a slot cooldown is running',
  );
  await sleep(500);
  s = await st();
  check(s.floaters > 0, `floating damage numbers visible (${s.floaters})`);
  mkdirSync(out, { recursive: true });
  await page.screenshot({ path: join(out, 'combat-hud.png') });
  console.log(`screenshot: ${join(out, 'combat-hud.png')}`);
  const e = s.enemies.find((x) => x.id === target);
  check(e.hp < e.hpMax || !e.alive, `target took damage (${e.hp}/${e.hpMax})`);
  await page.keyboard.press('Escape');
  await sleep(200);
  s = await st();
  check(s.target === null, 'Esc clears the target');
} finally {
  await browser.close();
  server.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
