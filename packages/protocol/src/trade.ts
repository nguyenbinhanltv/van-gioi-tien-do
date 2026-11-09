/**
 * Direct player trade ("cold family", D102; docs/10 §7.1 P4 "Giao dịch trực tiếp (thuế 3%)", docs/26 §5.5). Same `[ver][0x80][msgId u16][body]`
 * envelope and strict fixed big-endian bodies as party.ts / friends.ts / sect.ts. Ids 71-74 sit in the docs/24 `trade_*` block (70-75): 70 went to
 * the tribulation message of D97, and the six proposed trade messages are folded into four.
 *
 *   trade_cmd     C->S  one command: invite / accept / decline, put an item line or stones in the window, lock, confirm, cancel
 *   trade_result  S->C  answer to every trade_cmd (0 = done), so a refusal is never silent
 *   trade_invite  S->C  someone asks you to trade: who, and for how long (ms) it stays valid
 *   trade_state   S->C  the window (both sides' offers, locks, confirmations) after every change; phase 0 closes it, phase 2 = done
 *
 * The client never sends item ids or prices: an item line is "the stack / instance in my bag slot S, this many". Stones are in-game
 * currency (docs/26: LT_HA, LT_TRUNG, LT_THUONG, in that order); there is no real-money, price, shop or entitlement field.
 */
import { CURRENCIES, TRADE } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum TradeOp {
  Invite = 1,
  Accept = 2,
  Decline = 3,
  /** offer `qty` of the item in bag slot `slot`; qty 0 takes that item's line out of the window */
  SetItem = 4,
  /** offer `amount` of stone `currency` (0 = LT_HA, 1 = LT_TRUNG, 2 = LT_THUONG); 0 takes it back */
  SetStones = 5,
  /** step 1: "this is my final offer" (any change by either side undoes both locks) */
  Lock = 6,
  /** step 2: needs both sides locked; when both have confirmed the server executes the trade */
  Confirm = 7,
  Cancel = 8,
}

/** Why a trade_cmd was refused (0 = done). Wire-stable. */
export enum TradeReason {
  Ok = 0,
  RateLimited = 1,
  /** the player is not in the world (yet) */
  NotReady = 2,
  /** unknown or offline name: the answer never says which */
  NoSuchPlayer = 3,
  Self = 4,
  TooFar = 5,
  /** you are in a trade window already */
  AlreadyTrading = 6,
  /** the other player is in a trade window, or holds too many invites */
  TargetBusy = 7,
  /** accept / decline without a matching live invite */
  NoInvite = 8,
  /** a window command without an open window */
  NotTrading = 9,
  /** the bag slot is empty or out of range */
  BadSlot = 10,
  /** the item cannot be traded (bound) */
  NotTradable = 11,
  /** more item lines than the window holds */
  TooManyLines = 12,
  /** not that many of the item / not that many stones */
  NotEnough = 13,
  /** a currency index or an amount out of range */
  BadAmount = 14,
  /** confirm before both sides locked */
  NotLocked = 15,
  /** an offered item was used, dropped or moved away: the window was reset */
  ItemsChanged = 16,
  /** a bag has no room for what it would receive */
  NoSpace = 17,
  /** a side no longer has the stones it offered */
  NotEnoughStones = 18,
}

/** Why a window closed (in `trade_state` with phase 0). */
export enum TradeClosed {
  None = 0,
  Cancelled = 1,
  /** the other player left the world */
  PartnerLeft = 2,
  /** no change for `TRADE.IDLE_MS` */
  Expired = 3,
}

export enum TradePhase {
  Closed = 0,
  Open = 1,
  /** the trade was executed; `tax` says how much each currency paid */
  Done = 2,
}

export const TRADE_WIRE_LIMITS = { MAX_NAME_BYTES: 24 } as const;

