import { describe, expect, it } from 'vitest';
import { dist } from '../src/loadtest/stats.js';
import {
  BUDGETS,
  TickHistogram,
  formatSoak,
  gateFailures,
  heapDrift,
  samplesCsv,
  slopePerHour,
  summarizeSoak,
  type BotTotals,
  type SoakConfig,
  type SoakSample,
} from '../src/loadtest/soak-report.js';

const totals = (o: Partial<BotTotals> = {}): BotTotals => ({
  online: 20,
  ended: 0,
  reconnects: 0,
  casts: 100,
  castsAccepted: 90,
  castsRefused: 10,
  kills: 12,
  deaths: 2,
  chatSent: 5,
  chatDelivered: 5,
  partyInvitesSent: 3,
  partyJoins: 2,
  partyLeaves: 1,
  bagClaims: 1,
  pillsUsed: 0,
  meditations: 4,
  walked: 500,
  withErrors: 0,
  rttP95: 3,
  ...o,
});

const sample = (t: number, o: Partial<SoakSample> = {}): SoakSample => ({
  tSec: t,
  online: 20,
  tick: dist([1, 2, 3, 4, 5]),
  overruns: 0,
  tickIntervalP99: 51,
  stepMean: 0.3,
  aoiMean: 0.4,
  snapMean: 0.8,
  aoiMax: 3,
  downKBps: dist([1, 2, 3]),
  upKBps: dist([0.2, 0.3]),
  visibleMean: 15,
  visibleMax: 40,
  aoiEnterPerSec: 0.5,
  heapMb: 100,
  rssMb: 200,
  kicks: 0,
  disconnects: 0,
  violations: 0,
  castOk: 10,
  castRejected: 1,
  bots: totals(),
  ...o,
});

const config = (o: Partial<SoakConfig> = {}): SoakConfig => ({
  bots: 20,
  mode: 'short soak',
  durationS: 600,
  warmupS: 20,
  sampleS: 15,
  mapTiles: 256,
  areaTiles: 96,
  mobs: 100,
  store: 'file',
  workers: 1,
  seed: 1,
  node: 'v22',
  ...o,
});

const series = (n: number, o: (k: number) => Partial<SoakSample> = () => ({})): SoakSample[] =>
  Array.from({ length: n }, (_, k) => sample(k * 15, o(k)));

const played = (s: ReturnType<typeof summarizeSoak>) =>
  s.criteria.find((c) => c.name.startsWith('the bots actually played'))!;

describe('TickHistogram', () => {
  it('reports quantiles within one bin of the exact value, the true max, and resolves the overflow bin to the max', () => {
    const h = new TickHistogram(0.25, 100);
    const vals = Array.from({ length: 1000 }, (_, k) => (k % 100) * 0.4 + 0.1); // 0.1 .. 39.7
    h.add(vals);
    const sorted = [...vals].sort((a, b) => a - b);
    for (const q of [0.5, 0.95, 0.99]) {
      const exact = sorted[Math.ceil(q * sorted.length) - 1]!;
      expect(Math.abs(h.quantile(q) - exact)).toBeLessThanOrEqual(0.25 + 1e-9);
    }
    expect(h.n).toBe(1000);
    h.add([500]);
    expect(h.max).toBe(500);
    expect(h.quantile(1)).toBe(500);
    expect(new TickHistogram().quantile(0.99)).toBe(0);
  });
});

describe('heap trend', () => {
  it('slopePerHour is the least-squares slope scaled to an hour', () => {
    expect(slopePerHour([0, 3600], [10, 14])).toBeCloseTo(4, 10);
    expect(slopePerHour([0, 10, 20], [5, 5, 5])).toBe(0);
    expect(slopePerHour([0], [1])).toBe(0);
  });
  it('a flat heap has no drift; a steady leak shows up as a percentage and a slope; too few samples are said to be too few', () => {
    expect(heapDrift(series(40)).driftPct).toBe(0);
    const leak = heapDrift(series(40, (k) => ({ heapMb: 100 + k * 2 })));
    expect(leak.driftPct).toBeGreaterThan(30);
    expect(leak.slopeMbPerH).toBeGreaterThan(0);
    expect(heapDrift(series(4)).basis).toBe('too few samples');
  });
});

