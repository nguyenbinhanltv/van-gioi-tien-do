/**
 * Inventory ("cold family") messages: the bag and the stone wallet made visible to the client (D79, docs/23 §4.3, docs/26).
 * Same `[ver][0x80][msgId u16][body]` envelope and fixed big-endian bodies as `progression.ts`; ids 66-68 (60-65 are progression).
 *
 *   inv_state  S->C  the owner's whole inventory: wallet, bag slots, pending-loot entries (sent on join and after each change,
 *                    at most once per tick; the bag is small, so no deltas yet)
 *   inv_cmd    C->S  move one slot onto another, or claim the pending loot; carries a requestId (docs/26 §4.1 idempotency)
 *   inv_result S->C  answer to an inv_cmd (same requestId); replaying a requestId returns the same answer and applies nothing
 *
 * In-game stone currencies only: there are no price, shop or real-money fields. Strict canonical decode like the hot codec.
 */
import { CURRENCIES } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export const INV_LIMITS = {
  /** bag slots on the wire (u8); the server bag has fewer (INVENTORY_CONFIG.BAG_SLOTS) */
  MAX_SLOTS: 64,
  /** pending-loot entries on the wire (u8) */
  MAX_PENDING: 255,
  MAX_QUALITY: 5,
  MAX_QTY: 65535,
  /** durability x100, docs/23 §4.3 */
  MAX_DURABILITY: 10_000,
} as const;

export enum InvOp {
  Move = 1,
  ClaimPending = 2,
  /** consume one item of the stack in slot `from` (heal pill, breakthrough pill); `to` is 0 (D90) */
  Use = 3,
}

/** Why an inventory command was refused (0 = done). Values are wire-stable. */
export enum InvReason {
  Ok = 0,
  BadSlot = 1,
  EmptySlot = 2,
  RateLimited = 3,
  /** the player has no inventory loaded (or the node runs without one) */
  NotReady = 4,
  /** nothing to claim, or nothing fitted (claim) */
  NothingMoved = 5,
  /** Use: the item in that slot cannot be used (D90) */
  NotUsable = 6,
  /** Use: the item's shared cooldown is still running (heal pills: 8 s) */
  OnCooldown = 7,
  /** Use: the character is dead */
  Dead = 8,
  /** Use: HP is already full, nothing consumed */
  NothingToHeal = 9,
  /** Use: a breakthrough pill is already waiting for the next breakthrough attempt */
  PillActive = 10,
}

export type InvSlot =
  | null
  | { kind: 'stack'; defId: number; quality: number; qty: number }
  | { kind: 'instance'; defId: number; quality: number; durability: number; bound: boolean };
export interface InvPending {
  defId: number;
  quality: number;
  qty: number;
}

export interface InvStateMsg {
  type: 'inv_state';
  /** balances in CURRENCIES order (LT_HA, LT_TRUNG, LT_THUONG); safe integers, sent as float64 */
  wallet: readonly [number, number, number];
  slots: readonly InvSlot[];
  pending: readonly InvPending[];
}
export interface InvCmdMsg {
  type: 'inv_cmd';
  requestId: string;
  op: number;
  /** Move / Use: source slot; ClaimPending: 0 */
  from: number;
  /** Move: target slot; ClaimPending / Use: 0 */
  to: number;
}
export interface InvResultMsg {
  type: 'inv_result';
  requestId: string;
  op: number;
  reason: number;
  /** ClaimPending: pending entries moved into the bag; Move: 0 */
  count: number;
}
export type InvClientMessage = InvCmdMsg;
export type InvServerMessage = InvStateMsg | InvResultMsg;
export type InvMessage = InvClientMessage | InvServerMessage;

const REQUEST_ID_RE = /^[0-9a-f]{32}$/;
type Rec = Record<string, unknown>;
function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
function reqId(x: unknown): string {
  if (typeof x !== 'string' || !REQUEST_ID_RE.test(x))
    throw new ProtocolError('range', 'requestId must be 32 lowercase hex characters');
  return x;
}
const rec = (x: unknown, what: string): Rec => {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    throw new ProtocolError('malformed', `${what} must be an object`);
  return x as Rec;
};
const L = INV_LIMITS;

function slot(x: unknown, i: number): InvSlot {
  if (x === null) return null;
  const o = rec(x, `slots[${i}]`);
  if (o.kind === 'stack')
    return {
      kind: 'stack',
      defId: int(o.defId, 0, 65535, 'defId'),
      quality: int(o.quality, 0, L.MAX_QUALITY, 'quality'),
      qty: int(o.qty, 1, L.MAX_QTY, 'qty'),
    };
  if (o.kind === 'instance') {
    if (typeof o.bound !== 'boolean') throw new ProtocolError('malformed', 'bound must be a boolean');
    return {
      kind: 'instance',
      defId: int(o.defId, 0, 65535, 'defId'),
      quality: int(o.quality, 0, L.MAX_QUALITY, 'quality'),
      durability: int(o.durability, 0, L.MAX_DURABILITY, 'durability'),
      bound: o.bound,
    };
  }
  throw new ProtocolError('malformed', `slots[${i}].kind must be stack or instance`);
}

