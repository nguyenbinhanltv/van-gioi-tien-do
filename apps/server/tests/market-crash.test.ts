/**
 * Vạn Bảo Lâu crash safety (D112 + D102): the market, the ledger and the bags are three documents; the write-ahead journal makes every list /
 * buy / cancel / expiry ONE unit. Each test kills the process at a given journal stage (the `crash` hook of `TxJournal`: the process "dies" exactly
 * there, nothing after it runs), reopens the data directory like a restart, and checks conservation: every item is in exactly one place, the
 * stones balance, the state is entirely BEFORE or entirely AFTER the command (never half), and a lot can never be bought twice.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itemDefByKey } from '@vgtd/shared';
import { MarketReason, type MarketResultMsg } from '@vgtd/protocol';
import {
  InventoryService,
  MARKET_CONFIG,
  MarketService,
  openFileStores,
  type FileStores,
  type JournalStage,
} from '../src/index.js';

const HEAL = itemDefByKey('heal_pill')!.id;
const NAMES = ['alice', 'bob', 'carol'];
const acc = (n: string): string => `acc-${n}`;
const STAGES: JournalStage[] = ['before-journal', 'journal-written', 'applied-1', 'applied-2', 'applied-3', 'done'];

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vgtd-market-crash-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

class Killed extends Error {}

interface World {
  stores: FileStores;
  inv: InventoryService;
  market: MarketService;
  clock: { ms: number };
  /** the next journal commit dies at this stage (null = none) */
  arm(stage: JournalStage | null): void;
  list(name: string, qty: number, unit: number): MarketResultMsg;
  buy(name: string, id: number): MarketResultMsg;
  cancel(name: string, id: number): MarketResultMsg;
  items(): number;
  stones(): bigint;
  holders(): string[];
}

/** open the data directory with the real services on top of the real file stores and the real journal */
function open(onlineNames: string[] = NAMES, clockMs = 1_000_000_000): World {
  let crashAt: JournalStage | null = null;
  const stores = openFileStores(dir, {
    flushMs: -1,
    crash: (stage) => {
      if (stage === crashAt) throw new Killed(`killed at ${stage}`);
    },
  });
  const inv = new InventoryService({ store: stores.inventories, ledger: stores.ledger, durable: stores.durable });
  const clock = { ms: clockMs };
  const market = new MarketService({
    store: stores.market,
    ledger: stores.ledger,
    inventory: inv,
    directory: {
      idOf: (n) => (NAMES.includes(n) ? acc(n) : undefined),
      nameOf: (id) => (id.startsWith('acc-') ? id.slice(4) : undefined),
    },
    now: () => clock.ms,
    durable: (label) => stores.durableMarket.commit(label),
  });
  market.attach({ deliver: () => undefined });
  onlineNames.forEach((n, i) => {
    inv.onJoin(acc(n));
    market.join({ entityId: i + 1, accountId: acc(n) });
  });
  let msg = 0;
  let sim = 100_000;
  const next = (): number => (sim += 4 * MARKET_CONFIG.RATE_WRITE.refillMs);
  const e = (n: string): number => NAMES.indexOf(n) + 1;
  const w: World = {
    stores,
    inv,
    market,
    clock,
    arm: (s) => (crashAt = s),
    list: (n, qty, unit) => {
      const bag = inv.bagOf(acc(n));
      const slot = bag.slots.findIndex((s) => s?.kind === 'stack' && s.defId === HEAL);
      return market.handle(
        e(n),
        { type: 'market_list', clientMsgId: ++msg, slot, qty, unitPrice: unit, durationH: 24 },
        next(),
      ) as MarketResultMsg;
    },
    buy: (n, id) =>
      market.handle(e(n), { type: 'market_buy', clientMsgId: ++msg, listingId: id }, next()) as MarketResultMsg,
    cancel: (n, id) =>
      market.handle(e(n), { type: 'market_cancel', clientMsgId: ++msg, listingId: id }, next()) as MarketResultMsg,
    items: () => {
      let n = 0;
      for (const name of NAMES)
        n +=
          inv.bagOf(acc(name)).count(HEAL) +
          inv.pendingOf(acc(name)).reduce((a, p) => a + (p.defId === HEAL ? p.qty : 0), 0);
      for (const l of market.snapshot().listings) if (l.item.defId === HEAL) n += l.item.qty;
      return n;
    },
    stones: () => {
      let t = 0n;
      for (const name of NAMES) t += inv.wallet(acc(name), 'LT_HA');
      for (const kind of ['SYSTEM_SINK_LISTING_FEE', 'SYSTEM_SINK_MARKET_TAX'] as const)
        t += stores.ledger.balance({ kind, ownerId: null, currency: 'LT_HA' });
      return t;
    },
    holders: () => {
      const where: string[] = [];
      for (const name of NAMES)
        if (inv.bagOf(acc(name)).count(HEAL) > 0) where.push(`bag:${name}=${inv.bagOf(acc(name)).count(HEAL)}`);
      for (const l of market.snapshot().listings) where.push(`listing:${l.id}=${l.item.qty}`);
      return where;
    },
  };
  return w;
}

