import { describe, expect, it } from 'vitest';
import {
  BREAKTHROUGH,
  DAO_TAM,
  KARMA,
  KARMA_EVENTS,
  applyKarmaEvent,
  breakthroughSuccess,
  clampDaoTam,
  clampKarma,
  daoTamCap,
  durabilityLossMultiplier,
  effectiveDaoTam,
  factionOf,
  isDemonic,
  karmaPenalty,
  nghiepAnhCount,
} from '../src/index.js';

describe('Nghiệp Lực bands (docs/14 §3.2)', () => {
  it('the band edges', () => {
    expect(factionOf(1000)).toBe('chinh');
    expect(factionOf(300)).toBe('chinh');
    expect(factionOf(299)).toBe('tan_tu');
    expect(factionOf(0)).toBe('tan_tu');
    expect(factionOf(-299)).toBe('tan_tu');
    expect(factionOf(-300)).toBe('ta');
    expect(factionOf(-699)).toBe('ta');
    expect(factionOf(-700)).toBe('ma');
    expect(factionOf(-1000)).toBe('ma');
  });
  it('Ma đạo is exactly the demonic threshold of the breakthrough formula', () => {
    for (const k of [-1000, -701, -700, -699, 0, 500]) expect(factionOf(k) === 'ma').toBe(isDemonic(k));
    expect(KARMA.MA_MAX).toBe(BREAKTHROUGH.DEMONIC_KARMA);
  });
  it('out-of-range / non-finite K is clamped, never propagated', () => {
    expect(clampKarma(5000)).toBe(1000);
    expect(clampKarma(-5000)).toBe(-1000);
    expect(clampKarma(Number.NaN)).toBe(0);
    expect(clampKarma(12.9)).toBe(12);
    expect(factionOf(Number.NaN)).toBe('tan_tu');
  });
});

describe('Karma_Penalty is unchanged (docs/07 §2 worked values)', () => {
  it('0,20 x max(0, -K) / 1000: Ma đạo loses 14-20 points, good karma adds nothing', () => {
    expect(karmaPenalty(-700)).toBeCloseTo(0.14, 12);
    expect(karmaPenalty(-1000)).toBeCloseTo(0.2, 12);
    expect(karmaPenalty(500)).toBe(0);
    const clean = breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 });
    expect(breakthroughSuccess({ realm: 3, karma: 900, nFail: 0 })).toBeCloseTo(clean, 12);
    expect(breakthroughSuccess({ realm: 3, karma: -1000, nFail: 0 })).toBeCloseTo(clean - 0.2, 12);
  });
});

describe('Đạo Tâm', () => {
  it('ceilings by band (docs/01 §8.3)', () => {
    expect(daoTamCap(500)).toBe(100);
    expect(daoTamCap(0)).toBe(100);
    expect(daoTamCap(-400)).toBe(80);
    expect(daoTamCap(-900)).toBe(60);
  });
  it('the value that counts is the stored one under the ceiling of the current band', () => {
    expect(effectiveDaoTam(90, 0)).toBe(90);
    expect(effectiveDaoTam(90, -400)).toBe(80);
    expect(effectiveDaoTam(90, -900)).toBe(60);
    expect(effectiveDaoTam(40, -900)).toBe(40);
    expect(effectiveDaoTam(150, 0)).toBe(100);
    expect(effectiveDaoTam(-5, 0)).toBe(0);
    expect(clampDaoTam(Number.NaN)).toBe(DAO_TAM.START);
  });
  it('a new character starts under every ceiling (it never starts capped down)', () => {
    for (const cap of Object.values(DAO_TAM.CAP)) expect(DAO_TAM.START).toBeLessThanOrEqual(cap);
  });
});

describe('Ma đạo wear, Nghiệp Ảnh', () => {
  it('gear wears 1,5x only at K <= -700', () => {
    expect(durabilityLossMultiplier(-699)).toBe(1);
    expect(durabilityLossMultiplier(-700)).toBe(1.5);
    expect(durabilityLossMultiplier(800)).toBe(1);
  });
  it('one extra shadow per 200 negative K, at most 3', () => {
    expect([0, -199, -200, -399, -400, -600, -1000, 300].map(nghiepAnhCount)).toEqual([0, 0, 1, 1, 2, 3, 3, 0]);
  });
});

describe('K events with numbers in the docs (docs/14 §3.3)', () => {
  it('losses apply in full and are clamped at -1000', () => {
    expect(applyKarmaEvent(0, 'pvp_kill_unflagged')).toEqual({ karma: -50, delta: -50, gained: 0 });
    expect(applyKarmaEvent(0, 'pvp_kill_unflagged_weaker').karma).toBe(-120);
    expect(applyKarmaEvent(-980, 'pvp_kill_unflagged_weaker')).toEqual({ karma: -1000, delta: -20, gained: 0 });
    expect(applyKarmaEvent(-5, 'pvp_kill_war').delta).toBe(0);
  });
  it('flagged kills give +10 until the daily +100 is used up; losses never draw on it', () => {
    expect(applyKarmaEvent(0, 'pvp_kill_flagged', 0)).toEqual({ karma: 10, delta: 10, gained: 10 });
    expect(applyKarmaEvent(0, 'pvp_kill_flagged', 95)).toEqual({ karma: 5, delta: 5, gained: 5 });
    expect(applyKarmaEvent(0, 'pvp_kill_flagged', 100)).toEqual({ karma: 0, delta: 0, gained: 0 });
    expect(applyKarmaEvent(1000, 'pvp_kill_flagged', 0)).toEqual({ karma: 1000, delta: 0, gained: 0 });
    expect(applyKarmaEvent(0, 'pvp_kill_unflagged', 100).delta).toBe(-50);
  });
  it('no event table entry exceeds the documented magnitudes, and none is a gain without a cap', () => {
    for (const [id, e] of Object.entries(KARMA_EVENTS)) {
      expect(Math.abs(e.delta), id).toBeLessThanOrEqual(120);
      if (e.delta > 0) expect(e.cap, id).not.toBeNull();
    }
  });
});
