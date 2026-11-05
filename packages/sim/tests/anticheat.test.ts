import { describe, expect, it } from 'vitest';
import { NETWORK } from '@vgtd/shared';
import {
  ANTICHEAT,
  CastReason,
  TileGrid,
  WALK_SPEED,
  addViolation,
  budgetMs,
  distanceViolation,
  newAntiCheat,
  step,
  stepMove,
  takeCastToken,
  tickAntiCheat,
  type MoveState,
  type SimEvent,
} from '../src/index.js';
import { SE, cast, ctxOf, ent, mv, openGrid, run, worldWith } from './helpers.js';

const TICK = NETWORK.TICK_MS;
const ctx = ctxOf(openGrid(256));
const spawn = { id: 1, i: 10.5, j: 100.5 };

describe('speedhack: declared-time budget', () => {
  it('an honest client (50 ms inputs at 20 Hz for 40 s) never trips anything', () => {
    let seq = 0;
    const r = run(worldWith(1, spawn), ctx, 800, () => [mv(1, ++seq, SE)]);
    expect(r.events.filter((e) => e.type === 'violation' || e.type === 'disconnect')).toEqual([]);
    expect(ent(r.world, 1).i - 10.5).toBeCloseTo(WALK_SPEED * 40, 6);
  });

  it('honest jitter (a lag spike followed by a catch-up burst) is absorbed by the 250 ms slack and 1.25x allowance', () => {
    let seq = 0;
    const r = run(worldWith(1, spawn), ctx, 400, (t) => {
      if (t % 40 === 5) return []; // lag spike: no input this tick
      if (t % 40 === 6) return [mv(1, ++seq, SE, { dtMs: 31 }), mv(1, ++seq, SE, { dtMs: 31 })]; // catch-up
      return [mv(1, ++seq, SE)];
    });
    expect(r.events.filter((e) => e.type === 'violation')).toEqual([]);
  });

  it('a 1.24x clock (62 ms of declared input every 50 ms) is capped at the Budget (and soon disconnected)', () => {
    let seq = 0;
    const secs = 20;
    const r = run(worldWith(1, spawn), ctx, (secs * 1000) / TICK, () => [
      mv(1, ++seq, SE, { dtMs: 31 }),
      mv(1, ++seq, SE, { dtMs: 31 }),
    ]);
    const e = ent(r.world, 1);
    const travelled = e.i - 10.5;
    const maxLegit = WALK_SPEED * (ANTICHEAT.BUDGET_RATE * secs + ANTICHEAT.BUDGET_SLACK_MS / 1000);
    expect(travelled).toBeLessThanOrEqual(maxLegit + 1e-6);
    expect(travelled).toBeGreaterThan(10);
    expect(e.ac.claimedMs).toBeLessThanOrEqual(budgetMs(e.ac, r.world.timeMs) + 1e-6);
    expect(r.events.some((x) => x.type === 'violation' && x.kind === 'budget')).toBe(true);
  });

  it('a hard speedhack (3 inputs per tick) is held back, scored, warned and disconnected', () => {
    let seq = 0;
    const r = run(worldWith(1, spawn), ctx, 400, () => [mv(1, ++seq, SE), mv(1, ++seq, SE), mv(1, ++seq, SE)]);
    const e = ent(r.world, 1);
    expect(e.connected).toBe(false);
    const warn = r.events.findIndex((x) => x.type === 'warn');
    const dc = r.events.findIndex((x) => x.type === 'disconnect');
    expect(warn).toBeGreaterThanOrEqual(0);
    expect(dc).toBeGreaterThan(warn);
    // never faster than the budget allows, even though it sent 3x as much
    expect(e.i - 10.5).toBeLessThan(WALK_SPEED * (ANTICHEAT.BUDGET_RATE * (r.world.timeMs / 1000) + 0.25) + 1e-6);
    // once disconnected, further inputs are ignored
    const after = run(r.world, ctx, 20, () => [mv(1, ++seq, SE)]);
    expect(ent(after.world, 1).i).toBe(e.i);
  });

  it('held inputs do not move the character beyond the budget but still advance lastSeq', () => {
    let seq = 0;
    const flood = run(worldWith(1, spawn), ctx, 30, () => [mv(1, ++seq, SE), mv(1, ++seq, SE)]);
    const e0 = ent(flood.world, 1);
    const r = step(flood.world, [mv(1, 60000, SE), mv(1, 60001, SE)], ctx);
    expect(ent(r.world, 1).i - e0.i).toBeLessThanOrEqual(WALK_SPEED * 0.0625 + 1e-9);
  });

  it('declared dt outside 8-50 ms is clamped and scored', () => {
    const r = step(worldWith(1, spawn), [mv(1, 1, SE, { dtMs: 200 })], ctx);
    expect(r.events.some((e) => e.type === 'violation' && e.kind === 'dt')).toBe(true);
    expect(ent(r.world, 1).i - 10.5).toBeCloseTo(WALK_SPEED * 0.05, 9); // treated as 50 ms
    const r2 = step(worldWith(1, spawn), [mv(1, 1, SE, { dtMs: 1 })], ctx);
    expect(ent(r2.world, 1).i - 10.5).toBeCloseTo(WALK_SPEED * 0.008, 9);
    const r3 = step(worldWith(1, spawn), [mv(1, 1, SE, { dtMs: NaN })], ctx);
    expect(Number.isFinite(ent(r3.world, 1).i)).toBe(true);
  });

  it('input queue is capped (flooding is scored and the oldest inputs are dropped)', () => {
    const flood = Array.from({ length: 200 }, (_, k) => mv(1, k + 1, SE));
    const r = step(worldWith(1, spawn), flood, ctx);
    expect(ent(r.world, 1).pending.length).toBeLessThanOrEqual(32);
    expect(r.events.some((e) => e.type === 'violation' && e.kind === 'queue')).toBe(true);
  });
});

