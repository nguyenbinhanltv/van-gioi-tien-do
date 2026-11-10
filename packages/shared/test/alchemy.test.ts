import { describe, expect, it } from 'vitest';
import {
  ALCHEMY,
  QUALITY_TIERS,
  RECIPES,
  craftFee,
  craftScore,
  craftSuccessChance,
  failedMaterialLoss,
  itemDefByKey,
  masteryGain,
  masteryScore,
  promotionChances,
  qualityDistribution,
  recipeByKey,
  recipeByWireId,
  referenceCost,
  rngSeed,
  rollCraft,
} from '../src/index.js';

describe('docs/13 §4.2: success chance', () => {
  it('S_D = 0,95 / 0,88 / 0,81 / 0,74 / 0,67 / 0,60 and +0,02 per Score, clamped 0,40..0,98', () => {
    const sd = [1, 2, 3, 4, 5, 6].map((d) => craftSuccessChance(d, 0));
    sd.forEach((v, i) => expect(v).toBeCloseTo([0.95, 0.88, 0.81, 0.74, 0.67, 0.6][i]!, 12));
    expect(craftSuccessChance(3, 5)).toBeCloseTo(0.91, 12);
    expect(craftSuccessChance(1, 5)).toBe(0.98); // 0,95 + 0,10 clamps at the ceiling
    expect(craftSuccessChance(6, 0)).toBeCloseTo(0.6, 12);
    expect(ALCHEMY.P_MIN).toBe(0.4);
  });
});

