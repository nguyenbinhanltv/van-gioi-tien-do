import { MAX_SKILLS } from './constants.js';

/** One movement input (docs/08 §4 "Gói input"): intent only, never a position. */
export interface MoveInput {
  kind: 'move';
  entityId: number;
  /** uint16, wraps */
  seq: number;
  /** declared client time for this input, 8–50 ms */
  dtMs: number;
  /** direction code 0..254 (angle/256·2π in tile space), 255 = idle */
  dir: number;
  /** analog magnitude 0..15 */
  mag: number;
  /** 4 bits: FLAG_DODGE | FLAG_FLY_TOGGLE | FLAG_QINGGONG */
  flags: number;
}

/** Skill cast request. Cooldowns/GCD/MP are validated against server-held state only. */
export interface CastInput {
  kind: 'cast';
  entityId: number;
  seq: number;
  skillId: number;
  /** 0 = none (self / ground) */
  targetId: number;
  /** measured by the transport layer, used for the cooldown latency tolerance */
  rttMs: number;
}
export type SimInput = MoveInput | CastInput;

export interface SkillDef {
  id: number;
  cooldownMs: number;
  /** shared global cooldown applied after the cast */
  gcdMs: number;
  mpCost: number;
  /** max distance to the target in tiles (0 = no target needed) */
  range: number;
}

export interface AntiCheatState {
  /** server time the budget clock started (can be pulled forward by the sliding rule) */
  t0Ms: number;
  claimedMs: number;
  lastSlideMs: number;
  windowStartMs: number;
  windowClaimedMs: number;
  hotWindows: number;
  score: number;
  warned: boolean;
  /** cast-packet token bucket */
  castTokens: number;
  castRefillMs: number;
}

/** Everything the movement rules need — this is the part the client predicts. */
export interface MoveState {
  i: number;
  j: number;
  vi: number;
  vj: number;
  /** elevation level the entity stands on (0..4) */
  layer: number;
  flying: boolean;
  qinggong: boolean;
  /** last non-idle direction code, 0..254 (also the dash direction when idle) */
  facing: number;
  agi: number;
  dashLeftMs: number;
  dashCdMs: number;
  invulnMs: number;
}

export interface EntityState extends MoveState {
  id: number;
  hp: number;
  mp: number;
  stunMs: number;
  /** last processed input seq (uint16) — echoed to the owner for reconciliation */
  lastSeq: number;
  /** inputs not yet applied because of the per-tick allowance (server side) */
  pending: readonly MoveInput[];
  /** readyAt[skillId], server time ms */
  cooldowns: readonly number[];
  gcdReadyAt: number;
  connected: boolean;
  ac: AntiCheatState;
}

export interface SimWorld {
  tick: number;
  timeMs: number;
  /** mulberry32 state */
  rng: number;
  /** always sorted by id ascending */
  entities: readonly EntityState[];
}

export interface SimContext {
  grid: import('./grid.js').CollisionGrid;
  skills: readonly SkillDef[];
}

export enum CastReason {
  Ok = 0,
  UnknownSkill = 1,
  Cooldown = 2,
  Gcd = 3,
  NoMp = 4,
  Controlled = 5,
  OutOfRange = 6,
  NoLineOfSight = 7,
  BadTarget = 8,
}

export type ViolationKind = 'budget' | 'dt' | 'distance' | 'cooldown' | 'queue';

export type SimEvent =
  | { type: 'cast_ok'; entityId: number; seq: number; skillId: number; readyAtMs: number; roll: number }
  | { type: 'cast_rejected'; entityId: number; seq: number; skillId: number; reason: CastReason; readyAtMs: number }
  | { type: 'cast_dropped'; entityId: number; seq: number }
  | { type: 'violation'; entityId: number; kind: ViolationKind; score: number }
  | { type: 'warn'; entityId: number; score: number }
  | { type: 'flag'; entityId: number; ratio: number }
  | { type: 'disconnect'; entityId: number; reason: string };

export interface StepResult {
  world: SimWorld;
  events: SimEvent[];
}

export function emptyCooldowns(): number[] {
  return new Array<number>(MAX_SKILLS).fill(0);
}
