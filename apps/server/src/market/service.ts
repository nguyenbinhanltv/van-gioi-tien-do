/**
 * MarketService: Vạn Bảo Lâu, the basic auction house (D112; docs/10 §7.1 P4, docs/07 §7, docs/26 §5).
 *
 * ESCROW. Listing a lot takes the item OUT of the seller's bag in the same synchronous step that creates the listing, so an item is always
 * in exactly one place: a bag, or a listing (or, after an expiry that found no room, a `returning` listing). Buying, cancelling and expiring
 * move it from the listing to a bag in one step too. Everything below runs in ONE synchronous turn per command (no `await` between the checks
 * and the changes), so two commands can never interleave: the second of two buys of the same listing finds it gone.
 *
 * MONEY (docs/26 §2-§5). Every stone movement is a balanced ledger transaction with an idempotency key built from the listing id:
 *   list  seller wallet -fee, SYSTEM_SINK_LISTING_FEE +fee   (fee = ceil(1 % of the lot price), min 1, never refunded)
 *   sale  buyer wallet -price, seller wallet +(price - tax), SYSTEM_SINK_MARKET_TAX +tax   (tax = ceil(5 %), FIXED in beta)
 * All prices are hạ phẩm. The weekly CPI runs in SHADOW mode: `tick` computes it from the recent sales and reports what the dynamic tax
 * would have been; the applied tax never changes. In-game stone currency only: no real-money, shop-price or entitlement field exists here.
 *
 * ORDER OF OPERATIONS. Every command checks everything it needs first (listing, funds, bag room), then changes state; the ledger is posted
 * BEFORE the item moves, because a ledger post can be refused while a checked bag change cannot, and if the item step still fails the
 * ledger transaction is reversed by a second balanced transaction. A restart keeps the book (the whole snapshot is saved after every change).
 * Across a CRASH the three documents (listings, ledger, bags) are separate files: see `durable`, the hook where the transaction journal
 * (D102) makes the three one unit; without it a crash between two document writes can lose or duplicate value (docs/35, OPEN-ITEMS).
 *
 * ANTI-ABUSE. Every command takes a rate-limit token BEFORE any listing is looked up, so `NoSuchListing` (which also answers "not yours")
 * says nothing about other accounts' listings and cannot be probed at line rate. Listings per account are capped, prices are bounded so a
 * total fits the wire, only tradable and unbound items can be listed, an account cannot buy its own listing. Time enters through the rate
 * limiter (the simulation clock handed in by `WorldNode`) and through `now` (epoch ms, for expiry and the weekly report).
 */
import {
  ITEM_DEFS,
  MARKET_BOARD,
  MARKET_TAX_BETA_BPS,
  MARKET_BASKET,
  itemDefById,
  listingFeeInt,
  marketTaxInt,
  sellerProceedsInt,
  shadowTaxBps,
  weeklyCpi,
  type BasketWeek,
} from '@vgtd/shared';
import {
  MarketNoticeKind,
  MarketOp,
  MarketReason,
  MarketSort,
  MarketView,
  type MarketBuyMsg,
  type MarketCancelMsg,
  type MarketListMsg,
  type MarketListing,
  type MarketNoticeMsg,
  type MarketResultMsg,
  type MarketResultsMsg,
  type MarketSearchMsg,
  type MarketServerMessage,
} from '@vgtd/protocol';
import type { AccountDirectory } from '../friends/service.js';
import type { InventoryService } from '../world/inventory/service.js';
import type { Ledger, AccountRef, LedgerTx } from '../world/inventory/ledger.js';
import { MARKET_CONFIG } from './config.js';
import {
  InMemoryMarketStore,
  type Listing,
  type ListedItem,
  type MarketSnapshot,
  type MarketStore,
  type ShadowReport,
  type TradeRecord,
} from './store.js';

const CURRENCY = 'LT_HA' as const;

export interface MarketPeer {
  readonly entityId: number;
  readonly accountId: string;
}
export interface MarketHost {
  deliver(entityId: number, msg: MarketServerMessage): void;
}

export interface MarketServiceOptions {
  store?: MarketStore;
  ledger: Ledger;
  inventory: InventoryService;
  directory: AccountDirectory;
  /** epoch milliseconds (expiry, weekly report); default `Date.now`. Tests inject their own. */
  now?: () => number;
  /** called with every weekly SHADOW report (the server logs it; telemetry can subscribe). Must not throw. */
  report?: (r: ShadowReport) => void;
  /**
   * Called right after a command changed the market book (the caller has already saved it to the store) and before the reply is sent: the
   * place where a transaction journal makes the book, the ledger and the bags durable as ONE unit. May throw on a disk error: the in-memory
   * change stays (the debounced writes retry), the command still answers Ok.
   */
  durable?: (label: string) => void;
}

