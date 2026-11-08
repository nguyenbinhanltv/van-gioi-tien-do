/**
 * `npm run loadtest -w server -- --bots 100` (bundled by scripts/loadtest.mjs).
 * Starts a World Node + Gateway in this thread, runs the bots in a worker thread, measures a window and prints the
 * P2 exit-criteria report. Options: --bots N --duration S --warmup S --area TILES --input-hz HZ
 * --speedhackers N --speed-factor X --teleporters N --mobs N --seed N --json
 * (--mobs N keeps about N monsters alive in the bots' spawn area, D74)
 */
import { Worker } from 'node:worker_threads';
import { ZONE_SPAWN_TABLES } from '@vgtd/shared';
import { compileSkills } from '@vgtd/sim';
import { startServer } from '../server.js';
import type { BotReport } from './bot.js';
import { formatReport, summarize } from './runner.js';
import { copyStats, resetWindow, windowSample } from './window.js';

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
const mobCount = arg('mobs', 0);
const speedFactor = arg('speed-factor', 3);
const asJson = process.argv.includes('--json');
const log = (s: string): void => {
  if (!asJson) console.log(s);
};
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

const MAP = 256;
/** One zone over the bots' area, table counts scaled so that about `--mobs` monsters live there. */
function mobConfig(): {
  zones: { zone: 'bia_rung'; i0: number; j0: number; i1: number; j1: number }[];
  density: number;
} {
  const per = ZONE_SPAWN_TABLES.find((t) => t.zone === 'bia_rung')!.groups.reduce((n, g) => n + g.count, 0);
  const lo = MAP / 2 - area / 2;
  return { zones: [{ zone: 'bia_rung', i0: lo, j0: lo, i1: lo + area, j1: lo + area }], density: mobCount / per };
}
const skills = compileSkills();
const spawn = { i0: MAP / 2 - area / 2, j0: MAP / 2 - area / 2, side: area };
const srv = await startServer({
  port: 0,
  // the per-IP registration / login limits would block a many-bot run from one host
  auth: { registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
  world: { seed, mapTiles: MAP, spawn, skills, mobs: mobCount > 0 ? mobConfig() : undefined },
});
const mobsAlive = srv.world.mobs?.alive ?? 0;
log(`server on :${srv.port}; ${mobsAlive} mobs; connecting ${bots + speedhackers + teleporters} bots...`);

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
  resetWindow(srv);
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
    {
      bots,
      speedhackers,
      teleporters,
      durationS: Math.round(sample.durationS),
      areaTiles: area,
      inputHz,
      mobs: mobsAlive,
    },
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
