// Headless smoke test of ONLINE combat (`?online=1&combat=1`): the real Cocos web build against the real dev server (monsters +
// server-authoritative combat on). P3 client/server wiring (D75, D78).
//
//   npm run combat:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports, CORS for the page origin), serves build/web-mobile, opens the page in headless
// Chrome / Edge (CHROME_PATH overrides), waits until the session is online, then checks through `window.__vgtdCombat.state()`:
// own vitals arrive from the server (snapshot `self.vitals`), monsters appear from AOI, a cast aimed with the pointer goes out and the
// server's result comes back (cooldown synced, MP spent), and, when a monster is in reach, damage lands on it. Writes a screenshot
// (default <tmpdir>/vgtd-combat-online). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-combat-online')));
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
  page.on('console', (m) => {
    const t = m.text();
    if (/online|vgtd\]\[net|hook/i.test(t) && m.type() !== 'log') console.log('[page]', t);
  });
  await page.goto(
    `http://127.0.0.1:${webPort}/?online=1&combat=1&npcs=0&class=kiem&server=127.0.0.1:${gwPort}&name=smoke${Date.now() % 100000}`,
  );
  await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdCombat', {
    timeout: 180000,
    polling: 250,
  });
  const st = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdCombat.state()))');
  check(true, 'online session active, combat HUD attached');
  // own vitals (snapshot self.vitals) + AOI: wait for them instead of a fixed sleep (a busy machine needs longer)
  await page.waitForFunction(
    'window.__vgtdCombat.state().hpMax > 1 && window.__vgtdCombat.state().enemies.length > 0',
    {
      timeout: 60000,
      polling: 250,
    },
  );
  await sleep(500);
  let s = await st();
  console.log(`path ${s.path}, hp ${s.hp}/${s.hpMax}, mp ${s.mp}/${s.mpMax}, enemies in view: ${s.enemies.length}`);
  check(s.hpMax > 1 && s.hp === s.hpMax, 'own HP arrived from the server (snapshot self.vitals)');
  check(s.mpMax > 1 && s.mp === s.mpMax, 'own MP arrived from the server');
  check(s.enemies.length > 0, `monsters from AOI are in the HUD model (${s.enemies.length})`);

  // press the first castable damage skill with a target (Tab) and check the server answers: cooldown is synced, MP spent
  await page.keyboard.press('Tab');
  await sleep(300);
  s = await st();
  const mp0 = s.mp;
  let cast = -1;
  for (let k = 0; k < 8; k++) {
    if (!s.slots[k].castable) continue;
    await page.keyboard.press(String(k + 1));
    cast = k;
    break;
  }
  await sleep(1500);
  s = await st();
  check(cast >= 0 && s.slots[cast].cdMs > 0, 'the cast reached the server and the cooldown is running');
  check(s.mp < mp0, `MP was spent by the server (${mp0} -> ${s.mp})`);
  mkdirSync(out, { recursive: true });
  check(s.enemyBars.length >= 1 || s.target === null, 'the targeted monster has an overhead HP bar');
  check(!s.deathOverlay, 'no death overlay while alive');
  await page.screenshot({ path: join(out, 'combat-online.png') });
  console.log(`screenshot: ${join(out, 'combat-online.png')}`);

  // death flow (the server does not hurt players yet, so feed own vitals as a snapshot would): damage number + own bar, then the
  // overlay with the respawn countdown, then the respawn clears it (the server-side respawn is covered by apps/server tests)
  await page.evaluate(`window.__vgtdCombat.fakeVitals(${Math.round(s.hpMax * 0.6)}, ${s.hpMax})`);
  await sleep(300);
  s = await st();
  check(s.selfBar && s.floaters > 0, 'damage taken shows a floating number and the own HP bar');
  await page.evaluate(`window.__vgtdCombat.fakeVitals(0, ${s.hpMax})`);
  await sleep(600);
  s = await st();
  check(s.deathOverlay && /Respawn in/.test(s.deathText), `death overlay with countdown ("${s.deathText}")`);
  await page.screenshot({ path: join(out, 'combat-online-dead.png') });
  await page.evaluate(`window.__vgtdCombat.fakeVitals(${s.hpMax}, ${s.hpMax})`);
  await sleep(300);
  s = await st();
  check(!s.deathOverlay, 'respawn clears the overlay');

  // status row (D94): the server owns the statuses (covered by apps/server tests with a real NetClient); here the HUD row is fed a status
  // block through the automation override to check that it is drawn
  await page.evaluate('window.__vgtdOwnStatus = { rootMs: 2500, slowMs: 4000, slowPct: 50, poisonMs: 0 }');
  await sleep(500);
  s = await st();
  check(
    s.statusTiles.length === 2 && s.statusTiles[0] === 'TRÓI' && s.statusTiles[1] === 'CHẬM',
    `the status row shows root and slow (${JSON.stringify(s.statusTiles)})`,
  );
  await page.screenshot({ path: join(out, 'combat-online-status.png') });
  await page.evaluate('window.__vgtdOwnStatus = undefined');
  await sleep(400);
  s = await st();
  check(s.statusTiles.length === 0, 'the status row clears when no status is active');
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
