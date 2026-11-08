/**
 * Server side of the visible bag (D79): builds `inv_state` for an owner, throttles it to at most one per tick, and answers
 * `inv_cmd` (move a slot onto another / claim the pending loot) with `inv_result`.
 *
 *  - commands only ever act on an ONLINE owner's live bag (`Bag.move`, `InventoryService.claimPending`), so they stay
 *    atomic and never touch the ledger; the client never sends items or amounts, only slot numbers;
 *  - every command carries a `requestId`: replaying it returns the first answer and applies nothing (docs/26 §4.1);
 *  - a per-owner token bucket on SIM time (not the wall clock) limits commands; a refused command is not remembered, so the
 *    client may retry it with the same id later.
 * Deterministic: no clocks, no randomness; owners are drained in sorted order.
 */
import { CURRENCIES } from '@vgtd/shared';
import {
  INV_LIMITS,
  InvOp,
  InvReason,
  type InvCmdMsg,
  type InvResultMsg,
  type InvSlot,
  type InvStateMsg,
} from '@vgtd/protocol';
import type { InventoryService } from './service.js';

export const INV_SYNC_CONFIG = {
  /** commands per second per owner (PLACEHOLDER, D79) */
  CMD_PER_S: 10,
  CMD_BURST: 10,
  /** remembered request ids per owner for replay answers */
  REQUESTS_KEPT: 64,
} as const;

interface OwnerCmdState {
  tokens: number;
  lastMs: number;
  seen: Map<string, InvResultMsg>;
}

export class InventorySync {
  private readonly dirty = new Set<string>();
  private readonly cmd = new Map<string, OwnerCmdState>();

  constructor(private readonly inventory: InventoryService) {}

  /** The owner's inventory changed: send a fresh `inv_state` before the end of this tick. */
  markDirty(owner: string): void {
    this.dirty.add(owner);
  }

  /** Owners with a pending `inv_state`, sorted; clears the set. */
  drain(): string[] {
    const out = [...this.dirty].sort();
    this.dirty.clear();
    return out;
  }

  /** Forget the per-owner command state when the last connection leaves. */
  forget(owner: string): void {
    this.cmd.delete(owner);
    this.dirty.delete(owner);
  }

  stateOf(owner: string): InvStateMsg {
    const bag = this.inventory.bagOf(owner);
    const wallet = CURRENCIES.map((c) => {
      const v = this.inventory.wallet(owner, c);
      return v > BigInt(Number.MAX_SAFE_INTEGER) ? Number.MAX_SAFE_INTEGER : Number(v);
    }) as unknown as [number, number, number];
    const slots: InvSlot[] = bag.slots.map((s) => {
      if (!s) return null;
      if (s.kind === 'stack')
        return { kind: 'stack', defId: s.defId, quality: s.quality, qty: Math.min(s.qty, INV_LIMITS.MAX_QTY) };
      const i = bag.instances.get(s.id)!;
      return { kind: 'instance', defId: i.defId, quality: i.quality, durability: i.durability, bound: i.bound };
    });
    const pending = this.inventory
      .pendingOf(owner)
      .slice(0, INV_LIMITS.MAX_PENDING)
      .map((p) => ({ defId: p.defId, quality: p.quality, qty: Math.min(p.qty, INV_LIMITS.MAX_QTY) })); // defence in depth: an encode error must never come from state
    return { type: 'inv_state', wallet, slots, pending };
  }

  private cmdState(owner: string, nowMs: number): OwnerCmdState {
    let st = this.cmd.get(owner);
    if (!st) {
      st = { tokens: INV_SYNC_CONFIG.CMD_BURST, lastMs: nowMs, seen: new Map() };
      this.cmd.set(owner, st);
    }
    return st;
  }

  handle(owner: string, msg: InvCmdMsg, nowMs: number): InvResultMsg {
    const reply = (reason: InvReason, count = 0): InvResultMsg => ({
      type: 'inv_result',
      requestId: msg.requestId,
      op: msg.op,
      reason,
      count,
    });
    if (!this.inventory.isOnline(owner)) return reply(InvReason.NotReady);
    const st = this.cmdState(owner, nowMs);
    const seen = st.seen.get(msg.requestId);
    if (seen) return seen; // replay: same answer, nothing applied, no token spent
    st.tokens = Math.min(
      INV_SYNC_CONFIG.CMD_BURST,
      st.tokens + ((nowMs - st.lastMs) / 1000) * INV_SYNC_CONFIG.CMD_PER_S,
    );
    st.lastMs = nowMs;
    if (st.tokens < 1) return reply(InvReason.RateLimited);
    st.tokens -= 1;

    let result: InvResultMsg;
    if (msg.op === InvOp.Move) {
      const bag = this.inventory.bagOf(owner);
      if (msg.from >= bag.capacity || msg.to >= bag.capacity) result = reply(InvReason.BadSlot);
      else {
        const r = bag.move(msg.from, msg.to);
        if (r.ok) {
          if (msg.from !== msg.to) this.markDirty(owner);
          result = reply(InvReason.Ok);
        } else result = reply(r.reason === 'EMPTY_SLOT' ? InvReason.EmptySlot : InvReason.BadSlot);
      }
    } else {
      const moved = this.inventory.claimPending(owner);
      if (moved > 0) this.markDirty(owner);
      result = reply(moved > 0 ? InvReason.Ok : InvReason.NothingMoved, Math.min(255, moved));
    }
    st.seen.set(msg.requestId, result);
    if (st.seen.size > INV_SYNC_CONFIG.REQUESTS_KEPT) st.seen.delete(st.seen.keys().next().value as string);
    return result;
  }
}
