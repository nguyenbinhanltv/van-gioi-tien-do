// Headless smoke test of the PROGRESSION HUD over the wire (`?online=1`): the real Cocos web build against the real dev server (D76).
//
//   npm run progression:online -w client-cocos -- [--skip-build] [--out <dir>] [--speed 200]
//
// Starts apps/server (scripts/dev.mjs on free ports, PROGRESSION_SPEED = dev-only tu vi multiplier so a stage fills in seconds), serves
// build/web-mobile, opens the page in headless Chrome / Edge (CHROME_PATH overrides) and drives it with REAL key presses:
//   M -> meditate (server accepts, tu vi grows, the bar follows `char_state`), the stage fills and meditation stops by itself,
//   N -> minor breakthrough (retried after a failed roll) up to Luyen Khi tang 9, moving (WASD) interrupts meditation on the server,
//   N at tang 9 -> the major breakthrough is refused with the Tam Ma / Loi Kiep toast (TribulationRequired).
// Reads the state through `window.__vgtdProgression.state()`; writes screenshots (meditating.png, breakthrough.png, tribulation.png)
// to --out (default <tmpdir>/vgtd-progression). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-progression')));
const speed = opt('speed', '200');
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

// the game server: local-only, throw-away accounts, no monsters (nothing may interrupt the meditation but the test itself)
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
    PROGRESSION_SPEED: speed,
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
    `http://127.0.0.1:${webPort}/?online=1&npcs=0&class=kiem-tu&server=127.0.0.1:${gwPort}&name=prog${Date.now() % 100000}`,
  );
  const state = () => page.evaluate('window.__vgtdProgression ? window.__vgtdProgression.state() : null');
  const until = async (what, pred, timeoutMs = 20000) => {
    const t0 = Date.now();
    for (;;) {
      const s = await state();
      if (s && pred(s)) return s;
      if (Date.now() - t0 > timeoutMs) {
        check(false, `${what} (timeout, last state ${JSON.stringify(s)})`);
        return null;
      }
      await sleep(100);
    }
  };
  await page.waitForFunction('window.__vgtdProgression && window.__vgtdProgression.state().loaded', {
    timeout: 180000,
    polling: 250,
  });
  await sleep(1500); // let the scene settle (the character spawns after the first snapshot)
  const first = await state();
  check(
    first.stage === 1 && first.label === 'Luyện Khí tầng 1',
    `profile loaded from the server: ${first.label}, tu vi ${Math.floor(first.tuVi)}/${Math.floor(first.tuViReq)}`,
  );
  check(
    first.canMeditate === true && first.canBreakthrough === false,
    'meditate offered, breakthrough not (server says tu vi is not full)',
  );

  // ---- meditate with the real key
  await page.keyboard.press('m');
  const med = await until('meditation accepted', (s) => s.meditating === true, 8000);
  const mid = await until('tu vi grows while meditating', (s) => s.meditating && s.fraction > 0.3, 15000);
  if (med && mid) {
    check(
      true,
      `meditating: bar at ${(mid.fraction * 100).toFixed(0)}% (${Math.floor(mid.tuVi)}/${Math.floor(mid.tuViReq)})`,
    );
    // the seated clip lives in the lazy `rest` clip group: it must load, or the frames render blank (only the shadow)
    let seated = null;
    for (let k = 0; k < 80 && !seated; k++) {
      const [st, shown] = [await state(), await page.evaluate('window.__vgtdChibi.state().shown')];
      if (!st.meditating) break; // the stage filled before the pose appeared
      if (shown.clip === 'meditate') seated = shown;
      else await sleep(100);
    }
    check(!!seated, `the chibi plays the seated clip while meditating (rig ${seated ? seated.drawn : '?'})`);
    check(
      await page.evaluate('window.__vgtdChibi.body.rig.groups.has("rest")'),
      'rest clip group loaded while meditating (the seated frames render)',
    );
    await page.screenshot({ path: join(out, 'meditating.png') });
    await page.screenshot({
      path: join(out, 'meditating-closeup.png'),
      clip: { x: 540, y: 240, width: 200, height: 200 },
    });
  }
  const full = await until(
    'stage fills and meditation stops by itself',
    (s) => s.ready === true && s.meditating === false,
    30000,
  );
  if (full)
    check(
      full.canBreakthrough === true && full.canMeditate === false,
      'stage full: breakthrough offered, meditation not',
    );

  // ---- breakthrough with the real key (a failed roll keeps the tu vi: retry after the cooldown)
  const breakTo = async (target) => {
    for (let attempt = 0; attempt < 12; attempt++) {
      const s = await until(
        `ready to break through at stage ${target - 1}`,
        (x) => x.ready || x.stage >= target,
        40000,
      );
      if (!s) return null;
      if (s.stage >= target) return s;
      await page.keyboard.press('n');
      await sleep(900);
      const after = await state();
      if (after.stage >= target) return after;
      await sleep(3300); // BREAKTHROUGH_COOLDOWN_MS
    }
    check(false, `reached stage ${target}`);
    return null;
  };
  const two = await breakTo(2);
  if (two) {
    check(two.label === 'Luyện Khí tầng 2' && two.tuVi < 1, `minor breakthrough succeeded: ${two.label}, tu vi reset`);
    check(two.toast && two.toast.tone === 'good', `success toast: ${two.toast && two.toast.text}`);
    await page.screenshot({ path: join(out, 'breakthrough.png') });
  }

  // ---- moving interrupts meditation (the server decides)
  await page.keyboard.press('m');
  await until('meditation accepted again', (s) => s.meditating === true, 8000);
  await page.keyboard.down('d');
  await sleep(600);
  await page.keyboard.up('d');
  const stopped = await until('movement interrupts meditation', (s) => s.meditating === false, 5000);
  if (stopped) check(true, 'moving (D key) stopped the meditation on the server');

  // ---- up to the major threshold: the lock
  let s = two;
  for (let target = 3; target <= 9 && s; target++) {
    await sleep(700); // stand still past the movement grace window
    await page.keyboard.press('m');
    await until('meditation accepted', (x) => x.meditating === true || x.ready === true, 8000);
    s = await breakTo(target);
  }
  if (s && s.stage === 9) {
    check(true, `reached ${s.label}`);
    await sleep(700);
    await page.keyboard.press('m');
    await until('meditation accepted at stage 9', (x) => x.meditating === true, 8000);
    await until('stage 9 full', (x) => x.ready === true, 60000);
    await sleep(3300);
    await page.keyboard.press('n');
    const locked = await until('major breakthrough refused', (x) => x.toast && /Tâm Ma/.test(x.toast.text), 8000);
    if (locked) {
      check(locked.stage === 9 && locked.toast.tone === 'bad', `major threshold refused: "${locked.toast.text}"`);
      await page.screenshot({ path: join(out, 'tribulation.png') });
    }
  }
  console.log(`screenshots in ${out}`);
} finally {
  await browser.close();
  web.close();
  server.kill();
}
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
