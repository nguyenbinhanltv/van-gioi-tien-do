// Headless visual QA capture for the animation viewer (agents review animations without a GUI).
//
//   npm run capture -w client-cocos -- [--out <dir>] [--animations idle,walk|all] [--frames 8] [--mode review|single]
//                                      [--direction S] [--src dragonbones/viewer] [--stem rig] [--skip-build] [--gif]
//
// 1. (unless --skip-build) builds web-mobile with scripts/build-web.mjs
// 2. serves build/web-mobile on a free port, opens the viewer in headless Chrome/Edge (puppeteer-core, no browser download;
//    set CHROME_PATH to override the browser) with software WebGL
// 3. per animation: pauses the viewer, steps through N evenly spaced frames and writes into <out>/ (not committed):
//      <animation>.sheet.png   contact sheet (frames in reading order; review mode = all 8 directions per tile)
//      <animation>.gif         short looping GIF of the full animation (with --gif; ~30 key frames/s, tiles at 50%)
//      index.json              per animation: duration, frames, loop-seam metric (ratio > 2.5 = pop), file names
// Default --out: <tmpdir>/vgtd-capture. Exit code 1 on a page error, a viewer error, or a popping loop seam (only animations that loop per the table are judged).
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer from 'puppeteer-core';
import { contactSheet, decodePng, downscale, encodeGif, encodePng } from './capture-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const out = resolve(opt('out', join(tmpdir(), 'vgtd-capture')));
const frames = Number(opt('frames', 8));
const mode = opt('mode', 'review');
const direction = opt('direction', 'S');
const src = opt('src', ''); // default: the viewer's own default character (Kiem tu when present, else the test rig)
const stem = opt('stem', '');
const wantGif = flag('gif');
/** Region of the 1280x720 viewport holding the actors (panel + HUD hidden during capture). */
const CLIP =
  mode === 'review' ? { x: 190, y: 120, width: 900, height: 470 } : { x: 340, y: 120, width: 600, height: 470 };

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

if (!flag('skip-build')) {
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
  '.css': 'text/css',
  '.wasm': 'application/wasm',
};
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let f = join(webDir, p || 'index.html');
  if (!f.startsWith(webDir) || !existsSync(f)) return void res.writeHead(404).end();
  if (statSync(f).isDirectory()) f = join(f, 'index.html');
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); // loopback only
const port = server.address().port;