describe('speedhack: sliding budget (idle time cannot be banked)', () => {
  it('after 30 s idle the budget is pulled down to Claimed + 1 s, so a 1.24x clock is caught within seconds', () => {
    const idle = run(worldWith(1, spawn), ctx, (30 * 1000) / TICK, () => []);
    const e = ent(idle.world, 1);
    expect(budgetMs(e.ac, idle.world.timeMs)).toBeLessThan(
      1000 + ANTICHEAT.BUDGET_RATE * ANTICHEAT.SLIDE_PERIOD_MS + 1,
    );
    let seq = 0;
    const r = run(idle.world, ctx, 200, () => [mv(1, ++seq, SE, { dtMs: 31 }), mv(1, ++seq, SE, { dtMs: 31 })]);
    expect(r.events.some((x) => x.type === 'violation')).toBe(true);
  });

  it('without sliding the same idle time would have banked about 30 s (why the rule exists)', () => {
    expect(budgetMs(newAntiCheat(0), 30_000)).toBeGreaterThan(30_000);
  });
});

describe('speedhack: distance check, ratio windows, suspicion score', () => {
  const m = (o: Partial<MoveState> = {}): MoveState => ({
    i: 0,
    j: 0,
    vi: 0,
    vj: 0,
    layer: 0,
    flying: false,
    qinggong: false,
    facing: 0,
    agi: 100,
    dashLeftMs: 0,
    dashCdMs: 0,
    invulnMs: 0,
    ...o,
  });

  it('legit moves pass; teleports and over-speed moves are flagged', () => {
    const a = m();
    const legit = stepMove(a, { dtMs: 50, dir: 0, mag: 15, flags: 0 }, openGrid());
    expect(distanceViolation(a, legit, 50)).toBe(false);
    expect(distanceViolation(a, { ...a, i: 0.25 }, 50)).toBe(true); // 4.5 * 0.05 * 1.05 = 0.236
    expect(distanceViolation(a, { ...a, i: 5 }, 50)).toBe(true);
  });

  it('ratio > 1.03 in two consecutive 60 s windows flags; > 1.10 disconnects; a clean window resets', () => {
    const events: SimEvent[] = [];
    const ac0 = { ...newAntiCheat(0), windowClaimedMs: 60_000 * 1.05 };
    let r = tickAntiCheat(ac0, 1, 60_000, TICK, events);
    expect(events.filter((e) => e.type === 'flag')).toHaveLength(0); // first hot window: not yet
    r = tickAntiCheat({ ...r.ac, windowClaimedMs: 60_000 * 1.05 }, 1, 120_000, TICK, events);
    expect(events.filter((e) => e.type === 'flag')).toHaveLength(1);
    expect(r.disconnect).toBe(false);
    const ev2: SimEvent[] = [];
    const r2 = tickAntiCheat({ ...newAntiCheat(0), windowClaimedMs: 60_000 * 1.12 }, 1, 60_000, TICK, ev2);
    expect(r2.disconnect).toBe(true);
    expect(ev2.some((e) => e.type === 'disconnect')).toBe(true);
    const r3 = tickAntiCheat({ ...r.ac, windowClaimedMs: 60_000 }, 1, 180_000, TICK, []);
    expect(r3.ac.hotWindows).toBe(0);
  });

  it('suspicion: +1 per violation, -1 per minute; 20 warns, 50 disconnects', () => {
    const ev: SimEvent[] = [];
    let ac = newAntiCheat(0);
    for (let k = 0; k < 19; k++) ac = addViolation(ac, 1, 'budget', ev).ac;
    expect(ev.some((e) => e.type === 'warn')).toBe(false);
    ac = addViolation(ac, 1, 'budget', ev).ac;
    expect(ev.filter((e) => e.type === 'warn')).toHaveLength(1);
    expect(addViolation({ ...ac, score: 49 }, 1, 'budget', []).disconnect).toBe(true);
    expect(addViolation({ ...ac, score: 48 }, 1, 'budget', []).disconnect).toBe(false);
    const t = tickAntiCheat({ ...newAntiCheat(0), score: 3 }, 1, 60_000, 60_000, []);
    expect(t.ac.score).toBeCloseTo(2, 9);
  });
});

