import { describe, expect, it } from 'vitest';
import {
  BASE_RATE_BY_REALM,
  breakthroughBreakdown,
  breakthroughSuccess,
  isDemonic,
  karmaPenalty,
  minorBreakthroughSuccess,
  pillBonus,
  pityBonus,
  type PillInput,
} from '../src/index.js';

// quality indices: 0 Trắng, 1 Lục, 2 Lam, 3 Tím, 4 Vàng, 5 Đỏ
const main = (quality: number): PillInput => ({ kind: 'main', quality, rightRealm: true });
const support = (quality: number): PillInput => ({ kind: 'support', quality, rightRealm: true });

describe('Công thức §2 — breakthrough', () => {
  it('Base table by threshold', () => {
    expect(BASE_RATE_BY_REALM).toEqual([0.7, 0.55, 0.45, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1]);
  });

  it('example 1: Luyện Khí → Trúc Cơ, Trúc Cơ Đan Lam, K=0 → 0.98 clamped to 95%', () => {
    const b = breakthroughBreakdown({ realm: 1, pills: [main(2)], karma: 0 });
    expect(b.baseEff).toBe(0.7);
    expect(b.pill).toBeCloseTo(0.4, 12);
    expect(b.karmaPenalty).toBe(0);
    expect(b.raw).toBeCloseTo(0.98, 12);
    expect(b.success).toBe(0.95);
  });

  it('example 2: Kim Đan → Nguyên Anh, Kết Anh Đan Tím + Hộ Mạch Đan Lam, K=−400 → 63.3%', () => {
    const pills = [main(3), support(2)];
    // (1 − 0.48)(1 − 0.20) = 0.52 × 0.80 = 0.416 → Pill = 1 − 0.416 = 0.584
    expect(pillBonus(pills)).toBeCloseTo(1 - 0.52 * 0.8, 12);
    expect(pillBonus(pills)).toBeCloseTo(0.584, 12);
    const b = breakthroughBreakdown({ realm: 3, pills, karma: -400 });
    expect(b.baseEff).toBe(0.45);
    expect(b.karmaPenalty).toBeCloseTo(0.08, 12);
    expect(b.success).toBeCloseTo(0.633, 3);
    expect(Math.round(b.success * 1000) / 10).toBe(63.3);
  });

  it('example 3: Độ Kiếp → Phi Thăng, 2 fails, Đỏ main + Vàng Định Tâm + Vàng Hộ Mạch, K=−800 → 31.1%', () => {
    const pills = [main(5), support(4), support(4)];
    // 1 − 0.36 × 0.72 × 0.72 = 0.813
    expect(pillBonus(pills)).toBeCloseTo(1 - 0.36 * 0.72 * 0.72, 12);
    expect(pillBonus(pills)).toBeCloseTo(0.813, 3);
    const b = breakthroughBreakdown({ realm: 9, pills, karma: -800, nFail: 2 });
    expect(b.baseEff).toBeCloseTo(0.26, 12);
    expect(b.karmaPenalty).toBeCloseTo(0.16, 12);
    expect(Math.round(b.success * 1000) / 10).toBe(31.1);
  });

  it('example 4: same as 3 but K=0 → 47.1%', () => {
    const s = breakthroughSuccess({ realm: 9, pills: [main(5), support(4), support(4)], karma: 0, nFail: 2 });
    expect(Math.round(s * 1000) / 10).toBe(47.1);
  });

  it('pity: +8% per failure, capped at +40% (5 failures)', () => {
    expect(pityBonus(0)).toBe(0);
    expect(pityBonus(1)).toBeCloseTo(0.08, 12);
    expect(pityBonus(5)).toBeCloseTo(0.4, 12);
    expect(pityBonus(9)).toBe(0.4);
  });

  it('result is always clamped to [5%, 95%]', () => {
    // hopeless: Độ Kiếp, K=−1000 → 0.1 − 0.2 < 0 → 5%
    expect(breakthroughSuccess({ realm: 9, karma: -1000 })).toBe(0.05);
    expect(breakthroughSuccess({ realm: 1, pills: [main(5), support(5), support(5)] })).toBe(0.95);
  });

  it('karma: only negative karma hurts; Ma đạo (K ≤ −700) loses 14–20 percentage points', () => {
    expect(karmaPenalty(+900)).toBe(0);
    expect(karmaPenalty(0)).toBe(0);
    expect(karmaPenalty(-700)).toBeCloseTo(0.14, 12);
    expect(karmaPenalty(-1000)).toBeCloseTo(0.2, 12);
    expect(isDemonic(-700)).toBe(true);
    expect(isDemonic(-699)).toBe(false);
  });

  it('pills: wrong-realm pills count 0.3×, at most 3 pills, Pill ≤ 1', () => {
    expect(pillBonus([{ kind: 'main', quality: 2, rightRealm: false }])).toBeCloseTo(0.4 * 0.3, 12);
    expect(() => pillBonus([main(0), main(0), main(0), main(0)])).toThrow(RangeError);
    expect(pillBonus([])).toBe(0);
  });

  it('minor stage: Base 0.90 (Luyện Khí) / 0.85, karma penalty halved', () => {
    expect(minorBreakthroughSuccess(1)).toBe(0.9);
    expect(minorBreakthroughSuccess(4)).toBe(0.85);
    expect(minorBreakthroughSuccess(4, -800)).toBeCloseTo(0.85 - 0.08, 12);
  });

  it('high-realm Ma đạo suffers more in relative terms (nghiệp trừ thẳng)', () => {
    const rel = (realm: number) => 1 - breakthroughSuccess({ realm, karma: -800 }) / breakthroughSuccess({ realm, karma: 0 });
    expect(rel(9)).toBeGreaterThan(rel(1));
  });
});
