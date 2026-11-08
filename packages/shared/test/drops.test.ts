import { describe, expect, it } from 'vitest';
import {
  BOSS_REPEAT_STONE_FACTOR,
  DROP_ITEM_ORDER,
  QUALITY_DISTRIBUTION,
  blueprintPityChance,
  dropQuantityFactor,
  effectiveDropChance,
  expectedDropQuantity,
  expectedStones,
  expectedStoneValue,
  mulberry32,
  resolveDrops,
  rollQuality,
  rollQuantity,
  type DropContext,
} from '../src/index.js';

const field: DropContext = { source: 'field', monsterRealm: 1 };
const elite: DropContext = { source: 'elite', monsterRealm: 1 };
const boss: DropContext = { source: 'boss', monsterRealm: 1 };

describe('effective drop chance (docs/07 §6 modifiers)', () => {
  it('same realm, solo, fresh zone returns the printed table', () => {
    expect(effectiveDropChance('stone_ha', field)).toBe(0.35);
    expect(effectiveDropChance('stone_thuong', elite)).toBe(0.001);
    expect(effectiveDropChance('blueprint_gold_red', boss)).toBe(0.002);
    expect(effectiveDropChance('stone_thuong', field)).toBe(0); // not in the field row
  });
  it('one realm lower: every rate x0.2; two or more lower: crafting material only', () => {
    expect(effectiveDropChance('stone_ha', { ...field, realmGap: 1 })).toBeCloseTo(0.07, 12);
    expect(effectiveDropChance('craft_material', { ...elite, realmGap: 1 })).toBeCloseTo(0.12, 12);
    expect(effectiveDropChance('stone_ha', { ...field, realmGap: 2 })).toBe(0);
    expect(effectiveDropChance('heal_pill', { ...elite, realmGap: 3 })).toBe(0);
    expect(effectiveDropChance('craft_material', { ...elite, realmGap: 3 })).toBe(0.6);
  });
  it('depletion x0.5 only beyond 2 h; party 1/sqrt(n) (4 players: 0.5 each)', () => {
    expect(effectiveDropChance('stone_ha', { ...field, continuousFarmHours: 2 })).toBe(0.35);
    expect(effectiveDropChance('stone_ha', { ...field, continuousFarmHours: 2.01 })).toBeCloseTo(0.175, 12);
    expect(effectiveDropChance('stone_ha', { ...field, partySize: 4 })).toBeCloseTo(0.175, 12);
    expect(
      effectiveDropChance('stone_ha', { ...field, partySize: 4, continuousFarmHours: 3, realmGap: 1 }),
    ).toBeCloseTo(0.35 * 0.5 * 0.5 * 0.2, 12);
  });
  it('boss repeat kill: stones only, no pills, blueprints or materials', () => {
    const repeat = { ...boss, bossRepeat: true };
    expect(effectiveDropChance('stone_trung', repeat)).toBe(1);
    expect(effectiveDropChance('blueprint_blue_purple', repeat)).toBe(0);
    expect(effectiveDropChance('craft_material', repeat)).toBe(0);
    expect(effectiveDropChance('breakthrough_pill', repeat)).toBe(0);
    expect(dropQuantityFactor('stone_thuong', repeat)).toBe(BOSS_REPEAT_STONE_FACTOR);
  });
  it('Gold/Red blueprint pity replaces the printed rate: 0.002 x (1 + 0.15n), guaranteed at n = 30', () => {
    expect(effectiveDropChance('blueprint_gold_red', { ...boss, goldRedAttempt: 1 })).toBeCloseTo(0.0023, 12);
    expect(effectiveDropChance('blueprint_gold_red', { ...boss, goldRedAttempt: 10 })).toBeCloseTo(
      blueprintPityChance(10),
      12,
    );
    expect(effectiveDropChance('blueprint_gold_red', { ...boss, goldRedAttempt: 30 })).toBe(1);
  });
});

describe('expected values (golden numbers of docs/07 §6)', () => {
  it('Linh thạch per kill at realm 1: field 1.2, elite 26.5, boss chest 1,610', () => {
    expect(expectedStones(field)).toBeCloseTo(1.2, 10);
    expect(expectedStones(elite)).toBeCloseTo(26.5, 10);
    expect(expectedStones(boss)).toBeCloseTo(1610, 8);
    for (const source of ['field', 'elite', 'boss'] as const)
      expect(expectedStones({ source, monsterRealm: 1 })).toBeCloseTo(expectedStoneValue(source), 10);
  });
  it('stones x 1.5^(r-1): Hóa Thần (r 5) elite 26.5 x 5.0625', () => {
    expect(expectedStones({ ...elite, monsterRealm: 5 })).toBeCloseTo(26.5 * 1.5 ** 4, 8);
  });
  it('expected hourly field income 150 kills = 180; party of 4 gets half each', () => {
    expect(150 * expectedStones(field)).toBeCloseTo(180, 8);
    expect(150 * expectedStones({ ...field, partySize: 4 })).toBeCloseTo(90, 8);
  });
  it('expected quantity of non-stone items ignores the realm multiplier', () => {
    expect(expectedDropQuantity('craft_material', { ...elite, monsterRealm: 8 })).toBeCloseTo(0.6 * 3, 12);
    expect(expectedDropQuantity('heal_pill', boss)).toBeCloseTo(3, 12);
  });
});

