import { describe, expect, it } from 'vitest';
import { PATHS, classOf, classStatsAt, roundedStatsAt, statsAt } from '../src/index.js';

describe('classStatsAt (D117): realm stats x the class stat_weights', () => {
  it('is the rounded product of the realm stats and each weight, for every class', () => {
    for (const path of PATHS) {
      const w = classOf(path).stat_weights;
      for (const [r, k] of [
        [1, 1],
        [3, 4],
        [6, 4],
      ] as const) {
        const b = statsAt(r, k);
        const s = classStatsAt(path, r, k);
        expect(s.hp).toBe(Math.round(b.hp * w.hp));
        expect(s.mp).toBe(Math.round(b.mp * w.mp));
        expect(s.atk).toBe(Math.round(b.atk * w.atk));
        expect(s.def).toBe(Math.round(b.def * w.def));
        expect(s.agi).toBe(Math.round(b.agi * w.agi));
      }
    }
  });

  it('classes differ, in the direction their weights say', () => {
    const the = classStatsAt('the', 3, 4);
    const phap = classStatsAt('phap', 3, 4);
    const base = roundedStatsAt(3, 4);
    expect(the.hp).toBeGreaterThan(base.hp);
    expect(the.def).toBeGreaterThan(phap.def);
    expect(phap.mp).toBeGreaterThan(the.mp);
    expect(phap.atk).toBeGreaterThan(the.atk);
  });

  it('gives whole numbers and never a zero HP / MP', () => {
    for (const path of PATHS) {
      const s = classStatsAt(path, 1, 1);
      for (const v of Object.values(s)) expect(Number.isInteger(v)).toBe(true);
      expect(s.hp).toBeGreaterThanOrEqual(1);
      expect(s.mp).toBeGreaterThanOrEqual(1);
    }
  });
});