/** The normalised inventory message for `o.type`, or null when it is not one. */
export function validateInventoryMessage(o: Rec): InvMessage | null {
  switch (o.type) {
    case 'inv_state': {
      if (!Array.isArray(o.wallet) || o.wallet.length !== CURRENCIES.length)
        throw new ProtocolError('malformed', 'wallet must have 3 entries');
      const wallet = o.wallet.map((v, i) => {
        if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0)
          throw new ProtocolError('range', `wallet[${i}] must be a non-negative safe integer`);
        return v;
      }) as unknown as [number, number, number];
      if (!Array.isArray(o.slots) || o.slots.length > L.MAX_SLOTS)
        throw new ProtocolError('range', `slots must be an array of at most ${L.MAX_SLOTS}`);
      if (!Array.isArray(o.pending) || o.pending.length > L.MAX_PENDING)
        throw new ProtocolError('range', `pending must be an array of at most ${L.MAX_PENDING}`);
      return {
        type: 'inv_state',
        wallet,
        slots: o.slots.map((s, i) => slot(s, i)),
        pending: o.pending.map((p, i) => {
          const r = rec(p, `pending[${i}]`);
          return {
            defId: int(r.defId, 0, 65535, 'defId'),
            quality: int(r.quality, 0, L.MAX_QUALITY, 'quality'),
            qty: int(r.qty, 1, L.MAX_QTY, 'qty'),
          };
        }),
      };
    }
    case 'inv_cmd': {
      const op = int(o.op, InvOp.Move, InvOp.Use, 'op');
      const from = int(o.from, 0, L.MAX_SLOTS - 1, 'from');
      const to = int(o.to, 0, L.MAX_SLOTS - 1, 'to');
      if (op === InvOp.ClaimPending && (from !== 0 || to !== 0))
        throw new ProtocolError('malformed', 'claim_pending carries no slots');
      if (op === InvOp.Use && to !== 0) throw new ProtocolError('malformed', 'use carries only the source slot');
      return { type: 'inv_cmd', requestId: reqId(o.requestId), op, from, to };
    }
    case 'inv_result':
      return {
        type: 'inv_result',
        requestId: reqId(o.requestId),
        op: int(o.op, InvOp.Move, InvOp.Use, 'op'),
        reason: int(o.reason, 0, 255, 'reason'),
        count: int(o.count, 0, 255, 'count'),
      };
    default:
      return null;
  }
}

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
const bytesToHex = (b: Uint8Array): string => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');

export function encodeInventoryBody(w: ColdWriter, m: InvMessage): void {
  switch (m.type) {
    case 'inv_state':
      w.u8(m.slots.length);
      for (const v of m.wallet) w.f64(v);
      for (const s of m.slots) {
        if (!s) w.u8(0);
        else if (s.kind === 'stack') {
          w.u8(1);
          w.u16(s.defId);
          w.u8(s.quality);
          w.u16(s.qty);
        } else {
          w.u8(2);
          w.u16(s.defId);
          w.u8(s.quality);
          w.u16(s.durability);
          w.u8(s.bound ? 1 : 0);
        }
      }
      w.u8(m.pending.length);
      for (const p of m.pending) {
        w.u16(p.defId);
        w.u8(p.quality);
        w.u16(p.qty);
      }
      break;
    case 'inv_cmd':
      w.bytes(hexToBytes(m.requestId));
      w.u8(m.op);
      w.u8(m.from);
      w.u8(m.to);
      break;
    case 'inv_result':
      w.bytes(hexToBytes(m.requestId));
      w.u8(m.op);
      w.u8(m.reason);
      w.u8(m.count);
      break;
  }
}

export function decodeInventoryBody(r: ColdReader, type: InvMessage['type']): Rec {
  switch (type) {
    case 'inv_state': {
      const n = r.u8();
      if (n > L.MAX_SLOTS) throw new ProtocolError('range', 'too many slots');
      const wallet = [r.f64(), r.f64(), r.f64()];
      const slots: unknown[] = [];
      for (let i = 0; i < n; i++) {
        const k = r.u8();
        if (k === 0) slots.push(null);
        else if (k === 1) slots.push({ kind: 'stack', defId: r.u16(), quality: r.u8(), qty: r.u16() });
        else if (k === 2) {
          const defId = r.u16();
          const quality = r.u8();
          const durability = r.u16();
          const b = r.u8();
          if (b > 1) throw new ProtocolError('malformed', 'bound flag must be 0 or 1');
          slots.push({ kind: 'instance', defId, quality, durability, bound: b === 1 });
        } else throw new ProtocolError('malformed', `unknown slot kind ${k}`);
      }
      const np = r.u8();
      const pending: unknown[] = [];
      for (let i = 0; i < np; i++) pending.push({ defId: r.u16(), quality: r.u8(), qty: r.u16() });
      return { type, wallet, slots, pending };
    }
    case 'inv_cmd':
      return { type, requestId: bytesToHex(r.sub(16)), op: r.u8(), from: r.u8(), to: r.u8() };
    case 'inv_result':
      return { type, requestId: bytesToHex(r.sub(16)), op: r.u8(), reason: r.u8(), count: r.u8() };
  }
}
