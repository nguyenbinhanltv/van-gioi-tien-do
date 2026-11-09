/**
 * Party ("cold family", D92; docs/10 §7.1 P4). Same `[ver][0x80][msgId u16][body]` envelope and strict fixed big-endian bodies as chat.ts.
 *
 *   party_cmd     C->S  one command: op, clientMsgId (echoed in the result), other player's name (invite / kick / which invite to answer)
 *   party_result  S->C  answer to every party_cmd (0 = done), so a refusal is never silent
 *   party_invite  S->C  someone invited you: who, and for how long (ms) it stays valid
 *   party_state   S->C  the roster whenever it changes (0 members = you are in no party); the leader's entity id is explicit
 *   party_vitals  S->C  members' HP / MP, a few times a second while in a party
 *
 * The party channel itself is `ChatChannel.Party` of chat_send / chat_msg (chat.ts).
 */
import { PARTY } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum PartyOp {
  Invite = 1,
  Accept = 2,
  Decline = 3,
  Leave = 4,
  Kick = 5,
}

/** Why a party_cmd was refused (0 = done). Wire-stable. */
export enum PartyReason {
  Ok = 0,
  RateLimited = 1,
  /** unknown or offline name: the answer never says which */
  NoSuchPlayer = 2,
  /** inviting / kicking yourself */
  Self = 3,
  /** the party already has PARTY.MAX_SIZE members */
  PartyFull = 4,
  /** the invited player is already in a party */
  TargetInParty = 5,
  /** only the leader may invite or kick */
  NotLeader = 6,
  /** leave / kick while in no party, or the named player is not in your party */
  NotInParty = 7,
  /** accept / decline without a matching live invite */
  NoInvite = 8,
  /** already in a party, so you cannot accept another invite */
  AlreadyInParty = 9,
  /** the target holds too many pending invites already, or you already invited them */
  TooManyInvites = 10,
  /** the player is not in the world (yet) */
  NotReady = 11,
}

export const PARTY_WIRE_LIMITS = {
  MAX_NAME_BYTES: 24,
} as const;

export interface PartyCmdMsg {
  type: 'party_cmd';
  op: number;
  clientMsgId: number;
  /** Invite / Kick: the player's name; Accept / Decline: the inviter's name ('' = the newest invite); Leave: '' */
  name: string;
}
export interface PartyResultMsg {
  type: 'party_result';
  clientMsgId: number;
  reason: number;
}
export interface PartyInviteMsg {
  type: 'party_invite';
  fromName: string;
  /** ms the invite stays valid, counted from receipt */
  ttlMs: number;
}
export interface PartyMember {
  entityId: number;
  name: string;
  /** class wire id (1..6), as in EnterEntity.defId of a player */
  classId: number;
}
export interface PartyStateMsg {
  type: 'party_state';
  /** entity id of the leader (0 when the roster is empty) */
  leaderId: number;
  members: readonly PartyMember[];
}
export interface PartyVital {
  entityId: number;
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
}
export interface PartyVitalsMsg {
  type: 'party_vitals';
  members: readonly PartyVital[];
}
export type PartyClientMessage = PartyCmdMsg;
export type PartyServerMessage = PartyResultMsg | PartyInviteMsg | PartyStateMsg | PartyVitalsMsg;
export type PartyMessage = PartyClientMessage | PartyServerMessage;

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
  if (b.length > PARTY_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${PARTY_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  if (DEC.decode(b) !== x) throw new ProtocolError('malformed', `${what} is not valid Unicode text`);
  return x;
}
function list(x: unknown, max: number, what: string): Rec[] {
  if (!Array.isArray(x) || x.length > max)
    throw new ProtocolError('range', `${what} must be an array of at most ${max}`);
  return x.map((v) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v))
      throw new ProtocolError('malformed', `${what} entries must be objects`);
    return v as Rec;
  });
}

