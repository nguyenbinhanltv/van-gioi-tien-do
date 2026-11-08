/**
 * Load-test orchestration. `runBots` drives bots against a server URL (used inside a worker thread by the CLI so the
 * bots do not share the server's event loop, and in the main thread by tests). `summarize` turns the server-side
 * metrics + bot reports into the P2 exit-criteria report.
 */
import { NETWORK } from '@vgtd/shared';
import { Bot, type BotKind, type BotReport } from './bot.js';
import { dist, type Dist } from './stats.js';

export interface BotRunConfig {
  host: string;
  port: number;
  bots: number;
  speedhackers: number;
  teleporters: number;
  inputHz: number;
  area: { i0: number; j0: number; side: number };
  skillCount: number;
  speedFactor: number;
  prefix: string;
  seed: number;
}

export interface BotFleet {
  bots: Bot[];
  startMeasuring(): void;
  stop(): BotReport[];
}

/** Connect every bot (register + login + hello), staggering HTTP work, then start their input loops. */
export async function connectFleet(cfg: BotRunConfig, onProgress?: (n: number) => void): Promise<BotFleet> {
  const kinds: BotKind[] = [
    ...Array<BotKind>(cfg.bots).fill('honest'),
    ...Array<BotKind>(cfg.speedhackers).fill('speedhack'),
    ...Array<BotKind>(cfg.teleporters).fill('teleport'),
  ];
  const bots = kinds.map(
    (kind, k) =>
      new Bot({
        host: cfg.host,
        port: cfg.port,
        name: `${cfg.prefix}${kind === 'honest' ? 'b' : kind === 'speedhack' ? 's' : 't'}${k}`,
        kind,
        inputHz: cfg.inputHz,
        area: cfg.area,
        skillCount: cfg.skillCount,
        speedFactor: cfg.speedFactor,
        seed: cfg.seed * 1000 + k,
      }),
  );
  let done = 0;
  const batch = 16; // bounded concurrency: password hashing is the expensive part
  for (let k = 0; k < bots.length; k += batch) {
    await Promise.all(
      bots.slice(k, k + batch).map(async (b) => {
        await b.connect();
        onProgress?.(++done);
      }),
    );
  }
  for (const b of bots) b.startInputs();
  return {
    bots,
    startMeasuring: () => bots.forEach((b) => b.startMeasuring()),
    stop: () => {
      for (const b of bots) b.stop();
      return bots.map((b) => b.report);
    },
  };
}

// ---------------------------------------------------------------------- report
export interface ServerClientStats {
  entityId: number;
  bytesOut: number;
  wireBytesOut: number;
  framesOut: number;
  bytesIn: number;
  packetsIn: number;
  snapshots: number;
  snapshotsSkipped: number;
  aoiEnter: number;
  aoiLeave: number;
  visibleSum: number;
  visibleSamples: number;
  visibleMax: number;
}

export interface ServerSample {
  tickMs: number[];
  tickIntervalMs: number[];
  /** per-client counters accumulated during the measured window only */
  clients: ServerClientStats[];
  durationS: number;
  metrics: {
    violations: Record<string, number>;
    warns: number;
    flags: number;
    disconnects: number;
    castOk: number;
    castRejected: number;
    castDropped: number;
    kicksBadMessages: number;
    kicksRate: number;
    kicksBackpressure: number;
  };
  phases: {
    stepMs: number;
    aoiMs: number;
    snapMs: number;
    aoiTicks: number;
    maxStepMs: number;
    maxAoiMs: number;
    maxSnapMs: number;
  };
  cpuUserMs: number;
  cpuSystemMs: number;
  rssMb: number;
}

export interface LoadReport {
  config: {
    bots: number;
    speedhackers: number;
    teleporters: number;
    durationS: number;
    areaTiles: number;
    inputHz: number;
    /** monsters alive in the world during the run (D74); 0 / absent = none */
    mobs?: number;
  };
  concurrent: number;
  tickMs: Dist;
  tickOverruns: number;
  tickIntervalMs: Dist;
  tickBudgetMs: number;
  downKBpsPayload: Dist;
  downKBpsWire: Dist;
  upKBps: Dist;
  snapshotsPerSecPerPlayer: number;
  aoi: { visibleMean: Dist; visibleMax: number; enterPerSec: number; leavePerSec: number };
  rttMs: Dist;
  honest: { connected: number; kicked: number; closedUnexpectedly: number; decodeErrors: number };
  cheaters: {
    kind: BotKind;
    count: number;
    kicked: number;
    kickedAfterS: Dist;
    maxObservedSpeed: number;
    legitMaxSpeed: number;
  }[];
  /** mean ms per tick spent in each phase (AOI is averaged over AOI ticks only) and the slowest sample */
  phases: { stepMean: number; aoiMean: number; snapMean: number; stepMax: number; aoiMax: number; snapMax: number };
  anticheat: ServerSample['metrics'];
  cpu: { serverCpuPct: number; rssMb: number };
  criteria: { name: string; target: string; value: string; pass: boolean }[];
}

