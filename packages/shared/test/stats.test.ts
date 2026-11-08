import { describe, expect, it } from 'vitest';
import {
  APPROVED_STAT_TABLE,
  hitsToKillEqual,
  progressX,
  realmToStage,
  roundedStatsAt,
  statsAt,
  stageLabel,
  stageToRealm,
  subStageCount,
} from '../src/index.js';

describe('Công thức §1 — stats', () => {
  it('x(r,k) = (r−1) + 0.6·(k−1)/K_r', () => {
    expect(progressX(1, 1)).toBe(0);
    expect(progressX(1, 9)).toBeCloseTo(0.5333, 3); // doc: x = 0,533
    expect(progressX(2, 1)).toBe(1);
    expect(progressX(9, 4)).toBeCloseTo(8.45, 10); // Độ Kiếp Viên Mãn
  });

  it('reproduces every row of the approved stat table (rounded)', () => {
    for (const row of APPROVED_STAT_TABLE) {
      const s = roundedStatsAt(row.realm, row.subStage);
      expect(progressX(row.realm, row.subStage), row.label).toBeCloseTo(row.x, 10);
      // The printed table drifts from its own formula by up to ~0.02% (e.g. Độ Kiếp Viên Mãn HP
      // 156,758 computed vs 156,733 printed). Allow ±1 or 0.05% — 20× tighter than the doc's 1% CI gate.
      for (const key of ['hp', 'mp', 'atk', 'def', 'agi'] as const) {
        const tol = Math.max(1, row[key] * 0.0005);
        expect(Math.abs(s[key] - row[key]), `${row.label} ${key} ${s[key]} vs ${row[key]}`).toBeLessThanOrEqual(tol);
      }
    }
  });

  it('example: Luyện Khí tầng 9 has 1,632 HP; Trúc Cơ sơ kỳ 2,136 = +31% in one breakthrough', () => {
    const lk9 = roundedStatsAt(1, 9);
    const tc1 = roundedStatsAt(2, 1);
    expect(lk9.hp).toBe(1632);
    expect(tc1.hp).toBe(2136);
    expect(tc1.hp / lk9.hp - 1).toBeCloseTo(0.31, 2);
  });

  it('9 realms / 41 stages with K_r = 9, 4×8', () => {
    expect(subStageCount(1)).toBe(9);
    for (let r = 2; r <= 9; r++) expect(subStageCount(r)).toBe(4);
    let n = 0;
    for (let r = 1; r <= 9; r++) n += subStageCount(r);
    expect(n).toBe(41);
    expect(stageToRealm(1)).toEqual({ stage: 1, realm: 1, subStage: 1 });
    expect(stageToRealm(9)).toEqual({ stage: 9, realm: 1, subStage: 9 });
    expect(stageToRealm(10)).toEqual({ stage: 10, realm: 2, subStage: 1 });
    expect(stageToRealm(41)).toEqual({ stage: 41, realm: 9, subStage: 4 });
    for (let s = 1; s <= 41; s++) {
      const { realm, subStage } = stageToRealm(s);
      expect(realmToStage(realm, subStage)).toBe(s);
    }
    expect(() => stageToRealm(42)).toThrow(RangeError);
    expect(() => progressX(2, 5)).toThrow(RangeError);
  });

  it('stats are strictly increasing across all 41 stages', () => {
    let prev = statsAt(1, 1);
    for (let s = 2; s <= 41; s++) {
      const { realm, subStage } = stageToRealm(s);
      const cur = statsAt(realm, subStage);
      expect(cur.hp).toBeGreaterThan(prev.hp);
      expect(cur.atk).toBeGreaterThan(prev.atk);
      expect(cur.agi).toBeGreaterThan(prev.agi);
      prev = cur;
    }
  });

  it('inflation control: ~33 hits to kill at Luyện Khí, ~36 at Độ Kiếp (≈ +10%); stats cap ≈ 130× start', () => {
    const lk = hitsToKillEqual(statsAt(1, 1));
    const dk = hitsToKillEqual(statsAt(9, 1));
    const dkMax = hitsToKillEqual(statsAt(9, 4));
    expect(lk).toBeCloseTo(33.3, 0);
    expect(Math.round(lk)).toBe(33);
    expect(Math.round(dk)).toBe(36);
    expect(Math.round(dkMax)).toBe(36);
    // TTK growth "about 10%" after 9 realms
    expect(dk / lk - 1).toBeGreaterThan(0.07);
    expect(dk / lk - 1).toBeLessThan(0.12);
    // "Toàn bộ chỉ số dừng ở khoảng 130 lần mức khởi đầu (Khí Huyết)"
    const ratio = statsAt(9, 4).hp / statsAt(1, 1).hp;
    expect(ratio).toBeGreaterThan(130);
    expect(ratio).toBeLessThan(131);
    // fits in int32 even with crit multiplier
    expect(statsAt(9, 4).hp * 1.5 * 100).toBeLessThan(2 ** 31);
  });

  it('Thân pháp is linear, ~2.3× cap at game end', () => {
    expect(statsAt(9, 4).agi / statsAt(1, 1).agi).toBeCloseTo(2.27, 1);
    const d1 = statsAt(3, 1).agi - statsAt(2, 1).agi;
    const d2 = statsAt(7, 1).agi - statsAt(6, 1).agi;
    expect(d1).toBeCloseTo(d2, 10);
  });
});

describe('stageLabel (display names)', () => {
  it('matches the docs/07 §1 table labels', () => {
    expect(stageLabel(1)).toBe('Luyện Khí tầng 1');
    expect(stageLabel(9)).toBe('Luyện Khí tầng 9');
    expect(stageLabel(10)).toBe('Trúc Cơ sơ kỳ');
    expect(stageLabel(realmToStage(3, 1))).toBe('Kim Đan sơ kỳ');
    expect(stageLabel(realmToStage(4, 1))).toBe('Nguyên Anh sơ kỳ');
    expect(stageLabel(realmToStage(9, 1))).toBe('Độ Kiếp sơ kỳ');
    expect(stageLabel(41)).toBe('Độ Kiếp Viên Mãn');
    expect(() => stageLabel(0)).toThrow(RangeError);
  });
  it('every stage 1..41 has a distinct label', () => {
    const labels = Array.from({ length: 41 }, (_, k) => stageLabel(k + 1));
    expect(new Set(labels).size).toBe(41);
  });
});
