/**
 * P5 soak / load test (docs/10 §12, docs/28 §6, docs/35). Bundled and run by `scripts/soak.mjs`:
 *
 *   npm run soak -w @vgtd/server -- --bots 200 --minutes 30            short soak
 *   npm run soak -w @vgtd/server -- --bots 200 --hours 24 --out soak-24h   long soak (run by hand, never in CI)
 *   npm run soak -w @vgtd/server -- --ci                               CI smoke: 20 bots, 60 s, gross-overrun gate only
 *
 * The REAL stack: the gateway + world node (combat, mobs, inventory, progression, chat, party) and, with `--store file` (default), the
 * file stores of D92 (accounts, characters, bags, ledger) in a temp or `--data-dir` directory. The bots are `GameBot`s (the real client
 * netcode, `NetClient`), in worker threads; they pick classes, walk, hunt, claim loot, drink pills, meditate, chat, party up. The server
 * runs in this thread; a sampler records one `SoakSample` per `--sample-s` and the report judges the run against the design budgets.
 *
 * Options: --bots N (200) · --seconds S / --minutes M / --hours H (the measured time) · --warmup-s S (ramp-up not measured, default
 * 15 + bots / connect-per-s) · --sample-s S · --workers N · --connect-per-s N (8) · --mobs N (150) · --area TILES (96) · --map TILES (256)
 * · --store file|memory · --data-dir DIR · --seed N · --out DIR (samples.csv, samples.jsonl, summary.json, report.txt)
 * · --social-pace F (1 = realistic chat / party / bag cadence; --ci uses 0.12 so a minute still exercises them) · --sync-writes (file store writes on the loop like before D106, for A/B) · --gc / --no-gc (heap sampled after a GC: default on when node runs with --expose-gc, which the script does)
 * · --ci (20 bots, 60 s, memory-light gate) · --max-tick-p99 MS (gate for --ci, default 100) · --json
 *
 * Soak presets (never in CI; docs/35 §6 is the runbook):
 *   --preset smoke   100 bots, 25 min, a sample every 15 s, a backup every 5 min: a local check before a long run
 *   --preset full    200 bots, 24 h, a sample every 60 s, a backup every 30 min: for a dedicated machine
 * Both write `--out` (default a new temp directory) and judge the run against the thresholds below; every preset value can be overridden.
 * Per sample the CSV / JSONL also carry the event-loop lag of the window, the file-store sizes (documents + `journal.json`) and the backup
 * that finished since the previous sample (a separate process, like the `backup` operator command: `soak-backup.ts`).
 * · --backup-every-min M (0 = no backups; the last one at the end of the run is also verified) · --keep-backups N (3)
 * · thresholds (PROVISIONAL harness settings): --max-heap-slope-mb-h (20) · --max-rss-slope-mb-h (40) · --max-tick-p99-budget MS (40, the
 *   design budget) · --max-backup-s (15) · --journal-stuck-samples N (3: a journal on disk or pending in N consecutive samples = not compacting)
 * Exit code: 0 all criteria pass (--ci: gate passes), 1 a criterion / the gate failed, 2 the harness itself failed.
 */
import { execFile } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { monitorEventLoopDelay, PerformanceObserver } from 'node:perf_hooks';
import { Worker } from 'node:worker_threads';
import { ZONE_SPAWN_TABLES } from '@vgtd/shared';
import { compileSkills } from '@vgtd/sim';
import { startServer } from '../server.js';
import { openFileStores, fileWriteStats } from '../persistence/index.js';
import { TICK_PHASES } from '../world/node.js';
import { InventoryService } from '../world/inventory/index.js';
import type { GameBotStats } from './game-bot.js';
import type { GameWorkerConfig } from './game-worker.js';
import {
  DEFAULT_THRESHOLDS,
  TickHistogram,
  formatSoak,
  gateFailures,
  samplesCsv,
  summarizeSoak,
  type BackupSample,
  type BotTotals,
  type SoakConfig,
  type SoakSample,
  type SoakThresholds,
  type StoreSample,
} from './soak-report.js';
import { dist } from './stats.js';
import { copyStats, resetWindow, windowSample } from './window.js';

