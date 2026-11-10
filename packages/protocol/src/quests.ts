/**
 * Quests ("cold family", D107; docs/12). Same `[ver][0x80][msgId u16][body]` envelope and strict fixed big-endian bodies as
 * friends.ts / party.ts. Ids 120-122 sit in the docs/24 `quest_*` block (120-139). Progress is NEVER reported by a client: the server
 * derives it from its own events, so the only thing a client can send is an intent (accept, claim, abandon, talk to an NPC).
 *
 *   quest_cmd    C->S  op, clientMsgId (echoed in the result), quest id (accept / claim / abandon), NPC key (talk)
 *   quest_result S->C  answer to every quest_cmd (0 = done), so a refusal is never silent
 *   quest_state  S->C  the whole quest log whenever it changes (coalesced per tick) + seconds to the next daily / weekly reset
 */
import { QUESTS } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum QuestOp {
  /** take a quest (must stand near its giver) */
  Accept = 1,
  /** turn in a finished quest and receive the rewards (must stand near the turn-in NPC) */
  Claim = 2,
  /** drop an active quest (its progress is lost) */
  Abandon = 3,
  /** "talk to" an NPC: counts for `talk` objectives (must stand near the NPC) */
  Talk = 4,
}

/** Why a quest_cmd was refused (0 = done). Wire-stable. */
export enum QuestReason {
  Ok = 0,
  RateLimited = 1,
  NoSuchQuest = 2,
  /** realm / prerequisite / sect requirement not met */
  Locked = 3,
  /** accept: already active or already done this cycle */
  NotAvailable = 4,
  /** not near the NPC */
  TooFar = 5,
  /** claim: objectives are not all done */
  NotReady = 6,
  /** accept: too many active quests of that type */
  TooManyActive = 7,
  /** abandon / claim: the quest is not active */
  NotActive = 8,
  NoSuchNpc = 9,
  /** the player is not in the world (yet) / profile not loaded */
  NotInWorld = 10,
  /** accept: the per-cycle completion cap is reached */
  CycleCap = 11,
  /** claim: the reward could not be paid (the quest stays claimable) */
  RewardFailed = 12,
  /** claim: a `collect` objective's items are no longer in the bag (they are handed in at the turn-in) */
  MissingItems = 13,
}

export const QUEST_WIRE_LIMITS = { MAX_ID_BYTES: 40, MAX_NPC_BYTES: 32 } as const;

export interface QuestCmdMsg {
  type: 'quest_cmd';
  op: number;
  clientMsgId: number;
  /** Accept / Claim / Abandon: the quest id; '' for Talk */
  questId: string;
  /** Talk: the NPC key; '' otherwise */
  npc: string;
}
export interface QuestResultMsg {
  type: 'quest_result';
  clientMsgId: number;
  reason: number;
}
export interface QuestEntry {
  id: string;
  /** `QuestStatus` of @vgtd/shared */
  status: number;
  /** one value per objective, in the order of the quest definition (kills, items, seconds, 0/1), already capped at the target */
  progress: readonly number[];
}
export interface QuestStateMsg {
  type: 'quest_state';
  /** seconds to the next 05:00 UTC+7 reset (daily / weekly), for the countdown */
  dailyResetIn: number;
  weeklyResetIn: number;
  /** every quest of the table with its status for this character (Locked ones included, so the log can show what is coming) */
  quests: readonly QuestEntry[];
}
export type QuestClientMessage = QuestCmdMsg;
export type QuestServerMessage = QuestResultMsg | QuestStateMsg;
export type QuestMessage = QuestClientMessage | QuestServerMessage;

type Rec = Record<string, unknown>;
const U16 = 0xffff;
const U32 = 0xffff_ffff;
const ENC = new TextEncoder();
const DEC = new TextDecoder('utf-8', { fatal: true });

