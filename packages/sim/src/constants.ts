/**
 * Simulation constants that come from docs/08-server-architecture.md §4–6.
 * Anything already defined by @vgtd/shared (tick rate, collider radius, stats, …) is imported from there,
 * never redefined here.
 */

// ---------------------------------------------------------------- movement (tiles / second, tile space)
export const WALK_SPEED = 4.5;
export const DASH_SPEED = 12;
export const FLY_SPEED = 18;
/** Walk speed is multiplied by 1 + (agi − 100) / AGI_SPEED_DIVISOR. */
export const AGI_SPEED_DIVISOR = 400;
export const AGI_SPEED_BASE = 100;

export const DASH_DURATION_MS = 250;
export const DASH_COOLDOWN_MS = 1500;
export const DASH_INVULN_MS = 150;

/** Client-declared dt per input is 8–50 ms. */
export const INPUT_DT_MIN_MS = 8;
export const INPUT_DT_MAX_MS = 50;
/** A single movement sub-step is at most this long (anti tunnelling). */
export const MAX_SUBSTEP_TILES = 0.5;
/** Per tick the World Node applies inputs worth at most tick × 1.25 of declared time. */
export const TICK_INPUT_ALLOWANCE = 1.25;
/** Max inputs queued per entity (older ones are dropped). */
export const MAX_PENDING_INPUTS = 32;

/** Direction code meaning "no movement" in the input packet. */
export const DIR_IDLE = 255;
export const DIR_CODES = 256;
export const MAG_MAX = 15;

// ---------------------------------------------------------------- input flags (4 bits) — match client-core types.ts
export const FLAG_DODGE = 1;
export const FLAG_FLY_TOGGLE = 2;
export const FLAG_QINGGONG = 4;

// ---------------------------------------------------------------- anti-cheat (docs/08 §6)
export const ANTICHEAT = {
  /** Budget(t) = BUDGET_RATE · (t − t_enter) + BUDGET_SLACK_MS */
  BUDGET_RATE: 1.02,
  BUDGET_SLACK_MS: 250,
  /** Every SLIDE_PERIOD_MS, if Claimed lags Budget by more than SLIDE_LAG_MS pull Budget down to Claimed + SLIDE_LAG_MS. */
  SLIDE_PERIOD_MS: 10_000,
  SLIDE_LAG_MS: 1000,
  /** Distance per tick ≤ speed × tick × DISTANCE_TOLERANCE. */
  DISTANCE_TOLERANCE: 1.05,
  /** Claimed / real time over WINDOW_MS: > RATIO_FLAG for 2 windows flags, > RATIO_DISCONNECT disconnects. */
  WINDOW_MS: 60_000,
  RATIO_FLAG: 1.03,
  RATIO_FLAG_WINDOWS: 2,
  RATIO_DISCONNECT: 1.1,
  /** Suspicion score: +1 per violation, −1 per minute. */
  SCORE_DECAY_PER_MS: 1 / 60_000,
  SCORE_WARN: 20,
  SCORE_DISCONNECT: 50,
  /** Skill cast packets: token bucket, 10 / s. */
  CAST_RATE_PER_S: 10,
  CAST_BUCKET: 10,
  /** Cooldown check tolerates min(RTT/2, this) ms of latency. */
  CAST_LATENCY_COMP_MAX_MS: 100,
  /** A cast is judged as of its arrival, at most this many ms before the tick that processes it (D106; longer waits are clamped). */
  CAST_MAX_AGE_MS: 1000,
  /**
   * Server-overload credit (`StepOptions.lagMs`): real time that passed WITHOUT sim time passing since a client joined (the server ran
   * behind real time). It makes the guards' clock equal to wall time since join, which is exactly the legitimate bound, so it cannot
   * create headroom for cheating; this cap is only a sanity bound (10 min) against absurd values.
   */
  MAX_LAG_CREDIT_MS: 600_000,
  /** With lag credit a backlog of inputs drains faster: up to this many extra ticks' worth of declared time per tick. */
  LAG_DRAIN_TICKS: 2,
  /** Extra queue room (inputs) an overloaded server grants on top of MAX_PENDING_INPUTS: one per INPUT_DT_MAX_MS of credit, at most this many (memory bound). */
  LAG_QUEUE_EXTRA_MAX: 128,
} as const;

// ---------------------------------------------------------------- skills
export const MAX_SKILLS = 64;
