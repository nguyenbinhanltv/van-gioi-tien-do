/**
 * MarketService (D112): escrowed listing, search, atomic buy with fee and tax through the ledger, cancel, expiry, limits, the anti-enumeration
 * rule, restart, the weekly SHADOW CPI, and the anti-dupe properties (concurrent buy, cancel vs buy, a seeded conservation fuzz).
 */
import { describe, expect, it } from 'vitest';
import { MARKET_BOARD, MARKET_TAX_BETA_BPS, itemDefByKey } from '@vgtd/shared';
import {
  MarketNoticeKind,
  MarketOp,
  MarketReason,
  MarketSort,
  MarketView,
  type MarketNoticeMsg,
  type MarketResultMsg,
  type MarketResultsMsg,
  type MarketServerMessage,
} from '@vgtd/protocol';
import {
  InMemoryInventoryStore,
  InMemoryMarketStore,
  InventoryService,
  Ledger,
  MARKET_CONFIG,
  MarketService,
  type ShadowReport,
} from '../src/index.js';

const HEAL = itemDefByKey('heal_pill')!.id;
const BT_PILL = itemDefByKey('breakthrough_pill')!.id;
const BLUEPRINT = itemDefByKey('blueprint_white_green')!.id; // an instance item
const NAMES = ['alice', 'bob', 'carol'];
const acc = (n: string): string => `acc-${n}`;

interface Rig {
  market: MarketService;
  inv: InventoryService;
  ledger: Ledger;
  store: InMemoryMarketStore;
  invStore: InMemoryInventoryStore;
  clock: { ms: number };
  got: Map<number, MarketServerMessage[]>;
  reports: ShadowReport[];
  /** entity id of a name: alice 1, bob 2, carol 3 */
  e(name: string): number;
  /** stones into a wallet (a drop, so the ledger stays balanced) */
  stones(name: string, n: number): void;
  give(
    name: string,
    item: 'heal_pill' | 'breakthrough_pill' | 'blueprint_white_green' | 'craft_material',
    qty: number,
  ): void;
  slotOf(name: string, defId: number): number;
  wallet(name: string): bigint;
  /** run one command far enough after the previous one that the rate limiter never interferes */
  list(name: string, slot: number, qty: number, unitPrice: number, durationH?: number): MarketResultMsg;
  buy(name: string, listingId: number): MarketResultMsg;
  cancel(name: string, listingId: number): MarketResultMsg;
  search(
    name: string,
    over?: Partial<{ view: number; defId: number; minQuality: number; sort: number; page: number }>,
  ): MarketResultsMsg;
  notices(name: string): MarketNoticeMsg[];
  /** every item of a kind in bags + pending + listings (conservation) */
  itemCount(defId: number): number;
}

interface RigOpts {
  store?: InMemoryMarketStore;
  ledger?: Ledger;
  invStore?: InMemoryInventoryStore;
  bagSlots?: number;
  pendingMax?: number;
  durable?: (label: string) => void;
  clockMs?: number;
}

function rig(o: RigOpts = {}): Rig {
  const ledger = o.ledger ?? new Ledger();
  const invStore = o.invStore ?? new InMemoryInventoryStore();
  const inv = new InventoryService({
    ledger,
    store: invStore,
    ...(o.bagSlots ? { bagSlots: o.bagSlots } : {}),
    ...(o.pendingMax ? { pendingMax: o.pendingMax } : {}),
  });
  const store = o.store ?? new InMemoryMarketStore();
  const clock = { ms: o.clockMs ?? 1_000_000_000 };
  const reports: ShadowReport[] = [];
  const market = new MarketService({
    store,
    ledger,
    inventory: inv,
    directory: {
      idOf: (n) => (NAMES.includes(n) ? acc(n) : undefined),
      nameOf: (id) => (id.startsWith('acc-') ? id.slice(4) : undefined),
    },
    now: () => clock.ms,
    report: (r) => reports.push(r),
    ...(o.durable ? { durable: o.durable } : {}),
  });
  const got = new Map<number, MarketServerMessage[]>();
  market.attach({
    deliver: (id, m) => {
      const l = got.get(id) ?? [];
      l.push(m);
      got.set(id, l);
    },
  });
  NAMES.forEach((n, i) => {
    inv.onJoin(acc(n));
    market.join({ entityId: i + 1, accountId: acc(n) });
  });
  let msg = 0;
  let sim = 100_000;
  const next = (): number => (sim += 4 * MARKET_CONFIG.RATE_WRITE.refillMs);
  let key = 0;
  const e = (n: string): number => NAMES.indexOf(n) + 1;
  const r: Rig = {
    market,
    inv,
    ledger,
    store,
    invStore,
    clock,
    got,
    reports,
    e,
    stones(name, n) {
      inv.grantDrops(acc(name), [{ item: 'stone_ha', qty: n }], 'elite', `seed-${name}-${++key}`);
    },
    give(name, item, qty) {
      const res = inv.grantDrops(acc(name), [{ item, qty }], 'field', `give-${name}-${++key}`);
      expect(res.items[0]!.where).toBe('bag');
    },
    slotOf(name, defId) {
      return inv.bagOf(acc(name)).slots.findIndex((s) => {
        if (!s) return false;
        return s.kind === 'stack' ? s.defId === defId : inv.bagOf(acc(name)).instances.get(s.id)?.defId === defId;
      });
    },
    wallet: (name) => inv.wallet(acc(name), 'LT_HA'),
    list: (name, slot, qty, unitPrice, durationH = 24) =>
      market.handle(
        e(name),
        { type: 'market_list', clientMsgId: ++msg, slot, qty, unitPrice, durationH },
        next(),
      ) as MarketResultMsg,
    buy: (name, listingId) =>
      market.handle(e(name), { type: 'market_buy', clientMsgId: ++msg, listingId }, next()) as MarketResultMsg,
    cancel: (name, listingId) =>
      market.handle(e(name), { type: 'market_cancel', clientMsgId: ++msg, listingId }, next()) as MarketResultMsg,
    search: (name, over = {}) =>
      market.handle(
        e(name),
        {
          type: 'market_search',
          clientMsgId: ++msg,
          view: MarketView.Browse,
          defId: 0,
          minQuality: 0,
          sort: MarketSort.PriceAsc,
          page: 0,
          ...over,
        },
        next(),
      ) as MarketResultsMsg,
    notices: (name) => (got.get(e(name)) ?? []).filter((m): m is MarketNoticeMsg => m.type === 'market_notice'),
    itemCount(defId) {
      let n = 0;
      for (const name of NAMES) {
        n += inv.bagOf(acc(name)).count(defId);
        n += inv
          .pendingOf(acc(name))
          .filter((p) => p.defId === defId)
          .reduce((a, p) => a + p.qty, 0);
      }
      for (const id of listingIds(market)) {
        const l = market.listing(id)!;
        if (l.item.defId === defId) n += l.item.qty;
      }
      return n;
    },
  };
  return r;
}

