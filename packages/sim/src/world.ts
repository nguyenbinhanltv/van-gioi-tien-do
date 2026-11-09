/**
 * The shared tick function. `step(world, inputs, ctx, dtMs)`:
 *  - applies each entity's movement inputs in seq order (entities iterated by ascending id),
 *  - enforces the declared-time budget and the per-tick input allowance,
 *  - validates skill casts against server-held cooldown state,
 *  - advances time by `dtMs` (default one 20 Hz tick) and the RNG only when a cast succeeds.
 * Pure: returns a new world, never mutates its arguments.
 */
import { NETWORK, rngFloat, rngFork, rngSeed } from '@vgtd/shared';
import { addViolation, newAntiCheat, overBudget, takeCastToken, tickAntiCheat } from './anticheat.js';
import {
  ANTICHEAT,
  INPUT_DT_MAX_MS,
  INPUT_DT_MIN_MS,
  MAX_PENDING_INPUTS,
  MAX_SKILLS,
  TICK_INPUT_ALLOWANCE,
} from './constants.js';
import { mpCostOf } from './skills.js';
import { lineOfSight } from './grid.js';
import { hypot, seqNewer } from './math.js';
import { clampDt, distanceViolation, stepMove } from './movement.js';
import {
  CastReason,
  emptyCooldowns,
  type CastInput,
  type EntityState,
  type MoveInput,
  type SimContext,
  type SimEvent,
  type SimInput,
  type SimWorld,
  type StepResult,
} from './types.js';

export function createWorld(seed: number): SimWorld {
  return { tick: 0, timeMs: 0, rng: rngFork(rngSeed(seed), 'combat'), entities: [] };
}

export interface SpawnOptions {
  id: number;
  i: number;
  j: number;
  layer?: number;
  agi?: number;
  hp?: number;
  mp?: number;
  mpMax?: number;
  flying?: boolean;
  facing?: number;
}

/** Add an entity (kept sorted by id). Throws on duplicate ids. */
export function spawnEntity(world: SimWorld, o: SpawnOptions): SimWorld {
  if (world.entities.some((e) => e.id === o.id)) throw new Error(`duplicate entity id ${o.id}`);
  const e: EntityState = {
    id: o.id,
    i: o.i,
    j: o.j,
    vi: 0,
    vj: 0,
    layer: o.layer ?? 0,
    flying: o.flying ?? false,
    qinggong: false,
    facing: o.facing ?? 32,
    agi: o.agi ?? 100,
    dashLeftMs: 0,
    dashCdMs: 0,
    invulnMs: 0,
    hp: o.hp ?? 1000,
    mp: o.mp ?? o.mpMax ?? 100,
    mpMax: o.mpMax ?? 100,
    stunMs: 0,
    lastSeq: 0,
    pending: [],
    cooldowns: emptyCooldowns(),
    gcdReadyAt: 0,
    connected: true,
    ac: newAntiCheat(world.timeMs),
  };
  const entities = [...world.entities, e].sort((a, b) => a.id - b.id);
  return { ...world, entities };
}

export function removeEntity(world: SimWorld, id: number): SimWorld {
  return { ...world, entities: world.entities.filter((e) => e.id !== id) };
}

/** Stable sort by seq with uint16 wrap-around (oldest first). */
function sortBySeq<T extends { seq: number }>(xs: T[]): T[] {
  return xs
    .map((x, idx) => ({ x, idx }))
    .sort((a, b) => (a.x.seq === b.x.seq ? a.idx - b.idx : seqNewer(a.x.seq, b.x.seq) ? 1 : -1))
    .map((p) => p.x);
}

/**
 * Extra inputs of `step` that are NOT simulation state but facts about the host, passed explicitly so `step` stays a pure function
 * (same world + inputs + options => same result; a replay records them with the inputs).
 */
export interface StepOptions {
  /**
   * Server-overload credit of one entity: ms of REAL time that passed without sim time passing since its client joined (the server
   * loop ran behind real time). Honest clients are paced by the wall clock, the guards by sim time: without this credit every client
   * of an overloaded server looks like it oversends and gets kicked (queue overflow, budget, claimed/real ratio). Contract: >= 0,
   * non-decreasing per entity, capped by `ANTICHEAT.MAX_LAG_CREDIT_MS` here. Default (omitted): no credit, the previous behaviour.
   */
  lagMs?: (entityId: number) => number;
}