const argv = process.argv.slice(2);
const flag = (n: string): boolean => argv.includes(`--${n}`);
const str = (n: string, d: string): string => {
  const i = argv.indexOf(`--${n}`);
  return i >= 0 && argv[i + 1] !== undefined ? argv[i + 1]! : d;
};
const num = (n: string, d: number): number => {
  const i = argv.indexOf(`--${n}`);
  if (i < 0) return d;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${n} needs a non-negative number`);
  return v;
};

const ci = flag('ci');
const preset = str('preset', '');
if (preset !== '' && preset !== 'smoke' && preset !== 'full') throw new Error('--preset must be smoke or full');
/** the soak presets (see the header): defaults for bots, duration, sampling and backups; every one is overridable */
const PRESETS = {
  smoke: { bots: 100, durationS: 25 * 60, sampleS: 15, backupMin: 5 },
  full: { bots: 200, durationS: 24 * 3600, sampleS: 60, backupMin: 30 },
} as const;
const pre = preset === '' ? null : PRESETS[preset];
const bots = num('bots', pre?.bots ?? (ci ? 20 : 200));
const durationS =
  Math.round(num('seconds', 0) + num('minutes', 0) * 60 + num('hours', 0) * 3600) ||
  (pre?.durationS ?? (ci ? 60 : 600));
const connectPerS = num('connect-per-s', 8);
const warmupS = num('warmup-s', Math.ceil(15 + bots / connectPerS));
const sampleS = num('sample-s', pre?.sampleS ?? (durationS >= 3 * 3600 ? 60 : durationS >= 600 ? 15 : 5));
const backupEveryMin = num('backup-every-min', pre?.backupMin ?? 0);
const keepBackups = Math.max(1, Math.round(num('keep-backups', 3)));
const thresholds: SoakThresholds = {
  heapSlopeMbPerH: num('max-heap-slope-mb-h', DEFAULT_THRESHOLDS.heapSlopeMbPerH),
  rssSlopeMbPerH: num('max-rss-slope-mb-h', DEFAULT_THRESHOLDS.rssSlopeMbPerH),
  tickP99Ms: num('max-tick-p99-budget', DEFAULT_THRESHOLDS.tickP99Ms),
  backupS: num('max-backup-s', DEFAULT_THRESHOLDS.backupS),
  journalStuckSamples: Math.max(1, Math.round(num('journal-stuck-samples', DEFAULT_THRESHOLDS.journalStuckSamples))),
};
const workersN = Math.max(1, Math.min(bots, num('workers', Math.ceil(bots / 50))));
const mobCount = num('mobs', ci ? 40 : 150);
const area = num('area', 96);
const mapTiles = num('map', 256);
const storeKind = str('store', 'file');
const seed = num('seed', 1);
const maxTickP99 = num('max-tick-p99', 100);
const socialPace = num('social-pace', ci ? 0.12 : 1);
const asJson = flag('json');
const useGc = !flag('no-gc') && typeof (globalThis as { gc?: () => void }).gc === 'function';
const log = (s: string): void => {
  if (!asJson) console.log(s);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

if (storeKind !== 'file' && storeKind !== 'memory') throw new Error('--store must be file or memory');
const outDir =
  flag('out') || durationS >= 3600 || pre
    ? str('out', join(tmpdir(), `vgtd-soak-${preset || 'run'}-${Date.now().toString(36)}`))
    : '';
const dataDir = str('data-dir', '');
const tmpData = storeKind === 'file' && !dataDir ? mkdtempSync(join(tmpdir(), 'vgtd-soak-data-')) : '';
const stores = storeKind === 'file' ? openFileStores(dataDir || tmpData, { background: !flag('sync-writes') }) : null;

/** One zone over the bots' area, table counts scaled so that about `--mobs` monsters live there. */
function mobConfig(): {
  zones: { zone: 'bia_rung'; i0: number; j0: number; i1: number; j1: number }[];
  density: number;
} {
  const per = ZONE_SPAWN_TABLES.find((t) => t.zone === 'bia_rung')!.groups.reduce((n, g) => n + g.count, 0);
  const lo = mapTiles / 2 - area / 2;
  return { zones: [{ zone: 'bia_rung', i0: lo, j0: lo, i1: lo + area, j1: lo + area }], density: mobCount / per };
}

const spawn = { i0: mapTiles / 2 - area / 2, j0: mapTiles / 2 - area / 2, side: area };
const srv = await startServer({
  port: 0,
  auth: { registerPerIpPerDay: 0, ipFailLimit: 1_000_000, ...(stores ? { store: stores.accounts } : {}) },
  world: {
    seed,
    mapTiles,
    spawn,
    skills: compileSkills(),
    mobs: mobCount > 0 ? mobConfig() : undefined,
    combat: {},
    inventory: new InventoryService(stores ? { store: stores.inventories, ledger: stores.ledger } : {}),
  },
  progression: stores ? { store: stores.progression } : {},
});
const flusher = stores ? setInterval(() => srv.world.inventory?.flushAll(), 5000) : null;
flusher?.unref();

const runId = Date.now().toString(36);
const roster = Array.from({ length: bots }, (_, n) => `soak${runId}_${n}`);
const config: SoakConfig = {
  bots,
  mode: ci ? 'CI smoke' : preset ? `${preset} soak` : durationS >= 3 * 3600 ? 'long soak' : 'short soak',
  thresholds,
  backupEveryMin,
  ...(preset ? { preset } : {}),
  durationS,
  warmupS,
  sampleS,
  mapTiles,
  areaTiles: area,
  mobs: srv.world.mobs?.alive ?? 0,
  store: storeKind,
  workers: workersN,
  seed,
  node: process.version,
};
log(
  `server on :${srv.port} (${config.mobs} mobs, store ${storeKind}); starting ${bots} bots on ${workersN} workers (${connectPerS}/s), warm-up ${warmupS}s, measuring ${durationS}s, sampling every ${sampleS}s${useGc ? ', heap after GC' : ''}`,
);

// ------------------------------------------------------------------ workers
const workers: Worker[] = [];
const per = Math.ceil(bots / workersN);
for (let w = 0; w < workersN; w++) {
  const from = w * per;
  const to = Math.min(bots, from + per);
  if (from >= to) break;
  const cfg: GameWorkerConfig = {
    baseUrl: `http://127.0.0.1:${srv.port}`,
    from,
    to,
    roster,
    prefix: runId,
    seed,
    area: spawn,
    connectPerS: connectPerS / workersN,
    socialPace,
  };
  workers.push(new Worker(new URL('./game-worker.mjs', import.meta.url), { workerData: cfg }));
}
const failed: string[] = [];
const connected = new Promise<void>((resolve, reject) => {
  let n = 0;
  for (const w of workers) {
    w.on('message', (m: { type: string; message?: string }) => {
      if (m.type === 'failed') {
        failed.push(m.message ?? 'worker failed');
        reject(new Error(`bot worker failed: ${m.message}`));
      } else if (m.type === 'connected' && ++n === workers.length) resolve();
    });
    w.once('error', reject);
  }
});