/** all listing ids currently in the book (tests only: through the snapshot) */
const listingIds = (m: MarketService): number[] => m.snapshot().listings.map((l) => l.id);

const sinkBalance = (l: Ledger, kind: 'SYSTEM_SINK_LISTING_FEE' | 'SYSTEM_SINK_MARKET_TAX'): bigint =>
  l.balance({ kind, ownerId: null, currency: 'LT_HA' });

/** total stones in player wallets + sinks: only a faucet can change it (everything else is a transfer or a burn into a sink) */
const circulating = (r: Rig): bigint =>
  NAMES.reduce((a, n) => a + r.wallet(n), 0n) +
  sinkBalance(r.ledger, 'SYSTEM_SINK_LISTING_FEE') +
  sinkBalance(r.ledger, 'SYSTEM_SINK_MARKET_TAX');

describe('Vạn Bảo Lâu: list', () => {
  it('takes the item out of the bag into the listing and burns the 1 % fee (docs/26 §5): ledger balanced, nothing minted', () => {
    const r = rig();
    r.stones('alice', 500);
    r.give('alice', 'heal_pill', 20);
    const slot = r.slotOf('alice', HEAL);
    const before = circulating(r);
    const res = r.list('alice', slot, 10, 100); // lot price 1,000 -> fee 10
    expect(res).toMatchObject({ op: MarketOp.List, reason: MarketReason.Ok, amount: 10, tax: 0 });
    expect(res.listingId).toBeGreaterThan(0);
    expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(10); // 10 left in the bag, 10 in escrow
    expect(r.market.listing(res.listingId)).toMatchObject({
      seller: acc('alice'),
      unitPrice: 100,
      state: 'active',
      item: { defId: HEAL, qty: 10 },
    });
    expect(r.wallet('alice')).toBe(490n);
    expect(sinkBalance(r.ledger, 'SYSTEM_SINK_LISTING_FEE')).toBe(10n);
    expect(circulating(r)).toBe(before); // a burn into a sink, not a vanish
    expect(r.ledger.reconcile()).toEqual([]);
    expect(r.itemCount(HEAL)).toBe(20);
    expect(r.market.metrics).toMatchObject({ listed: 1, feeBurned: 10 });
  });

  it('the fee is at least 1 hạ phẩm and the listing refuses a seller who cannot pay it', () => {
    const r = rig();
    r.stones('alice', 1);
    r.give('alice', 'craft_material', 5);
    const res = r.list('alice', r.slotOf('alice', itemDefByKey('craft_material')!.id), 1, 1); // price 1 -> fee 1
    expect(res).toMatchObject({ reason: MarketReason.Ok, amount: 1 });
    expect(r.wallet('alice')).toBe(0n);
    const broke = r.list('alice', r.slotOf('alice', itemDefByKey('craft_material')!.id), 1, 1);
    expect(broke.reason).toBe(MarketReason.NoFunds);
    expect(r.inv.bagOf(acc('alice')).count(itemDefByKey('craft_material')!.id)).toBe(4); // nothing was taken for a refused listing
  });

  it('rejects what cannot be listed: empty slot, more than the stack, bad duration / price / total, and caps the listings per account', () => {
    const r = rig();
    r.stones('alice', 100_000);
    r.give('alice', 'heal_pill', 50);
    const slot = r.slotOf('alice', HEAL);
    expect(r.list('alice', 39, 1, 10).reason).toBe(MarketReason.NoItem); // empty slot
    expect(r.list('alice', 200, 1, 10).reason).toBe(MarketReason.NoItem); // outside the bag
    expect(r.list('alice', slot, 51, 10).reason).toBe(MarketReason.NoItem); // more than the stack holds
    expect(r.list('alice', slot, 1, 10, 7).reason).toBe(MarketReason.BadRequest); // a duration that is not offered
    expect(r.list('alice', slot, 1, 0).reason).toBe(MarketReason.BadRequest);
    expect(r.list('alice', slot, 2, MARKET_BOARD.MAX_TOTAL_PRICE).reason).toBe(MarketReason.BadRequest); // total above the cap
    expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(50); // nothing moved
    for (let i = 0; i < MARKET_BOARD.MAX_LISTINGS_PER_ACCOUNT; i++)
      expect(r.list('alice', slot, 1, 10).reason).toBe(MarketReason.Ok);
    expect(r.list('alice', slot, 1, 10).reason).toBe(MarketReason.TooManyListings);
    expect(r.market.activeCountOf(acc('alice'))).toBe(MARKET_BOARD.MAX_LISTINGS_PER_ACCOUNT);
  });

  it('an instance item goes in with its wear and comes out with it; an instance lot is exactly one', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 1000);
    r.give('alice', 'blueprint_white_green', 1);
    const bag = r.inv.bagOf(acc('alice'));
    const slot = r.slotOf('alice', BLUEPRINT);
    const inst = bag.instances.get((bag.slots[slot] as { id: string }).id)!;
    inst.durability = 4321;
    (inst as { affixes: readonly string[] }).affixes = ['sharp'];
    expect(r.list('alice', slot, 2, 50).reason).toBe(MarketReason.BadRequest);
    const l = r.list('alice', slot, 1, 50);
    expect(l.reason).toBe(MarketReason.Ok);
    expect(r.inv.bagOf(acc('alice')).count(BLUEPRINT)).toBe(0);
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.Ok);
    const got = r.inv.bagOf(acc('bob'));
    const gs = r.slotOf('bob', BLUEPRINT);
    const gi = got.instances.get((got.slots[gs] as { id: string }).id)!;
    expect(gi).toMatchObject({ defId: BLUEPRINT, durability: 4321, affixes: ['sharp'] });
  });
});

