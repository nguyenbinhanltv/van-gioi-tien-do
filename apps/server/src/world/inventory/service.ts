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
import type { DropRoll, DropSource } from '@vgtd/shared';
import { Bag, type ItemGrant } from './bag.js';
import { Ledger, type AccountKind, type AccountRef } from './ledger.js';
import { STONE_CURRENCY, isStone, itemDefByKey, type Currency } from './items.js';
import { InMemoryInventoryStore, type InventorySnapshot, type InventoryStore, type PendingLoot } from './store.js';

/** PLACEHOLDERS (no doc fixes them, see docs/OPEN-ITEMS.md). */
export const INVENTORY_CONFIG = {
  BAG_SLOTS: 40,
  PENDING_MAX: 50,
  /** how many recent grant keys per service are remembered for replay detection */
  GRANT_KEYS_KEPT: 10_000,
} as const;

const FAUCET: Record<DropSource, AccountKind> = {
  field: 'SYSTEM_FAUCET_DROP_MOB',
  elite: 'SYSTEM_FAUCET_DROP_ELITE',
  boss: 'SYSTEM_FAUCET_DROP_BOSS',
};

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

export interface InventoryServiceOptions {
  store?: InventoryStore;
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
  private readonly owners = new Map<string, OwnerState>();
  private readonly listeners: ((owner: string) => void)[] = [];
  private readonly grants = new Map<string, GrantResult>();
  private readonly bagSlots: number;
  private readonly pendingMax: number;

  constructor(opts: InventoryServiceOptions = {}) {
    this.ledger = opts.ledger ?? new Ledger();
    this.store = opts.store ?? new InMemoryInventoryStore();
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
    const same = st.pending.find((p) => p.defId === g.defId && p.quality === g.quality);
    if (same) {
      same.qty += g.qty;
      return 'pending';
    }
    if (st.pending.length >= this.pendingMax) {
      this.lostItems += g.qty;
      return 'lost';
    }
    st.pending.push({ defId: g.defId, quality: g.quality, qty: g.qty });
    return 'pending';
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
