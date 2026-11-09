/**
 * Inventory service and drop sink (D77): the destination of a kill's `DropRoll`s (docs/07 §6) on the World Node.
 *
 *  - stones are currency: one ledger transaction per kill moves value from the `SYSTEM_FAUCET_DROP_*` account into the
 *    owner's wallet (docs/26 §2-§3, never minted out of thin air);
 *  - every other item goes into the owner's bag; what does not fit waits in a bounded pending queue (`claimPending`) and
 *    only a full queue loses loot, which is reported in the result and counted, never silent;
 *  - a grant is identified by `killKey`: the same key for the same owner is a replay and applies nothing again.
 *
 * Owners are account ids (there are no characters yet). Deterministic: no clocks, no randomness. In-game stone currencies
 * only: no real-money, shop, price or entitlement logic.
 */
import { CURRENCIES, directTradeTaxUnits, type DropRoll, type DropSource } from '@vgtd/shared';
import { Bag, type ItemGrant, type ItemInstance } from './bag.js';
import { Ledger, LedgerError, type AccountKind, type AccountRef, type LedgerEntryInput } from './ledger.js';
import { STONE_CURRENCY, isStone, itemDefByKey, type Currency } from './items.js';
import { InMemoryInventoryStore, type InventorySnapshot, type InventoryStore, type PendingLoot } from './store.js';

/** PLACEHOLDERS (no doc fixes them, see docs/OPEN-ITEMS.md). */
export const INVENTORY_CONFIG = {
  BAG_SLOTS: 40,
  PENDING_MAX: 50,
  /** how many recent grant keys per service are remembered for replay detection */
  GRANT_KEYS_KEPT: 10_000,
  /** quantity one pending entry can hold: the wire carries it as a u16 (`INV_LIMITS.MAX_QTY`), the rest of a roll is lost and counted */
  PENDING_QTY_MAX: 65_535,
} as const;

const FAUCET: Record<DropSource, AccountKind> = {
  field: 'SYSTEM_FAUCET_DROP_MOB',
  elite: 'SYSTEM_FAUCET_DROP_ELITE',
  boss: 'SYSTEM_FAUCET_DROP_BOSS',
};

/** One crafting exchange (D108): destroy materials, pay the furnace fee, add the product, all or nothing. */
export interface CraftExchange {
  /** idempotency key, unique per craft (`character:request:index`): the same key replays and applies nothing again */
  key: string;
  /** the material stack (`craft_material`) and how many units to destroy now */
  materialDefId: number;
  consume: number;
  /** furnace fee in Linh thạch hạ (a sink: the stones are destroyed) */
  fee: bigint;
  /** the product, or null (a failed craft) */
  produce: ItemGrant | null;
}
export type CraftExchangeResult =
  { ok: true; replayed: boolean } | { ok: false; reason: 'NOT_ENOUGH_MATERIALS' | 'NOT_ENOUGH_STONES' | 'NO_SPACE' };

export type Placement = 'bag' | 'pending' | 'lost';
export interface GrantedItem {
  defId: number;
  quality: number;
  qty: number;
  where: Placement;
}
export interface GrantResult {
  /** true when this `killKey` had already been granted: nothing was applied now (the stored result is returned) */
  replayed: boolean;
  stones: { currency: Currency; amount: bigint }[];
  items: GrantedItem[];
}

/** One item line a player gives in a trade: a quantity of a stack, or one instance by its id. */
export type TradeLine =
  | { kind: 'stack'; defId: number; quality: number; qty: number }
  | { kind: 'instance'; id: string; defId: number; quality: number };
export interface ExchangeSide {
  owner: string;
  /** what this side GIVES */
  items: readonly TradeLine[];
  /** what this side GIVES, in `CURRENCIES` order (LT_HA, LT_TRUNG, LT_THUONG), smallest unit */
  stones: readonly bigint[];
}
export type ExchangeFailure =
  'OFFLINE' | 'ITEMS_CHANGED' | 'NO_SPACE_A' | 'NO_SPACE_B' | 'NOT_TRADABLE' | 'FUNDS_A' | 'FUNDS_B';
export type ExchangeResult =
  | { ok: true; tax: bigint[]; replayed: false }
  | { ok: true; tax: bigint[]; replayed: true }
  | { ok: false; reason: ExchangeFailure };