describe('Vạn Bảo Lâu: search', () => {
  it('filters by item and quality, sorts, pages, and marks your own listings; a listing shows the seller name and the time left', () => {
    const r = rig();
    r.stones('alice', 100_000);
    r.give('alice', 'heal_pill', 90);
    r.give('alice', 'breakthrough_pill', 10);
    const hs = r.slotOf('alice', HEAL);
    const bs = r.slotOf('alice', BT_PILL);
    const ids = [30, 10, 20].map((p) => r.list('alice', hs, 1, p).listingId);
    const pill = r.list('alice', bs, 1, 500, 48).listingId;
    const all = r.search('bob');
    expect(all.total).toBe(4);
    expect(all.listings.map((l) => l.unitPrice)).toEqual([10, 20, 30, 500]); // price ascending by default
    expect(all.listings[0]).toMatchObject({ seller: 'alice', mine: false, minutesLeft: 24 * 60, defId: HEAL });
    expect(r.search('bob', { sort: MarketSort.PriceDesc }).listings.map((l) => l.unitPrice)).toEqual([500, 30, 20, 10]);
    expect(r.search('bob', { defId: BT_PILL }).listings.map((l) => l.listingId)).toEqual([pill]);
    expect(r.search('alice').listings.every((l) => l.mine)).toBe(true);
    expect(r.search('bob', { sort: MarketSort.EndingSoon }).listings.at(-1)!.listingId).toBe(pill); // 48 h ends last
    expect(r.search('bob', { sort: MarketSort.Newest }).listings[0]!.listingId).toBe(pill);
    expect(ids.length).toBe(3);
    // time left follows the clock
    r.clock.ms += 30 * 60_000;
    expect(r.search('bob', { defId: HEAL }).listings[0]!.minutesLeft).toBe(24 * 60 - 30);
  });

  it('pages of PAGE_SIZE, a page past the end is empty with the same total, and "mine" shows only your own', () => {
    const r = rig();
    r.stones('alice', 1_000_000);
    r.stones('bob', 1_000_000);
    r.give('alice', 'heal_pill', 99);
    r.give('bob', 'heal_pill', 99);
    for (let i = 0; i < MARKET_BOARD.PAGE_SIZE + 1; i++) {
      r.list('alice', r.slotOf('alice', HEAL), 1, 100 + i);
      if (i < 4) r.list('bob', r.slotOf('bob', HEAL), 1, 5 + i);
    }
    const p0 = r.search('carol', { page: 0 });
    const p1 = r.search('carol', { page: 1 });
    expect(p0.total).toBe(MARKET_BOARD.PAGE_SIZE + 1 + 4); // alice 9 (under her cap of 10), bob 4
    expect(p0.listings).toHaveLength(MARKET_BOARD.PAGE_SIZE);
    expect(p1.listings).toHaveLength(5);
    expect(new Set([...p0.listings, ...p1.listings].map((l) => l.listingId)).size).toBe(13); // no listing on two pages
    expect(r.search('carol', { page: 9 })).toMatchObject({ total: 13, listings: [] });
    const mine = r.search('bob', { view: MarketView.Mine });
    expect(mine.listings).toHaveLength(4);
    expect(mine.total).toBe(4);
  });
});