const tickHist = (v: number[]): TickHistogram => {
  const h = new TickHistogram();
  h.add(v);
  return h;
};

describe('summarizeSoak / criteria', () => {
  const run = (samples: SoakSample[], cfg = config(), ticks: number[] = [1, 2, 3, 40]) => {
    const h = new TickHistogram();
    h.add(ticks);
    return summarizeSoak(cfg, samples, h, { cooldown: 2 });
  };

  it('a healthy run passes every criterion and aggregates the series', () => {
    const s = run(series(40));
    expect(s.criteria.filter((c) => !c.pass)).toEqual([]);
    expect(s.samples).toBe(40);
    expect(s.down.meanKBps).toBeCloseTo(2, 5);
    expect(s.aoi.visibleMax).toBe(40);
    expect(s.activity.casts).toBe(100);
    expect(s.errors.violationKinds).toEqual({ cooldown: 2 });
  });

  it('flags each exceeded budget by name: tick p99, downstream, upstream, entities, heap drift, violations, dropped bots', () => {
    const bad = run(
      series(40, (k) => ({
        downKBps: dist([9, 10, 12]),
        upKBps: dist([1.5, 2]),
        visibleMax: 150,
        heapMb: 100 + k * 3,
        violations: k === 0 ? 3 : 0,
        bots: totals({ online: 18, ended: 2 }),
      })),
      config(),
      Array.from({ length: 200 }, (_, k) => (k < 150 ? 5 : 80)),
    );
    const failed = bad.criteria.filter((c) => !c.pass).map((c) => c.name);
    expect(failed).toEqual(
      expect.arrayContaining([
        expect.stringContaining('CCU stable'),
        'tick p99',
        expect.stringContaining('downstream per player, mean'),
        'upstream per player',
        'entities sent per player',
        expect.stringContaining('heap stable'),
        'no protocol violations / bot errors',
      ]),
    );
    expect(BUDGETS.tickP99Ms).toBe(40);
  });

  it('the activity criterion needs casts, kills (with monsters) and chat (runs of 2+ minutes)', () => {
    expect(played(run(series(40, () => ({ bots: totals({ casts: 0 }) })))).pass).toBe(false);
    expect(played(run(series(40, () => ({ bots: totals({ kills: 0 }) })))).pass).toBe(false);
    expect(played(run(series(40, () => ({ bots: totals({ chatDelivered: 0 }) })))).pass).toBe(false);
    // a 60 s smoke has no chat requirement, and no kills are needed without monsters
    const smoke = run(
      series(12, () => ({ bots: totals({ chatDelivered: 0, kills: 0 }) })),
      config({ durationS: 60, mobs: 0 }),
    );
    expect(played(smoke).pass).toBe(true);
  });

  it('the CI gate fails only on correctness and gross tick overruns, not on the design budgets', () => {
    // over the design downstream budget and tick p99 40 ms but under the gross gate: the gate passes
    const slow = run(
      series(12, () => ({ downKBps: dist([9, 10]) })),
      config({ durationS: 60, mobs: 0 }),
      Array.from({ length: 100 }, (_, k) => (k < 97 ? 3 : 60)),
    );
    expect(slow.criteria.some((c) => !c.pass)).toBe(true);
    expect(gateFailures(slow, 100)).toEqual([]);
    expect(gateFailures(slow, 30)).toEqual([expect.stringContaining('tick p99')]);
    // violation kinds: cooldown (honest bots get a few on a stalling server, docs/35 §3.2) passes the gate, every other kind fails it
    const withKinds = (kinds: Record<string, number>) =>
      summarizeSoak(config({ durationS: 60, mobs: 0 }), series(12), tickHist([1, 2, 3]), kinds);
    expect(gateFailures(withKinds({ cooldown: 500 }), 100)).toEqual([]);
    expect(gateFailures(withKinds({ cooldown: 500, budget: 1 }), 100).join('|')).toContain('budget 1');
    expect(gateFailures(withKinds({ distance: 2 }), 100).join('|')).toContain('distance 2');
    const broken = run(
      series(12, () => ({ bots: totals({ online: 19, ended: 1 }) })),
      config({ durationS: 60, mobs: 0 }),
    );
    expect(gateFailures(broken, 100).join('|')).toContain('CCU stable');
  });
});