/** the baseline: alice has 20 heal pills and 100 stones, bob and carol 5000 stones; everything durable on disk before the experiment */
function baseline(): void {
  const w = open();
  w.inv.grantDrops(
    acc('alice'),
    [
      { item: 'stone_ha', qty: 100 },
      { item: 'heal_pill', qty: 20 },
    ],
    'elite',
    'seed-a',
  );
  w.inv.grantDrops(acc('bob'), [{ item: 'stone_ha', qty: 5000 }], 'elite', 'seed-b');
  w.inv.grantDrops(acc('carol'), [{ item: 'stone_ha', qty: 5000 }], 'elite', 'seed-c');
  w.inv.flushAll();
  w.stores.flush();
}

/** "restart": a brand new process on the same directory (journal recovery runs inside openFileStores); players are offline, bags load from disk */
function restart(): World {
  return open([]);
}

describe('crash injection: a kill at ANY journal stage leaves the market whole', () => {
  for (const stage of STAGES) {
    it(`list killed at ${stage}: the lot is either still in alice's bag or entirely on the market, the fee matches, nothing duplicated`, () => {
      baseline();
      const w = open();
      const stones0 = w.stones();
      const items0 = w.items();
      w.arm(stage);
      const res = w.list('alice', 10, 100); // the commit dies at `stage`; the market swallows it (counted), exactly like a process kill from the outside
      expect(res.reason).toBe(MarketReason.Ok);
      expect(w.market.metrics.durableErrorsByOp.list).toBe(1);

      const r = restart();
      expect(r.stores.ledger.reconcile()).toEqual([]);
      expect(r.items()).toBe(items0); // one place, whatever the stage
      expect(r.stones()).toBe(stones0); // burn into a sink, never a vanish
      const listings = r.market.snapshot().listings;
      const committed = stage !== 'before-journal'; // the journal exists from `journal-written` on, recovery rolls it forward
      expect(listings.length).toBe(committed ? 1 : 0);
      expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(committed ? 10 : 20);
      expect(r.inv.wallet(acc('alice'), 'LT_HA')).toBe(committed ? 90n : 100n);
      if (committed) expect(r.stores.recovered ?? 'done').toBeTruthy();
    });

    it(`buy killed at ${stage}: all-or-nothing between listing, stones and bag, and the lot can never be bought twice`, () => {
      baseline();
      const w0 = open();
      const listed = w0.list('alice', 10, 100);
      expect(listed.reason).toBe(MarketReason.Ok);
      w0.inv.flushAll();
      w0.stores.flush(); // the listing is durable
      const stones0 = w0.stones();
      const items0 = w0.items();
      const w = restart();
      w.inv.onJoin(acc('bob'));
      w.market.join({ entityId: 2, accountId: acc('bob') });
      w.arm(stage);
      expect(w.buy('bob', listed.listingId).reason).toBe(MarketReason.Ok);
      expect(w.market.metrics.durableErrorsByOp.sale).toBe(1);

      const r = restart();
      expect(r.stores.ledger.reconcile()).toEqual([]);
      expect(r.items()).toBe(items0);
      expect(r.stones()).toBe(stones0);
      const sold = stage !== 'before-journal';
      expect(r.market.snapshot().listings.length).toBe(sold ? 0 : 1);
      expect(r.inv.bagOf(acc('bob')).count(HEAL)).toBe(sold ? 10 : 0);
      expect(r.inv.wallet(acc('bob'), 'LT_HA')).toBe(sold ? 4000n : 5000n);
      expect(r.inv.wallet(acc('alice'), 'LT_HA')).toBe(sold ? 90n + 950n : 90n);
      // the item is in exactly one place
      expect(r.holders().filter((x) => x.startsWith('bag:bob') || x.startsWith('listing')).length).toBe(1);

      // after the restart anybody tries to buy it (again): at most ONE purchase of the lot ever succeeds
      r.inv.onJoin(acc('bob'));
      r.market.join({ entityId: 2, accountId: acc('bob') });
      r.inv.onJoin(acc('carol'));
      r.market.join({ entityId: 3, accountId: acc('carol') });
      const again = [r.buy('bob', listed.listingId).reason, r.buy('carol', listed.listingId).reason];
      expect(again.filter((x) => x === MarketReason.Ok).length).toBe(sold ? 0 : 1);
      expect(r.items()).toBe(items0);
      expect(r.stones()).toBe(stones0);
      expect(r.stores.ledger.reconcile()).toEqual([]);
    });

    it(`cancel killed at ${stage}: the lot is back in alice's bag or still on sale, never both and never neither`, () => {
      baseline();
      const w0 = open();
      const listed = w0.list('alice', 10, 100);
      w0.inv.flushAll();
      w0.stores.flush();
      const stones0 = w0.stones();
      const items0 = w0.items();
      const w = restart();
      w.inv.onJoin(acc('alice'));
      w.market.join({ entityId: 1, accountId: acc('alice') });
      w.arm(stage);
      expect(w.cancel('alice', listed.listingId).reason).toBe(MarketReason.Ok);
      expect(w.market.metrics.durableErrorsByOp.cancel).toBe(1);

      const r = restart();
      expect(r.stores.ledger.reconcile()).toEqual([]);
      expect(r.items()).toBe(items0);
      expect(r.stones()).toBe(stones0); // the listing fee is never refunded
      const cancelled = stage !== 'before-journal';
      expect(r.market.snapshot().listings.length).toBe(cancelled ? 0 : 1);
      expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(cancelled ? 20 : 10);
      expect(r.holders().length).toBe(cancelled ? 1 : 2);
    });
  }

  it('expiry killed at every stage returns the lot exactly once', () => {
    for (const stage of STAGES) {
      rmSync(dir, { recursive: true, force: true });
      dir = mkdtempSync(join(tmpdir(), 'vgtd-market-crash-'));
      baseline();
      const w0 = open();
      const listed = w0.list('alice', 10, 100);
      w0.inv.flushAll();
      w0.stores.flush();
      const items0 = w0.items();
      const w = open(['alice'], w0.clock.ms + 25 * 3_600_000);
      w.arm(stage);
      w.market.tick();
      expect(listed.reason).toBe(MarketReason.Ok);
      const r = open([], w0.clock.ms + 25 * 3_600_000);
      expect(r.items(), stage).toBe(items0);
      expect(r.stores.ledger.reconcile(), stage).toEqual([]);
      const back = stage !== 'before-journal';
      expect(r.market.snapshot().listings.length, stage).toBe(back ? 0 : 1);
      expect(r.inv.bagOf(acc('alice')).count(HEAL), stage).toBe(back ? 20 : 10);
      r.market.tick(); // a lot still on the book comes back on the first sweep after the restart
      expect(r.market.snapshot().listings.length, stage).toBe(0);
      expect(r.inv.bagOf(acc('alice')).count(HEAL), stage).toBe(20);
    }
  });
});