describe('Vạn Bảo Lâu: buy', () => {
  it('moves the money (buyer -price, seller price-tax, 5 % tax burned) and the item in ONE step; the seller is told', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100); // total 1000
    const before = circulating(r);
    const res = r.buy('bob', l.listingId);
    expect(res).toMatchObject({ op: MarketOp.Buy, reason: MarketReason.Ok, amount: 1000, tax: 50 });
    expect(r.wallet('bob')).toBe(4000n);
    expect(r.wallet('alice')).toBe(100n - 10n + 950n); // fee paid at listing, price - 5 % received
    expect(sinkBalance(r.ledger, 'SYSTEM_SINK_MARKET_TAX')).toBe(50n);
    expect(r.inv.bagOf(acc('bob')).count(HEAL)).toBe(10);
    expect(r.market.listing(l.listingId)).toBeUndefined();
    expect(r.search('carol').total).toBe(0);
    expect(circulating(r)).toBe(before);
    expect(r.ledger.reconcile()).toEqual([]);
    expect(r.notices('alice')).toEqual([
      {
        type: 'market_notice',
        kind: MarketNoticeKind.Sold,
        listingId: l.listingId,
        defId: HEAL,
        quality: 0,
        qty: 10,
        amount: 950,
      },
    ]);
    expect(r.market.metrics).toMatchObject({ sold: 1, taxBurned: 50, volume: 950 });
    expect(MARKET_TAX_BETA_BPS).toBe(500);
  });

  it('refuses without changing anything: own listing, not enough stones, no bag room, gone, expired', () => {
    const r = rig({ bagSlots: 2 });
    r.stones('alice', 100);
    r.stones('bob', 5);
    r.stones('carol', 5000);
    r.give('alice', 'heal_pill', 5);
    const l = r.list('alice', r.slotOf('alice', HEAL), 5, 100);
    const snap = JSON.stringify([r.ledger.snapshot().accounts, r.market.snapshot().listings]);
    expect(r.buy('alice', l.listingId).reason).toBe(MarketReason.SelfBuy);
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.NoFunds);
    r.give('carol', 'craft_material', 1);
    r.give('carol', 'breakthrough_pill', 1); // carol's bag (2 slots) is full of other items
    expect(r.buy('carol', l.listingId).reason).toBe(MarketReason.NoSpace);
    expect(r.buy('carol', 9999).reason).toBe(MarketReason.NoSuchListing);
    expect(JSON.stringify([r.ledger.snapshot().accounts, r.market.snapshot().listings])).toBe(snap); // not one stone or item moved
    r.clock.ms += 25 * 3_600_000; // past the 24 h
    expect(r.buy('carol', l.listingId).reason).toBe(MarketReason.NoSuchListing); // expired counts as gone even before the sweep runs
  });

  it('the price is the one on the record, whatever the buyer saw: a lot costs unit price x quantity', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 100_000);
    r.give('alice', 'heal_pill', 7);
    const l = r.list('alice', r.slotOf('alice', HEAL), 7, 13); // 91 total, fee 1
    expect(r.buy('bob', l.listingId)).toMatchObject({ amount: 91, tax: 5 }); // ceil(4.55)
    expect(r.wallet('bob')).toBe(100_000n - 91n);
    expect(r.wallet('alice')).toBe(100n - 1n + 86n);
  });

  it('a one-hạ-phẩm sale pays the seller nothing and the whole price is tax (the remainder goes to the sink)', () => {
    const r = rig();
    r.stones('alice', 5);
    r.stones('bob', 5);
    r.give('alice', 'craft_material', 1);
    const l = r.list('alice', r.slotOf('alice', itemDefByKey('craft_material')!.id), 1, 1);
    expect(r.buy('bob', l.listingId)).toMatchObject({ reason: MarketReason.Ok, amount: 1, tax: 1 });
    expect(r.wallet('alice')).toBe(4n); // fee 1 paid, proceeds 0
    expect(sinkBalance(r.ledger, 'SYSTEM_SINK_MARKET_TAX')).toBe(1n);
    expect(r.ledger.reconcile()).toEqual([]);
  });
});

