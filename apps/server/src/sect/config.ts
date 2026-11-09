/**
 * Tunables of the sect module (D98). The sect numbers (range, kill rewards, price per level) live in `SECT` of `@vgtd/shared`; what is here
 * is only the anti-abuse rate. PLACEHOLDER values "cần game designer duyệt".
 */
export const SECT_CONFIG = {
  /** sect commands per ACCOUNT: `burst` tokens, one refilled every `refillMs` */
  RATE: { refillMs: 1000, burst: 5 },
} as const;
