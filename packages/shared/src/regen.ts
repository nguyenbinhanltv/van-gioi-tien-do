/**
 * Player HP / MP regeneration on the server (D88). Percent of the player's MAX per second.
 *
 * docs/11 §2.4 (Đề xuất) fixes the MP rows: 1 % / s in combat, 4 % / s out of combat, 8 % / s while meditating (out of combat; the tu vi
 * `Absorb(s)` part belongs to progression). docs/ defines NO HP regeneration and no "out of combat" delay: those values are PLACEHOLDERS,
 * cần game designer duyệt. In-combat HP regeneration is 0 on purpose (healing in a fight is pills / skills).
 */
export const REGEN = {
  /** no damage dealt or taken for this long counts as out of combat (PLACEHOLDER) */
  outOfCombatDelayMs: 5000,
  /** MP, in combat (docs/11 §2.4) */
  mpCombatPctPerS: 0.01,
  /** MP, out of combat (docs/11 §2.4) */
  mpIdlePctPerS: 0.04,
  /** MP, meditating and out of combat (docs/11 §2.4) */
  mpMeditationPctPerS: 0.08,
  /** HP, out of combat (PLACEHOLDER: full bar in 50 s) */
  hpIdlePctPerS: 0.02,
  /** HP, in combat (PLACEHOLDER: none) */
  hpCombatPctPerS: 0,
  /** regeneration is applied every this many ticks (4 Hz at 20 Hz), so a regenerating player does not change vitals on every snapshot */
  periodTicks: 5,
} as const;
