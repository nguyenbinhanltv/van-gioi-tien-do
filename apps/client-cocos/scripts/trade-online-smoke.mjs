// Headless smoke test of the DIRECT TRADE panel (D102): the real Cocos web build against the real dev server with two browser pages (two
// players standing next to each other). Alice invites Bob with /trade, Bob accepts with the panel's Đồng ý button, both panels open, both lock,
// both confirm and the server completes the trade ("hoàn tất"); a second window is cancelled with Hủy. Fresh accounts have an empty bag, so the
// offers are empty here: item / stone moves, the tax and the anti-dupe cases are covered by the server tests with a real inventory.
//
//   npm run trade:online -w client-cocos -- [--skip-build] [--out <dir>]
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-trade-online')));
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
    SPAWN_SIDE: '6', // both players spawn within a few tiles of each other: a trade needs them near (TRADE.RANGE_TILES)
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
    await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdTrade', {
      timeout: Number(process.env.SMOKE_WAIT_MS ?? 180000),
      polling: 250,
    });
    return page;
  };
  const stamp = Date.now() % 100000;
  const an = `tra${stamp}`;
  const bn = `trb${stamp}`;
  const alice = await open(an);
  const bob = await open(bn);
  mkdirSync(out, { recursive: true });
  check(true, 'two players online with the trade panel built');
  const ev = (page, expr) => page.evaluate(expr);
  const waitFor = async (page, expr, what, ms = 20000) => {
    try {
      await page.waitForFunction(expr, { timeout: ms, polling: 150 });
      check(true, what);
      return true;
    } catch {
      check(false, what);
      return false;
    }
  };
  const lines = (page) => ev(page, "window.__vgtdChat.lines().map((l) => l.text).join(' | ')");

  // only the foreground page runs its frame loop (and so draws / updates its panel): bring a page to the front before it acts or is read
  const front = async (page) => {
    await page.bringToFront();
    await sleep(500);
  };
  await front(alice);
  await ev(alice, `window.__vgtdChat.say('/trade ${bn}')`);
  await waitFor(bob, `window.__vgtdTrade.state().invite === '${an}'`, 'bob received the trade invite');
  await front(bob);
  await waitFor(bob, 'window.__vgtdTrade.visible()', 'the panel opens by itself for the invite');
  check(await ev(bob, "window.__vgtdTrade.click('Đồng ý')"), "bob presses the panel's Đồng ý button");
  await waitFor(bob, 'window.__vgtdTrade.state().open', "the window is open on bob's side");
  await sleep(500);
  await bob.screenshot({ path: join(out, 'trade-window.png') });
  console.log(`screenshot: ${join(out, 'trade-window.png')}`);
  await front(alice);
  await waitFor(alice, 'window.__vgtdTrade.state().open', "the window is open on alice's side");
  await waitFor(alice, 'window.__vgtdTrade.visible()', "alice's panel opened by itself");
  const st = await ev(alice, 'window.__vgtdTrade.state()');
  check(
    st.partner === bn && st.canLock && !st.canConfirm,
    `alice sees the window with ${st.partner}, can lock, cannot confirm yet`,
  );

  check(await ev(alice, "window.__vgtdTrade.click('Khóa')"), 'alice locks');
  await front(bob);
  check(await ev(bob, "window.__vgtdTrade.click('Khóa')"), 'bob locks');
  await front(alice);
  await waitFor(alice, 'window.__vgtdTrade.state().canConfirm', 'both locked: Xác nhận becomes available');
  check(await ev(alice, "window.__vgtdTrade.click('Xác nhận')"), 'alice confirms');
  await waitFor(alice, 'window.__vgtdTrade.state().mine.confirmed', "alice's confirmation shows");
  check(await ev(alice, 'window.__vgtdTrade.state().open'), 'one confirmation does not complete the trade');
  await front(bob);
  check(await ev(bob, "window.__vgtdTrade.click('Xác nhận')"), 'bob confirms');
  await waitFor(bob, '!window.__vgtdTrade.state().open', "the window closed on bob's side");
  await waitFor(alice, '!window.__vgtdTrade.state().open', "the window closed on alice's side");
  check((await lines(alice)).includes('hoàn tất'), 'the chat announced the completed trade');

  // a second window, cancelled
  await sleep(1500);
  await front(bob);
  await ev(bob, `window.__vgtdChat.say('/trade ${an}')`);
  await waitFor(alice, `window.__vgtdTrade.state().invite === '${bn}'`, 'alice received the second invite');
  await front(alice);
  check(await ev(alice, "window.__vgtdTrade.click('Đồng ý')"), 'alice accepts the second invite');
  await waitFor(alice, 'window.__vgtdTrade.state().open', 'the second window opened');
  check(await ev(alice, "window.__vgtdTrade.click('Hủy')"), 'alice presses Hủy');
  await waitFor(alice, '!window.__vgtdTrade.state().open', "the window closed on alice's side after the cancel");
  await waitFor(bob, '!window.__vgtdTrade.state().open', "the window closed on bob's side after the cancel");
  check((await lines(bob)).includes('Giao dịch đã hủy'), 'the chat announced the cancel');
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
