import { describe, expect, it } from 'vitest';
import {
  CULTIVATION,
  ROOT_TYPES,
  absorbPerMinute,
  density,
  elementalMatrix,
  match,
  minutesForStage,
  requiredCultivation,
  rootType,
  speedFactor,
  totalHours,
} from '../src/index.js';

const BI_CANH = { moc: 0.5, thuy: 0.3, hoa: 0.2 }; // Bí Cảnh Rừng Độc
const UNIFORM = { kim: 0.2, moc: 0.2, thuy: 0.2, hoa: 0.2, tho: 0.2 };

describe('Công thức §5 — linh căn & hấp thu', () => {
  it('uniform environment ⇒ Match = 1', () => {
    expect(match({ kim: 1 }, UNIFORM)).toBeCloseTo(1, 12);
    expect(match(UNIFORM, UNIFORM)).toBeCloseTo(1, 12);
  });

  // [root, weights, Σ a·v, Match, speed P_n·√Match, total hours]
  const rows: [string, Parameters<typeof match>[0], ReturnType<typeof rootType>, number, number, number, number][] = [
    ['Đơn Mộc', { moc: 1 }, rootType('don'), 0.5, 2.5, 2.53, 18.5],
    ['Song Mộc–Thủy (0,6/0,4)', { moc: 0.6, thuy: 0.4 }, rootType('song'), 0.42, 2.1, 1.88, 25],
    ['Tạp Ngũ', UNIFORM, rootType('tap_ngu'), 0.2, 1.0, 0.7, 67],
    ['Tạp Tam Kim–Thổ–Hỏa', { kim: 1 / 3, tho: 1 / 3, hoa: 1 / 3 }, rootType('tap_tam'), 0.067, 0.33, 0.58, 81],
    ['Đơn Kim', { kim: 1 }, rootType('don'), 0, 0.1, 0.51, 92],
  ];
  it.each(rows)('example at Bí Cảnh Rừng Độc — %s', (_name, roots, type, sum, m, speed, hours) => {
    const got = match(roots, BI_CANH);
    expect(got).toBeCloseTo(m, 2);
    expect(got / 5).toBeCloseTo(Math.max(0.02, sum), 2);
    const f = speedFactor(type.purity, got);
    expect(f).toBeCloseTo(speed, 2);
    // doc rounds to ~0.5 h / whole hours; allow ±1 h
    expect(Math.abs(totalHours(1, type.purity, got) - hours)).toBeLessThanOrEqual(1);
  });

  it('Đơn Kim at a hostile land hits the 0.1 floor (Match = 0.1)', () => {
    expect(match({ kim: 1 }, BI_CANH)).toBe(0.1);
  });

  it('Đơn linh căn is ~3.6× Tạp linh căn on matching land, slower on the wrong land', () => {
    // 1.6·√2.5 = 2.53 vs Tạp Ngũ 0.7 ⇒ 3.6×
    expect(speedFactor(1.6, 2.5) / speedFactor(0.7, 1.0)).toBeCloseTo(3.6, 1);
    // Đơn Kim at floor (0.51) is slower than Tạp Ngũ (0.70)
    expect(speedFactor(1.6, 0.1)).toBeLessThan(speedFactor(0.7, 1));
  });

  it('pure cultivation 1→41 at ρ=1, factor 1 is ≈ 47 hours', () => {
    expect(totalHours(1, 1, 1)).toBeCloseTo(46.8, 1);
    expect(Math.round(totalHours(1, 1, 1))).toBe(47);
  });

  it('Req(s)/Absorb(s) = 10 min · 1.08^(s−1)', () => {
    for (const s of [1, 10, 41]) {
      const direct = requiredCultivation(s) / absorbPerMinute(s, 1, 1, 1);
      expect(direct).toBeCloseTo(minutesForStage(s, 1, 1, 1), 9);
    }
    expect(minutesForStage(1, 1, 1, 1)).toBe(10);
    expect(requiredCultivation(1)).toBe(1000);
    expect(requiredCultivation(2)).toBeCloseTo(1350, 10);
  });

  it('density ρ: 1.0 normal, 0.6 main city, 1 + 0.25·grade on ley lines', () => {
    expect(density()).toBe(1);
    expect(density({ mainCity: true })).toBe(0.6);
    expect(density({ leyLineGrade: 1 })).toBe(1.25);
    expect(density({ leyLineGrade: 5 })).toBe(2.25);
  });

  it('root types: P_n 1.6 / 1.3 / 1.0 / 0.85 / 0.7, spawn weights sum to 1, off-element penalty −30 / −15 / 0', () => {
    expect(ROOT_TYPES.map((r) => r.purity)).toEqual([1.6, 1.3, 1.0, 0.85, 0.7]);
    expect(ROOT_TYPES.reduce((n, r) => n + r.spawnWeight, 0)).toBeCloseTo(1, 12);
    expect(ROOT_TYPES.map((r) => r.offElementDamagePenalty)).toEqual([0.3, 0.15, 0, 0, 0]);
    expect(ROOT_TYPES.map((r) => r.spawnWeight)).toEqual([0.05, 0.2, 0.35, 0.25, 0.15]);
  });

  it('constants agree with the sample JSON', () => {
    expect(elementalMatrix.absorption.match_floor).toBe(CULTIVATION.MATCH_FLOOR);
    expect(elementalMatrix.absorption.match_scale).toBe(CULTIVATION.MATCH_SCALE);
    expect(elementalMatrix.absorption.density.main_city).toBe(CULTIVATION.DENSITY_MAIN_CITY);
    expect(elementalMatrix.absorption.density.ley_line_per_grade).toBe(CULTIVATION.LEY_LINE_PER_GRADE);
    expect(elementalMatrix.root_types.map((r) => [r.id, r.purity, r.spawn_weight, r.element_count])).toEqual(
      ROOT_TYPES.map((r) => [r.id, r.purity, r.spawnWeight, r.elementCount]),
    );
  });
});