async function botStats(): Promise<GameBotStats[]> {
  const all = await Promise.all(
    workers.map(
      (w) =>
        new Promise<GameBotStats[]>((resolve) => {
          const onMsg = (m: { type: string; bots?: GameBotStats[] }): void => {
            if (m.type === 'stats') {
              w.off('message', onMsg);
              resolve(m.bots ?? []);
            }
          };
          w.on('message', onMsg);
          w.postMessage({ type: 'stats' });
        }),
    ),
  );
  return all.flat();
}

function totalsOf(list: readonly GameBotStats[]): BotTotals {
  const t: BotTotals = {
    online: 0,
    ended: 0,
    reconnects: 0,
    casts: 0,
    castsAccepted: 0,
    castsRefused: 0,
    kills: 0,
    deaths: 0,
    chatSent: 0,
    chatDelivered: 0,
    partyInvitesSent: 0,
    partyJoins: 0,
    partyLeaves: 0,
    bagClaims: 0,
    pillsUsed: 0,
    meditations: 0,
    walked: 0,
    withErrors: 0,
    rttP95: 0,
  };
  for (const b of list) {
    if (b.status === 'online') t.online++;
    if (b.ended) t.ended++;
    t.reconnects += b.reconnects;
    t.casts += b.casts;
    t.castsAccepted += b.castsAccepted;
    t.castsRefused += b.castsRefused;
    t.kills += b.kills;
    t.deaths += b.deaths;
    t.chatSent += b.chatSent;
    t.chatDelivered += b.chatDelivered;
    t.partyInvitesSent += b.partyInvitesSent;
    t.partyJoins += b.partyJoins;
    t.partyLeaves += b.partyLeaves;
    t.bagClaims += b.bagClaims;
    t.pillsUsed += b.pillsUsed;
    t.meditations += b.meditations;
    t.walked += b.walked;
    if (b.lastError && !/^hook:/.test(b.lastError)) t.withErrors++;
  }
  t.rttP95 = dist(list.map((b) => b.rttMs)).p95;
  return t;
}

