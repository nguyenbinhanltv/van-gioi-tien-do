// Headless forced-error check of CRASH REPORTING (D110): the real Cocos web build against the real dev server.
//
//   npm run crash:smoke -w client-cocos -- [--skip-build] [--out <dir>]
//
// Starts apps/server (scripts/dev.mjs, CRASH_DIR in a temp dir), serves build/web-mobile and opens two pages in headless Chrome / Edge
// (CHROME_PATH overrides):
//   - page A (`?online=1&crashtest=1`) throws one uncaught error 1.5 s after the start (forced) and is then closed;
//   - page B (`?online=1`) runs clean and is then closed.
// Checks on the server side (GET /ops/crash/summary.json, loopback) and on disk (crash-*.jsonl): two sessions, one crashed, crash-free
// 50 %, the forced error is the top crash with a stack and the build id, the files hold no IP / username / query string.
// Exit code 1 on a failed check.
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createServer as createNetServer } from 'node:net';
import { createReadStream, existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
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
const crashDir = mkdtempSync(join(tmpdir(), 'vgtd-crash-smoke-'));

const server = spawn(process.execPath, [join(root, '../server/scripts/dev.mjs')], {
  stdio: ['ignore', 'pipe', 'inherit'],
  env: {
    ...process.env,
    PORT: String(gwPort),
    HOST: '127.0.0.1',
    CORS_ORIGINS: `http://127.0.0.1:${webPort}`,
    REGISTER_PER_IP_PER_DAY: '0',
    CRASH_DIR: crashDir,
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
const summary = async () => (await fetch(`http://127.0.0.1:${gwPort}/ops/crash/summary.json`)).json();
const until = async (pred, ms = 30000) => {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) {
    const v = await pred().catch(() => null);
    if (v) return v;
    await sleep(200);
  }
  return null;
};
const open = async (name, extra) => {
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(`http://127.0.0.1:${webPort}/?online=1&npcs=0&server=127.0.0.1:${gwPort}&name=${name}${extra}`);
  return { page, errors };
};

try {
  const stamp = String(Date.now() % 100000);
  const a = await open(`crasha${stamp}`, '&crashtest=1');
  const forced = await until(async () => {
    const s = await summary();
    return s.top.some((t) => /forced crash test/.test(t.message)) ? s : null;
  });
  check(!!forced, 'the forced uncaught error reached the server');
  check(
    a.errors.some((m) => /forced crash test/.test(m)),
    'the page really threw it (uncaught)',
  );
  await a.page.close(); // pagehide -> session_end marker
  const b = await open(`crashb${stamp}`, '');
  await until(async () => (await summary()).sessions >= 2);
  await sleep(1500);
  await b.page.close();
  await sleep(1000);

  const s = await summary();
  console.log(
    '  summary:',
    JSON.stringify({ sessions: s.sessions, crashed: s.crashedSessions, pct: s.crashFreePct, builds: s.byBuild }),
  );
  check(s.sessions === 2, `two sessions started (got ${s.sessions})`);
  check(s.crashedSessions === 1, `exactly one session crashed (got ${s.crashedSessions})`);
  check(s.crashFreePct === 50, `crash-free sessions is 50 % (got ${s.crashFreePct})`);
  const top = s.top[0];
  check(
    top && top.fatal && top.source === 'error' && /forced crash test/.test(top.message),
    'top crash is the forced fatal error',
  );
  check((top && /at /.test(top.stack || '')) || /@/.test(top?.stack || ''), 'the top crash carries a stack');
  check(s.byBuild.length === 1 && s.byBuild[0].build === 'dev', 'build id recorded');

  const files = readdirSync(crashDir).filter((f) => /^crash-.*\.jsonl$/.test(f));
  check(files.length >= 1, `a daily JSONL file was written (${files.join(', ')})`);
  const text = files.map((f) => readFileSync(join(crashDir, f), 'utf8')).join('\n');
  check(
    !/crasha|crashb|token=|username|[?&][a-z]+=/.test(text),
    'the stored lines hold no username or query string (stack URLs carry the page origin only)',
  );
  check(/"kind":"session_end"/.test(text), 'a session_end marker arrived on page close');
} finally {
  await browser.close().catch(() => undefined);
  server.kill();
  web.close();
  rmSync(crashDir, { recursive: true, force: true });
}
console.log(failures === 0 ? 'crash smoke: OK' : `crash smoke: ${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