describe('report text and series', () => {
  it('the text report has the headline numbers and one PASS / FAIL / INFO line per criterion; the CSV has a header and a row per sample', () => {
    const h = new TickHistogram();
    h.add([1, 2, 3]);
    const s = summarizeSoak(config(), series(10), h);
    const text = formatSoak(s);
    expect(text).toContain('P5 load test: 20 gameplay bots');
    expect(text).toContain('tick duration ms');
    expect(text).toContain('down KB/s/player');
    expect(text).toContain('memory');
    expect(text.match(/\[(PASS|FAIL|INFO)\]/g)).toHaveLength(s.criteria.length);
    const csv = samplesCsv(series(3)).trim().split('\n');
    expect(csv).toHaveLength(4);
    expect(csv[0]).toContain('tick_p99');
    expect(csv[1]!.split(',')).toHaveLength(csv[0]!.split(',').length);
  });
});

describe('tick profile (D106)', () => {
  it('counts the tick-time histogram in buckets, the last one above the last edge', () => {
    const h = new TickHistogram(0.25, 100);
    h.add([1, 4.9, 5.1, 12, 49, 51, 130, 500]);
    // edges 5, 10, 50, 100: (0,5] 2 values, (5,10] 1, (10,50] 2, (50,100] 1, above 100: 2
    expect(h.counts([5, 10, 50, 100])).toEqual([2, 1, 2, 1, 2]);
    expect(h.mean()).toBeCloseTo((1 + 4.9 + 5.1 + 12 + 49 + 51 + 130 + 500) / 8, 6);
  });

  it('the report carries the per-phase table, the histogram, GC, event-loop delay and file-write cost', () => {
    const h = new TickHistogram();
    h.add([5, 6, 7, 60, 120]);
    const phase = (v: number[]) => {
      const x = new TickHistogram(0.1, 200);
      x.add(v);
      return x;
    };
    const interval = new TickHistogram(1, 2000);
    interval.add([50, 51, 400]);
    const s = summarizeSoak(
      config(),
      series(10),
      h,
      {},
      {
        phases: { sim: phase([1, 1, 2]), snap: phase([3, 3, 90]) },
        slowTicks: 2,
        slowBy: { sim: 0, snap: 2 },
        interval,
        gc: { scavenge: { count: 10, totalMs: 12, maxMs: 3 }, major: { count: 1, totalMs: 9, maxMs: 9 } },
        eventLoop: { p50: 11, p99: 40, max: 300 },
        fileWrites: {
          count: 5,
          totalMs: 20,
          maxMs: 9,
          serializeMs: 4,
          serializeMaxMs: 2,
          asyncCount: 5,
          asyncTotalMs: 300,
        },
        cpuCores: 1.5,
      },
    );
    expect(s.profile!.phases.find((p) => p.phase === 'snap')).toMatchObject({ slowBiggest: 2, max: 90 });
    expect(s.profile!.gc).toMatchObject({ count: 11, totalMs: 21, maxMs: 9 });
    expect(s.profile!.histogram.counts.reduce((a, b) => a + b, 0)).toBe(5);
    const text = formatSoak(s);
    for (const part of [
      'tick profile',
      'snap',
      'tick histogram',
      'event loop delay',
      'GC pauses',
      'file-store writes',
      'process CPU',
    ])
      expect(text).toContain(part);
    expect(formatSoak(summarizeSoak(config(), series(10), h))).not.toContain('tick profile'); // no profile, no section
  });
});

