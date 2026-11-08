/**
 * Progression ("cold family") messages: tu vi / realm state, meditation and breakthrough (docs/24 §5 ids 60-62, 63-65 added by D74).
 *
 * docs/24 puts the cold family in a Protobuf envelope `[ver][0x80][msgId u16][bytes]`. The Protobuf pipeline does not exist
 * yet, so the envelope is kept and the body is a fixed big-endian layout (listed per message below). Adding a msgId is
 * additive (docs/24 §3: cold family evolves by new ids), so they do not bump PROTOCOL_VERSION; a later Protobuf body replaces the
 * layout without changing msgId meaning. Same strict-decode rules as the hot codec (validated, canonical, no trailing bytes).
 */
import { ProtocolError } from './errors.js';

/** Envelope type byte of every cold-family packet. */
export const COLD_ENVELOPE = 0x80;

export enum ColdMsgId {
  CharState = 60,
  BreakthroughStart = 61,
  BreakthroughResult = 62,
  MeditateStart = 63,
  MeditateStop = 64,
  MeditateResult = 65,
}

export const COLD_MSG_NAMES: Readonly<Record<number, ColdMessage['type']>> = {
  [ColdMsgId.CharState]: 'char_state',
  [ColdMsgId.BreakthroughStart]: 'breakthrough_start',
  [ColdMsgId.BreakthroughResult]: 'breakthrough_result',
  [ColdMsgId.MeditateStart]: 'meditate_start',
  [ColdMsgId.MeditateStop]: 'meditate_stop',
  [ColdMsgId.MeditateResult]: 'meditate_result',
};
export const COLD_MSG_IDS: Readonly<Record<ColdMessage['type'], ColdMsgId>> = {
  char_state: ColdMsgId.CharState,
  breakthrough_start: ColdMsgId.BreakthroughStart,
  breakthrough_result: ColdMsgId.BreakthroughResult,
  meditate_start: ColdMsgId.MeditateStart,
  meditate_stop: ColdMsgId.MeditateStop,
  meditate_result: ColdMsgId.MeditateResult,
};

/** Why a progression command was refused (0 = accepted). Values are wire-stable. */
export enum ProgressionReason {
  Ok = 0,
  /** profile still loading, or the player is not in the world */
  NotReady = 1,
  Moving = 2,
  InCombat = 3,
  Dead = 4,
  RateLimited = 5,
  NotEnoughTuVi = 6,
  AtMaxStage = 7,
  Cooldown = 8,
}
export enum BreakthroughOutcome {
  Success = 1,
  Failure = 2,
  Rejected = 3,
}
export enum BreakthroughKind {
  None = 0,
  Minor = 1,
  Major = 2,
}

/** request ids are UUIDs sent as 32 lowercase hex characters (16 bytes on the wire) */
export const REQUEST_ID_RE = /^[0-9a-f]{32}$/;

export const PROGRESSION_LIMITS = {
  MAX_STAGE: 41,
  MAX_ROOT_TYPE: 4,
  MAX_N_FAIL: 255,
  KARMA_MIN: -1000,
  KARMA_MAX: 1000,
  /** chance is sent in 1/10000 */
  CHANCE_SCALE: 10000,
} as const;

/** Bits of `CharStateMsg.flags`. */
export const CHAR_FLAG = { MEDITATING: 1, BREAKTHROUGH_READY: 2, MAX_STAGE: 4 } as const;

