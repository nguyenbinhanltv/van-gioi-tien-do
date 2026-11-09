// Headless smoke test of the PARTY (D93): two browser pages form a party through the real chat box and the real party frames; the real Cocos
// web build against the real dev server.
//
//   npm run party:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports), serves build/web-mobile, opens TWO pages in headless Chrome / Edge (CHROME_PATH
// overrides) as two accounts and checks, with REAL typing and a REAL click on the invite card's buttons:
//   - /invite name: the other page shows the invite card; clicking Accept forms the party, both frames list the OTHER member (leader starred);
//   - member HP / MP arrive over the wire and fill the frames; /p text reaches the other member on the party channel;
//   - Decline removes the card and no party forms; /kick (leader) and /leave end the party; party chat outside a party is answered, not dropped;
//   - on a touch-emulated page the frames stack stays clear of the joystick zone and the folded chat strip.
// Writes party-a.png and party-b.png to --out (default <tmpdir>/vgtd-party). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-party')));
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
const nameA = `pta${stamp}`;
const nameB = `ptb${stamp}`;
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
  const members = (p) => p.evaluate('window.__vgtdParty.members()');
  const inviteFrom = (p) => p.evaluate('window.__vgtdParty.inviteFrom()');
  const hasLine = async (p, text) => (await texts(p)).find((t) => t.includes(text));
  check(true, 'both pages are online with chat box and party frames');

  // ---- invite -> card -> real click on Accept
  await say(a, `/invite ${nameB}`);
  const cardFrom = await until('B gets the invite card', b, async (p) => (await inviteFrom(p)) || null);
  if (!cardFrom) console.log('A chat lines:', JSON.stringify(await texts(a)));
  check(cardFrom === nameA, `B sees an invite from ${cardFrom}`);
  check(
    !!(await until('B has the invite line', b, (p) => hasLine(p, 'mời bạn vào tổ đội'))),
    'the invite is also a chat line',
  );
  await b.bringToFront();
  await until('card is visible', b, (p) =>
    p.evaluate("getComputedStyle(document.getElementById('vgtd-party-invite')).display === 'block'"),
  );
  await b.click('#vgtd-party-invite button[data-cmd="/accept"]');
  const mb = await until('B is in a party', b, async (p) =>
    (await members(p)).length === 2 ? await members(p) : null,
  );
  const ma = await until('A is in a party', a, async (p) =>
    (await members(p)).length === 2 ? await members(p) : null,
  );
  check(
    !!mb && !!ma && ma.find((m) => m.isMe)?.isLeader === true && mb.find((m) => m.isMe)?.isLeader === false,
    'the party formed: A leads, B is a member (clicked Accept)',
  );
  check((await inviteFrom(b)) === null, 'the invite card is gone after accepting');

  // ---- frames show the OTHER member, with vitals from the wire
  const rowsB = await b.evaluate(
    "Array.from(document.querySelectorAll('#vgtd-party-rows > div')).map((d) => d.firstChild.textContent)",
  );
  check(
    rowsB.length === 1 && rowsB[0] === `★ ${nameA}`,
    `B's frames list only A, the leader starred: ${JSON.stringify(rowsB)}`,
  );
  const vit = await until('vitals reach B', b, async (p) => {
    const m = (await members(p)).find((x) => !x.isMe);
    return m && m.hpMax > 0 ? m : null;
  });
  check(
    !!vit && vit.hp > 0 && vit.hp <= vit.hpMax,
    `A's HP bar data reached B over the wire: ${vit && vit.hp}/${vit && vit.hpMax}`,
  );
  const fillW = await b.evaluate(
    "document.querySelector('#vgtd-party-rows > div > div:nth-child(2) > div').style.width",
  );
  check(fillW === '100%', `the HP bar is drawn (full: ${fillW})`);

  // ---- party chat
  await say(a, '/p kéo quái bên trái');
  const pc = await until('B gets the party line', b, (p) => hasLine(p, 'kéo quái bên trái'));
  check(pc === `[Đội] ${nameA}: kéo quái bên trái`, `party chat reaches the member: "${pc}"`);
  await sleep(300);
  check(!(await hasLine(b, '[Thế giới] ' + nameA + ': kéo quái')), 'a party line is not a World line');

  // ---- a non-leader cannot kick; the leader can
  await say(b, `/kick ${nameA}`);
  check(
    !!(await until('B is refused', b, (p) => hasLine(p, 'Chỉ đội trưởng'))),
    'a member who tries /kick is told only the leader can',
  );
  await say(a, `/kick ${nameB}`);
  const left = await until('B is out of the party', b, async (p) => ((await members(p)).length === 0 ? true : null));
  check(!!left && !!(await hasLine(b, 'Bạn đã rời tổ đội')), 'after /kick B is out and is told');
  check((await members(a)).length === 0, 'the party of two disbanded for A as well');

  // ---- party chat outside a party is answered
  await say(b, '/p alo?');
  check(
    !!(await until('answered', b, (p) => hasLine(p, 'Bạn chưa vào tổ đội nào'))),
    'party chat without a party is answered, not dropped',
  );

  // ---- decline
  await sleep(1200);
  await say(a, `/invite ${nameB}`);
  await until('B gets the card again', b, async (p) => (await inviteFrom(p)) || null);
  await b.bringToFront();
  await until('card is visible', b, (p) =>
    p.evaluate("getComputedStyle(document.getElementById('vgtd-party-invite')).display === 'block'"),
  );
  await b.click('#vgtd-party-invite button[data-cmd="/decline"]');
  const gone = await until('card disappears', b, async (p) => ((await inviteFrom(p)) === null ? true : null));
  await sleep(500);
  check(
    !!gone && (await members(b)).length === 0 && (await members(a)).length === 0,
    'Decline removes the card and no party forms',
  );

  // ---- re-form by typing, then /leave
  await sleep(1200);
  await say(a, `/invite ${nameB}`);
  await until('B gets the card', b, async (p) => (await inviteFrom(p)) || null);
  await say(b, '/accept');
  await until('party re-formed', a, async (p) => ((await members(p)).length === 2 ? true : null));
  await say(b, '/leave');
  const bye = await until('A is alone again', a, async (p) => ((await members(p)).length === 0 ? true : null));
  check(!!bye, 'a member typing /leave ends a party of two for both');

  // ---- leave screenshots with a live party
  await sleep(1200);
  await say(a, `/invite ${nameB}`);
  await until('card', b, async (p) => (await inviteFrom(p)) || null);
  await b.evaluate('window.__vgtdParty.accept()');
  await until('party for the screenshot', b, async (p) => ((await members(p)).length === 2 ? true : null));
  await a.bringToFront();
  await sleep(1200);
  await a.screenshot({ path: join(out, 'party-a.png') });
  await b.bringToFront();
  await sleep(1200);
  await b.screenshot({ path: join(out, 'party-b.png') });

  // ---- touch screens: the frames stack must not sit on the joystick zone or the folded chat strip
  for (const [label, vp] of [
    ['landscape', { width: 844, height: 390 }],
    ['portrait', { width: 390, height: 844 }],
  ]) {
    const tp = await browser.newPage();
    await tp.setViewport({ ...vp, deviceScaleFactor: 1, hasTouch: true, isMobile: true });
    await tp.goto(url(`ptt${label[0]}${stamp}`));
    const ready = await until(`touch ${label} party frames exist`, tp, (p) => p.evaluate('!!window.__vgtdParty'));
    if (ready) {
      const r = await tp.evaluate('window.__vgtdParty.layoutRects()');
      const hit = (x, y) => x.x < y.x + y.w && y.x < x.x + x.w && x.y < y.y + y.h && y.y < x.y + x.h;
      const stack = { x: r.frames.x, y: r.frames.y, w: r.frames.w, h: r.frames.rowH * 3 };
      const dom = await tp.evaluate('window.__vgtdParty.rect()');
      check(
        r.touch &&
          !hit(stack, r.joystick) &&
          !hit(stack, r.strip) &&
          Math.abs(dom.x - stack.x) < 1.5 &&
          Math.abs(dom.y - stack.y) < 1.5,
        `touch ${label}: party frames (${JSON.stringify(stack)}) clear of joystick ${JSON.stringify(r.joystick)} and chat strip ${JSON.stringify(r.strip)}`,
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
