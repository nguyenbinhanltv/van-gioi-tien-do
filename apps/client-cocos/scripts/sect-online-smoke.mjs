// Headless smoke test of the NPC SECT panel (D98): the real Cocos web build against the real dev server. Opens the panel with K, checks the
// NPC dialog for a non-member, joins with the Gia nhập button, checks the library of the class (5 manuals with prices in Cống hiến), tries
// to learn one without Cống hiến (the server refuses, the chat says so) and leaves again. Screenshot of the member view.
//
//   npm run sect:online -w client-cocos -- [--skip-build] [--out <dir>]
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-sect-online')));
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
    `http://127.0.0.1:${webPort}/?online=1&combat=1&class=kiem&npcs=0&server=127.0.0.1:${gwPort}&name=sect${Date.now() % 100000}`,
  );
  await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdSect', {
    timeout: Number(process.env.SMOKE_WAIT_MS ?? 180000),
    polling: 250,
  });
  mkdirSync(out, { recursive: true });
  const ev = (expr) => page.evaluate(expr);
  const waitFor = async (expr, what, ms = 20000) => {
    try {
      await page.waitForFunction(expr, { timeout: ms, polling: 150 });
      check(true, what);
      return true;
    } catch {
      check(false, what);
      return false;
    }
  };
  const chatLines = () => ev("window.__vgtdChat.lines().map((l) => l.text).join(' | ')");
  check(true, 'online session active, sect panel built');
  await waitFor('window.__vgtdSect.state().ready', 'the first sect_state arrived');

  await page.keyboard.press('KeyK');
  check(await ev('window.__vgtdSect.visible()'), 'the K key opens the sect panel');
  await sleep(500);
  let st = await ev('window.__vgtdSect.state()');
  check(
    st.member === false && st.library.length === 5,
    `not a member yet, the class library has ${st.library.length} manuals`,
  );
  check(st.near === true, 'the player stands near the sect NPC (spawn area)');
  check(await ev("window.__vgtdSect.click('Gia nhập')"), 'the NPC dialog has a Gia nhập button and it was clicked');
  await waitFor('window.__vgtdSect.state().member === true', 'the server made the player a member');
  await sleep(500);
  st = await ev('window.__vgtdSect.state()');
  check(
    st.library.every((m) => m.price > 0 && m.owned === false),
    `the library lists ${st.library.map((m) => `${m.name} ${m.price}`).join(', ')}`,
  );
  check(
    await ev("window.__vgtdSect.click('Học', window.__vgtdSect.state().library[0].name)"),
    'the first manual has a Học button',
  );
  await waitFor(
    `window.__vgtdChat.lines().some((l) => l.text.includes('Không đủ Cống hiến'))`,
    'learning without Cống hiến is refused by the server and the chat says so',
  );
  await sleep(300);
  await page.screenshot({ path: join(out, 'sect-panel.png') });
  console.log(`screenshot: ${join(out, 'sect-panel.png')}`);
  check(await ev("window.__vgtdSect.click('Rời tông môn')"), 'the Rời tông môn button was clicked');
  await waitFor('window.__vgtdSect.state().member === false', 'the player is no longer a member');
  check((await chatLines()).includes('đã rời'), 'the chat announced leaving');
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
