/**
 * Server-authoritative movement (docs/08 §4). `stepMove` is the function the client predicts with and the
 * World Node applies: same input → same state, no clocks, no unordered iteration, no Math.random.
 */
import { COLLIDER_RADIUS_TILES, DIRECTIONS, type Direction } from '@vgtd/shared';
import {
  AGI_SPEED_BASE,
  AGI_SPEED_DIVISOR,
  ANTICHEAT,
  DASH_COOLDOWN_MS,
  DASH_DURATION_MS,
  DASH_INVULN_MS,
  DASH_SPEED,
  DIR_IDLE,
  FLAG_DODGE,
  FLAG_FLY_TOGGLE,
  FLAG_QINGGONG,
  FLY_SPEED,
  INPUT_DT_MAX_MS,
  INPUT_DT_MIN_MS,
  MAG_MAX,
  MAX_SUBSTEP_TILES,
  WALK_SPEED,
} from './constants.js';
import { blockingNormal, circleBlocked, layerAt, type CollisionGrid } from './grid.js';
import { DIR_COS, DIR_SIN, clamp, hypot } from './math.js';
import type { MoveState } from './types.js';

export function walkSpeed(agi: number): number {
  return WALK_SPEED * (1 + (agi - AGI_SPEED_BASE) / AGI_SPEED_DIVISOR);
}
/** Highest speed the entity may currently legitimately reach (tiles / s). */
export function maxSpeed(s: MoveState): number {
  const base = s.flying ? FLY_SPEED : walkSpeed(s.agi);
  return s.dashLeftMs > 0 ? Math.max(base, DASH_SPEED) : base;
}

/** The shared 8-direction name for a direction code (S, SE, E, NE, N, NW, W, SW). */
export function directionOf(code: number): Direction {
  // tile-space angle of S = 32 (vector (1,1)); screen-clockwise order S, SE, E … decreases the code by 32.
  const idx = ((Math.round((32 - code) / 32) % 8) + 8) % 8;
  return DIRECTIONS[idx]!;
}

/** Clamp the declared dt into 8–50 ms. */
export function clampDt(dtMs: number): number {
  return clamp(Math.trunc(dtMs), INPUT_DT_MIN_MS, INPUT_DT_MAX_MS);
}

/**
 * Advance one axis by `d`; if blocked, bisect (fixed 10 iterations ⇒ deterministic) to the farthest free point so
 * the entity ends flush against the wall instead of up to one sub-step short of it.
 */
function advance(pos: number, d: number, blocked: (v: number) => boolean): number {
  if (d === 0 || !blocked(pos + d)) return pos + d;
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 10; k++) {
    const mid = (lo + hi) / 2;
    if (blocked(pos + d * mid)) hi = mid;
    else lo = mid;
  }
  return pos + d * lo;
}

/** Move along (di, dj) in ≤ 0.5-tile sub-steps, axis-separated so the entity slides along walls. */
export function moveWithCollision(s: MoveState, di: number, dj: number, grid: CollisionGrid): { i: number; j: number } {
  const n = Math.max(1, Math.ceil(hypot(di, dj) / MAX_SUBSTEP_TILES));
  const si = di / n;
  const sj = dj / n;
  let { i, j } = s;
  let layer = s.layer;
  const r = COLLIDER_RADIUS_TILES;
  for (let q = 0; q < n; q++) {
    const i0 = i;
    const j0 = j;
    i = advance(i, si, (v) => circleBlocked(grid, v, j, r, layer, s.flying));
    j = advance(j, sj, (v) => circleBlocked(grid, i, v, r, layer, s.flying));
    // axis-separated motion stalls on corners (e.g. exact diagonal into a pillar): slide the unmet remainder
    // along the contact tangent, moving as one vector so both axes can advance together
    const ri = si - (i - i0);
    const rj = sj - (j - j0);
    if (si !== 0 && sj !== 0 && ri * ri + rj * rj > 1e-12) {
      const nrm = blockingNormal(grid, i + ri, j + rj, r, layer, s.flying);
      if (nrm) {
        // contact normal from the *current* position to the blocker's closest point (not the penetrated one)
        const cl = hypot(i - nrm.px, j - nrm.pj);
        const cn = cl > 1e-9 ? { ni: (i - nrm.px) / cl, nj: (j - nrm.pj) / cl } : nrm;
        const dot = ri * cn.ni + rj * cn.nj;
        let ti = ri - dot * cn.ni;
        let tj = rj - dot * cn.nj;
        if (hypot(ti, tj) < 1e-9) {
          // dead-centre hit: pick the perpendicular on the +j side deterministically
          const len = hypot(ri, rj);
          ti = -cn.nj * len;
          tj = cn.ni * len;
          if (tj < 0 || (tj === 0 && ti < 0)) {
            ti = -ti;
            tj = -tj;
          }
        }
        let lo = 0;
        if (!circleBlocked(grid, i + ti, j + tj, r, layer, s.flying)) lo = 1;
        else {
          let hi = 1;
          for (let k = 0; k < 10; k++) {
            const mid = (lo + hi) / 2;
            if (circleBlocked(grid, i + ti * mid, j + tj * mid, r, layer, s.flying)) hi = mid;
            else lo = mid;
          }
        }
        i += ti * lo;
        j += tj * lo;
      }
    }
    if (!s.flying) layer = layerAt(grid, i, j, layer);
  }
  return { i, j };
}

