/**
 * Tunables of the quest module (D107). Quest content and reward budgets live in `@vgtd/shared` (`quests.ts`); what is here is only the
 * anti-abuse rate. PLACEHOLDER values, cần game designer duyệt.
 */
export const QUESTS_CONFIG = {
  /** quest commands per ACCOUNT: `burst` tokens, one refilled every `refillMs`. Every command costs one before anything else is looked at. */
  RATE: { refillMs: 250, burst: 8 },
} as const;
