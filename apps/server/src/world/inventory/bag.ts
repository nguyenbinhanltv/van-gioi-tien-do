/**
 * One character's bag (docs/23 §4.3, docs/26 §3.1, D77): a fixed number of slots, each empty, a STACK (`defId`, `quality`,
 * `qty` up to the def's stack limit) or one unique INSTANCE (quality, durability, affixes, version).
 *
 * Every mutating operation is all-or-nothing: it either applies completely or leaves the bag untouched and says why.
 * Deterministic: instance ids come from an injected generator, nothing reads a clock or a random source.
 * Durability is stored x100 (0..10000), docs/23 §4.3.
 */
import { itemDefById, type ItemDef } from './items.js';

export const DURABILITY_MAX = 10_000;

export interface StackSlot {
  kind: 'stack';
  defId: number;
  quality: number;
  qty: number;
}
export interface InstanceSlot {
  kind: 'instance';
  /** key into `Bag.instances` */
  id: string;
}
export type Slot = StackSlot | InstanceSlot;

export interface ItemInstance {
  id: string;
  defId: number;
  /** 0..5, the six qualities of D6 */
  quality: number;
  /** x100, 0..DURABILITY_MAX */
  durability: number;
  affixes: readonly string[];
  bound: boolean;
  /** bumped on every change (optimistic-concurrency check in the persistent store) */
  version: number;
}

/** What to put into a bag: a stackable quantity or one instance. */
export interface ItemGrant {
  defId: number;
  quality: number;
  qty: number;
}

export type BagFailure =
  'NO_SPACE' | 'UNKNOWN_ITEM' | 'BAD_QTY' | 'BAD_SLOT' | 'NOT_ENOUGH' | 'EMPTY_SLOT' | 'NOT_STACKABLE' | 'NOT_INSTANCE';
export type BagResult<T = void> = { ok: true; value: T } | { ok: false; reason: BagFailure };
const ok = <T>(value: T): BagResult<T> => ({ ok: true, value });
const fail = (reason: BagFailure): BagResult<never> => ({ ok: false, reason });

export interface BagSnapshot {
  slots: (Slot | null)[];
  instances: ItemInstance[];
}

export class Bag {
  readonly slots: (Slot | null)[];
  readonly instances = new Map<string, ItemInstance>();

  constructor(
    readonly capacity: number,
    private readonly newId: () => string,
  ) {
    this.slots = new Array<Slot | null>(capacity).fill(null);
  }

  // ------------------------------------------------------------------ queries
  count(defId: number, quality?: number): number {
    let n = 0;
    for (const s of this.slots) {
      if (!s) continue;
      if (s.kind === 'stack') {
        if (s.defId === defId && (quality === undefined || s.quality === quality)) n += s.qty;
      } else {
        const i = this.instances.get(s.id)!;
        if (i.defId === defId && (quality === undefined || i.quality === quality)) n += 1;
      }
    }
    return n;
  }
  freeSlots(): number {
    return this.slots.reduce((n, s) => n + (s ? 0 : 1), 0);
  }
  instanceAt(slot: number): ItemInstance | undefined {
    const s = this.slots[slot];
    return s && s.kind === 'instance' ? this.instances.get(s.id) : undefined;
  }

  /** Slots a grant would need beyond the room left in matching partial stacks (planning only, mutates nothing). */
  private plan(grant: ItemGrant, def: ItemDef): { fill: { slot: number; add: number }[]; newStacks: number[] } | null {
    if (def.kind === 'instance') {
      const free = this.slots.map((s, i) => (s ? -1 : i)).filter((i) => i >= 0);
      return free.length >= grant.qty ? { fill: [], newStacks: free.slice(0, grant.qty) } : null;
    }
    let left = grant.qty;
    const fill: { slot: number; add: number }[] = [];
    this.slots.forEach((s, i) => {
      if (
        left > 0 &&
        s &&
        s.kind === 'stack' &&
        s.defId === grant.defId &&
        s.quality === grant.quality &&
        s.qty < def.stackLimit
      ) {
        const add = Math.min(left, def.stackLimit - s.qty);
        fill.push({ slot: i, add });
        left -= add;
      }
    });
    const newStacks: number[] = [];
    for (let i = 0; i < this.slots.length && left > 0; i++) {
      if (this.slots[i]) continue;
      newStacks.push(i);
      left -= Math.min(left, def.stackLimit);
    }
    return left > 0 ? null : { fill, newStacks };
  }