/**
 * Makes an in-memory multi-owner change durable as ONE unit with the ledger (D102): a file store implements it with a write-ahead journal
 * (`openFileStores().durable`). Without one (in-memory stores) there is nothing to make durable.
 */
export interface DurableCommit {
  commit(label: string): void;
}

export interface InventoryServiceOptions {
  store?: InventoryStore;
  durable?: DurableCommit;
  ledger?: Ledger;
  bagSlots?: number;
  pendingMax?: number;
}

interface OwnerState {
  bag: Bag;
  pending: PendingLoot[];
  seq: number;
  online: number;
}

export class InventoryService {
  readonly ledger: Ledger;
  readonly store: InventoryStore;
  /** loot lost because bag AND pending queue were full (quantity of items, cumulative) */
  lostItems = 0;
  /** durable commits that failed (a disk error): the data stays dirty in the store and the normal debounced write retries it */
  durableErrors = 0;
  private readonly durable: DurableCommit | undefined;
  private readonly owners = new Map<string, OwnerState>();
  private readonly listeners: ((owner: string) => void)[] = [];
  private readonly grants = new Map<string, GrantResult>();
  private readonly crafts = new Map<string, CraftExchangeResult>();
  private readonly bagSlots: number;
  private readonly pendingMax: number;

  constructor(opts: InventoryServiceOptions = {}) {
    this.ledger = opts.ledger ?? new Ledger();
    this.store = opts.store ?? new InMemoryInventoryStore();
    this.durable = opts.durable;
    this.bagSlots = opts.bagSlots ?? INVENTORY_CONFIG.BAG_SLOTS;
    this.pendingMax = opts.pendingMax ?? INVENTORY_CONFIG.PENDING_MAX;
  }

  // ------------------------------------------------------------------ lifecycle (World Node join / leave)
  /** Build an owner's state from the store WITHOUT keeping it in memory. */
  private fromStore(owner: string): OwnerState {
    const snap = this.store.load(owner);
    const st: OwnerState = { bag: undefined as unknown as Bag, pending: [], seq: 1, online: 0 };
    const newId = (): string => `${owner}#${st.seq++}`;
    if (snap) {
      st.bag = Bag.restore(this.bagSlots, newId, snap.bag);
      st.pending = snap.pending.map((p) => ({ ...p }));
      st.seq = snap.nextSeq;
    } else st.bag = new Bag(this.bagSlots, newId);
    return st;
  }
  /** Keep an owner in memory (online players only: saved and dropped again by `onLeave`). */
  private load(owner: string): OwnerState {
    const have = this.owners.get(owner);
    if (have) return have;
    const st = this.fromStore(owner);
    this.owners.set(owner, st);
    return st;
  }
  /**
   * Run a mutation. An online owner's state is the live cached one (saved when the last connection leaves); an OFFLINE
   * owner (for example a drop that resolves after the killer disconnected) is loaded for this one operation, written back
   * to the store immediately and not kept in memory, so offline changes are never lost and nothing leaks.
   */
  private mutate<T>(owner: string, fn: (st: OwnerState) => T): T {
    const cached = this.owners.get(owner);
    const st = cached ?? this.fromStore(owner);
    const result = fn(st);
    if (!cached) this.save(owner, st);
    return result;
  }
  private save(owner: string, st: OwnerState): void {
    const snap: InventorySnapshot = {
      v: 1,
      bag: st.bag.snapshot(),
      pending: st.pending.map((p) => ({ ...p })),
      nextSeq: st.seq,
    };
    this.store.save(owner, snap);
  }

  /** Called with the owner's id after every applied change to that owner's inventory or pending loot (wallet included). */
  subscribe(listener: (owner: string) => void): void {
    this.listeners.push(listener);
  }
  /**
   * Tell the listeners (the `inv_state` push) that something changed in the owner's WALLET without a bag change: a ledger transaction posted
   * by another module (a market sale paying the seller) moves stones but does not go through the bag, so nobody would refresh the HUD.
   */
  refresh(owner: string): void {
    this.notify(owner);
  }
  private notify(owner: string): void {
    for (const l of this.listeners) l(owner);
  }
  /** Does `owner` have a live connection (loaded in memory)? */
  isOnline(owner: string): boolean {
    return (this.owners.get(owner)?.online ?? 0) > 0;
  }

