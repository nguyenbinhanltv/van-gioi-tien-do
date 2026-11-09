/**
 * P5 soak / load-test report (docs/10 §12, docs/28 §6, docs/35): turns the time series of a gameplay-bot run into a summary and
 * PASS / FAIL against the DESIGN budgets. Pure functions (no clock, no I/O) so they are unit-tested; `soak.ts` collects the samples.
 *
 * Budgets are reported, never tuned: when one is exceeded the report says so and the run exits non-zero (the CI gate only fails on
 * correctness and gross overruns, see `gateFailures`).
 */
import { NETWORK } from '@vgtd/shared';
import { dist, type Dist } from './stats.js';

export const KB = 1024;

/** Design budgets the report is judged against (docs/00 §3, docs/24 §9, docs/28 §6.2). NOT gameplay numbers. */
export const BUDGETS = {
  /** the 20 Hz tick budget */
  tickBudgetMs: NETWORK.TICK_MS,
  /** docs/10 H2 / docs/28 §6.2: tick p99 */
  tickP99Ms: 40,
  /** downstream per player when fighting monsters (00 §3, docs/24 §9) */
  downKBps: 8,
  /** upstream per player (08 §8) */
  upKBps: 1,
  /** entities sent per player, Mobile / Web (00 §3) */
  visibleMax: 120,
  /** heap stable within this fraction (docs/28 §6.2: ±5% after the 2nd hour) */
  heapDrift: 0.05,
} as const;

/** Fixed-bin histogram of tick durations: a whole run (up to 24 h = 1.7 M ticks) in a few hundred numbers. */
export class TickHistogram {
  private readonly bins: number[];
  private overflow = 0;
  n = 0;
  max = 0;
  constructor(
    private readonly binMs = 0.25,
    rangeMs = 200,
  ) {
    this.bins = new Array<number>(Math.ceil(rangeMs / binMs)).fill(0);
  }
  add(values: readonly number[]): void {
    for (const v of values) {
      this.n++;
      if (v > this.max) this.max = v;
      const k = Math.floor(v / this.binMs);
      if (k >= this.bins.length) this.overflow++;
      else this.bins[Math.max(0, k)]!++;
    }
  }
  /** value at quantile q (0..1), the upper edge of its bin (never below the true value by more than one bin) */
  quantile(q: number): number {
    if (this.n === 0) return 0;
    const target = Math.max(1, Math.ceil(q * this.n));
    let acc = 0;
    for (let k = 0; k < this.bins.length; k++) {
      acc += this.bins[k]!;
      if (acc >= target) return Math.min(this.max, (k + 1) * this.binMs);
    }
    return this.max;
  }
}

/** One sampling window of the run. */
export interface SoakSample {
  /** seconds since the measurement started */
  tSec: number;
  online: number;
  tick: Dist;
  /** ticks above the 50 ms budget in this window */
  overruns: number;
  tickIntervalP99: number;
  /** mean ms per tick in each phase (AOI averaged over AOI ticks) */
  stepMean: number;
  aoiMean: number;
  snapMean: number;
  aoiMax: number;
  /** per-player downstream KB/s (WS payload + frame header) and upstream */
  downKBps: Dist;
  upKBps: Dist;
  visibleMean: number;
  visibleMax: number;
  aoiEnterPerSec: number;
  heapMb: number;
  rssMb: number;
  /** server-side counters since the previous sample */
  kicks: number;
  disconnects: number;
  violations: number;
  castOk: number;
  castRejected: number;
  /** cumulative bot counters at the end of the window */
  bots: BotTotals;
}

export interface BotTotals {
  online: number;
  ended: number;
  reconnects: number;
  casts: number;
  castsAccepted: number;
  castsRefused: number;
  kills: number;
  deaths: number;
  chatSent: number;
  chatDelivered: number;
  partyInvitesSent: number;
  partyJoins: number;
  partyLeaves: number;
  bagClaims: number;
  pillsUsed: number;
  meditations: number;
  walked: number;
  /** bots whose NetClient reported an error text (decode / hook / session) */
  withErrors: number;
  rttP95: number;
}

export interface SoakConfig {
  bots: number;
  mode: string;
  durationS: number;
  warmupS: number;
  sampleS: number;
  mapTiles: number;
  areaTiles: number;
  mobs: number;
  store: string;
  workers: number;
  seed: number;
  node: string;
}

