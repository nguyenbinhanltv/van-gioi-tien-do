// Headless smoke test of CLASS SELECTION on the wire (D81): two browser pages pick different classes through the real picker and see each
// other with the right chibi; the real Cocos web build against the real dev server.
//
//   npm run class:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports, monsters + combat on), serves build/web-mobile, opens TWO pages in headless Chrome / Edge
// (CHROME_PATH overrides) as two accounts and checks, with REAL clicks / key presses:
//   - the class picker shows for a new account; page A clicks "Phap tu", page B presses key 5 (Thuong tu);
//   - each page's hello_ack class is the chosen one, the combat hotbar is that class's kit (__vgtdCombat.state().path), the local chibi is
//     that class (__vgtdChibi), and each page draws the OTHER player with the other class's chibi (aoi_enter defId);
//   - reconnecting page A asking for another class (?class=dao) keeps the stored class (the server decides) and shows no picker again.
// Writes picker.png, class-a.png, class-b.png to --out (default <tmpdir>/vgtd-class). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-class')));
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

// the game server: local-only, throw-away accounts, monsters + combat on (the hotbar needs server combat)
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
    INVENTORY: '0',
    SPAWN_SIDE: '4', // both players spawn within a 4-tile square, so each screenshot shows the other one next to the local character
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
    // two pages at once: neither may be throttled as a background tab (its render loop builds the HUD and syncs remote players)
    '--disable-renderer-backgrounding',
    '--disable-background-timer-throttling',
    '--disable-backgrounding-occluded-windows',
  ],
});

const stamp = Date.now() % 100000;
const url = (name, extra = '') =>
  `http://127.0.0.1:${webPort}/?online=1&combat=1&npcs=0&server=127.0.0.1:${gwPort}&name=${name}${extra}`;
try {
  const open = async (name, extra = '') => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => {
      console.error('[page error]', e.message);
      failures++;
    });
    await page.goto(url(name, extra));
    return page;
  };
  const online = (page) => page.evaluate('window.__vgtdOnline ? window.__vgtdOnline() : null');
  const until = async (what, page, pred, timeoutMs = 120000) => {
    await page.bringToFront(); // a hidden tab does not run its render loop, which builds the HUD and syncs the other players
    const t0 = Date.now();
    for (;;) {
      const v = await pred(page).catch(() => null);
      if (v) return v;
      if (Date.now() - t0 > timeoutMs) {
        const o = await online(page).catch(() => null);
        const c = await page
          .evaluate('window.__vgtdCombat ? window.__vgtdCombat.state().path : null')
          .catch(() => null);
        check(
          false,
          `${what} (timeout; online ${JSON.stringify(o && { status: o.status, classId: o.classId, err: o.lastError })}, hotbar ${c})`,
        );
        return null;
      }
      await sleep(150);
    }
  };
  const picker = (page) => page.$('#vgtd-class-picker');
  const ready = async (p) => {
    const o = await online(p);
    const c = await p.evaluate('window.__vgtdCombat ? window.__vgtdCombat.state() : null');
    return o && o.status === 'online' && o.classId > 0 && c ? { o, c } : null;
  };

  // ---- page A: picker -> click "Phap tu"
  const a = await open(`clsa${stamp}`);
  await until('class picker shown to a new account', a, picker);
  check(!!(await picker(a)), 'the picker is shown to a new account');
  const before = await online(a);
  check(before === null || before.status !== 'online', 'no session is opened before a class is picked');
  await a.screenshot({ path: join(out, 'picker.png') });
  await a.click('#vgtd-class-phap');
  // ---- page B: picker -> key 5 (Thuong tu)
  const b = await open(`clsb${stamp}`);
  await until('class picker shown (B)', b, picker);
  await b.keyboard.press('5');

  const ra = await until('A online with a class', a, ready);
  const rb = await until('B online with a class', b, ready);
  if (ra && rb) {
    check(
      ra.o.classId === 2 && ra.c.path === 'phap',
      `A: hello_ack class ${ra.o.classId}, hotbar kit '${ra.c.path}' (asked Phap tu)`,
    );
    check(
      rb.o.classId === 5 && rb.c.path === 'thuong',
      `B: hello_ack class ${rb.o.classId}, hotbar kit '${rb.c.path}' (asked Thuong tu)`,
    );
    check(!(await picker(a)) && !(await picker(b)), 'the pickers are gone after joining');
    const ca = await a.evaluate('window.__vgtdChibi.state().cls');
    const cb = await b.evaluate('window.__vgtdChibi.state().cls');
    check(ca === 'phap-tu' && cb === 'thuong-tu', `local chibi follows the server class: A ${ca}, B ${cb}`);
    // each sees the other one with the other class (aoi_enter defId)
    const seeA = await until('A sees B', a, async (p) => (await online(p)).others.find((x) => x.cls) ?? null, 60000);
    const seeB = await until('B sees A', b, async (p) => (await online(p)).others.find((x) => x.cls) ?? null, 60000);
    if (seeA && seeB)
      check(seeA.cls === 'thuong-tu' && seeB.cls === 'phap-tu', `A draws B as ${seeA.cls}, B draws A as ${seeB.cls}`);
    await a.bringToFront();
    await sleep(3000); // let the chibi bodies finish loading before the screenshot
    await a.screenshot({ path: join(out, 'class-a.png') });
    await b.bringToFront();
    await sleep(3000);
    await b.screenshot({ path: join(out, 'class-b.png') });
  }

  // ---- page A again: the server keeps the stored class, no picker, whatever the URL asks for
  await a.close();
  await sleep(600);
  const a2 = await open(`clsa${stamp}`, '&class=dao');
  const r2 = await until('A back online', a2, ready);
  if (r2) {
    check(
      r2.o.classId === 2 && r2.c.path === 'phap',
      `reconnect asking ?class=dao keeps the stored class (hello_ack ${r2.o.classId}, kit '${r2.c.path}')`,
    );
    check(!(await picker(a2)), 'no picker for a URL-preselected class / returning account');
  }
  console.log(`screenshots in ${out}`);
} finally {
  await browser.close();
  web.close();
  server.kill();
}
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
