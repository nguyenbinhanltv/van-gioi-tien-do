import { describe, expect, it } from 'vitest';
import {
  ConsequenceTier,
  MAJOR_EVENT,
  TIER_EXP_LOSS,
  TRIBULATIONS,
  boltSchedule,
  consequenceTier,
  hpRefOf,
  majorEventOf,
  tamMaStrength,
  tierLockMs,
  totalDamage,
} from '../src/index.js';

describe('major breakthrough events (D97)', () => {
  it('guards exactly the MVP thresholds: none / Tâm Ma nhẹ / Tâm Ma + Lôi Kiếp 3 đạo (docs/07 §2), nothing above', () => {
    expect(majorEventOf(1)).toEqual({ kind: 'none', tribulation: null });
    expect(majorEventOf(2)).toEqual({ kind: 'tam_ma', tribulation: null });
    expect(majorEventOf(3)).toEqual({ kind: 'tam_ma_kiep', tribulation: TRIBULATIONS[0] });
    expect(majorEventOf(3)!.tribulation).toMatchObject({ strikes: 3, waves: 3, strikesPerWave: 1, kappa: 0.162 });
    expect(majorEventOf(4)).toBeUndefined();
  });

  it('Tâm Ma strength follows docs/01 §5.3: 1.0 at Đạo Tâm 100, ~2.0 at Đạo Tâm 0 and K = -1000, Định Tâm Đan takes 10% x q', () => {
    expect(tamMaStrength(100, 0)).toBe(1);
    expect(tamMaStrength(0, -1000)).toBeCloseTo(2, 10);
    expect(tamMaStrength(MAJOR_EVENT.DEFAULT_DAO_TAM, 0)).toBeCloseTo(1.2, 10);
    expect(tamMaStrength(60, -400)).toBeCloseTo(1.4, 10); // + 400/2000
    expect(tamMaStrength(60, 500)).toBeCloseTo(1.2, 10); // good karma does not help
    expect(tamMaStrength(100, 0, 1.0)).toBeCloseTo(0.9, 10);
    expect(tamMaStrength(250, 0)).toBe(1); // clamped
  });

  it('the Kim Đan -> Nguyên Anh bolt schedule: 3 bolts 8 s apart, each warned 1.2 s before, damage from the 07 §3 formula, total 0.6 x HP_ref', () => {
    const hpRef = hpRefOf(3);
    const plan = boltSchedule(TRIBULATIONS[0]!, hpRef);
    expect(plan.map((b) => [b.wave, b.strike, b.warnAtMs, b.hitAtMs])).toEqual([
      [1, 0, 0, 1200],
      [2, 0, 8000, 9200],
      [3, 0, 16_000, 17_200],
    ]);
    expect(plan[0]!.damage).toBe(Math.round(hpRef * 0.162));
    expect(plan[2]!.damage).toBe(Math.round(hpRef * 0.162 * 1.22 ** 2));
    const sum = plan.reduce((a, b) => a + b.damage, 0);
    expect(Math.abs(sum - totalDamage(hpRef, TRIBULATIONS[0]!))).toBeLessThanOrEqual(2); // rounding only
    expect(sum / hpRef).toBeCloseTo(0.6, 1);
    expect(sum).toBeLessThan(hpRef); // survivable without mitigation (docs/10 §7.1)
  });

  it('multi-strike waves use the 1.5 s strike interval (Hợp Thể spec, for the schedule shape)', () => {
    const plan = boltSchedule(TRIBULATIONS[3]!, 1000);
    expect(plan).toHaveLength(18);
    expect(plan[1]!.hitAtMs - plan[0]!.hitAtMs).toBe(1500);
    expect(plan[2]!.hitAtMs - plan[0]!.hitAtMs).toBe(8000);
  });

  it('consequence tiers by waves survived (docs/01 §5.4): Nhẹ >= 2/3, Trung 1/3..2/3, Nặng < 1/3; losses and lock per tier', () => {
    expect(consequenceTier(2, 3)).toBe(ConsequenceTier.Light);
    expect(consequenceTier(1, 3)).toBe(ConsequenceTier.Medium);
    expect(consequenceTier(0, 3)).toBe(ConsequenceTier.Heavy);
    expect(consequenceTier(5, 9)).toBe(ConsequenceTier.Medium);
    expect(consequenceTier(6, 9)).toBe(ConsequenceTier.Light);
    expect(TIER_EXP_LOSS[ConsequenceTier.Light]).toBe(0);
    expect(TIER_EXP_LOSS[ConsequenceTier.Medium]).toBe(0.25);
    expect(TIER_EXP_LOSS[ConsequenceTier.Heavy]).toBe(0.5);
    expect(tierLockMs(ConsequenceTier.Heavy)).toBe(24 * 3600_000);
    expect(tierLockMs(ConsequenceTier.Medium)).toBe(0);
  });
});
