/**
 * NPC sect "Sơn Môn Đại Phái" ("cold family", D98; docs/10 §7.1 P4, docs/24 reserved block 100-119 for `sect_*`). Same
 * `[ver][0x80][msgId u16][body]` envelope and strict fixed big-endian bodies as party.ts / friends.ts / chat.ts.
 *
 *   sect_cmd    C->S  one command: join / leave the sect (at the sect NPC), or buy library manual `manual` with Cống hiến
 *   sect_result S->C  answer to every sect_cmd (0 = done), so a refusal is never silent
 *   sect_state  S->C  membership, Cống hiến balance, where the NPC stands, and the library of this character's class (what it
 *                     costs, what is already owned); sent on join and after every change
 *
 * Cống hiến (CONG_HIEN) is an in-game currency kept in the double-entry ledger (docs/26); the wire only shows the balance. There is
 * nothing here about prices in money, shops, receipts or entitlements.
 */
import { SECT } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum SectOp {
  Join = 1,
  Leave = 2,
  /** buy the manual `manual` of the library list in `sect_state` */
  Buy = 3,
}

/** Why a sect_cmd was refused (0 = done). Wire-stable. */
export enum SectReason {
  Ok = 0,
  RateLimited = 1,
  /** the player is not in the world (yet) */
  NotReady = 2,
  /** not standing near the sect NPC */
  TooFar = 3,
  AlreadyMember = 4,
  NotMember = 5,
  /** the manual index is not in this character's library */
  NoSuchManual = 6,
  AlreadyOwned = 7,
  NotEnoughContribution = 8,
}

export const SECT_WIRE_LIMITS = { MAX_NAME_BYTES: 40 } as const;

export interface SectCmdMsg {
  type: 'sect_cmd';
  op: number;
  clientMsgId: number;
  /** Buy: index into the library of `sect_state` (0..MAX_MANUALS-1); 0 for the other ops */
  manual: number;
}
export interface SectResultMsg {
  type: 'sect_result';
  clientMsgId: number;
  reason: number;
}
export interface SectManualEntry {
  /** display name (the skill's name made readable) */
  name: string;
  /** character level at which the skill is meant to be learned (docs/11: `unlock.level_min`) */
  levelMin: number;
  /** price in Cống hiến */
  price: number;
  owned: boolean;
}
export interface SectStateMsg {
  type: 'sect_state';
  member: boolean;
  /** Cống hiến balance (u32, clamped) */
  contribution: number;
  /** position of the sect NPC, 1/32 tile like every position on the wire */
  npcQi: number;
  npcQj: number;
  /** the library for this character's class (docs/11 §5 "tome" skills), in a stable order; empty before the class is known */
  library: readonly SectManualEntry[];
}
export type SectClientMessage = SectCmdMsg;
export type SectServerMessage = SectResultMsg | SectStateMsg;
export type SectMessage = SectClientMessage | SectServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
const U32 = 0xffffffff;
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
  if (b.length > SECT_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${SECT_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  if (DEC.decode(b) !== x) throw new ProtocolError('malformed', `${what} is not valid Unicode text`);
  return x;
}
function bool(x: unknown, what: string): boolean {
  if (typeof x !== 'boolean') throw new ProtocolError('malformed', `${what} must be a boolean`);
  return x;
}

/** The normalised sect message for `o.type`, or null when it is not one. */
export function validateSectMessage(o: Rec): SectMessage | null {
  switch (o.type) {
    case 'sect_cmd': {
      const op = int(o.op, SectOp.Join, SectOp.Buy, 'op');
      const manual = int(o.manual, 0, SECT.MAX_MANUALS - 1, 'manual');
      if (op !== SectOp.Buy && manual !== 0) throw new ProtocolError('malformed', 'only buy takes a manual index');
      return { type: 'sect_cmd', op, clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'), manual };
    }
    case 'sect_result':
      return {
        type: 'sect_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        reason: int(o.reason, 0, 255, 'reason'),
      };
    case 'sect_state': {
      if (!Array.isArray(o.library) || o.library.length > SECT.MAX_MANUALS)
        throw new ProtocolError('range', `library must be an array of at most ${SECT.MAX_MANUALS}`);
      const library = o.library.map((x): SectManualEntry => {
        if (typeof x !== 'object' || x === null || Array.isArray(x))
          throw new ProtocolError('malformed', 'library entries must be objects');
        const m = x as Rec;
        return {
          name: name(m.name, 'name'),
          levelMin: int(m.levelMin, 0, 255, 'levelMin'),
          price: int(m.price, 0, U16, 'price'),
          owned: bool(m.owned, 'owned'),
        };
      });
      return {
        type: 'sect_state',
        member: bool(o.member, 'member'),
        contribution: int(o.contribution, 0, U32, 'contribution'),
        npcQi: int(o.npcQi, 0, U16, 'npcQi'),
        npcQj: int(o.npcQj, 0, U16, 'npcQj'),
        library,
      };
    }
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
  if (n > SECT_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${SECT_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
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

export function encodeSectBody(w: ColdWriter, m: SectMessage): void {
  switch (m.type) {
    case 'sect_cmd':
      w.u8(m.op);
      w.u16(m.clientMsgId);
      w.u8(m.manual);
      break;
    case 'sect_result':
      w.u16(m.clientMsgId);
      w.u8(m.reason);
      break;
    case 'sect_state':
      w.u8(m.member ? 1 : 0);
      w.u32(m.contribution);
      w.u16(m.npcQi);
      w.u16(m.npcQj);
      w.u8(m.library.length);
      for (const e of m.library) {
        writeName(w, e.name);
        w.u8(e.levelMin);
        w.u16(e.price);
        w.u8(e.owned ? 1 : 0);
      }
      break;
  }
}

export function decodeSectBody(r: ColdReader, type: SectMessage['type']): Rec {
  switch (type) {
    case 'sect_cmd':
      return { type, op: r.u8(), clientMsgId: r.u16(), manual: r.u8() };
    case 'sect_result':
      return { type, clientMsgId: r.u16(), reason: r.u8() };
    case 'sect_state': {
      const member = readFlag(r, 'member');
      const contribution = r.u32();
      const npcQi = r.u16();
      const npcQj = r.u16();
      const n = r.u8();
      if (n > SECT.MAX_MANUALS) throw new ProtocolError('range', 'too many library entries');
      const library: Rec[] = [];
      for (let i = 0; i < n; i++)
        library.push({ name: readName(r, 'name'), levelMin: r.u8(), price: r.u16(), owned: readFlag(r, 'owned') });
      return { type, member, contribution, npcQi, npcQj, library };
    }
  }
}
