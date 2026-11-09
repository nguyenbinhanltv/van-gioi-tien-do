/**
 * Using items from the bag (D90): the numbers behind `inv_cmd` op Use.
 *
 *  - heal pill: docs/11 §1 point 5 ("đan hồi 18% HP, hồi chiêu chung 8 s", universal sustain) = `SIM.PILL` (`heal_pct`, `cooldown_ms`);
 *    the quality of the stack does not change it (PLACEHOLDER, cần game designer duyệt).
 *  - breakthrough pill: docs/07 §2 gives pills a bonus `Pill = 1 − Π(1 − b_i)`, `b = b0 · q · (right realm ? 1 : 0.3)` for MAJOR
 *    breakthroughs only; the item has no threshold, so it counts as a main pill of the right realm (b0 0.40 · quality factor) and the
 *    SAME formula `Success = clamp(Base · (1 + Pill), 5 %, 95 %)` is also applied to the minor roll (PLACEHOLDER: the minor formula
 *    has no pill term). The bonus waits for the next attempt (success or failure) and is lost when the player leaves.
 */
import { BREAKTHROUGH, clamp, pillBonus } from './formulas/breakthrough.js';
import { SIM } from './formulas/skill_sim.js';

export const ITEM_USE = {
  healPill: { healPct: SIM.PILL.heal_pct, cooldownMs: SIM.PILL.cooldown_ms },
} as const;

/** The success chance of a breakthrough roll after a breakthrough pill of `quality` (0..5) was used for it. */
export function breakthroughPillChance(chance: number, quality: number): number {
  const bonus = pillBonus([{ kind: 'main', quality, rightRealm: true }]);
  return clamp(chance * (1 + bonus), BREAKTHROUGH.MIN_RATE, BREAKTHROUGH.MAX_RATE);
}
