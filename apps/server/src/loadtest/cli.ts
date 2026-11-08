/**
 * `npm run loadtest -w server -- --bots 100` (bundled by scripts/loadtest.mjs).
 * Starts a World Node + Gateway in this thread, runs the bots in a worker thread, measures a window and prints the
 * P2 exit-criteria report. Options: --bots N --duration S --warmup S --area TILES --input-hz HZ
 * --speedhackers N --speed-factor X --teleporters N --seed N --json
 */
import { Worker } from 'node:worker_threads';
import { compileSkills } from '@vgtd/sim';
import { startServer, type RunningServer } from '../server.js';
import type { BotReport } from './bot.js';
import { formatReport, summarize, type ServerClientStats, type ServerSample } from './runner.js';

function arg(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${name} needs a non-negative number`);
  return v;
}

const bots = arg('bots', 100);
const speedhackers = arg('speedhackers', 0);
const teleporters = arg('teleporters', 0);
const duration = arg('duration', 30);
const warmup = arg('warmup', 3);
const area = arg('area', 96);
const inputHz = arg('input-hz', 20);
const seed = arg('seed', 1);
const speedFactor = arg('speed-factor', 3);
const asJson = process.argv.includes('--json');
const log = (s: string): void => {
  if (!asJson) console.log(s);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Copy the cumulative per-client counters so the window can be computed as a difference. */
function copyStats(srv: RunningServer): Map<number, ServerClientStats> {
  const m = new Map<number, ServerClientStats>();
  for (const c of srv.world.clients.values()) m.set(c.id, { entityId: c.id, ...c.stats });
  return m;
}

function windowSample(
  srv: RunningServer,
  base: Map<number, ServerClientStats>,
  durationS: number,
  cpu: NodeJS.CpuUsage,
): ServerSample {
  const clients: ServerClientStats[] = [];
  for (const c of srv.world.clients.values()) {
    const b = base.get(c.id);
    const s = c.stats;
    clients.push({
      entityId: c.id,
      bytesOut: s.bytesOut - (b?.bytesOut ?? 0),
      wireBytesOut: s.wireBytesOut - (b?.wireBytesOut ?? 0),
      framesOut: s.framesOut - (b?.framesOut ?? 0),
      bytesIn: s.bytesIn - (b?.bytesIn ?? 0),
      packetsIn: s.packetsIn - (b?.packetsIn ?? 0),
      snapshots: s.snapshots - (b?.snapshots ?? 0),
      snapshotsSkipped: s.snapshotsSkipped - (b?.snapshotsSkipped ?? 0),
      aoiEnter: s.aoiEnter - (b?.aoiEnter ?? 0),
      aoiLeave: s.aoiLeave - (b?.aoiLeave ?? 0),
      visibleSum: s.visibleSum - (b?.visibleSum ?? 0),
      visibleSamples: s.visibleSamples - (b?.visibleSamples ?? 0),
      visibleMax: s.visibleMax,
    });
  }
  return {
    tickMs: [...srv.world.tickMs],
    tickIntervalMs: [...srv.world.tickIntervalMs],
    clients,
    durationS,
    phases: { ...srv.world.phases },
    metrics: { ...srv.world.metrics, violations: { ...srv.world.metrics.violations } },
    cpuUserMs: cpu.user / 1000,
    cpuSystemMs: cpu.system / 1000,
    rssMb: process.memoryUsage().rss / 1048576,
  };
}

const MAP = 256;
const skills = compileSkills();
const spawn = { i0: MAP / 2 - area / 2, j0: MAP / 2 - area / 2, side: area };
const srv = await startServer({
  port: 0,
  // the per-IP registration / login limits would block a many-bot run from one host
  auth: { registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
  world: { seed, mapTiles: MAP, spawn, skills },
});
log(`server on :${srv.port}; connecting ${bots + speedhackers + teleporters} bots...`);

const worker = new Worker(new URL('./bot-worker.mjs', import.meta.url), {
  workerData: {
    host: '127.0.0.1',
    port: srv.port,
    bots,
    speedhackers,
    teleporters,
    inputHz,
    area: spawn,
    skillCount: skills.length,
    speedFactor,
    prefix: `lt${Date.now().toString(36)}`,
    seed,
  },
});

const next = <T>(type: string): Promise<T> =>
  new Promise((resolve, reject) => {
    const onMsg = (m: { type: string; message?: string }): void => {
      if (m.type === 'failed') {
        worker.off('message', onMsg);
        reject(new Error(`bot fleet failed: ${m.message}`));
      } else if (m.type === type) {
        worker.off('message', onMsg);
        resolve(m as T);
      }
    };
    worker.on('message', onMsg);
    worker.once('error', reject);
  });

let exitCode = 0;
try {
  await next('connected');
  log(`all bots connected; warming up ${warmup}s, measuring ${duration}s...`);
  await sleep(warmup * 1000);

  // measurement window: reset tick samples, snapshot per-client counters, start the CPU clock
  srv.world.tickMs.length = 0;
  srv.world.tickIntervalMs.length = 0;
  Object.assign(srv.world.phases, {
    stepMs: 0,
    aoiMs: 0,
    snapMs: 0,
    aoiTicks: 0,
    maxStepMs: 0,
    maxAoiMs: 0,
    maxSnapMs: 0,
  });
  const base = copyStats(srv);
  const violations0 = { ...srv.world.metrics.violations };
  const cpu0 = process.cpuUsage();
  const t0 = performance.now();
  worker.postMessage({ type: 'measure' });
  await sleep(duration * 1000);
  const sample = windowSample(srv, base, (performance.now() - t0) / 1000, process.cpuUsage(cpu0));
  void violations0;
  worker.postMessage({ type: 'stop' });
  const { reports } = await next<{ reports: BotReport[] }>('reports');

  const report = summarize(
    { bots, speedhackers, teleporters, durationS: Math.round(sample.durationS), areaTiles: area, inputHz },
    sample,
    reports,
  );
  console.log(asJson ? JSON.stringify(report, null, 2) : formatReport(report));
  if (report.criteria.some((c) => !c.pass)) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 2;
} finally {
  await worker.terminate();
  await srv.stop();
}
process.exit(exitCode);
