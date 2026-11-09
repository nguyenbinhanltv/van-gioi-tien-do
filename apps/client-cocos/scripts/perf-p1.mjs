// P1 exit-criteria measurement on Web (docs/10-mvp-scope.md section 12): draw calls, RAM, FPS with 20 NPC, initial package size.
//
//   npm run perf:p1 -w client-cocos -- [--skip-build] [--npcs 20] [--npcart chibi|placeholder] [--tier low|medium|high] [--seconds 20] [--warmup 6]
//                                      [--route] [--zoom 1.5] [--mobs] [--vfxdemo] [--class the-tu] [--draw-limit N] [--out <dir>] [--gate-fps]
//
// --route walks a scripted loop over the whole multi-chunk map (`?route=1`, default 90 s) and adds streaming numbers:
// chunk node-tree build cost, chunks built / unloaded, frames with unresolved visible chunks, worst frame, hitches > 50 / 100 ms,
// and draw calls / RAM / chunk count over the walk.
//
// 1. (unless --skip-build) builds web-mobile (scripts/build-web.mjs, needs the Cocos editor, see README)
// 2. serves it and records every file the page requests; the initial package = files first requested until the world is playable
//    (raw and gzip), the total fetched during the whole run (lazy / streamed assets) is reported separately
// 3. serves the build on loopback, opens `/?npcs=N&tier=T` in headless Chrome/Edge (puppeteer-core, set CHROME_PATH to
//    override) and samples `window.__vgtdPerf` (published by PerfHud) twice a second after a warm-up
// 4. prints a table against the exit criteria and writes <out>/p1-perf.json (default <tmpdir>/vgtd-perf)
//
// Headless runs on SwiftShader (software WebGL), so FPS is a lower bound of the CPU/JS cost, NOT a GPU number:
// FPS is reported but only fails the run with --gate-fps. Draw calls, RAM and package size are renderer-independent
// and always gate (exit code 1). The same numbers on a real phone: docs/33-p1-perf.md.
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import puppeteer from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

// Budgets come from @vgtd/shared via PerfHud (`window.__vgtdPerf.budgets`), read below. Only the FPS floor is local: it has no
// shared constant (docs/10 section 12: >= 30 FPS with 20 NPC).
const MIN_FPS = 30;

const npcs = Number(opt('npcs', 20));
const tier = opt('tier', 'medium');
const npcart = opt('npcart', 'chibi'); // chibi = real armatures (6 classes), placeholder = tinted sprite
const route = flag('route');
const mobs = flag('mobs'); // 14 mobs + the combat HUD (`?combat=1&mobdemo=1`): the heavy scenario of docs/33
const drawLimit = Number(opt('draw-limit', 80));
const zoom = opt('zoom', ''); // camera zoom override (`?zoom=`), default = the game's default (D81: 1.5)
const seconds = Number(opt('seconds', route ? 90 : 20));
const warmup = Number(opt('warmup', 6));
const out = resolve(opt('out', join(tmpdir(), 'vgtd-perf')));
if (!Number.isInteger(npcs) || npcs < 0) throw new Error('--npcs must be a non-negative integer');
if (!['low', 'medium', 'high'].includes(tier)) throw new Error('--tier must be low, medium or high');

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
  const b = spawnSync(process.execPath, [join(root, 'scripts/build-web.mjs'), '--release'], { stdio: 'inherit' });
  if (b.status !== 0) process.exit(b.status ?? 1);
}
const webDir = join(root, 'build/web-mobile');
if (!existsSync(join(webDir, 'index.html'))) throw new Error('build/web-mobile missing: run without --skip-build');

// ---- whole build output (info only) ----------------------------------------------------------------------------------
// The initial package is what the game FETCHES to reach the playable scene (measured below from the served-file log).
// The build folder also holds lazily loaded `resources` such as the dev-only animation-viewer art, which never ships in the
// first download, so its total is informational.
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const f = join(dir, name);
    if (statSync(f).isDirectory()) yield* walk(f);
    else yield f;
  }
}
const MB = 1048576;
let buildRaw = 0;
const byDir = {};
for (const f of walk(webDir)) {
  const n = statSync(f).size;
  buildRaw += n;
  const top = relative(webDir, f).replaceAll(sep, '/').split('/').slice(0, 2).join('/');
  byDir[top] = (byDir[top] ?? 0) + n;
}

