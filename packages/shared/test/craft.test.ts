import { describe, expect, it } from 'vitest';
import {
  CRAFT_FEE_RATE,
  craftQualityDistribution,
  craftSuccessChance,
  craftValue,
  expectedStoneValue,
} from '../src/index.js';

const pct = (xs: number[]): number[] => xs.map((x) => Math.round(x * 1000) / 10);

describe('crafting numbers (docs/13)', () => {
  it('s4.3 quality table: Score 0 and Score 5 rows', () => {
    // the doc rounds each cell on its own to sum to 100 (Vàng at Score 5 is 5.75 -> printed 5.8): compare within 0.11 points
    const near = (got: number[], want: number[]): void =>
      got.forEach((g, i) => expect(Math.abs(g - want[i]!)).toBeLessThan(0.11));
    near(pct(craftQualityDistribution(0)), [50, 30, 14, 4.9, 1, 0.1]);
    near(pct(craftQualityDistribution(5)), [30, 28, 21, 13, 5.8, 2.2]);
    expect(craftQualityDistribution(3).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
  it('s4.2 success chance: S_D = 0.95 / 0.88 / 0.81 / 0.74 / 0.67 / 0.60, Score +0.02, clamped 0.40..0.98', () => {
    expect([1, 2, 3, 4, 5, 6].map((d) => Math.round(craftSuccessChance(d, 0) * 100) / 100)).toEqual([
      0.95, 0.88, 0.81, 0.74, 0.67, 0.6,
    ]);
    expect(craftSuccessChance(1, 5)).toBe(0.98);
    expect(craftSuccessChance(6, 0)).toBeCloseTo(0.6, 12);
  });
  it('s5.1 value V(r, q) = kappa_q x 1610 x 1.5^(r-1) and s6 fee 3%', () => {
    expect(expectedStoneValue('boss')).toBeCloseTo(1610, 9);
    expect(craftValue(1, 5)).toBeCloseTo(3220, 9);
    expect(craftValue(3, 2)).toBeCloseTo(0.4 * 1610 * 2.25, 9);
    expect(CRAFT_FEE_RATE * craftValue(1, 2)).toBeCloseTo(19.32, 9);
  });
});
