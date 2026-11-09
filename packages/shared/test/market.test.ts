import { describe, expect, it } from 'vitest';
import {
  MARKET_BASKET,
  MARKET_BOARD,
  MARKET_FEE_BPS,
  MARKET_TAX_BETA_BPS,
  listingFeeInt,
  marketSaleTax,
  marketTaxInt,
  sellerProceedsInt,
  shadowTaxBps,
  weeklyCpi,
} from '../src/index.js';

describe('Vạn Bảo Lâu: integer money rules (docs/26 §2.1, §5; docs/07 §7)', () => {
  it('beta rates: 1 % listing fee and a FIXED 5 % tax, derived from the real-number constants', () => {
    expect(MARKET_FEE_BPS).toBe(100);
    expect(MARKET_TAX_BETA_BPS).toBe(500);
    expect(MARKET_TAX_BETA_BPS).toBe(Math.round(marketSaleTax(1) * 10_000)); // the floor of the dynamic tax
  });

  it('listing fee = ceil(1 %), at least 1 hạ phẩm', () => {
    expect(listingFeeInt(1n)).toBe(1n);
    expect(listingFeeInt(99n)).toBe(1n);
    expect(listingFeeInt(100n)).toBe(1n);
    expect(listingFeeInt(101n)).toBe(2n);
    expect(listingFeeInt(1_000n)).toBe(10n);
    expect(listingFeeInt(4_000_000_000n)).toBe(40_000_000n);
  });

  it('the worked example of docs/26 §2.3 (price 1,000 at tau 8 %): tax 80, seller 920; beta 5 %: tax 50, seller 950', () => {
    expect(marketTaxInt(1_000n, 800)).toBe(80n);
    expect(sellerProceedsInt(1_000n, 800)).toBe(920n);
    expect(marketTaxInt(1_000n)).toBe(50n);
    expect(sellerProceedsInt(1_000n)).toBe(950n);
  });

  it('tax rounds UP (the remainder goes to the sink, never to the seller) and tax + proceeds always equals the price', () => {
    expect(marketTaxInt(1n)).toBe(1n); // ceil(0.05)
    expect(sellerProceedsInt(1n)).toBe(0n);
    expect(marketTaxInt(21n)).toBe(2n); // ceil(1.05)
    for (const price of [1n, 2n, 19n, 20n, 21n, 333n, 99_999n, 4_000_000_000n, 281_470_000_000_000n]) {
      expect(marketTaxInt(price) + sellerProceedsInt(price)).toBe(price);
      expect(marketTaxInt(price)).toBeGreaterThanOrEqual(1n);
    }
  });

  it('the shadow tax follows the dynamic rule (clamped 5-10 %) but is only ever reported', () => {
    expect(shadowTaxBps(1)).toBe(500);
    expect(shadowTaxBps(1.02)).toBe(500);
    expect(shadowTaxBps(1.08)).toBe(800); // docs/07 §7 example: CPI +8 % -> 8 %
    expect(shadowTaxBps(2)).toBe(1000); // clamped
    expect(shadowTaxBps(0.5)).toBe(500);
  });

  it('weekly CPI: equal weight per basket item that traded in both weeks; undefined when nothing compares', () => {
    const [a, b] = MARKET_BASKET;
    expect(weeklyCpi({}, {})).toBeUndefined();
    expect(weeklyCpi({ [a]: { avgUnitPrice: 100, units: 5 } }, {})).toBeUndefined();
    expect(weeklyCpi({ [a]: { avgUnitPrice: 100, units: 5 } }, { [a]: { avgUnitPrice: 110, units: 3 } })).toBeCloseTo(
      1.1,
      10,
    );
    const cpi = weeklyCpi(
      {
        [a]: { avgUnitPrice: 100, units: 5 },
        [b]: { avgUnitPrice: 10, units: 50 },
        other: { avgUnitPrice: 1, units: 1 },
      },
      {
        [a]: { avgUnitPrice: 120, units: 1 },
        [b]: { avgUnitPrice: 10, units: 20 },
        other: { avgUnitPrice: 99, units: 1 },
      },
    );
    expect(cpi).toBeCloseTo((1.2 + 1) / 2, 10); // "other" is not in the basket
  });

  it('board limits are consistent with the wire (a total fits a u32)', () => {
    expect(MARKET_BOARD.MAX_TOTAL_PRICE).toBeLessThan(2 ** 32);
    expect(MARKET_BOARD.DURATIONS_H.every((h) => Number.isInteger(h) && h > 0 && h < 256)).toBe(true);
  });
});
