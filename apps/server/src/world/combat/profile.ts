/**
 * Player combat profile: realm stats (07 §1 via `statsAt`), class element and passive bonuses (D49 data, docs/11).
 * Realm / sub-stage are inputs: progression (worker 35) will feed them; until then every player is Luyện Khí 1.
 */
import { COMBAT_RULES, PEN_MAX, classOf, effectActive, skillDefinitions, statsAt } from '@vgtd/shared';
import type { PathId, SkillDefinitions } from '@vgtd/shared';
import type { CombatProfile } from './types.js';

export const DEFAULT_PATH: PathId = 'kiem';

/** Sum of the class passives' `crit_chance` and `pen` (solo context: no party bonuses). */
export function passiveBonuses(path: PathId, defs: SkillDefinitions = skillDefinitions): { crit: number; pen: number } {
  let crit = 0;
  let pen = 0;
  for (const s of defs.skills) {
    if (s.path !== path || s.kind !== 'passive') continue;
    for (const e of s.effects) {
      if (e.type !== 'passive_stat' || !effectActive(e, false)) continue;
      if (e.stat === 'crit_chance') crit += e.magnitude ?? 0;
      else if (e.stat === 'pen') pen += e.magnitude ?? 0;
    }
  }
  return { crit, pen };
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
    stats: statsAt(realm, substage),
    critChance: Math.min(COMBAT_RULES.CRIT_CHANCE_CAP, COMBAT_RULES.BASE_CRIT_CHANCE + bonus.crit),
    pen: Math.min(PEN_MAX, bonus.pen),
  };
}