describe('soak extensions: growth slopes, journal, backups, event-loop lag', () => {
  const run = (samples: SoakSample[], cfg = config()) => {
    const h = new TickHistogram();
    h.add([1, 2, 3, 4]);
    return summarizeSoak(cfg, samples, h, {});
  };
  const crit = (s: ReturnType<typeof summarizeSoak>, prefix: string) =>
    s.criteria.find((c) => c.name.startsWith(prefix));
  const store = (o: Partial<NonNullable<SoakSample['store']>> = {}): NonNullable<SoakSample['store']> => ({
    docs: { 'ledger.json': 1000, 'inventories.json': 2000 },
    totalBytes: 3000,
    journalBytes: 0,
    journalPresent: false,
    journalPending: false,
    ...o,
  });

  it('a steady heap / RSS leak fails the slope criteria once the run is long enough; a short run only reports it', () => {
    // 40 samples x 15 s = 600 s: +0.05 MB per sample on the heap (12 MB/h) and +0.5 MB on the RSS (120 MB/h)
    const leak = (k: number) => ({ heapMb: 100 + k * 0.05, rssMb: 200 + k * 0.5 });
    const s = run(series(40, leak));
    expect(crit(s, 'heap growth slope')!.pass).toBe(true); // 12 MB/h <= 20
    const rss = crit(s, 'RSS growth slope')!;
    expect(rss.pass).toBe(false);
    expect(rss.info).toBeUndefined();
    expect(s.memory.rssSlopeMbPerH).toBeCloseTo(120, 0);
    // thresholds come from the config
    const tight = run(series(40, leak), config({ thresholds: { heapSlopeMbPerH: 5 } }));
    expect(crit(tight, 'heap growth slope')!.pass).toBe(false);
    // a run under 10 minutes is informational: never fails
    const short = run(series(40, leak), config({ durationS: 300 }));
    expect(crit(short, 'RSS growth slope')!.pass).toBe(true);
    expect(crit(short, 'RSS growth slope')!.info).toBe(true);
  });

  it('the journal criterion fails when a journal stays on disk (or pending) for N consecutive samples, or is pending at the end', () => {
    const healthy = run(series(20, () => ({ store: store() })));
    expect(crit(healthy, 'journal compacts')!.pass).toBe(true);
    expect(healthy.store!.journal.presentSamples).toBe(0);
    // one stray journal seen once is a commit caught in the act: fine
    const blip = run(
      series(20, (k) => ({ store: store(k === 7 ? { journalPresent: true, journalBytes: 4096 } : {}) })),
    );
    expect(crit(blip, 'journal compacts')!.pass).toBe(true);
    expect(blip.store!.journal.maxKb).toBe(4);
    // three in a row: not compacting
    const stuck = run(
      series(20, (k) => ({ store: store(k >= 5 && k < 8 ? { journalPresent: true, journalBytes: 4096 } : {}) })),
    );
    expect(crit(stuck, 'journal compacts')!.pass).toBe(false);
    expect(stuck.store!.journal.longestRun).toBe(3);
    // the stuck-run length is a threshold
    const lenient = run(
      series(20, (k) => ({ store: store(k >= 5 && k < 8 ? { journalPresent: true } : {}) })),
      config({ thresholds: { journalStuckSamples: 4 } }),
    );
    expect(crit(lenient, 'journal compacts')!.pass).toBe(true);
    // pending after the last write: not compacting
    const pending = run(series(20, (k) => ({ store: store(k === 19 ? { journalPending: true } : {}) })));
    expect(crit(pending, 'journal compacts')!.pass).toBe(false);
    expect(pending.store!.journal.pendingAtEnd).toBe(true);
  });

  it('store growth is reported per document, in MB per hour', () => {
    // ledger.json grows 36 KB per 15 s sample = 8.4 MB/h
    const s = run(
      series(20, (k) => ({
        store: store({
          docs: { 'ledger.json': 1000 + k * 36 * 1024, 'inventories.json': 2000 },
          totalBytes: 3000 + k * 36 * 1024,
        }),
      })),
    );
    expect(s.store!.growthByDoc['ledger.json']).toBeGreaterThan(8);
    expect(s.store!.growthByDoc['inventories.json']).toBeUndefined(); // flat
    expect(crit(s, 'file-store growth')!.info).toBe(true);
    expect(run(series(20)).store).toBeUndefined(); // the memory store has no files
    expect(crit(run(series(20)), 'journal compacts')).toBeUndefined();
  });

  it('backups: a failure, a slow one or a final one that does not verify fails the run; none taken adds no criterion', () => {
    const ok = { ok: true, ms: 800, bytes: 3 * 1048576 };
    const withB = (b: Partial<SoakSample>[]) => series(20, (k) => b[k] ?? {});
    const good = run(withB([{}, { backup: ok }, {}, { backup: { ...ok, ms: 1200 } }]));
    expect(crit(good, 'backups')!.pass).toBe(true);
    expect(good.backups).toMatchObject({ count: 2, failed: 0, maxS: 1.2, lastVerified: null });
    expect(crit(run(series(20)), 'backups')).toBeUndefined();
    const failed = run(withB([{ backup: ok }, { backup: { ok: false, ms: 0, bytes: 0, error: 'disk full' } }]));
    expect(crit(failed, 'backups')!.pass).toBe(false);
    const slow = run(withB([{ backup: { ...ok, ms: 20_000 } }]));
    expect(crit(slow, 'backups')!.pass).toBe(false);
    const lenient = run(withB([{ backup: { ...ok, ms: 20_000 } }]), config({ thresholds: { backupS: 30 } }));
    expect(crit(lenient, 'backups')!.pass).toBe(true);
    // the final backup is not tied to a sample and carries the verification
    const h = new TickHistogram();
    h.add([1]);
    const fin = summarizeSoak(config(), series(20), h, {}, undefined, h, [{ ...ok, verified: false }]);
    expect(crit(fin, 'backups')!.pass).toBe(false);
    expect(fin.backups!.lastVerified).toBe(false);
    const fin2 = summarizeSoak(config(), series(20), h, {}, undefined, h, [{ ...ok, verified: true }]);
    expect(crit(fin2, 'backups')!.pass).toBe(true);
  });

  it('the tick p99 budget is a threshold, and event-loop lag per window is summarised', () => {
    const slowTicks = series(20, () => ({ tick: dist([30, 35, 45, 50]) }));
    const h = new TickHistogram();
    h.add([30, 35, 45, 50]);
    const strict = summarizeSoak(config(), slowTicks, h, {});
    expect(crit(strict, 'tick p99')!.pass).toBe(false);
    const lenient = summarizeSoak(config({ thresholds: { tickP99Ms: 80 } }), slowTicks, h, {});
    expect(crit(lenient, 'tick p99')!.pass).toBe(true);
    const lag = run(series(10, (k) => ({ loop: { p50: 10, p99: 12 + k, max: 20 + k } })));
    expect(lag.loop).toEqual({ meanP99: 16.5, worstP99: 21, max: 29 });
    expect(run(series(10)).loop).toBeUndefined();
  });

  it('the CSV and the text report carry the new columns and lines; old series still render', () => {
    const rows = samplesCsv(
      series(3, (k) => ({
        loop: { p50: 10, p99: 12, max: 30 },
        store: store({ journalPresent: k === 1, journalBytes: k === 1 ? 2048 : 0 }),
        ...(k === 2 ? { backup: { ok: true, ms: 900, bytes: 10 } } : {}),
      })),
    )
      .trim()
      .split('\n');
    const head = rows[0]!.split(',');
    for (const col of ['loop_p99_ms', 'store_mb', 'journal_kb', 'journal_present', 'backup_ms', 'backup_ok'])
      expect(head).toContain(col);
    expect(rows[1]!.split(',')).toHaveLength(head.length);
    expect(rows[3]!.split(',')[head.indexOf('backup_ms')]).toBe('900');
    expect(rows[2]!.split(',')[head.indexOf('journal_present')]).toBe('1');
    const old = samplesCsv(series(2)).trim().split('\n');
    expect(old[1]!.split(',')).toHaveLength(old[0]!.split(',').length); // missing fields are empty cells
    const text = formatSoak(run(series(20, () => ({ loop: { p50: 10, p99: 12, max: 30 }, store: store() }))));
    expect(text).toContain('event loop');
    expect(text).toContain('file store');
  });
});
