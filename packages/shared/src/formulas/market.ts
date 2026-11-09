/**
 * Vạn Bảo Lâu (D112, docs/10 §7.1 P4 "Vạn Bảo Lâu cơ bản", docs/07 §7, docs/26 §2.1 and §5): the INTEGER form of the market money rules.
 *
 * `MARKET` / `marketSaleTax` / `listingFee` of economy.ts are the rates in real numbers; the ledger only takes whole units, so docs/26 §2.1
 * fixes the rounding: `tax = ceil(price * tau_bps / 10000)`, the seller receives `price - tax` (the remainder goes to the sink, never to the
 * seller), the listing fee is `ceil(price * 1%)` with a minimum of 1 hạ phẩm. All amounts here are `bigint` hạ phẩm (smallest unit).
 *
 * BETA RULE (docs/10 §7.1): the tax applied to every sale is FIXED at 5% (`MARKET_TAX_BETA_BPS`). The weekly CPI runs in SHADOW mode:
 * `shadowTaxBps(cpi)` says what the dynamic tax WOULD have been; it is measured and reported, never applied.
 *
 * In-game stone currency only. Nothing here touches real money, a shop price, or an entitlement.
 */
import { MARKET, marketSaleTax } from './economy.js';

/** 1 % listing fee in basis points. */
export const MARKET_FEE_BPS = Math.round(MARKET.LISTING_FEE * 10_000);
/** The tax APPLIED in beta: the floor of the dynamic tax, 5 % = 500 bps (docs/10 §7.1). */
export const MARKET_TAX_BETA_BPS = Math.round(MARKET.TAX_MIN * 10_000);

const ceilDiv = (a: bigint, b: bigint): bigint => (a + b - 1n) / b;

/** Non-refundable listing fee on the TOTAL listed price: ceil(1 %), at least 1 hạ phẩm. */
export function listingFeeInt(totalPrice: bigint): bigint {
  const fee = ceilDiv(totalPrice * BigInt(MARKET_FEE_BPS), 10_000n);
  return fee < BigInt(MARKET.LISTING_FEE_MIN) ? BigInt(MARKET.LISTING_FEE_MIN) : fee;
}
/** Sale tax at `taxBps`: ceil(price * bps / 10000). A price of at least 1 always pays at least 1 when the rate is above 0. */
export function marketTaxInt(totalPrice: bigint, taxBps: number = MARKET_TAX_BETA_BPS): bigint {
  return ceilDiv(totalPrice * BigInt(taxBps), 10_000n);
}
/** What the seller receives: price - tax (never negative). */
export function sellerProceedsInt(totalPrice: bigint, taxBps: number = MARKET_TAX_BETA_BPS): bigint {
  const t = marketTaxInt(totalPrice, taxBps);
  return t >= totalPrice ? 0n : totalPrice - t;
}
/** The tax the dynamic rule WOULD set for a weekly CPI ratio (this week / last week), in whole basis points. SHADOW: measured, not applied. */
export function shadowTaxBps(cpi: number): number {
  return Math.round(marketSaleTax(cpi) * 10_000);
}

/**
 * The CPI basket (docs/07 §7: "đan đột phá, nguyên liệu phổ biến, bản vẽ phẩm thấp"), by item key. PLACEHOLDER definition, "cần game
 * designer duyệt": docs/26 §5.3 says the basket is DATA; this is its default.
 */
export const MARKET_BASKET = ['breakthrough_pill', 'craft_material', 'blueprint_white_green'] as const;

/** A week of trades summarised per basket item: average unit price (hạ phẩm, per unit, quantity-weighted) and the units traded. */
export interface BasketWeek {
  [itemKey: string]: { avgUnitPrice: number; units: number };
}
/**
 * CPI_w = (average basket price this week) / (last week), docs/07 §7. Equal weight per basket item that traded in BOTH weeks (an item with
 * no trades in either week says nothing); returns undefined when no item can be compared. Pure.
 */
export function weeklyCpi(prev: BasketWeek, cur: BasketWeek): number | undefined {
  let sum = 0;
  let n = 0;
  for (const key of MARKET_BASKET) {
    const a = prev[key];
    const b = cur[key];
    if (!a || !b || a.units <= 0 || b.units <= 0 || a.avgUnitPrice <= 0) continue;
    sum += b.avgUnitPrice / a.avgUnitPrice;
    n++;
  }
  return n === 0 ? undefined : sum / n;
}

/**
 * Board limits (D112). PLACEHOLDERS "cần game designer duyệt khi cân bằng": docs/10 only names the feature, docs/26 §5.2 only proposes the
 * price window P_ref/10..P_ref*10 (open question Q3, no reference prices exist yet, so it is NOT enforced).
 */
export const MARKET_BOARD = {
  /** active listings one account can hold */
  MAX_LISTINGS_PER_ACCOUNT: 10,
  /** listing durations a seller can pick, hours */
  DURATIONS_H: [12, 24, 48] as readonly number[],
  /** unit price range, hạ phẩm; the TOTAL (unit * qty) must also stay <= MAX_TOTAL_PRICE so it fits the wire (u32) */
  MIN_UNIT_PRICE: 1,
  MAX_TOTAL_PRICE: 4_000_000_000,
  /** results per page of a search */
  PAGE_SIZE: 8,
  /** most pages a search can ask for (bounds the work of one query) */
  MAX_PAGE: 50,
} as const;
