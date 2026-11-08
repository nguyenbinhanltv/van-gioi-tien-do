// Real-client kill -> loot -> bag smoke test (D79 follow-up). NOT part of CI: it needs the Cocos build and a Chrome / Edge.
//
//   npm run bag:smoke -w client-cocos -- [--skip-build] [--out <dir>] [--kills <max kills>] [--budget-s <seconds>]
//
// Phase 1 (desktop 1280x720, `?online=1&combat=1`): starts apps/server (scripts/dev.mjs: monsters + combat + inventory, free ports,
// loopback only), logs in as a throw-away account, walks to the nearest monster with WASD, targets it (Tab) and casts through the real
// hotbar / net path, repeating until the bag (`window.__vgtdBag.state()`) shows loot (a stone wallet, a stack or a pending entry) or
// the kill / time budget runs out. Drops are probabilistic, so the budget is part of the report. It then clicks the Claim button if
// loot is pending. Phase 2 (offline `#bagdemo`, mobile emulation with real touch events at 360x640, 390x844 and 844x390): the panel
// is inside the viewport, tap select -> tap another slot swaps, tap Claim empties the pending queue. Prints a report and writes
// screenshots (default <tmpdir>/vgtd-bag-smoke). Exit code 1 on a failed check or a page error. Uses free ports only (never 7456).
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-bag-smoke')));
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
    LOG_VIOLATIONS: '1',
  },
});
// forward the interesting server lines (drops, anti-cheat) to the report
let serverDrops = 0; // drop grants logged by the server: a kill that dropped something
server.stdout.on('data', (d) => {
  for (const line of String(d).split(/\r?\n/)) {
    if (/drops mob/.test(line)) serverDrops++;
    if (/anti-cheat|drops mob/.test(line)) console.log(`[server] ${line.trim()}`);
  }
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
const maxKills = Number(opt('kills', '40'));
const budgetMs = Number(opt('budget-s', '420')) * 1000;
mkdirSync(out, { recursive: true });
const report = { phase1: {}, phase2: [] };

const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: 'new',
  defaultViewport: { width: Number(opt('w', '960')), height: Number(opt('h', '540')), deviceScaleFactor: 1 },
  protocolTimeout: 600000,
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const watch = (page) => {
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
};
const bagState = (page) => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdBag.state()))');
const sig = (b) => JSON.stringify([b.wallet, b.slots, b.pending]);

