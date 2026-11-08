/**
 * Basic mob AI (D74): one pure decision per mob per tick. No clocks, no ambient randomness: randomness comes from the
 * injected `RngState` and is drawn in a FIXED ORDER (see `decide`), players are scanned in ascending id order with
 * strict comparisons so ties go to the lowest id.
 *
 *   idle --(player inside aggroRadius)--> chase --(target lost / leash)--> return --(home)--> idle
 *   idle --(pause over)--> wander --(arrived / leg timeout)--> idle
 *
 * Aggro is only scanned in idle/wander, and only every `SCAN_PERIOD` ticks (staggered by slot) to keep the cost of
 * mobs x players low; a returning mob ignores players until it is home (no ping-pong at the leash edge).
 */
import { type MobAiParams, rngFloat, rngInt, type RngState } from '@vgtd/shared';
import { MAG_MAX, encodeDirection, hypot } from '@vgtd/sim';

export type MobState = 'idle' | 'wander' | 'chase' | 'return';

export interface MobBrain {
  state: MobState;
  /** idle: ms left before the next wander leg; wander: ms spent on the current leg */
  timerMs: number;
  /** chase target entity id (0 = none) */
  target: number;
  /** wander destination (tile space) */
  wi: number;
  wj: number;
}

export interface MobBody {
  i: number;
  j: number;
  homeI: number;
  homeJ: number;
  slot: number;
}
export interface PlayerRef {
  id: number;
  i: number;
  j: number;
}

/** Ticks between aggro scans of an idle / wandering mob. */
export const SCAN_PERIOD = 5;
/** A wander leg is abandoned after this long (stuck against a wall). */
export const WANDER_LEG_MAX_MS = 6000;
const ARRIVE = 0.5;

export interface Decision {
  /** direction code 0..254, 255 = stand still */
  dir: number;
  mag: number;
  brain: MobBrain;
  rng: RngState;
}

export function newBrain(): MobBrain {
  return { state: 'idle', timerMs: 0, target: 0, wi: 0, wj: 0 };
}

function drawIdle(p: MobAiParams, rng: RngState): [number, RngState] {
  const span = p.idleMaxMs - p.idleMinMs;
  if (span <= 0) return [p.idleMinMs, rng];
  const [n, r] = rngInt(rng, span + 1);
  return [p.idleMinMs + n, r];
}

function toward(b: MobBody, ti: number, tj: number, mag: number): { dir: number; mag: number } {
  const dir = encodeDirection(ti - b.i, tj - b.j);
  return dir === 255 ? { dir, mag: 0 } : { dir, mag };
}

function nearest(b: MobBody, players: readonly PlayerRef[], radius: number): PlayerRef | null {
  let best: PlayerRef | null = null;
  let bestD = radius * radius;
  for (const p of players) {
    const di = p.i - b.i;
    const dj = p.j - b.j;
    const d = di * di + dj * dj;
    if (d < bestD) {
      bestD = d;
      best = p;
    }
  }
  return best;
}

/**
 * RNG draw order (per mob, ascending slot, within one tick): (1) when idle starts or restarts: one `rngInt` for the
 * pause; (2) when a wander leg starts: two `rngFloat` (angle-free: a point in the square of side 2 x wanderRadius around
 * home, rejected outside the circle by clamping, no loop). Nothing else draws.
 */
export function decide(
  body: MobBody,
  brain: MobBrain,
  p: MobAiParams,
  players: readonly PlayerRef[],
  playerById: (id: number) => PlayerRef | undefined,
  tick: number,
  dtMs: number,
  rng: RngState,
  /** the chase target holds threat (D83): it is exempt from `loseRadius`; the leash and a gone target still end the chase */
  provoked = false,
): Decision {
  const dHome = hypot(body.i - body.homeI, body.j - body.homeJ);
  const walk = MAG_MAX;
  let b = brain;
  const r = rng;

  if (b.state === 'chase') {
    const t = playerById(b.target);
    if (!t || dHome > p.leashRadius || (!provoked && hypot(t.i - body.i, t.j - body.j) > p.loseRadius)) {
      b = { ...b, state: 'return', target: 0 }; // fall through to the return branch below
    } else {
      const d = hypot(t.i - body.i, t.j - body.j);
      if (d <= p.engageRange) return { dir: 255, mag: 0, brain: b, rng: r };
      return { ...toward(body, t.i, t.j, walk), brain: b, rng: r };
    }
  }

  if (b.state === 'return') {
    if (dHome <= p.homeRadius) {
      const [ms, r2] = drawIdle(p, r);
      return { dir: 255, mag: 0, brain: { state: 'idle', timerMs: ms, target: 0, wi: 0, wj: 0 }, rng: r2 };
    }
    return { ...toward(body, body.homeI, body.homeJ, walk), brain: b, rng: r };
  }

  // idle / wander: look for a player (staggered)
  if ((tick + body.slot) % SCAN_PERIOD === 0) {
    const t = nearest(body, players, p.aggroRadius);
    if (t)
      return {
        ...toward(body, t.i, t.j, walk),
        brain: { state: 'chase', timerMs: 0, target: t.id, wi: 0, wj: 0 },
        rng: r,
      };
  }

  if (b.state === 'idle') {
    const left = b.timerMs - dtMs;
    if (left > 0) return { dir: 255, mag: 0, brain: { ...b, timerMs: left }, rng: r };
    if (p.wanderRadius <= 0) {
      const [ms, r2] = drawIdle(p, r);
      return { dir: 255, mag: 0, brain: { ...b, timerMs: ms }, rng: r2 };
    }
    const [fa, r1] = rngFloat(r);
    const [fb, r2] = rngFloat(r1);
    const wi = body.homeI + (fa * 2 - 1) * p.wanderRadius;
    const wj = body.homeJ + (fb * 2 - 1) * p.wanderRadius;
    return {
      ...toward(body, wi, wj, Math.max(1, Math.round(walk * p.wanderSpeed))),
      brain: { state: 'wander', timerMs: 0, target: 0, wi, wj },
      rng: r2,
    };
  }

  // wander
  const spent = b.timerMs + dtMs;
  if (hypot(b.wi - body.i, b.wj - body.j) <= ARRIVE || spent >= WANDER_LEG_MAX_MS) {
    const [ms, r2] = drawIdle(p, r);
    return { dir: 255, mag: 0, brain: { state: 'idle', timerMs: ms, target: 0, wi: 0, wj: 0 }, rng: r2 };
  }
  return {
    ...toward(body, b.wi, b.wj, Math.max(1, Math.round(walk * p.wanderSpeed))),
    brain: { ...b, timerMs: spent },
    rng: r,
  };
}