const KB = 1024;

export function summarize(cfg: LoadReport['config'], s: ServerSample, bots: BotReport[]): LoadReport {
  const honestBots = bots.filter((b) => b.kind === 'honest');
  const honestIds = new Set(honestBots.map((b) => b.entityId));
  // per-player stats for honest players only (cheaters are removed by anti-cheat and would skew the averages)
  const sc = s.clients.filter((c) => honestIds.has(c.entityId));
  const dur = s.durationS;
  const down = sc.map((c) => c.bytesOut / dur / KB);
  const wire = sc.map((c) => c.wireBytesOut / dur / KB);
  const up = sc.map((c) => c.bytesIn / dur / KB);
  const vis = sc.map((c) => (c.visibleSamples ? c.visibleSum / c.visibleSamples : 0));
  const tick = dist(s.tickMs);
  const budget = NETWORK.TICK_MS;
  const overruns = s.tickMs.filter((t) => t > budget).length;
  const cheaters = (['speedhack', 'teleport'] as BotKind[])
    .map((kind) => {
      const group = bots.filter((b) => b.kind === kind);
      return {
        kind,
        count: group.length,
        kicked: group.filter((b) => b.kicked).length,
        kickedAfterS: dist(
          group.filter((b) => b.kickedAfterMs !== null).map((b) => (b.kickedAfterMs as number) / 1000),
        ),
        maxObservedSpeed: Math.max(0, ...group.map((b) => b.maxSpeedTilesPerS)),
        legitMaxSpeed: Math.max(0, ...honestBots.map((b) => b.maxSpeedTilesPerS)),
      };
    })
    .filter((c) => c.count > 0);
  const honestKicked = honestBots.filter((b) => b.kicked).length;
  const closed = honestBots.filter((b) => b.closedUnexpectedly).length;
  const downMax = Math.max(0, ...wire);
  const report: LoadReport = {
    config: cfg,
    concurrent: bots.length,
    tickMs: tick,
    tickOverruns: overruns,
    tickIntervalMs: dist(s.tickIntervalMs),
    tickBudgetMs: budget,
    downKBpsPayload: dist(down),
    downKBpsWire: dist(wire),
    upKBps: dist(up),
    snapshotsPerSecPerPlayer: sc.length ? sc.reduce((a, c) => a + c.snapshots, 0) / sc.length / dur : 0,
    aoi: {
      visibleMean: dist(vis),
      visibleMax: Math.max(0, ...sc.map((c) => c.visibleMax)),
      enterPerSec: sc.length ? sc.reduce((a, c) => a + c.aoiEnter, 0) / sc.length / dur : 0,
      leavePerSec: sc.length ? sc.reduce((a, c) => a + c.aoiLeave, 0) / sc.length / dur : 0,
    },
    rttMs: dist(honestBots.flatMap((b) => b.rttMs)),
    honest: {
      connected: honestBots.length,
      kicked: honestKicked,
      closedUnexpectedly: closed,
      decodeErrors: honestBots.reduce((a, b) => a + b.errors.filter((e) => e.startsWith('decode')).length, 0),
    },
    cheaters,
    phases: {
      stepMean: s.phases.stepMs / Math.max(1, s.tickMs.length),
      aoiMean: s.phases.aoiMs / Math.max(1, s.phases.aoiTicks),
      snapMean: s.phases.snapMs / Math.max(1, s.tickMs.length),
      stepMax: s.phases.maxStepMs,
      aoiMax: s.phases.maxAoiMs,
      snapMax: s.phases.maxSnapMs,
    },
    anticheat: s.metrics,
    cpu: { serverCpuPct: ((s.cpuUserMs + s.cpuSystemMs) / (dur * 1000)) * 100, rssMb: s.rssMb },
    criteria: [],
  };
  const cheatersBlocked = cheaters.every(
    (c) => c.kicked === c.count || c.maxObservedSpeed <= c.legitMaxSpeed * 1.25 + 0.5,
  );
  report.criteria = [
    {
      name: 'CCU stable (honest bots connected, none dropped)',
      target: `${cfg.bots} bots`,
      value: `${honestBots.length - honestKicked - closed}/${cfg.bots} still connected`,
      pass: honestBots.length === cfg.bots && honestKicked === 0 && closed === 0,
    },
    {
      name: 'tick p99',
      target: '<= 40 ms',
      value: `${tick.p99.toFixed(2)} ms (p50 ${tick.p50.toFixed(2)}, max ${tick.max.toFixed(2)})`,
      pass: tick.p99 <= 40,
    },
    {
      name: 'downstream per player (WS payload + frame header, worst player)',
      target: '<= 8 KB/s',
      value: `${downMax.toFixed(2)} KB/s (mean ${dist(wire).mean.toFixed(2)})`,
      pass: downMax <= 8,
    },
    {
      name: 'AOI measurable',
      target: 'visible counts reported',
      value: `visible mean ${dist(vis).mean.toFixed(1)} (max ${report.aoi.visibleMax}), enter ${report.aoi.enterPerSec.toFixed(2)}/s, leave ${report.aoi.leavePerSec.toFixed(2)}/s`,
      pass: sc.length > 0 && report.aoi.visibleMax > 0,
    },
  ];
  if (cheaters.length > 0) {
    report.criteria.push({
      name: 'speedhack / teleport blocked',
      target: 'cheaters kicked or clamped to legit speed',
      value: cheaters
        .map(
          (c) =>
            `${c.kind}: ${c.kicked}/${c.count} kicked, max speed ${c.maxObservedSpeed.toFixed(2)} t/s (honest ${c.legitMaxSpeed.toFixed(2)})`,
        )
        .join('; '),
      pass: cheatersBlocked,
    });
  }
  return report;
}