export interface MoveCommand {
  dtMs: number;
  dir: number;
  mag: number;
  flags: number;
}

/**
 * Apply one input. `dtMs` must already be validated (use clampDt). Returns a new state; the input is not mutated.
 * Timers (dash, invulnerability) run on declared input time so that client and server stay in lock-step.
 */
export function stepMove(s: MoveState, cmd: MoveCommand, grid: CollisionGrid): MoveState {
  const dtMs = cmd.dtMs;
  const dt = dtMs / 1000;
  const moving = cmd.dir !== DIR_IDLE && cmd.mag > 0;
  const facing = moving ? cmd.dir : s.facing;

  let flying = s.flying;
  if ((cmd.flags & FLAG_FLY_TOGGLE) !== 0) flying = !flying;
  const qinggong = (cmd.flags & FLAG_QINGGONG) !== 0;

  let dashLeftMs = s.dashLeftMs;
  let dashCdMs = s.dashCdMs;
  let invulnMs = s.invulnMs;
  if ((cmd.flags & FLAG_DODGE) !== 0 && dashCdMs <= 0 && !flying) {
    dashLeftMs = DASH_DURATION_MS;
    dashCdMs = DASH_COOLDOWN_MS;
    invulnMs = DASH_INVULN_MS;
  }
  const dashDir = facing;

  const base: MoveState = { ...s, flying, qinggong, facing, dashLeftMs, dashCdMs, invulnMs };
  const speed = flying ? FLY_SPEED : walkSpeed(s.agi);

  // time spent dashing inside this input, then ordinary movement for the rest
  const dashPart = Math.min(dtMs, dashLeftMs);
  let di = 0;
  let dj = 0;
  if (dashPart > 0) {
    di += DIR_COS[dashDir]! * DASH_SPEED * (dashPart / 1000);
    dj += DIR_SIN[dashDir]! * DASH_SPEED * (dashPart / 1000);
  }
  const rest = dtMs - dashPart;
  if (rest > 0 && moving) {
    const k = (clamp(cmd.mag, 0, MAG_MAX) / MAG_MAX) * speed * (rest / 1000);
    di += DIR_COS[cmd.dir]! * k;
    dj += DIR_SIN[cmd.dir]! * k;
  }

  let i = s.i;
  let j = s.j;
  let layer = s.layer;
  if (di !== 0 || dj !== 0) {
    const p = moveWithCollision(base, di, dj, grid);
    i = p.i;
    j = p.j;
    if (!flying) layer = layerAt(grid, i, j, layer);
  }
  // landing from flight keeps the layer of the tile below, which layerAt gives for walkable tiles
  if (flying !== s.flying && !flying) layer = layerAt(grid, i, j, layer);

  return {
    ...base,
    i,
    j,
    layer,
    vi: (i - s.i) / dt,
    vj: (j - s.j) / dt,
    dashLeftMs: Math.max(0, dashLeftMs - dtMs),
    dashCdMs: Math.max(0, dashCdMs - dtMs),
    invulnMs: Math.max(0, invulnMs - dtMs),
  };
}

/** Distance guard: true when the move exceeds speed × dt × 1.05 (server pushes excluded by the caller). */
export function distanceViolation(prev: MoveState, next: MoveState, dtMs: number): boolean {
  const d = hypot(next.i - prev.i, next.j - prev.j);
  const allowed = maxSpeed({ ...prev, dashLeftMs: Math.max(prev.dashLeftMs, next.dashLeftMs > 0 ? 1 : 0) });
  return d > allowed * (dtMs / 1000) * ANTICHEAT.DISTANCE_TOLERANCE + 1e-9;
}