  /** A connection of `owner` joined (counted; loads the saved inventory on the first one). */
  onJoin(owner: string): void {
    this.load(owner).online++;
  }
  /** A connection left; the last one saves the inventory and unloads it. */
  onLeave(owner: string): void {
    const st = this.owners.get(owner);
    if (!st) return;
    if (--st.online > 0) return;
    this.flush(owner);
    this.owners.delete(owner);
  }
  flush(owner: string): void {
    const st = this.owners.get(owner);
    if (st) this.save(owner, st);
  }
  /** Save every loaded (online) owner: a clean shutdown calls this so a durable store has the latest bags. */
  flushAll(): void {
    for (const [owner, st] of this.owners) this.save(owner, st);
  }

  // ------------------------------------------------------------------ trade (D102)
  /**
   * Exchange items and stones between two ONLINE owners as ONE atomic step (docs/26 §5.5, all-or-nothing):
   *   1. both bags are copied; the given items are taken out of the copies and the received ones put in (a missing item, an untradable
   *      one or a full bag fails here, before anything real changed);
   *   2. the stones cross in ONE balanced ledger transaction `TRADE`, with the 3% tax (`directTradeTaxUnits`, rounded up, taken from what
   *      the receiver gets) booked to `SYSTEM_SINK_TRADE_TAX`; the ledger itself refuses an overdraft, again before anything changed;
   *   3. only then both live bags are replaced by the copies.
   * Everything is synchronous (no await between the checks and the swap), so no other change can slip in between. `key` makes a repeat
   * of the same trade a replay (the ledger answers; nothing is applied twice). Never throws for a rule failure.
   */
  exchange(key: string, a: ExchangeSide, b: ExchangeSide): ExchangeResult {
    const sa = this.owners.get(a.owner);
    const sb = this.owners.get(b.owner);
    if (!sa || !sb || a.owner === b.owner) return { ok: false, reason: 'OFFLINE' };
    const ca = sa.bag.clone();
    const cb = sb.bag.clone();
    // 1) items: take out of the giver's copy, remember what to hand over
    const take = (
      bag: Bag,
      lines: readonly TradeLine[],
    ): { grants: ItemGrant[]; insts: ItemInstance[] } | ExchangeFailure => {
      const grants: ItemGrant[] = [];
      const insts: ItemInstance[] = [];
      for (const l of lines) {
        if (l.kind === 'stack') {
          const r = bag.removeStack(l.defId, l.quality, l.qty);
          if (!r.ok) return r.reason === 'NOT_ENOUGH' ? 'ITEMS_CHANGED' : 'NOT_TRADABLE';
          grants.push({ defId: l.defId, quality: l.quality, qty: l.qty });
        } else {
          const slot = bag.slots.findIndex((s) => s?.kind === 'instance' && s.id === l.id);
          if (slot < 0) return 'ITEMS_CHANGED';
          const inst = bag.instanceAt(slot)!;
          if (inst.bound) return 'NOT_TRADABLE';
          const r = bag.removeInstance(slot);
          if (!r.ok) return 'ITEMS_CHANGED';
          insts.push(r.value);
        }
      }
      return { grants, insts };
    };
    const fromA = take(ca, a.items);
    if (typeof fromA === 'string') return { ok: false, reason: fromA };
    const fromB = take(cb, b.items);
    if (typeof fromB === 'string') return { ok: false, reason: fromB };
    // the receiver's copy: stackable grants first, then the instances (the same order every time)
    const give = (bag: Bag, got: { grants: ItemGrant[]; insts: ItemInstance[] }): boolean =>
      got.grants.every((g) => bag.add(g).ok) && got.insts.every((i) => bag.addInstance(i).ok);
    if (!give(ca, fromB)) return { ok: false, reason: 'NO_SPACE_A' };
    if (!give(cb, fromA)) return { ok: false, reason: 'NO_SPACE_B' };
    // 2) stones: one balanced transaction; wallet checks first so a refusal never leaves a half state
    const entries: LedgerEntryInput[] = [];
    const tax: bigint[] = CURRENCIES.map(() => 0n);
    const cross = (from: ExchangeSide, to: ExchangeSide): ExchangeFailure | null => {
      for (let c = 0; c < CURRENCIES.length; c++) {
        const amount = from.stones[c] ?? 0n;
        if (amount < 0n) return 'ITEMS_CHANGED';
        if (amount === 0n) continue;
        const cur = CURRENCIES[c]!;
        const t = directTradeTaxUnits(amount);
        tax[c] = tax[c]! + t;
        entries.push({ account: { kind: 'PLAYER_WALLET', ownerId: from.owner, currency: cur }, delta: -amount });
        if (amount - t > 0n)
          entries.push({ account: { kind: 'PLAYER_WALLET', ownerId: to.owner, currency: cur }, delta: amount - t });
        if (t > 0n)
          entries.push({ account: { kind: 'SYSTEM_SINK_TRADE_TAX', ownerId: null, currency: cur }, delta: t });
      }
      return null;
    };
    cross(a, b);
    cross(b, a);
    let replayed = false;
    if (entries.length > 0) {
      try {
        replayed = this.ledger.post({ reason: 'TRADE', idempotencyKey: key, entries }).replayed;
      } catch (e) {
        if (e instanceof LedgerError && e.code === 'INSUFFICIENT_FUNDS') {
          // which side could not pay: re-check each (no state changed yet)
          const short = (s: ExchangeSide): boolean =>
            CURRENCIES.some((cur, c) => this.wallet(s.owner, cur) < (s.stones[c] ?? 0n));
          return { ok: false, reason: short(a) ? 'FUNDS_A' : 'FUNDS_B' };
        }
        throw e;
      }
    }
    if (replayed) return { ok: true, tax, replayed: true };
    // 3) the swap: nothing below can fail
    sa.bag = ca;
    sb.bag = cb;
    // hand both bags to the store NOW (a file store writes within its debounce, together with the ledger tx booked above)
    this.save(a.owner, sa);
    this.save(b.owner, sb);
    // both bags and the ledger become durable as ONE unit (write-ahead journal): a crash can never leave one side paid and the other not
    try {
      this.durable?.commit(`exchange:${key}`);
    } catch {
      this.durableErrors++; // the trade stands in memory; the store keeps the documents dirty and retries them
    }
    this.notify(a.owner);
    this.notify(b.owner);
    return { ok: true, tax, replayed: false };
  }

