// Headless smoke test of the FRIENDS panel (D96): the real Cocos web build against the real dev server with two browser pages (two
// players). Alice asks Bob with `/friend add`, Bob accepts with the panel's Nhận button, both panels list each other online, the
// Nhắn shortcut puts `/w name ` into the chat input and Mời sends a party invite that Bob sees. Screenshot of Bob's open panel.
//
//   npm run friends:online -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs on free ports, CORS for the page origin), serves build/web-mobile, opens the page in headless
// Chrome / Edge (CHROME_PATH overrides), waits until the session is online, then checks through `window.__vgtdCombat.state()`:
// own vitals arrive from the server (snapshot `self.vitals`), monsters appear from AOI, a cast aimed with the pointer goes out and the
// server's result comes back (cooldown synced, MP spent), and, when a monster is in reach, damage lands on it. Writes a screenshot
// (default <tmpdir>/vgtd-friends-online). Exit code 1 on a failed check or a page error.
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-friends-online')));
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
  const open = async (name) => {
    const page = await browser.newPage();
    page.on('pageerror', (e) => {
      console.error(`[page error ${name}]`, e.message);
      failures++;
    });
    await page.goto(
      `http://127.0.0.1:${webPort}/?online=1&combat=1&class=kiem&npcs=0&server=127.0.0.1:${gwPort}&name=${name}`,
    );
    await page.waitForFunction('window.__vgtdOnline && window.__vgtdOnline().active && window.__vgtdFriends', {
      timeout: Number(process.env.SMOKE_WAIT_MS ?? 180000),
      polling: 250,
    });
    return page;
  };
  const stamp = Date.now() % 100000;
  const an = `fra${stamp}`;
  const bn = `frb${stamp}`;
  const alice = await open(an);
  const bob = await open(bn);
  mkdirSync(out, { recursive: true });
  check(true, 'two players online with the friends panel built');
  const ev = (page, expr) => page.evaluate(expr);
  const waitFor = async (page, expr, what, ms = 20000) => {
    try {
      await page.waitForFunction(expr, { timeout: ms, polling: 150 });
      check(true, what);
      return true;
    } catch {
      check(false, what);
      return false;
    }
  };

  // alice -> bob request through the chat line, as typed
  await ev(alice, `window.__vgtdChat.say('/friend add ${bn}')`);
  await waitFor(bob, `window.__vgtdFriends.incoming().includes('${an}')`, 'bob received the friend request');
  await waitFor(alice, `window.__vgtdFriends.outgoing().includes('${bn}')`, 'alice sees her request as sent');

  // bob opens the panel (key O) and presses Nhận
  await bob.bringToFront();
  await bob.keyboard.press('KeyO');
  check(await ev(bob, 'window.__vgtdFriends.visible()'), "the O key opens bob's friends panel");
  await sleep(400); // a frame to draw the rows
  check(
    await ev(bob, `window.__vgtdFriends.click('${an}', 'Nhận')`),
    'the incoming request row has a Nhận button and it was clicked',
  );
  await waitFor(
    bob,
    `window.__vgtdFriends.friends().some((f) => f.name === '${an}' && f.online)`,
    'bob lists alice as an ONLINE friend',
  );
  await waitFor(
    alice,
    `window.__vgtdFriends.friends().some((f) => f.name === '${bn}' && f.online)`,
    'alice lists bob as an ONLINE friend',
  );
  check((await ev(bob, 'window.__vgtdFriends.incoming().length')) === 0, 'the request is gone after accepting');
  await sleep(500);
  await bob.screenshot({ path: join(out, 'friends-panel.png') });
  console.log(`screenshot: ${join(out, 'friends-panel.png')}`);

  // shortcuts from alice's panel
  await alice.bringToFront();
  await alice.keyboard.press('KeyO');
  await sleep(400);
  check(await ev(alice, `window.__vgtdFriends.click('${bn}', 'Nhắn')`), 'alice presses Nhắn on bob');
  const prefill = await ev(alice, "document.querySelector('#vgtd-chat input').value");
  check(prefill === `/w ${bn} `, `the chat input is prefilled with the whisper command ("${prefill}")`);
  await ev(alice, "document.querySelector('#vgtd-chat input').value = ''");
  await ev(alice, "document.querySelector('#vgtd-chat input').blur()");
  check(await ev(alice, `window.__vgtdFriends.click('${bn}', 'Mời')`), 'alice presses Mời on bob');
  await waitFor(bob, `window.__vgtdParty.inviteFrom() === '${an}'`, 'bob got the party invite from the Mời shortcut');

  // remove from bob's panel
  check(await ev(bob, `window.__vgtdFriends.click('${an}', 'Xóa')`), 'bob presses Xóa on alice');
  await waitFor(alice, `window.__vgtdFriends.friends().length === 0`, 'alice no longer lists bob');
} finally {
  await browser.close();
  server.kill();
  web.close();
}
if (failures) console.error(`${failures} failure(s)`);
process.exit(failures ? 1 : 0);