export function step(
  world: SimWorld,
  inputs: readonly SimInput[],
  ctx: SimContext,
  dtMs: number = NETWORK.TICK_MS,
  opts: StepOptions = {},
): StepResult {
  const events: SimEvent[] = [];
  const nowMs = world.timeMs + dtMs;
  const moves = new Map<number, MoveInput[]>();
  const casts = new Map<number, CastInput[]>();
  for (const inp of inputs) {
    if (inp.kind === 'move') {
      const list = moves.get(inp.entityId);
      if (list) list.push(inp);
      else moves.set(inp.entityId, [inp]);
    } else {
      const list = casts.get(inp.entityId);
      if (list) list.push(inp);
      else casts.set(inp.entityId, [inp]);
    }
  }

  let rng = world.rng;
  const entities: EntityState[] = [];
  const byId = new Map<number, EntityState>();
  for (const e of world.entities) byId.set(e.id, e);

  for (const e0 of world.entities) {
    if (!e0.connected) {
      entities.push(e0);
      continue;
    }
    let e = e0;
    let disconnect = false;
    // The guards' clock = sim time + the server-overload credit (= wall time since this client joined; see StepOptions.lagMs).
    const rawLag = opts.lagMs?.(e0.id) ?? 0;
    const lag = Number.isFinite(rawLag) ? Math.min(ANTICHEAT.MAX_LAG_CREDIT_MS, Math.max(0, rawLag)) : 0; // NaN / Infinity: no credit
    const acNow = nowMs + lag;

    // ---------------------------------------------------------------- movement
    const queue = sortBySeq([...e.pending, ...(moves.get(e.id) ?? [])]);
    // when behind real time, also drain the backlog (bounded: the budget below still limits claimed time to wall time)
    const allowance = dtMs * TICK_INPUT_ALLOWANCE + Math.min(lag, ANTICHEAT.LAG_DRAIN_TICKS * dtMs);
    let tickClaimed = 0;
    let consumed = 0;
    for (const inp of queue) {
      let d = inp.dtMs;
      if (!(d >= INPUT_DT_MIN_MS && d <= INPUT_DT_MAX_MS)) {
        const v = addViolation(e.ac, e.id, 'dt', events);
        e = { ...e, ac: v.ac };
        disconnect ||= v.disconnect;
        d = clampDt(Number.isFinite(d) ? d : INPUT_DT_MIN_MS);
      }
      if (tickClaimed + d > allowance) break; // keep the rest queued for the next tick
      consumed++;
      tickClaimed += d;
      if (overBudget(e.ac, d, acNow)) {
        // held, not applied: the character cannot move faster than real time
        const v = addViolation(e.ac, e.id, 'budget', events);
        e = { ...e, ac: v.ac, lastSeq: inp.seq };
        disconnect ||= v.disconnect;
        continue;
      }
      const next = stepMove(e, { dtMs: d, dir: inp.dir, mag: inp.mag, flags: inp.flags }, ctx.grid);
      let ac = { ...e.ac, claimedMs: e.ac.claimedMs + d, windowClaimedMs: e.ac.windowClaimedMs + d };
      if (distanceViolation(e, next, d)) {
        const v = addViolation(ac, e.id, 'distance', events);
        ac = v.ac;
        disconnect ||= v.disconnect;
      }
      e = { ...e, ...pickMove(next), ac, lastSeq: inp.seq };
    }
    let pending = queue.slice(consumed);
    // the backlog an overloaded server legitimately accumulates grows with its lag: one more input per INPUT_DT_MAX_MS of credit
    const maxPending = MAX_PENDING_INPUTS + Math.min(ANTICHEAT.LAG_QUEUE_EXTRA_MAX, Math.ceil(lag / INPUT_DT_MAX_MS));
    if (pending.length > maxPending) {
      const v = addViolation(e.ac, e.id, 'queue', events);
      e = { ...e, ac: v.ac };
      disconnect ||= v.disconnect;
      pending = pending.slice(pending.length - maxPending);
    }
    // timers that run on server time rather than input time
    e = { ...e, pending, stunMs: Math.max(0, e.stunMs - dtMs) };

    // ---------------------------------------------------------------- skills
    let castFloor = 0;
    for (const c of sortBySeq(casts.get(e.id) ?? [])) {
      // the cast is judged and stamped as of its arrival (D106); the packet-rate bucket stays on the tick clock
      const age = Number.isFinite(c.ageMs) ? Math.min(ANTICHEAT.CAST_MAX_AGE_MS, Math.max(0, c.ageMs!)) : 0;
      const castNow = Math.max(acNow - age, castFloor); // casts of one tick stay in order
      const tok = takeCastToken(e.ac, acNow);
      e = { ...e, ac: tok.ac };
      if (!tok.ok) {
        events.push({ type: 'cast_dropped', entityId: e.id, seq: c.seq });
        continue;
      }
      const r = validateCast(e, c, ctx, byId, castNow);
      if (r.reason !== CastReason.Ok) {
        events.push({
          type: 'cast_rejected',
          entityId: e.id,
          seq: c.seq,
          skillId: c.skillId,
          reason: r.reason,
          // reported in sim time (the clients' clock): the credit is subtracted again
          readyAtMs: Math.max(0, r.readyAtMs - lag),
        });
        if (r.reason === CastReason.Cooldown || r.reason === CastReason.Gcd) {
          const v = addViolation(e.ac, e.id, 'cooldown', events);
          e = { ...e, ac: v.ac };
          disconnect ||= v.disconnect;
        }
        continue;
      }
      const def = ctx.skills.find((s) => s.id === c.skillId)!;
      const cooldowns = e.cooldowns.slice();
      cooldowns[def.id] = castNow + def.cooldownMs; // cooldowns run on the guards' clock (wall time since join), reported in sim time below
      const [roll, nextRng] = rngFloat(rng);
      rng = nextRng;
      e = { ...e, mp: e.mp - mpCostOf(def, e.mpMax), cooldowns, gcdReadyAt: castNow + def.gcdMs };
      castFloor = castNow;
      events.push({
        type: 'cast_ok',
        entityId: e.id,
        seq: c.seq,
        skillId: def.id,
        readyAtMs: cooldowns[def.id]! - lag,
        roll,
      });
    }

    // ---------------------------------------------------------------- anti-cheat housekeeping
    const t = tickAntiCheat(e.ac, e.id, acNow, dtMs, events);
    e = { ...e, ac: t.ac };
    disconnect ||= t.disconnect;
    if (disconnect) e = { ...e, connected: false, pending: [] };
    entities.push(e);
    byId.set(e.id, e);
  }

  return { world: { tick: world.tick + 1, timeMs: nowMs, rng, entities }, events };
}