/** Server -> client: the authoritative progression state; sent on join, on every change of stage/flags and about 1 Hz while meditating. */
export interface CharStateMsg {
  type: 'char_state';
  /** flat stage 1..41 (realm and sub-stage derive from it with @vgtd/shared stageToRealm) */
  stage: number;
  flags: number;
  /** consecutive failed major breakthroughs at this threshold (pity counter) */
  nFail: number;
  /** index into @vgtd/shared ROOT_TYPES (0 đơn … 4 tạp ngũ) */
  rootType: number;
  /** bit0..4 = kim, mộc, thủy, hỏa, thổ (the root's base elements) */
  elements: number;
  /** 0 none, 1 phong, 2 lôi, 3 băng */
  mutation: number;
  karma: number;
  tuVi: number;
  /** Req(stage): tu vi needed to attempt the next breakthrough */
  tuViReq: number;
}
export interface BreakthroughStartMsg {
  type: 'breakthrough_start';
  requestId: string;
}
export interface BreakthroughResultMsg {
  type: 'breakthrough_result';
  requestId: string;
  outcome: number;
  kind: number;
  reason: number;
  fromStage: number;
  toStage: number;
  /** success chance in 1/10000 (0 when rejected before a roll) */
  chance: number;
  nFail: number;
}
export interface MeditateStartMsg {
  type: 'meditate_start';
  requestId: string;
}
export interface MeditateStopMsg {
  type: 'meditate_stop';
  requestId: string;
}
export interface MeditateResultMsg {
  type: 'meditate_result';
  requestId: string;
  meditating: boolean;
  reason: number;
}
export type ColdClientMessage = BreakthroughStartMsg | MeditateStartMsg | MeditateStopMsg;
export type ColdServerMessage = CharStateMsg | BreakthroughResultMsg | MeditateResultMsg;
export type ColdMessage = ColdClientMessage | ColdServerMessage;

// ---------------------------------------------------------------- validation
type Rec = Record<string, unknown>;
function int(x: unknown, min: number, max: number, what: string): number {
  if (typeof x !== 'number' || !Number.isInteger(x) || x < min || x > max)
    throw new ProtocolError('range', `${what} must be an integer in ${min}..${max}, got ${String(x)}`);
  return x;
}
function fin(x: unknown, min: number, what: string): number {
  if (typeof x !== 'number' || !Number.isFinite(x) || x < min)
    throw new ProtocolError('range', `${what} must be a finite number >= ${min}`);
  return x;
}
function reqId(x: unknown): string {
  if (typeof x !== 'string' || !REQUEST_ID_RE.test(x))
    throw new ProtocolError('range', 'requestId must be 32 lowercase hex characters');
  return x;
}

/** Returns the normalised cold message for `type`, or null when `type` is not a cold-family message. */
export function validateColdMessage(o: Rec): ColdMessage | null {
  switch (o.type) {
    case 'char_state':
      return {
        type: 'char_state',
        stage: int(o.stage, 1, PROGRESSION_LIMITS.MAX_STAGE, 'stage'),
        flags: int(o.flags, 0, 7, 'flags'),
        nFail: int(o.nFail, 0, PROGRESSION_LIMITS.MAX_N_FAIL, 'nFail'),
        rootType: int(o.rootType, 0, PROGRESSION_LIMITS.MAX_ROOT_TYPE, 'rootType'),
        elements: int(o.elements, 0, 31, 'elements'),
        mutation: int(o.mutation, 0, 3, 'mutation'),
        karma: int(o.karma, PROGRESSION_LIMITS.KARMA_MIN, PROGRESSION_LIMITS.KARMA_MAX, 'karma'),
        tuVi: fin(o.tuVi, 0, 'tuVi'),
        tuViReq: fin(o.tuViReq, 0, 'tuViReq'),
      };
    case 'breakthrough_start':
      return { type: 'breakthrough_start', requestId: reqId(o.requestId) };
    case 'meditate_start':
      return { type: 'meditate_start', requestId: reqId(o.requestId) };
    case 'meditate_stop':
      return { type: 'meditate_stop', requestId: reqId(o.requestId) };
    case 'breakthrough_result':
      return {
        type: 'breakthrough_result',
        requestId: reqId(o.requestId),
        outcome: int(o.outcome, 1, 3, 'outcome'),
        kind: int(o.kind, 0, 2, 'kind'),
        reason: int(o.reason, 0, 255, 'reason'),
        fromStage: int(o.fromStage, 1, PROGRESSION_LIMITS.MAX_STAGE, 'fromStage'),
        toStage: int(o.toStage, 1, PROGRESSION_LIMITS.MAX_STAGE, 'toStage'),
        chance: int(o.chance, 0, PROGRESSION_LIMITS.CHANCE_SCALE, 'chance'),
        nFail: int(o.nFail, 0, PROGRESSION_LIMITS.MAX_N_FAIL, 'nFail'),
      };
    case 'meditate_result':
      if (typeof o.meditating !== 'boolean') throw new ProtocolError('malformed', 'meditating must be a boolean');
      return {
        type: 'meditate_result',
        requestId: reqId(o.requestId),
        meditating: o.meditating,
        reason: int(o.reason, 0, 255, 'reason'),
      };
    default:
      return null;
  }
}