export interface Criterion {
  name: string;
  target: string;
  value: string;
  pass: boolean;
  /** informational: shown but never fails the run */
  info?: boolean;
}

export interface SoakSummary {
  config: SoakConfig;
  samples: number;
  tick: {
    p50: number;
    p95: number;
    p99: number;
    max: number;
    n: number;
    overruns: number;
    overrunPct: number;
    worstWindowP99: number;
  };
  tickIntervalP99Max: number;
  phases: { stepMean: number; aoiMean: number; aoiMax: number; snapMean: number };
  down: { meanKBps: number; p95KBps: number; maxKBps: number };
  up: { meanKBps: number; maxKBps: number };
  aoi: { visibleMean: number; visibleMax: number; enterPerSec: number };
  memory: {
    heapStartMb: number;
    heapEndMb: number;
    heapMaxMb: number;
    slopeMbPerH: number;
    driftPct: number;
    rssMaxMb: number;
    basis: string;
  };
  errors: {
    kicks: number;
    disconnects: number;
    violations: number;
    /** anti-cheat violation counters by kind (server metrics, whole run) */
    violationKinds: Record<string, number>;
    ended: number;
    reconnects: number;
    botsWithErrors: number;
  };
  activity: BotTotals;
  criteria: Criterion[];
}

const mean = (a: readonly number[]): number => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Least-squares slope of y over t (per hour when t is in seconds). */
export function slopePerHour(t: readonly number[], y: readonly number[]): number {
  const n = Math.min(t.length, y.length);
  if (n < 2) return 0;
  const mt = mean(t.slice(0, n));
  const my = mean(y.slice(0, n));
  let num = 0;
  let den = 0;
  for (let k = 0; k < n; k++) {
    num += (t[k]! - mt) * (y[k]! - my);
    den += (t[k]! - mt) ** 2;
  }
  return den > 0 ? (num / den) * 3600 : 0;
}

function median(a: readonly number[]): number {
  if (a.length === 0) return 0;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.floor(s.length / 2)]!;
}

/** Heap trend: median of the last quarter vs the median of the second quarter (the first quarter is warm-up / ramp). */
export function heapDrift(samples: readonly SoakSample[]): { driftPct: number; slopeMbPerH: number; basis: string } {
  if (samples.length < 8) return { driftPct: 0, slopeMbPerH: 0, basis: 'too few samples' };
  const q = Math.floor(samples.length / 4);
  const second = samples.slice(q, 2 * q).map((s) => s.heapMb);
  const last = samples.slice(samples.length - q).map((s) => s.heapMb);
  const base = median(second);
  const tail = samples.slice(q);
  return {
    driftPct: base > 0 ? ((median(last) - base) / base) * 100 : 0,
    slopeMbPerH: slopePerHour(
      tail.map((s) => s.tSec),
      tail.map((s) => s.heapMb),
    ),
    basis: 'median of the last quarter vs the second quarter',
  };
}