describe('Vạn Bảo Lâu: cancel and expire', () => {
  it('cancel returns the whole lot to the bag, never refunds the fee, and somebody else listing answers exactly like a missing one', () => {
    const r = rig();
    r.stones('alice', 100);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    // somebody else's listing and a listing that never existed are indistinguishable (no probing)
    const other = r.cancel('bob', l.listingId);
    const missing = r.cancel('bob', 424242);
    expect(other).toMatchObject({ reason: MarketReason.NoSuchListing, amount: 0, tax: 0 });
    expect({ ...other, listingId: 0, clientMsgId: 0 }).toEqual({ ...missing, listingId: 0, clientMsgId: 0 });
    expect(r.market.listing(l.listingId)).toBeDefined();
    expect(r.cancel('alice', l.listingId)).toMatchObject({ op: MarketOp.Cancel, reason: MarketReason.Ok });
    expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(10);
    expect(r.wallet('alice')).toBe(90n); // the fee is gone for good
    expect(r.cancel('alice', l.listingId).reason).toBe(MarketReason.NoSuchListing); // a second cancel does nothing
    expect(r.itemCount(HEAL)).toBe(10);
  });

  it('a cancel with no room anywhere refuses and keeps the listing (nothing is lost)', () => {
    const r = rig({ bagSlots: 1, pendingMax: 1 });
    r.stones('alice', 100);
    r.give('alice', 'heal_pill', 5);
    const l = r.list('alice', r.slotOf('alice', HEAL), 5, 10);
    r.give('alice', 'breakthrough_pill', 1); // the single slot is taken again
    r.inv.grantDrops(acc('alice'), [{ item: 'craft_material', qty: 1 }], 'field', 'fill'); // the one pending entry is taken too
    expect(r.inv.pendingOf(acc('alice'))).toHaveLength(1);
    expect(r.cancel('alice', l.listingId).reason).toBe(MarketReason.NoSpace);
    expect(r.market.listing(l.listingId)).toMatchObject({ state: 'active', item: { qty: 5 } });
  });

  it('expiry returns the item to the seller, tells them, and the listing is gone from the search', () => {
    const r = rig();
    r.stones('alice', 100);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100, 12);
    r.clock.ms += 11 * 3_600_000;
    r.market.tick();
    expect(r.market.listing(l.listingId)).toBeDefined(); // not yet
    r.clock.ms += 2 * 3_600_000;
    expect(r.search('bob').total).toBe(0); // expired listings are hidden even before the sweep
    r.market.tick();
    expect(r.market.listing(l.listingId)).toBeUndefined();
    expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(10);
    expect(r.wallet('alice')).toBe(90n);
    expect(r.notices('alice').at(-1)).toMatchObject({
      kind: MarketNoticeKind.Expired,
      listingId: l.listingId,
      qty: 10,
      defId: HEAL,
    });
    expect(r.market.metrics.expired).toBe(1);
    expect(r.itemCount(HEAL)).toBe(10);
  });

  it('an expired lot with a full bag goes to the pending loot; with nowhere to go it stays as `returning` and is retried when the owner joins', () => {
    const r = rig({ bagSlots: 1 });
    r.stones('alice', 100);
    r.give('alice', 'heal_pill', 5);
    const l = r.list('alice', r.slotOf('alice', HEAL), 5, 10, 12);
    r.give('alice', 'breakthrough_pill', 1); // the only slot is taken
    r.clock.ms += 13 * 3_600_000;
    r.market.tick();
    expect(r.inv.pendingOf(acc('alice'))).toEqual([{ defId: HEAL, quality: 0, qty: 5 }]);
    expect(r.market.listing(l.listingId)).toBeUndefined();

    // now with the pending queue full too
    const r2 = rig({ bagSlots: 1, pendingMax: 1 });
    r2.stones('alice', 100);
    r2.give('alice', 'heal_pill', 5);
    const l2 = r2.list('alice', r2.slotOf('alice', HEAL), 5, 10, 12);
    r2.give('alice', 'breakthrough_pill', 1);
    r2.inv.grantDrops(acc('alice'), [{ item: 'craft_material', qty: 1 }], 'field', 'fill');
    r2.clock.ms += 13 * 3_600_000;
    r2.market.tick();
    expect(r2.market.listing(l2.listingId)).toMatchObject({ state: 'returning' }); // kept, not lost
    expect(r2.search('bob').total).toBe(0); // and not buyable
    expect(r2.buy('bob', l2.listingId).reason).toBe(MarketReason.NoSuchListing);
    expect(r2.itemCount(HEAL)).toBe(5);
    // make room: the bag slot frees up, the next tick returns the lot
    const bag = r2.inv.bagOf(acc('alice'));
    bag.slots.fill(null);
    r2.market.tick();
    expect(r2.market.listing(l2.listingId)).toBeUndefined();
    expect(r2.inv.bagOf(acc('alice')).count(HEAL)).toBe(5);
  });
});