describe('the journal commit is what makes it durable (and an error is counted, logged, not hidden)', () => {
  it('without a clean flush the committed command is still there after a "kill" right after it (no debounced write needed)', () => {
    baseline();
    const w = open();
    const res = w.list('alice', 10, 100);
    expect(res.reason).toBe(MarketReason.Ok);
    expect(w.market.metrics.durableCommits).toBe(1);
    // NO flush: the debounced writes never ran (flushMs -1); the journal alone carried the commit to disk
    expect(existsSync(join(dir, 'journal.json'))).toBe(false); // finished and deleted
    const r = restart();
    expect(r.market.snapshot().listings).toHaveLength(1);
    expect(r.inv.bagOf(acc('alice')).count(HEAL)).toBe(10);
    expect(r.inv.wallet(acc('alice'), 'LT_HA')).toBe(90n);
    expect(r.stores.ledger.reconcile()).toEqual([]);
  });

  it('a failing commit answers Ok, is counted per operation and reported to onDurableError; the stores keep the data dirty and retry', () => {
    baseline();
    let crashAt: JournalStage | null = null;
    const stores = openFileStores(dir, {
      flushMs: -1,
      crash: (s) => {
        if (s === crashAt) throw new Error('disk full');
      },
    });
    const inv = new InventoryService({ store: stores.inventories, ledger: stores.ledger, durable: stores.durable });
    const errors: Array<[string, string]> = [];
    const market = new MarketService({
      store: stores.market,
      ledger: stores.ledger,
      inventory: inv,
      directory: { idOf: () => undefined, nameOf: (id) => id.slice(4) },
      now: () => 1_000_000_000,
      durable: (l) => stores.durableMarket.commit(l),
      onDurableError: (label, e) => errors.push([label, (e as Error).message]),
    });
    market.attach({ deliver: () => undefined });
    inv.onJoin(acc('alice'));
    market.join({ entityId: 1, accountId: acc('alice') });
    crashAt = 'journal-written';
    const slot = inv.bagOf(acc('alice')).slots.findIndex((s) => s?.kind === 'stack');
    const res = market.handle(
      1,
      { type: 'market_list', clientMsgId: 1, slot, qty: 5, unitPrice: 10, durationH: 24 },
      1_000_000,
    ) as MarketResultMsg;
    expect(res.reason).toBe(MarketReason.Ok);
    expect(errors).toEqual([[`market:list:${res.listingId}`, 'disk full']]);
    expect(market.metrics.durableErrors).toBe(1);
    expect(market.metrics.durableErrorsByOp).toEqual({ list: 1 });
    expect(stores.journalPending()).toBe(true); // finished before the next write, never rolled forward over newer data
    crashAt = null;
    stores.flush(); // the retry: the journal is settled, the documents written
    expect(stores.journalPending()).toBe(false);
    const copy = mkdtempSync(join(tmpdir(), 'vgtd-market-crash-copy-'));
    try {
      cpSync(dir, copy, { recursive: true });
      const r = openFileStores(copy, { flushMs: -1 });
      expect(r.market.load()!.listings).toHaveLength(1);
    } finally {
      rmSync(copy, { recursive: true, force: true });
    }
  });
});