  // ------------------------------------------------------------------ queries
  /** Number of owners currently held in memory (online players). */
  get loadedOwners(): number {
    return this.owners.size;
  }
  /**
   * The owner's bag. For an online owner this is the LIVE bag (changes are saved on leave). For an offline owner it is a
   * detached read-only copy loaded from the store: changes to it are NOT persisted (use `onJoin` first to mutate).
   */
  bagOf(owner: string): Bag {
    return (this.owners.get(owner) ?? this.fromStore(owner)).bag;
  }
  /**
   * Change an owner's bag in one synchronous step (the market escrows and delivers items this way). `fn` gets the live bag (online owner) or a
   * loaded copy that is written back at once (offline owner), and the pending-loot queue; whatever it does is kept, listeners are told. Throwing
   * from `fn` propagates: callers must check every precondition BEFORE mutating (the bag methods are all-or-nothing).
   */
  editBag<T>(owner: string, fn: (bag: Bag, pending: PendingLoot[]) => T): T {
    const result = this.mutate(owner, (st) => fn(st.bag, st.pending));
    this.notify(owner);
    return result;
  }
  /**
   * Give an owner an item WITHOUT ever losing it (the market returns an expired lot this way): the bag first, then the pending-loot queue
   * (claimed later like any loot that did not fit). 'none' = neither has room and nothing changed, the caller keeps the item and retries.
   * `instance` restores an instance's wear / affixes when it lands in the bag (the pending queue only keeps what the wire can carry).
   */
  deposit(
    owner: string,
    grant: ItemGrant,
    instance?: { durability: number; affixes: readonly string[] },
  ): 'bag' | 'pending' | 'none' {
    const where = this.mutate(owner, (st): 'bag' | 'pending' | 'none' => {
      const r = st.bag.add(grant);
      if (r.ok) {
        if (instance) {
          for (const slot of r.value.slots) {
            const inst = st.bag.instanceAt(slot);
            if (inst) {
              inst.durability = instance.durability;
              (inst as { affixes: readonly string[] }).affixes = [...instance.affixes];
            }
          }
        }
        return 'bag';
      }
      const same = st.pending.find((p) => p.defId === grant.defId && p.quality === grant.quality);
      if (same && same.qty + grant.qty <= INVENTORY_CONFIG.PENDING_QTY_MAX) {
        same.qty += grant.qty;
        return 'pending';
      }
      if (!same && st.pending.length < this.pendingMax && grant.qty <= INVENTORY_CONFIG.PENDING_QTY_MAX) {
        st.pending.push({ defId: grant.defId, quality: grant.quality, qty: grant.qty });
        return 'pending';
      }
      return 'none';
    });
    if (where !== 'none') this.notify(owner);
    return where;
  }
  pendingOf(owner: string): readonly PendingLoot[] {
    return (this.owners.get(owner) ?? this.fromStore(owner)).pending;
  }
  wallet(owner: string, currency: Currency): bigint {
    return this.ledger.balance({ kind: 'PLAYER_WALLET', ownerId: owner, currency });
  }

