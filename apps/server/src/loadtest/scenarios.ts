/**
 * P2 exit measurement scenarios (docs/28 section 6). Bundled by scripts/p2-exit.mjs:
 *
 *   npm run p2exit -w @vgtd/server -- <scenario> [options]
 *
 *   flight       S4  flyers toggle flight and fly at 18 tiles/s with frequent turns (AOI centre lead, enter/leave churn)
 *   badnet       S6  bots + real-netcode clients through a latency / jitter / loss proxy (300 ms RTT, 80 ms jitter, 5 %)
 *   loginstorm   S7  500 logins in 10 s against the password-hash queue while bots stay connected
 *   cooldown     --  bots that ignore skill cooldowns: must be capped or kicked, honest bots unaffected
 *   soak         S5  long run with heap / tick-drift sampling (minutes here; hours on a target box)
 *   war          S3  200 players packed together with mobs around, all casting their class skills (server combat on)
 *
 * Common options: --bots N --duration S --warmup S --seed N --json
 * Per scenario: flight --flyers N --area T · badnet --predictors N · loginstorm --logins N --window S · cooldown --cheaters N
 *               · soak --minutes M --sample S
 * war: --bots N --mobs N --area T --cast-ms MS (default 900, above the 800 ms GCD) (no PvP exists yet, so the "two factions" of docs/28 are one crowd fighting mobs)
 * Every scenario prints its numbers and PASS/FAIL criteria; exit code 1
 * when a criterion fails. All numbers are same-machine loopback: see docs/OPEN-ITEMS.md "P2 exit".
 */
import { Worker } from 'node:worker_threads';
import { NETWORK, ZONE_SPAWN_TABLES, skillsOf } from '@vgtd/shared';
import { FLY_SPEED, compileSkills } from '@vgtd/sim';
import { startServer, type RunningServer } from '../server.js';
import type { BotKind, BotReport } from './bot.js';
import { S6_IMPAIRMENT } from './impair.js';
import type { PredictBotReport } from './predict-bot.js';
import type { BotRunConfig } from './runner.js';
import { dist, type Dist } from './stats.js';
import type { StormResult } from './storm-worker.js';
import { copyStats, resetWindow, windowSample } from './window.js';