export function summarizeSoak(
  config: SoakConfig,
  samples: readonly SoakSample[],
  hist: TickHistogram,
  violationKinds: Record<string, number> = {},
): SoakSummary {
  const last = samples[samples.length - 1];
  const down = samples.map((s) => s.downKBps);
  const up = samples.map((s) => s.upKBps);
  const drift = heapDrift(samples);
  const overruns = samples.reduce((a, s) => a + s.overruns, 0);
  const heap = samples.map((s) => s.heapMb);
  const totals: BotTotals =
    last?.bots ??
    ({
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
    } satisfies BotTotals);
  const sum: SoakSummary = {
    config,
    samples: samples.length,
    tick: {
      p50: hist.quantile(0.5),
      p95: hist.quantile(0.95),
      p99: hist.quantile(0.99),
      max: hist.max,
      n: hist.n,
      overruns,
      overrunPct: hist.n ? (overruns / hist.n) * 100 : 0,
      worstWindowP99: Math.max(0, ...samples.map((s) => s.tick.p99)),
    },
    tickIntervalP99Max: Math.max(0, ...samples.map((s) => s.tickIntervalP99)),
    phases: {
      stepMean: mean(samples.map((s) => s.stepMean)),
      aoiMean: mean(samples.map((s) => s.aoiMean)),
      aoiMax: Math.max(0, ...samples.map((s) => s.aoiMax)),
      snapMean: mean(samples.map((s) => s.snapMean)),
    },
    down: {
      meanKBps: mean(down.map((d) => d.mean)),
      p95KBps: dist(down.map((d) => d.p95)).p95,
      maxKBps: Math.max(0, ...down.map((d) => d.max)),
    },
    up: { meanKBps: mean(up.map((d) => d.mean)), maxKBps: Math.max(0, ...up.map((d) => d.max)) },
    aoi: {
      visibleMean: mean(samples.map((s) => s.visibleMean)),
      visibleMax: Math.max(0, ...samples.map((s) => s.visibleMax)),
      enterPerSec: mean(samples.map((s) => s.aoiEnterPerSec)),
    },
    memory: {
      heapStartMb: heap[Math.min(heap.length - 1, Math.floor(heap.length / 4))] ?? 0,
      heapEndMb: heap[heap.length - 1] ?? 0,
      heapMaxMb: Math.max(0, ...heap),
      slopeMbPerH: drift.slopeMbPerH,
      driftPct: drift.driftPct,
      rssMaxMb: Math.max(0, ...samples.map((s) => s.rssMb)),
      basis: drift.basis,
    },
    errors: {
      kicks: samples.reduce((a, s) => a + s.kicks, 0),
      disconnects: samples.reduce((a, s) => a + s.disconnects, 0),
      violations: samples.reduce((a, s) => a + s.violations, 0),
      violationKinds: {},
      ended: totals.ended,
      reconnects: totals.reconnects,
      botsWithErrors: totals.withErrors,
    },
    activity: totals,
    criteria: [],
  };
  sum.errors.violationKinds = violationKinds;
  sum.criteria = criteriaOf(sum);
  return sum;
}

