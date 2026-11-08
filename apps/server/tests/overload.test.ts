/**
 * A World Node that falls behind real time (CPU-starved host, long GC, ticks > 50 ms) must not punish its honest clients: they are
 * paced by the wall clock, the anti-cheat by sim time. Regression for the finding from the bag-smoke run (#219): after minutes of
 * overload the legitimate client was kicked for 'queue' violations. The node measures its own lag (`wallClock`) and gives each client
 * a credit (`lagCreditOf`) that `step()` applies to the guards.
 */
import { describe, expect, it } from 'vitest';
import { encode } from '@vgtd/protocol';
import { ErrorCode } from '@vgtd/protocol';
import { ANTICHEAT, WALK_SPEED, budgetMs } from '@vgtd/sim';
import { WorldNode, type ClientTransport } from '../src/index.js';

class Client implements ClientTransport {
  seq = 0;
  closed: { code: ErrorCode; text: string } | null = null;
  id = 0;
  send(): void {}
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  inputs(n: number): Uint8Array {
    const inputs = [];
    for (let k = 0; k < n; k++) inputs.push({ seq: ++this.seq & 0xffff, dtMs: 50, dir: 0, mag: 15, flags: 0 });
    return encode({ type: 'input', ack: 0, inputs });
  }
}

interface Rig {
  node: WorldNode;
  wall: { ms: number };
}
/** `lagAware: false` hands the node a frozen wall clock: it can then never see its own lag (the pre-fix behaviour). */
function rig(lagAware = true): Rig {
  const wall = { ms: 0 };
  const node = new WorldNode({
    mapTiles: 1024,
    spawn: { i0: 100, j0: 500, side: 4 },
    wallClock: () => (lagAware ? wall.ms : 0),
    packetClock: () => wall.ms, // the packet-rate window follows the same simulated wall time
  });
  return { node, wall };
}

/** One honest client at wall pace (one 50 ms input per 50 ms of WALL time) on a server whose ticks take `slow` x 50 ms of wall time. */
function play(r: Rig, c: Client, ticks: number, slow: number, perWall = 1): { kickedAt: number | null } {
  let owed = 0;
  for (let t = 0; t < ticks; t++) {
    r.wall.ms += 50 * slow;
    owed += slow * perWall;
    const n = Math.floor(owed);
    owed -= n;
    for (let k = 0; k < n; k += 3) r.node.receive(c.id, c.inputs(Math.min(3, n - k)), c);
    r.node.tick();
    if (!r.node.clients.has(c.id)) return { kickedAt: t };
  }
  return { kickedAt: null };
}
const join = (r: Rig): Client => {
  const c = new Client();
  c.id = r.node.addPlayer(c, `acc${r.node.clients.size}`);
  return c;
};
const ent = (n: WorldNode, id: number) => n.world.entities.find((e) => e.id === id);

describe('an overloaded World Node does not kick honest clients', () => {
  it('control: a node that cannot see its own lag kicks an honest client at wall pace (the bug)', () => {
    const r = rig(false);
    const c = join(r);
    const { kickedAt } = play(r, c, 1200, 1.3);
    expect(kickedAt).not.toBeNull();
    expect(c.closed?.text).toBe('anti-cheat');
    expect(r.node.metrics.violations.queue ?? 0).toBeGreaterThan(0);
  });

  it('with lag measurement the same client survives a 60 s sustained overload of 30%, 60% and 100%, with no violations at all', () => {
    for (const slow of [1.3, 1.6, 2.0]) {
      const r = rig();
      const c = join(r);
      const { kickedAt } = play(r, c, 1200, slow);
      expect(kickedAt, `slow ${slow}`).toBeNull();
      expect(r.node.metrics.violations, `slow ${slow}`).toEqual({});
      expect(r.node.metrics.warns).toBe(0);
      expect(r.node.lagCreditOf(c.id), `slow ${slow}`).toBeGreaterThan(0);
    }
  });

  it('the player keeps moving at WALL-clock speed (the server processes more inputs per tick to catch up)', () => {
    const r = rig();
    const c = join(r);
    const start = ent(r.node, c.id)!.i;
    play(r, c, 1200, 1.6);
    const wallS = r.wall.ms / 1000;
    const moved = ent(r.node, c.id)!.i - start;
    expect(moved).toBeGreaterThan(WALK_SPEED * (wallS - 1.5));
    expect(moved).toBeLessThanOrEqual(WALK_SPEED * (wallS + 0.3));
  });

  it('recovery: once the server is back on time the backlog is gone and the credit stops growing', () => {
    const r = rig();
    const c = join(r);
    play(r, c, 400, 1.6); // overloaded for 20 s of sim time
    const credit = r.node.lagCreditOf(c.id);
    expect(credit).toBeGreaterThan(5000);
    expect(play(r, c, 400, 1.0).kickedAt).toBeNull(); // back to real time
    expect(r.node.lagCreditOf(c.id)).toBe(credit); // no drift any more: unchanged (and never decreases)
    expect(ent(r.node, c.id)!.pending.length).toBeLessThan(4);
    expect(r.node.metrics.violations).toEqual({});
  });
});