export interface TradeCmdMsg {
  type: 'trade_cmd';
  op: number;
  clientMsgId: number;
  /** Invite: the player; Accept / Decline: the inviter ('' = the newest invite); other ops: '' */
  name: string;
  /** SetItem: bag slot (0-255) */
  slot: number;
  /** SetItem: quantity (0 = remove the line) */
  qty: number;
  /** SetStones: index into the stones (0..2) */
  currency: number;
  /** SetStones: amount (u32) */
  amount: number;
}
export interface TradeResultMsg {
  type: 'trade_result';
  clientMsgId: number;
  reason: number;
}
export interface TradeInviteMsg {
  type: 'trade_invite';
  fromName: string;
  ttlMs: number;
}
export interface TradeLineView {
  defId: number;
  quality: number;
  qty: number;
}
export interface TradeSideView {
  items: readonly TradeLineView[];
  /** in `CURRENCIES` order */
  stones: readonly number[];
  locked: boolean;
  confirmed: boolean;
}
export interface TradeStateMsg {
  type: 'trade_state';
  phase: number;
  /** why a phase-0 state closed the window */
  closed: number;
  partner: string;
  mine: TradeSideView;
  theirs: TradeSideView;
  /** phase Done: tax paid per currency (what the sink took), `CURRENCIES` order; else zeros */
  tax: readonly number[];
}
export type TradeClientMessage = TradeCmdMsg;
export type TradeServerMessage = TradeResultMsg | TradeInviteMsg | TradeStateMsg;
export type TradeMessage = TradeClientMessage | TradeServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
const U32 = 0xffffffff;
const NSTONE = CURRENCIES.length;
const ENC = new TextEncoder();
const DEC = new TextDecoder('utf-8', { fatal: true });