interface Bucket {
  tokens: number;
  at: number;
}

export interface MarketMetrics {
  listed: number;
  sold: number;
  cancelled: number;
  expired: number;
  /** hạ phẩm destroyed by the fee / the tax since start */
  feeBurned: number;
  taxBurned: number;
  /** hạ phẩm that changed hands between players (after tax) */
  volume: number;
  refused: Record<number, number>;
  /** a command whose second step failed after the first one and had to be reversed (should stay 0) */
  reversed: number;
  durableErrors: number;
}

const walletOf = (owner: string): AccountRef => ({ kind: 'PLAYER_WALLET', ownerId: owner, currency: CURRENCY });
const sink = (kind: 'SYSTEM_SINK_LISTING_FEE' | 'SYSTEM_SINK_MARKET_TAX'): AccountRef => ({
  kind,
  ownerId: null,
  currency: CURRENCY,
});

export class MarketService {
  readonly metrics: MarketMetrics = {
    listed: 0,
    sold: 0,
    cancelled: 0,
    expired: 0,
    feeBurned: 0,
    taxBurned: 0,
    volume: 0,
    refused: {},
    reversed: 0,
    durableErrors: 0,
  };
  private host: MarketHost | null = null;
  private readonly store: MarketStore;
  private readonly ledger: Ledger;
  private readonly inv: InventoryService;
  private readonly dir: AccountDirectory;
  private readonly now: () => number;
  private readonly report: ((r: ShadowReport) => void) | undefined;
  private readonly durable: ((label: string) => void) | undefined;
  private nextId = 1;
  private readonly listings = new Map<number, Listing>();
  private trades: TradeRecord[] = [];
  private reports: ShadowReport[] = [];
  private readonly peers = new Map<number, MarketPeer>();
  /** account -> its live sessions (entity ids, ascending) */
  private readonly sessions = new Map<string, number[]>();
  private readonly writeBuckets = new Map<string, Bucket>();
  private readonly searchBuckets = new Map<string, Bucket>();

  constructor(opts: MarketServiceOptions) {
    this.store = opts.store ?? new InMemoryMarketStore();
    this.ledger = opts.ledger;
    this.inv = opts.inventory;
    this.dir = opts.directory;
    this.now = opts.now ?? (() => Date.now());
    this.report = opts.report;
    this.durable = opts.durable;
    this.restore(this.store.load());
  }