try {
  // ------------------------------------------------------------------ phase 1: desktop, online
  const page = await browser.newPage();
  watch(page);
  await page.goto(
    `http://127.0.0.1:${webPort}/?online=1&combat=1&npcs=0&server=127.0.0.1:${gwPort}&name=bag${Date.now() % 100000}`,
  );
  await page.waitForFunction(
    'window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdCombat && window.__vgtdBag',
    {
      timeout: 180000,
      polling: 250,
    },
  );
  const cs = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdCombat.state()))');
  const me = () => page.evaluate('window.__vgtdOnline().self');
  check(true, 'online session active, combat HUD and bag panel attached');
  await page.keyboard.press('KeyB');
  await sleep(1500);
  const b0 = await bagState(page);
  check(b0.visible && b0.ready, `bag panel opens with B and the server's inv_state arrived (states=${b0.states})`);
  const base = sig(b0);
  await page.screenshot({ path: join(out, 'bag-empty.png') });

  const t0 = Date.now();
  let kills = 0;
  const seenDead = new Set();
  let looted = false;
  let tFirst = null;
  let pass = 0;
  while (!looted && kills < maxKills && Date.now() - t0 < budgetMs) {
    const s = await cs();
    const self = await me();
    const alive = s.enemies.filter((e) => e.alive && e.i !== undefined);
    if (!self || alive.length === 0) {
      await sleep(500);
      continue;
    }
    const dist = (e) => Math.hypot(e.i - self.i, e.j - self.j);
    // prefer weak monsters that are close (a ~1500 HP monster takes minutes with a starter kit and its MP pool)
    const cost = (e) => dist(e) + e.hpMax / 60;
    alive.sort((a, c) => cost(a) - cost(c));
    const tgt = alive[0];
    if (dist(tgt) > 4.5) {
      // screen direction of the target: x = di - dj, y = (di + dj) / 2 (W is up on screen)
      const di = tgt.i - self.i;
      const dj = tgt.j - self.j;
      const sx = di - dj;
      const sy = (di + dj) / 2;
      const keys = [];
      if (Math.abs(sx) > 0.5) keys.push(sx > 0 ? 'KeyD' : 'KeyA');
      if (Math.abs(sy) > 0.5) keys.push(sy > 0 ? 'KeyS' : 'KeyW');
      for (const k of keys) await page.keyboard.down(k);
      await sleep(350);
      for (const k of keys) await page.keyboard.up(k);
      continue;
    }
    await page.keyboard.press('Tab');
    await sleep(150);
    // one castable, off-cooldown skill per pass (spamming the bar would trip the server's cast-rate / cooldown anti-cheat)
    const ready = (await cs()).slots.findIndex((sl) => sl.castable && sl.cdMs === 0 && sl.id !== undefined);
    if (ready >= 0 && s.mp >= 60) await page.keyboard.press(String(ready + 1));
    if (++pass % 5 === 0)
      console.log(
        `  .. pass ${pass}: dist ${dist(tgt).toFixed(1)}, target ${tgt.id} hp ${tgt.hp}/${tgt.hpMax}, ready slot ${ready}`,
      );
    await sleep(700);
    const s2 = await cs();
    // a killed monster is removed from the AOI (or reported dead): count the target once when it is gone
    const now = s2.enemies.find((e) => e.id === tgt.id);
    if ((!now || !now.alive) && !seenDead.has(tgt.id)) {
      seenDead.add(tgt.id);
      kills++;
    }
    await sleep(500); // inv_state follows the kill within a tick or two
    const b = await bagState(page);
    if (sig(b) !== base) {
      looted = true;
      tFirst = Date.now() - t0;
    }
  }
  const bEnd = await bagState(page);
  kills = Math.max(kills, serverDrops); // a drop is a kill even when the target left the AOI list before it was seen gone
  report.phase1 = {
    kills,
    looted,
    secondsToFirstDrop: tFirst === null ? null : +(tFirst / 1000).toFixed(1),
    invStates: bEnd.states,
    wallet: bEnd.wallet,
    slots: bEnd.slots,
    pending: bEnd.pending,
  };
  console.log(
    `kills: ${kills}, loot seen: ${looted}${tFirst === null ? '' : ` after ${(tFirst / 1000).toFixed(1)} s`}, inv_state received: ${bEnd.states}, wallet ${JSON.stringify(bEnd.wallet)}, slots ${JSON.stringify(bEnd.slots)}, pending ${bEnd.pending}`,
  );
  check(kills > 0, `killed at least one monster through the real hotbar / net path (${kills})`);
  check(looted, 'a kill changed the bag (wallet, slots or pending) through inv_state');
  await page.screenshot({ path: join(out, 'bag-after-kill.png') });
  if (bEnd.pending > 0) {
    const r = await page.evaluate('window.__vgtdBag.clickClaim()');
    await sleep(1200);
    const bc = await bagState(page);
    check(r === 'claim', 'Claim button click is handled');
    console.log(`claim: pending ${bEnd.pending} -> ${bc.pending}, lastResult ${JSON.stringify(bc.lastResult)}`);
  }
  await page.close();

  // ------------------------------------------------------------------ phase 2: small screens, real touch events (offline #bagdemo)
  const VIEWPORTS = [
    ['phone-portrait-360x640', 360, 640],
    ['phone-portrait-390x844', 390, 844],
    ['phone-landscape-844x390', 844, 390],
  ];
  for (const [name, w, h] of VIEWPORTS) {
    const p = await browser.newPage();
    watch(p);
    await p.setViewport({ width: w, height: h, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
    await p.goto(`http://127.0.0.1:${webPort}/?npcs=0#bagdemo`);
    await p.waitForFunction('window.__vgtdBag && window.__vgtdBag.state().ready', { timeout: 180000, polling: 250 });
    await sleep(1200);
    const at = (fn, ...a) => p.evaluate(`window.__vgtdBag.${fn}(${a.join(',')})`);
    const box = await at('panelBox');
    const slot0 = await at('slotPoint', 0);
    const slot1 = await at('slotPoint', 1);
    const slot9 = await at('slotPoint', 9);
    const slot8 = await at('slotPoint', 8);
    const tap = (pt) => p.touchscreen.tap(pt.x, pt.y);
    const inView = box && box.x >= 0 && box.y >= 0 && box.x + box.w <= w + 0.5 && box.y + box.h <= h + 0.5;
    const before = await bagState(p);
    await tap(slot0);
    await sleep(400);
    const afterSel = await bagState(p);
    await tap(slot1);
    await sleep(500);
    const afterMove = await bagState(p);
    const pendingBefore = afterMove.pending;
    await tap(await at('claimPoint'));
    await sleep(500);
    const afterClaim = await bagState(p);
    await p.screenshot({ path: join(out, `bag-${name}.png`) });
    const row = {
      name,
      panel: box && { x: Math.round(box.x), y: Math.round(box.y), w: Math.round(box.w), h: Math.round(box.h) },
      slotStepCssPx: +(slot9.y === slot8.y ? slot9.x - slot8.x : 0).toFixed(1),
      inView,
    };
    report.phase2.push(row);
    console.log(`${name}: ${JSON.stringify(row)}`);
    check(!!inView, `${name}: the whole panel is inside the viewport`);
    check(afterSel.selected === 0, `${name}: a touch tap selects slot 0`);
    check(afterMove.slots.join() !== before.slots.join(), `${name}: tapping slot 1 moves / swaps (slots changed)`);
    check(
      pendingBefore > 0 && afterClaim.pending === 0,
      `${name}: tapping Claim empties the pending queue (${pendingBefore} -> ${afterClaim.pending})`,
    );
    await p.close();
  }
} finally {
  await browser.close();
  server.kill();
  web.close();
}
console.log(`REPORT ${JSON.stringify(report)}`);
console.log(`screenshots: ${out}`);
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
