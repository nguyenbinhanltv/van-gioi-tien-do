/**
 * Tunables of the party module (D92). Party size, invite lifetime and the kill-credit range live in `PARTY` of `@vgtd/shared`; what is
 * here is only the anti-abuse rate. PLACEHOLDER values "cần game designer duyệt".
 */
export const PARTY_CONFIG = {
  /** party commands per ACCOUNT: `burst` tokens, one refilled every `refillMs` (invite spam is the abuse to stop) */
  RATE: { refillMs: 1000, burst: 5 },
} as const;