  attach(host: MarketHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ persistence
  private restore(s: MarketSnapshot | undefined): void {
    if (!s) return;
    this.nextId = Math.max(1, s.nextId);
    for (const l of s.listings) {
      this.listings.set(l.id, structuredClone(l));
      this.nextId = Math.max(this.nextId, l.id + 1);
    }
    this.trades = s.trades.map((t) => ({ ...t }));
    this.reports = s.reports.map((r) => ({ ...r }));
  }

  /** Everything that must survive a restart. Stable order (by id), so an unchanged book is an unchanged document. */
  snapshot(): MarketSnapshot {
    return {
      v: 1,
      nextId: this.nextId,
      listings: [...this.listings.values()].sort((a, b) => a.id - b.id).map((l) => structuredClone(l)),
      trades: this.trades.map((t) => ({ ...t })),
      reports: this.reports.map((r) => ({ ...r })),
    };
  }
  private persist(label: string): void {
    this.store.save(this.snapshot());
    if (!this.durable) return;
    try {
      this.durable(label);
    } catch {
      this.metrics.durableErrors++; // the data stays dirty in the stores; the debounced writes retry it
    }
  }

  // ------------------------------------------------------------------ sessions
  join(peer: MarketPeer): void {
    this.peers.set(peer.entityId, peer);
    const list = this.sessions.get(peer.accountId) ?? [];
    list.push(peer.entityId);
    list.sort((a, b) => a - b);
    this.sessions.set(peer.accountId, list);
    // a lot that could not go back while its owner was away is retried now that there may be room
    if ([...this.listings.values()].some((l) => l.seller === peer.accountId && l.state === 'returning'))
      this.sweep(this.now());
  }
  leave(entityId: number): void {
    const p = this.peers.get(entityId);
    if (!p) return;
    this.peers.delete(entityId);
    const list = (this.sessions.get(p.accountId) ?? []).filter((e) => e !== entityId);
    if (list.length) this.sessions.set(p.accountId, list);
    else this.sessions.delete(p.accountId);
  }

  // ------------------------------------------------------------------ queries
  listingCount(): number {
    return this.listings.size;
  }
  /** One listing by id (tests, ops). */
  listing(id: number): Listing | undefined {
    const l = this.listings.get(id);
    return l ? structuredClone(l) : undefined;
  }
  activeCountOf(account: string): number {
    let n = 0;
    for (const l of this.listings.values()) if (l.seller === account && l.state === 'active') n++;
    return n;
  }
  /** Weekly SHADOW reports so far (oldest first). */
  shadowReports(): readonly ShadowReport[] {
    return this.reports;
  }

  // ------------------------------------------------------------------ commands
  /** One reply per command. A search answers with `market_results`, everything else with `market_result`. */
  handle(
    entityId: number,
    cmd: MarketSearchMsg | MarketListMsg | MarketBuyMsg | MarketCancelMsg,
    nowMs: number,
  ): MarketServerMessage {
    const refuse = (op: MarketOp, reason: MarketReason): MarketResultMsg => {
      this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return {
        type: 'market_result',
        clientMsgId: cmd.clientMsgId,
        op,
        reason,
        listingId: 'listingId' in cmd ? cmd.listingId : 0,
        amount: 0,
        tax: 0,
      };
    };
    const opOf =
      cmd.type === 'market_search'
        ? MarketOp.Search
        : cmd.type === 'market_list'
          ? MarketOp.List
          : cmd.type === 'market_buy'
            ? MarketOp.Buy
            : MarketOp.Cancel;
    const me = this.peers.get(entityId);
    if (!me || !this.host) return refuse(opOf, MarketReason.NotReady);
    // the token is spent BEFORE any listing is looked up: the answers below are facts about other accounts (anti-enumeration, #247)
    const bucket = cmd.type === 'market_search' ? this.searchBuckets : this.writeBuckets;
    const rate = cmd.type === 'market_search' ? MARKET_CONFIG.RATE_SEARCH : MARKET_CONFIG.RATE_WRITE;
    if (!this.take(bucket, rate, me.accountId, nowMs)) return refuse(opOf, MarketReason.RateLimited);
    switch (cmd.type) {
      case 'market_search':
        return this.search(me, cmd);
      case 'market_list':
        return this.list(me, cmd, refuse);
      case 'market_buy':
        return this.buy(me, cmd, refuse);
      case 'market_cancel':
        return this.cancel(me, cmd, refuse);
    }
  }

  // ---- search
  private search(me: MarketPeer, q: MarketSearchMsg): MarketResultsMsg {
    const now = this.now();
    const mine = q.view === MarketView.Mine;
    let rows = [...this.listings.values()].filter((l) => {
      if (mine) return l.seller === me.accountId;
      if (l.state !== 'active' || l.expiresAt <= now) return false;
      if (q.defId !== 0 && l.item.defId !== q.defId) return false;
      return l.item.quality >= q.minQuality;
    });
    const price = (l: Listing): number => l.unitPrice;
    switch (q.sort) {
      case MarketSort.PriceDesc:
        rows.sort((a, b) => price(b) - price(a) || a.id - b.id);
        break;
      case MarketSort.Newest:
        rows.sort((a, b) => b.listedAt - a.listedAt || b.id - a.id);
        break;
      case MarketSort.EndingSoon:
        rows.sort((a, b) => a.expiresAt - b.expiresAt || a.id - b.id);
        break;
      default:
        rows.sort((a, b) => price(a) - price(b) || a.id - b.id);
    }
    const total = rows.length;
    const page = Math.min(q.page, MARKET_BOARD.MAX_PAGE);
    rows = rows.slice(page * MARKET_BOARD.PAGE_SIZE, (page + 1) * MARKET_BOARD.PAGE_SIZE);
    const listings: MarketListing[] = rows.map((l) => ({
      listingId: l.id,
      defId: l.item.defId,
      quality: l.item.quality,
      qty: l.item.qty,
      unitPrice: l.unitPrice,
      seller: this.dir.nameOf(l.seller) ?? '?',
      minutesLeft: l.state === 'active' ? Math.max(0, Math.ceil((l.expiresAt - now) / 60_000)) : 0,
      mine: l.seller === me.accountId,
    }));
    return {
      type: 'market_results',
      clientMsgId: q.clientMsgId,
      view: q.view,
      page,
      total: Math.min(total, 0xffff),
      listings,
    };
  }

  // ---- list
  private list(
    me: MarketPeer,
    cmd: MarketListMsg,
    refuse: (op: MarketOp, r: MarketReason) => MarketResultMsg,
  ): MarketResultMsg {
    const op = MarketOp.List;
    if (!MARKET_BOARD.DURATIONS_H.includes(cmd.durationH)) return refuse(op, MarketReason.BadRequest);
    if (cmd.unitPrice < MARKET_BOARD.MIN_UNIT_PRICE) return refuse(op, MarketReason.BadRequest);
    const total = BigInt(cmd.unitPrice) * BigInt(cmd.qty);
    if (total > BigInt(MARKET_BOARD.MAX_TOTAL_PRICE)) return refuse(op, MarketReason.BadRequest);
    if (this.activeCountOf(me.accountId) >= MARKET_BOARD.MAX_LISTINGS_PER_ACCOUNT)
      return refuse(op, MarketReason.TooManyListings);

    // what is in the slot, checked WITHOUT changing anything
    const bag = this.inv.bagOf(me.accountId);
    const slot = bag.slots[cmd.slot];
    if (!slot) return refuse(op, MarketReason.NoItem);
    let item: ListedItem;
    if (slot.kind === 'stack') {
      const def = itemDefById(slot.defId);
      if (!def || !def.tradable) return refuse(op, MarketReason.NoItem);
      if (cmd.qty > slot.qty) return refuse(op, MarketReason.NoItem);
      item = { defId: slot.defId, quality: slot.quality, qty: cmd.qty };
    } else {
      const inst = bag.instances.get(slot.id);
      const def = inst ? itemDefById(inst.defId) : undefined;
      if (!inst || !def || !def.tradable || inst.bound) return refuse(op, MarketReason.NoItem);
      if (cmd.qty !== 1) return refuse(op, MarketReason.BadRequest);
      item = {
        defId: inst.defId,
        quality: inst.quality,
        qty: 1,
        instance: { durability: inst.durability, affixes: [...inst.affixes] },
      };
    }
    const fee = listingFeeInt(total);
    if (this.ledger.balance(walletOf(me.accountId)) < fee) return refuse(op, MarketReason.NoFunds);

    // ---- commit (one synchronous turn): fee first (it can be refused, the bag step cannot), then the item, then the book
    const id = this.nextId++;
    const feeTx: LedgerTx = {
      reason: 'MARKET_LISTING_FEE',
      idempotencyKey: `market:list:${id}`,
      entries: [
        { account: walletOf(me.accountId), delta: -fee },
        { account: sink('SYSTEM_SINK_LISTING_FEE'), delta: fee },
      ],
    };
    try {
      this.ledger.post(feeTx);
    } catch {
      return refuse(op, MarketReason.NoFunds);
    }
    const taken = this.inv.editBag(me.accountId, (b) =>
      item.instance ? b.removeInstance(cmd.slot).ok : b.takeFromSlot(cmd.slot, cmd.qty).ok,
    );
    if (!taken) {
      this.reverse(feeTx, `market:list-undo:${id}`);
      return refuse(op, MarketReason.NoItem);
    }
    const now = this.now();
    this.listings.set(id, {
      id,
      seller: me.accountId,
      item,
      unitPrice: cmd.unitPrice,
      listedAt: now,
      expiresAt: now + cmd.durationH * 3_600_000,
      state: 'active',
    });
    this.metrics.listed++;
    this.metrics.feeBurned += Number(fee);
    this.persist(`market:list:${id}`);
    return {
      type: 'market_result',
      clientMsgId: cmd.clientMsgId,
      op,
      reason: MarketReason.Ok,
      listingId: id,
      amount: Number(fee),
      tax: 0,
    };
  }

  // ---- buy
  private buy(
    me: MarketPeer,
    cmd: MarketBuyMsg,
    refuse: (op: MarketOp, r: MarketReason) => MarketResultMsg,
  ): MarketResultMsg {
    const op = MarketOp.Buy;
    const l = this.listings.get(cmd.listingId);
    const now = this.now();
    if (!l || l.state !== 'active' || l.expiresAt <= now) return refuse(op, MarketReason.NoSuchListing);
    if (l.seller === me.accountId) return refuse(op, MarketReason.SelfBuy);
    const total = BigInt(l.unitPrice) * BigInt(l.item.qty);
    if (this.ledger.balance(walletOf(me.accountId)) < total) return refuse(op, MarketReason.NoFunds);
    const grant = { defId: l.item.defId, quality: l.item.quality, qty: l.item.qty };
    if (!this.inv.bagOf(me.accountId).canAdd([grant])) return refuse(op, MarketReason.NoSpace);

    // ---- commit (one synchronous turn). The price is the one on the listing record, never one the client saw.
    const tax = marketTaxInt(total, MARKET_TAX_BETA_BPS);
    const proceeds = sellerProceedsInt(total, MARKET_TAX_BETA_BPS);
    const saleTx: LedgerTx = {
      reason: 'MARKET_SALE',
      idempotencyKey: `market:sale:${l.id}`,
      entries: [
        { account: walletOf(me.accountId), delta: -total },
        ...(proceeds > 0n ? [{ account: walletOf(l.seller), delta: proceeds }] : []),
        { account: sink('SYSTEM_SINK_MARKET_TAX'), delta: total - proceeds },
      ],
    };
    let replayed = false;
    try {
      replayed = this.ledger.post(saleTx).replayed;
    } catch {
      return refuse(op, MarketReason.NoFunds);
    }
    // a replay means this listing id was already paid for once: never hand the item out a second time
    if (replayed) {
      this.listings.delete(l.id);
      this.persist(`market:sale-replay:${l.id}`);
      return refuse(op, MarketReason.NoSuchListing);
    }
    const where = this.inv.deposit(me.accountId, grant, l.item.instance);
    if (where === 'none') {
      this.reverse(saleTx, `market:sale-undo:${l.id}`);
      return refuse(op, MarketReason.NoSpace);
    }
    this.listings.delete(l.id);
    this.trades.push({
      at: now,
      defId: l.item.defId,
      quality: l.item.quality,
      qty: l.item.qty,
      unitPrice: l.unitPrice,
      total: Number(total),
      tax: Number(tax),
    });
    if (this.trades.length > MARKET_CONFIG.TRADES_KEPT)
      this.trades.splice(0, this.trades.length - MARKET_CONFIG.TRADES_KEPT);
    this.metrics.sold++;
    this.metrics.taxBurned += Number(tax);
    this.metrics.volume += Number(proceeds);
    this.persist(`market:sale:${l.id}`);
    this.inv.refresh(l.seller); // the proceeds are a ledger posting, not a bag change: push the new wallet to the seller's HUD
    this.notify(l.seller, {
      type: 'market_notice',
      kind: MarketNoticeKind.Sold,
      listingId: l.id,
      defId: l.item.defId,
      quality: l.item.quality,
      qty: l.item.qty,
      amount: Number(proceeds),
    });
    return {
      type: 'market_result',
      clientMsgId: cmd.clientMsgId,
      op,
      reason: MarketReason.Ok,
      listingId: l.id,
      amount: Number(total),
      tax: Number(tax),
    };
  }

  // ---- cancel
  private cancel(
    me: MarketPeer,
    cmd: MarketCancelMsg,
    refuse: (op: MarketOp, r: MarketReason) => MarketResultMsg,
  ): MarketResultMsg {
    const op = MarketOp.Cancel;
    const l = this.listings.get(cmd.listingId);
    // somebody else's listing answers exactly like a missing one
    if (!l || l.seller !== me.accountId || l.state !== 'active') return refuse(op, MarketReason.NoSuchListing);
    const where = this.inv.deposit(
      me.accountId,
      { defId: l.item.defId, quality: l.item.quality, qty: l.item.qty },
      l.item.instance,
    );
    if (where === 'none') return refuse(op, MarketReason.NoSpace); // the listing stays: nothing was lost, nothing changed
    this.listings.delete(l.id);
    this.metrics.cancelled++;
    this.persist(`market:cancel:${l.id}`);
    return {
      type: 'market_result',
      clientMsgId: cmd.clientMsgId,
      op,
      reason: MarketReason.Ok,
      listingId: l.id,
      amount: 0,
      tax: 0,
    };
  }

  // ------------------------------------------------------------------ time
  /**
   * Expire listings that ran out, retry lots that could not go back, and write the weekly shadow report. The host calls it about once a
   * second (`WorldNode` every 20th tick); it is cheap when there is nothing to do.
   */
  tick(): void {
    const now = this.now();
    this.sweep(now);
    this.weeklyReport(now);
  }

  /** Expired and `returning` listings go back to their seller (bag, else pending loot); a lot with nowhere to go stays and is retried. */
  private sweep(now: number): void {
    let changed = false;
    for (const l of [...this.listings.values()]) {
      if (l.state === 'active' && l.expiresAt > now) continue;
      const where = this.inv.deposit(
        l.seller,
        { defId: l.item.defId, quality: l.item.quality, qty: l.item.qty },
        l.item.instance,
      );
      if (where === 'none') {
        if (l.state === 'active') {
          l.state = 'returning';
          changed = true;
        }
        continue;
      }
      this.listings.delete(l.id);
      this.metrics.expired++;
      changed = true;
      this.notify(l.seller, {
        type: 'market_notice',
        kind: MarketNoticeKind.Expired,
        listingId: l.id,
        defId: l.item.defId,
        quality: l.item.quality,
        qty: l.item.qty,
        amount: 0,
      });
    }
    if (changed) this.persist('market:expire');
  }

  private basketWeek(week: number): BasketWeek {
    const from = week * MARKET_CONFIG.WEEK_MS;
    const to = from + MARKET_CONFIG.WEEK_MS;
    const acc: Record<string, { value: number; units: number }> = {};
    for (const t of this.trades) {
      if (t.at < from || t.at >= to) continue;
      const key = ITEM_DEFS.find((d) => d.id === t.defId)?.key;
      if (!key || !(MARKET_BASKET as readonly string[]).includes(key)) continue;
      const a = (acc[key] ??= { value: 0, units: 0 });
      a.value += t.total;
      a.units += t.qty;
    }
    const out: BasketWeek = {};
    for (const [k, a] of Object.entries(acc)) out[k] = { avgUnitPrice: a.value / a.units, units: a.units };
    return out;
  }

  /** SHADOW CPI (docs/10 §7.1, docs/07 §7): for every completed week not yet reported, what the dynamic tax would have been. Never applied. */
  private weeklyReport(now: number): void {
    const completed = Math.floor(now / MARKET_CONFIG.WEEK_MS) - 1;
    if (this.trades.length === 0 && this.reports.length === 0) return;
    const firstTrade = this.trades.length ? Math.floor(this.trades[0]!.at / MARKET_CONFIG.WEEK_MS) : completed;
    let next = this.reports.length ? this.reports[this.reports.length - 1]!.week + 1 : firstTrade;
    next = Math.max(next, completed - MARKET_CONFIG.REPORT_CATCHUP_WEEKS + 1);
    let changed = false;
    for (let w = next; w <= completed; w++) {
      const cur = this.basketWeek(w);
      const cpi = weeklyCpi(this.basketWeek(w - 1), cur);
      const inWeek = this.trades.filter((t) => Math.floor(t.at / MARKET_CONFIG.WEEK_MS) === w);
      const r: ShadowReport = {
        week: w,
        cpi: cpi ?? null,
        appliedBps: MARKET_TAX_BETA_BPS,
        shadowBps: cpi === undefined ? MARKET_TAX_BETA_BPS : shadowTaxBps(cpi),
        trades: inWeek.length,
        volume: inWeek.reduce((a, t) => a + t.total, 0),
      };
      this.reports.push(r);
      if (this.reports.length > MARKET_CONFIG.REPORTS_KEPT) this.reports.shift();
      changed = true;
      try {
        this.report?.(r);
      } catch {
        /* a report sink must never stop the market */
      }
    }
    if (changed) this.persist('market:shadow');
  }

  // ------------------------------------------------------------------ helpers
  /** Undo a ledger transaction with an exactly opposite one (only for a second step that failed after the first one: should never happen). */
  private reverse(tx: LedgerTx, key: string): void {
    this.metrics.reversed++;
    this.ledger.post({
      reason: tx.reason,
      idempotencyKey: key,
      entries: tx.entries.map((e) => ({ account: e.account, delta: -e.delta })),
    });
  }

  private notify(account: string, msg: MarketNoticeMsg): void {
    if (!this.host) return;
    for (const e of this.sessions.get(account) ?? []) this.host.deliver(e, msg);
  }

  /** Token bucket per account: `burst` tokens, one refilled every `refillMs`. */
  private take(
    buckets: Map<string, Bucket>,
    rate: { refillMs: number; burst: number },
    accountId: string,
    nowMs: number,
  ): boolean {
    const b = buckets.get(accountId) ?? { tokens: rate.burst, at: nowMs };
    b.tokens = Math.min(rate.burst, b.tokens + Math.max(0, nowMs - b.at) / rate.refillMs);
    b.at = nowMs;
    buckets.set(accountId, b);
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }
}
