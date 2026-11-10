// Memory impact of the 2D batcher's vertex buffer size (engine macro BATCHER2D_MEM_INCREMENT, docs/33 and docs/39).
//
//   npm run mem:p1 -w client-cocos -- [--macro 144,2048] [--scenarios default,casting] [--runs 3] [--seconds 20] [--warmup 8]
//                                     [--device "Moto G4"] [--cpu-throttle 4] [--tier low] [--out <dir>] [--reuse] [--no-ua-mem]
//
// For every macro value (KB; 144 = the engine default, i.e. no `macroConfig` key) it
//   1. builds web-mobile --release in its OWN stage directory (a shared stage can keep the previous macro in its Library: docs/33),
//      with the value written into the project's engine.json for the duration of the build (restored afterwards, also on Ctrl+C),
//      and copies the result to <out>/web-<value> (with --reuse an existing copy is measured as is, no build);
//   2. measures every scenario `--runs` times in headless Chrome / Edge with mobile device emulation (default Moto G4: 360x640 @3x,
//      touch, mobile UA) and a CPU throttle, `tier=low` (the phone tier: @1x atlases, small chunk window):
//        default = the base scene (20 NPC), casting = 14 mobs + 20 NPC + combat HUD with the hotbar casting non-stop (`?vfxdemo=1`).
//      Sampled once a second over `--seconds` after `--warmup`:
//        heapMB       JS heap used (CDP Performance.getMetrics, JSHeapUsedSize)
//        drawCalls    engine counter (window.__vgtdPerf)
//        texMB        engine texture estimate (window.__vgtdPerf)
//      and every 2 s, from the OS, the memory of the browser's processes (CDP SystemInfo.getProcessInfo -> pid -> working set /
//      private bytes on Windows, VmRSS on Linux):
//        rendererMB   the page's renderer process (JS heap + ArrayBuffers such as the batcher's vertex / index buffers + DOM)
//        gpuMB        the GPU process (under SwiftShader, the software "GPU": vertex buffers, textures and render targets live here)
//      plus once at the end `performance.measureUserAgentSpecificMemory()` (bytes the page holds incl. ArrayBuffers; needs the
//      cross-origin isolation headers this script sets; skipped with --no-ua-mem or when the browser refuses).
// 3. writes <out>/mem-p1.json and prints a markdown table (median over the runs of each run's median; the spread is min..max).
//
// Headless SwiftShader is NOT a phone GPU: the process numbers are a PROXY for how much memory the buffers cost, good for A/B between
// macro values on the same machine, not for absolute phone numbers (docs/39 and docs/33 keep the real-device check open).
import { spawnSync } from 'node:child_process';
import { createServer } from 'node:http';
import {
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import puppeteer, { KnownDevices } from 'puppeteer-core';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : def;
};
const flag = (name) => args.includes(`--${name}`);

const macros = opt('macro', '144,2048')
  .split(',')
  .map((s) => Number(s.trim()));
const scenarioNames = opt('scenarios', 'default,casting').split(',');
const runs = Number(opt('runs', 3));
const seconds = Number(opt('seconds', 20));
const warmup = Number(opt('warmup', 8));
const deviceName = opt('device', 'Moto G4');
const cpuThrottle = Number(opt('cpu-throttle', 4));
const tier = opt('tier', 'low');
const out = resolve(opt('out', join(tmpdir(), 'vgtd-mem')));
const reuse = flag('reuse');
const uaMem = !flag('no-ua-mem');
if (macros.some((m) => !Number.isFinite(m) || m <= 0))
  throw new Error('--macro takes positive KB values, e.g. 144,2048');
// the vertex index buffer is Uint16: 65535 vertices * 36 B = 2303 KB is the ceiling (docs/33)
if (macros.some((m) => m > 2303))
  console.warn('warning: a macro above 2303 KB overflows the Uint16 index buffer (docs/33)');