// ---- serve + measure -----------------------------------------------------------------------------------------------
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};
const served = new Set(); // files the page actually requested
const servedAt = new Map(); // file -> ms timestamp of first request (initial vs streamed split)
const server = createServer((req, res) => {
  const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^([/\\])+/, '');
  let f = join(webDir, p || 'index.html');
  if (!f.startsWith(webDir) || !existsSync(f)) return void res.writeHead(404).end();
  if (statSync(f).isDirectory()) f = join(f, 'index.html');
  served.add(f);
  if (!servedAt.has(f)) servedAt.set(f, Date.now());
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream', 'cache-control': 'no-store' });
  createReadStream(f).pipe(res);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r)); // loopback only
const port = server.address().port;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => {
  const s = [...a].sort((x, y) => x - y);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
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
    '--js-flags=--expose-gc', // lets the route run measure the RETAINED heap (after a forced GC) at start and end
    '--enable-precise-memory-info', // exact performance.memory.usedJSHeapSize (default is bucketed)
  ],
});
let failures = 0;
let tPlayable = Infinity;
const samples = [];
let meta = {};
let retained = null; // { startMB, endMB } heap after a forced GC (route runs)
try {
  const page = await browser.newPage();
  page.on('pageerror', (e) => {
    console.error('[page error]', e.message);
    failures++;
  });
  const url = `http://127.0.0.1:${port}/?npcs=${npcs}&tier=${tier}&npcart=${npcart}${route ? '&route=1' : ''}${zoom ? `&zoom=${zoom}` : ''}${mobs ? '&combat=1&mobdemo=1' : ''}${flag('drawdbg') ? '&drawdbg=1' : ''}${flag('vfxdemo') ? '&vfxdemo=1' : ''}${flag('vfxoff') ? '&vfxoff=1' : ''}${opt('class', '') ? `&class=${opt('class', '')}` : ''}`; // --vfxdemo: the hotbar keeps casting (skill VFX on screen); --class <id>
  console.log('opening', url);
  await page.goto(url);
  await page.waitForFunction('window.__vgtdPerf && window.__vgtdPerf.fps > 0 && window.__vgtdPerf.nodes > 100', {
    timeout: 180000,
    polling: 250,
  });
  tPlayable = Date.now();
  console.log(`running: warm-up ${warmup}s, sampling ${seconds}s (SwiftShader software WebGL)`);
  await sleep(warmup * 1000);
  const heapAfterGc = async () => {
    await page.evaluate('window.gc && window.gc()');
    return (await page.metrics()).JSHeapUsedSize / MB;
  };
  const retainedStart = route ? await heapAfterGc() : 0;
  await page.evaluate('window.__vgtdPerfReset && window.__vgtdPerfReset()'); // peaks / counters count from here
  const t0 = Date.now();
  while (Date.now() - t0 < seconds * 1000) {
    const s = await page.evaluate('JSON.parse(JSON.stringify(window.__vgtdPerf))');
    const m = await page.metrics(); // CDP Performance.getMetrics (JSHeapUsedSize in bytes)
    samples.push({ ...s, cdpHeapMB: m.JSHeapUsedSize / MB });
    await sleep(500);
  }
  if (route) retained = { startMB: retainedStart, endMB: await heapAfterGc() };
  if (flag('drawdbg')) {
    const rep = await page.evaluate('window.__vgtdDrawDbg && window.__vgtdDrawDbg()');
    console.log('drawdbg', JSON.stringify(rep));
    for (const r of (rep && rep.runs) || []) console.log(`  ${r.count}x ${r.key}  ${r.first} .. ${r.last}`);
  }
  meta = await page.evaluate(() => ({ ua: navigator.userAgent, dpr: devicePixelRatio }));
  await sleep(200);
} finally {
  await browser.close();
  server.close();
}

