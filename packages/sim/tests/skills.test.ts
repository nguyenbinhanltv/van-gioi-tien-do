import { skillDefinitions } from '@vgtd/shared';
import { describe, expect, it } from 'vitest';
import { MAX_SKILLS, compileSkills, mpCostOf, toSimSkill } from '../src/index.js';

describe('compileSkills (D49 data -> sim table)', () => {
  const table = compileSkills();
  const active = skillDefinitions.skills.filter((s) => s.kind === 'active');

  it('compiles every active skill with stable ids below MAX_SKILLS', () => {
    expect(table).toHaveLength(active.length);
    expect(table.length).toBeLessThanOrEqual(MAX_SKILLS);
    table.forEach((s, k) => {
      expect(s.id).toBe(k);
      expect(s.key).toBe(active[k]!.id);
    });
  });
  it('maps cooldown, GCD, MP, range and LOS from the data', () => {
    for (const s of table) {
      const d = active.find((x) => x.id === s.key)!;
      expect(s.cooldownMs).toBe(d.timing.cooldown_ms);
      expect(s.gcdMs).toBe(d.timing.gcd === false ? 0 : skillDefinitions.global.gcd_ms);
      expect(s.mpCostPct).toBe(d.cost?.mp_pct ?? 0);
      if (s.targeting === 'none') {
        expect(s.range).toBe(0);
        expect(s.requiresLos).toBe(false);
      } else {
        expect(s.range).toBe(d.targeting.range_tiles ?? 0);
        expect(s.requiresLos).toBe(d.targeting.requires_los !== false);
      }
    }
  });
  it('enemy and ally_or_self modes need a target entity', () => {
    const modes = new Set(active.map((d) => d.targeting.mode));
    expect(modes.has('enemy')).toBe(true);
    for (const s of table) {
      const mode = active.find((x) => x.id === s.key)!.targeting.mode;
      expect(s.targeting).toBe(mode === 'enemy' || mode === 'ally_or_self' ? mode : 'none');
    }
  });
  it('mpCostOf scales with max MP and rounds up', () => {
    const s = { ...toSimSkill(active[0]!, 0), mpCostPct: 0.12 };
    expect(mpCostOf(s, 100)).toBe(12);
    expect(mpCostOf(s, 101)).toBe(13);
    expect(mpCostOf({ ...s, mpCostPct: 0 }, 100)).toBe(0);
  });
});