  // ------------------------------------------------------------------ the sink
  /**
   * Apply the rolls of one kill to `owner`. `killKey` must identify the kill (for example `mobId@tick`); granting the
   * same key twice for the same owner is a replay and changes nothing.
   */
  grantDrops(owner: string, rolls: readonly DropRoll[], source: DropSource, killKey: string): GrantResult {
    const gk = `${owner}|${killKey}`;
    const seen = this.grants.get(gk);
    if (seen) return { ...seen, replayed: true };
    const result = this.mutate(owner, (st) => this.applyGrant(owner, st, rolls, source, gk));
    this.notify(owner);
    return result;
  }

  private applyGrant(
    owner: string,
    st: OwnerState,
    rolls: readonly DropRoll[],
    source: DropSource,
    gk: string,
  ): GrantResult {
    // 1) stones -> one balanced ledger transaction
    const byCurrency = new Map<Currency, bigint>();
    for (const r of rolls) {
      if (!isStone(r.item) || r.qty < 1) continue;
      const cur = STONE_CURRENCY[r.item]!;
      byCurrency.set(cur, (byCurrency.get(cur) ?? 0n) + BigInt(r.qty));
    }
    const stones = [...byCurrency.entries()].map(([currency, amount]) => ({ currency, amount }));
    if (stones.length > 0) {
      const faucet = FAUCET[source];
      this.ledger.post({
        reason: 'DROP',
        idempotencyKey: `drop:${gk}`,
        entries: stones.flatMap(({ currency, amount }) => [
          { account: { kind: faucet, ownerId: null, currency } as AccountRef, delta: -amount },
          { account: { kind: 'PLAYER_WALLET', ownerId: owner, currency } as AccountRef, delta: amount },
        ]),
      });
    }

    // 2) items -> bag, else pending, else lost (reported)
    const items: GrantedItem[] = [];
    for (const r of rolls) {
      if (isStone(r.item) || r.qty < 1) continue;
      const def = itemDefByKey(r.item);
      if (!def) continue;
      const grant: ItemGrant = { defId: def.id, quality: r.quality ?? 0, qty: r.qty };
      if (st.bag.add(grant).ok) {
        items.push({ ...grant, where: 'bag' });
        continue;
      }
      // does not fit as a whole: keep the all-or-nothing rule and park the whole roll
      items.push({ ...grant, where: this.park(st, grant) });
    }

    const result: GrantResult = { replayed: false, stones, items };
    this.grants.set(gk, result);
    if (this.grants.size > INVENTORY_CONFIG.GRANT_KEYS_KEPT)
      this.grants.delete(this.grants.keys().next().value as string);
    return result;
  }

  private park(st: OwnerState, g: ItemGrant): Placement {
    const cap = INVENTORY_CONFIG.PENDING_QTY_MAX;
    const same = st.pending.find((p) => p.defId === g.defId && p.quality === g.quality);
    if (same) {
      const take = Math.min(g.qty, cap - same.qty);
      same.qty += take;
      this.lostItems += g.qty - take; // an entry never exceeds what the wire can carry
      return take > 0 ? 'pending' : 'lost';
    }
    if (st.pending.length >= this.pendingMax) {
      this.lostItems += g.qty;
      return 'lost';
    }
    const take = Math.min(g.qty, cap);
    this.lostItems += g.qty - take;
    st.pending.push({ defId: g.defId, quality: g.quality, qty: take });
    return 'pending';
  }