describe('rolls are deterministic and bounded', () => {
  it('a hit needs u < p; boundaries', () => {
    const always = () => 0;
    const never = () => 0.999999;
    const a = resolveDrops(boss, always);
    expect(a.map((r) => r.item)).toEqual(DROP_ITEM_ORDER);
    expect(a.find((r) => r.item === 'stone_ha')!.qty).toBe(40); // u = 0 -> low end
    expect(resolveDrops(field, never)).toEqual([]);
    expect(resolveDrops(boss, never).map((r) => r.item)).toEqual(
      DROP_ITEM_ORDER.filter((i) => ['stone_ha', 'stone_trung', 'heal_pill', 'craft_material'].includes(i)),
    );
  });
  it('same seed -> same drops; different seeds differ', () => {
    const run = (seed: number) => {
      const r = mulberry32(seed);
      return Array.from({ length: 200 }, () => resolveDrops(elite, r));
    };
    expect(run(7)).toEqual(run(7));
    expect(JSON.stringify(run(7))).not.toBe(JSON.stringify(run(8)));
  });
  it('quantities stay inside the printed ranges and scale with realm, repeat kills round to >= 1', () => {
    const rng = mulberry32(3);
    for (let n = 0; n < 500; n++)
      for (const r of resolveDrops(elite, rng)) {
        const range: Record<string, readonly [number, number]> = { stone_ha: [5, 12], craft_material: [2, 4] };
        const [lo, hi] = range[r.item] ?? [0, 99];
        expect(r.qty).toBeGreaterThanOrEqual(lo);
        expect(r.qty).toBeLessThanOrEqual(hi);
    const high = resolveDrops({ ...boss, monsterRealm: 3 }, () => 0).find((r) => r.item === 'stone_ha')!;
    expect(high.qty).toBe(Math.round(40 * 2.25));
    const repeat = resolveDrops({ ...boss, bossRepeat: true }, () => 0);
    expect(repeat.map((r) => r.item)).toEqual(['stone_ha', 'stone_trung', 'stone_thuong']);
    expect(repeat[0]!.qty).toBe(12); // 40 x 0.3
    expect(rollQuantity(1, 3, 0)).toBe(1);
    expect(rollQuantity(1, 3, 0.999999)).toBe(3);
  });
  it('Monte Carlo (seeded) agrees with the analytic expectation within 3%', () => {
    const rng = mulberry32(2026);
    const values: Record<string, number> = { stone_ha: 1, stone_trung: 100, stone_thuong: 10_000 };
    const n = 400_000;
    let total = 0;
    for (let i = 0; i < n; i++) for (const r of resolveDrops(field, rng)) total += (values[r.item] ?? 0) * r.qty;
    expect(Math.abs(total / n / 1.2 - 1)).toBeLessThan(0.03);
  });
});

describe('quality roll', () => {
  it('follows the source distribution and sums to 1', () => {
    for (const source of ['field', 'elite', 'boss'] as const) {
      let acc = 0;
      const counts = [0, 0, 0, 0, 0, 0];
      const steps = 100_000;
      for (let k = 0; k < steps; k++) counts[rollQuality(source, (k + 0.5) / steps)]!++;
      QUALITY_DISTRIBUTION[source].forEach((p, q) => {
        acc += p;
        expect(counts[q]! / steps).toBeCloseTo(p, 3);
      });
      expect(acc).toBeCloseTo(1, 12);
    }
  });
  it('blueprint lines roll inside their own quality range (renormalised)', () => {
    const r = mulberry32(5);
    const seen = new Set<number>();
    for (let i = 0; i < 2000; i++)
      for (const d of resolveDrops(boss, r)) {
        if (d.item === 'blueprint_blue_purple') expect([2, 3]).toContain(d.quality);
        if (d.item === 'blueprint_white_green') expect([0, 1]).toContain(d.quality);
        if (d.item === 'blueprint_gold_red') {
          expect([4, 5]).toContain(d.quality);
          seen.add(d.quality!);
        }
      }
    expect(rollQuality('boss', 0, [4, 5])).toBe(4);
    expect(rollQuality('boss', 0.999999, [4, 5])).toBe(5);
    // Boss gold/red split is 7 : 1, so Đỏ is 12.5% of gold/red blueprints.
    expect(rollQuality('boss', 7 / 8 - 1e-9, [4, 5])).toBe(4);
    expect(rollQuality('boss', 7 / 8 + 1e-9, [4, 5])).toBe(5);
  });
});