function criteriaOf(s: SoakSummary): Criterion[] {
  const f = (n: number, d = 2): string => n.toFixed(d);
  const c = s.config;
  const out: Criterion[] = [];
  out.push({
    name: 'CCU stable (every bot online at the end, none ended or kicked)',
    target: `${c.bots} bots`,
    value: `${s.activity.online}/${c.bots} online, ${s.errors.ended} ended, ${s.errors.kicks} kicks, ${s.errors.disconnects} server-side disconnects, ${s.errors.reconnects} reconnects`,
    pass: s.activity.online === c.bots && s.errors.ended === 0 && s.errors.kicks === 0 && s.errors.disconnects === 0,
  });
  out.push({
    name: 'tick p99',
    target: `<= ${BUDGETS.tickP99Ms} ms (20 Hz budget ${BUDGETS.tickBudgetMs} ms)`,
    value: `p50 ${f(s.tick.p50)}  p95 ${f(s.tick.p95)}  p99 ${f(s.tick.p99)}  max ${f(s.tick.max)} ms; worst window p99 ${f(s.tick.worstWindowP99)} ms; ${s.tick.overruns} ticks over ${BUDGETS.tickBudgetMs} ms (${f(s.tick.overrunPct, 3)}%)`,
    pass: s.tick.p99 <= BUDGETS.tickP99Ms,
  });
  out.push({
    name: 'downstream per player, mean over the run (WS payload + frame header)',
    target: `<= ${BUDGETS.downKBps} KB/s (monster-hunting budget)`,
    value: `mean ${f(s.down.meanKBps)}  p95 of windows ${f(s.down.p95KBps)}  worst player-window ${f(s.down.maxKBps)} KB/s`,
    pass: s.down.meanKBps <= BUDGETS.downKBps,
  });
  out.push({
    name: 'downstream per player, p95 of the windows',
    target: `<= ${BUDGETS.downKBps} KB/s`,
    value: `${f(s.down.p95KBps)} KB/s`,
    pass: s.down.p95KBps <= BUDGETS.downKBps,
  });
  out.push({
    name: 'upstream per player',
    target: `< ${BUDGETS.upKBps} KB/s`,
    value: `mean ${f(s.up.meanKBps)}  worst ${f(s.up.maxKBps)} KB/s`,
    pass: s.up.meanKBps < BUDGETS.upKBps,
  });
  out.push({
    name: 'entities sent per player',
    target: `<= ${BUDGETS.visibleMax} (Mobile / Web)`,
    value: `mean ${f(s.aoi.visibleMean, 1)}, max ${s.aoi.visibleMax}; enters ${f(s.aoi.enterPerSec)}/s per player`,
    pass: s.aoi.visibleMax <= BUDGETS.visibleMax,
  });
  out.push({
    name: 'heap stable (docs/28: +-5% after warm-up)',
    target: `drift <= ${BUDGETS.heapDrift * 100}%`,
    value: `${f(s.memory.driftPct, 1)}% (${s.memory.basis}); slope ${f(s.memory.slopeMbPerH, 1)} MB/h; heap ${f(s.memory.heapStartMb, 0)} -> ${f(s.memory.heapEndMb, 0)} MB, max ${f(s.memory.heapMaxMb, 0)}; RSS max ${f(s.memory.rssMaxMb, 0)} MB${c.durationS < 7200 ? ' (run shorter than 2 h: indicative)' : ''}`,
    pass: Math.abs(s.memory.driftPct) <= BUDGETS.heapDrift * 100,
  });
  out.push({
    name: 'no protocol violations / bot errors',
    target: '0',
    value: `${s.errors.violations} violations in the measured window${Object.keys(s.errors.violationKinds).length ? ` (server counters since start incl. ramp-up: ${JSON.stringify(s.errors.violationKinds)})` : ''}, ${s.errors.botsWithErrors} bots with an error text`,
    pass: s.errors.violations === 0 && s.errors.botsWithErrors === 0,
  });
  const a = s.activity;
  out.push({
    name: 'the bots actually played (casts, chat, kills when monsters exist)',
    target: 'casts > 0' + (c.mobs > 0 ? ', kills > 0' : '') + (c.durationS >= 120 ? ', chat delivered > 0' : ''),
    value: `${a.casts} casts (${a.castsAccepted} accepted, ${a.castsRefused} refused), ${a.kills} kills, ${a.deaths} deaths, ${a.chatDelivered}/${a.chatSent} chat, ${a.partyJoins} party joins, ${a.bagClaims} claims, ${a.pillsUsed} pills, ${a.meditations} meditations`,
    pass: a.casts > 0 && (c.mobs === 0 || a.kills > 0) && (c.durationS < 120 || a.chatDelivered > 0),
  });
  out.push({
    name: 'AOI cost (info)',
    target: 'reported',
    value: `AOI ${f(s.phases.aoiMean)} ms per AOI tick (max ${f(s.phases.aoiMax)}), sim step ${f(s.phases.stepMean)} ms, snapshot encode + send ${f(s.phases.snapMean)} ms per tick`,
    pass: true,
    info: true,
  });
  return out;
}

/**
 * The CI smoke gate: correctness and GROSS overruns only (a shared CI runner makes the design budgets meaningless): every bot online and
 * playing, no kicks / violations / errors, and a tick p99 no worse than `maxTickP99Ms`.
 */
export function gateFailures(s: SoakSummary, maxTickP99Ms: number): string[] {
  const fails: string[] = [];
  const crit = (name: string) => s.criteria.find((c) => c.name.startsWith(name));
  for (const n of ['CCU stable', 'no protocol violations', 'the bots actually played']) {
    const k = crit(n);
    if (k && !k.pass) fails.push(`${k.name}: ${k.value}`);
  }
  if (s.tick.p99 > maxTickP99Ms) fails.push(`tick p99 ${s.tick.p99.toFixed(2)} ms > gate ${maxTickP99Ms} ms`);
  return fails;
}