mkdirSync(out, { recursive: true });
const browser = await puppeteer.launch({
  executablePath: findBrowser(),
  headless: 'new',
  defaultViewport: { width: 1280, height: 720 },
  protocolTimeout: 600000,
  args: [
    '--no-sandbox',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--enable-webgl',
  ],
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  const url = `http://127.0.0.1:${port}/#viewer&mode=${mode}&dir=${direction}&paused=1${src ? `&src=${src}` : ''}${stem ? `&stem=${stem}` : ''}`;
  console.log('opening', url);
  await page.goto(url);
  const waitReady = async (timeout = 180000) => {
    // fail fast when the viewer reports an error (rig missing, exception) instead of waiting for the timeout
    await page.waitForFunction('window.__vgtdViewer && (window.__vgtdViewer.error() || window.__vgtdViewer.ready())', {
      timeout,
      polling: 250,
    });
    const err = await page.evaluate('window.__vgtdViewer.error()');
    if (err) throw new Error(`viewer error: ${err}`);
  };
  await waitReady();
  console.log('viewer ready');
  const all = await page.evaluate('window.__vgtdViewer.animations');
  const names = opt('animations', 'all') === 'all' ? all : opt('animations', 'all').split(',');
  if (flag('perf')) {
    // Cache-mode CPU cost: N copies of one animation, median of 5 one-second samples per mode (software GL: compare
    // update/render CPU ms between modes, do not read absolute numbers as device performance).
    const n = Number(opt('n', 30));
    const anim = opt('animations', 'run').split(',')[0];
    const results = {};
    const batch = flag('batch');
    for (const cache of ['realtime', 'shared', 'private']) {
      await page.evaluate(
        `window.__vgtdViewer.set({ mode: 'crowd', crowd: ${n}, cache: ${JSON.stringify(cache)}, batch: ${batch}, animation: ${JSON.stringify(anim)}, paused: false })`,
      );
      await sleep(500);
      await waitReady();
      await sleep(4000);
      const samples = [];
      for (let i = 0; i < 5; i++) {
        await sleep(1000);
        samples.push(await page.evaluate('({ ...window.__vgtdPerf })'));
      }
      const med = (k) => samples.map((x) => x[k]).sort((a, b) => a - b)[Math.floor(samples.length / 2)];
      results[cache] = Object.fromEntries(
        ['fps', 'updateMs', 'renderMs', 'drawCalls', 'triangles', 'textureMB', 'jsHeapMB'].map((k) => [
          k,
          Number(Number(med(k)).toFixed(2)),
        ]),
      );
      console.log(`${cache}: ${JSON.stringify(results[cache])}`);
      writeFileSync(join(out, `crowd-${cache}.png`), Buffer.from(await page.screenshot({ type: 'png' })));
    }
    const info = await page.evaluate('window.__vgtdViewer.info()');
    writeFileSync(
      join(out, 'perf.json'),
      JSON.stringify({ source: info.source, animation: anim, copies: n, batch, results }, null, 2),
    );
    console.log(`perf done -> ${out}`);
    await browser.close();
    server.close();
    process.exit(failures ? 1 : 0);
  }
  await page.evaluate('window.__vgtdViewer.chrome(false)');
  const index = { url, mode, direction, frames, animations: {} };

  for (const anim of names) {
    await page.evaluate(
      `window.__vgtdViewer.set({ animation: ${JSON.stringify(anim)}, mode: ${JSON.stringify(mode)}, direction: ${JSON.stringify(direction)}, paused: true })`,
    );
    await sleep(200);
    console.log(`  ${anim}: waiting for ready`);
    await waitReady(60000);
    await sleep(300);
    const info = await page.evaluate('window.__vgtdViewer.info()');
    const seam = await page.evaluate('window.__vgtdViewer.seam()');
    console.log(`  ${anim}: info`, JSON.stringify(info), 'seam', JSON.stringify(seam));
    const shots = [];
    for (let i = 0; i < frames; i++) {
      console.log(`    frame ${i}: seek`);
      await page.evaluate(`window.__vgtdViewer.seekNorm(${i / frames})`);
      await sleep(250); // two or more rendered frames in software GL
      console.log(`    frame ${i}: screenshot`);
      shots.push(Buffer.from(await page.screenshot({ type: 'png', clip: CLIP })));
    }
    // contact sheet: full-size tiles, 3 per row, composed in Node (no page work needed)
    const tiles = shots.map((png) => downscale(decodePng(png), 1));
    writeFileSync(join(out, `${anim}.sheet.png`), encodePng(contactSheet(tiles, 3)));
    index.source = info.source;
    const entry = { duration: info.duration, keyFrames: info.frames, seam, sheet: `${anim}.sheet.png` };
    if (wantGif) {
      const n = Math.min(Math.max(info.frames, 4), 36);
      const clip = [];
      for (let i = 0; i < n; i++) {
        await page.evaluate(`window.__vgtdViewer.seekNorm(${i / n})`);
        await sleep(200);
        clip.push(downscale(decodePng(Buffer.from(await page.screenshot({ type: 'png', clip: CLIP }))), 2));
      }
      writeFileSync(join(out, `${anim}.gif`), encodeGif(clip, Math.max(2, Math.round((100 * info.duration) / n))));
      entry.gif = `${anim}.gif`;
    }
    // only animations that loop per the table must wrap seamlessly; one-shots (die, dash, hit, ...) just report the ratio
    if (seam && seam.specLoop && seam.ratio > 2.5) {
      entry.warning = `loop seam pops (x${seam.ratio.toFixed(2)})`;
      failures++;
    }
    index.animations[anim] = entry;
    console.log(`captured ${anim}: ${info.duration.toFixed(2)} s, seam ${seam ? 'x' + seam.ratio.toFixed(2) : 'n/a'}`);
  }
  writeFileSync(join(out, 'index.json'), JSON.stringify(index, null, 2));
  console.log(`done -> ${out}`);
} finally {
  await browser.close();
  server.close();
}
process.exit(failures ? 1 : 0);
