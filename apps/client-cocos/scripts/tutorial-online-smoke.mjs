// Headless smoke test of the TUTORIAL / FTUE hints (D105): the real Cocos web build against the real dev server.
//
//   npm run tutorial:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports), serves build/web-mobile, opens headless Chrome / Edge (CHROME_PATH overrides) and checks,
// with REAL key presses, real typing and a REAL click on the card's skip button:
//   - the hint card shows the first step with PC wording; walking with WASD makes the SERVER complete `move`, and later `field`, and the card advances;
//   - sending a chat line completes the optional `chat` tip on the server; the old client-side checklist steps aside;
//   - "Bỏ qua" hides the card for good and the choice survives a reconnect of the same account (server-persisted progress, not localStorage);
//   - a touch-emulated page shows touch wording and the card does not touch the joystick zone or the folded chat strip.
// Writes tutorial-a.png to --out (default <tmpdir>/vgtd-tutorial). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-tutorial')));
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
mkdirSync(out, { recursive: true });

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

// the game server: local-only, throw-away accounts, no monsters (nothing else may interrupt the test)
const server = spawn(process.execPath, [join(root, '../server/scripts/dev.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PORT: String(gwPort),
    HOST: '127.0.0.1',
    CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
    REGISTER_PER_IP_PER_DAY: '0',
    MOBS: '0',
    COMBAT: '0',
    INVENTORY: '0',
    SPAWN_SIDE: '4',
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
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
  ],
});

const stamp = Date.now() % 100000;
const nameA = `tua${stamp}`;
const nameB = `tub${stamp}`;
const url = (name) =>
  `http://127.0.0.1:${webPort}/?online=1&npcs=0&class=kiem-tu&server=127.0.0.1:${gwPort}&name=${name}`;