if (samples.length === 0) throw new Error('no perf samples collected');
let rawBytes = 0;
let gzipBytes = 0;
const fetched = [];
let initRaw = 0;
let initGzip = 0;
served.forEach((f) => {
  const buf = readFileSync(f);
  rawBytes += buf.length;
  gzipBytes += gzipSync(buf, { level: 6 }).length;
  if (servedAt.get(f) <= tPlayable) {
    initRaw += buf.length;
    initGzip += gzipSync(buf, { level: 6 }).length;
  }
  fetched.push({ file: relative(webDir, f).replaceAll(sep, '/'), bytes: buf.length });
});
fetched.sort((a, b) => b.bytes - a.bytes);
const col = (k) => samples.map((s) => s[k]).filter((v) => typeof v === 'number');
const heap = col('jsHeapMB').length ? col('jsHeapMB') : col('cdpHeapMB');
const ram = samples.map((s) => (s.jsHeapMB ?? s.cdpHeapMB) + s.textureMB);
function streaming() {
  const last = samples[samples.length - 1];
  const q = Math.max(1, Math.floor(samples.length / 4));
  const avg = (a) => a.reduce((x, y) => x + y, 0) / a.length;
  return {
    chunksBuilt: last.chunksBuilt,
    chunksUnloaded: last.chunksUnloaded,
    chunkBuildMsAvg: last.chunkBuildMsAvg,
    chunkBuildMsMax: last.chunkBuildMsMax,
    chunkStepMsMax: last.chunkStepMsMax,
    notReadyUpdates: last.notReadyUpdates,
    frameMsMax: last.frameMsMax,
    hitches50: last.hitches50,
    hitches100: last.hitches100,
    chunksRenderedMin: Math.min(...col('chunks')),
    chunksRenderedMax: Math.max(...col('chunks')),
    chunksDataMax: Math.max(...col('chunksLoaded')),
    nodesMin: Math.min(...col('nodes')),
    nodesMax: Math.max(...col('nodes')),
    // heap trend: average of the first vs the last quarter of the walk (a leak shows as steady growth after eviction)
    heapRetainedAfterGcMB: retained,
    heapMBFirstQuarter: avg(heap.slice(0, q)),
    heapMBLastQuarter: avg(heap.slice(-q)),
  };
}
const result = {
  when: new Date().toISOString(),
  setup: {
    npcs,
    npcart,
    route,
    tier,
    seconds,
    warmup,
    viewport: '1280x720',
    renderer: 'SwiftShader (software WebGL)',
    ...meta,
  },
  measured: {
    fpsMedian: median(col('fps')),
    fpsMin: Math.min(...col('fps')),
    frameMsMedian: median(col('frameMs')),
    updateMsMedian: median(col('updateMs')),
    renderMsMedian: median(col('renderMs')),
    drawCallsMax: Math.max(...col('drawCalls')),
    drawCallsMedian: median(col('drawCalls')),
    jsHeapMBMax: Math.max(...heap),
    textureMBMax: Math.max(...col('textureMB')),
    ramMBMax: Math.max(...ram),
    nodesMax: Math.max(...col('nodes')),
    chunksMax: Math.max(...col('chunks')),
    npcs: Math.max(...col('npcs')),
    loadedMB: Math.max(...col('loadedMB')),
    initialMBRaw: initRaw / MB,
    initialMBGzip: initGzip / MB,
    lazyFetchedMBRaw: (rawBytes - initRaw) / MB, // fetched after the world was playable (lazy / streamed assets)
    lazyFetchedMBGzip: (gzipBytes - initGzip) / MB,
    packageMBRaw: rawBytes / MB,
    packageMBGzip: gzipBytes / MB,
    buildOutputMB: buildRaw / MB,
  },
  streaming: route ? streaming() : undefined,
  fetchedFiles: fetched.length,
  largestFetched: fetched.slice(0, 8).map((b) => ({ ...b, MB: +(b.bytes / MB).toFixed(2) })),
  buildOutputByDirMB: Object.fromEntries(
    Object.entries(byDir)
      .sort((x, y) => y[1] - x[1])
      .slice(0, 8)
      .map(([k, v]) => [k, +(v / MB).toFixed(2)]),
  ),
  samples: samples.length,
};
const m = result.measured;
const b = samples[0].budgets;
if (!b) throw new Error('page did not publish budgets (window.__vgtdPerf.budgets)');
// `--draw-limit N` tightens the draw-call gate (the 14-mob scenario targets 65, see docs/33); it can never loosen the shared budget
const LIMITS = {
  drawCalls: Math.min(b.drawCalls, drawLimit),
  ramMB: b.ramMB,
  packageMB: b.initialDownloadMB,
  minFps: MIN_FPS,
};
const rows = [
  ['Draw calls (max)', m.drawCallsMax, `<= ${LIMITS.drawCalls}`, m.drawCallsMax <= LIMITS.drawCalls, true],
  ['RAM: JS heap + textures MB (max)', m.ramMBMax.toFixed(1), `<= ${LIMITS.ramMB}`, m.ramMBMax <= LIMITS.ramMB, true],
  [
    `FPS median with ${m.npcs} NPC (software GL)`,
    m.fpsMedian.toFixed(1),
    `>= ${LIMITS.minFps}`,
    m.fpsMedian >= LIMITS.minFps,
    flag('gate-fps'),
  ],
  [
    'Initial package MB until playable (raw / gzip)',
    `${m.initialMBRaw.toFixed(2)} / ${m.initialMBGzip.toFixed(2)}`,
    `<= ${LIMITS.packageMB}`,
    m.initialMBRaw <= LIMITS.packageMB,
    true,
  ],
];
console.log('\nP1 exit criteria (docs/10 section 12), Web headless');
for (const [name, value, limit, ok, gates] of rows) {
  console.log(
    `  ${ok ? 'PASS' : gates ? 'FAIL' : 'WARN'}  ${name.padEnd(40)} ${String(value).padStart(14)}   ${limit}`,
  );
}
console.log(
  `  info  fetched after playable (lazy, not in the gate): ${m.lazyFetchedMBRaw.toFixed(2)} MB raw / ${m.lazyFetchedMBGzip.toFixed(2)} MB gzip; whole run ${m.packageMBRaw.toFixed(2)} / ${m.packageMBGzip.toFixed(2)}
` +
    `  info  frame ${m.frameMsMedian.toFixed(1)} ms (update ${m.updateMsMedian.toFixed(2)} + render submit ${m.renderMsMedian.toFixed(2)}), ` +
    `heap ${m.jsHeapMBMax.toFixed(1)} MB, tex ${m.textureMBMax.toFixed(1)} MB, nodes ${m.nodesMax}, chunks ${m.chunksMax}, loaded ${m.loadedMB.toFixed(2)} MB, fetched ${fetched.length} files, whole build dir ${m.buildOutputMB.toFixed(0)} MB (lazy resources incl.)`,
);
if (result.streaming) {
  const t = result.streaming;
  console.log(
    `  stream tree builds ${t.chunksBuilt}, tree drops ${t.chunksUnloaded}, rendered ${t.chunksRenderedMin}..${t.chunksRenderedMax}, data held max ${t.chunksDataMax}; ` +
      `chunk build (whole tree, spread over frames) avg ${t.chunkBuildMsAvg.toFixed(1)} / max ${t.chunkBuildMsMax.toFixed(1)} ms, worst per-frame slice ${t.chunkStepMsMax.toFixed(1)} ms; view without ground ${t.notReadyUpdates} syncs`,
  );
  console.log(
    `  stream worst frame ${t.frameMsMax.toFixed(0)} ms, frames >50 ms: ${t.hitches50}, >100 ms: ${t.hitches100}; ` +
      `nodes ${t.nodesMin}..${t.nodesMax}; heap first/last quarter ${t.heapMBFirstQuarter.toFixed(1)} / ${t.heapMBLastQuarter.toFixed(1)} MB, retained after GC ${t.heapRetainedAfterGcMB.startMB.toFixed(1)} -> ${t.heapRetainedAfterGcMB.endMB.toFixed(1)} MB`,
  );
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'p1-perf.json'), JSON.stringify(result, null, 2), 'utf8');
console.log(`wrote ${join(out, 'p1-perf.json')}`);
if (failures > 0) console.error(`${failures} page error(s)`);
const gateFail = rows.some(([, , , ok, gates]) => gates && !ok);
process.exit(failures > 0 || gateFail ? 1 : 0);
