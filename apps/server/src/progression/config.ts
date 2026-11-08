/** Server-only tunables of the progression module. Formulas and constants come from @vgtd/shared (docs/07); these are rules docs/07 does not fix. */
export const PROGRESSION_CONFIG = {
  /** an input with magnitude > 0 within this window counts as "moving" (meditation refused / interrupted) */
  MOVE_GRACE_MS: 400,
  /** a cast or hit within this window counts as "in combat" (meditation refused / interrupted) */
  COMBAT_LOCK_MS: 10_000,
  /** progression commands per entity: token bucket capacity and refill interval */
  CMD_BUCKET: 6,
  CMD_REFILL_MS: 500,
  /** minimum time between two breakthrough attempts of one character (success or failure) */
  BREAKTHROUGH_COOLDOWN_MS: 3000,
  /** while meditating the owner gets a char_state about this often */
  PROGRESS_INTERVAL_MS: 1000,
  /** dirty records are written at most this often */
  AUTOSAVE_MS: 30_000,
  /** answers kept per entity so a re-sent requestId gets the same result without a second roll (docs/24 §5.1) */
  RESULT_CACHE: 16,
} as const;