function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
function text(x: unknown, max: number, what: string): string {
  if (typeof x !== 'string') throw new ProtocolError('malformed', `${what} must be a string`);
  const b = ENC.encode(x);
  if (b.length > max) throw new ProtocolError('range', `${what} is longer than ${max} bytes`);
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

/** The normalised quest message for `o.type`, or null when it is not one. */
export function validateQuestMessage(o: Rec): QuestMessage | null {
  switch (o.type) {
    case 'quest_cmd': {
      const op = int(o.op, QuestOp.Accept, QuestOp.Talk, 'op');
      const questId = text(o.questId, QUEST_WIRE_LIMITS.MAX_ID_BYTES, 'questId');
      const npc = text(o.npc, QUEST_WIRE_LIMITS.MAX_NPC_BYTES, 'npc');
      const bad = op === QuestOp.Talk ? npc.length === 0 || questId.length > 0 : questId.length === 0 || npc.length > 0;
      if (bad)
        throw new ProtocolError(
          'malformed',
          op === QuestOp.Talk ? 'talk needs an npc and no quest id' : 'this op needs a quest id and no npc',
        );
      return { type: 'quest_cmd', op, clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'), questId, npc };
    }
    case 'quest_result':
      return {
        type: 'quest_result',
        clientMsgId: int(o.clientMsgId, 0, U16, 'clientMsgId'),
        reason: int(o.reason, 0, 255, 'reason'),
      };
    case 'quest_state': {
      const quests = list(o.quests, QUESTS.MAX_ENTRIES, 'quests').map((x) => {
        const q = rec(x, 'quests');
        return {
          id: text(q.id, QUEST_WIRE_LIMITS.MAX_ID_BYTES, 'id'),
          status: int(q.status, 0, 4, 'status'),
          progress: list(q.progress, QUESTS.MAX_OBJECTIVES, 'progress').map((p) => int(p, 0, U16, 'progress')),
        };
      });
      return {
        type: 'quest_state',
        dailyResetIn: int(o.dailyResetIn, 0, U32, 'dailyResetIn'),
        weeklyResetIn: int(o.weeklyResetIn, 0, U32, 'weeklyResetIn'),
        quests,
      };
    }
    default:
      return null;
  }
}

function writeStr(w: ColdWriter, s: string): void {
  const b = ENC.encode(s);
  w.u8(b.length);
  w.bytes(b);
}
function readStr(r: ColdReader, max: number, what: string): string {
  const n = r.u8();
  if (n > max) throw new ProtocolError('range', `${what} is longer than ${max} bytes`);
  try {
    return DEC.decode(r.sub(n));
  } catch (e) {
    if (e instanceof ProtocolError) throw e;
    throw new ProtocolError('malformed', `${what} is not valid UTF-8`);
  }
}

export function encodeQuestBody(w: ColdWriter, m: QuestMessage): void {
  switch (m.type) {
    case 'quest_cmd':
      w.u8(m.op);
      w.u16(m.clientMsgId);
      writeStr(w, m.questId);
      writeStr(w, m.npc);
      break;
    case 'quest_result':
      w.u16(m.clientMsgId);
      w.u8(m.reason);
      break;
    case 'quest_state':
      w.u32(m.dailyResetIn);
      w.u32(m.weeklyResetIn);
      w.u8(m.quests.length);
      for (const q of m.quests) {
        writeStr(w, q.id);
        w.u8(q.status);
        w.u8(q.progress.length);
        for (const p of q.progress) w.u16(p);
      }
      break;
  }
}

export function decodeQuestBody(r: ColdReader, type: QuestMessage['type']): Rec {
  switch (type) {
    case 'quest_cmd':
      return {
        type,
        op: r.u8(),
        clientMsgId: r.u16(),
        questId: readStr(r, QUEST_WIRE_LIMITS.MAX_ID_BYTES, 'questId'),
        npc: readStr(r, QUEST_WIRE_LIMITS.MAX_NPC_BYTES, 'npc'),
      };
    case 'quest_result':
      return { type, clientMsgId: r.u16(), reason: r.u8() };
    case 'quest_state': {
      const dailyResetIn = r.u32();
      const weeklyResetIn = r.u32();
      const n = r.u8();
      if (n > QUESTS.MAX_ENTRIES) throw new ProtocolError('range', 'too many quests');
      const quests: Rec[] = [];
      for (let i = 0; i < n; i++) {
        const id = readStr(r, QUEST_WIRE_LIMITS.MAX_ID_BYTES, 'id');
        const status = r.u8();
        const np = r.u8();
        if (np > QUESTS.MAX_OBJECTIVES) throw new ProtocolError('range', 'too many objectives');
        const progress: number[] = [];
        for (let k = 0; k < np; k++) progress.push(r.u16());
        quests.push({ id, status, progress });
      }
      return { type, dailyResetIn, weeklyResetIn, quests };
    }
  }
}