// ---------------------------------------------------------------- codec (body after the 4-byte envelope header)
export interface ColdWriter {
  u8(v: number): void;
  u16(v: number): void;
  f64(v: number): void;
  bytes(b: Uint8Array): void;
}
export interface ColdReader {
  u8(): number;
  u16(): number;
  f64(): number;
  sub(n: number): Uint8Array;
}

const hexToBytes = (hex: string): Uint8Array => Uint8Array.from(hex.match(/../g)!, (h) => parseInt(h, 16));
const bytesToHex = (b: Uint8Array): string => Array.from(b, (v) => v.toString(16).padStart(2, '0')).join('');

export function encodeColdBody(w: ColdWriter, m: ColdMessage): void {
  switch (m.type) {
    case 'char_state':
      w.u8(m.stage);
      w.u8(m.flags);
      w.u8(m.nFail);
      w.u8(m.rootType);
      w.u8(m.elements);
      w.u8(m.mutation);
      w.u16(m.karma + 1000); // 0..2000, unsigned on the wire
      w.f64(m.tuVi);
      w.f64(m.tuViReq);
      break;
    case 'breakthrough_start':
    case 'meditate_start':
    case 'meditate_stop':
      w.bytes(hexToBytes(m.requestId));
      break;
    case 'breakthrough_result':
      w.bytes(hexToBytes(m.requestId));
      w.u8(m.outcome);
      w.u8(m.kind);
      w.u8(m.reason);
      w.u8(m.fromStage);
      w.u8(m.toStage);
      w.u16(m.chance);
      w.u8(m.nFail);
      break;
    case 'meditate_result':
      w.bytes(hexToBytes(m.requestId));
      w.u8(m.meditating ? 1 : 0);
      w.u8(m.reason);
      break;
  }
}

/** Decode a cold body; the caller validates the result and checks for trailing bytes. */
export function decodeColdBody(r: ColdReader, type: ColdMessage['type']): Rec {
  switch (type) {
    case 'char_state':
      return {
        type,
        stage: r.u8(),
        flags: r.u8(),
        nFail: r.u8(),
        rootType: r.u8(),
        elements: r.u8(),
        mutation: r.u8(),
        karma: r.u16() - 1000,
        tuVi: r.f64(),
        tuViReq: r.f64(),
      };
    case 'breakthrough_start':
    case 'meditate_start':
    case 'meditate_stop':
      return { type, requestId: bytesToHex(r.sub(16)) };
    case 'breakthrough_result':
      return {
        type,
        requestId: bytesToHex(r.sub(16)),
        outcome: r.u8(),
        kind: r.u8(),
        reason: r.u8(),
        fromStage: r.u8(),
        toStage: r.u8(),
        chance: r.u16(),
        nFail: r.u8(),
      };
    case 'meditate_result': {
      const requestId = bytesToHex(r.sub(16));
      const m = r.u8();
      if (m > 1) throw new ProtocolError('malformed', 'meditating flag must be 0 or 1');
      return { type, requestId, meditating: m === 1, reason: r.u8() };
    }
  }
}
