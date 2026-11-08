/**
 * Client-side state of the visible bag (D79): applies the server's `inv_state`, builds `inv_cmd` messages and tracks which
 * commands still wait for their `inv_result`. Engine-free; the Cocos panel only reads this model and calls its command builders.
 *
 * The server is authoritative: the model never edits the bag locally. A move shows up when the next `inv_state` arrives.
 * In-game stone currencies only: no price / shop / real-money notions.
 */
import { CURRENCIES, isUsableItem, itemDefById, type Currency, type DropItem } from '@vgtd/shared';
import { InvOp, InvReason, type InvCmdMsg, type InvPending, type InvResultMsg, type InvSlot, type InvStateMsg } from '@vgtd/protocol';

export type WalletView = Readonly<Record<Currency, number>>;

export interface BagItemView {
  slot: number;
  kind: 'stack' | 'instance';
  defId: number;
  /** `DropItem` key of the definition, undefined for an id this client does not know (a newer server) */
  key: DropItem | undefined;
  quality: number;
  /** stacks: quantity; instances: 1 */
  qty: number;
  /** instances: 0..10000 (x100) */
  durability: number | null;
  bound: boolean;
}

export interface BagCommandResult {
  requestId: string;
  op: number;
  reason: InvReason;
  count: number;
}

/** 32 lowercase hex characters (a UUID-sized request id) from an injected random source. */
export function makeRequestId(rand: () => number): string {
  let s = '';
  for (let i = 0; i < 32; i++) s += Math.floor(rand() * 16).toString(16);
  return s;
}

const EMPTY_WALLET: WalletView = { LT_HA: 0, LT_TRUNG: 0, LT_THUONG: 0 };

export class BagModel {
  private _wallet: WalletView = EMPTY_WALLET;
  private _slots: readonly InvSlot[] = [];
  private _pending: readonly InvPending[] = [];
  private _states = 0;
  private readonly waiting = new Map<string, InvCmdMsg>();
  private _last: BagCommandResult | null = null;

  /** Number of `inv_state` messages applied (0 = nothing received yet). */
  get states(): number {
    return this._states;
  }
  get ready(): boolean {
    return this._states > 0;
  }
  get wallet(): WalletView {
    return this._wallet;
  }
  get slotCount(): number {
    return this._slots.length;
  }
  get pending(): readonly InvPending[] {
    return this._pending;
  }
  /** The newest command answer (for a toast), or null. */
  get lastResult(): BagCommandResult | null {
    return this._last;
  }
  /** Commands sent and not yet answered. */
  get waitingCount(): number {
    return this.waiting.size;
  }

  applyState(msg: InvStateMsg): void {
    const w = {} as Record<Currency, number>;
    CURRENCIES.forEach((c, i) => (w[c] = msg.wallet[i]!));
    this._wallet = w;
    this._slots = msg.slots;
    this._pending = msg.pending;
    this._states++;
  }

  /** An `inv_result` arrived: returns the command it answers (undefined for an unknown / already answered id). */
  applyResult(msg: InvResultMsg): InvCmdMsg | undefined {
    const cmd = this.waiting.get(msg.requestId);
    this.waiting.delete(msg.requestId);
    this._last = { requestId: msg.requestId, op: msg.op, reason: msg.reason, count: msg.count };
    return cmd;
  }

  itemAt(slot: number): BagItemView | null {
    const s = this._slots[slot];
    if (!s) return null;
    const def = itemDefById(s.defId);
    if (s.kind === 'stack') return { slot, kind: 'stack', defId: s.defId, key: def?.key, quality: s.quality, qty: s.qty, durability: null, bound: false };
    return { slot, kind: 'instance', defId: s.defId, key: def?.key, quality: s.quality, qty: 1, durability: s.durability, bound: s.bound };
  }
  freeSlots(): number {
    return this._slots.reduce((n, s) => n + (s ? 0 : 1), 0);
  }
  hasItem(slot: number): boolean {
    return !!this._slots[slot];
  }
  get pendingTotal(): number {
    return this._pending.reduce((n, p) => n + p.qty, 0);
  }

  /** Can slot `from` be moved onto `to` (locally checkable part only: the server re-validates)? */
  canMove(from: number, to: number): boolean {
    return from !== to && this.hasItem(from) && to >= 0 && to < this._slots.length;
  }

  /** Builds (and remembers) a move command, or null when it is obviously invalid. The caller sends it. */
  moveCmd(from: number, to: number, newId: () => string): InvCmdMsg | null {
    if (!this.canMove(from, to)) return null;
    const cmd: InvCmdMsg = { type: 'inv_cmd', requestId: newId(), op: InvOp.Move, from, to };
    this.waiting.set(cmd.requestId, cmd);
    return cmd;
  }

  /** Is the item in `slot` something the player can use (a stack of a usable kind)? The server re-validates. */
  canUse(slot: number): boolean {
    const it = this.itemAt(slot);
    return !!it && it.kind === 'stack' && isUsableItem(it.key);
  }

  /** Builds (and remembers) a use command for the stack in `slot`, or null when it is not usable. The caller sends it. */
  useCmd(slot: number, newId: () => string): InvCmdMsg | null {
    if (!this.canUse(slot)) return null;
    const cmd: InvCmdMsg = { type: 'inv_cmd', requestId: newId(), op: InvOp.Use, from: slot, to: 0 };
    this.waiting.set(cmd.requestId, cmd);
    return cmd;
  }

  /** The first slot (lowest index) holding a stack of item `key`, or null: the target of a quick-use key. */
  slotOfKey(key: string): number | null {
    for (let i = 0; i < this._slots.length; i++) {
      const it = this.itemAt(i);
      if (it && it.kind === 'stack' && it.key === key) return i;
    }
    return null;
  }

  /** Builds (and remembers) a claim-pending command, or null when nothing is pending. */
  claimCmd(newId: () => string): InvCmdMsg | null {
    if (this._pending.length === 0) return null;
    const cmd: InvCmdMsg = { type: 'inv_cmd', requestId: newId(), op: InvOp.ClaimPending, from: 0, to: 0 };
    this.waiting.set(cmd.requestId, cmd);
    return cmd;
  }

  /** The connection dropped: forget unanswered commands (the next session starts from a fresh `inv_state`). */
  reset(): void {
    this._wallet = EMPTY_WALLET;
    this._slots = [];
    this._pending = [];
    this._states = 0;
    this.waiting.clear();
    this._last = null;
  }
}

/** Short text for a refused command (UI toast). */
export function invReasonText(reason: number): string {
  switch (reason) {
    case InvReason.Ok:
      return 'ok';
    case InvReason.BadSlot:
      return 'bad slot';
    case InvReason.EmptySlot:
      return 'nothing in that slot';
    case InvReason.RateLimited:
      return 'too fast';
    case InvReason.NotReady:
      return 'bag not ready';
    case InvReason.NothingMoved:
      return 'nothing fits';
    case InvReason.NotUsable:
      return 'cannot be used';
    case InvReason.OnCooldown:
      return 'still cooling down';
    case InvReason.Dead:
      return 'you are dead';
    case InvReason.NothingToHeal:
      return 'HP is full';
    case InvReason.PillActive:
      return 'a pill is already waiting';
    default:
      return `refused (${reason})`;
  }
}
