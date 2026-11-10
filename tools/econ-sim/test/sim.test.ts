import { describe, expect, it } from 'vitest';
import { DROP_TABLE, MARKET, expectedStoneValue, listingFee, marketSaleTax, stoneRealmMultiplier } from '@vgtd/shared';
import {
  DEFAULT_PARAMS,
  FAUCET_CHANNELS,
  Rand,
  SINK_CHANNELS,
  analyze,
  bar,
  gini,
  makeScenario,
  pillValue,
  renderReport,
  runSim,
  vRef,
  weekly,
  type SimParams,
} from '../src/index.js';

const small: SimParams = { ...DEFAULT_PARAMS, players: 240, days: 28, seed: 7 };
const sum = (xs: number[]): number => xs.reduce((a, b) => a + b, 0);

describe('Rand', () => {
  it('is deterministic and roughly unbiased', () => {
    const a = new Rand(3);
    const b = new Rand(3);
    for (let i = 0; i < 20; i++) expect(a.next()).toBe(b.next());
    const r = new Rand(11);
    expect(sum(Array.from({ length: 4000 }, () => r.poisson(3))) / 4000).toBeGreaterThan(2.8);
    expect(sum(Array.from({ length: 4000 }, () => r.binom(1000, 0.35))) / 4000).toBeGreaterThan(340);
    expect(r.sumUniform(100, 1, 3)).toBeGreaterThan(150);
    expect(r.binom(0, 0.5)).toBe(0);
  });
});

describe('docs numbers reproduced by the shared tables the simulator reads', () => {
  it('07 s6 expectations: field 1.2, elite 26.5, boss 1610; 180 / 530 hạ phẩm per hour', () => {
    expect(expectedStoneValue('field')).toBeCloseTo(1.2, 6);
    expect(expectedStoneValue('elite')).toBeCloseTo(26.5, 6);
    expect(expectedStoneValue('boss')).toBeCloseTo(1610, 6);
    expect(expectedStoneValue('field') * DEFAULT_PARAMS.fieldKillsPerHour).toBeCloseTo(180, 6);
    expect(expectedStoneValue('elite') * DEFAULT_PARAMS.eliteKillsPerHour).toBeCloseTo(530, 6);
    expect(DROP_TABLE.boss.stone_thuong?.p).toBe(0.12);
  });
  it('V_ref and pill value follow docs/13 s5.1', () => {
    expect(vRef(1)).toBeCloseTo(1610, 6);
    expect(vRef(3)).toBeCloseTo(1610 * stoneRealmMultiplier(3), 6);
    expect(pillValue(1, 2)).toBeCloseTo(0.4 * 1610, 6);
  });
  it('market formulas: tax floor 5%, listing fee 1% with a minimum', () => {
    expect(marketSaleTax(1)).toBe(MARKET.TAX_MIN);
    expect(marketSaleTax(1.08)).toBeCloseTo(0.08, 6);
    expect(listingFee(10)).toBe(1);
  });
});

