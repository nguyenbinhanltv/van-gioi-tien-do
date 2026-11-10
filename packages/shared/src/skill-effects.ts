/**
 * Numbers the server needs to RESOLVE the skill effects of `skills.json` that the data leaves open (D116). Every effect's own numbers
 * (duration, magnitude, coefficient, radius, distance ...) come from the data as it is; the ones below are the engine rules around them, taken
 * from the design simulation (`skill_sim.ts` SIM, docs/11 §4.5) so the server and the balance simulation agree. All PROVISIONAL ("cần game
 * designer duyệt khi cân bằng"), listed in D116 / docs/OPEN-ITEMS.md.
 */
export const SKILL_EFFECTS = {
  /** total damage reduction (`dr_pct` buffs) is capped here */
  DR_CAP: 0.75,
  /** DEF is multiplied by max(this, 1 + def_pct): a def_pct debuff cannot take DEF below this share */
  DEF_FACTOR_MIN: 0.2,
  /** total `def_shred` on one mob is capped here (its DEF x (1 - shred)) */
  SHRED_CAP: 0.5,
  /** neighbours of a mark that detonates take this share of the detonation damage */
  MARK_SPLASH: 0.6,
  /** bosses ignore control; a hard CC (stun / freeze / knock-up / root) or a knock-back interrupts the telegraph in progress; a slow works at this share */
  BOSS_SLOW_MULT: 0.5,
  /** a pet (a passive `summon`) strikes the nearest mob within this many tiles */
  PET_RANGE: 9,
  /** a pull stops this far from the caster (the mob ring radius of the design simulation) */
  PULL_MIN_TILES: 1,
  /** a forward dash with no victim in its path stops this far from the nearest mob */
  DASH_STOP_TILES: 1,
  /** collision resolution of a dash / push / pull: the path is walked in steps of this many tiles */
  MOVE_STEP_TILES: 0.25,
  /** `low_hp_dmg_pct` applies below this share of max HP */
  LOW_HP: 0.4,
  /** a group effect needs an ally (party member) within this many tiles of the caster */
  GROUP_RANGE_TILES: 12,
} as const;