describe('Vạn Bảo Lâu: anti-dupe races', () => {
  it('two buyers on the same listing in the same tick: exactly one gets it, the item exists once, the stones add up', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.stones('carol', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    const before = circulating(r);
    const a = r.buy('bob', l.listingId);
    const b = r.buy('carol', l.listingId);
    expect([a.reason, b.reason]).toEqual([MarketReason.Ok, MarketReason.NoSuchListing]);
    expect(r.inv.bagOf(acc('bob')).count(HEAL)).toBe(10);
    expect(r.inv.bagOf(acc('carol')).count(HEAL)).toBe(0);
    expect(r.wallet('carol')).toBe(5000n); // the loser paid nothing
    expect(r.itemCount(HEAL)).toBe(10);
    expect(circulating(r)).toBe(before);
    expect(r.ledger.reconcile()).toEqual([]);
  });

  it('the same buyer sending the buy twice pays once', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.Ok);
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.NoSuchListing);
    expect(r.wallet('bob')).toBe(4000n);
    expect(r.inv.bagOf(acc('bob')).count(HEAL)).toBe(10);
  });

  it('cancel vs buy, either order: one wins, the item is never both returned and sold', () => {
    for (const buyFirst of [true, false]) {
      const r = rig();
      r.stones('alice', 100);
      r.stones('bob', 5000);
      r.give('alice', 'heal_pill', 10);
      const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
      const before = circulating(r);
      const [first, second] = buyFirst
        ? [r.buy('bob', l.listingId), r.cancel('alice', l.listingId)]
        : [r.cancel('alice', l.listingId), r.buy('bob', l.listingId)];
      expect(first.reason).toBe(MarketReason.Ok);
      expect(second.reason).toBe(MarketReason.NoSuchListing);
      const aliceHas = r.inv.bagOf(acc('alice')).count(HEAL);
      const bobHas = r.inv.bagOf(acc('bob')).count(HEAL);
      expect(aliceHas + bobHas).toBe(10); // one place, never two
      expect(buyFirst ? bobHas : aliceHas).toBe(10);
      expect(r.itemCount(HEAL)).toBe(10);
      expect(circulating(r)).toBe(before);
    }
  });

  it('expiry vs buy: an expired listing cannot be bought, and a sale never leaves an expiry to return the item again', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100, 12);
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.Ok);
    r.clock.ms += 13 * 3_600_000;
    r.market.tick(); // the sold listing is gone: nothing to return
    expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(0);
    expect(r.itemCount(HEAL)).toBe(10);
    expect(r.notices('alice').filter((n) => n.kind === MarketNoticeKind.Expired)).toHaveLength(0);
  });

  it('a reused ledger key cannot hand an item out twice: a sale whose transaction was already applied is refused', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    // pretend a previous sale of this very listing id was already posted (a duplicated commit): the ledger replays it
    const listing = r.market.listing(l.listingId)!;
    r.ledger.post({
      reason: 'MARKET_SALE',
      idempotencyKey: `market:sale:${l.listingId}`,
      entries: [
        { account: { kind: 'PLAYER_WALLET', ownerId: acc('bob'), currency: 'LT_HA' }, delta: -1000n },
        { account: { kind: 'PLAYER_WALLET', ownerId: acc('alice'), currency: 'LT_HA' }, delta: 950n },
        { account: { kind: 'SYSTEM_SINK_MARKET_TAX', ownerId: null, currency: 'LT_HA' }, delta: 50n },
      ],
    });
    expect(listing.item.qty).toBe(10);
    const bobBefore = r.wallet('bob');
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.NoSuchListing);
    expect(r.inv.bagOf(acc('bob')).count(HEAL)).toBe(0); // no item for money that was already taken once
    expect(r.wallet('bob')).toBe(bobBefore);
  });
});

describe('Vạn Bảo Lâu: restart and durability', () => {
  /** a "restart": a new service on the persisted book, a ledger rebuilt from its snapshot and the bags reloaded from their store */
  function restart(r: Rig): Rig {
    r.inv.flushAll();
    const ledger = Ledger.restore(r.ledger.snapshot());
    return rig({ store: r.store, ledger, invStore: r.invStore, clockMs: r.clock.ms });
  }

  it('the book, the escrowed items and the ledger survive a restart; the listing can still be bought exactly once', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    const r2 = restart(r);
    expect(r2.market.listing(l.listingId)).toMatchObject({ seller: acc('alice'), unitPrice: 100, item: { qty: 10 } });
    expect(r2.search('bob').listings.map((x) => x.listingId)).toEqual([l.listingId]);
    expect(r2.inv.bagOf(acc('alice')).count(HEAL)).toBe(0); // still in escrow, not back in the bag
    expect(r2.itemCount(HEAL)).toBe(10);
    expect(r2.buy('bob', l.listingId).reason).toBe(MarketReason.Ok);
    expect(r2.buy('carol', l.listingId).reason).toBe(MarketReason.NoSuchListing);
    expect(r2.inv.bagOf(acc('bob')).count(HEAL)).toBe(10);
    expect(r2.ledger.reconcile()).toEqual([]);
    // ids are never reused after a restart (ledger keys stay unique)
    r2.give('alice', 'heal_pill', 1);
    r2.stones('alice', 10);
    expect(r2.list('alice', r2.slotOf('alice', HEAL), 1, 5).listingId).toBeGreaterThan(l.listingId);
  });

  it('restart after the sale: the item is with the buyer and the listing does not come back', () => {
    const r = rig();
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    expect(r.buy('bob', l.listingId).reason).toBe(MarketReason.Ok);
    const r2 = restart(r);
    expect(r2.market.listing(l.listingId)).toBeUndefined();
    expect(r2.inv.bagOf(acc('bob')).count(HEAL)).toBe(10);
    expect(r2.inv.bagOf(acc('alice')).count(HEAL)).toBe(0);
    expect(r2.itemCount(HEAL)).toBe(10);
    expect(r2.wallet('alice')).toBe(100n - 10n + 950n);
  });

  it('a listing that ran out while the server was down is returned on the first sweep after the restart', () => {
    const r = rig();
    r.stones('alice', 100);
    r.give('alice', 'heal_pill', 10);
    const l = r.list('alice', r.slotOf('alice', HEAL), 10, 100, 12);
    const r2 = restart(r);
    r2.clock.ms += 3 * 24 * 3_600_000; // three days of downtime
    r2.market.tick();
    expect(r2.market.listing(l.listingId)).toBeUndefined();
    expect(r2.inv.bagOf(acc('alice')).count(HEAL)).toBe(10);
  });

  it('crash injection: after EVERY commit the persisted book + ledger + bags are consistent (no item twice, no stone minted), and a failing journal hook never breaks a command', () => {
    const labels: string[] = [];
    const r = rig({
      durable: (label) => {
        labels.push(label);
        if (label.startsWith('market:cancel')) throw new Error('disk full');
      },
    });
    r.stones('alice', 100);
    r.stones('bob', 5000);
    r.give('alice', 'heal_pill', 20);
    const check = (where: string): void => {
      // "crash" here: rebuild everything from what is persisted and look at the whole picture
      const r2 = restart(r);
      expect(r2.ledger.reconcile(), where).toEqual([]);
      expect(r2.itemCount(HEAL), where).toBe(20);
      expect(circulating(r2), where).toBe(circulating(r));
    };
    const a = r.list('alice', r.slotOf('alice', HEAL), 10, 100);
    check('after list');
    const b = r.list('alice', r.slotOf('alice', HEAL), 5, 50);
    check('after second list');
    expect(r.buy('bob', a.listingId).reason).toBe(MarketReason.Ok);
    check('after buy');
    expect(r.cancel('alice', b.listingId).reason).toBe(MarketReason.Ok); // the hook throws, the command still succeeds
    expect(r.market.metrics.durableErrors).toBe(1);
    check('after cancel');
    expect(labels).toEqual([
      `market:list:${a.listingId}`,
      `market:list:${b.listingId}`,
      `market:sale:${a.listingId}`,
      `market:cancel:${b.listingId}`,
    ]);
  });
});

