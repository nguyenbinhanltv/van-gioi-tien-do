/**
 * Message definitions (docs/08 §4, §5, §8). Every binary packet starts with [version u8][type u8].
 * Fields use `null` (never `undefined`) for "absent" so the JSON debug codec round-trips exactly.
 */

/** Bump on any wire-incompatible change; decoders reject other versions with ProtocolError('version'). */
/** v2 (D74): `EnterEntity.defId` (monster / NPC definition id, u16). */
/** v3 (D78): `SkillCastMsg.aim` (ground / direction aim point) and `SelfState.vitals` (own HP / MP / shield). */
export const PROTOCOL_VERSION = 3;

export enum MsgType {
  Input = 1,
  Snapshot = 2,
  AoiEnter = 3,
  AoiLeave = 4,
  SkillCast = 5,
  SkillResult = 6,
  Error = 7,
  Ping = 8,
  Pong = 9,
}

export const MSG_TYPE_NAMES: Readonly<Record<number, Message['type']>> = {
  [MsgType.Input]: 'input',
  [MsgType.Snapshot]: 'snapshot',
  [MsgType.AoiEnter]: 'aoi_enter',
  [MsgType.AoiLeave]: 'aoi_leave',
  [MsgType.SkillCast]: 'skill_cast',
  [MsgType.SkillResult]: 'skill_result',
  [MsgType.Error]: 'error',
  [MsgType.Ping]: 'ping',
  [MsgType.Pong]: 'pong',
};

// ---------------------------------------------------------------- limits (single source for codec + validation)
export const LIMITS = {
  /** one packet carries 1–3 consecutive inputs (docs/08 §4) */
  MAX_INPUTS_PER_PACKET: 3,
  /** local entity index: 10 bits, ≤ 1,024 visible entities (docs/08 §8) */
  MAX_LOCAL_INDEX: 1023,
  /** positions are quantised to 1/32 tile in uint16 */
  POS_SCALE: 32,
  POS_MAX_Q: 65535,
  /** delta record: signed 8 bits per axis */
  DELTA_MIN: -128,
  DELTA_MAX: 127,
  ANIM_MAX: 63,
  HP_PCT_MAX: 127,
  MAX_ERROR_TEXT_BYTES: 255,
  MAX_HITS: 255,
  MAX_ENTER_PER_MSG: 1024,
} as const;

// ---------------------------------------------------------------- client → server
/** Exactly the fields client-core `InputManager.toPacket` produces, plus seq and the declared dt. */
export interface InputPacket {
  /** uint16, wraps */
  seq: number;
  /** declared time of this input, 0–255 (server accepts 8–50) */
  dtMs: number;
  /** direction code 0–255 (255 = idle) */
  dir: number;
  /** analog magnitude 0–15 */
  mag: number;
  /** 4 bits: dodge | fly toggle | qinggong */
  flags: number;
}

export interface InputMsg {
  type: 'input';
  /** newest snapshot seq the client has received; the server encodes deltas against it */
  ack: number;
  /** 1–3 consecutive inputs, oldest first (older ones are re-sent to cover datagram loss) */
  inputs: InputPacket[];
}

export interface SkillCastMsg {
  type: 'skill_cast';
  seq: number;
  skillId: number;
  /** 0 = no target (self / ground skill) */
  targetId: number;
  /** Aim point for `ground` / `direction` skills, absolute position in 1/32 tile (like `SnapshotEntity.qi/qj`); null = none (the server uses the target, else the caster's facing). */
  aim: { qi: number; qj: number } | null;
}

export interface PingMsg {
  type: 'ping';
  clientTimeMs: number;
}

// ---------------------------------------------------------------- server → client
/** Authoritative movement state of the receiving player, enough to re-run pending inputs (reconciliation). */
/** Own vitals, sent only when they changed since the last snapshot the client acknowledged (and on a full snapshot). Integers, u32 each. */
export interface SelfVitals {
  hp: number;
  hpMax: number;
  mp: number;
  mpMax: number;
  /** current shield absorb (0 = none) */
  shield: number;
}

export interface SelfState {
  /** last input seq the server processed for this player */
  lastSeq: number;
  /** float32 on the wire */
  i: number;
  j: number;
  layer: number;
  flying: boolean;
  qinggong: boolean;
  /** last non-idle direction code 0–254 */
  facing: number;
  dashLeftMs: number;
  dashCdMs: number;
  invulnMs: number;
  /** present only when changed (see `SelfVitals`) */
  vitals: SelfVitals | null;
}

/** One entity in a snapshot. `qi`/`qj` are absolute positions in 1/32 tile; the codec picks delta or absolute. */
export interface SnapshotEntity {
  /** index in the client's visible list (0–1023) */
  index: number;
  qi: number;
  qj: number;
  /** animation / state id 0–63 (idle, run, attack, fly, dead …) */
  anim: number;
  /** 8-direction index 0–7, order of @vgtd/shared DIRECTIONS */
  dir: number;
  /** present only when HP changed: percent 0–127 */
  hpPct: number | null;
}

export interface SnapshotMsg {
  type: 'snapshot';
  /** uint16 snapshot number */
  seq: number;
  /** snapshot the deltas are relative to; null = full state */
  baselineSeq: number | null;
  /** simulation tick (uint32) */
  tick: number;
  self: SelfState | null;
  entities: SnapshotEntity[];
}

/** AOI enter = full Spawn state for entities that entered the area of interest. */
export interface EnterEntity {
  index: number;
  entityId: number;
  /** 0 player · 1 monster · 2 npc · 3 pet · 4 drop … (game-defined) */
  kind: number;
  /** definition id (u16): `MOB_DEFS[].id` for monsters (kind 1), 0 for players */
  defId: number;
  qi: number;
  qj: number;
  anim: number;
  dir: number;
  hpPct: number;
  maxHp: number;
}
export interface AoiEnterMsg {
  type: 'aoi_enter';
  entities: EnterEntity[];
}
/** AOI leave = Despawn of the given local indices. */
export interface AoiLeaveMsg {
  type: 'aoi_leave';
  indices: number[];
}

export interface SkillHit {
  targetIndex: number;
  damage: number;
  /** bit0 crit */
  flags: number;
}
export interface SkillResultMsg {
  type: 'skill_result';
  /** echoes SkillCastMsg.seq */
  seq: number;
  /** @vgtd/sim CastReason (0 = ok) */
  reason: number;
  skillId: number;
  /** server time at which the skill is ready again (lets the client fix its cooldown UI) */
  readyAtMs: number;
  casterIndex: number;
  hits: SkillHit[];
}

export enum ErrorCode {
  BadVersion = 1,
  BadMessage = 2,
  RateLimited = 3,
  Unauthorized = 4,
  SessionExpired = 5,
  Kicked = 6,
  ServerFull = 7,
  Internal = 8,
}
export interface ErrorMsg {
  type: 'error';
  code: number;
  text: string;
}

export interface PongMsg {
  type: 'pong';
  clientTimeMs: number;
  serverTimeMs: number;
}

export type ClientMessage = InputMsg | SkillCastMsg | PingMsg;
export type ServerMessage = SnapshotMsg | AoiEnterMsg | AoiLeaveMsg | SkillResultMsg | ErrorMsg | PongMsg;
export type Message = ClientMessage | ServerMessage;