export function formatReport(r: LoadReport): string {
  const f = (n: number, d = 2): string => n.toFixed(d);
  const lines: string[] = [];
  lines.push(
    `Load test: ${r.config.bots} honest bots + ${r.config.speedhackers} speedhack + ${r.config.teleporters} teleport, ${r.config.durationS}s measured, area ${r.config.areaTiles}x${r.config.areaTiles} tiles, ${r.config.inputHz} Hz input${r.config.mobs ? `, ${r.config.mobs} mobs` : ''}`,
  );
  lines.push('');
  lines.push(
    `tick duration ms   p50 ${f(r.tickMs.p50)}  p95 ${f(r.tickMs.p95)}  p99 ${f(r.tickMs.p99)}  max ${f(r.tickMs.max)}  (n=${r.tickMs.n}, overruns>${r.tickBudgetMs}ms: ${r.tickOverruns})`,
  );
  lines.push(
    `tick breakdown ms  sim step mean ${f(r.phases.stepMean)} (max ${f(r.phases.stepMax)})  AOI mean ${f(r.phases.aoiMean)} per AOI tick (max ${f(r.phases.aoiMax)})  snapshot encode+send mean ${f(r.phases.snapMean)} (max ${f(r.phases.snapMax)})`,
  );
  lines.push(
    `tick interval ms   p50 ${f(r.tickIntervalMs.p50)}  p99 ${f(r.tickIntervalMs.p99)}  max ${f(r.tickIntervalMs.max)}`,
  );
  lines.push(
    `down KB/s/player   payload mean ${f(r.downKBpsPayload.mean)}  p95 ${f(r.downKBpsPayload.p95)}  max ${f(r.downKBpsPayload.max)}   | with WS frame header mean ${f(r.downKBpsWire.mean)}  p95 ${f(r.downKBpsWire.p95)}  max ${f(r.downKBpsWire.max)}`,
  );
  lines.push(
    `up KB/s/player     mean ${f(r.upKBps.mean)}  max ${f(r.upKBps.max)}   snapshots/s/player ${f(r.snapshotsPerSecPerPlayer, 1)}`,
  );
  lines.push(
    `AOI visible        mean-per-player: mean ${f(r.aoi.visibleMean.mean, 1)}  p50 ${f(r.aoi.visibleMean.p50, 1)}  p95 ${f(r.aoi.visibleMean.p95, 1)}  max seen ${r.aoi.visibleMax}   enter ${f(r.aoi.enterPerSec)}/s leave ${f(r.aoi.leavePerSec)}/s`,
  );
  lines.push(`ping RTT ms        p50 ${f(r.rttMs.p50)}  p99 ${f(r.rttMs.p99)}  (client loop shares the host CPU)`);
  lines.push(`server CPU         ${f(r.cpu.serverCpuPct, 1)}% of one core, RSS ${f(r.cpu.rssMb, 0)} MB`);
  const a = r.anticheat;
  lines.push(
    `anti-cheat         violations ${JSON.stringify(a.violations)} warns ${a.warns} flags ${a.flags} disconnects ${a.disconnects}; casts ok ${a.castOk} rejected ${a.castRejected} dropped ${a.castDropped}`,
  );
  for (const c of r.cheaters)
    lines.push(
      `cheater ${c.kind.padEnd(9)} ${c.kicked}/${c.count} kicked, after ${f(c.kickedAfterS.mean, 1)}s (p99 ${f(c.kickedAfterS.p99, 1)}s), max observed ${f(c.maxObservedSpeed)} t/s vs honest ${f(c.legitMaxSpeed)} t/s`,
    );
  lines.push('');
  lines.push('P2 exit criteria');
  for (const c of r.criteria) lines.push(`  [${c.pass ? 'PASS' : 'FAIL'}] ${c.name}: ${c.value}  (target ${c.target})`);
  return lines.join('\n');
}
