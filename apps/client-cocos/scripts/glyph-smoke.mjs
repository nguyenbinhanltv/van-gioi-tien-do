// Glyph coverage smoke test (D104): every glyph the player-facing text may use (ASCII, the 146 Vietnamese letter forms, a few symbols)
// is drawn through the shared label atlas by `?glyphs=1` (GlyphSheet.ts) and checked in a real browser.
//
//   npm run glyphs -w client-cocos -- [--skip-build] [--out <dir>]
//
// 1. (unless --skip-build) builds web-mobile (scripts/build-web.mjs, needs the Cocos editor)
// 2. serves it, opens `/?npcs=0&glyphs=1` in headless Chrome / Edge (puppeteer-core, CHROME_PATH overrides)
// 3. in the page: draws each glyph on a canvas with the label font and compares it with the browser's "missing glyph" box (U+FFFF); a
//    glyph that looks like the box has no font that covers it. Reads `window.__vgtdGlyphs` (glyph / label count, draw calls) and checks
//    that the sheet adds a bounded number of batches (the dynamic atlas holds the set instead of spilling into many pages)
// 4. writes glyphs.png to --out (default <tmpdir>/vgtd-glyphs). Exit code 1 on a missing glyph, a page error or too many batches.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
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
const out = resolve(opt('out', join(tmpdir(), 'vgtd-glyphs')));
/** Most batches the glyph sheet (21 labels, 3 font sizes) may add on top of the same scene without it. */
const MAX_EXTRA_DRAW_CALLS = 6;
mkdirSync(out, { recursive: true });

if (!args.includes('--skip-build')) {
  const b = spawnSync(process.execPath, [join(root, 'scripts/build-web.mjs')], { stdio: 'inherit' });
  if (b.status !== 0) throw new Error('build failed');
}
const buildDir = join(root, 'build/web-mobile');
if (!existsSync(buildDir)) throw new Error(`no ${buildDir} (run without --skip-build)`);

const mime = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.mjs': 'text/javascript',
};
const server = createServer((req, res) => {
  const rel = decodeURIComponent((req.url ?? '/').split('?')[0]).replace(/^\/+/, '') || 'index.html';
  const p = normalize(join(buildDir, rel));
  const f = existsSync(p) && statSync(p).isDirectory() ? join(p, 'index.html') : p;
  if (!f.startsWith(buildDir) || !existsSync(f)) {
    res.statusCode = 404;
    res.end();
    return;
  }
  res.setHeader('content-type', mime[extname(f)] ?? 'application/octet-stream');
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const port = server.address().port;

const candidates = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].filter(Boolean);
const executablePath = candidates.find((p) => existsSync(p));
if (!executablePath) throw new Error('no Chrome / Edge found (set CHROME_PATH)');

let failures = 0;
const check = (ok, msg) => {
  console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${msg}`);
  if (!ok) failures++;
};
const browser = await puppeteer.launch({
  executablePath,
  headless: true,
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
  await page.setViewport({ width: 1280, height: 720 });
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  // baseline: the same scene without the sheet
  const base = await browser.newPage();
  await base.setViewport({ width: 1280, height: 720 });
  await base.goto(`http://127.0.0.1:${port}/?npcs=0`, { waitUntil: 'load' });
  await base.waitForFunction('window.__vgtdPerf && window.__vgtdPerf.drawCalls > 0', { timeout: 120000, polling: 250 });
  await new Promise((r) => setTimeout(r, 3000));
  const baseCalls = await base.evaluate('window.__vgtdPerf.drawCalls');
  await base.close();
  await page.goto(`http://127.0.0.1:${port}/?npcs=0&glyphs=1`, { waitUntil: 'load' });
  await page.waitForFunction('window.__vgtdGlyphs', { timeout: 120000, polling: 250 });
  await new Promise((r) => setTimeout(r, 3000)); // glyphs are rasterized on first draw
  const info = await page.evaluate(`(() => {
    const g = window.__vgtdGlyphs;
    return { glyphs: g.glyphs, rows: g.rows, sizes: g.sizes, labels: g.labels, drawCalls: g.drawCalls() };
  })()`);
  // coverage: the font the Cocos labels use (Arial, then the browser's system fallback) against the browser's own "missing glyph" box
  const chars = await page.evaluate('window.__vgtdGlyphs.chars');
  const missing = await page.evaluate((all) => {
    const c = document.createElement('canvas');
    c.width = 64;
    c.height = 64;
    const ctx = c.getContext('2d', { willReadFrequently: true });
    const draw = (ch) => {
      ctx.clearRect(0, 0, 64, 64);
      ctx.font = '40px Arial';
      ctx.textBaseline = 'top';
      ctx.fillStyle = '#000';
      ctx.fillText(ch, 4, 4);
      const d = ctx.getImageData(0, 0, 64, 64).data;
      let s = '';
      for (let i = 3; i < d.length; i += 4) s += d[i] > 127 ? '1' : '0';
      return s;
    };
    const box = draw('\uFFFF');
    return Array.from(all).filter((ch) => ch !== ' ' && draw(ch) === box);
  }, chars);
  console.log(
    `sheet: ${info.glyphs} glyphs in ${info.rows} rows x ${info.sizes.length} sizes = ${info.labels} labels, ${info.drawCalls} draw calls (${baseCalls} without the sheet)`,
  );
  check(
    missing.length === 0,
    missing.length
      ? `glyphs with no font: ${missing.join(' ')}`
      : `all ${chars.length} glyphs have a font (no missing-glyph boxes)`,
  );
  check(info.glyphs >= 256, `the sheet has the full glyph set (${info.glyphs})`);
  check(
    info.drawCalls > 0 && info.drawCalls - baseCalls <= MAX_EXTRA_DRAW_CALLS,
    `the shared dynamic atlas holds the set in few batches (+${info.drawCalls - baseCalls} draw calls <= +${MAX_EXTRA_DRAW_CALLS})`,
  );
  await page.screenshot({ path: join(out, 'glyphs.png') });
  console.log(`screenshot: ${join(out, 'glyphs.png')}`);
} finally {
  await browser.close();
  server.close();
}
if (failures) {
  console.log(`${failures} check(s) failed`);
  process.exit(1);
}
console.log('all checks passed');
