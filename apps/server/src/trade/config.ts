/**
 * Tunables of the trade module (D102). Range, invite lifetime, idle expiry and line limit live in `TRADE` of `@vgtd/shared`, the tax in
 * `MARKET.DIRECT_TRADE_TAX` (docs/07 §7); what is here is only the anti-abuse rate. PLACEHOLDER values "cần game designer duyệt".
 * docs/26 §5.5 also wants a per-day speed / value ceiling against RMT: not implemented, see OPEN-ITEMS.
 */
export const TRADE_CONFIG = {
  /** trade commands per ACCOUNT: `burst` tokens, one refilled every `refillMs`. Every command costs one, including the ones that answer
   *  "no such player", so the answers cannot be used to probe names at line rate (same rule as whispers, #247, and friends, D96). */
  RATE: { refillMs: 700, burst: 8 },
} as const;
