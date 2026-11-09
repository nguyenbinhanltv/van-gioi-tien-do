/**
 * Player combat profile: integer realm stats (07 §1 via `roundedStatsAt`), class element and passive bonuses (D49 data, docs/11).
 * Realm / sub-stage are inputs: progression feeds them through `CombatSystem.setRealm` (`onStageChange`, wired in `WorldNode`); a player
 * starts at Luyện Khí 1 until their profile has loaded.
 */
import { COMBAT_RULES, PEN_MAX, classOf, classStatsAt, effectActive, skillDefinitions } from '@vgtd/shared';
import type { PathId, SkillDefinitions } from '@vgtd/shared';
import type { CombatProfile } from './types.js';

export const DEFAULT_PATH: PathId = 'kiem';

export interface PassiveBonuses {
  crit: number;
  pen: number;
  lifesteal: number;
  defPct: number;
  lowHpDmgPct: number;
  potionPower: number;
  pet: { coeff: number; intervalMs: number } | null;
}

/**
 * Sum of the class passives (`passive_stat` and the `summon` of a passive), solo context: no party bonuses. `tribulation_reduction` is not a
 * combat stat (Lôi Kiếp, D97) and stays unread here.
 */
export function passiveBonuses(path: PathId, defs: SkillDefinitions = skillDefinitions): PassiveBonuses {
  const b: PassiveBonuses = { crit: 0, pen: 0, lifesteal: 0, defPct: 0, lowHpDmgPct: 0, potionPower: 0, pet: null };
  for (const s of defs.skills) {
    if (s.path !== path || s.kind !== 'passive') continue;
    for (const e of s.effects) {
      if (!effectActive(e, false)) continue;
      if (e.type === 'summon' && e.scale) b.pet = { coeff: e.scale.coeff, intervalMs: e.tick_interval_ms ?? 1200 };
      if (e.type !== 'passive_stat') continue;
      const m = e.magnitude ?? 0;
      if (e.stat === 'crit_chance') b.crit += m;
      else if (e.stat === 'pen') b.pen += m;
      else if (e.stat === 'lifesteal') b.lifesteal += m;
      else if (e.stat === 'def_pct') b.defPct += m;
      else if (e.stat === 'low_hp_dmg_pct') b.lowHpDmgPct += m;
      else if (e.stat === 'potion_power') b.potionPower += m;
    }
  }
  return b;
}

export function makeProfile(
  path: PathId = DEFAULT_PATH,
  realm = 1,
  substage = 1,
  defs: SkillDefinitions = skillDefinitions,
): CombatProfile {
  const bonus = passiveBonuses(path, defs);
  return {
    path,
    realm,
    substage,
    element: classOf(path, defs).element as CombatProfile['element'],
    stats: classStatsAt(path, realm, substage, defs), // realm stats x the class stat_weights (D117), integers: whole HP / MP, hp never exceeds hpMax
    critChance: Math.min(COMBAT_RULES.CRIT_CHANCE_CAP, COMBAT_RULES.BASE_CRIT_CHANCE + bonus.crit),
    pen: Math.min(PEN_MAX, bonus.pen),
    lifesteal: bonus.lifesteal,
    defPct: bonus.defPct,
    lowHpDmgPct: bonus.lowHpDmgPct,
    potionPower: bonus.potionPower,
    pet: bonus.pet,
  };
}
