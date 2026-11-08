/**
 * Server-overload credit (`StepOptions.lagMs`): when the server ticks slower than real time an honest client, paced by the wall clock,
 * sends more inputs per sim tick than the guards allow. Without the credit it is kicked after seconds; with it the guards judge it
 * against wall time since it joined, and cheating stays exactly as detectable as before.
 */
import { describe, expect, it } from 'vitest';
import { NETWORK } from '@vgtd/shared';
import {
  ANTICHEAT,
  CastReason,
  WALK_SPEED,
  stateHash,
  step,
  type SimEvent,
  type SimInput,
  type SimWorld,
} from '../src/index.js';
import { SE, cast, ctxOf, ent, mv, openGrid, worldWith } from './helpers.js';

const TICK = NETWORK.TICK_MS;
// big enough that a 60+ s walk at 4.5 tiles/s never reaches the map edge
const ctx = ctxOf(openGrid(1024));
const spawn = { id: 1, i: 10.5, j: 100.5 };

interface Out {
  world: SimWorld;
  events: SimEvent[];
  disconnectedAt: number | null;
}

/**
 * Drive one entity for `ticks` sim ticks while the server runs `slow` times slower than real time: per sim tick `slow * perWall`
 * input-steps of 50 ms have arrived (the client emits one per 50 ms of WALL time, `perWall` times the honest rate for a cheater).
 * `credit` = lag credit at tick t, as the node would compute it (wall elapsed - sim elapsed since join).
 */
function drive(
  ticks: number,
  slow: number,
  perWall: number,
  credit: boolean,
  inputsAt?: (t: number) => SimInput[],
): Out {
  let w = worldWith(1, spawn);
  const events: SimEvent[] = [];
  let seq = 0;
  let owed = 0;
  let disconnectedAt: number | null = null;
  for (let t = 0; t < ticks && disconnectedAt === null; t++) {
    owed += slow * perWall;
    const n = Math.floor(owed);
    owed -= n;
    const inputs: SimInput[] = [];
    for (let k = 0; k < n; k++) inputs.push(mv(1, ++seq & 0xffff, SE));
    if (inputsAt) inputs.push(...inputsAt(t));
    const lag = credit ? (slow - 1) * TICK * (t + 1) : 0; // wall = slow * sim: drift = (slow - 1) * sim elapsed
    const r = step(w, inputs, ctx, TICK, { lagMs: () => lag });
    w = r.world;
    events.push(...r.events);
    if (r.events.some((e) => e.type === 'disconnect')) disconnectedAt = t;
  }
  return { world: w, events, disconnectedAt };
}
const violations = (o: Out): SimEvent[] => o.events.filter((e) => e.type === 'violation');

describe('a server that runs behind real time must not punish honest clients', () => {
  it('control: WITHOUT the credit an honest client is kicked within seconds once the server is 20-60% slow', () => {
    const slow20 = drive(1200, 1.2, 1, false);
    expect(slow20.disconnectedAt).not.toBeNull();
    expect(violations(slow20).every((v) => v.type === 'violation' && v.kind === 'queue')).toBe(true);
    const slow60 = drive(1200, 1.6, 1, false);
    expect(slow60.disconnectedAt).not.toBeNull();
    expect(slow60.disconnectedAt!).toBeLessThan(slow20.disconnectedAt!);
  });

  it('WITH the credit the same honest client is never flagged or kicked, even through a 60 s sustained overload', () => {
    for (const slow of [1.2, 1.6, 2.0]) {
      const o = drive(1200, slow, 1, true); // 60 s of sim time = 60 * slow s of wall time
      expect(o.disconnectedAt, `slow ${slow}`).toBeNull();
      expect(
        o.events.filter((e) => e.type === 'violation' || e.type === 'warn' || e.type === 'flag'),
        `slow ${slow}`,
      ).toEqual([]);
    }
  });

  it('players move at WALL-clock speed on a slow server (the backlog is drained, nothing is lost)', () => {
    const slow = 1.6;
    const o = drive(1200, slow, 1, true);
    const wallSeconds = (1200 * TICK * slow) / 1000;
    // everything the client sent has been applied (a small backlog may still be queued)
    expect(ent(o.world, 1).i - spawn.i).toBeGreaterThan(WALK_SPEED * (wallSeconds - 1.5));
    expect(ent(o.world, 1).i - spawn.i).toBeLessThanOrEqual(WALK_SPEED * (wallSeconds + 0.3));
    expect(ent(o.world, 1).pending.length).toBeLessThan(8);
  });

  it('and the 60 s claimed/real ratio window sees an honest ratio of about 1 (a 20% slow server is not a 20% speedhack)', () => {
    const o = drive(1800, 1.2, 1, true); // 90 s of sim time: two ratio windows close
    expect(o.events.filter((e) => e.type === 'disconnect' || e.type === 'flag')).toEqual([]);
    const control = drive(1800, 1.2, 1, false);
    expect(control.disconnectedAt).not.toBeNull(); // (it dies earlier on the queue, but the ratio would also be 1.2 > 1.1)
  });
});