/** The normalised party message for `o.type`, or null when it is not one. */
export function validatePartyMessage(o: Rec): PartyMessage | null {
  switch (o.type) {
    case 'party_cmd': {
      const op = int(o.op, PartyOp.Invite, PartyOp.Kick, 'op');
      const nm = name(o.name, 'name');
      const needsName = op === PartyOp.Invite || op === PartyOp.Kick;
      if (needsName && nm.length === 0) throw new ProtocolError('malformed', 'invite and kick need a name');
      if (op === PartyOp.Leave && nm.length > 0) throw new ProtocolError('malformed', 'leave takes no name');
      return { type: 'party_cmd', op, clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'), name: nm };
    }
    case 'party_result':
      return {
        type: 'party_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        reason: int(o.reason, 0, 255, 'reason'),
      };
    case 'party_invite':
      return { type: 'party_invite', fromName: name(o.fromName, 'fromName'), ttlMs: int(o.ttlMs, 0, U16, 'ttlMs') };
    case 'party_state': {
      const members = list(o.members, PARTY.MAX_SIZE, 'members').map((m) => ({
        entityId: int(m.entityId, 0, U32, 'entityId'),
        name: name(m.name, 'name'),
        classId: int(m.classId, 0, 255, 'classId'),
      }));
      const leaderId = int(o.leaderId, 0, U32, 'leaderId');
      if (members.length === 0 ? leaderId !== 0 : !members.some((m) => m.entityId === leaderId))
        throw new ProtocolError('malformed', 'the leader must be one of the members (0 when there are none)');
      return { type: 'party_state', leaderId, members };
    }
    case 'party_vitals':
      return {
        type: 'party_vitals',
        members: list(o.members, PARTY.MAX_SIZE, 'members').map((m) => ({
          entityId: int(m.entityId, 0, U32, 'entityId'),
          hp: int(m.hp, 0, U32, 'hp'),
          hpMax: int(m.hpMax, 0, U32, 'hpMax'),
          mp: int(m.mp, 0, U32, 'mp'),
          mpMax: int(m.mpMax, 0, U32, 'mpMax'),
        })),
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
  if (n > PARTY_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${PARTY_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  try {
    return DEC.decode(r.sub(n));
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', `${what} is not valid UTF-8`);
  }
}

export function encodePartyBody(w: ColdWriter, m: PartyMessage): void {
  switch (m.type) {
    case 'party_cmd':
      w.u8(m.op);
      w.u16(m.clientMsgId);
      writeName(w, m.name);
      break;
    case 'party_result':
      w.u16(m.clientMsgId);
      w.u8(m.reason);
      break;
    case 'party_invite':
      writeName(w, m.fromName);
      w.u16(m.ttlMs);
      break;
    case 'party_state':
      w.u32(m.leaderId);
      w.u8(m.members.length);
      for (const p of m.members) {
        w.u32(p.entityId);
        writeName(w, p.name);
        w.u8(p.classId);
      }
      break;
    case 'party_vitals':
      w.u8(m.members.length);
      for (const p of m.members) {
        w.u32(p.entityId);
        w.u32(p.hp);
        w.u32(p.hpMax);
        w.u32(p.mp);
        w.u32(p.mpMax);
      }
      break;
  }
}

export function decodePartyBody(r: ColdReader, type: PartyMessage['type']): Rec {
  switch (type) {
    case 'party_cmd':
      return { type, op: r.u8(), clientMsgId: r.u16(), name: readName(r, 'name') };
    case 'party_result':
      return { type, clientMsgId: r.u16(), reason: r.u8() };
    case 'party_invite':
      return { type, fromName: readName(r, 'fromName'), ttlMs: r.u16() };
    case 'party_state': {
      const leaderId = r.u32();
      const n = r.u8();
      if (n > PARTY.MAX_SIZE) throw new ProtocolError('range', 'too many party members');
      const members: Rec[] = [];
      for (let i = 0; i < n; i++) members.push({ entityId: r.u32(), name: readName(r, 'name'), classId: r.u8() });
      return { type, leaderId, members };
    }
    case 'party_vitals': {
      const n = r.u8();
      if (n > PARTY.MAX_SIZE) throw new ProtocolError('range', 'too many party members');
      const members: Rec[] = [];
      for (let i = 0; i < n; i++)
        members.push({ entityId: r.u32(), hp: r.u32(), hpMax: r.u32(), mp: r.u32(), mpMax: r.u32() });
      return { type, members };
    }
  }
}