describe('Vạn Bảo Lâu: rate limits and anti-enumeration', () => {
  it('a command takes its rate-limit token BEFORE the listing is looked up: past the burst, even an unknown id answers RateLimited, never NoSuchListing', () => {
    const r = rig();
    const burst = MARKET_CONFIG.RATE_WRITE.burst;
    const reasons: number[] = [];
    // all at the same instant, so no token is refilled
    for (let i = 0; i < burst + 3; i++)
      reasons.push(
        (
          r.market.handle(
            r.e('bob'),
            { type: 'market_buy', clientMsgId: i, listingId: 1000 + i },
            5_000_000,
          ) as MarketResultMsg
        ).reason,
      );
    expect(reasons.slice(0, burst).every((x) => x === MarketReason.NoSuchListing)).toBe(true);
    expect(reasons.slice(burst).every((x) => x === MarketReason.RateLimited)).toBe(true);
    // cancel probes of somebody else's listing run into the same wall, and the bucket is per ACCOUNT
    const other = r.market.handle(
      r.e('alice'),
      { type: 'market_cancel', clientMsgId: 1, listingId: 1 },
      5_000_000,
    ) as MarketResultMsg;
    expect(other.reason).toBe(MarketReason.NoSuchListing); // alice has her own full bucket
  });

  it('search has its own, tighter bucket, and a refused search answers with a typed market_result', () => {
    const r = rig();
    const burst = MARKET_CONFIG.RATE_SEARCH.burst;
    const out: MarketServerMessage[] = [];
    for (let i = 0; i < burst + 2; i++)
      out.push(
        r.market.handle(
          r.e('bob'),
          { type: 'market_search', clientMsgId: i, view: 0, defId: 0, minQuality: 0, sort: 0, page: 0 },
          5_000_000,
        ),
      );
    expect(out.slice(0, burst).every((m) => m.type === 'market_results')).toBe(true);
    expect(out[burst]).toMatchObject({ type: 'market_result', op: MarketOp.Search, reason: MarketReason.RateLimited });
    // searching does not eat the write bucket
    expect(r.buy('bob', 77).reason).toBe(MarketReason.NoSuchListing);
  });

  it('commands from an entity the market has not seen answer NotReady', () => {
    const r = rig();
    const res = r.market.handle(99, { type: 'market_buy', clientMsgId: 1, listingId: 1 }, 1) as MarketResultMsg;
    expect(res.reason).toBe(MarketReason.NotReady);
    r.market.leave(r.e('bob'));
    expect(
      (r.market.handle(r.e('bob'), { type: 'market_buy', clientMsgId: 2, listingId: 1 }, 1) as MarketResultMsg).reason,
    ).toBe(MarketReason.NotReady);
  });
});

