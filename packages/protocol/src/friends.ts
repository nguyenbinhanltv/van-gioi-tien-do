/**
 * Friends ("cold family", D96; docs/10 §7.1 P4 "bạn bè"). Same `[ver][0x80][msgId u16][body]` envelope and strict fixed big-endian bodies as
 * party.ts / chat.ts. Friendship is between ACCOUNTS and persisted; the wire only ever carries names.
 *
 *   friend_cmd    C->S  one command: op, clientMsgId (echoed in the result), the other player's name
 *   friend_result S->C  answer to every friend_cmd (0 = done), so a refusal is never silent
 *   friend_state  S->C  the whole picture whenever it changes: friends with online status, requests received, requests sent
 *
 * "Whisper" and "invite to party" from the list are the existing chat_send / party_cmd with the friend's name: no extra messages.
 */
import { FRIENDS } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum FriendOp {
  /** send a friend request (or accept the one that player already sent you) */
  Request = 1,
  /** accept a received request; name '' = the oldest */
  Accept = 2,
  /** decline a received request; name '' = the oldest */
  Decline = 3,
  /** remove a friend, or withdraw a request you sent */
  Remove = 4,
}

/** Why a friend_cmd was refused (0 = done). Wire-stable. */
export enum FriendReason {
  Ok = 0,
  RateLimited = 1,
  /** no account with that name */
  NoSuchPlayer = 2,
  /** requesting / removing yourself */
  Self = 3,
  AlreadyFriends = 4,
  /** you already sent that player a request */
  AlreadyRequested = 5,
  /** your friend list is full */
  FriendListFull = 6,
  /** the other player cannot take more friends / requests right now */
  TargetListFull = 7,
  /** you already have the maximum number of requests out */
  TooManyRequests = 8,
  /** accept / decline without a matching request */
  NoRequest = 9,
  /** remove: not a friend and no request to withdraw */
  NotFriends = 10,
  /** the player is not in the world (yet) */
  NotReady = 11,
}

export const FRIEND_WIRE_LIMITS = { MAX_NAME_BYTES: 24 } as const;

export interface FriendCmdMsg {
  type: 'friend_cmd';
  op: number;
  clientMsgId: number;
  /** Request / Remove: the player's name (required); Accept / Decline: the requester's name ('' = the oldest request) */
  name: string;
}
export interface FriendResultMsg {
  type: 'friend_result';
  clientMsgId: number;
  reason: number;
}
export interface FriendEntry {
  name: string;
  /** class wire id (1..6) of the character that is online, 0 when offline */
  classId: number;
  online: boolean;
}
export interface FriendStateMsg {
  type: 'friend_state';
  /** unordered: the client sorts (online first, then by name) */
  friends: readonly FriendEntry[];
  /** names of players who asked to be your friend, oldest first */
  incoming: readonly string[];
  /** names of players you asked, oldest first */
  outgoing: readonly string[];
}
export type FriendClientMessage = FriendCmdMsg;
export type FriendServerMessage = FriendResultMsg | FriendStateMsg;
export type FriendMessage = FriendClientMessage | FriendServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
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
  if (b.length > FRIEND_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${FRIEND_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  if (DEC.decode(b) !== x) throw new ProtocolError('malformed', `${what} is not valid Unicode text`);
  return x;
}
function list(x: unknown, max: number, what: string): unknown[] {
  if (!Array.isArray(x) || x.length > max)
    throw new ProtocolError('range', `${what} must be an array of at most ${max}`);
  return x;
}
function rec(x: unknown, what: string): Rec {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    throw new ProtocolError('malformed', `${what} entries must be objects`);
  return x as Rec;
}

/** The normalised friend message for `o.type`, or null when it is not one. */
export function validateFriendMessage(o: Rec): FriendMessage | null {
  switch (o.type) {
    case 'friend_cmd': {
      const op = int(o.op, FriendOp.Request, FriendOp.Remove, 'op');
      const nm = name(o.name, 'name');
      if ((op === FriendOp.Request || op === FriendOp.Remove) && nm.length === 0)
        throw new ProtocolError('malformed', 'request and remove need a name');
      return { type: 'friend_cmd', op, clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'), name: nm };
    }
    case 'friend_result':
      return {
        type: 'friend_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        reason: int(o.reason, 0, 255, 'reason'),
      };
    case 'friend_state': {
      const friends = list(o.friends, FRIENDS.MAX_FRIENDS, 'friends').map((x) => {
        const f = rec(x, 'friends');
        if (typeof f.online !== 'boolean') throw new ProtocolError('malformed', 'online must be a boolean');
        return { name: name(f.name, 'name'), classId: int(f.classId, 0, 255, 'classId'), online: f.online };
      });
      return {
        type: 'friend_state',
        friends,
        incoming: list(o.incoming, FRIENDS.MAX_INCOMING, 'incoming').map((x) => name(x, 'incoming')),
        outgoing: list(o.outgoing, FRIENDS.MAX_OUTGOING, 'outgoing').map((x) => name(x, 'outgoing')),
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
  if (n > FRIEND_WIRE_LIMITS.MAX_NAME_BYTES)
    throw new ProtocolError('range', `${what} is longer than ${FRIEND_WIRE_LIMITS.MAX_NAME_BYTES} bytes`);
  try {
    return DEC.decode(r.sub(n));
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', `${what} is not valid UTF-8`);
  }
}

export function encodeFriendBody(w: ColdWriter, m: FriendMessage): void {
  switch (m.type) {
    case 'friend_cmd':
      w.u8(m.op);
      w.u16(m.clientMsgId);
      writeName(w, m.name);
      break;
    case 'friend_result':
      w.u16(m.clientMsgId);
      w.u8(m.reason);
      break;
    case 'friend_state':
      w.u8(m.friends.length);
      for (const f of m.friends) {
        writeName(w, f.name);
        w.u8(f.classId);
        w.u8(f.online ? 1 : 0);
      }
      w.u8(m.incoming.length);
      for (const n of m.incoming) writeName(w, n);
      w.u8(m.outgoing.length);
      for (const n of m.outgoing) writeName(w, n);
      break;
  }
}

export function decodeFriendBody(r: ColdReader, type: FriendMessage['type']): Rec {
  switch (type) {
    case 'friend_cmd':
      return { type, op: r.u8(), clientMsgId: r.u16(), name: readName(r, 'name') };
    case 'friend_result':
      return { type, clientMsgId: r.u16(), reason: r.u8() };
    case 'friend_state': {
      const nf = r.u8();
      if (nf > FRIENDS.MAX_FRIENDS) throw new ProtocolError('range', 'too many friends');
      const friends: Rec[] = [];
      for (let i = 0; i < nf; i++) {
        const nm = readName(r, 'name');
        const classId = r.u8();
        const on = r.u8();
        if (on > 1) throw new ProtocolError('malformed', 'online flag must be 0 or 1');
        friends.push({ name: nm, classId, online: on === 1 });
      }
      const ni = r.u8();
      if (ni > FRIENDS.MAX_INCOMING) throw new ProtocolError('range', 'too many incoming requests');
      const incoming: string[] = [];
      for (let i = 0; i < ni; i++) incoming.push(readName(r, 'incoming'));
      const no = r.u8();
      if (no > FRIENDS.MAX_OUTGOING) throw new ProtocolError('range', 'too many outgoing requests');
      const outgoing: string[] = [];
      for (let i = 0; i < no; i++) outgoing.push(readName(r, 'outgoing'));
      return { type, friends, incoming, outgoing };
    }
  }
}