describe('docs/13 §4.3: the quality ladder reproduces the table', () => {
  // [Trắng, Lục, Lam, Tím, Vàng, Đỏ] in percent, as printed in the doc (one decimal)
  const TABLE: Record<number, number[]> = {
    0: [50.0, 30.0, 14.0, 4.9, 1.0, 0.09],
    1: [46.0, 30.2, 15.7, 6.3, 1.6, 0.21],
    2: [42.0, 30.2, 17.3, 7.8, 2.3, 0.44],
    3: [38.0, 29.8, 18.7, 9.5, 3.2, 0.8],
    4: [34.0, 29.0, 20.0, 11.2, 4.4, 1.4],
    5: [30.0, 28.0, 21.0, 13.0, 5.8, 2.2],
  };
  it.each([0, 1, 2, 3, 4, 5])('Score %i', (score) => {
    const d = qualityDistribution(score).map((v) => v * 100);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(100, 9);
    d.forEach((v, i) => expect(v).toBeCloseTo(TABLE[score]![i]!, 0));
  });
  it('the quality ceiling folds the excess onto the ceiling tier and keeps the total', () => {
    const d = qualityDistribution(0, 3);
    expect(d[4]).toBe(0);
    expect(d[5]).toBe(0);
    expect(d.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
    expect(d[3]).toBeCloseTo(qualityDistribution(0)[3]! + qualityDistribution(0)[4]! + qualityDistribution(0)[5]!, 12);
  });
  it('promotion chances: 0,50 / 0,40 / 0,30 / 0,18 / 0,08 + 0,04 per Score, at most 0,9', () => {
    expect(promotionChances(0)).toEqual([0.5, 0.4, 0.3, 0.18, 0.08]);
    expect(promotionChances(5)[0]).toBeCloseTo(0.7, 12);
    expect(Math.max(...promotionChances(5))).toBeLessThanOrEqual(0.9);
  });
  it('the white tier factor of QUALITY_TIERS is the doc q (0,6 .. 1,6) the bag quality indexes', () => {
    expect(QUALITY_TIERS.map((t) => t.pillFactor)).toEqual([0.6, 0.8, 1.0, 1.2, 1.4, 1.6]);
  });
});

describe('score, mastery, failure loss, fee', () => {
  it('mastery component 0 / 1 / 2 at < 50 / 50..99 / 100; Score is capped at 5', () => {
    expect([0, 49, 50, 99, 100].map(masteryScore)).toEqual([0, 0, 1, 1, 2]);
    expect(craftScore(100, 2, 1)).toBe(5);
    expect(craftScore(100, 9, 9)).toBe(5);
    expect(craftScore(0)).toBe(0);
  });
  it('mastery gain diminishes, never overshoots 100 and is at least 1 below it', () => {
    expect(masteryGain(0)).toBe(5);
    expect(masteryGain(60)).toBe(2);
    expect(masteryGain(99)).toBe(1);
    expect(masteryGain(100)).toBe(0);
    let m = 0;
    for (let k = 0; k < 500 && m < 100; k++) m += masteryGain(m);
    expect(m).toBe(100);
  });
  it('a failed craft destroys 60 % of the main materials, rounded up', () => {
    expect([1, 3, 10, 15, 25].map(failedMaterialLoss)).toEqual([1, 2, 6, 9, 15]);
  });
  it('V(r, q) = kappa x 1610 x 1,5^(r-1); a support pill is half; a restore pill is 0,01 x V_ref', () => {
    expect(referenceCost(1, 2, 'main')).toBeCloseTo(644, 9); // docs/13 §5.1: Trúc Cơ Đan Lam = 644
    expect(referenceCost(2, 2, 'main')).toBeCloseTo(966, 9);
    expect(referenceCost(2, 2, 'support')).toBeCloseTo(483, 9);
    expect(referenceCost(1, 0, 'restore')).toBeCloseTo(16.1, 9);
  });
  it('the furnace fee is 3 % of V at the ceiling quality, rounded up, never below 1', () => {
    expect(craftFee(recipeByKey('pill_hoi_huyet_dan')!)).toBe(1); // 0,48 -> 1
    expect(craftFee(recipeByKey('pill_truc_co_dan')!)).toBe(34); // 0,03 x 1127 = 33,8
    expect(craftFee(recipeByKey('pill_ket_kim_dan')!)).toBe(51); // 0,03 x 1690,5 = 50,7
    expect(craftFee(recipeByKey('pill_ho_mach_dan')!)).toBe(26); // 0,03 x 845,25 = 25,4
  });
});

describe('recipes', () => {
  it('wire ids and keys are unique, tiers / difficulties are in range, outputs are known items', () => {
    expect(new Set(RECIPES.map((r) => r.wireId)).size).toBe(RECIPES.length);
    expect(new Set(RECIPES.map((r) => r.key)).size).toBe(RECIPES.length);
    for (const r of RECIPES) {
      expect(r.tier).toBeGreaterThanOrEqual(1);
      expect(r.difficulty).toBeGreaterThanOrEqual(1);
      expect(r.difficulty).toBeLessThanOrEqual(6);
      expect(r.materials).toBeGreaterThan(0);
      expect(r.qualityCap).toBeLessThan(4); // Vàng / Đỏ stay with boss-dropped scrolls (docs/13 §4.3)
      expect(itemDefByKey(r.output), r.key).toBeDefined();
      expect(recipeByWireId(r.wireId)).toBe(r);
    }
  });
  it('the documented difficulties: Trúc Cơ Đan 3, Kết Kim Đan 4, Hộ Mạch / Định Tâm 3, restore 1', () => {
    expect(recipeByKey('pill_truc_co_dan')!.difficulty).toBe(3);
    expect(recipeByKey('pill_ket_kim_dan')!.difficulty).toBe(4);
    expect(recipeByKey('pill_ho_mach_dan')!.difficulty).toBe(3);
    expect(recipeByKey('pill_dinh_tam_dan')!.difficulty).toBe(3);
    expect(recipeByKey('pill_hoi_huyet_dan')!.difficulty).toBe(1);
    expect(ALCHEMY.MIN_REALM).toBe(2);
  });
});

describe('rollCraft', () => {
  const r = recipeByKey('pill_truc_co_dan')!;
  it('is deterministic for a given RNG state and honours the quality ceiling', () => {
    const seen = new Set<number>();
    for (let k = 0; k < 300; k++) {
      const [a] = rollCraft(r, 5, rngSeed(k));
      const [b] = rollCraft(r, 5, rngSeed(k));
      expect(a).toEqual(b);
      if (a.success) {
        expect(a.quality).toBeLessThanOrEqual(r.qualityCap);
        seen.add(a.quality);
      } else expect(a.quality).toBe(0);
    }
    expect(seen.has(r.qualityCap)).toBe(true); // the ceiling is reached
  });
  it('over many seeds the success rate matches P_ok and the tier mix matches the folded distribution', () => {
    const N = 20000;
    let ok = 0;
    const tiers = [0, 0, 0, 0, 0, 0];
    for (let k = 0; k < N; k++) {
      const [x] = rollCraft(r, 2, rngSeed(k * 7919 + 1));
      if (x.success) {
        ok++;
        tiers[x.quality]!++;
      }
    }
    expect(ok / N).toBeCloseTo(craftSuccessChance(r.difficulty, 2), 1);
    const want = qualityDistribution(2, r.qualityCap);
    for (let q = 0; q <= 3; q++) expect(tiers[q]! / ok).toBeCloseTo(want[q]!, 1);
  });
});
