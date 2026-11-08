// Headless smoke test of the TOUCH skill wheel + drag-to-aim (docs/05 §2) under ?online=1&combat=1&input=touch: the real Cocos web build
// against the real dev server (monsters + server-authoritative combat on), driven with real touch events (puppeteer touchscreen).
//
//   npm run touch:aim -w client-cocos -- [--skip-build] [--out <dir>]
//
// Checks: touch mode hides the bottom hotbar and shows the wheel; a tap casts (auto-target, no aim on the wire); dragging a skill button
// shows the ground aim indicator and the cast that goes out carries the aim point; dragging back onto the button casts nothing;
// dragging into the Cancel zone casts nothing; a two-finger pinch in free space still zooms the camera while a finger on the wheel does
// not. Writes screenshots (default <tmpdir>/vgtd-touch-aim). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-touch-aim')));
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
  defaultViewport: { width: 1280, height: 720, deviceScaleFactor: 1, hasTouch: true },
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
  page.on('console', (m) => {
    if (m.type() === 'error' || /vgtd|wheel|error/i.test(m.text()))
      console.log('[page]', m.type(), m.text().slice(0, 300));
  });
  await page.goto(
    `http://127.0.0.1:${webPort}/?online=1&combat=1&input=touch&npcs=0&class=kiem&server=127.0.0.1:${gwPort}&name=touch${Date.now() % 100000}`,
  );
  try {
    await page.waitForFunction(
      'window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdCombat && window.__vgtdWheel',
      {
        timeout: 60000,
        polling: 250,
      },
    );
  } catch (e) {
    const dbg = await page.evaluate(
      'JSON.stringify({ online: window.__vgtdOnline ? window.__vgtdOnline() : null, combat: !!window.__vgtdCombat, wheel: !!window.__vgtdWheel })',
    );
    console.error('[debug] state at timeout:', dbg);
    throw e;
  }
  await sleep(3000); // snapshots, AOI, first layout
  const st = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdCombat.state()))');
  const wheel = () => page.evaluate('window.__vgtdWheel.visual()');
  const lastCast = () => page.evaluate('window.__vgtdOnline().lastCast');
  const zoom = () => page.evaluate('window.__vgtdZoom()');
  const canvas = await page.evaluate(
    '(() => { const r = document.querySelector("canvas").getBoundingClientRect(); return { x: r.left, y: r.top }; })()',
  );
  const at = (p) => ({ x: canvas.x + p.x, y: canvas.y + p.y }); // controller coordinates are canvas-relative
  mkdirSync(out, { recursive: true });

  let s = await st();
  let v = await wheel();
  check(s.touchMode && !s.hotbarShown, 'touch mode: the bottom hotbar is hidden');
  check(
    !!v && v.buttons.length >= 7 && (await page.evaluate('window.__vgtdWheel.shown()')),
    'the skill wheel is drawn (attack + 5 arc buttons + dodge / fly)',
  );
  await page.screenshot({ path: join(out, 'wheel.png') });

  const centerOf = (vis, id) => at(vis.buttons.find((b) => b.id === id).center);
  const castNo = async () => (await lastCast())?.seq ?? 0;

  // 1) tap = auto-target cast, no aim on the wire
  let n0 = await castNo();
  const b0 = centerOf(v, 'skill-0');
  await page.touchscreen.tap(b0.x, b0.y);
  await sleep(700);
  let lc = await lastCast();
  check(lc && lc.seq !== n0, 'a tap on a skill button sends a skill_cast');
  check(lc && lc.aim === null, 'a tap sends no aim point (the server auto-targets)');
  await sleep(2500); // GCD / cooldowns

  // 2) drag = aim: indicator while held, cast with the aim point on release
  n0 = await castNo();
  const b1 = centerOf(v, 'skill-1');
  let t = await page.touchscreen.touchStart(b1.x, b1.y);
  for (let k = 1; k <= 6; k++) await t.move(b1.x - 22 * k, b1.y - 12 * k);
  await sleep(250);
  v = await wheel();
  check(v.aim && !v.aim.backAtOrigin && !v.aim.overCancel, 'dragging a skill button starts an aim');
  check(await page.evaluate('window.__vgtdWheel.aimDrawn()'), 'the ground aim indicator is drawn while aiming');
  check(v.cancelVisible, 'the Cancel zone is shown while aiming');
  await page.screenshot({ path: join(out, 'aiming.png') });
  await t.end();
  await sleep(700);
  lc = await lastCast();
  check(lc && lc.seq !== n0, 'releasing the drag sends the cast');
  check(
    lc && lc.aim && Number.isFinite(lc.aim.i) && Number.isFinite(lc.aim.j),
    `the cast carries the aim point (${JSON.stringify(lc)})`,
  );
  await sleep(2500);

  // 3) drag out and back onto the button: nothing is cast
  n0 = await castNo();
  const b2 = centerOf(v, 'skill-2');
  t = await page.touchscreen.touchStart(b2.x, b2.y);
  for (let k = 1; k <= 5; k++) await t.move(b2.x - 24 * k, b2.y);
  await t.move(b2.x + 2, b2.y + 1);
  await sleep(200);
  check((await wheel()).aim?.backAtOrigin === true, 'dragging back onto the button marks the aim as dropped');
  await t.end();
  await sleep(600);
  check((await castNo()) === n0, 'releasing after dragging back casts nothing');

  // 4) drag into the Cancel zone: nothing is cast
  const cr = v.cancelRect ?? (await wheel())?.cancelRect;
  const crect = cr ?? { x: 1140, y: 16, w: 120, h: 52 };
  t = await page.touchscreen.touchStart(b2.x, b2.y);
  await t.move(b2.x - 60, b2.y - 80);
  await t.move(canvas.x + crect.x + crect.w / 2, canvas.y + crect.y + crect.h / 2);
  await sleep(200);
  check((await wheel()).aim?.overCancel === true, 'dragging into the Cancel zone highlights it');
  await t.end();
  await sleep(600);
  check((await castNo()) === n0, 'releasing over Cancel casts nothing');

  // 4b) a tap AFTER fingers moved around (joystick drag, aim drags above) still sends no aim: touch must never reuse a stale pointer aim
  const joy = await page.touchscreen.touchStart(canvas.x + 200, canvas.y + 500);
  for (let k = 1; k <= 4; k++) await joy.move(canvas.x + 200 + 15 * k, canvas.y + 500 - 10 * k);
  await joy.end();
  await sleep(2500);
  n0 = await castNo();
  await page.touchscreen.tap(b0.x, b0.y);
  await sleep(700);
  lc = await lastCast();
  check(
    lc && lc.seq !== n0 && lc.aim === null,
    'a tap after joystick / aim drags sends aim: null (no stale pointer aim)',
  );

  // 5) pinch: two fingers in free space zoom the camera; a finger held on the wheel + one free finger do not
  const z0 = await zoom();
  const f1 = await page.touchscreen.touchStart(canvas.x + 560, canvas.y + 300);
  const f2 = await page.touchscreen.touchStart(canvas.x + 660, canvas.y + 300);
  for (let k = 1; k <= 6; k++) {
    await f1.move(canvas.x + 560 - 20 * k, canvas.y + 300);
    await f2.move(canvas.x + 660 + 20 * k, canvas.y + 300);
  }
  await f1.end();
  await f2.end();
  await sleep(900);
  const z1 = await zoom();
  check(
    z1 > z0 + 0.05,
    `a two-finger pinch in free space still zooms the camera (${z0.toFixed(2)} -> ${z1.toFixed(2)})`,
  );
  const hold = await page.touchscreen.touchStart(b0.x, b0.y); // a finger on a wheel button...
  const free = await page.touchscreen.touchStart(canvas.x + 600, canvas.y + 300); // ...and one free finger
  for (let k = 1; k <= 5; k++) await free.move(canvas.x + 600 - 30 * k, canvas.y + 300);
  await free.end();
  await hold.end();
  await sleep(900);
  const z2 = await zoom();
  check(
    Math.abs(z2 - z1) < 0.02,
    `a finger on the wheel plus one free finger does not zoom (${z1.toFixed(2)} -> ${z2.toFixed(2)})`,
  );
  await page.screenshot({ path: join(out, 'final.png') });
  console.log(`screenshots: ${out}`);
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
