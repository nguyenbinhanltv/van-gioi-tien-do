// KPI dashboard demo / smoke (D109): starts the real gateway with a telemetry service filled with SYNTHETIC history (clearly fake: players
// "demo", two weeks of invented sessions, FTUE steps and ledger entries), serves /dashboard and, with --check, drives headless Chrome / Edge
// at the page and asserts what it draws.
//
//   npm run dashboard:demo -w @vgtd/server               -> serves http://127.0.0.1:<port>/dashboard until Ctrl+C
//   npm run dashboard:demo -w @vgtd/server -- --check [--out <dir>]
//                                                       -> loads the page in a real browser, checks it, writes dashboard.png, exits
// The synthetic data lives in memory only; nothing is written to disk and no real server data is touched.
import { build } from 'esbuild';
import { existsSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const check = args.includes('--check');
const outIdx = args.indexOf('--out');
const out = resolve(outIdx >= 0 && args[outIdx + 1] ? args[outIdx + 1] : join(tmpdir(), 'vgtd-dashboard'));

const outdir = join(root, 'node_modules', '.vgtd-dev');
mkdirSync(outdir, { recursive: true });
await build({
  entryPoints: { demo: join(root, 'src/index.ts') },
  outdir,
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node18',
  outExtension: { '.js': '.mjs' },
  external: ['ws'],
  logLevel: 'warning',
});
const { TelemetryService, Ledger, startServer } = await import(pathToFileURL(join(outdir, 'demo.mjs')).href);

// ---- synthetic history: 14 days, growing population, a leaky FTUE funnel, a slightly sink-poor economy
const DAY = 86_400_000;
const T = Date.UTC(2026, 10, 9, 12, 0, 0);
let now = T - 13 * DAY;
const t = new TelemetryService({ key: 'd'.repeat(64), now: () => now });
const ledger = new Ledger();
t.attachLedger(ledger);
const STEPS = ['move', 'field', 'skill', 'kills', 'loot', 'meditate', 'breakthrough'];
let n = 0;
const wallet = (o) => ({ kind: 'PLAYER_WALLET', ownerId: o, currency: 'LT_HA' });
for (let day = 0; day < 14; day++) {
  now = T - (13 - day) * DAY;
  const fresh = 6 + day * 2;
  for (let i = 0; i < fresh; i++) {
    const acc = `demo-${n++}`;
    t.sessionStart(acc, 1 + (i % 6));
    const reach = 1 + ((i * 7) % 9) / 9; // fraction of the funnel this fake player completes
    STEPS.forEach((s, k) => {
      if (k / STEPS.length < reach - 0.25) t.ftue(acc, { kind: 'step', step: s });
    });
    if (i % 3 === 0) t.ftue(acc, { kind: 'complete' });
    now += 600_000 + i * 20_000;
    t.sessionEnd(acc, 'quit');
  }
  for (let i = 0; i < Math.min(n, 12 + day); i++) {
    const acc = `demo-${i}`;
    t.sessionStart(acc, 1);
    now += 120_000;
    t.sessionEnd(acc, 'quit');
  }
  for (let m = 0; m < 5; m++) {
    t.tick(3 + day + m);
    now += 61_000;
  }
  ledger.post({
    reason: 'DROP',
    idempotencyKey: `f${day}`,
    entries: [
      { account: { kind: 'SYSTEM_FAUCET_DROP_MOB', ownerId: null, currency: 'LT_HA' }, delta: -1000n },
      { account: wallet('demo-0'), delta: 1000n },
    ],
  });
  ledger.post({
    reason: 'DROP',
    idempotencyKey: `s${day}`,
    entries: [
      { account: wallet('demo-0'), delta: -820n },
      { account: { kind: 'SYSTEM_SINK_BREAKTHROUGH', ownerId: null, currency: 'LT_HA' }, delta: 820n },
    ],
  });
  t.pollLedger();
}
now = T;
t.sessionStart('demo-live-1', 1);
t.sessionStart('demo-live-2', 2);
t.tick(2);

const srv = await startServer({ port: 0, auth: { registerPerIpPerDay: 0 }, world: { mapTiles: 64, telemetry: t } });
const url = `http://127.0.0.1:${srv.port}/dashboard`;
console.log(`dashboard demo (synthetic data): ${url}`);

if (!check) {
  process.on('SIGINT', () => void srv.stop().then(() => process.exit(0)));
} else {
  let failures = 0;
  const ok = (cond, what) => {
    console.log(`  ${cond ? 'PASS' : 'FAIL'}  ${what}`);
    if (!cond) failures++;
  };
  const candidates = [
    process.env.CHROME_PATH,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ].filter(Boolean);
  const exe = candidates.find((p) => existsSync(p));
  if (!exe) throw new Error('No Chrome/Edge found. Set CHROME_PATH to a Chromium-based browser executable.');
  const puppeteer = (await import('puppeteer-core')).default;
  const browser = await puppeteer.launch({ executablePath: exe, headless: 'new', args: ['--no-sandbox'] });
  try {
    mkdirSync(out, { recursive: true });
    const page = await browser.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.setViewport({ width: 1100, height: 1500 });
    await page.goto(url);
    await page.waitForFunction(
      "document.querySelectorAll('#days tr').length > 3 && document.querySelectorAll('#econ tr').length > 1",
      { timeout: 15000 },
    );
    const txt = (sel) => page.$eval(sel, (e) => e.innerText);
    const meta = await txt('#meta');
    ok(/schema 1\.0\.0/.test(meta) && /chỉ nằm trên máy chủ/.test(meta), `header says the data is local: "${meta}"`);
    const live = await txt('#live');
    ok(/\b2\b/.test(live), `live CCU card shows the two connected demo players: ${JSON.stringify(live)}`);
    const days = await page.$$eval('#days tr', (rows) => rows.length - 1);
    ok(days === 14, `the daily table lists 14 days (${days})`);
    const ftue = await txt('#ftue');
    ok(/move/.test(ftue) && /breakthrough/.test(ftue), 'the FTUE funnel lists the steps');
    const ftueNote = await txt('#ftueNote');
    ok(
      /hoàn thành: \d+/.test(ftueNote) && /85%/.test(ftueNote),
      `FTUE completion and the 85% gate are shown: "${ftueNote}"`,
    );
    const ret = await txt('#ret');
    ok(/D1/.test(ret) && /D7/.test(ret) && /D30/.test(ret), 'retention D1 / D7 / D30 rows are shown');
    const econ = await txt('#econ');
    ok(
      /lt_ha/.test(econ) && /0\.82/.test(econ),
      `the economy table shows the LT_HA sink / source ratio 0.82: ${JSON.stringify(econ.slice(0, 120))}`,
    );
    const warn = await page.$$eval('#econ .warn', (e) => e.length);
    ok(warn >= 1, 'a ratio outside the 0.9-1.0 target is highlighted');
    ok(errors.length === 0, `no page errors${errors.length ? ': ' + errors[0] : ''}`);
    const leaked = await page.evaluate(
      "document.documentElement.outerHTML.match(/[0-9a-f]{64}/) !== null || document.body.innerText.includes('demo-')",
    );
    ok(!leaked, 'the page shows no pseudonymous id and no account id');
    await page.screenshot({ path: join(out, 'dashboard.png'), fullPage: true });
    console.log(`screenshot in ${out}`);
  } finally {
    await browser.close();
    await srv.stop();
  }
  console.log(failures ? `${failures} check(s) FAILED` : 'all checks passed');
  process.exit(failures ? 1 : 0);
}
