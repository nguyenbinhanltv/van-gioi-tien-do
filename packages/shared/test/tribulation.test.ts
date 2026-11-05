import { describe, expect, it } from 'vitest';
import {
  TRIBULATIONS,
  lastWaveMultiplier,
  maxHealPills,
  roundedStatsAt,
  strikeDamage,
  totalMultiplier,
  tribulationDurationS,
  tribulationOutcome,
  waveDamage,
  type TribulationSpec,
} from '../src/index.js';

const SPEC_81 = TRIBULATIONS[5]!;
const HP_REF = 156_733; // Độ Kiếp Viên Mãn

describe('Công thức §3 — Lôi Kiếp', () => {
  it('table: total (× HP_ref) and last wave (× HP_ref) for all 6 thresholds', () => {
    const expected: [number, number, number][] = [
      // strikes, total, last wave
      [3, 0.6, 0.24],
      [6, 1.2, 0.31],
      [9, 1.8, 0.39],
      [18, 2.2, 0.48],
      [36, 2.6, 0.56],
      [81, 3.0, 0.65],
    ];
    expect(TRIBULATIONS).toHaveLength(6);
    TRIBULATIONS.forEach((spec, i) => {
      const [strikes, total, last] = expected[i]!;
      expect(spec.strikes).toBe(strikes);
      expect(spec.strikes).toBe(spec.waves * spec.strikesPerWave);
      expect(totalMultiplier(spec), `total ${strikes}`).toBeCloseTo(total, 1);
      expect(lastWaveMultiplier(spec), `last ${strikes}`).toBeCloseTo(last, 2);
    });
  });

  it('Strike(w) = HP_ref · κ · 1.22^(w−1)', () => {
    expect(strikeDamage(1000, 0.1, 1)).toBeCloseTo(100, 10);
    expect(strikeDamage(1000, 0.1, 3)).toBeCloseTo(100 * 1.22 * 1.22, 10);
    expect(waveDamage(1000, 0.1, 4, 2)).toBeCloseTo(4 * 122, 10);
  });

  it('total equals the sum of all strikes', () => {
    const spec: TribulationSpec = SPEC_81;
    let sum = 0;
    for (let w = 1; w <= spec.waves; w++) sum += waveDamage(1, spec.kappa, spec.strikesPerWave, w);
    expect(sum).toBeCloseTo(totalMultiplier(spec), 10);
  });

  it('Cửu Cửu Thiên Kiếp: 81 strikes = 9 waves × 9, lasts 9 × 12 s + 8 × 8 s = 172 s, 4 Hộ Mạch Đan', () => {
    expect(SPEC_81.strikes).toBe(81);
    expect(SPEC_81.waves * SPEC_81.strikesPerWave).toBe(81);
    expect(tribulationDurationS(SPEC_81)).toBe(172);
    expect(maxHealPills(172)).toBe(4);
  });

  it('HP_ref for Độ Kiếp is 156,733 and gear +40% gives 219,426', () => {
    // computed 156,758 vs printed 156,733 (0.016%): the doc's example uses the printed value
    expect(Math.abs(roundedStatsAt(9, 4).hp - HP_REF) / HP_REF).toBeLessThan(0.0005);
    expect(Math.round(HP_REF * 1.4)).toBe(219_426);
  });

  describe('worked example (HP_ref 156,733; HP_max 219,426)', () => {
    const base = { hpRef: HP_REF, hpMax: 219_426, spec: SPEC_81, totalMultiplierOverride: 3.0, shieldQuality: 4, healPills: 4 } as const;

    it('with Vàng formation (34%): raw 470,199 → 310,331 → shield → 90,904; survives with ~59% HP', () => {
      const o = tribulationOutcome({ ...base, formationQuality: 4 });
      expect(Math.round(o.raw)).toBe(470_199);
      expect(Math.round(o.afterReduction)).toBe(310_331);
      expect(Math.round(o.shield)).toBe(94_040); // 0.60 × HP_ref
      expect(Math.abs(o.afterReduction - o.shield - 216_291)).toBeLessThanOrEqual(1);
      // doc prints 4 × 31,347 = 125,388 → 90,904 (we keep exact 20%·HP_ref; ≤ 2 off from rounding)
      expect(Math.abs(o.net - 90_904)).toBeLessThanOrEqual(2);
      expect(o.survives).toBe(true);
      expect(o.remainingHpFraction).toBeCloseTo(0.59, 2);
    });

    it('without formation: 470,199 → 376,159 → 250,772; dies (exceeds HP by ~31,346)', () => {
      const o = tribulationOutcome({ ...base, formationQuality: null });
      expect(Math.round(o.afterReduction)).toBe(470_199);
      expect(Math.abs(o.afterReduction - o.shield - 376_159)).toBeLessThanOrEqual(1);
      expect(Math.abs(o.net - 250_772)).toBeLessThanOrEqual(2);
      expect(o.survives).toBe(false);
      expect(Math.abs(o.overkill - 31_346)).toBeLessThanOrEqual(2);
      expect(o.remainingHpFraction).toBe(0);
    });

    it('Hộ Mạch Đan heals 20% HP_ref = 31,347 per dose (rounded)', () => {
      expect(Math.round(HP_REF * 0.2)).toBe(31_347);
    });

    it('using the exact computed total (≈2.999×) still survives with Vàng formation', () => {
      const o = tribulationOutcome({ ...base, totalMultiplierOverride: undefined, formationQuality: 4 });
      expect(o.raw / HP_REF).toBeCloseTo(3.0, 2); // table rounds 2.9992 → 3.0
      expect(o.survives).toBe(true);
    });
  });

  it('mitigation caps: formation + Thể tu limited to 50% total; escorts share 25% each (max 2)', () => {
    const a = tribulationOutcome({ hpRef: 1000, hpMax: 1e9, spec: SPEC_81, totalMultiplierOverride: 1, formationQuality: 5, bodyCultivator: true });
    expect(a.reduction).toBe(0.5); // 40% + 10%
    const b = tribulationOutcome({ hpRef: 1000, hpMax: 1e9, spec: SPEC_81, totalMultiplierOverride: 1, formationQuality: 4, bodyCultivator: true });
    expect(b.reduction).toBeCloseTo(0.44, 12);
    const e = tribulationOutcome({ hpRef: 1000, hpMax: 1e9, spec: SPEC_81, totalMultiplierOverride: 1, escorts: 5 });
    expect(e.afterReduction).toBeCloseTo(500, 10); // capped at 2 escorts → 50%
  });
});
