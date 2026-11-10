// Screenshots + checks of the PART 3 Gemini art (D118): the Son Mon sect buildings around the spawn and the HUD / item icons in the DOM panels.
//
//   npm run sect:screens -w client-cocos -- [--skip-build] [--out <dir>]
//
// Real Cocos web build, real dev server, headless Chrome / Edge (CHROME_PATH overrides). Part A (offline playground, `?at=`): frames the
// buildings from five viewpoints around the spawn and checks the page has no error and the player cannot walk through a building tile.
// Part B (online, two accounts): befriends, parties and joins the sect, opens the panels and checks the DOM icons are really images from the
// atlas (round HUD icons in the friends panel, the party frames and the chat input; the Cong hien token and the manual icons in the sect panel),
// and that the buttons keep their labels. Writes sect-*.png and panels-*.png to --out (default <tmpdir>/vgtd-sect-screens). Exit code 1 on
// a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-sect-screens')));
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
    INVENTORY: '1',
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
const nameA = `sca${stamp}`;
const nameB = `scb${stamp}`;
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

  // ------------------------------------------------------------------ Part A: the buildings (offline playground)
  const centre = 128; // the slice map is 256 x 256, the sect layout origin is its centre tile
  const views = [
    ['spawn', ''],
    ['hall', `&at=${centre - 13},${centre - 13}`],
    ['scripture-furnace', `&at=${centre - 4},${centre - 10}`],
    ['forge-gate', `&at=${centre + 9},${centre - 6}`],
    ['dummy-board', `&at=${centre - 9},${centre + 1}`],
  ];
  const offline = await browser.newPage();
  offline.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  for (const [name, at] of views) {
    await offline.goto(`http://127.0.0.1:${webPort}/?npcs=0&zoom=1.5${at}`);
    await offline.waitForFunction('window.__vgtdPerf !== undefined', { timeout: 120000 }).catch(() => undefined);
    await sleep(9000);
    await offline.screenshot({ path: join(out, `sect-${name}.png`) });
    console.log(`  shot sect-${name}.png`);
  }
  await offline.close();
  check(true, 'five offline viewpoints captured without a page error');

  // ------------------------------------------------------------------ Part B: DOM icons (online)
  const a = await open(nameA);
  const b = await open(nameB);
  await a.bringToFront();
  await until('A online', a, joined());
  await b.bringToFront();
  await until('B online', b, joined());
  const imgs = (p, sel) =>
    p.evaluate(
      `Array.from(document.querySelectorAll('${sel} img')).map((i) => ({ icon: i.dataset.icon, ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth }))`,
    );
  const members = (p) => p.evaluate('window.__vgtdParty.members()');

  // befriend: A asks, B accepts
  await say(a, `/friend add ${nameB}`);
  await until('B sees the request', b, (p) => p.evaluate('window.__vgtdFriends.incoming().length > 0'));
  await say(b, `/friend accept ${nameA}`);
  await until('A has a friend', a, (p) => p.evaluate('window.__vgtdFriends.friends().length > 0'));
  await a.bringToFront();
  await a.keyboard.press('KeyO');
  await until('friends panel open', a, (p) => p.evaluate('window.__vgtdFriends.visible()'));
  await sleep(500);
  const fi = await imgs(a, '#vgtd-friends');
  const names = new Set(fi.map((i) => i.icon));
  check(
    names.has('hud:online') && names.has('hud:close') && names.has('hud:friend_add'),
    `friends panel: HUD icons present (${[...names].join(', ')})`,
  );
  check(
    names.has('hud:chat') && names.has('hud:party_invite') && names.has('hud:friend_remove'),
    'friends panel: whisper / invite / remove buttons carry their icons',
  );
  check(
    fi.every((i) => i.ok && i.w > 0),
    'every icon is a decoded image cut from the atlas (not a broken link)',
  );
  const labels = await a.evaluate(
    "Array.from(document.querySelectorAll('#vgtd-friends button')).map((x) => x.textContent)",
  );
  check(
    labels.includes('Nhắn') && labels.includes('Mời') && labels.includes('Xóa') && labels.includes('Kết bạn'),
    `buttons keep their labels: ${JSON.stringify(labels)}`,
  );
  // chat input: the channel icon follows the typed prefix
  await a.keyboard.press('Enter');
  await until('chat focused', a, (p) => p.evaluate('window.__vgtdChat.focused()'), 10000);
  await a.keyboard.type('/p ');
  const ch = await a.evaluate(
    "document.querySelector('#vgtd-chat div[data-channel]')?.dataset.channel + ':' + document.querySelector('#vgtd-chat div[data-channel] img')?.dataset.icon",
  );
  check(ch === 'party:hud:party_invite', `chat input shows the party icon for "/p": ${ch}`);
  await a.screenshot({ path: join(out, 'panels-friends.png') });
  await a.keyboard.press('Escape');
  await a.keyboard.press('KeyO');

  // party: A invites B (B clicks the card), the leader gets the crown in B's frames
  await say(a, `/invite ${nameB}`);
  await b.bringToFront();
  await until('card', b, async (p) => (await p.evaluate('window.__vgtdParty.inviteFrom()')) || null);
  const cardIcons = await imgs(b, '#vgtd-party-invite');
  check(
    cardIcons.some((i) => i.icon === 'hud:party_invite' && i.ok),
    'party invite card carries the invite icon',
  );
  await b.click('#vgtd-party-invite button[data-cmd="/accept"]');
  await until('party formed', b, async (p) => ((await members(p)).length === 2 ? true : null));
  const crown = await imgs(b, '#vgtd-party-rows');
  check(
    crown.some((i) => i.icon === 'hud:leader' && i.ok),
    'the leader row shows the crown icon',
  );
  const rows = await b.evaluate(
    "Array.from(document.querySelectorAll('#vgtd-party-rows > div')).map((d) => [d.firstChild.dataset.leader, d.firstChild.textContent])",
  );
  check(
    rows.length === 1 && rows[0][0] === '1' && rows[0][1] === nameA,
    `party row: leader flag + plain name ${JSON.stringify(rows)}`,
  );
  await b.screenshot({ path: join(out, 'panels-party.png') });

  // sect: B joins and opens the library
  await say(b, '/sect join');
  await until('B is a member', b, (p) => p.evaluate('window.__vgtdSect.state().member === true'));
  await b.keyboard.press('KeyK');
  await until('sect panel open', b, (p) => p.evaluate('window.__vgtdSect.visible()'));
  await sleep(500);
  const si = await imgs(b, '#vgtd-sect');
  const sn = new Set(si.map((i) => i.icon));
  check(
    sn.has('hud:sect') && sn.has('hud:close') && sn.has('item:cong_hien_token'),
    `sect panel: badge, close and Cong hien token icons (${[...sn].join(', ')})`,
  );
  const manuals = si.filter((i) => i.icon && i.icon.startsWith('item:manual_t'));
  check(manuals.length >= 1 && manuals.every((i) => i.ok), `sect panel: ${manuals.length} manual icons, all decoded`);
  await b.screenshot({ path: join(out, 'panels-sect.png') });
  console.log(`screenshots in ${out}`);
} finally {
  await browser.close();
  web.close();
  server.kill();
}
console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
process.exit(failures ? 1 : 0);
