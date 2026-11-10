/**
 * Crafting ("cold family", D108; docs/13, docs/24 ids 90-91 `craft_start` / `craft_result`). Same `[ver][0x80][msgId u16][body]` envelope and
 * strict fixed big-endian bodies as inventory.ts. In-game items and stones only: no price or real-money field.
 *
 *   craft_cmd    C->S  start `count` crafts of a recipe (id 90) or cancel the running job; carries a requestId (idempotency, docs/13 §6.2)
 *   craft_result S->C  one per answer / per finished craft (id 91): the command answer (`index` = 255) or craft number `index` of the job
 *   craft_state  S->C  furnace position, the running job and the mastery of every recipe (id 95); sent on join and on every change
 */
import { ALCHEMY, QUALITY_MAX, RECIPES } from '@vgtd/shared';
import { ProtocolError } from './errors.js';
import type { ColdReader, ColdWriter } from './progression.js';

export enum CraftOp {
  Start = 1,
  Cancel = 2,
}

/** Outcome of a craft_result (wire-stable). */
export enum CraftOutcome {
  /** the command was refused (see `reason`); nothing was consumed */
  Rejected = 0,
  /** craft `index` succeeded: `qty` items of `quality` were added to the bag */
  Success = 1,
  /** craft `index` failed the roll: `lost` materials were destroyed, the fee was spent */
  Failed = 2,
  /** the job (or what was left of it) was cancelled: nothing more is consumed */
  Cancelled = 3,
  /** the job was accepted and started (answer to a Start) */
  Accepted = 4,
}

/** Why a craft_cmd was refused or a job cancelled (0 = none). Wire-stable. */
export enum CraftReason {
  Ok = 0,
  /** the character profile or inventory is not loaded yet */
  NotReady = 1,
  /** not close enough to the furnace NPC */
  TooFar = 2,
  /** crafting opens at Trúc Cơ, or the recipe tier is above the character's realm */
  RealmTooLow = 3,
  UnknownRecipe = 4,
  NotEnoughMaterials = 5,
  NotEnoughStones = 6,
  /** the product does not fit in the bag */
  BagFull = 7,
  /** a job is already running */
  Busy = 8,
  BadCount = 9,
  RateLimited = 10,
  /** cancelled because the player moved */
  Moved = 11,
  /** cancelled because the player entered combat */
  InCombat = 12,
  /** cancelled by the player */
  ByPlayer = 13,
  Dead = 14,
  /** cancelled because the player left the furnace range or a requirement stopped holding */
  Interrupted = 15,
  /** the requestId was already used by this character (a command id is single-use) */
  Replayed = 16,
}

/** Value used as `index` for the answer to a command (a real craft index is 0..QUEUE_MAX-1). */
export const CRAFT_ANSWER_INDEX = 255;

export interface CraftCmdMsg {
  type: 'craft_cmd';
  requestId: string;
  op: number;
  /** Start: wire id of the recipe (u8, 1+); Cancel: 0 */
  recipeId: number;
  /** Start: 1..QUEUE_MAX; Cancel: 0 */
  count: number;
}
export interface CraftResultMsg {
  type: 'craft_result';
  requestId: string;
  /** CRAFT_ANSWER_INDEX for a command answer, else the craft number inside the job */
  index: number;
  outcome: number;
  reason: number;
  recipeId: number;
  /** Success: quality tier 0..5, else 0 */
  quality: number;
  /** Success: items produced (1), else 0 */
  qty: number;
  /** Failed: materials destroyed, else 0 */
  lost: number;
}
export interface CraftJobView {
  /** 0 = no job */
  recipeId: number;
  done: number;
  total: number;
  /** ms until the craft in progress completes (0 when idle) */
  remainingMs: number;
}
export interface CraftMastery {
  recipeId: number;
  points: number;
}
export interface CraftStateMsg {
  type: 'craft_state';
  /** the furnace NPC, quantised like entity positions (1/32 tile) */
  furnaceQi: number;
  furnaceQj: number;
  job: CraftJobView;
  mastery: readonly CraftMastery[];
}

export type CraftClientMessage = CraftCmdMsg;
export type CraftServerMessage = CraftResultMsg | CraftStateMsg;
export type CraftMessage = CraftClientMessage | CraftServerMessage;

type Rec = Record<string, unknown>;
const POS_Q_MAX = 65535;
function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
function rec(x: unknown, what: string): Rec {
  if (typeof x !== 'object' || x === null || Array.isArray(x))
    throw new ProtocolError('malformed', `${what} must be an object`);
  return x as Rec;
}
function reqId(x: unknown): string {
  if (typeof x !== 'string' || !/^[0-9a-f]{32}$/.test(x))
    throw new ProtocolError('range', 'requestId must be 32 lowercase hex characters');
  return x;
}
const maxRecipeId = Math.max(...RECIPES.map((r) => r.wireId));
const MAX_RECIPES_ON_WIRE = 32;