describe('runSim', () => {
  it('is deterministic: the same params give an identical ledger; another seed differs', () => {
    const a = runSim(small);
    const b = runSim(small);
    expect(JSON.stringify(a.days)).toBe(JSON.stringify(b.days));
    expect(JSON.stringify(runSim({ ...small, seed: 8 }).days)).not.toBe(JSON.stringify(a.days));
  });

  it('conserves stones: sum of wallets == faucets - sinks, every day', () => {
    const r = runSim({ ...small, npcBuyFrac: 0.3, breakthroughCostMult: 0.2 });
    let cum = 0;
    for (const d of r.days) {
      cum += sum(FAUCET_CHANNELS.map((k) => d.faucet[k])) - sum(SINK_CHANNELS.map((k) => d.sink[k]));
      expect(d.supplyAll).toBeCloseTo(cum, 4);
    }
    expect(r.totals.supplyAll).toBeCloseTo(r.totals.faucet - r.totals.sink, 4);
    for (const d of r.days)
      for (const v of [...Object.values(d.faucet), ...Object.values(d.sink)]) expect(v).toBeGreaterThanOrEqual(0);
    expect(r.players.every((p) => p.wallet >= 0)).toBe(true);
  });

  it('respects the stage cap and never lets a player skip a realm', () => {
    const r = runSim({ ...small, maxStage: 18 });
    for (const p of r.players) {
      expect(p.stage).toBeLessThanOrEqual(18);
      for (let i = 1; i < 9; i++) if (p.realmDay[i]! > 0) expect(p.realmDay[i - 1]!).toBeGreaterThan(0);
    }
    const full = runSim({ ...small, maxStage: 41, days: 60 });
    expect(Math.max(...full.players.map((p) => p.stage))).toBeGreaterThan(18);
  });

  it('a stone-cost breakthrough fee is a sink only when set, and the docs-only scenario has none', () => {
    const none = runSim(small);
    expect(sum(none.days.map((d) => d.sink.breakthrough_cost))).toBe(0);
    expect(sum(none.days.map((d) => d.faucet.npc_sell))).toBe(0);
    const fee = runSim({ ...small, breakthroughCostMult: 0.5 });
    expect(sum(fee.days.map((d) => d.sink.breakthrough_cost))).toBeGreaterThan(0);
  });

  it('more drops mean more stones; a higher repair price means more repair sink', () => {
    const f = (r: ReturnType<typeof runSim>): number => r.totals.faucet;
    expect(f(runSim({ ...small, dropMult: 1.2 }))).toBeGreaterThan(f(runSim({ ...small, dropMult: 0.8 })));
    const rep = (m: number): number => sum(runSim({ ...small, repairMult: m }).days.map((d) => d.sink.repair));
    expect(rep(3)).toBeGreaterThan(rep(1));
  });

  it('the per-hour income of field and elite farming matches the docs table at realm 1 (before modifiers)', () => {
    const r = runSim({ ...small, players: 300, days: 3, groups: DEFAULT_PARAMS.groups });
    const field = r.activity.field;
    const elite = r.activity.elite;
    // realm 1, depletion / low-realm / party modifiers only lower it: stay between 40% and 110% of the docs rate
    expect(field.stones / field.hours).toBeGreaterThan(180 * 0.4);
    expect(field.stones / field.hours).toBeLessThan(180 * 1.1);
    expect(elite.stones / elite.hours).toBeGreaterThan(530 * 0.2);
    expect(elite.stones / elite.hours).toBeLessThan(530 * 1.6);
  });
});

describe('analysis and report', () => {
  const r = runSim(small);
  const a = analyze(r);
  it('flags the structural findings of the docs-only economy', () => {
    const ids = a.flags.map((f) => f.id);
    expect(ids).toContain('sink-missing-breakthrough');
    expect(ids).toContain('sink-missing-guardianArrayAndLeyLine');
    expect(ids).toContain('doc-daily-quest');
    expect(a.steadyRatio).toBeLessThan(0.9);
    expect(a.sinkTargets.reduce((s, t) => s + t.target, 0)).toBeCloseTo(1, 6);
  });
  it('weekly rows add up to the day totals; gini and bars are sane', () => {
    const rows = weekly(r.days);
    expect(sum(rows.map((w) => w.faucet))).toBeCloseTo(r.totals.faucet, 3);
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0, 9);
    expect(gini([0, 0, 0, 10])).toBeGreaterThan(0.7);
    expect(bar(5, 10, 10)).toBe('█████░░░░░');
  });
  it('renders a markdown report with charts, assumptions and recommendations', () => {
    const md = renderReport({
      base: makeScenario('base', 'Gốc', 'test', r),
      others: [],
      repairMult: 5,
      elapsedMs: 0,
    });
    expect(md).toContain('# Mô phỏng kinh tế (D113');
    expect(md).toContain('```text');
    expect(md).toContain('Khuyến nghị');
    expect(md).not.toMatch(/[A-Za-z]:\\|\/Users\//); // no absolute local paths
  });
});

describe('speed', () => {
  it('a small cohort runs well inside the CI budget', () => {
    const t0 = Date.now();
    runSim({ ...DEFAULT_PARAMS, players: 400, days: 42, seed: 2 });
    expect(Date.now() - t0).toBeLessThan(15_000);
  });
});