function pickMove(s: EntityState | import('./types.js').MoveState): import('./types.js').MoveState {
  return {
    i: s.i,
    j: s.j,
    vi: s.vi,
    vj: s.vj,
    layer: s.layer,
    flying: s.flying,
    qinggong: s.qinggong,
    facing: s.facing,
    agi: s.agi,
    dashLeftMs: s.dashLeftMs,
    dashCdMs: s.dashCdMs,
    invulnMs: s.invulnMs,
  };
}

/** docs/08 §6: t_server ≥ readyAt − min(RTT/2, 100 ms), plus MP, GCD, control, range and line-of-sight checks. */
export function validateCast(
  e: EntityState,
  c: CastInput,
  ctx: SimContext,
  byId: ReadonlyMap<number, EntityState>,
  nowMs: number,
): { reason: CastReason; readyAtMs: number } {
  const def = ctx.skills.find((s) => s.id === c.skillId);
  if (!def || def.id < 0 || def.id >= MAX_SKILLS) return { reason: CastReason.UnknownSkill, readyAtMs: 0 };
  const readyAt = e.cooldowns[def.id] ?? 0;
  if (e.stunMs > 0) return { reason: CastReason.Controlled, readyAtMs: readyAt };
  const tol = Math.min(Math.max(0, c.rttMs) / 2, ANTICHEAT.CAST_LATENCY_COMP_MAX_MS);
  if (nowMs < readyAt - tol) return { reason: CastReason.Cooldown, readyAtMs: readyAt };
  if (nowMs < e.gcdReadyAt - tol) return { reason: CastReason.Gcd, readyAtMs: e.gcdReadyAt };
  if (e.mp < mpCostOf(def, e.mpMax)) return { reason: CastReason.NoMp, readyAtMs: readyAt };
  if (def.targeting !== 'none') {
    const target = byId.get(c.targetId);
    const selfOk = def.targeting === 'ally_or_self' && (c.targetId === 0 || c.targetId === e.id);
    if (!selfOk) {
      if (!target || target.id === e.id) return { reason: CastReason.BadTarget, readyAtMs: readyAt };
      if (def.range > 0 && hypot(target.i - e.i, target.j - e.j) > def.range)
        return { reason: CastReason.OutOfRange, readyAtMs: readyAt };
      if (def.requiresLos && !lineOfSight(ctx.grid, e.i, e.j, target.i, target.j, e.layer, e.flying))
        return { reason: CastReason.NoLineOfSight, readyAtMs: readyAt };
    }
  }
  return { reason: CastReason.Ok, readyAtMs: readyAt };
}
