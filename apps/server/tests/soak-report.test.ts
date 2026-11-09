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
