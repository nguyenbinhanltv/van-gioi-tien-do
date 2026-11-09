// Headless smoke test of CHAT (D87): two browser pages talk to each other through the real chat box; the real Cocos web build against the
// real dev server.
//
//   npm run chat:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports), serves build/web-mobile, opens TWO pages in headless Chrome / Edge (CHROME_PATH
// overrides) as two accounts and checks, with REAL key presses and typing into the real chat input:
//   - Enter focuses the box; a World line reaches the other page with the sender taken from the connection; the server filter masks words;
//   - typing "mb12wasd" into the box does NOT toggle meditation / the bag / the hotbar and does NOT move the character;
//   - /w name text is a whisper (target + echo), /w to nobody is answered, /z reaches players in view, /help is answered locally;
//   - a flood is refused with answers (not silently), the box never renders markup (text only).
// Writes chat-a.png and chat-b.png to --out (default <tmpdir>/vgtd-chat). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-chat')));
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
    SPAWN_SIDE: '4', // both players spawn within a 4-tile square: they see each other (Zone chat)
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
const nameA = `cha${stamp}`;
const nameB = `chb${stamp}`;
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
  const b = await open(nameB);
  await a.bringToFront();
  await until('A online with a chat box', a, joined());
  await b.bringToFront();
  await until('B online with a chat box', b, joined());
  check(true, 'both pages are online and have a chat box');

  // ---- World line
  await say(a, 'xin chào Sơn Môn');
  const gotB = await until('B receives the World line', b, async (p) =>
    (await texts(p)).find((t) => t.includes('xin chào Sơn Môn')),
  );
  check(
    gotB === `[Thế giới] ${nameA}: xin chào Sơn Môn`,
    `World line reaches B with the sender from the connection: "${gotB}"`,
  );
  const gotA = await until('A sees its own line', a, async (p) =>
    (await texts(p)).find((t) => t.includes('xin chào Sơn Môn')),
  );
  check(!!gotA, 'the sender sees the line too');

  // ---- typing must not trigger the game's hotkeys or move the character
  await a.bringToFront();
  const before = (await a.evaluate('window.__vgtdOnline()')).self;
  await a.keyboard.press('Enter');
  await until('chat box focused', a, (p) => p.evaluate('window.__vgtdChat.focused()'), 10000);
  await a.keyboard.type('mb12wasd', { delay: 60 });
  await sleep(500);
  const after = (await a.evaluate('window.__vgtdOnline()')).self;
  const prog = await a.evaluate('window.__vgtdProgression ? window.__vgtdProgression.state() : null');
  const bag = await a.evaluate('window.__vgtdBag ? window.__vgtdBag.state() : null');
  check(
    Math.hypot(after.i - before.i, after.j - before.j) < 0.05,
    `typing "wasd" in the box does not move the character (moved ${Math.hypot(after.i - before.i, after.j - before.j).toFixed(3)} tiles)`,
  );
  check(!prog || prog.meditating === false, 'typing "m" in the box does not toggle meditation');
  check(!bag || !bag.visible, 'typing "b" in the box does not open the bag');
  await a.keyboard.press('Escape');
  check(!(await a.evaluate('window.__vgtdChat.focused()')), 'Escape leaves the box');
  // and with the box closed the keys work again: the same "m" now starts meditating (server accepts it)
  await a.keyboard.press('m');
  const med = await until(
    'meditation starts once the box is closed',
    a,
    async (p) => {
      const s = await p.evaluate('window.__vgtdProgression ? window.__vgtdProgression.state() : null');
      return s && s.meditating;
    },
    15000,
  );
  check(!!med, 'hotkeys work again after leaving the box (M starts meditating)');
  await a.keyboard.press('m'); // stop again
  await sleep(500);

  // ---- whisper: target + echo; unknown target is answered; help is local
  await say(a, `/w ${nameB} psst, đừng nói ai`);
  const w = await until('B receives the whisper', b, async (p) => (await texts(p)).find((t) => t.includes('psst')));
  check(w === `[Thì thầm] ${nameA} → bạn: psst, đừng nói ai`, `whisper reaches B: "${w}"`);
  const echo = await until('A sees the whisper echo', a, async (p) =>
    (await texts(p)).find((t) => t.includes('→') && t.includes('psst')),
  );
  check(echo === `[Thì thầm] bạn → ${nameB}: psst, đừng nói ai`, `the sender gets an echo: "${echo}"`);
  await say(a, '/w khong_ai_ca hello?');
  const nobody = await until('A is told the target does not exist', a, async (p) =>
    (await texts(p)).find((t) => t.includes('Không tìm thấy người chơi')),
  );
  check(!!nobody, 'a whisper to nobody is answered, not silently dropped');
  await say(a, '/help');
  check(
    !!(await until('help shown locally', a, async (p) => (await texts(p)).find((t) => t.startsWith('/z nội dung')))),
    '/help is answered locally',
  );

  // ---- filter / zone / flood / markup
  await sleep(2100);
  await say(b, '/z gần đây có ai không? cursewordx');
  const zoneA = await until('A hears the zone line', a, async (p) =>
    (await texts(p)).find((t) => t.includes('gần đây có ai')),
  );
  check(
    zoneA === `[Vùng] ${nameB}: gần đây có ai không? **********`,
    `Zone line reaches A and the server masked the placeholder word: "${zoneA}"`,
  );
  await say(b, '<img src=x onerror=alert(1)>');
  const markup = await until('B line with markup arrives at A', a, async (p) =>
    (await texts(p)).find((t) => t.includes('<img')),
  );
  const injected = await a.evaluate("document.querySelectorAll('#vgtd-chat img').length");
  check(!!markup && injected === 0, 'markup in a line is shown as text and never becomes an element');
  for (let k = 0; k < 5; k++) await say(b, `flood ${k}`);
  const refused = await until('flood is answered with refusals', b, async (p) =>
    (await lines(p)).filter((l) => l.tone === 'error' && l.text.includes('quá nhanh')).length >= 2 ? true : null,
  );
  check(!!refused, 'a flood is refused with visible answers');

  // ---- touch screen: the box must not sit over the floating joystick zone (shared layout, D87 review)
  for (const [label, vp] of [
    ['landscape', { width: 844, height: 390 }],
    ['portrait', { width: 390, height: 844 }],
  ]) {
    const tp = await browser.newPage();
    await tp.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await tp.goto(url(`cht${label[0]}${stamp}`));
    const ready = await until(`touch ${label} chat box exists`, tp, (p) => p.evaluate('!!window.__vgtdChat'));
    if (ready) {
      const hit = (r) =>
        r &&
        r.box.x < r.joystick.x + r.joystick.w &&
        r.joystick.x < r.box.x + r.box.w &&
        r.box.y < r.joystick.y + r.joystick.h &&
        r.joystick.y < r.box.y + r.box.h;
      const folded = await tp.evaluate('window.__vgtdChat.placement()');
      await tp.evaluate("document.getElementById('vgtd-chat-input').focus()");
      const opened = await tp.evaluate('window.__vgtdChat.placement()');
      check(
        !!folded.joystick && !hit(folded) && !hit(opened),
        `touch ${label}: chat box (folded ${JSON.stringify(folded.box)}, opened ${JSON.stringify(opened.box)}) does not intersect joystick-zone ${JSON.stringify(folded.joystick)}`,
      );
    }
    await tp.close();
  }

  await a.bringToFront();
  await sleep(1200);
  await a.screenshot({ path: join(out, 'chat-a.png') });
  await b.bringToFront();
  await sleep(1200);
  await b.screenshot({ path: join(out, 'chat-b.png') });
  console.log(`screenshots in ${out}`);
} finally {
  await browser.close();
  web.close();
  server.kill();
}
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
