/**
 * Persistence seam of the market (D112). The whole book is ONE document: the active listings (each one HOLDS its item: the item is out of
 * the seller's bag from the moment of listing, that is the escrow), the recent sales (for the weekly CPI) and the weekly shadow reports.
 * The service loads it once at construction and saves the whole snapshot after every change, like the friends store; `FileMarketStore`
 * (persistence/) debounces the disk write (D92), a database adapter would map it onto `market_listings` / `market_trades` / `market_params`
 * (docs/23 §4). Synchronous like the other stores. Amounts are whole hạ phẩm (numbers: a total is capped at 4e9, far below 2^53).
 */

/** What a listing holds: a stackable lot, or ONE instance (with its wear, so it comes back the way it left). */
export interface ListedItem {
  defId: number;
  quality: number;
  qty: number;
  instance?: { durability: number; affixes: string[] };
}

export interface Listing {
  id: number;
  /** seller account id */
  seller: string;
  item: ListedItem;
  /** hạ phẩm per unit */
  unitPrice: number;
  /** epoch ms */
  listedAt: number;
  expiresAt: number;
  /** `active`: on sale. `returning`: expired or otherwise off the board but its item could not go back yet (bag and pending loot full): kept, retried, never lost */
  state: 'active' | 'returning';
}

export interface TradeRecord {
  /** epoch ms of the sale */
  at: number;
  defId: number;
  quality: number;
  qty: number;
  unitPrice: number;
  total: number;
  tax: number;
}

/** One week of SHADOW CPI: what the dynamic tax would have been, next to the fixed tax that was applied. Measured, never applied. */
export interface ShadowReport {
  week: number;
  /** this week / last week over the CPI basket, null when no basket item traded in both weeks */
  cpi: number | null;
  appliedBps: number;
  shadowBps: number;
  /** sales and hạ phẩm volume in that week */
  trades: number;
  volume: number;
}

export interface MarketSnapshot {
  v: 1;
  /** next listing id (never reused, so ledger idempotency keys `market:...:<id>` stay unique) */
  nextId: number;
  listings: Listing[];
  trades: TradeRecord[];
  reports: ShadowReport[];
}

export interface MarketStore {
  load(): MarketSnapshot | undefined;
  save(s: MarketSnapshot): void;
}

/** Keeps JSON text, so what it holds is exactly what a file / database implementation would persist (and a test proves the round trip). */
export class InMemoryMarketStore implements MarketStore {
  private text: string | undefined;
  /** test hook: number of saves */
  saves = 0;
  load(): MarketSnapshot | undefined {
    return this.text === undefined ? undefined : (JSON.parse(this.text) as MarketSnapshot);
  }
  save(s: MarketSnapshot): void {
    this.text = JSON.stringify(s);
    this.saves++;
  }
}