// ------------------------------------------------------------------ run
const samples: SoakSample[] = [];
const hist = new TickHistogram();
// the tick profile (D106): per-phase histograms, tick start gaps, GC pauses, event-loop delay, synchronous file writes
const phaseHists = Object.fromEntries(TICK_PHASES.map((k) => [k, new TickHistogram(0.1, 200)])) as Record<
  string,
  TickHistogram
>;
const intervalHist = new TickHistogram(1, 2000);
const slowBy: Record<string, number> = Object.fromEntries(TICK_PHASES.map((k) => [k, 0]));
let slowTicks = 0;
const gcStats: Record<string, { count: number; totalMs: number; maxMs: number }> = {};
let inForcedGc = false; // the sampler's own gc() is not a pause of the game
let observing = false;
const gcObserver = new PerformanceObserver((list) => {
  if (!observing || inForcedGc) return;
  for (const e of list.getEntries()) {
    const kind =
      ({ 1: 'scavenge', 2: 'minor', 4: 'major', 8: 'incremental', 16: 'weakcb' } as Record<number, string>)[
        (e as unknown as { detail?: { kind?: number } }).detail?.kind ?? 0
      ] ?? 'other';
    const g = (gcStats[kind] ??= { count: 0, totalMs: 0, maxMs: 0 });
    g.count++;
    g.totalMs += e.duration;
    g.maxMs = Math.max(g.maxMs, e.duration);
  }
});
gcObserver.observe({ entryTypes: ['gc'] });
const loopDelay = monitorEventLoopDelay({ resolution: 10 });
/** the same, reset every window: one event-loop lag reading per sample */
const windowLoop = monitorEventLoopDelay({ resolution: 10 });

/** File sizes of the store directory (documents + `journal.json`) and the journal state; undefined for the memory store. */
function sampleStore(): StoreSample | undefined {
  if (!stores) return undefined;
  const dir = dataDir || tmpData;
  const docs: Record<string, number> = {};
  let total = 0;
  for (const name of readdirSync(dir)) {
    if (!name.endsWith('.json')) continue;
    try {
      const size = statSync(join(dir, name)).size;
      docs[name] = size;
      total += size;
    } catch {
      // the file was replaced between the listing and the stat (an atomic write): the next sample sees it
    }
  }
  return {
    docs,
    totalBytes: total,
    journalBytes: docs['journal.json'] ?? 0,
    journalPresent: 'journal.json' in docs,
    journalPending: stores.journalPending(),
  };
}