const argv = process.argv.slice(2);
const scenario = argv[0] ?? '';
function num(name: string, def: number): number {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = Number(argv[i + 1]);
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${name} needs a non-negative number`);
  return v;
}
const asJson = argv.includes('--json');
const seed = num('seed', 1);
const warmup = num('warmup', 3);
const MAP = 256;
const KB = 1024;
const f = (n: number, d = 2): string => n.toFixed(d);
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const log = (s: string): void => {
  if (!asJson) console.log(s);
};

export interface Criterion {
  name: string;
  target: string;
  value: string;
  pass: boolean;
}
interface Outcome {
  scenario: string;
  summary: string[];
  criteria: Criterion[];
  data?: unknown;
}

// ------------------------------------------------------------------ plumbing
const skills = compileSkills();
function squareAt(side: number): { i0: number; j0: number; side: number } {
  return { i0: MAP / 2 - side / 2, j0: MAP / 2 - side / 2, side };
}
async function startWorld(
  spawn: { i0: number; j0: number; side: number },
  world: { mobs?: number; combat?: boolean } = {},
): Promise<RunningServer> {
  // one zone over the bots' area; table counts scaled so about `mobs` monsters live there (same as the load-test CLI)
  const per = ZONE_SPAWN_TABLES.find((t) => t.zone === 'bia_rung')!.groups.reduce((n, g) => n + g.count, 0);
  const mobConfig = world.mobs
    ? {
        zones: [
          {
            zone: 'bia_rung' as const,
            i0: spawn.i0,
            j0: spawn.j0,
            i1: spawn.i0 + spawn.side,
            j1: spawn.j0 + spawn.side,
          },
        ],
        density: world.mobs / per,
      }
    : undefined;
  return startServer({
    port: 0,
    // the per-IP limits would block a many-bot run that comes from one loopback address
    auth: { registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { seed, mapTiles: MAP, spawn, skills, mobs: mobConfig, combat: world.combat ? {} : undefined },
  });
}

interface WorkerHandle {
  worker: Worker;
  next<T>(type: string): Promise<T>;
}
function spawnWorker(file: string, workerData: unknown): WorkerHandle {
  const worker = new Worker(new URL(file, import.meta.url), { workerData });
  const next = <T>(type: string): Promise<T> =>
    new Promise((resolve, reject) => {
      const onMsg = (m: { type: string; message?: string }): void => {
        if (m.type === 'failed') {
          worker.off('message', onMsg);
          reject(new Error(`worker failed: ${m.message}`));
        } else if (m.type === type) {
          worker.off('message', onMsg);
          resolve(m as T);
        }
      };
      worker.on('message', onMsg);
      worker.once('error', reject);
    });
  return { worker, next };
}

function fleetConfig(srv: RunningServer, spawn: BotRunConfig['area'], over: Partial<BotRunConfig>): BotRunConfig {
  return {
    host: '127.0.0.1',
    port: srv.port,
    bots: 0,
    speedhackers: 0,
    teleporters: 0,
    inputHz: 20,
    area: spawn,
    skillCount: skills.length,
    speedFactor: 3,
    prefix: `p2${Date.now().toString(36)}`,
    seed,
    mapTiles: MAP,
    ...over,
  };
}

interface FleetRun {
  sample: ReturnType<typeof windowSample>;
  reports: BotReport[];
  predictors: PredictBotReport[];
  proxy: { chunks: number; stalled: number } | null;
}
/** Connect the fleet, warm up, measure `durationS`, stop. `during` runs concurrently with the measured window. */
async function runFleet(
  srv: RunningServer,
  cfg: BotRunConfig,
  durationS: number,
  during?: () => Promise<void>,
): Promise<FleetRun> {
  const h = spawnWorker('./bot-worker.mjs', cfg);
  try {
    log(`server on :${srv.port}; connecting bots...`);
    await h.next('connected');
    log(`connected; warming up ${warmup}s, measuring ${durationS}s...`);
    await sleep(warmup * 1000);
    resetWindow(srv);
    const base = copyStats(srv);
    const cpu0 = process.cpuUsage();
    const t0 = performance.now();
    h.worker.postMessage({ type: 'measure' });
    if (during) await Promise.all([sleep(durationS * 1000), during()]);
    else await sleep(durationS * 1000);
    const sample = windowSample(srv, base, (performance.now() - t0) / 1000, process.cpuUsage(cpu0));
    h.worker.postMessage({ type: 'stop' });
    const r = await h.next<{ reports: BotReport[]; predictors: PredictBotReport[]; proxy: FleetRun['proxy'] }>(
      'reports',
    );
    return { sample, reports: r.reports, predictors: r.predictors, proxy: r.proxy };
  } finally {
    await h.worker.terminate();
  }
}

/** Per-population numbers: bandwidth, AOI churn, kicks, speed, full snapshots. */
function population(run: FleetRun, kind: BotKind) {
  const rs = run.reports.filter((r) => r.kind === kind);
  const ids = new Set(rs.map((r) => r.entityId));
  const sc = run.sample.clients.filter((c) => ids.has(c.entityId));
  const dur = run.sample.durationS;
  const wire = sc.map((c) => c.wireBytesOut / dur / KB);
  const up = sc.map((c) => c.bytesIn / dur / KB);
  const vis = sc.map((c) => (c.visibleSamples ? c.visibleSum / c.visibleSamples : 0));
  const snaps = rs.reduce((a, r) => a + r.snapshots, 0);
  const full = rs.reduce((a, r) => a + r.fullSnapshots, 0);
  return {
    count: rs.length,
    connected: rs.filter((r) => !r.kicked && !r.closedUnexpectedly).length,
    kicked: rs.filter((r) => r.kicked).length,
    kickedAfterS: dist(rs.filter((r) => r.kickedAfterMs !== null).map((r) => (r.kickedAfterMs as number) / 1000)),
    downWire: dist(wire),
    downMax: Math.max(0, ...wire),
    up: dist(up),
    visible: dist(vis),
    visibleMax: Math.max(0, ...sc.map((c) => c.visibleMax)),
    enterPerSec: sc.length ? sc.reduce((a, c) => a + c.aoiEnter, 0) / sc.length / dur : 0,
    leavePerSec: sc.length ? sc.reduce((a, c) => a + c.aoiLeave, 0) / sc.length / dur : 0,
    maxSpeed: Math.max(0, ...rs.map((r) => r.maxSpeedTilesPerS)),
    snapshots: snaps,
    fullSnapshots: full,
    fullRatio: snaps ? full / snaps : 0,
    rtt: dist(rs.flatMap((r) => r.rttMs)),
    castOk: rs.reduce((a, r) => a + r.castOk, 0),
    castRejected: rs.reduce((a, r) => a + r.castRejected, 0),
    errors: rs.flatMap((r) => r.errors).slice(0, 5),
  };
}

const tickLine = (d: Dist): string =>
  `tick ms p50 ${f(d.p50)} p95 ${f(d.p95)} p99 ${f(d.p99)} max ${f(d.max)} (n=${d.n})`;

// ------------------------------------------------------------------ S4 flight
async function flight(): Promise<Outcome> {
  const flyers = num('flyers', 50);
  const side = num('area', 200);
  const duration = num('duration', 30);
  const spawn = squareAt(side);
  const srv = await startWorld(spawn);
  try {
    const run = await runFleet(srv, fleetConfig(srv, spawn, { flyers }), duration);
    const p = population(run, 'flyer');
    const tick = dist(run.sample.tickMs);
    return {
      scenario: `S4 fast flight: ${flyers} flyers at ${FLY_SPEED} tiles/s over ${side}x${side} tiles, ${duration}s`,
      summary: [
        tickLine(tick),
        `down KB/s/flyer (wire) mean ${f(p.downWire.mean)} p95 ${f(p.downWire.p95)} max ${f(p.downMax)}; up mean ${f(p.up.mean)}`,
        `AOI visible mean ${f(p.visible.mean, 1)} (max ${p.visibleMax}); enter ${f(p.enterPerSec)}/s leave ${f(p.leavePerSec)}/s per flyer`,
        `max observed speed ${f(p.maxSpeed)} tiles/s (limit ${FLY_SPEED}); kicked ${p.kicked}/${p.count}`,
        `anti-cheat violations ${JSON.stringify(run.sample.metrics.violations)} warns ${run.sample.metrics.warns} flags ${run.sample.metrics.flags}`,
      ],
      criteria: [
        {
          name: 'flyers never kicked (no anti-cheat false positive at flight speed)',
          target: '0 kicked, 0 dropped',
          value: `${p.connected}/${p.count} connected`,
          pass: p.count === flyers && p.connected === p.count,
        },
        {
          name: 'flight really happened and stays within FLY_SPEED',
          target: `0.8 x ${FLY_SPEED} <= measured speed <= 1.3 x ${FLY_SPEED} tiles/s (arrival-time measure) and 0 server distance violations`,
          value: `${f(p.maxSpeed)} tiles/s`,
          pass:
            p.maxSpeed >= 0.8 * FLY_SPEED &&
            p.maxSpeed <= 1.3 * FLY_SPEED &&
            (run.sample.metrics.violations.distance ?? 0) === 0,
        },
        { name: 'tick p99', target: '<= 40 ms', value: `${f(tick.p99)} ms`, pass: tick.p99 <= 40 },
        {
          name: 'downstream per flyer (worst)',
          target: '<= 8 KB/s',
          value: `${f(p.downMax)} KB/s`,
          pass: p.downMax <= 8,
        },
        {
          name: 'AOI churn measurable (flyers cross AOI borders)',
          target: 'enter/leave > 0',
          value: `${f(p.enterPerSec)}/${f(p.leavePerSec)} per s`,
          pass: p.enterPerSec > 0 && p.leavePerSec > 0,
        },
      ],
    };
  } finally {
    await srv.stop();
  }
}

// ------------------------------------------------------------------ S6 bad network
async function badnet(): Promise<Outcome> {
  const bots = num('bots', 50);
  const predictors = num('predictors', 10);
  const duration = num('duration', 30);
  const spawn = squareAt(num('area', 60));
  const srv = await startWorld(spawn);
  try {
    const run = await runFleet(srv, fleetConfig(srv, spawn, { bots, predictors, impair: S6_IMPAIRMENT }), duration);
    const p = population(run, 'honest');
    const tick = dist(run.sample.tickMs);
    const pr = run.predictors;
    const worstP99 = Math.max(0, ...pr.map((r) => r.errorTiles.p99));
    const maxErr = Math.max(0, ...pr.map((r) => r.errorTiles.max));
    const overSmall = pr.reduce((a, r) => a + r.errorsOverSmall, 0);
    const overSnap = pr.reduce((a, r) => a + r.errorsOverSnap, 0);
    const nSnaps = pr.reduce((a, r) => a + r.errorTiles.n, 0);
    const alive = pr.filter((r) => r.status === 'online').length;
    const im = S6_IMPAIRMENT;
    return {
      scenario: `S6 bad network: ${bots} bots + ${predictors} real-netcode clients, one-way ${im.delayMs} ms +-${im.jitterMs} ms jitter, ${im.lossPct}% loss (RTO ${im.rtoMs} ms), ${duration}s`,
      summary: [
        tickLine(tick),
        `ping RTT ms p50 ${f(p.rtt.p50)} p95 ${f(p.rtt.p95)} p99 ${f(p.rtt.p99)}; proxy held back ${run.proxy?.stalled ?? 0}/${run.proxy?.chunks ?? 0} chunks`,
        `down KB/s/bot (wire) mean ${f(p.downWire.mean)} max ${f(p.downMax)}; up mean ${f(p.up.mean)}`,
        `full snapshots ${p.fullSnapshots}/${p.snapshots} = ${f(p.fullRatio * 100, 1)}% (resync after >1 s without ack)`,
        `real-netcode clients: ${alive}/${pr.length} online; replay error tiles p99 ${f(worstP99, 3)} max ${f(maxErr, 3)}; over 0.15: ${overSmall}/${nSnaps}, over 2.0: ${overSnap}`,
        `anti-cheat violations ${JSON.stringify(run.sample.metrics.violations)} warns ${run.sample.metrics.warns} flags ${run.sample.metrics.flags} disconnects ${run.sample.metrics.disconnects}`,
      ],
      criteria: [
        {
          name: 'impairment is really applied',
          target: 'bot ping RTT p50 within 250..500 ms',
          value: `${f(p.rtt.p50)} ms`,
          pass: p.rtt.p50 >= 250 && p.rtt.p50 <= 500,
        },
        {
          name: 'honest bots survive jitter bursts (anti-cheat time budget)',
          target: '0 kicked, 0 dropped',
          value: `${p.connected}/${p.count} connected, ${run.sample.metrics.disconnects} server disconnects`,
          pass: p.count === bots && p.connected === p.count && run.sample.metrics.disconnects === 0,
        },
        {
          name: 'real-netcode clients stay online',
          target: 'all online',
          value: `${alive}/${pr.length}${pr.find((r) => r.status !== 'online')?.lastError ? ` (${pr.find((r) => r.status !== 'online')?.lastError})` : ''}`,
          pass: pr.length > 0 && alive === pr.length,
        },
        {
          name: 'reconciliation error stays invisible',
          target: 'p99 <= 0.15 tiles, never > 2 tiles (no visible snap)',
          value: `p99 ${f(worstP99, 3)}, max ${f(maxErr, 3)}`,
          pass: nSnaps > 0 && worstP99 <= 0.15 && overSnap === 0,
        },
        { name: 'tick p99', target: '<= 40 ms', value: `${f(tick.p99)} ms`, pass: tick.p99 <= 40 },
      ],
    };
  } finally {
    await srv.stop();
  }
}

// ------------------------------------------------------------------ S7 login storm
async function loginstorm(): Promise<Outcome> {
  const bots = num('bots', 100);
  const logins = num('logins', 500);
  const windowS = num('window', 10);
  const spawn = squareAt(num('area', 96));
  const srv = await startWorld(spawn);
  try {
    const storm = spawnWorker('./storm-worker.mjs', {
      host: '127.0.0.1',
      port: srv.port,
      accounts: Math.min(logins, num('accounts', logins)),
      logins,
      windowS,
      prefix: `st${Date.now().toString(36)}`,
    });
    let result!: StormResult;
    const during = async (): Promise<void> => {
      storm.worker.postMessage({ type: 'go' });
      result = (await storm.next<{ result: StormResult }>('result')).result;
    };
    // accounts are registered before the measured window; the bots stay connected during the storm
    log(`registering ${logins} accounts...`);
    await storm.next('registered');
    const run = await runFleet(srv, fleetConfig(srv, spawn, { bots }), Math.max(windowS + 10, 15), during);
    await storm.worker.terminate();
    const tick = dist(run.sample.tickMs);
    const lat = dist(result.latenciesMs);
    const ok = result.statuses['200'] ?? 0;
    const busy = result.statuses['503'] ?? 0;
    const none = result.statuses['0'] ?? 0;
    const other = Object.entries(result.statuses)
      .filter(([k]) => !['200', '503', '0'].includes(k))
      .reduce((a, [, v]) => a + v, 0);
    const p = population(run, 'honest');
    return {
      scenario: `S7 login storm: ${logins} logins in ${windowS}s (scrypt, hash queue cap ${64}) with ${bots} bots online`,
      summary: [
        `statuses ${JSON.stringify(result.statuses)}; answered in ${f(result.totalS, 1)}s total (${f(logins / Math.max(0.001, result.totalS), 0)}/s sustained)`,
        `login latency ms p50 ${f(lat.p50, 0)} p95 ${f(lat.p95, 0)} p99 ${f(lat.p99, 0)} max ${f(lat.max, 0)}`,
        `${tickLine(tick)} while the storm ran`,
        `bots online ${p.connected}/${p.count}; server RSS ${f(run.sample.rssMb, 0)} MB`,
      ],
      criteria: [
        {
          name: 'every request answered (no timeout, no 5xx other than the 503 queue overflow)',
          target: '0 unanswered, 0 other statuses',
          value: `${none} unanswered, ${other} other`,
          pass: none === 0 && other === 0 && ok + busy === logins,
        },
        {
          name: 'accepted logins succeed; overflow answers 503 (queue works, not a crash)',
          target: '200 + 503 = all',
          value: `${ok} x 200, ${busy} x 503`,
          pass: ok + busy === logins && ok > 0,
        },
        {
          name: 'game tick is not starved by password hashing',
          target: 'tick p99 <= 40 ms during the storm',
          value: `${f(tick.p99)} ms`,
          pass: tick.p99 <= 40,
        },
        {
          name: 'online players unaffected',
          target: '0 dropped',
          value: `${p.connected}/${p.count}`,
          pass: p.count === bots && p.connected === p.count,
        },
      ],
      data: { statuses: result.statuses, latencyMs: lat },
    };
  } finally {
    await srv.stop();
  }
}

// ------------------------------------------------------------------ cooldown hack
async function cooldown(): Promise<Outcome> {
  const bots = num('bots', 30);
  const cheaters = num('cheaters', 3);
  const duration = num('duration', 15);
  const spawn = squareAt(num('area', 60));
  const srv = await startWorld(spawn);
  try {
    const run = await runFleet(srv, fleetConfig(srv, spawn, { bots, cooldowners: cheaters }), duration);
    const honest = population(run, 'honest');
    const ch = population(run, 'cooldown');
    const s0 = skills[0]!;
    // casts of skill 0 the server may accept in the time a cheater stayed connected
    const per = Math.max(s0.cooldownMs, s0.gcdMs, 1);
    const cheaterReports = run.reports.filter((r) => r.kind === 'cooldown');
    const worstOk = Math.max(0, ...cheaterReports.map((r) => r.castOk));
    const legalMax = Math.max(
      0,
      ...cheaterReports.map((r) => Math.ceil((((r.kickedAfterMs ?? duration * 1000) as number) / per) * 1.25) + 2),
    );
    const m = run.sample.metrics;
    return {
      scenario: `Cooldown hack: ${cheaters} bots spam skill 0 every tick (cooldown ${s0.cooldownMs} ms, GCD ${s0.gcdMs} ms) among ${bots} honest bots, ${duration}s`,
      summary: [
        `cheaters kicked ${ch.kicked}/${ch.count}${ch.kicked ? ` after ${f(ch.kickedAfterS.mean, 1)}s` : ''}; accepted casts per cheater <= ${worstOk} (legal bound ${legalMax})`,
        `server: casts ok ${m.castOk} rejected ${m.castRejected} dropped ${m.castDropped}; violations ${JSON.stringify(m.violations)} warns ${m.warns} disconnects ${m.disconnects}`,
        `honest bots connected ${honest.connected}/${honest.count} (casting normally: ok ${honest.castOk}, rejected ${honest.castRejected})`,
      ],
      criteria: [
        {
          name: 'cooldown hack capped',
          target: 'accepted casts <= legal bound (cooldown/GCD x 1.25 + 2), or kicked',
          value: `${worstOk} accepted, bound ${legalMax}, kicked ${ch.kicked}/${ch.count}`,
          pass: ch.count === cheaters && (ch.kicked === ch.count || worstOk <= legalMax) && worstOk <= legalMax,
        },
        {
          name: 'violations recorded for the cheaters',
          target: 'cooldown / queue violations > 0',
          value: JSON.stringify(m.violations),
          pass: (m.violations.cooldown ?? 0) > 0 || m.castRejected > 0,
        },
        {
          name: 'honest bots unaffected',
          target: '0 kicked',
          value: `${honest.connected}/${honest.count}`,
          pass: honest.count === bots && honest.connected === honest.count,
        },
      ],
    };
  } finally {
    await srv.stop();
  }
}

// ------------------------------------------------------------------ S5 soak
interface SoakPoint {
  tMin: number;
  heapMb: number;
  rssMb: number;
  connected: number;
  tickP99: number;
  tickMean: number;
  downKBps: number;
  /** server tick count x 50 ms minus wall time: positive = ahead of real time, negative = the loop is falling behind */
  driftMs: number;
}
async function soak(): Promise<Outcome> {
  const bots = num('bots', 100);
  const minutes = num('minutes', 3);
  const sampleS = num('sample', 10);
  const spawn = squareAt(num('area', 96));
  const srv = await startWorld(spawn);
  const gc = (globalThis as { gc?: () => void }).gc;
  const h = spawnWorker('./bot-worker.mjs', fleetConfig(srv, spawn, { bots }));
  try {
    log(`server on :${srv.port}; connecting ${bots} bots...`);
    await h.next('connected');
    log(
      `soak: ${minutes} min, sampling every ${sampleS}s${gc ? '' : ' (run with --expose-gc for stable heap numbers)'}`,
    );
    await sleep(warmup * 1000);
    h.worker.postMessage({ type: 'measure' });
    resetWindow(srv);
    const points: SoakPoint[] = [];
    const t0 = performance.now();
    const tick0 = srv.world.world.tick;
    let prevBytes = [...srv.world.clients.values()].reduce((a, c) => a + c.stats.wireBytesOut, 0);
    let prevT = t0;
    while (performance.now() - t0 < minutes * 60_000) {
      await sleep(sampleS * 1000);
      gc?.();
      const now = performance.now();
      const ticks = [...srv.world.tickMs];
      resetWindow(srv);
      const bytes = [...srv.world.clients.values()].reduce((a, c) => a + c.stats.wireBytesOut, 0);
      const d = dist(ticks);
      const clients = srv.world.clients.size;
      points.push({
        tMin: (now - t0) / 60_000,
        heapMb: process.memoryUsage().heapUsed / 1048576,
        rssMb: process.memoryUsage().rss / 1048576,
        connected: clients,
        tickP99: d.p99,
        tickMean: d.mean,
        downKBps: (bytes - prevBytes) / ((now - prevT) / 1000) / Math.max(1, clients) / KB,
        driftMs: (srv.world.world.tick - tick0) * NETWORK.TICK_MS - (now - t0),
      });
      prevBytes = bytes;
      prevT = now;
      const pt = points.at(-1)!;
      log(
        `  t=${f(pt.tMin, 1)}min heap ${f(pt.heapMb, 1)} MB rss ${f(pt.rssMb, 0)} MB connected ${pt.connected} tick p99 ${f(pt.tickP99)} ms down ${f(pt.downKBps)} KB/s/player drift ${f(pt.driftMs, 0)} ms`,
      );
    }
    h.worker.postMessage({ type: 'stop' });
    const rep = await h.next<{ reports: BotReport[] }>('reports');
    const dropped = rep.reports.filter((r) => r.kicked || r.closedUnexpectedly).length;
    // docs/28: heap stable (+-5 %) after the 2nd hour; scaled to the run: compare the 25 % mark with the end
    const mark = points[Math.max(0, Math.floor(points.length * 0.25) - 1)]!;
    const end = points.at(-1)!;
    const heapChange = (end.heapMb - mark.heapMb) / mark.heapMb;
    const elapsedMs = end.tMin * 60_000;
    const driftPct = Math.abs(end.driftMs) / elapsedMs;
    const worstP99 = Math.max(...points.map((q) => q.tickP99));
    return {
      scenario: `S5 soak: ${bots} bots, ${minutes} min (docs/28 asks 200 bots for 4-8 h on a target box)`,
      summary: [
        `heap ${f(mark.heapMb, 1)} MB at the 25% mark -> ${f(end.heapMb, 1)} MB at the end (${f(heapChange * 100, 1)}%); rss ${f(end.rssMb, 0)} MB`,
        `tick drift ${f(end.driftMs, 0)} ms over ${f(elapsedMs / 1000, 0)} s (${f(driftPct * 100, 3)}%); worst window tick p99 ${f(worstP99)} ms`,
        `bots dropped ${dropped}/${bots}; down ${f(end.downKBps)} KB/s/player at the end`,
      ],
      criteria: [
        {
          name: 'no bot dropped',
          target: '0',
          value: `${dropped}/${bots}`,
          pass: dropped === 0 && end.connected === bots,
        },
        {
          name: 'heap stable after the first quarter',
          target: '+-5 % (docs/28), measured after gc when available',
          value: `${f(heapChange * 100, 1)}%${gc ? '' : ' (no --expose-gc)'}`,
          pass: Math.abs(heapChange) <= 0.05,
        },
        {
          name: 'tick loop keeps real time',
          target: 'drift <= 1 % of elapsed',
          value: `${f(driftPct * 100, 3)}%`,
          pass: driftPct <= 0.01,
        },
        { name: 'worst-window tick p99', target: '<= 40 ms', value: `${f(worstP99)} ms`, pass: worstP99 <= 40 },
      ],
      data: { points },
    };
  } finally {
    await h.worker.terminate();
    await srv.stop();
  }
}

// ------------------------------------------------------------------ S3 war
async function war(): Promise<Outcome> {
  const bots = num('bots', 200);
  const mobs = num('mobs', 150);
  const duration = num('duration', 30);
  const castMs = num('cast-ms', 900); // a real client waits for the GCD (800 ms) and per-skill cooldowns
  const spawn = squareAt(num('area', 40));
  const srv = await startWorld(spawn, { mobs, combat: true });
  try {
    // the class every player gets owns 8 of the skills: casting any other id is rejected as UnknownSkill
    const keys = new Set(skillsOf('kiem').map((k) => k.id));
    const skillIds = skills.filter((k) => keys.has(k.key)).map((k) => k.id);
    const alive = srv.world.mobs?.alive ?? 0;
    const run = await runFleet(
      srv,
      fleetConfig(srv, spawn, { bots, skillIds, castEveryMs: castMs, castGcdMs: skills[0]!.gcdMs }),
      duration,
    );
    const p = population(run, 'honest');
    const tick = dist(run.sample.tickMs);
    const rs = run.reports.filter((r) => r.kind === 'honest');
    const hits = rs.reduce((a, r) => a + r.hitsSeen, 0);
    const m = run.sample.metrics;
    const war = NETWORK.BANDWIDTH_KBPS_WAR;
    return {
      scenario: `S3 war: ${bots} players in ${spawn.side}x${spawn.side} tiles with ${alive} mobs, each casting one of ${skillIds.length} class skills about every ${castMs} ms, ${duration}s (no PvP yet)`,
      summary: [
        tickLine(tick),
        `tick breakdown ms: sim step mean ${f(run.sample.phases.stepMs / Math.max(1, tick.n))}  AOI mean ${f(run.sample.phases.aoiMs / Math.max(1, run.sample.phases.aoiTicks))} per AOI tick  snapshot encode+send mean ${f(run.sample.phases.snapMs / Math.max(1, tick.n))}`,
        `down KB/s/player (wire) mean ${f(p.downWire.mean)} p95 ${f(p.downWire.p95)} max ${f(p.downMax)}; up mean ${f(p.up.mean)} max ${f(p.up.max)}`,
        `AOI visible mean ${f(p.visible.mean, 1)} (max ${p.visibleMax}); enter ${f(p.enterPerSec)}/s leave ${f(p.leavePerSec)}/s`,
        `casts: ok ${p.castOk}, rejected ${p.castRejected}, hits seen ${hits}; server: ok ${m.castOk} rejected ${m.castRejected} dropped ${m.castDropped}; violations ${JSON.stringify(m.violations)}`,
        `server CPU ${f(((run.sample.cpuUserMs + run.sample.cpuSystemMs) / (run.sample.durationS * 1000)) * 100, 0)}% of one core, RSS ${f(run.sample.rssMb, 0)} MB`,
      ],
      criteria: [
        {
          name: 'CCU stable under casting',
          target: `${bots} bots, none dropped or kicked`,
          value: `${p.connected}/${bots} connected, ${m.disconnects} server disconnects`,
          pass: p.count === bots && p.connected === bots && m.disconnects === 0,
        },
        { name: 'tick p99', target: '<= 40 ms', value: `${f(tick.p99)} ms`, pass: tick.p99 <= 40 },
        {
          name: 'downstream per player (worst, WS payload + frame header)',
          target: `<= ${war} KB/s (war budget)`,
          value: `${f(p.downMax)} KB/s (mean ${f(p.downWire.mean)})`,
          pass: p.downMax <= war,
        },
        { name: 'upstream per player', target: '< 1 KB/s', value: `${f(p.up.max)} KB/s`, pass: p.up.max < 1 },
        {
          name: 'visible entities within the Mobile cap',
          target: `<= ${NETWORK.MAX_ENTITIES_PER_CLIENT_MOBILE}`,
          value: `${p.visibleMax}`,
          pass: p.visibleMax <= NETWORK.MAX_ENTITIES_PER_CLIENT_MOBILE && p.visibleMax > 0,
        },
        {
          name: 'combat really ran (hits resolved)',
          target: 'accepted casts > 0 and hits > 0',
          value: `${p.castOk} ok, ${hits} hits`,
          pass: p.castOk > 0 && hits > 0,
        },
      ],
    };
  } finally {
    await srv.stop();
  }
}

// ------------------------------------------------------------------ main
const table: Record<string, () => Promise<Outcome>> = { flight, badnet, loginstorm, cooldown, soak, war };
if (!table[scenario]) {
  console.error(`usage: p2exit <${Object.keys(table).join('|')}> [options]  (see the header of scenarios.ts)`);
  process.exit(2);
}
let exitCode = 0;
try {
  const out = await table[scenario]!();
  if (asJson) console.log(JSON.stringify(out, null, 2));
  else {
    console.log(`\n${out.scenario}\n`);
    for (const l of out.summary) console.log(l);
    console.log('\ncriteria');
    for (const c of out.criteria)
      console.log(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.value}  (target ${c.target})`);
  }
  if (out.criteria.some((c) => !c.pass)) exitCode = 1;
} catch (e) {
  console.error(e);
  exitCode = 2;
}
process.exit(exitCode);