describe('cooldown hack: skill readiness is held by the server', () => {
  const c = ctx;
  const w0 = () => worldWith(1, { id: 1, i: 10.5, j: 10.5, mp: 100 }, { id: 2, i: 14.5, j: 10.5 });
  const kinds = (ev: SimEvent[]) =>
    ev
      .filter((e) => e.type !== 'violation')
      .map((e) => (e.type === 'cast_rejected' ? `rej:${CastReason[e.reason]}` : e.type));

  it('a cast succeeds, sets readyAt = now + cooldown, spends MP and starts the GCD', () => {
    const r = step(w0(), [cast(1, 1, 1)], c);
    expect(kinds(r.events)).toEqual(['cast_ok']);
    const e = ent(r.world, 1);
    expect(e.mp).toBe(90);
    expect(e.cooldowns[1]).toBe(TICK + 3000);
    expect(e.gcdReadyAt).toBe(TICK + 500);
  });

  it('re-casting early is rejected and scored, with the true readyAt so the client can correct its UI', () => {
    const w = step(w0(), [cast(1, 1, 1)], c).world;
    const r = run(w, c, 20, (t) => (t === 10 ? [cast(1, 2, 1)] : []));
    const rej = r.events.find((e) => e.type === 'cast_rejected');
    expect(rej).toMatchObject({
      type: 'cast_rejected',
      reason: CastReason.Cooldown,
      readyAtMs: TICK + 3000,
      skillId: 1,
    });
    expect(ent(r.world, 1).ac.score).toBeGreaterThan(0.9);
    expect(ent(r.world, 1).mp).toBe(90); // nothing was spent
  });

  it('latency tolerance is min(RTT/2, 100 ms)', () => {
    const w = step(w0(), [cast(1, 1, 1)], c).world; // readyAt = 3050
    const castAt = (targetMs: number, rtt: number) => {
      const x = run(w, c, (targetMs - 2 * TICK) / TICK, () => []).world; // ends at targetMs - 50
      return step(x, [cast(1, 2, 1, { rttMs: rtt })], c).events.map((e) => e.type);
    };
    expect(castAt(2960, 200)).toContain('cast_ok'); // 90 ms early, tolerance 100
    expect(castAt(2960, 0)).toContain('cast_rejected'); // no tolerance
    expect(castAt(2900, 10_000)).toContain('cast_rejected'); // 150 ms early: tolerance capped at 100
    expect(castAt(3050, 0)).toContain('cast_ok'); // exactly on time
  });

  it('GCD blocks a different skill; MP, stun and unknown skills are rejected', () => {
    const w = step(w0(), [cast(1, 1, 1)], c).world;
    expect(kinds(step(w, [cast(1, 2, 3)], c).events)).toEqual(['rej:Gcd']);
    const poor = worldWith(1, { id: 1, i: 10.5, j: 10.5, mp: 5 });
    expect(kinds(step(poor, [cast(1, 1, 1)], c).events)).toEqual(['rej:NoMp']);
    const base = w0();
    const stunned = { ...base, entities: base.entities.map((e) => ({ ...e, stunMs: 500 })) };
    expect(kinds(step(stunned, [cast(1, 1, 1)], c).events)).toEqual(['rej:Controlled']);
    expect(kinds(step(w0(), [cast(1, 1, 99)], c).events)).toEqual(['rej:UnknownSkill']);
  });

  it('range, target and line of sight are checked on the server grid', () => {
    expect(kinds(step(w0(), [cast(1, 1, 2, { targetId: 2 })], c).events)).toEqual(['cast_ok']);
    const far = worldWith(1, { id: 1, i: 10.5, j: 10.5 }, { id: 2, i: 40.5, j: 10.5 });
    expect(kinds(step(far, [cast(1, 1, 2, { targetId: 2 })], c).events)).toEqual(['rej:OutOfRange']);
    expect(kinds(step(w0(), [cast(1, 1, 2, { targetId: 77 })], c).events)).toEqual(['rej:BadTarget']);
    expect(kinds(step(w0(), [cast(1, 1, 2, { targetId: 1 })], c).events)).toEqual(['rej:BadTarget']);
    const rows = Array.from({ length: 20 }, (_, j) => (j === 10 ? '.....#.......#......' : '.'.repeat(20)));
    const walled = { grid: TileGrid.fromRows(rows), skills: ctx.skills };
    const ww = worldWith(1, { id: 1, i: 3.5, j: 10.5 }, { id: 2, i: 7.5, j: 10.5 });
    expect(kinds(step(ww, [cast(1, 1, 2, { targetId: 2 })], walled).events)).toEqual(['rej:NoLineOfSight']);
  });

  it('cast packets pass through a token bucket (10/s): the excess is dropped, not scored', () => {
    const burst = Array.from({ length: 25 }, (_, k) => cast(1, k + 1, 3)); // skill 3 has no cooldown
    const r = step(w0(), burst, c);
    expect(r.events.filter((e) => e.type === 'cast_ok')).toHaveLength(10);
    expect(r.events.filter((e) => e.type === 'cast_dropped')).toHaveLength(15);
    expect(ent(r.world, 1).ac.score).toBe(0);
    // sustained 20 Hz is throttled to ~10 Hz
    let ac = newAntiCheat(0);
    let ok = 0;
    for (let k = 0; k < 200; k++) {
      const t = takeCastToken(ac, k * 50);
      ac = t.ac;
      if (t.ok) ok++;
    }
    expect(ok).toBeGreaterThanOrEqual(100); // 10 s at 10/s
    expect(ok).toBeLessThanOrEqual(112); // plus the initial bucket
  });

  it('cast rolls come from the seeded world RNG: same seed same roll, different seed different roll', () => {
    const roll = (seed: number) => {
      const w = worldWith(seed, { id: 1, i: 10.5, j: 10.5, mp: 100 });
      const ev = step(w, [cast(1, 1, 1)], c).events[0];
      return ev?.type === 'cast_ok' ? ev.roll : -1;
    };
    expect(roll(5)).toBe(roll(5));
    expect(roll(5)).not.toBe(roll(6));
    expect(roll(5)).toBeGreaterThanOrEqual(0);
    expect(roll(5)).toBeLessThan(1);
  });
});