const SCENARIOS = {
  default: `npcs=20&tier=${tier}&npcart=chibi&input=touch`,
  casting: `npcs=20&tier=${tier}&npcart=chibi&input=touch&combat=1&mobdemo=1&vfxdemo=1&class=dan-phu-tu`,
};
for (const s of scenarioNames) if (!SCENARIOS[s]) throw new Error(`unknown scenario ${s} (default, casting)`);

const MB = 1048576;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const median = (a) => {
  const v = a.filter((x) => Number.isFinite(x)).sort((x, y) => x - y);
  return v.length ? v[Math.floor(v.length / 2)] : NaN;
};
const fmt = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');

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

// ---- build one macro value into its own stage and keep the web output -------------------------------------------------------
const enginePath = join(root, 'settings/v2/packages/engine.json');
function withMacro(value, fn) {
  const original = readFileSync(enginePath, 'utf8');
  const restore = () => writeFileSync(enginePath, original);
  process.once('SIGINT', () => {
    restore();
    process.exit(130);
  });
  const cfg = JSON.parse(original);
  if (value === 144)
    delete cfg.macroConfig; // the engine default needs no key
  else cfg.macroConfig = { ...(cfg.macroConfig ?? {}), BATCHER2D_MEM_INCREMENT: value };
  writeFileSync(enginePath, JSON.stringify(cfg, null, 2) + '\n');
  try {
    return fn();
  } finally {
    restore();
  }
}

function webDirFor(value) {
  return join(out, `web-${value}`);
}

function buildVariant(value) {
  const dest = webDirFor(value);
  if (reuse && existsSync(join(dest, 'index.html'))) {
    console.log(`macro ${value}: reusing ${dest}`);
    return;
  }
  console.log(`macro ${value}: building (own stage, release)...`);
  withMacro(value, () => {
    const r = spawnSync(process.execPath, [join(root, 'scripts/build-web.mjs'), '--release'], {
      stdio: 'inherit',
      env: { ...process.env, VGTD_STAGE_DIR: join(out, `stage-${value}`) },
    });
    if (r.status !== 0) throw new Error(`build for macro ${value} failed`);
  });
  const built = join(root, 'build/web-mobile');
  const settings = JSON.parse(readFileSync(join(built, 'src/settings.json'), 'utf8'));
  const got = settings.engine?.macros?.BATCHER2D_MEM_INCREMENT;
  if ((value === 144 && got !== undefined) || (value !== 144 && got !== value))
    throw new Error(`built settings.json carries macro ${got} but ${value} was asked for (stale stage?)`);
  rmSync(dest, { recursive: true, force: true });
  cpSync(built, dest, { recursive: true });
}

// ---- OS process memory ------------------------------------------------------------------------------------------------------
function processMemoryMB(pids) {
  const res = {};
  if (pids.length === 0) return res;
  if (process.platform === 'win32') {
    const ids = pids.join(',');
    const r = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        `Get-Process -Id ${ids} -ErrorAction SilentlyContinue | ForEach-Object { "$($_.Id) $($_.WorkingSet64) $($_.PrivateMemorySize64)" }`,
      ],
      { encoding: 'utf8' },
    );
    for (const line of (r.stdout || '').split(/\r?\n/)) {
      const [id, ws, priv] = line.trim().split(/\s+/).map(Number);
      if (id) res[id] = { workingSet: ws / MB, priv: priv / MB };
    }
  } else {
    for (const pid of pids) {
      try {
        const st = readFileSync(`/proc/${pid}/status`, 'utf8');
        const rss = /VmRSS:\s+(\d+) kB/.exec(st);
        const anon = /RssAnon:\s+(\d+) kB/.exec(st);
        if (rss)
          res[pid] = { workingSet: Number(rss[1]) / 1024, priv: anon ? Number(anon[1]) / 1024 : Number(rss[1]) / 1024 };
      } catch {
        /* process gone */
      }
    }
  }
  return res;
}

// ---- one measured run -------------------------------------------------------------------------------------------------------
const types = {
  '.html': 'text/html',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.png': 'image/png',
  '.css': 'text/css',
  '.wasm': 'application/wasm',
  '.webp': 'image/webp',
};