try {
  const open = async (name) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => {
      console.error('[page error]', e.message);
      failures++;
    });
    await page.goto(url(name));
    return page;
  };
  const lines = (page) => page.evaluate('window.__vgtdChat ? window.__vgtdChat.lines() : null');
  const texts = async (page) => ((await lines(page)) ?? []).map((l) => l.text);
  const until = async (what, page, pred, timeoutMs = 120000) => {
    const t0 = Date.now();
    for (;;) {
      const v = await pred(page).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) {
        const o = await page.evaluate('window.__vgtdOnline ? window.__vgtdOnline() : null').catch(() => null);
        check(
          false,
          `${what} (timeout; online ${JSON.stringify(o && { status: o.status, err: o.lastError, others: o.others.length })}; chat lines ${JSON.stringify(await texts(page).catch(() => null))})`,
        );
        return null;
      }
      await sleep(150);
    }
  };
  /** type into the real chat box: Enter focuses, the text goes in key by key, Enter sends */
  const say = async (page, text) => {
    await page.bringToFront();
    await page.keyboard.press('Enter');
    await until('chat box focused', page, (p) => p.evaluate('window.__vgtdChat.focused()'), 10000);
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
  };
  const joined = () => async (p) => {
    const o = await p.evaluate('window.__vgtdOnline ? window.__vgtdOnline() : null');
    return o && o.status === 'online' && (await lines(p)) ? o : null;
  };

  const a = await open(nameA);
  await a.bringToFront();
  await until('A online with a chat box', a, joined());
  const tv = (p) => p.evaluate('window.__vgtdTutorial.view()');
  const waitView = (p, what, pred, ms) =>
    until(
      what,
      p,
      async (q) => {
        const v = await tv(q);
        return pred(v) ? v : null;
      },
      ms,
    );

  // ---- the card appears with the first step and PC wording
  const v0 = await waitView(a, 'card shows the first step', (v) => v.received && v.visible);
  check(!!v0 && v0.current === 'move' && v0.completed === 0, `the card points at the first step: ${v0 && v0.current}`);
  check(!!v0 && /chuột|WASD/.test(v0.hint), `PC wording: "${v0 && v0.hint}"`);
  const shown = await a.evaluate("getComputedStyle(document.getElementById('vgtd-tutorial')).display");
  check(shown === 'block', 'the card is on screen');
  const pe = await a.evaluate("getComputedStyle(document.getElementById('vgtd-tutorial')).pointerEvents");
  check(pe === 'none', 'the card does not take pointer events (only its skip button does)');

  // ---- walking: the SERVER sees the movement and completes `move`, then `field`
  await a.keyboard.down('KeyD');
  const vm = await waitView(a, 'server completes move', (v) => v.done.includes('move'), 30000);
  check(!!vm, 'walking with D completes `move` (decided by the server)');
  const vf = await waitView(a, 'server completes field', (v) => v.done.includes('field'), 90000);
  await a.keyboard.up('KeyD');
  check(
    !!vf && vf.current === 'skill',
    `reaching the field band completes \`field\`, the card moves on to: ${vf && vf.current}`,
  );

  // ---- a chat line completes the optional tip on the server
  await say(a, 'xin chào');
  const vc = await waitView(a, 'server completes chat', (v) => v.done.includes('chat'), 30000);
  check(!!vc, 'a chat line the server accepted completes the `chat` tip');
  check(vc.completed === 2 && !vc.complete, 'tips do not count toward the required steps');
  await sleep(800);
  await a.screenshot({ path: join(out, 'tutorial-a.png') });

  // ---- skip with a real click; it survives a reconnect of the same account
  await a.bringToFront();
  await a.click('#vgtd-tutorial-skip');
  const vs = await waitView(a, 'skipped', (v) => v.skipped, 15000);
  check(!!vs && !vs.visible, 'clicking "Bỏ qua" hides the card');
  const hidden = await a.evaluate("getComputedStyle(document.getElementById('vgtd-tutorial')).display");
  check(hidden === 'none', 'the card is gone from the screen');
  await a.close();
  const a2 = await open(nameA);
  await a2.bringToFront();
  await until('A online again', a2, joined());
  const vr = await waitView(a2, 'state restored by the server', (v) => v.received, 30000);
  check(
    !!vr &&
      vr.skipped &&
      !vr.visible &&
      vr.done.includes('move') &&
      vr.done.includes('field') &&
      vr.done.includes('chat'),
    `after reconnecting the server remembers the skip and the finished steps: ${JSON.stringify(vr && { skipped: vr.skipped, done: vr.done })}`,
  );

  // ---- touch screens: touch wording, and the card stays clear of the joystick zone and the folded chat strip
  for (const [label, vp] of [
    ['landscape', { width: 844, height: 390 }],
    ['portrait', { width: 390, height: 844 }],
  ]) {
    const tp = await browser.newPage();
    await tp.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await tp.goto(url(`tut${label[0]}${stamp}`));
    const ready = await waitView(tp, `touch ${label} card`, (v) => v.received && v.visible, 120000);
    if (ready) {
      const card = await tp.evaluate('window.__vgtdTutorial.rect()');
      const c = await tp.evaluate('window.__vgtdChat.placement()');
      const strip = await tp.evaluate(
        "(() => { const r = document.getElementById('vgtd-chat').getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; })()",
      );
      const hit = (x, y) => x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h;
      check(/Chạm|chạm|cần điều khiển/.test(ready.hint), `touch ${label}: touch wording "${ready.hint}"`);
      check(
        !hit(card, c.joystick) &&
          !hit(card, strip) &&
          card.x >= 0 &&
          card.x + card.w <= vp.width &&
          card.y + card.h <= vp.height,
        `touch ${label}: card ${JSON.stringify(card)} clear of joystick ${JSON.stringify(c.joystick)} and chat strip ${JSON.stringify(strip)}`,
      );
    }
    await tp.close();
  }
  console.log(`screenshots in ${out}`);
} finally {
  await browser.close();
  web.close();
  server.kill();
}
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
