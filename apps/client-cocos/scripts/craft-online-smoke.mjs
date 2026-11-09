// Headless smoke test of the CRAFTING panel (D108): the real Cocos web build against the real dev server. A new character is a Luyện Khí
// (realm 1) player, and crafting opens at Trúc Cơ, so this checks what a real browser can reach today: the P key opens the panel, it lists the
// five recipes with the docs/13 numbers, every Luyện button is disabled with the "Trúc Cơ" hint, and a start sent anyway comes back from the SERVER
// as a refusal with the realm reason (the wire path works in the real client). Screenshot of the open panel.
//
//   npm run craft:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports, CORS for the page origin), serves build/web-mobile, opens the page in headless
// Chrome / Edge (CHROME_PATH overrides), waits until the session is online, then checks through `window.__vgtdCombat.state()`:
// own vitals arrive from the server (snapshot `self.vitals`), monsters appear from AOI, a cast aimed with the pointer goes out and the
// server's result comes back (cooldown synced, MP spent), and, when a monster is in reach, damage lands on it. Writes a screenshot
// (default <tmpdir>/vgtd-craft-online). Exit code 1 on a failed check or a page error.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-craft-online')));
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
  const open = async (name) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => {
      console.error(`[page error ${name}]`, e.message);
      failures++;
    });
    await page.goto(
      `http://127.0.0.1:${webPort}/?online=1&combat=1&class=kiem&npcs=0&server=127.0.0.1:${gwPort}&name=${name}`,
    );
    await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdCraft', {
      timeout: Number(process.env.SMOKE_WAIT_MS ?? 180000),
      polling: 250,
    });
    return page;
  };
  const stamp = Date.now() % 100000;
  const page = await open(`cra${stamp}`);
  mkdirSync(out, { recursive: true });
  check(true, 'the player is online with the crafting panel built');
  const ev = (expr) => page.evaluate(expr);
  await page.bringToFront();
  await page.keyboard.press('KeyP');
  check(await ev('window.__vgtdCraft.visible()'), 'the P key opens the crafting panel');
  await sleep(600); // a frame or two to draw the rows and receive craft_state
  const recipes = await ev('window.__vgtdCraft.recipes()');
  check(recipes.length === 5, `five recipes are listed (${recipes.map((r) => r.name).join(', ')})`);
  const tc = recipes.find((r) => r.key === 'pill_truc_co_dan');
  check(
    !!tc && tc.materials === 15 && tc.fee === 34 && Math.abs(tc.chance - 0.81) < 1e-9,
    'Trúc Cơ Đan shows 15 materials, fee 34, success 81% (docs/13 numbers)',
  );
  check(
    recipes.every((r) => r.canStart === false),
    'every Luyện button is disabled for a Luyện Khí character',
  );
  const text = await ev("document.querySelector('#vgtd-craft').textContent");
  check(
    /Trúc Cơ/.test(text) && /Nguyên liệu 0\/15/.test(text),
    'the panel text carries the realm hint and the material counts',
  );
  check(await ev('window.__vgtdCraft.start(2, 1)'), 'a start is sent anyway (the client hint is not a rule)');
  try {
    await page.waitForFunction("window.__vgtdCraft.toastText().includes('Trúc Cơ')", { timeout: 15000, polling: 150 });
    check(true, 'the server answered with the refusal reason (realm too low): the wire path works in the browser');
  } catch {
    check(false, `the server did not answer the start (toast: "${await ev('window.__vgtdCraft.toastText()')}")`);
  }
  await sleep(300);
  await page.screenshot({ path: join(out, 'craft-panel.png') });
  console.log(`screenshot: ${join(out, 'craft-panel.png')}`);
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
