// Camera + player-animation trace of the real Cocos web build against the real dev server (online, WASD walk).
//
//   node scripts/camera-trace.mjs [--skip-build] [--out <dir>] [--frames] [--rawfollow] [--class <path id>]
//
// Holds D for 2.5 s, then S for 2.5 s, with `globalThis.__vgtdTrace` armed: Bootstrap appends one sample per frame (camera centre,
// drawn player, raw 20 Hz predicted position, playing clip, drawn direction). Prints per-frame camera step statistics (what the
// screen shows) against the raw target steps (what a hard-set camera would show) and the clip switches. `--frames` also saves a
// screenshot sequence to <out>/frames. Exit code 1 when the camera is not smoother than the raw target or the clip flickers.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-camera-trace')));
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
const stats = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / (xs.length || 1);
  return {
    mean: m,
    sd: Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length || 1)),
    max: Math.max(0, ...xs),
  };
};
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  await page.goto(
    `http://127.0.0.1:${webPort}/?online=1&npcs=0&class=${opt('class', 'kiem')}&server=127.0.0.1:${gwPort}${args.includes('--rawfollow') ? '&rawfollow=1' : ''}&name=trace${Date.now() % 100000}`,
  );
  await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active', { timeout: 180000, polling: 250 });
  await sleep(4000); // let the first rig load
  mkdirSync(join(out, 'frames'), { recursive: true });
  await page.evaluate('globalThis.__vgtdTrace = []');
  const shots = args.includes('--frames');
  let n = 0;
  const hold = async (key, ms) => {
    await page.keyboard.down(key);
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      if (shots)
        await page.screenshot({
          path: join(out, 'frames', `f${String(n++).padStart(3, '0')}.png`),
          clip: { x: 340, y: 160, width: 600, height: 400 },
        });
      else await sleep(100);
    }
    await page.keyboard.up(key);
  };
  await sleep(800);
  await hold('d', 2500);
  await sleep(800);
  await hold('s', 2500);
  await sleep(800);
  const tr = await page.evaluate('JSON.parse(JSON.stringify(globalThis.__vgtdTrace))');
  console.log(
    `${tr.length} frames sampled, mean dt ${((1000 * tr.reduce((a, s) => a + s.dt, 0)) / tr.length).toFixed(1)} ms`,
  );
  const step = (key) =>
    tr
      .slice(1)
      .map((s, i) => (s[key] && tr[i][key] ? Math.hypot(s[key].x - tr[i][key].x, s[key].y - tr[i][key].y) : 0));
  const rawStep = step('raw');
  const camStep = step('cam');
  // only the frames of the walking phases: where the raw target moved at some point within +-3 frames
  const walking = rawStep.map((_, i) => rawStep.slice(Math.max(0, i - 3), i + 4).some((v) => v > 0.01));
  const pick = (xs) => xs.filter((_, i) => walking[i]);
  const raw = stats(pick(rawStep));
  const cam = stats(pick(camStep));
  const stalls = (xs) => pick(xs).filter((v) => v < 0.05).length;
  console.log(
    `raw target step px/frame: mean ${raw.mean.toFixed(2)} sd ${raw.sd.toFixed(2)} max ${raw.max.toFixed(2)}; zero-step frames ${stalls(rawStep)}`,
  );
  console.log(
    `camera     step px/frame: mean ${cam.mean.toFixed(2)} sd ${cam.sd.toFixed(2)} max ${cam.max.toFixed(2)}; zero-step frames ${stalls(camStep)}`,
  );
  // the unsmoothed alternative: clip chosen from the per-frame raw speed with the old thresholds (tiles/s ~ px/s / 64-ish): count its switches
  const rawClip = [];
  tr.slice(1).forEach((s, i) => {
    const sp = rawStep[i] / Math.max(1e-3, s.dt) / 45; // ~ screen px/s per tile/s along an iso diagonal
    rawClip.push(sp < 0.3 ? 'idle' : sp < 3.2 ? 'walk' : 'run');
  });
  const switches = (xs) => xs.filter((v, i) => i > 0 && v !== xs[i - 1]).length;
  const clips = tr.map((s) => s.clip);
  console.log(
    `clip switches over the run: ${switches(clips)} (per-frame raw-speed selection would switch ${switches(rawClip)}x); clips seen: ${[...new Set(clips)].join(', ')}`,
  );
  if (args.includes('--rawfollow')) console.log('(--rawfollow: the pre-fix behaviour, checks skipped)');
  else {
    check(cam.sd < raw.sd || raw.sd === 0, 'camera step variance is below the raw target step variance');
    check(stalls(camStep) <= stalls(rawStep) / 4 + 2, 'the camera does not stall on frames between 20 Hz steps');
    check(clips.includes('walk') || clips.includes('run'), 'a walk/run clip plays while moving');
    check(switches(clips) <= 8, 'no idle/walk/run flicker (<= 8 switches for 2 walks)');
  }
} finally {
  await browser.close();
  server.kill();
  web.close();
}
process.exit(failures ? 1 : 0);
