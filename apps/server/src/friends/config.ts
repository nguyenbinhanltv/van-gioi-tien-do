/**
 * Tunables of the friends module (D96). List sizes live in `FRIENDS` of `@vgtd/shared`; what is here is only the anti-abuse rate.
 * PLACEHOLDER values "cần game designer duyệt".
 */
export const FRIENDS_CONFIG = {
  /** friend commands per ACCOUNT: `burst` tokens, one refilled every `refillMs`. Every command costs one, including the ones that answer
   *  "no such player", so the answers cannot be used to probe account names at line rate (same rule as whispers, #247). */
  RATE: { refillMs: 1500, burst: 5 },
} as const;
