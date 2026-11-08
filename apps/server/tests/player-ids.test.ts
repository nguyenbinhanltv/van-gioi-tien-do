import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { MOB_ID_BASE, NETWORK, rngInt, rngSeed } from '@vgtd/shared';
import { ErrorCode } from '@vgtd/protocol';
import { WorldFullError, WorldNode, startServer, type ClientTransport, type RunningServer } from '../src/index.js';
import { Bot } from '../src/loadtest/bot.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

class Quiet implements ClientTransport {
  send(): void {}
  close(_c: ErrorCode, _t: string): void {}
  buffered(): number {
    return 0;
  }
}
const QUARANTINE_MS = 1000;
const ticksFor = (ms: number): number => Math.ceil(ms / NETWORK.TICK_MS) + 1;
const setNextId = (n: WorldNode, v: number): void => {
  (n as unknown as { nextId: number }).nextId = v;
};
function node(mobs = true): WorldNode {
  return new WorldNode({
    seed: 5,
    mapTiles: 96,
    spawn: { i0: 40, j0: 40, side: 8 },
    playerIdQuarantineMs: QUARANTINE_MS,
    mobs: mobs ? { zones: [{ zone: 'bia_rung', i0: 10, j0: 10, i1: 30, j1: 30 }], density: 0.1 } : false,
  });
}
function run(n: WorldNode, ms: number): void {
  for (let t = 0; t < ticksFor(ms); t++) n.tick();
}

describe('player id recycling (D74 follow-up)', () => {
  it('a released id is quarantined, then reused (lowest-released first)', () => {
    const n = node();
    const a = n.addPlayer(new Quiet(), 'a');
    const b = n.addPlayer(new Quiet(), 'b');
    expect([a, b]).toEqual([1, 2]);
    n.removePlayer(a);
    n.removePlayer(b);
    // right after the release both ids are still quarantined: a new player gets a FRESH id
    expect(n.addPlayer(new Quiet(), 'c')).toBe(3);
    run(n, QUARANTINE_MS);
    expect(n.addPlayer(new Quiet(), 'd')).toBe(1); // oldest release first
    expect(n.addPlayer(new Quiet(), 'e')).toBe(2);
    expect(n.addPlayer(new Quiet(), 'f')).toBe(4); // nothing left to recycle
  });

  it('the quarantine is sim time: not reusable one tick before it ends', () => {
    const n = node();
    const a = n.addPlayer(new Quiet(), 'a');
    n.removePlayer(a);
    for (let t = 0; t < QUARANTINE_MS / NETWORK.TICK_MS - 1; t++) n.tick();
    expect(n.canAcceptPlayer()).toBe(true); // a fresh id exists...
    expect(n.addPlayer(new Quiet(), 'b')).not.toBe(a); // ...but the quarantined one is not handed out
    run(n, NETWORK.TICK_MS * 2);
    expect(n.addPlayer(new Quiet(), 'c')).toBe(a);
  });

  it('usable ids follow concurrent players, not total joins: cycling at the id limit never runs out', () => {
    const n = node();
    setNextId(n, MOB_ID_BASE - 1);
    let id = n.addPlayer(new Quiet(), 'x');
    expect(id).toBe(MOB_ID_BASE - 1); // the last fresh id
    for (let cycle = 0; cycle < 8; cycle++) {
      n.removePlayer(id);
      expect(n.canAcceptPlayer()).toBe(false); // no fresh id left and the released one is quarantined
      expect(() => n.addPlayer(new Quiet(), 'late')).toThrow(WorldFullError);
      run(n, QUARANTINE_MS);
      expect(n.canAcceptPlayer()).toBe(true);
      id = n.addPlayer(new Quiet(), 'x');
      expect(id).toBe(MOB_ID_BASE - 1); // recycled
    }
    expect(n.clients.size).toBe(1);
  });

  it('is refused (and nothing is added) while every id is in use or quarantined', () => {
    const n = node();
    setNextId(n, MOB_ID_BASE - 2);
    const a = n.addPlayer(new Quiet(), 'a');
    const b = n.addPlayer(new Quiet(), 'b');
    expect([a, b]).toEqual([MOB_ID_BASE - 2, MOB_ID_BASE - 1]);
    const entities = n.world.entities.length;
    expect(n.canAcceptPlayer()).toBe(false);
    expect(() => n.addPlayer(new Quiet(), 'c')).toThrow(WorldFullError);
    expect(n.world.entities).toHaveLength(entities);
    expect(n.clients.size).toBe(2);
  });

  it('churn: ids of live players are unique, below MOB_ID_BASE and never a mob id (200 random joins/leaves)', () => {
    const n = node();
    let rng = rngSeed(99);
    const live: number[] = [];
    for (let op = 0; op < 200; op++) {
      const [r, next] = rngInt(rng, 3);
      rng = next;
      if (r < 2 || live.length === 0) {
        if (n.canAcceptPlayer()) live.push(n.addPlayer(new Quiet(), `p${op}`));
      } else {
        const [k, next2] = rngInt(rng, live.length);
        rng = next2;
        n.removePlayer(live.splice(k, 1)[0]!);
      }
      n.tick();
      const ids = n.world.entities.map((e) => e.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of live) {
        expect(id).toBeLessThan(MOB_ID_BASE);
        expect(n.mobs!.kindOf(id)).toBe(0);
        expect(n.clients.has(id)).toBe(true);
      }
    }
    expect(live.length).toBeGreaterThan(0);
  });

  it('a node without mobs recycles too and keeps allocating past MOB_ID_BASE', () => {
    const n = node(false);
    setNextId(n, MOB_ID_BASE + 5);
    expect(n.addPlayer(new Quiet(), 'a')).toBe(MOB_ID_BASE + 5);
    expect(n.canAcceptPlayer()).toBe(true);
  });
});

describe('gateway: a refused join does not kick the live session', () => {
  let srv: RunningServer;
  beforeAll(async () => {
    srv = await startServer({
      port: 0,
      auth: { scrypt: { N: 1024, r: 8, p: 1 }, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      gateway: { helloTimeoutMs: 300 },
      world: { mapTiles: 96, spawn: { i0: 40, j0: 40, side: 8 }, mobs: true, playerIdQuarantineMs: 100 },
    });
  });
  afterAll(async () => {
    await srv.stop();
  });
  const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
    const t0 = Date.now();
    while (!cond()) {
      if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
      await new Promise((r) => setTimeout(r, 20));
    }
  };

  it('with no id available the second login is refused, the older connection stays; after the quarantine joins work again', async () => {
    void TEST_ONLY_GOOD;
    (srv.world as unknown as { nextId: number }).nextId = MOB_ID_BASE - 1;
    const first = new Bot({ host: '127.0.0.1', port: srv.port, name: 'idowner' });
    await first.connect();
    const id = first.entityId;
    expect(id).toBe(MOB_ID_BASE - 1);

    const second = new Bot({ host: '127.0.0.1', port: srv.port, name: 'idowner' });
    await expect(second.connect()).rejects.toThrow(/closed before hello_ack/);
    expect(first.socket.readyState).toBe(WebSocket.OPEN); // not replaced
    expect(srv.world.clients.has(id)).toBe(true);
    expect(srv.world.clients.size).toBe(1);

    first.stop();
    await until(() => !srv.world.clients.has(id));
    await until(() => srv.world.canAcceptPlayer()); // 100 ms of sim time later the id is reusable
    const third = new Bot({ host: '127.0.0.1', port: srv.port, name: 'idowner' });
    await third.connect();
    expect(third.entityId).toBe(id);
    third.stop();
  });
});