  canAdd(grants: readonly ItemGrant[]): boolean {
    // plan on a scratch copy so several grants compete for the same free slots exactly like the real add
    const scratch = this.clone();
    for (const g of grants) if (!scratch.add(g).ok) return false;
    return true;
  }

  // ------------------------------------------------------------------ mutations (all-or-nothing)
  add(grant: ItemGrant): BagResult<{ slots: number[] }> {
    const def = itemDefById(grant.defId);
    if (!def) return fail('UNKNOWN_ITEM');
    if (
      !Number.isInteger(grant.qty) ||
      grant.qty < 1 ||
      !Number.isInteger(grant.quality) ||
      grant.quality < 0 ||
      grant.quality > 5
    )
      return fail('BAD_QTY');
    const p = this.plan(grant, def);
    if (!p) return fail('NO_SPACE');
    const touched: number[] = [];
    if (def.kind === 'instance') {
      for (const slot of p.newStacks) {
        const inst: ItemInstance = {
          id: this.newId(),
          defId: grant.defId,
          quality: grant.quality,
          durability: DURABILITY_MAX,
          affixes: [],
          bound: !def.tradable,
          version: 1,
        };
        this.instances.set(inst.id, inst);
        this.slots[slot] = { kind: 'instance', id: inst.id };
        touched.push(slot);
      }
      return ok({ slots: touched });
    }
    for (const f of p.fill) {
      (this.slots[f.slot] as StackSlot).qty += f.add;
      touched.push(f.slot);
    }
    let left = grant.qty - p.fill.reduce((n, f) => n + f.add, 0);
    for (const slot of p.newStacks) {
      const q = Math.min(left, def.stackLimit);
      this.slots[slot] = { kind: 'stack', defId: grant.defId, quality: grant.quality, qty: q };
      left -= q;
      touched.push(slot);
    }
    return ok({ slots: touched });
  }

  /** Remove `qty` of a stackable (all-or-nothing). Takes from the LAST slots first so early slots stay stable. */
  removeStack(defId: number, quality: number, qty: number): BagResult {
    const def = itemDefById(defId);
    if (!def) return fail('UNKNOWN_ITEM');
    if (def.kind !== 'stackable') return fail('NOT_STACKABLE');
    if (!Number.isInteger(qty) || qty < 1) return fail('BAD_QTY');
    if (this.count(defId, quality) < qty) return fail('NOT_ENOUGH');
    let left = qty;
    for (let i = this.slots.length - 1; i >= 0 && left > 0; i--) {
      const s = this.slots[i];
      if (!s || s.kind !== 'stack' || s.defId !== defId || s.quality !== quality) continue;
      const take = Math.min(left, s.qty);
      s.qty -= take;
      left -= take;
      if (s.qty === 0) this.slots[i] = null;
    }
    return ok(undefined);
  }

  /** Consume ONE unit of the stack in exactly `slot` (the slot the player picked, D90). */
  takeOne(slot: number): BagResult<{ defId: number; quality: number }> {
    if (!this.validSlot(slot)) return fail('BAD_SLOT');
    const s = this.slots[slot];
    if (!s) return fail('EMPTY_SLOT');
    if (s.kind !== 'stack') return fail('NOT_STACKABLE');
    s.qty -= 1;
    const out = { defId: s.defId, quality: s.quality };
    if (s.qty <= 0) this.slots[slot] = null;
    return ok(out);
  }

  /** Take `qty` units out of exactly `slot` (a stack; all-or-nothing). The market escrows a lot this way: the slot the player picked, not "any stack of that kind". */
  takeFromSlot(slot: number, qty: number): BagResult<{ defId: number; quality: number }> {
    if (!this.validSlot(slot)) return fail('BAD_SLOT');
    const s = this.slots[slot];
    if (!s) return fail('EMPTY_SLOT');
    if (s.kind !== 'stack') return fail('NOT_STACKABLE');
    if (!Number.isInteger(qty) || qty < 1) return fail('BAD_QTY');
    if (s.qty < qty) return fail('NOT_ENOUGH');
    s.qty -= qty;
    const out = { defId: s.defId, quality: s.quality };
    if (s.qty === 0) this.slots[slot] = null;
    return ok(out);
  }