export function formatSoak(s: SoakSummary): string {
  const f = (n: number, d = 2): string => n.toFixed(d);
  const c = s.config;
  const lines: string[] = [];
  lines.push(
    `P5 load test: ${c.bots} gameplay bots (${c.mode}), ${c.durationS}s measured after ${c.warmupS}s ramp-up, ${s.samples} samples every ${c.sampleS}s, map ${c.mapTiles}, bots' area ${c.areaTiles}x${c.areaTiles}, ${c.mobs} mobs, store ${c.store}, ${c.workers} bot workers, node ${c.node}`,
  );
  lines.push('');
  lines.push(
    `tick duration ms   p50 ${f(s.tick.p50)}  p95 ${f(s.tick.p95)}  p99 ${f(s.tick.p99)}  max ${f(s.tick.max)}  (n=${s.tick.n}, over ${BUDGETS.tickBudgetMs} ms: ${s.tick.overruns} = ${f(s.tick.overrunPct, 3)}%, worst window p99 ${f(s.tick.worstWindowP99)}, worst interval p99 ${f(s.tickIntervalP99Max)})`,
  );
  lines.push(
    `tick breakdown ms  sim step ${f(s.phases.stepMean)}  AOI ${f(s.phases.aoiMean)} per AOI tick (max ${f(s.phases.aoiMax)})  snapshot encode+send ${f(s.phases.snapMean)}`,
  );
  lines.push(
    `down KB/s/player   mean ${f(s.down.meanKBps)}  p95 of windows ${f(s.down.p95KBps)}  worst ${f(s.down.maxKBps)}   up mean ${f(s.up.meanKBps)}  worst ${f(s.up.maxKBps)}`,
  );
  lines.push(
    `AOI visible        mean ${f(s.aoi.visibleMean, 1)}  max ${s.aoi.visibleMax}  enters ${f(s.aoi.enterPerSec)}/s per player`,
  );
  lines.push(
    `memory             heap ${f(s.memory.heapStartMb, 0)} -> ${f(s.memory.heapEndMb, 0)} MB (max ${f(s.memory.heapMaxMb, 0)}), drift ${f(s.memory.driftPct, 1)}%, slope ${f(s.memory.slopeMbPerH, 1)} MB/h, RSS max ${f(s.memory.rssMaxMb, 0)} MB`,
  );
  const a = s.activity;
  lines.push(
    `bots               online ${a.online}/${c.bots}, ended ${a.ended}, reconnects ${a.reconnects}, rtt p95 ${f(a.rttP95, 1)} ms; casts ${a.casts} (${a.castsAccepted} ok / ${a.castsRefused} refused), kills ${a.kills}, deaths ${a.deaths}, chat ${a.chatDelivered}/${a.chatSent}, party invites ${a.partyInvitesSent} joins ${a.partyJoins} leaves ${a.partyLeaves}, claims ${a.bagClaims}, pills ${a.pillsUsed}, meditations ${a.meditations}, walked ${f(a.walked, 0)} tiles`,
  );
  lines.push('');
  lines.push('criteria');
  for (const k of s.criteria)
    lines.push(`  [${k.info ? 'INFO' : k.pass ? 'PASS' : 'FAIL'}] ${k.name}: ${k.value}  (target ${k.target})`);
  return lines.join('\n');
}

/** One CSV line per sample (the time series of a run, for plotting / the docs). */
export function samplesCsv(samples: readonly SoakSample[]): string {
  const head =
    't_s,online,tick_p50,tick_p95,tick_p99,tick_max,overruns,interval_p99,step_ms,aoi_ms,snap_ms,down_mean,down_p95,down_max,up_mean,visible_mean,visible_max,enter_per_s,heap_mb,rss_mb,kicks,disconnects,violations,casts,kills,deaths';
  const rows = samples.map((s) =>
    [
      s.tSec.toFixed(0),
      s.online,
      s.tick.p50.toFixed(2),
      s.tick.p95.toFixed(2),
      s.tick.p99.toFixed(2),
      s.tick.max.toFixed(2),
      s.overruns,
      s.tickIntervalP99.toFixed(2),
      s.stepMean.toFixed(2),
      s.aoiMean.toFixed(2),
      s.snapMean.toFixed(2),
      s.downKBps.mean.toFixed(2),
      s.downKBps.p95.toFixed(2),
      s.downKBps.max.toFixed(2),
      s.upKBps.mean.toFixed(2),
      s.visibleMean.toFixed(1),
      s.visibleMax,
      s.aoiEnterPerSec.toFixed(2),
      s.heapMb.toFixed(1),
      s.rssMb.toFixed(0),
      s.kicks,
      s.disconnects,
      s.violations,
      s.bots.casts,
      s.bots.kills,
      s.bots.deaths,
    ].join(','),
  );
  return [head, ...rows].join('\n') + '\n';
}