function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
function name(x: unknown, what: string): string {
  if (typeof x !== 'string') throw new ProtocolError('malformed', `${what} must be a string`);
  const b = ENC.encode(x);
  if (b.length > TRADE_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${TRADE_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  if (DEC.decode(b) !== x) throw new ProtocolError('malformed', `${what} is not valid Unicode text`);
  return x;
}
function bool(x: unknown, what: string): boolean {
  if (typeof x !== 'boolean') throw new ProtocolError('malformed', `${what} must be a boolean`);
  return x;
}
function rec(x: unknown, what: string): Rec {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    throw new ProtocolError('malformed', `${what} must be an object`);
  return x as Rec;
}
function stones(x: unknown, what: string): number[] {
  if (!Array.isArray(x) || x.length !== NSTONE)
    throw new ProtocolError('range', `${what} must be an array of ${NSTONE}`);
  return x.map((v) => int(v, 0, U32, what));
}
function side(x: unknown, what: string): TradeSideView {
  const o = rec(x, what);
  if (!Array.isArray(o.items) || o.items.length > TRADE.MAX_LINES)
    throw new ProtocolError('range', `${what}.items must be an array of at most ${TRADE.MAX_LINES}`);
  return {
    items: o.items.map((l) => {
      const r = rec(l, `${what}.items`);
      return {
        defId: int(r.defId, 0, U16, 'defId'),
        quality: int(r.quality, 0, 255, 'quality'),
        qty: int(r.qty, 1, U16, 'qty'),
      };
    }),
    stones: stones(o.stones, `${what}.stones`),
    locked: bool(o.locked, `${what}.locked`),
    confirmed: bool(o.confirmed, `${what}.confirmed`),
  };
}

/** The normalised trade message for `o.type`, or null when it is not one. */
export function validateTradeMessage(o: Rec): TradeMessage | null {
  switch (o.type) {
    case 'trade_cmd': {
      const op = int(o.op, TradeOp.Invite, TradeOp.Cancel, 'op');
      const nm = name(o.name, 'name');
      const slot = int(o.slot, 0, 255, 'slot');
      const qty = int(o.qty, 0, U16, 'qty');
      const currency = int(o.currency, 0, NSTONE - 1, 'currency');
      const amount = int(o.amount, 0, U32, 'amount');
      if (op === TradeOp.Invite && nm.length === 0) throw new ProtocolError('malformed', 'invite needs a name');
      if (op !== TradeOp.Invite && op !== TradeOp.Accept && op !== TradeOp.Decline && nm.length > 0)
        throw new ProtocolError('malformed', 'only invite / accept / decline take a name');
      if (op !== TradeOp.SetItem && (slot !== 0 || qty !== 0))
        throw new ProtocolError('malformed', 'only set-item takes a slot and a quantity');
      if (op !== TradeOp.SetStones && (currency !== 0 || amount !== 0))
        throw new ProtocolError('malformed', 'only set-stones takes a currency and an amount');
      return {
        type: 'trade_cmd',
        op,
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        name: nm,
        slot,
        qty,
        currency,
        amount,
      };
    }
    case 'trade_result':
      return {
        type: 'trade_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        reason: int(o.reason, 0, 255, 'reason'),
      };
    case 'trade_invite':
      return { type: 'trade_invite', fromName: name(o.fromName, 'fromName'), ttlMs: int(o.ttlMs, 0, U16, 'ttlMs') };
    case 'trade_state':
      return {
        type: 'trade_state',
        phase: int(o.phase, TradePhase.Closed, TradePhase.Done, 'phase'),
        closed: int(o.closed, TradeClosed.None, TradeClosed.Expired, 'closed'),
        partner: name(o.partner, 'partner'),
        mine: side(o.mine, 'mine'),
        theirs: side(o.theirs, 'theirs'),
        tax: stones(o.tax, 'tax'),
      };
    default:
      return null;
  }
}

function writeName(w: ColdWriter, s: string): void {
  const b = ENC.encode(s);
  w.u8(b.length);
  w.bytes(b);
}
function readName(r: ColdReader, what: string): string {
  const n = r.u8();
  if (n > TRADE_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${TRADE_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  try {
    return DEC.decode(r.sub(n));
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', `${what} is not valid UTF-8`);
  }
}
function readFlag(r: ColdReader, what: string): boolean {
  const v = r.u8();
  if (v > 1) throw new ProtocolError('malformed', `${what} flag must be 0 or 1`);
  return v === 1;
}
function writeSide(w: ColdWriter, s: TradeSideView): void {
  w.u8(s.items.length);
  for (const l of s.items) {
    w.u16(l.defId);
    w.u8(l.quality);
    w.u16(l.qty);
  }
  for (const v of s.stones) w.u32(v);
  w.u8(s.locked ? 1 : 0);
  w.u8(s.confirmed ? 1 : 0);
}
function readSide(r: ColdReader): Rec {
  const n = r.u8();
  if (n > TRADE.MAX_LINES) throw new ProtocolError('range', 'too many item lines');
  const items: Rec[] = [];
  for (let i = 0; i < n; i++) items.push({ defId: r.u16(), quality: r.u8(), qty: r.u16() });
  const st: number[] = [];
  for (let i = 0; i < NSTONE; i++) st.push(r.u32());
  return { items, stones: st, locked: readFlag(r, 'locked'), confirmed: readFlag(r, 'confirmed') };
}

export function encodeTradeBody(w: ColdWriter, m: TradeMessage): void {
  switch (m.type) {
    case 'trade_cmd':
      w.u8(m.op);
      w.u16(m.clientMsgId);
      writeName(w, m.name);
      w.u8(m.slot);
      w.u16(m.qty);
      w.u8(m.currency);
      w.u32(m.amount);
      break;
    case 'trade_result':
      w.u16(m.clientMsgId);
      w.u8(m.reason);
      break;
    case 'trade_invite':
      writeName(w, m.fromName);
      w.u16(m.ttlMs);
      break;
    case 'trade_state':
      w.u8(m.phase);
      w.u8(m.closed);
      writeName(w, m.partner);
      writeSide(w, m.mine);
      writeSide(w, m.theirs);
      for (const v of m.tax) w.u32(v);
      break;
  }
}

export function decodeTradeBody(r: ColdReader, type: TradeMessage['type']): Rec {
  switch (type) {
    case 'trade_cmd':
      return {
        type,
        op: r.u8(),
        clientMsgId: r.u16(),
        name: readName(r, 'name'),
        slot: r.u8(),
        qty: r.u16(),
        currency: r.u8(),
        amount: r.u32(),
      };
    case 'trade_result':
      return { type, clientMsgId: r.u16(), reason: r.u8() };
    case 'trade_invite':
      return { type, fromName: readName(r, 'fromName'), ttlMs: r.u16() };
    case 'trade_state': {
      const phase = r.u8();
      const closed = r.u8();
      const partner = readName(r, 'partner');
      const mine = readSide(r);
      const theirs = readSide(r);
      const tax: number[] = [];
      for (let i = 0; i < NSTONE; i++) tax.push(r.u32());
      return { type, phase, closed, partner, mine, theirs, tax };
    }
  }
}