  removeInstance(slot: number): BagResult<ItemInstance> {
    if (!this.validSlot(slot)) return fail('BAD_SLOT');
    const s = this.slots[slot];
    if (!s) return fail('EMPTY_SLOT');
    if (s.kind !== 'instance') return fail('NOT_INSTANCE');
    const inst = this.instances.get(s.id)!;
    this.instances.delete(s.id);
    this.slots[slot] = null;
    return ok(inst);
  }

  /** Move a slot onto another: same stack merges up to the limit, anything else swaps. Atomic by construction. */
  move(from: number, to: number): BagResult {
    if (!this.validSlot(from) || !this.validSlot(to)) return fail('BAD_SLOT');
    const a = this.slots[from];
    if (!a) return fail('EMPTY_SLOT');
    if (from === to) return ok(undefined);
    const b = this.slots[to];
    if (b && a.kind === 'stack' && b.kind === 'stack' && a.defId === b.defId && a.quality === b.quality) {
      const limit = itemDefById(a.defId)!.stackLimit;
      const room = limit - b.qty;
      if (room > 0) {
        const m = Math.min(room, a.qty);
        b.qty += m;
        a.qty -= m;
        if (a.qty === 0) this.slots[from] = null;
        return ok(undefined);
      }
    }
    this.slots[from] = b;
    this.slots[to] = a;
    return ok(undefined);
  }

  /** Wear: lowers durability (never below 0). Returns the new value. */
  loseDurability(slot: number, amountX100: number): BagResult<number> {
    const inst = this.instanceAt(slot);
    if (!this.validSlot(slot)) return fail('BAD_SLOT');
    if (!inst) return fail(this.slots[slot] ? 'NOT_INSTANCE' : 'EMPTY_SLOT');
    if (!Number.isInteger(amountX100) || amountX100 < 0) return fail('BAD_QTY');
    inst.durability = Math.max(0, inst.durability - amountX100);
    inst.version++;
    return ok(inst.durability);
  }

  // ------------------------------------------------------------------ snapshots / invariants
  private validSlot(i: number): boolean {
    return Number.isInteger(i) && i >= 0 && i < this.capacity;
  }
  snapshot(): BagSnapshot {
    return {
      slots: this.slots.map((s) => (s ? { ...s } : null)),
      instances: [...this.instances.values()].map((i) => ({ ...i, affixes: [...i.affixes] })),
    };
  }
  static restore(capacity: number, newId: () => string, snap: BagSnapshot): Bag {
    const bag = new Bag(capacity, newId);
    snap.slots.slice(0, capacity).forEach((s, i) => (bag.slots[i] = s ? { ...s } : null));
    for (const i of snap.instances) bag.instances.set(i.id, { ...i, affixes: [...i.affixes] });
    return bag;
  }
  clone(): Bag {
    return Bag.restore(this.capacity, this.newId, this.snapshot());
  }
  /** Internal consistency: stack sizes within limits, every instance slot points at exactly one instance and vice versa. */
  check(): string[] {
    const problems: string[] = [];
    const used = new Set<string>();
    this.slots.forEach((s, i) => {
      if (!s) return;
      if (s.kind === 'stack') {
        const def = itemDefById(s.defId);
        if (!def || def.kind !== 'stackable') problems.push(`slot ${i}: stack of non-stackable ${s.defId}`);
        else if (s.qty < 1 || s.qty > def.stackLimit)
          problems.push(`slot ${i}: qty ${s.qty} outside 1..${def.stackLimit}`);
      } else if (!this.instances.has(s.id)) problems.push(`slot ${i}: missing instance ${s.id}`);
      else if (used.has(s.id)) problems.push(`slot ${i}: instance ${s.id} in two slots`);
      else used.add(s.id);
    });
    for (const id of this.instances.keys()) if (!used.has(id)) problems.push(`instance ${id} is in no slot`);
    return problems;
  }
}