describe('the credit does not weaken the guards: cheating is as detectable as on a healthy server', () => {
  it('a speedhacker at 2x the wall pace is still caught under overload (budget violations, then disconnect)', () => {
    for (const slow of [1.0, 1.3, 1.6]) {
      const o = drive(1200, slow, 2, true);
      expect(o.disconnectedAt, `slow ${slow}`).not.toBeNull();
      expect(
        violations(o).some((v) => v.type === 'violation' && (v.kind === 'budget' || v.kind === 'queue')),
        `slow ${slow}`,
      ).toBe(true);
    }
  });

  it('a mild speedhack (1.15x wall pace) is held to wall-clock speed, whatever the lag', () => {
    const slow = 1.4;
    const o = drive(1200, slow, 1.15, true);
    const wallSeconds = ((Math.min(o.disconnectedAt ?? 1199, 1199) + 1) * TICK * slow) / 1000;
    // it may or may not be kicked within 60 s, but it can never have moved faster than 1.02x wall speed + the 250 ms slack
    expect(ent(o.world, 1).i - spawn.i).toBeLessThanOrEqual(WALK_SPEED * (wallSeconds * 1.02 + 0.25) + 1);
  });

  it('the credit never pays out more than wall time: a client that joined during an overload gets no old credit (credit 0 = old behaviour)', () => {
    const a = drive(600, 1.0, 1, true);
    const b = drive(600, 1.0, 1, false);
    expect(stateHash(a.world)).toBe(stateHash(b.world)); // lag 0 and "no option" are the same function
  });

  it('is a pure function of its inputs: same world + inputs + lag give the same world', () => {
    const run = (): string => stateHash(drive(400, 1.5, 1, true).world);
    expect(run()).toBe(run());
  });

  it('absurd credit values are bounded (cap) and negative / missing ones are ignored', () => {
    const huge = drive(300, 1.0, 1, false);
    const run = (lag: number): string => {
      let w = worldWith(1, spawn);
      let seq = 0;
      for (let t = 0; t < 300; t++) w = step(w, [mv(1, ++seq, SE)], ctx, TICK, { lagMs: () => lag }).world;
      return stateHash(w);
    };
    expect(run(Number.MAX_SAFE_INTEGER)).toBe(run(ANTICHEAT.MAX_LAG_CREDIT_MS)); // capped
    expect(run(-1000)).toBe(stateHash(huge.world)); // negative = no credit
    expect(run(Number.NaN)).toBe(stateHash(huge.world)); // NaN = no credit
  });
});

describe('queue room and drain', () => {
  it('a legitimate stall backlog (server blocked ~3 s, then a burst) fits in the credit-sized queue; without credit it overflows', () => {
    const burst = (n: number): SimInput[] => Array.from({ length: n }, (_, k) => mv(1, 1 + k, SE));
    const lag = 3000;
    const withCredit = step(worldWith(1, spawn), burst(60), ctx, TICK, { lagMs: () => lag });
    expect(withCredit.events.filter((e) => e.type === 'violation')).toEqual([]);
    const without = step(worldWith(1, spawn), burst(60), ctx, TICK);
    expect(without.events.some((e) => e.type === 'violation' && e.kind === 'queue')).toBe(true);
  });

  it('the extra queue room is bounded (memory): a flood is still dropped and punished however large the credit', () => {
    const flood = Array.from({ length: 1000 }, (_, k) => mv(1, 1 + k, SE));
    const r = step(worldWith(1, spawn), flood, ctx, TICK, { lagMs: () => ANTICHEAT.MAX_LAG_CREDIT_MS });
    expect(ent(r.world, 1).pending.length).toBeLessThanOrEqual(32 + ANTICHEAT.LAG_QUEUE_EXTRA_MAX);
    expect(r.events.some((e) => e.type === 'violation' && e.kind === 'queue')).toBe(true);
  });
});

describe('skills on a slow server: cooldown, GCD and the cast-rate bucket run on the same clock', () => {
  it('an honest client that waits the cooldown in WALL time is accepted on a server running behind; without credit it is rejected', () => {
    // skill 1: cooldown 3000 ms, GCD 500. The client casts, then casts again 3.05 s of wall time later.
    const slow = 1.5;
    const cooldownWallMs = 3050;
    const castAtWall = (credit: boolean): { rejected: boolean; reasons: CastReason[] } => {
      let w = worldWith(1, { ...spawn, mpMax: 1000, mp: 1000 });
      const reasons: CastReason[] = [];
      const secondTick = Math.round(cooldownWallMs / slow / TICK); // sim ticks that pass in cooldownWallMs of wall time
      for (let t = 0; t <= secondTick + 1; t++) {
        const inputs: SimInput[] = [];
        if (t === 0) inputs.push(cast(1, 1, 1));
        if (t === secondTick) inputs.push(cast(1, 2, 1));
        const lag = credit ? (slow - 1) * TICK * (t + 1) : 0;
        const r = step(w, inputs, ctx, TICK, { lagMs: () => lag });
        w = r.world;
        for (const e of r.events) if (e.type === 'cast_rejected') reasons.push(e.reason);
      }
      return { rejected: reasons.includes(CastReason.Cooldown), reasons };
    };
    expect(castAtWall(true).rejected).toBe(false);
    expect(castAtWall(false).rejected).toBe(true);
  });

  it('cooldown readiness is still reported to clients in SIM time (the clock they see in snapshots)', () => {
    let w = worldWith(1, { ...spawn, mpMax: 1000, mp: 1000 });
    const lag = 1000;
    const r = step(w, [cast(1, 1, 1)], ctx, TICK, { lagMs: () => lag });
    w = r.world;
    const ok = r.events.find((e) => e.type === 'cast_ok');
    expect(ok && ok.type === 'cast_ok' ? ok.readyAtMs : -1).toBeCloseTo(w.timeMs + 3000, 6); // cooldown 3000 from NOW in sim time
  });

  it('an unknown-skill rejection reports readyAtMs 0, never negative, with credit', () => {
    const r = step(worldWith(1, spawn), [cast(1, 1, 63)], ctx, TICK, { lagMs: () => 2000 });
    const rej = r.events.find((e) => e.type === 'cast_rejected');
    expect(rej && rej.type === 'cast_rejected' ? rej.readyAtMs : -1).toBe(0);
  });
});
