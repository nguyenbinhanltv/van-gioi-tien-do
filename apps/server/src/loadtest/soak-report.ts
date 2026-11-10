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
  sum = 0;
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
      this.sum += v;
      if (v > this.max) this.max = v;
      const k = Math.floor(v / this.binMs);
      if (k >= this.bins.length) this.overflow++;
      else this.bins[Math.max(0, k)]!++;
    }
  }
  mean(): number {
    return this.n ? this.sum / this.n : 0;
  }
  /** How many values fall in each bucket `(edges[k-1], edges[k]]`, plus one last bucket above the last edge (bin resolution applies). */
  counts(edges: readonly number[]): number[] {
    const out = new Array<number>(edges.length + 1).fill(0);
    for (let k = 0; k < this.bins.length; k++) {
      const c = this.bins[k]!;
      if (c === 0) continue;
      const hi = (k + 1) * this.binMs; // the upper edge of the bin
      let b = edges.findIndex((e) => hi <= e + 1e-9);
      if (b < 0) b = edges.length;
      out[b]! += c;
    }
    out[edges.length]! += this.overflow;
    return out;
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
/** File sizes of the file store at one sample (soak runs with `--store file`). */
export interface StoreSample {
  /** bytes per document file (`accounts.json`, ...), plus `journal.json` while it exists */
  docs: Record<string, number>;
  totalBytes: number;
  /** size of `journal.json` (0 = absent: the write-ahead journal is deleted when a commit finishes) */
  journalBytes: number;
  journalPresent: boolean;
  /** a commit's journal is still waiting to be finished after an error (`journalPending`) */
  journalPending: boolean;
}

/** One backup taken during the run (a separate process, like the `backup` operator command: it never blocks the game loop). */
export interface BackupSample {
  ok: boolean;
  /** time the backup itself took inside its process (reading the live documents, hashing, publishing, rotating) */
  ms: number;
  bytes: number;
  /** `verifyBackup` of the final backup passed (only set on the last one) */
  verified?: boolean;
  error?: string;
}

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
  /** event-loop delay of this window (perf_hooks.monitorEventLoopDelay, ms); absent in older series */
  loop?: { p50: number; p99: number; max: number };
  /** file-store sizes at this sample (file store only) */
  store?: StoreSample;
  /** a backup that finished since the previous sample, if any */
  backup?: BackupSample;
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

/**
 * Pass / fail thresholds of the soak harness itself (PROVISIONAL, harness settings, not game numbers): a long run exits non-zero when one is
 * crossed. Overridable on the command line (`--max-heap-slope-mb-h`, `--max-rss-slope-mb-h`, `--max-tick-p99-budget`, `--max-backup-s`).
 */
export interface SoakThresholds {
  /** heap growth after the warm-up quarter, MB per hour (after a GC) */
  heapSlopeMbPerH: number;
  /** RSS growth after the warm-up quarter, MB per hour */
  rssSlopeMbPerH: number;
  /** tick p99 budget in ms (default: the design budget) */
  tickP99Ms: number;
  /** longest acceptable backup, seconds */
  backupS: number;
  /** a journal present (or pending) in this many consecutive samples is "not compacting" */
  journalStuckSamples: number;
}

export const DEFAULT_THRESHOLDS: SoakThresholds = {
  heapSlopeMbPerH: 20,
  rssSlopeMbPerH: 40,
  tickP99Ms: BUDGETS.tickP99Ms,
  backupS: 15,
  journalStuckSamples: 3,
};

export interface SoakConfig {
  bots: number;
  /** thresholds in force (defaults when absent) */
  thresholds?: Partial<SoakThresholds>;
  /** minutes between backups (0 / absent = none) */
  backupEveryMin?: number;
  /** named preset the run started from (`smoke`, `full`) */
  preset?: string;
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

/** What the soak driver collected for the profile (D106); the pure report turns it into `SoakSummary.profile`. */
export interface ProfileInput {
  /** per tick phase (`WorldNode.profile`), whole run */
  phases: Record<string, TickHistogram>;
  /** ticks over the 50 ms budget, and how many of them each phase was the biggest of */
  slowTicks: number;
  slowBy: Record<string, number>;
  /** gap between consecutive tick starts (setTimeout drift + tick length), whole run */
  interval: TickHistogram;
  /** V8 GC pauses seen on the server thread (PerformanceObserver 'gc'), by kind */
  gc: Record<string, { count: number; totalMs: number; maxMs: number }>;
  /** event-loop delay percentiles (perf_hooks.monitorEventLoopDelay, ms) over the whole run */
  eventLoop: { p50: number; p99: number; max: number };
  /** synchronous file writes of the file stores (persistence/atomic.ts) */
  fileWrites: {
    /** writes that blocked the loop (whole sync writes + the commit renames of async ones) */
    count: number;
    totalMs: number;
    maxMs: number;
    /** document serialisation on the loop */
    serializeMs: number;
    serializeMaxMs: number;
    /** background writes (thread pool, off the loop) and their wall time */
    asyncCount: number;
    asyncTotalMs: number;
  };
  /** process CPU (user+system) as a share of one core over the measured run */
  cpuCores: number;
}

/** Bucket edges (ms) of the tick-time histogram in the report: the 20 Hz period is the 50 ms edge. */
export const TICK_BUCKETS_MS = [5, 10, 15, 20, 30, 40, 50, 75, 100, 150, 200] as const;

export interface ProfileSummary {
  phases: Array<{ phase: string; mean: number; p50: number; p99: number; max: number; slowBiggest: number }>;
  slowTicks: number;
  /** tick duration histogram: `counts[k]` ticks in `(edges[k-1], edges[k]]`, the last one above the last edge */
  histogram: { edgesMs: readonly number[]; counts: number[] };
  interval: { p50: number; p99: number; max: number };
  gc: { count: number; totalMs: number; maxMs: number; byKind: ProfileInput['gc'] };
  eventLoop: ProfileInput['eventLoop'];
  fileWrites: ProfileInput['fileWrites'];
  cpuCores: number;
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
    /** RSS slope after the warm-up quarter, MB per hour */
    rssSlopeMbPerH: number;
    basis: string;
  };
  /** event-loop delay over the windows (ms): the worst window p99 and max, and the mean of the window p99s; absent without per-window data */
  loop?: { meanP99: number; worstP99: number; max: number };
  /** file-store growth and journal health; absent without store samples */
  store?: StoreSummary;
  /** backups taken during the run; absent when none were attempted */
  backups?: BackupSummary;
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
  /** where the tick time goes (D106); absent when the driver did not profile */
  profile?: ProfileSummary;
}

export interface StoreSummary {
  samples: number;
  startMb: number;
  endMb: number;
  /** growth of the total size of the documents (journal included), MB per hour, whole run */
  growthMbPerH: number;
  /** growth per document, MB per hour (documents that grow at all) */
  growthByDoc: Record<string, number>;
  journal: {
    maxKb: number;
    /** samples that found the journal on disk */
    presentSamples: number;
    /** longest run of consecutive samples with a journal on disk or pending */
    longestRun: number;
    pendingAtEnd: boolean;
  };
}

export interface BackupSummary {
  count: number;
  failed: number;
  meanS: number;
  maxS: number;
  lastMb: number;
  /** the last backup passed `verifyBackup` (null = not checked) */
  lastVerified: boolean | null;
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

/** RSS trend: least-squares slope (MB per hour) over the samples after the warm-up quarter, like the heap slope. */
export function rssSlope(samples: readonly SoakSample[]): number {
  if (samples.length < 8) return 0;
  const tail = samples.slice(Math.floor(samples.length / 4));
  return slopePerHour(
    tail.map((s) => s.tSec),
    tail.map((s) => s.rssMb),
  );
}

/** Growth and journal health of the file store over a run; undefined when no sample carries store data. */
export function storeSummary(samples: readonly SoakSample[]): StoreSummary | undefined {
  const withStore = samples.filter((s): s is SoakSample & { store: StoreSample } => !!s.store);
  if (withStore.length === 0) return undefined;
  const mb = (b: number): number => b / 1048576;
  const t = withStore.map((s) => s.tSec);
  const growthByDoc: Record<string, number> = {};
  const names = new Set(withStore.flatMap((s) => Object.keys(s.store.docs)));
  names.delete('journal.json'); // the journal is reported on its own
  for (const n of names) {
    const g = slopePerHour(
      t,
      withStore.map((s) => mb(s.store.docs[n] ?? 0)),
    );
    if (g > 0) growthByDoc[n] = g;
  }
  let run = 0;
  let longest = 0;
  for (const s of withStore) {
    run = s.store.journalPresent || s.store.journalPending ? run + 1 : 0;
    longest = Math.max(longest, run);
  }
  const last = withStore[withStore.length - 1]!.store;
  return {
    samples: withStore.length,
    startMb: mb(withStore[0]!.store.totalBytes),
    endMb: mb(last.totalBytes),
    growthMbPerH: slopePerHour(
      t,
      withStore.map((s) => mb(s.store.totalBytes)),
    ),
    growthByDoc,
    journal: {
      maxKb: Math.max(0, ...withStore.map((s) => s.store.journalBytes)) / 1024,
      presentSamples: withStore.filter((s) => s.store.journalPresent).length,
      longestRun: longest,
      pendingAtEnd: last.journalPending,
    },
  };
}

/** Backups of a run; undefined when none were attempted. */
export function backupSummary(
  samples: readonly SoakSample[],
  extra: readonly BackupSample[] = [],
): BackupSummary | undefined {
  const b = [...samples.map((s) => s.backup).filter((x): x is BackupSample => !!x), ...extra];
  if (b.length === 0) return undefined;
  const ok = b.filter((x) => x.ok);
  const last = b[b.length - 1]!;
  return {
    count: b.length,
    failed: b.length - ok.length,
    meanS: mean(ok.map((x) => x.ms / 1000)),
    maxS: Math.max(0, ...ok.map((x) => x.ms / 1000)),
    lastMb: last.bytes / 1048576,
    lastVerified: last.verified ?? null,
  };
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
  profile?: ProfileInput,
  tickHist: TickHistogram = hist,
  /** backups that are not tied to a sample (the final, verified one) */
  extraBackups: readonly BackupSample[] = [],
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
      rssSlopeMbPerH: rssSlope(samples),
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
  const loops = samples.map((s) => s.loop).filter((x): x is NonNullable<SoakSample['loop']> => !!x);
  if (loops.length > 0)
    sum.loop = {
      meanP99: mean(loops.map((l) => l.p99)),
      worstP99: Math.max(0, ...loops.map((l) => l.p99)),
      max: Math.max(0, ...loops.map((l) => l.max)),
    };
  const store = storeSummary(samples);
  if (store) sum.store = store;
  const backups = backupSummary(samples, extraBackups);
  if (backups) sum.backups = backups;
  sum.errors.violationKinds = violationKinds;
  if (profile) sum.profile = profileOf(profile, tickHist);
  sum.criteria = criteriaOf(sum);
  return sum;
}

function profileOf(p: ProfileInput, ticks: TickHistogram): ProfileSummary {
  const gcAll = Object.values(p.gc);
  return {
    phases: Object.entries(p.phases).map(([phase, h]) => ({
      phase,
      mean: h.mean(),
      p50: h.quantile(0.5),
      p99: h.quantile(0.99),
      max: h.max,
      slowBiggest: p.slowBy[phase] ?? 0,
    })),
    slowTicks: p.slowTicks,
    histogram: { edgesMs: TICK_BUCKETS_MS, counts: ticks.counts(TICK_BUCKETS_MS) },
    interval: { p50: p.interval.quantile(0.5), p99: p.interval.quantile(0.99), max: p.interval.max },
    gc: {
      count: gcAll.reduce((a, g) => a + g.count, 0),
      totalMs: gcAll.reduce((a, g) => a + g.totalMs, 0),
      maxMs: Math.max(0, ...gcAll.map((g) => g.maxMs)),
      byKind: p.gc,
    },
    eventLoop: p.eventLoop,
    fileWrites: p.fileWrites,
    cpuCores: p.cpuCores,
  };
}

function criteriaOf(s: SoakSummary): Criterion[] {
  const f = (n: number, d = 2): string => n.toFixed(d);
  const c = s.config;
  const th: SoakThresholds = { ...DEFAULT_THRESHOLDS, ...c.thresholds };
  const out: Criterion[] = [];
  out.push({
    name: 'CCU stable (every bot online at the end, none ended or kicked)',
    target: `${c.bots} bots`,
    value: `${s.activity.online}/${c.bots} online, ${s.errors.ended} ended, ${s.errors.kicks} kicks, ${s.errors.disconnects} server-side disconnects, ${s.errors.reconnects} reconnects`,
    pass: s.activity.online === c.bots && s.errors.ended === 0 && s.errors.kicks === 0 && s.errors.disconnects === 0,
  });
  out.push({
    name: 'tick p99',
    target: `<= ${th.tickP99Ms} ms (20 Hz budget ${BUDGETS.tickBudgetMs} ms)`,
    value: `p50 ${f(s.tick.p50)}  p95 ${f(s.tick.p95)}  p99 ${f(s.tick.p99)}  max ${f(s.tick.max)} ms; worst window p99 ${f(s.tick.worstWindowP99)} ms; ${s.tick.overruns} ticks over ${BUDGETS.tickBudgetMs} ms (${f(s.tick.overrunPct, 3)}%)`,
    pass: s.tick.p99 <= th.tickP99Ms,
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
  // growth slopes: only judged on a run long enough for a slope to mean something (10 min) and with enough samples; shorter runs are informational
  const slopeJudged = c.durationS >= 600 && s.samples >= 8;
  const short = slopeJudged ? '' : ' (run too short: informational)';
  out.push({
    name: 'heap growth slope',
    target: `<= ${th.heapSlopeMbPerH} MB/h after warm-up${short}`,
    value: `${f(s.memory.slopeMbPerH, 1)} MB/h (${s.memory.basis}); heap ${f(s.memory.heapStartMb, 0)} -> ${f(s.memory.heapEndMb, 0)} MB`,
    pass: !slopeJudged || s.memory.slopeMbPerH <= th.heapSlopeMbPerH,
    ...(slopeJudged ? {} : { info: true }),
  });
  out.push({
    name: 'RSS growth slope',
    target: `<= ${th.rssSlopeMbPerH} MB/h after warm-up${short}`,
    value: `${f(s.memory.rssSlopeMbPerH, 1)} MB/h; RSS max ${f(s.memory.rssMaxMb, 0)} MB`,
    pass: !slopeJudged || s.memory.rssSlopeMbPerH <= th.rssSlopeMbPerH,
    ...(slopeJudged ? {} : { info: true }),
  });
  if (s.store) {
    const j = s.store.journal;
    const stuck = j.longestRun >= th.journalStuckSamples || j.pendingAtEnd;
    out.push({
      name: 'journal compacts (the write-ahead journal is deleted when a commit finishes)',
      target: `never on disk or pending in ${th.journalStuckSamples} consecutive samples, none pending at the end`,
      value: `on disk in ${j.presentSamples}/${s.store.samples} samples, longest run ${j.longestRun}, max ${f(j.maxKb, 1)} KB, ${j.pendingAtEnd ? 'PENDING at the end' : 'none pending at the end'}`,
      pass: !stuck,
    });
    const byDoc = Object.entries(s.store.growthByDoc)
      .map(([n, g]) => `${n} ${f(g, 2)}`)
      .join(', ');
    out.push({
      name: 'file-store growth (info)',
      target: 'reported',
      value: `${f(s.store.startMb, 2)} -> ${f(s.store.endMb, 2)} MB, ${f(s.store.growthMbPerH, 2)} MB/h${byDoc ? `; by document ${byDoc} MB/h` : ''}`,
      pass: true,
      info: true,
    });
  }
  if (s.backups) {
    const b = s.backups;
    out.push({
      name: 'backups (each one succeeds within the time limit; the last one verifies)',
      target: `<= ${th.backupS} s each, 0 failures${b.lastVerified === null ? '' : ', last verified'}`,
      value: `${b.count} taken, ${b.failed} failed, mean ${f(b.meanS, 2)} s, max ${f(b.maxS, 2)} s, last ${f(b.lastMb, 2)} MB, last verified ${b.lastVerified === null ? 'not checked' : b.lastVerified}`,
      pass: b.failed === 0 && b.maxS <= th.backupS && b.lastVerified !== false,
    });
  }
  if (s.loop)
    out.push({
      name: 'event-loop lag (info)',
      target: 'reported',
      value: `window p99 mean ${f(s.loop.meanP99)} ms, worst ${f(s.loop.worstP99)} ms, max ${f(s.loop.max)} ms`,
      pass: true,
      info: true,
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
/** Violation kinds the CI gate tolerates (docs/35 §3.2, OPEN-ITEMS "P5 load test"): still reported in the report. */
export const GATE_EXEMPT_VIOLATIONS: readonly string[] = ['cooldown'];

export function gateFailures(s: SoakSummary, maxTickP99Ms: number): string[] {
  const fails: string[] = [];
  const crit = (name: string) => s.criteria.find((c) => c.name.startsWith(name));
  for (const n of ['CCU stable', 'the bots actually played']) {
    const k = crit(n);
    if (k && !k.pass) fails.push(`${k.name}: ${k.value}`);
  }
  // Violations: every kind an honest bot cannot trigger fails the gate. `cooldown` is reported but NOT gated while docs/35 §3.2 is open
  // (honest bots still get a few when the server stalls; a shared CI runner stalls more than a dev box). Remove GATE_EXEMPT_VIOLATIONS
  // once that is resolved. Counts are the server's whole-run counters by kind (ramp-up included: the CI smoke has no violations to hide).
  const gated = Object.entries(s.errors.violationKinds).filter(([kind]) => !GATE_EXEMPT_VIOLATIONS.includes(kind));
  const gatedCount = gated.reduce((a, [, n]) => a + n, 0);
  if (gatedCount > 0) fails.push(`protocol violations: ${gated.map(([k, n]) => `${k} ${n}`).join(', ')}`);
  if (s.errors.botsWithErrors > 0) fails.push(`${s.errors.botsWithErrors} bots with an error text`);
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
  if (s.loop)
    lines.push(
      `event loop         window p99 mean ${f(s.loop.meanP99)} ms, worst ${f(s.loop.worstP99)} ms, max ${f(s.loop.max)} ms`,
    );
  if (s.store)
    lines.push(
      `file store         ${f(s.store.startMb, 2)} -> ${f(s.store.endMb, 2)} MB (${f(s.store.growthMbPerH, 2)} MB/h); journal on disk in ${s.store.journal.presentSamples}/${s.store.samples} samples, longest run ${s.store.journal.longestRun}, max ${f(s.store.journal.maxKb, 1)} KB${s.store.journal.pendingAtEnd ? ', PENDING at the end' : ''}`,
    );
  if (s.backups)
    lines.push(
      `backups            ${s.backups.count} taken, ${s.backups.failed} failed, mean ${f(s.backups.meanS, 2)} s, max ${f(s.backups.maxS, 2)} s, last ${f(s.backups.lastMb, 2)} MB, verified ${s.backups.lastVerified === null ? 'not checked' : s.backups.lastVerified}`,
    );
  const a = s.activity;
  lines.push(
    `bots               online ${a.online}/${c.bots}, ended ${a.ended}, reconnects ${a.reconnects}, rtt p95 ${f(a.rttP95, 1)} ms; casts ${a.casts} (${a.castsAccepted} ok / ${a.castsRefused} refused), kills ${a.kills}, deaths ${a.deaths}, chat ${a.chatDelivered}/${a.chatSent}, party invites ${a.partyInvitesSent} joins ${a.partyJoins} leaves ${a.partyLeaves}, claims ${a.bagClaims}, pills ${a.pillsUsed}, meditations ${a.meditations}, walked ${f(a.walked, 0)} tiles`,
  );
  if (s.profile) lines.push(...formatProfile(s.profile));
  lines.push('');
  lines.push('criteria');
  for (const k of s.criteria)
    lines.push(`  [${k.info ? 'INFO' : k.pass ? 'PASS' : 'FAIL'}] ${k.name}: ${k.value}  (target ${k.target})`);
  return lines.join('\n');
}

function formatProfile(p: ProfileSummary): string[] {
  const f = (n: number, d = 2): string => n.toFixed(d);
  const out: string[] = [
    '',
    `tick profile (ms per tick; "slow" = ticks over ${BUDGETS.tickBudgetMs} ms, ${p.slowTicks} in total, split by their biggest phase)`,
  ];
  for (const k of p.phases)
    out.push(
      `  ${k.phase.padEnd(7)} mean ${f(k.mean).padStart(6)}  p50 ${f(k.p50).padStart(6)}  p99 ${f(k.p99).padStart(7)}  max ${f(k.max).padStart(7)}   biggest phase of ${String(k.slowBiggest).padStart(4)} slow ticks`,
    );
  const e = p.histogram.edgesMs;
  const labels = [...e.map((x, k) => `${k === 0 ? 0 : e[k - 1]}-${x}`), `>${e[e.length - 1]}`];
  out.push(`  tick histogram (ms: ticks)  ${labels.map((l, k) => `${l}: ${p.histogram.counts[k]}`).join('  ')}`);
  out.push(
    `  tick start interval  p50 ${f(p.interval.p50)}  p99 ${f(p.interval.p99)}  max ${f(p.interval.max)}  (setTimeout drift + tick length; the period is ${BUDGETS.tickBudgetMs})`,
  );
  out.push(`  event loop delay     p50 ${f(p.eventLoop.p50)}  p99 ${f(p.eventLoop.p99)}  max ${f(p.eventLoop.max)}`);
  const kinds = Object.entries(p.gc.byKind)
    .map(([k, g]) => `${k} ${g.count}x max ${f(g.maxMs)}`)
    .join(', ');
  out.push(
    `  GC pauses            ${p.gc.count} totalling ${f(p.gc.totalMs)} ms, max ${f(p.gc.maxMs)} ms${kinds ? ` (${kinds})` : ''}`,
  );
  out.push(
    `  file-store writes    on the loop: ${p.fileWrites.count} commits totalling ${f(p.fileWrites.totalMs)} ms (max ${f(p.fileWrites.maxMs)}) + serialising ${f(p.fileWrites.serializeMs)} ms (max ${f(p.fileWrites.serializeMaxMs)}); off the loop: ${p.fileWrites.asyncCount} background writes, ${f(p.fileWrites.asyncTotalMs)} ms wall`,
  );
  out.push(`  process CPU          ${f(p.cpuCores)} cores busy on average (server + bots share the machine)`);
  return out;
}

/** One CSV line per sample (the time series of a run, for plotting / the docs). */
export function samplesCsv(samples: readonly SoakSample[]): string {
  const head =
    't_s,online,tick_p50,tick_p95,tick_p99,tick_max,overruns,interval_p99,step_ms,aoi_ms,snap_ms,down_mean,down_p95,down_max,up_mean,visible_mean,visible_max,enter_per_s,heap_mb,rss_mb,kicks,disconnects,violations,casts,kills,deaths,loop_p50_ms,loop_p99_ms,loop_max_ms,store_mb,journal_kb,journal_present,backup_ms,backup_ok';
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
      s.loop ? s.loop.p50.toFixed(2) : '',
      s.loop ? s.loop.p99.toFixed(2) : '',
      s.loop ? s.loop.max.toFixed(2) : '',
      s.store ? (s.store.totalBytes / 1048576).toFixed(3) : '',
      s.store ? (s.store.journalBytes / 1024).toFixed(1) : '',
      s.store ? (s.store.journalPresent ? 1 : 0) : '',
      s.backup ? s.backup.ms.toFixed(0) : '',
      s.backup ? (s.backup.ok ? 1 : 0) : '',
    ].join(','),
  );
  return [head, ...rows].join('\n') + '\n';
}