export function validateCraftMessage(o: Rec): CraftMessage | null {
  switch (o.type) {
    case 'craft_cmd': {
      const op = int(o.op, CraftOp.Start, CraftOp.Cancel, 'op');
      const recipeId = int(o.recipeId, 0, 255, 'recipeId');
      const count = int(o.count, 0, ALCHEMY.QUEUE_MAX, 'count');
      if (op === CraftOp.Start && (recipeId < 1 || count < 1))
        throw new ProtocolError('malformed', 'start needs a recipe and a count of 1..queue max');
      if (op === CraftOp.Cancel && (recipeId !== 0 || count !== 0))
        throw new ProtocolError('malformed', 'cancel carries no recipe or count');
      return { type: 'craft_cmd', requestId: reqId(o.requestId), op, recipeId, count };
    }
    case 'craft_result': {
      const index = int(o.index, 0, 255, 'index');
      if (index !== CRAFT_ANSWER_INDEX && index >= ALCHEMY.QUEUE_MAX)
        throw new ProtocolError('range', 'index must be a craft number or the answer marker');
      return {
        type: 'craft_result',
        requestId: reqId(o.requestId),
        index,
        outcome: int(o.outcome, CraftOutcome.Rejected, CraftOutcome.Accepted, 'outcome'),
        reason: int(o.reason, 0, 255, 'reason'),
        recipeId: int(o.recipeId, 0, 255, 'recipeId'),
        quality: int(o.quality, 0, QUALITY_MAX, 'quality'),
        qty: int(o.qty, 0, 255, 'qty'),
        lost: int(o.lost, 0, 255, 'lost'),
      };
    }
    case 'craft_state': {
      const j = rec(o.job, 'job');
      const job: CraftJobView = {
        recipeId: int(j.recipeId, 0, 255, 'job.recipeId'),
        done: int(j.done, 0, ALCHEMY.QUEUE_MAX, 'job.done'),
        total: int(j.total, 0, ALCHEMY.QUEUE_MAX, 'job.total'),
        remainingMs: int(j.remainingMs, 0, 65535, 'job.remainingMs'),
      };
      if (job.done > job.total) throw new ProtocolError('range', 'job.done exceeds job.total');
      if (job.recipeId === 0 && (job.total !== 0 || job.done !== 0 || job.remainingMs !== 0))
        throw new ProtocolError('malformed', 'an idle job has no counts');
      if (!Array.isArray(o.mastery) || o.mastery.length > MAX_RECIPES_ON_WIRE)
        throw new ProtocolError('range', `mastery must be an array of at most ${MAX_RECIPES_ON_WIRE}`);
      return {
        type: 'craft_state',
        furnaceQi: int(o.furnaceQi, 0, POS_Q_MAX, 'furnaceQi'),
        furnaceQj: int(o.furnaceQj, 0, POS_Q_MAX, 'furnaceQj'),
        job,
        mastery: o.mastery.map((m, i) => {
          const r = rec(m, `mastery[${i}]`);
          return {
            recipeId: int(r.recipeId, 1, Math.max(maxRecipeId, 255), 'recipeId'),
            points: int(r.points, 0, ALCHEMY.MASTERY_MAX, 'points'),
          };
        }),
      };
    }
    default:
      return null;
  }
}

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
const bytesToHex = (b: Uint8Array): string => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');

export function encodeCraftBody(w: ColdWriter, m: CraftMessage): void {
  switch (m.type) {
    case 'craft_cmd':
      w.bytes(hexToBytes(m.requestId));
      w.u8(m.op);
      w.u8(m.recipeId);
      w.u8(m.count);
      break;
    case 'craft_result':
      w.bytes(hexToBytes(m.requestId));
      w.u8(m.index);
      w.u8(m.outcome);
      w.u8(m.reason);
      w.u8(m.recipeId);
      w.u8(m.quality);
      w.u8(m.qty);
      w.u8(m.lost);
      break;
    case 'craft_state':
      w.u16(m.furnaceQi);
      w.u16(m.furnaceQj);
      w.u8(m.job.recipeId);
      w.u8(m.job.done);
      w.u8(m.job.total);
      w.u16(m.job.remainingMs);
      w.u8(m.mastery.length);
      for (const e of m.mastery) {
        w.u8(e.recipeId);
        w.u8(e.points);
      }
      break;
  }
}

export function decodeCraftBody(r: ColdReader, type: CraftMessage['type']): Rec {
  switch (type) {
    case 'craft_cmd':
      return { type, requestId: bytesToHex(r.sub(16)), op: r.u8(), recipeId: r.u8(), count: r.u8() };
    case 'craft_result':
      return {
        type,
        requestId: bytesToHex(r.sub(16)),
        index: r.u8(),
        outcome: r.u8(),
        reason: r.u8(),
        recipeId: r.u8(),
        quality: r.u8(),
        qty: r.u8(),
        lost: r.u8(),
      };
    case 'craft_state': {
      const furnaceQi = r.u16();
      const furnaceQj = r.u16();
      const job = { recipeId: r.u8(), done: r.u8(), total: r.u8(), remainingMs: r.u16() };
      const n = r.u8();
      if (n > MAX_RECIPES_ON_WIRE) throw new ProtocolError('range', 'too many mastery entries');
      const mastery: Rec[] = [];
      for (let i = 0; i < n; i++) mastery.push({ recipeId: r.u8(), points: r.u8() });
      return { type, furnaceQi, furnaceQj, job, mastery };
    }
  }
}