  // ------------------------------------------------------------------ crafting (D108)
  /** Remove `qty` units of a stackable across all its quality stacks (lowest quality first). The caller checked the count. */
  private takeMaterial(bag: Bag, defId: number, qty: number): void {
    let left = qty;
    for (let q = 0; q <= 5 && left > 0; q++) {
      const have = bag.count(defId, q);
      if (have === 0) continue;
      const take = Math.min(have, left);
      bag.removeStack(defId, q, take);
      left -= take;
    }
  }
  /**
   * Check a craft without changing anything: enough material, enough stones for the fee, room for the product once the materials are gone.
   * Used before the roll (so a craft that cannot complete is refused up front) and again inside `craftExchange`.
   */
  canCraft(
    owner: string,
    materialDefId: number,
    materials: number,
    fee: bigint,
    produce: ItemGrant | null,
  ): CraftExchangeResult {
    const bag = this.bagOf(owner);
    if (bag.count(materialDefId) < materials) return { ok: false, reason: 'NOT_ENOUGH_MATERIALS' };
    if (this.wallet(owner, 'LT_HA') < fee) return { ok: false, reason: 'NOT_ENOUGH_STONES' };
    if (produce) {
      const sim = bag.clone();
      this.takeMaterial(sim, materialDefId, materials);
      if (!sim.canAdd([produce])) return { ok: false, reason: 'NO_SPACE' };
    }
    return { ok: true, replayed: false };
  }
  /**
   * The atomic exchange of one craft: validated on a copy of the bag, the fee posted to the ledger (balanced: wallet -> `SYSTEM_SINK_CRAFT_FEE`),
   * then applied to the real bag, which cannot fail any more. Either everything happens or nothing does. A key that was already applied replays
   * its stored answer and changes nothing (docs/13 §6.2: no dupes).
   */
  craftExchange(owner: string, ex: CraftExchange): CraftExchangeResult {
    const gk = `${owner}|${ex.key}`;
    const seen = this.crafts.get(gk);
    if (seen) return seen.ok ? { ok: true, replayed: true } : seen;
    const result = this.mutate(owner, (st) => {
      if (st.bag.count(ex.materialDefId) < ex.consume) return { ok: false, reason: 'NOT_ENOUGH_MATERIALS' } as const;
      if (this.wallet(owner, 'LT_HA') < ex.fee) return { ok: false, reason: 'NOT_ENOUGH_STONES' } as const;
      const sim = st.bag.clone();
      this.takeMaterial(sim, ex.materialDefId, ex.consume);
      if (ex.produce && !sim.add(ex.produce).ok) return { ok: false, reason: 'NO_SPACE' } as const;
      if (ex.fee > 0n)
        this.ledger.post({
          reason: 'CRAFT',
          idempotencyKey: `craft:${gk}`,
          entries: [
            { account: { kind: 'PLAYER_WALLET', ownerId: owner, currency: 'LT_HA' }, delta: -ex.fee },
            { account: { kind: 'SYSTEM_SINK_CRAFT_FEE', ownerId: null, currency: 'LT_HA' }, delta: ex.fee },
          ],
        });
      this.takeMaterial(st.bag, ex.materialDefId, ex.consume);
      if (ex.produce) st.bag.add(ex.produce);
      return { ok: true, replayed: false } as const;
    });
    if (result.ok) {
      this.crafts.set(gk, result);
      if (this.crafts.size > INVENTORY_CONFIG.GRANT_KEYS_KEPT)
        this.crafts.delete(this.crafts.keys().next().value as string);
      // the bag and the ledger fee become durable as ONE unit (write-ahead journal, D102): a crash can never leave the fee paid without the product
      try {
        this.durable?.commit(`craft:${gk}`);
      } catch {
        this.durableErrors++; // the craft stands in memory; the store keeps the documents dirty and retries them
      }
      this.notify(owner);
    }
    return result;
  }

  /** Move pending loot into the bag as far as it fits (whole entries, oldest first). Returns how many entries moved. */
  claimPending(owner: string): number {
    const moved = this.claim(owner);
    if (moved > 0) this.notify(owner);
    return moved;
  }
  private claim(owner: string): number {
    return this.mutate(owner, (st) => {
      let moved = 0;
      const left: PendingLoot[] = [];
      for (const p of st.pending) {
        if (st.bag.add({ ...p }).ok) moved++;
        else left.push(p);
      }
      st.pending = left;
      return moved;
    });
  }
}