async function measureRun(webDir, scenario) {
  scenario += '&drawdbg=1'; // publishes window.__vgtdDrawDbg(): the number of live renderables (= quads in the batcher's buffers)
  const server = createServer((req, res) => {
    const p = normalize(decodeURIComponent(new URL(req.url, 'http://x').pathname)).replace(/^[/\\]+/, '');
    let f = join(webDir, p || 'index.html');
    if (!f.startsWith(webDir) || !existsSync(f)) return void res.writeHead(404).end();
    if (statSync(f).isDirectory()) f = join(f, 'index.html');
    res.writeHead(200, {
      'content-type': types[extname(f)] || 'application/octet-stream',
      'cache-control': 'no-store',
      // cross-origin isolation: required by performance.measureUserAgentSpecificMemory()
      'cross-origin-opener-policy': 'same-origin',
      'cross-origin-embedder-policy': 'require-corp',
    });
    createReadStream(f).pipe(res);
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const browser = await puppeteer.launch({
    executablePath: findBrowser(),
    headless: 'new',
    protocolTimeout: 600000,
    args: [
      '--no-sandbox',
      '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader',
      '--ignore-gpu-blocklist',
      '--enable-webgl',
      '--enable-precise-memory-info',
    ],
  });
  const samples = { heapMB: [], drawCalls: [], texMB: [], rendererMB: [], gpuMB: [], rendererPriv: [], gpuPriv: [] };
  let ua = null;
  let renderables = NaN;
  try {
    const page = await browser.newPage();
    const device = KnownDevices[deviceName];
    if (!device) throw new Error(`unknown device ${deviceName}`);
    await page.emulate(device);
    const cdp = await page.createCDPSession();
    await cdp.send('Emulation.setCPUThrottlingRate', { rate: cpuThrottle });
    await cdp.send('Performance.enable');
    const browserCdp = await browser.target().createCDPSession();
    page.on('pageerror', (e) => console.error('[page error]', e.message));
    await page.goto(`http://127.0.0.1:${port}/?${scenario}`);
    await page.waitForFunction('window.__vgtdPerf && window.__vgtdPerf.fps > 0 && window.__vgtdPerf.nodes > 100', {
      timeout: 300000,
      polling: 250,
    });
    await sleep(warmup * 1000);
    const t0 = Date.now();
    let lastProc = 0;
    while (Date.now() - t0 < seconds * 1000) {
      const perf = await page.evaluate('JSON.parse(JSON.stringify(window.__vgtdPerf))');
      const m = (await cdp.send('Performance.getMetrics')).metrics;
      const heap = m.find((x) => x.name === 'JSHeapUsedSize')?.value ?? NaN;
      samples.heapMB.push(heap / MB);
      samples.drawCalls.push(perf.drawCalls);
      samples.texMB.push(perf.textureMB);
      if (Date.now() - lastProc >= 2000) {
        lastProc = Date.now();
        const info = (await browserCdp.send('SystemInfo.getProcessInfo')).processInfo;
        const pids = info.filter((p) => p.type === 'renderer' || p.type === 'GPU').map((p) => p.id);
        const mem = processMemoryMB(pids);
        for (const p of info) {
          const x = mem[p.id];
          if (!x) continue;
          if (p.type === 'renderer') {
            // several renderers can exist (the about:blank tab): the biggest one is the page
            samples.rendererMB.push(x.workingSet);
            samples.rendererPriv.push(x.priv);
          } else if (p.type === 'GPU') {
            samples.gpuMB.push(x.workingSet);
            samples.gpuPriv.push(x.priv);
          }
        }
      }
      await sleep(1000);
    }
    // live 2D renderables = quads with a chunk in the batcher's vertex buffers (4 vertices each; a Label counts once per run entry,
    // so this is a lower bound for text-heavy scenes)
    try {
      const dbg = await page.evaluate('window.__vgtdDrawDbg ? window.__vgtdDrawDbg().runs : null');
      if (dbg) renderables = dbg.reduce((n, r) => n + Number(/^(\d+)x /.exec(r)?.[1] ?? 1), 0);
    } catch {
      /* debug hook missing */
    }
    if (uaMem) {
      try {
        ua = await Promise.race([
          page.evaluate(
            'window.crossOriginIsolated && performance.measureUserAgentSpecificMemory ? performance.measureUserAgentSpecificMemory().then((r) => r.bytes / 1048576) : null',
          ),
          sleep(60000).then(() => null),
        ]);
      } catch {
        ua = null;
      }
    }
  } finally {
    await browser.close();
    server.close();
  }
  return { ...samples, uaMB: ua, renderables };
}

// ---- main -------------------------------------------------------------------------------------------------------------------
mkdirSync(out, { recursive: true });
for (const m of macros) buildVariant(m);

const result = { device: deviceName, cpuThrottle, tier, seconds, warmup, runs, macros, scenarios: {} };
for (const sc of scenarioNames) {
  result.scenarios[sc] = {};
  for (const m of macros) {
    const perRun = [];
    for (let r = 0; r < runs; r++) {
      console.log(`scenario ${sc}, macro ${m} KB, run ${r + 1}/${runs}...`);
      const s = await measureRun(webDirFor(m), SCENARIOS[sc]);
      perRun.push({
        heapMB: median(s.heapMB),
        heapMaxMB: Math.max(...s.heapMB),
        drawCallsMax: Math.max(...s.drawCalls),
        texMB: median(s.texMB),
        // peak of the run: the page's renderer is the biggest renderer process; the GPU process is a single one
        rendererMB: Math.max(...s.rendererMB),
        rendererPrivMB: Math.max(...s.rendererPriv),
        gpuMB: Math.max(...s.gpuMB, 0),
        gpuPrivMB: Math.max(...s.gpuPriv, 0),
        uaMB: s.uaMB,
        renderables: s.renderables,
      });
    }
    const col = (k) => perRun.map((x) => x[k]);
    const agg = {};
    for (const k of Object.keys(perRun[0]))
      agg[k] = {
        median: median(col(k)),
        min: Math.min(...col(k).filter(Number.isFinite)),
        max: Math.max(...col(k).filter(Number.isFinite)),
      };
    result.scenarios[sc][m] = { perRun, agg };
  }
}
writeFileSync(join(out, 'mem-p1.json'), JSON.stringify(result, null, 2));

// markdown table
const rows = [
  ['heapMB', 'JS heap used (MB)'],
  ['rendererMB', 'renderer process working set (MB)'],
  ['rendererPrivMB', 'renderer private bytes (MB)'],
  ['gpuMB', 'GPU process working set (MB)'],
  ['gpuPrivMB', 'GPU private bytes (MB)'],
  ['uaMB', 'measureUserAgentSpecificMemory (MB)'],
  ['renderables', 'live renderables (quads in the vertex buffers)'],
  ['drawCallsMax', 'draw calls (max)'],
];
const lines = [
  `device ${deviceName} (CPU x${cpuThrottle}), tier ${tier}, ${runs} runs x ${seconds} s, median [min..max]`,
  '',
];
for (const sc of scenarioNames) {
  lines.push(
    `### ${sc}`,
    '',
    `| metric | ${macros.map((m) => `${m} KB`).join(' | ')} | delta (${macros.at(-1)} - ${macros[0]}) |`,
    `| --- | ${macros.map(() => '---:').join(' | ')} | ---: |`,
  );
  for (const [k, label] of rows) {
    const cells = macros.map((m) => {
      const a = result.scenarios[sc][m].agg[k];
      return `${fmt(a.median)} [${fmt(a.min)}..${fmt(a.max)}]`;
    });
    const d = result.scenarios[sc][macros.at(-1)].agg[k].median - result.scenarios[sc][macros[0]].agg[k].median;
    lines.push(`| ${label} | ${cells.join(' | ')} | ${Number.isFinite(d) ? (d >= 0 ? '+' : '') + fmt(d) : 'n/a'} |`);
  }
  lines.push('');
}
const md = lines.join('\n');
writeFileSync(join(out, 'mem-p1.md'), md);
console.log('\n' + md);
console.log(`wrote ${join(out, 'mem-p1.json')} and mem-p1.md`);