describe('Vạn Bảo Lâu: weekly CPI in SHADOW mode', () => {
  it('computes the CPI from the basket sales and reports what the dynamic tax would have been, while every sale still pays the fixed 5 %', () => {
    const WEEK = MARKET_CONFIG.WEEK_MS;
    const r = rig({ clockMs: 10 * WEEK + 1000 });
    r.stones('alice', 1_000_000);
    r.stones('bob', 10_000_000);
    r.give('alice', 'breakthrough_pill', 90);
    const sell = (unit: number, qty = 1): void => {
      const l = r.list('alice', r.slotOf('alice', BT_PILL), qty, unit);
      expect(r.buy('bob', l.listingId)).toMatchObject({
        reason: MarketReason.Ok,
        tax: Number((BigInt(unit * qty) * 5n + 99n) / 100n),
      });
    };
    sell(100); // week 10: average 100
    sell(100, 2);
    r.clock.ms += WEEK; // week 11: average 108 (+8 %)
    sell(108);
    sell(108, 3);
    r.clock.ms += WEEK; // week 12: the weeks 10 and 11 are complete
    r.market.tick();
    const reports = r.market.shadowReports();
    expect(reports.map((x) => x.week)).toEqual([10, 11]);
    expect(reports[0]).toMatchObject({ cpi: null, appliedBps: 500, shadowBps: 500, trades: 2 }); // nothing to compare week 10 with
    expect(reports[1]!.cpi).toBeCloseTo(1.08, 10);
    expect(reports[1]).toMatchObject({ appliedBps: 500, shadowBps: 800, trades: 2, volume: 108 + 324 });
    expect(r.reports).toEqual([...reports]); // the report sink got both
    r.market.tick(); // nothing new: no duplicate report
    expect(r.market.shadowReports()).toHaveLength(2);
    // the shadow tax is measured, not applied: a sale now still pays 5 %
    sell(200);
    expect(r.ledger.reconcile()).toEqual([]);
  });

  it('a long downtime catches up a bounded number of weeks, an empty market reports nothing, and reports survive a restart', () => {
    const WEEK = MARKET_CONFIG.WEEK_MS;
    const empty = rig({ clockMs: 5 * WEEK });
    empty.market.tick();
    expect(empty.market.shadowReports()).toEqual([]);
    const r = rig({ clockMs: 5 * WEEK + 5 });
    r.stones('alice', 1000);
    r.stones('bob', 1000);
    r.give('alice', 'breakthrough_pill', 1);
    r.buy('bob', r.list('alice', r.slotOf('alice', BT_PILL), 1, 10).listingId);
    r.clock.ms += 60 * WEEK;
    r.market.tick();
    expect(r.market.shadowReports().length).toBe(MARKET_CONFIG.REPORT_CATCHUP_WEEKS);
    const again = rig({ store: r.store, ledger: r.ledger, invStore: r.invStore, clockMs: r.clock.ms });
    expect(again.market.shadowReports()).toEqual(r.market.shadowReports());
  });
});

describe('Vạn Bảo Lâu: conservation fuzz (seeded)', () => {
  /** a small deterministic generator (mulberry32) so a failure reproduces */
  const prng = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  it('after thousands of random list / buy / cancel / expire / restart steps: no item appears or disappears, no stone is minted, the ledger reconciles', () => {
    for (const seed of [1, 2, 3, 4]) {
      const rnd = prng(seed);
      let r = rig({ bagSlots: 12 });
      for (const n of NAMES) {
        r.stones(n, 5000);
        r.give(n, 'heal_pill', 40);
        r.give(n, 'breakthrough_pill', 10);
      }
      r.give('alice', 'blueprint_white_green', 1);
      const stonesBefore = circulating(r);
      const items = [HEAL, BT_PILL, BLUEPRINT];
      const totals = items.map((d) => r.itemCount(d));
      const pick = <T>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)]!;
      for (let step = 0; step < 600; step++) {
        const who = pick(NAMES);
        const op = rnd();
        if (op < 0.3) {
          const defId = pick(items);
          const slot = r.slotOf(who, defId);
          if (slot >= 0) r.list(who, slot, 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 400), pick([12, 24, 48]));
        } else if (op < 0.6) {
          const ids = listingIds(r.market);
          if (ids.length) r.buy(who, pick(ids));
        } else if (op < 0.75) {
          const ids = listingIds(r.market);
          if (ids.length) r.cancel(who, pick(ids));
        } else if (op < 0.88) {
          r.clock.ms += Math.floor(rnd() * 20) * 3_600_000;
          r.market.tick();
        } else if (op < 0.93) {
          r = (() => {
            r.inv.flushAll();
            const ledger = Ledger.restore(r.ledger.snapshot());
            return rig({ store: r.store, ledger, invStore: r.invStore, bagSlots: 12, clockMs: r.clock.ms });
          })();
        } else {
          r.search(who, { sort: pick([0, 1, 2, 3]), page: Math.floor(rnd() * 3) });
        }
        if (step % 25 === 0 || step === 599) {
          expect(r.ledger.reconcile(), `seed ${seed} step ${step}`).toEqual([]);
          expect(circulating(r), `seed ${seed} step ${step}: stones`).toBe(stonesBefore);
          items.forEach((d, k) => expect(r.itemCount(d), `seed ${seed} step ${step}: item ${d}`).toBe(totals[k]));
        }
      }
    }
  });
});
