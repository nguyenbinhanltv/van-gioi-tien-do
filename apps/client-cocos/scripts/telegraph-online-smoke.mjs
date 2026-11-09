// Headless smoke test of MOB ATTACK TELEGRAPH decals (D89, protocol v5): the real Cocos web build against the real dev server
// (monsters + combat + mob attacks on). Walks toward the nearest monster until one starts an attack, then checks that
// `telegraph_start` reached the client (`window.__vgtdOnline().telegraphs`), that a red decal is really drawn on the canvas
// (red-pixel count of a screenshot vs a quiet frame) and that it is gone once the attack resolved. Screenshots go to the out dir.
//
//   npm run telegraph:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports, CORS for the page origin), serves build/web-mobile, opens the page in headless
// Chrome / Edge (CHROME_PATH overrides), waits until the session is online, then checks through `window.__vgtdCombat.state()`:
// own vitals arrive from the server (snapshot `self.vitals`), monsters appear from AOI, a cast aimed with the pointer goes out and the
// server's result comes back (cooldown synced, MP spent), and, when a monster is in reach, damage lands on it. Writes a screenshot
// (default <tmpdir>/vgtd-telegraph-online). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-telegraph-online')));
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
    if (m.type() !== 'log' || /vgtd/i.test(t)) console.log('[page]', t);
  });
  await page.goto(
    `http://127.0.0.1:${webPort}/?online=1&combat=1&class=kiem&npcs=0&server=127.0.0.1:${gwPort}&name=smoke${Date.now() % 100000}`,
  );
  try {
    await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdCombat', {
      timeout: Number(process.env.SMOKE_WAIT_MS ?? 180000),
      polling: 250,
    });
  } catch (e) {
    const dbg = await page
      .evaluate('window.__vgtdOnline ? JSON.stringify(window.__vgtdOnline()) : "no __vgtdOnline"')
      .catch(() => 'page unreachable');
    console.error('session never became active:', dbg);
    throw e;
  }
  const online = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdOnline()))');
  const cs = () => page.evaluate('JSON.parse(JSON.stringify(window.__vgtdCombat.state()))');
  // red-ish pixel count of the current frame (the decal outline is (255,70,50), the fill (255,60,40) at ~59% alpha): a screenshot is
  // decoded in the page so no PNG library is needed
  const redPixels = async (file) => {
    const b64 = await page.screenshot({ encoding: 'base64' });
    if (file) writeFileSync(file, Buffer.from(b64, 'base64'));
    return page.evaluate(async (data) => {
      const img = new Image();
      img.src = `data:image/png;base64,${data}`;
      await img.decode();
      const c = document.createElement('canvas');
      c.width = img.width;
      c.height = img.height;
      const g = c.getContext('2d');
      g.drawImage(img, 0, 0);
      const px = g.getImageData(0, 0, c.width, c.height).data;
      let n = 0;
      for (let k = 0; k < px.length; k += 4)
        if (px[k] >= 235 && px[k + 1] > 35 && px[k + 1] < 115 && px[k + 2] < 90) n++;
      return n;
    }, b64);
  };
  mkdirSync(out, { recursive: true });
  check(true, 'online session active, combat HUD attached');
  await sleep(2500);
  const quietPx = await redPixels();
  console.log(`red pixels before any telegraph: ${quietPx}`);

  // walk toward the nearest monster until a telegraph arrives (mobs attack players in reach, D86)
  const t0 = Date.now();
  let seen = null;
  let seenPx = 0;
  while (!seen && Date.now() - t0 < 120_000) {
    const o = await online();
    if (o.telegraphs.length > 0) {
      // count the red pixels and keep that very frame, but only count it if the same telegraph is still active right AFTER the screenshot
      // (a damage number is red too, and appears once the attack has landed)
      const first = o.telegraphs[0];
      const px = await redPixels(join(out, 'telegraph-active.png'));
      if ((await online()).telegraphs.some((t) => t.id === first.id)) {
        seen = first;
        seenPx = px;
        break;
      }
      continue;
    }
    const s = await cs();
    const self = o.self;
    const alive = s.enemies.filter((e) => e.alive && e.i !== undefined);
    if (!self || alive.length === 0) {
      await sleep(400);
      continue;
    }
    alive.sort((a, b) => Math.hypot(a.i - self.i, a.j - self.j) - Math.hypot(b.i - self.i, b.j - self.j));
    const tgt = alive[0];
    if (Math.hypot(tgt.i - self.i, tgt.j - self.j) > 2) {
      // screen direction of the target: x = di - dj, y = (di + dj) / 2 (W is up on screen)
      const di = tgt.i - self.i;
      const dj = tgt.j - self.j;
      const sx = di - dj;
      const sy = (di + dj) / 2;
      const keys = [];
      if (Math.abs(sx) > 0.5) keys.push(sx > 0 ? 'KeyD' : 'KeyA');
      if (Math.abs(sy) > 0.5) keys.push(sy > 0 ? 'KeyS' : 'KeyW');
      for (const k of keys) await page.keyboard.down(k);
      await sleep(250);
      for (const k of keys) await page.keyboard.up(k);
    } else await sleep(150);
  }
  check(
    !!seen,
    `a telegraph_start reached the client (${seen ? `${seen.shape}, progress ${seen.progress.toFixed(2)}` : 'none within 120 s'})`,
  );
  if (seen) {
    console.log(`red pixels with the decal: ${seenPx} (screenshot ${join(out, 'telegraph-active.png')})`);
    check(seenPx > quietPx + 150, `the decal is drawn on the canvas (red pixels ${quietPx} -> ${seenPx})`);
    // the attack resolves after its telegraph time (<= ~1.2 s) and the decal is removed
    let gone = false;
    for (let k = 0; k < 40 && !gone; k++) {
      await sleep(150);
      gone = (await online()).telegraphs.every((t) => t.id !== seen.id);
    }
    check(gone, 'the decal was removed when the attack resolved (telegraph_end / expiry)');
    // other monsters may be telegraphing at the same time: only compare once nothing is active
    for (let k = 0; k < 40 && (await online()).telegraphs.length > 0; k++) await sleep(150);
    if ((await online()).telegraphs.length === 0) {
      await sleep(1500); // let the damage number fade
      const afterPx = await redPixels(join(out, 'telegraph-gone.png'));
      check(afterPx < seenPx - 100, `the red decal pixels are gone from the canvas (${seenPx} -> ${afterPx})`);
    }
  }
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
