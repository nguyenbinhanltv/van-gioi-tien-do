/**
 * Tunables of the Vạn Bảo Lâu module (D112). The money rules (1 % listing fee, FIXED 5 % tax in beta, the shadow CPI) and the board limits
 * (listings per account, durations, price range, page size) live in `@vgtd/shared` (`formulas/market.ts`); what is here is only the
 * anti-abuse rate and the bookkeeping sizes. PLACEHOLDER values "cần game designer duyệt khi cân bằng".
 */
export const MARKET_CONFIG = {
  /** list / buy / cancel per ACCOUNT: `burst` tokens, one refilled every `refillMs` (docs/24 §rate limits: ~3 per second). Every command
   *  costs one BEFORE the listing is looked up, including the ones that answer "no such listing", so listing ids cannot be probed at line
   *  rate (same rule as whispers #247 and friends D96). */
  RATE_WRITE: { refillMs: 333, burst: 6 },
  /** searches per ACCOUNT (docs/24: 2 per second) */
  RATE_SEARCH: { refillMs: 500, burst: 4 },
  /** sales kept for the CPI (oldest dropped first); the basket of two weeks is a few hundred in the MVP */
  TRADES_KEPT: 5_000,
  /** weekly shadow reports kept */
  REPORTS_KEPT: 52,
  /** how many missed weeks one `tick` catches up after a long downtime */
  REPORT_CATCHUP_WEEKS: 8,
  /** a week of the market clock (epoch milliseconds, `MarketServiceOptions.now`) */
  WEEK_MS: 7 * 24 * 3_600_000,
} as const;