describe('the credit does not make cheating easier', () => {
  it('a speedhacker at twice the wall pace is still caught on an overloaded server', () => {
    for (const slow of [1.0, 1.5]) {
      const r = rig();
      const c = join(r);
      const { kickedAt } = play(r, c, 1200, slow, 2);
      expect(kickedAt, `slow ${slow}`).not.toBeNull();
      expect(c.closed?.text).toBe('anti-cheat');
    }
  });

  it('on a healthy node (ticks driven faster than real time, as tests and benchmarks do) there is never any credit', () => {
    const r = rig();
    const c = join(r);
    for (let t = 0; t < 300; t++) {
      r.wall.ms += 10; // far faster than 50 ms per tick
      r.node.receive(c.id, c.inputs(1), c);
      r.node.tick();
    }
    expect(r.node.lagCreditOf(c.id)).toBe(0);
  });
});

describe('credit bookkeeping', () => {
  it('is per client: a client that joins during an overload starts at zero and only earns what accrues after it joined', () => {
    const r = rig();
    const a = join(r);
    play(r, a, 200, 1.5); // 10 s of sim time at 50% overload => ~5 s of drift
    const b = join(r);
    expect(r.node.lagCreditOf(b.id)).toBe(0);
    play(r, b, 200, 1.5);
    const gotB = r.node.lagCreditOf(b.id);
    expect(gotB).toBeGreaterThan(4000);
    expect(gotB).toBeLessThan(6000);
    expect(r.node.lagCreditOf(a.id)).toBeGreaterThan(gotB); // a was there for the whole overload
  });

  it('a client that joins at the END of a stall earns no credit for the stall that predates it', () => {
    const r = rig();
    const a = join(r);
    play(r, a, 20, 1.0); // healthy
    r.wall.ms += 5000; // the node is stalled for 5 s: no tick runs
    const b = join(r); // joins when the stall is over: it was not there for it
    r.wall.ms += 50;
    r.node.tick();
    expect(r.node.lagCreditOf(b.id)).toBe(0);
    expect(r.node.lagCreditOf(a.id)).toBeGreaterThan(4000); // a was there the whole time
  });

  it('a resumed client with lag credit comes back with no unearned budget (the slide uses the guards clock)', () => {
    const r = rig();
    const c = join(r);
    play(r, c, 400, 1.6); // 20 s of sim time at 60% overload: a substantial credit
    expect(r.node.lagCreditOf(c.id)).toBeGreaterThan(5000);
    const token = r.node.resumeTokenOf(c.id)!;
    expect(r.node.suspendPlayer(c.id, c)).toBe(true);
    for (let t = 0; t < 40; t++) {
      r.wall.ms += 50; // 2 s held, server on time
      r.node.tick();
    }
    const fresh = new Client();
    fresh.id = c.id;
    expect(r.node.resumePlayer(c.id, token, fresh)).not.toBeNull();
    const e = ent(r.node, c.id)!;
    const guardsNow = r.node.world.timeMs + r.node.lagCreditOf(c.id);
    expect(budgetMs(e.ac, guardsNow) - e.ac.claimedMs).toBeLessThanOrEqual(ANTICHEAT.SLIDE_LAG_MS + 1e-6);
  });

  it('never decreases (the guards clock must not run backwards), even if the node later speeds up', () => {
    const r = rig();
    const c = join(r);
    play(r, c, 100, 1.5);
    let last = r.node.lagCreditOf(c.id);
    expect(last).toBeGreaterThan(0);
    for (let t = 0; t < 200; t++) {
      r.wall.ms += 20; // now running much faster than real time: the raw drift shrinks
      r.node.tick();
      const now = r.node.lagCreditOf(c.id);
      expect(now).toBeGreaterThanOrEqual(last);
      last = now;
    }
  });

  it('is zero for unknown ids (mobs, released players)', () => {
    const r = rig();
    expect(r.node.lagCreditOf(999_999)).toBe(0);
    const c = join(r);
    play(r, c, 50, 1.5);
    r.node.removePlayer(c.id);
    expect(r.node.lagCreditOf(c.id)).toBe(0);
  });
});