// ------------------------------------------------------------------ backups (a separate process, like the `backup` operator command)
const backupScript = join(dirname(fileURLToPath(import.meta.url)), 'soak-backup.mjs');
const backupRoot = backupEveryMin > 0 && stores ? join(outDir || tmpData, 'backups') : '';
function runBackup(verify: boolean): Promise<BackupSample> {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [backupScript, dataDir || tmpData, backupRoot, String(keepBackups), ...(verify ? ['--verify'] : [])],
      { timeout: 10 * 60 * 1000 },
      (err, stdout) => {
        const line = stdout.trim().split('\n').pop() ?? '';
        try {
          resolve(JSON.parse(line) as BackupSample);
        } catch {
          resolve({
            ok: false,
            ms: 0,
            bytes: 0,
            error: err ? err.message : `unreadable backup output: ${line.slice(0, 200)}`,
          });
        }
      },
    );
  });
}
let backupInFlight: Promise<void> | null = null;
let backupDone: BackupSample | undefined;
const allBackups: BackupSample[] = [];
let fileWrites0 = { ...fileWriteStats };
let exitCode = 0;
let stopRequested = false;
process.on('SIGINT', () => {
  stopRequested = true;
});
try {
  await connected;
  log(`all ${bots} bots connected; ramp-up ${warmupS}s...`);
  await sleep(warmupS * 1000);
  if (outDir) mkdirSync(outDir, { recursive: true });
  resetWindow(srv);
  observing = true;
  loopDelay.enable();
  windowLoop.enable();
  if (backupRoot) mkdirSync(backupRoot, { recursive: true });
  let nextBackupMs = backupEveryMin * 60_000;
  fileWrites0 = { ...fileWriteStats };
  const cpuRun0 = process.cpuUsage();
  let base = copyStats(srv);
  let m0 = { ...srv.world.metrics };
  let cpu0 = process.cpuUsage();
  const tStart = performance.now();
  let tLast = tStart;
  while (!stopRequested && (performance.now() - tStart) / 1000 < durationS) {
    await sleep(Math.min(sampleS * 1000, Math.max(100, durationS * 1000 - (performance.now() - tStart))));
    const now = performance.now();
    const win = (now - tLast) / 1000;
    const s = windowSample(srv, base, win, process.cpuUsage(cpu0));
    hist.add(s.tickMs);
    intervalHist.add(s.tickIntervalMs);
    if (s.profile) {
      for (const k of TICK_PHASES) {
        phaseHists[k]!.add(s.profile.samples[k] ?? []);
        slowBy[k]! += s.profile.slowBy[k] ?? 0;
      }
      slowTicks += s.profile.slowTicks;
    }
    const list = await botStats();
    const tot = totalsOf(list);
    const loop = {
      p50: windowLoop.percentile(50) / 1e6,
      p99: windowLoop.percentile(99) / 1e6,
      max: windowLoop.max / 1e6,
    };
    const store = sampleStore();
    if (useGc) {
      inForcedGc = true;
      (globalThis as { gc?: () => void }).gc!();
      inForcedGc = false;
    }
    windowLoop.reset(); // after the forced GC: its pause is not the game's
    const mem = process.memoryUsage();
    const m1 = srv.world.metrics;
    const honest = s.clients;
    const kicks =
      m1.kicksRate +
      m1.kicksBadMessages +
      m1.kicksBackpressure -
      (m0.kicksRate + m0.kicksBadMessages + m0.kicksBackpressure);
    const viol =
      Object.values(m1.violations).reduce((a, b) => a + b, 0) - Object.values(m0.violations).reduce((a, b) => a + b, 0);
    const sample: SoakSample = {
      tSec: (now - tStart) / 1000,
      online: srv.world.clients.size,
      tick: dist(s.tickMs),
      overruns: s.tickMs.filter((t) => t > 50).length,
      tickIntervalP99: dist(s.tickIntervalMs).p99,
      stepMean: s.phases.stepMs / Math.max(1, s.tickMs.length),
      aoiMean: s.phases.aoiMs / Math.max(1, s.phases.aoiTicks),
      snapMean: s.phases.snapMs / Math.max(1, s.tickMs.length),
      aoiMax: s.phases.maxAoiMs,
      downKBps: dist(honest.map((c) => c.wireBytesOut / win / 1024)),
      upKBps: dist(honest.map((c) => c.bytesIn / win / 1024)),
      visibleMean: honest.length
        ? honest.reduce((a, c) => a + (c.visibleSamples ? c.visibleSum / c.visibleSamples : 0), 0) / honest.length
        : 0,
      visibleMax: Math.max(0, ...honest.map((c) => c.visibleMax)),
      aoiEnterPerSec: honest.length ? honest.reduce((a, c) => a + c.aoiEnter, 0) / honest.length / win : 0,
      heapMb: mem.heapUsed / 1048576,
      rssMb: mem.rss / 1048576,
      loop,
      ...(store ? { store } : {}),
      ...(backupDone ? { backup: backupDone } : {}),
      kicks,
      disconnects: m1.disconnects - m0.disconnects,
      violations: viol,
      castOk: m1.castOk - m0.castOk,
      castRejected: m1.castRejected - m0.castRejected,
      bots: tot,
    };
    backupDone = undefined;
    samples.push(sample);
    // the next backup: in its own process, so the loop being measured is not blocked; a slow one is not started twice
    if (backupRoot && !backupInFlight && now - tStart >= nextBackupMs) {
      nextBackupMs += backupEveryMin * 60_000;
      backupInFlight = runBackup(false)
        .then((r) => {
          backupDone = r;
          allBackups.push(r);
        })
        .finally(() => {
          backupInFlight = null;
        });
    }
    if (outDir) appendFileSync(join(outDir, 'samples.jsonl'), JSON.stringify(sample) + '\n');
    log(
      `[${sample.tSec.toFixed(0).padStart(6)}s] online ${sample.online}/${bots} tick p50 ${sample.tick.p50.toFixed(1)} p99 ${sample.tick.p99.toFixed(1)} max ${sample.tick.max.toFixed(1)} ms · down ${sample.downKBps.mean.toFixed(2)} KB/s/player · visible ${sample.visibleMean.toFixed(0)} · heap ${sample.heapMb.toFixed(0)} MB rss ${sample.rssMb.toFixed(0)} MB · casts ${tot.casts} kills ${tot.kills} chat ${tot.chatDelivered} party ${tot.partyJoins}`,
    );
    // next window starts after the GC pause, so the pause never lands in the tick numbers
    resetWindow(srv);
    base = copyStats(srv);
    m0 = { ...m1, violations: { ...m1.violations } };
    cpu0 = process.cpuUsage();
    tLast = performance.now();
  }
  observing = false;
  loopDelay.disable();
  windowLoop.disable();
  // the last backup of the run is taken after everything is flushed and is also verified (a restore drill in miniature)
  const finalBackups: BackupSample[] = [];
  if (backupRoot && stores) {
    await backupInFlight;
    if (backupDone) finalBackups.push(backupDone);
    srv.world.inventory?.flushAll();
    stores.flush();
    log('final backup (verified)...');
    finalBackups.push(await runBackup(true));
  }
  const cpuRun = process.cpuUsage(cpuRun0);
  const summary = summarizeSoak(
    config,
    samples,
    hist,
    { ...srv.world.metrics.violations },
    {
      phases: phaseHists,
      slowTicks,
      slowBy,
      interval: intervalHist,
      gc: gcStats,
      eventLoop: { p50: loopDelay.percentile(50) / 1e6, p99: loopDelay.percentile(99) / 1e6, max: loopDelay.max / 1e6 },
      fileWrites: {
        count: fileWriteStats.count - fileWrites0.count,
        totalMs: fileWriteStats.totalMs - fileWrites0.totalMs,
        maxMs: fileWriteStats.maxMs, // whole-process max (it is not windowed); the ramp-up does its own writes too
        serializeMs: fileWriteStats.serializeMs - fileWrites0.serializeMs,
        serializeMaxMs: fileWriteStats.serializeMaxMs,
        asyncCount: fileWriteStats.asyncCount - fileWrites0.asyncCount,
        asyncTotalMs: fileWriteStats.asyncTotalMs - fileWrites0.asyncTotalMs,
      },
      cpuCores: (cpuRun.user + cpuRun.system) / 1000 / Math.max(1, durationS * 1000),
    },
    undefined,
    finalBackups,
  );
  const text = formatSoak(summary);
  if (outDir) {
    writeFileSync(join(outDir, 'samples.csv'), samplesCsv(samples));
    writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2));
    writeFileSync(join(outDir, 'report.txt'), text + '\n');
    log(`results written to ${outDir}`);
  }
  console.log(asJson ? JSON.stringify(summary, null, 2) : '\n' + text);
  if (ci) {
    const fails = gateFailures(summary, maxTickP99);
    for (const f of fails) console.error(`CI gate FAIL: ${f}`);
    if (fails.length) exitCode = 1;
    else
      log(
        `CI gate: pass (tick p99 ${summary.tick.p99.toFixed(2)} ms <= ${maxTickP99} ms; design budgets above are informational on a shared runner)`,
      );
  } else if (summary.criteria.some((c) => !c.pass && !c.info)) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 2;
} finally {
  await Promise.all(
    workers.map(
      (w) =>
        new Promise<void>((resolve) => {
          const t = setTimeout(resolve, 3000);
          w.on('message', (m: { type: string }) => {
            if (m.type === 'stopped') {
              clearTimeout(t);
              resolve();
            }
          });
          w.postMessage({ type: 'stop' });
        }),
    ),
  );
  await Promise.all(workers.map((w) => w.terminate()));
  await srv.stop();
  if (stores) {
    srv.world.inventory?.flushAll();
    stores.flush();
  }
  if (tmpData) rmSync(tmpData, { recursive: true, force: true });
}
process.exit(exitCode);
