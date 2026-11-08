import { describe, expect, it } from 'vitest';
import {
  ELEMENTS,
  GENERATES,
  OVERCOMES,
  baseElement,
  buildDamageMatrix,
  COMBAT_RULES,
  HIT_FLAG_CRIT,
  HIT_FLAG_KILL,
  computeDamage,
  damageBreakdown,
  defenseElement,
  elementalMatrix,
  generateSupportRestore,
  relation,
  suppress,
} from '../src/index.js';

describe('Công thức §4 — Ngũ hành', () => {
  it('cycles: khắc Kim→Mộc→Thổ→Thủy→Hỏa→Kim; sinh Kim→Thủy→Mộc→Hỏa→Thổ→Kim', () => {
    let e = 'kim' as (typeof ELEMENTS)[number];
    const k: string[] = [];
    for (let i = 0; i < 5; i++) {
      k.push(e);
      e = OVERCOMES[e];
    }
    expect(k).toEqual(['kim', 'moc', 'tho', 'thuy', 'hoa']);
    e = 'kim';
    const s: string[] = [];
    for (let i = 0; i < 5; i++) {
      s.push(e);
      e = GENERATES[e];
    }
    expect(s).toEqual(['kim', 'thuy', 'moc', 'hoa', 'tho']);
  });

  it('matrix equals the printed table (rows = attacker, cols = defender)', () => {
    const printed = {
      kim: [1.0, 1.25, 1.0, 0.85, 1.0],
      moc: [0.85, 1.0, 1.0, 1.0, 1.25],
      thuy: [1.0, 1.0, 1.0, 1.25, 0.85],
      hoa: [1.25, 1.0, 0.85, 1.0, 1.0],
      tho: [1.0, 0.85, 1.25, 1.0, 1.0],
    } as const;
    const m = buildDamageMatrix();
    for (const a of ELEMENTS) ELEMENTS.forEach((d, j) => expect(m[a][d], `${a}→${d}`).toBe(printed[a][j]));
  });

  it('computed matrix matches the sample elemental_matrix.json', () => {
    expect(buildDamageMatrix()).toEqual(elementalMatrix.damage_matrix);
    expect(OVERCOMES).toEqual(elementalMatrix.overcomes);
    expect(GENERATES).toEqual(elementalMatrix.generates);
  });

  it('every countering pair: A→B = 1.25 and B→A = 0.85; everything else 1.00', () => {
    const m = buildDamageMatrix();
    for (const a of ELEMENTS)
      for (const b of ELEMENTS) {
        if (OVERCOMES[a] === b) {
          expect(m[a][b]).toBe(1.25);
          expect(m[b][a]).toBe(0.85);
        } else if (OVERCOMES[b] !== a) expect(m[a][b]).toBe(1);
      }
  });

  it('mutated elements use the row/column of their base (Phong→Mộc, Lôi→Kim, Băng→Thủy)', () => {
    expect(baseElement('phong')).toBe('moc');
    expect(baseElement('loi')).toBe('kim');
    expect(baseElement('bang')).toBe('thuy');
    expect(relation('loi', 'phong')).toBe('overcomes'); // Kim khắc Mộc
    expect(relation('hoa', 'bang')).toBe('overcome_by'); // Thủy khắc Hỏa
  });

  describe('damage example (Hóa Thần sơ kỳ: ATK 563, target DEF 350, c_skill 1)', () => {
    it('neutral: 563² / (563 + 350) = 347', () => {
      expect(Math.round(computeDamage({ atk: 563, def: 350 }))).toBe(347);
    });
    it('Hỏa đánh Kim (khắc): 563² / (563 + 297.5) × 1.25 = 460, +33%', () => {
      const b = damageBreakdown({ atk: 563, def: 350, attackerElement: 'hoa', defenderElement: 'kim' });
      expect(b.defEff).toBeCloseTo(297.5, 10);
      expect(Math.round(b.damage)).toBe(460);
      expect(b.damage / computeDamage({ atk: 563, def: 350 }) - 1).toBeCloseTo(0.33, 2);
    });
    it('Hỏa đánh Thủy (bị khắc): 347 × 0.85 = 295, −15%', () => {
      const d = computeDamage({ atk: 563, def: 350, attackerElement: 'hoa', defenderElement: 'thuy' });
      expect(Math.round(d)).toBe(295);
      expect(d / computeDamage({ atk: 563, def: 350 })).toBeCloseTo(0.85, 10);
    });
  });

  it('server combat rules (D75): 5% base crit inside a 60% cap, PvE respawn 10 s, hit flag bits', () => {
    expect(COMBAT_RULES).toEqual({ BASE_CRIT_CHANCE: 0.05, CRIT_CHANCE_CAP: 0.6, RESPAWN_PVE_MS: 10_000 });
    expect([HIT_FLAG_CRIT, HIT_FLAG_KILL]).toEqual([1, 2]);
  });

  it('sinh does not change damage', () => {
    // Thủy sinh Mộc
    expect(computeDamage({ atk: 100, def: 50, attackerElement: 'thuy', defenderElement: 'moc' })).toBeCloseTo(
      computeDamage({ atk: 100, def: 50 }),
      10,
    );
  });

  it('Pen (max 0.4), Crit ×1.5, jitter U(0.95, 1.05)', () => {
    const base = computeDamage({ atk: 100, def: 100 });
    expect(computeDamage({ atk: 100, def: 100, crit: true })).toBeCloseTo(base * 1.5, 10);
    // Pen above 0.4 is clamped
    expect(computeDamage({ atk: 100, def: 100, pen: 0.9 })).toBeCloseTo(
      computeDamage({ atk: 100, def: 100, pen: 0.4 }),
      10,
    );
    expect(computeDamage({ atk: 100, def: 100, rand: 0 })).toBeCloseTo(base * 0.95, 10);
    expect(computeDamage({ atk: 100, def: 100, rand: 1 })).toBeCloseTo(base * 1.05, 10);
  });

  it('Suppress: −15% per realm for the weaker attacker only, floor 40%', () => {
    expect(suppress(3, 3)).toBe(1);
    expect(suppress(2, 5)).toBe(1); // higher realm gets no bonus
    expect(suppress(4, 3)).toBeCloseTo(0.85, 12);
    expect(suppress(5, 3)).toBeCloseTo(0.7, 12);
    expect(suppress(9, 1)).toBe(0.4); // 1 − 0.15·8 = −0.2 → floor
  });

  it('Tương sinh khi hỗ trợ: ally restores 10% max MP, not self, 10 s cooldown', () => {
    const o = { supporter: 'thuy', ally: 'moc', allyMaxMp: 1000 } as const;
    expect(generateSupportRestore(o)).toBe(100);
    expect(generateSupportRestore({ ...o, isSelf: true })).toBe(0);
    expect(generateSupportRestore({ ...o, secondsSinceLast: 9.9 })).toBe(0);
    expect(generateSupportRestore({ ...o, secondsSinceLast: 10 })).toBe(100);
    expect(generateSupportRestore({ ...o, ally: 'hoa' })).toBe(0); // Thủy khắc Hỏa, not sinh
    expect(generateSupportRestore({ supporter: 'phong', ally: 'hoa', allyMaxMp: 500 })).toBe(50); // Phong≈Mộc sinh Hỏa
  });

  it('defence element: armour element wins, else root with the highest weight', () => {
    expect(defenseElement('kim', { moc: 1 })).toBe('kim');
    expect(defenseElement(null, { moc: 0.5, thuy: 0.3, hoa: 0.2 })).toBe('moc');
  });
});
