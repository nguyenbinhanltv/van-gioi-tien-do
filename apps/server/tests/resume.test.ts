/**
 * Reconnect / resume (docs/24 section 4): a dropped player's entity is held, a matching single-use token re-attaches a new
 * connection to the SAME entity, combat / progression registrations are never re-created, and the wire / anti-cheat state restarts.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { ErrorCode, decode, encode, type BaselinePos, type Message, type SnapshotMsg } from '@vgtd/protocol';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js';
import { TileGrid } from '@vgtd/sim';
import {
  WorldNode,
  startServer,
  type ClientTransport,
  type RunningServer,
  type WorldNodeOptions,
} from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

class Fake implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  known = new Map<number, BaselinePos>();
  id = 0;
  seq = 0;
  lastSnapshotSeq = 0;
  send(data: Uint8Array): void {
    const m = decode(data, { baseline: (i) => this.known.get(i) });
    this.msgs.push(m);
    if (m.type === 'snapshot') {
      this.lastSnapshotSeq = m.seq;
      for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    } else if (m.type === 'aoi_enter') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_leave') for (const i of m.indices) this.known.delete(i);
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.msgs.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
  input(dir: number, dtMs = 50, count = 1, mag = 15): Uint8Array {
    const inputs = [];
    for (let k = 0; k < count; k++) inputs.push({ seq: ++this.seq & 0xffff, dtMs, dir, mag, flags: 0 });
    return encode({ type: 'input', ack: this.lastSnapshotSeq, inputs });
  }
}

function node(o: WorldNodeOptions = {}): WorldNode {
  return new WorldNode({ mapTiles: 160, spawn: { i0: 70, j0: 70, side: 8 }, combat: {}, resumeHoldMs: 2000, ...o });
}
function join(n: WorldNode, account = `acc${n.clients.size}`): Fake {
  const c = new Fake();
  c.id = n.addPlayer(c, account);
  return c;
}
const ticks = (n: WorldNode, k: number): void => {
  for (let t = 0; t < k; t++) n.tick();
};
const ent = (n: WorldNode, id: number) => n.world.entities.find((e) => e.id === id);

describe('World Node: hold a dropped player and resume it', () => {
  it('suspend keeps the entity, its id and its combat registration; others still see it; the hold ends after resumeHoldMs', () => {
    const n = node();
    const a = join(n);
    const b = join(n);
    ticks(n, 4);
    expect(b.of('aoi_enter').flatMap((m) => m.entities).length).toBe(1);
    expect(n.suspendPlayer(a.id, a)).toBe(true);
    expect(n.clients.has(a.id)).toBe(true);
    expect(n.combat!.maxHpOf(a.id)).toBeDefined();
    ticks(n, 30); // 1.5 s of the 2 s hold
    expect(ent(n, a.id)).toBeDefined();
    expect(b.of('aoi_leave')).toHaveLength(0); // still standing there for everybody else
    ticks(n, 15); // past the hold
    expect(n.clients.has(a.id)).toBe(false);
    expect(ent(n, a.id)).toBeUndefined();
    expect(n.combat!.maxHpOf(a.id)).toBeUndefined(); // combat registration released only now
    expect(b.of('aoi_leave').length).toBeGreaterThan(0);
    // the id is quarantined like any released id
    const c = join(n);
    expect(c.id).not.toBe(a.id);
  });

  it('resume: same entity and id, rotated token, full resync (aoi_enter + full snapshot + vitals), numbering and anti-cheat clock restart', () => {
    const n = node();
    const a = join(n);
    const b = join(n);
    ticks(n, 4);
    const token0 = n.resumeTokenOf(a.id)!;
    expect(token0).toMatch(/^[0-9a-f]{32}$/);
    // play a little so there is state to carry over
    for (let k = 0; k < 10; k++) {
      n.receive(a.id, a.input(0), a);
      n.tick();
    }
    const before = ent(n, a.id)!;
    expect(before.lastSeq).toBeGreaterThan(0);
    const profile = n.combat!.profileOf(a.id);
    const spy = vi.spyOn(n.combat!, 'addPlayer');
    expect(n.suspendPlayer(a.id, a)).toBe(true);
    ticks(n, 10);
    const old = a.msgs.length;
    expect(old).toBeGreaterThan(0);
    ticks(n, 5);
    expect(a.msgs.length).toBe(old); // the dead transport is not written to

    const fresh = new Fake();
    expect(n.resumePlayer(a.id, 'wrong-token', fresh)).toBeNull();
    const res = n.resumePlayer(a.id, token0, fresh);
    expect(res).not.toBeNull();
    expect(res!.token).not.toBe(token0);
    expect(n.resumePlayer(a.id, token0, new Fake())).toBeNull(); // single use
    expect(spy).not.toHaveBeenCalled(); // never re-registered: that would reset profile / shield / alive state
    expect(n.combat!.profileOf(a.id)).toBe(profile);
    const e = ent(n, a.id)!;
    expect(e.id).toBe(a.id);
    expect(e.i).toBe(before.i); // stood still while held
    expect(e.lastSeq).toBe(0);
    expect(e.ac.claimedMs).toBe(0);
    expect(e.ac.t0Ms).toBe(n.world.timeMs);

    ticks(n, 3);
    const snaps = fresh.of('snapshot') as SnapshotMsg[];
    expect(snaps[0]!.baselineSeq).toBeNull(); // full snapshot for the new connection
    expect(snaps[0]!.self!.vitals).not.toBeNull(); // vitals re-sent (lastVitals was reset)
    expect(snaps[0]!.self!.lastSeq).toBe(0);
    const entered = fresh.of('aoi_enter').flatMap((m) => m.entities);
    expect(entered.map((x) => x.entityId)).toContain(b.id); // the whole AOI is announced again
    // the new connection drives the same entity; inputs numbered from 1 again are applied
    const i0 = ent(n, a.id)!.i;
    for (let k = 0; k < 6; k++) {
      n.receive(a.id, fresh.input(0), fresh);
      n.tick();
    }
    expect(ent(n, a.id)!.i).toBeGreaterThan(i0 + 0.5);
    expect(ent(n, a.id)!.lastSeq).toBeGreaterThan(0);
  });

  it('a wrong token or an expired hold cannot resume; the held entity is untouched by failed attempts', () => {
    const n = node();
    const a = join(n);
    const token = n.resumeTokenOf(a.id)!;
    n.suspendPlayer(a.id, a);
    expect(n.resumePlayer(a.id, undefined, new Fake())).toBeNull();
    expect(n.resumePlayer(a.id, 42, new Fake())).toBeNull();
    expect(n.resumePlayer(a.id + 1, token, new Fake())).toBeNull(); // another id with this token
    expect(n.clients.has(a.id)).toBe(true);
    ticks(n, 45); // hold over
    expect(n.resumePlayer(a.id, token, new Fake())).toBeNull();
    expect(ent(n, a.id)).toBeUndefined();
  });

  it('the time spent disconnected cannot be banked as fast movement after the resume', () => {
    const n = node({ resumeHoldMs: 20_000 });
    const a = join(n);
    ticks(n, 20);
    const token = n.resumeTokenOf(a.id)!;
    n.suspendPlayer(a.id, a);
    ticks(n, 360); // 18 s held
    const fresh = new Fake();
    fresh.id = a.id;
    expect(n.resumePlayer(a.id, token, fresh)).not.toBeNull();
    const start = ent(n, a.id)!;
    const v0 = n.metrics.violations.budget ?? 0;
    // declared 60 ms per tick (five 12 ms inputs) = 1.2x real time for 1.5 s: the time budget (1.02x + 250 ms) must catch it
    // (with the old clock, 18+ s of unused budget would have let all of it through)
    for (let k = 0; k < 30; k++) {
      n.receive(a.id, fresh.input(0, 12, 3), fresh);
      n.receive(a.id, fresh.input(0, 12, 2), fresh);
      n.tick();
    }
    expect((n.metrics.violations.budget ?? 0) - v0).toBeGreaterThan(0);
    const moved = ent(n, a.id)!.i - start.i;
    expect(ent(n, a.id)).toBeDefined(); // short enough not to be kicked outright
    expect(moved).toBeLessThan(4.5 * (1.5 * 1.02 + 0.25) + 1);
  });

  it('a resume while the old socket still looks attached (half-open) takes the session over and closes the old one', () => {
    const n = node();
    const a = join(n);
    const token = n.resumeTokenOf(a.id)!;
    const fresh = new Fake();
    expect(n.resumePlayer(a.id, token, fresh)).not.toBeNull();
    expect(a.closed?.code).toBe(ErrorCode.Kicked);
    // the old socket's late 'close' must neither suspend nor remove the player now owned by the new connection
    expect(n.suspendPlayer(a.id, a)).toBe(false);
    n.removePlayer(a.id, a);
    expect(n.clients.has(a.id)).toBe(true);
    n.receive(a.id, a.input(0), a); // stale connection: ignored
    n.receive(a.id, fresh.input(0), fresh);
    ticks(n, 2);
    expect(ent(n, a.id)!.lastSeq).toBe(1);
  });

  it('resumeHoldMs 0 disables the hold, and releaseSuspended removes a held character of an account', () => {
    const off = node({ resumeHoldMs: 0 });
    const x = join(off);
    expect(off.suspendPlayer(x.id, x)).toBe(false);

    const n = node();
    const a = join(n, 'alice');
    const b = join(n, 'bob');
    n.suspendPlayer(a.id, a);
    n.suspendPlayer(b.id, b);
    n.releaseSuspended('alice');
    expect(n.clients.has(a.id)).toBe(false);
    expect(n.clients.has(b.id)).toBe(true);
  });

  it('a held player is still a combat target (registered, alive state kept) and skipped by AOI / snapshots', () => {
    const n = node();
    const a = join(n);
    const other = join(n);
    ticks(n, 4);
    n.suspendPlayer(a.id, a);
    const hp0 = ent(n, a.id)!.hp;
    n.world = n.combat!.damagePlayer(n.world, a.id, 10, 0).world; // a mob hit while the player is disconnected
    ticks(n, 10);
    expect(n.combat!.isAlive(a.id)).toBe(true);
    expect(ent(n, a.id)!.hp).toBe(hp0 - 10);
    expect(other.of('snapshot').length).toBeGreaterThan(0); // the world keeps running for the others
  });
});

// ------------------------------------------------------------------ through the real gateway with NetClient
const servers: RunningServer[] = [];
afterAll(async () => {
  for (const s of servers) await s.stop();
});
const FAST = { N: 1024, r: 8, p: 1 };
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const until = async (cond: () => boolean, ms = 8000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await sleep(20);
  }
};
async function server(hold = 10_000): Promise<RunningServer> {
  const s = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: 128, spawn: { i0: 60, j0: 60, side: 8 }, resumeHoldMs: hold },
  });
  servers.push(s);
  return s;
}
const deps: NetDeps = {
  fetch: (url, init) => fetch(url, init),
  WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
  now: () => performance.now(),
};
const client = (
  s: RunningServer,
  name: string,
  reconnect: ConstructorParameters<typeof NetClient>[0]['reconnect'] = {},
) =>
  new NetClient({
    baseUrl: `http://127.0.0.1:${s.port}`,
    username: name,
    password: TEST_ONLY_GOOD,
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
    reconnect: reconnect === false ? false : { backoffMs: [50, 100], staleMs: 3000, ...reconnect },
  });
async function frames(net: NetClient, ms: number, intent = { dir: 255, mag: 0, flags: 0 }): Promise<void> {
  let last = performance.now();
  const end = last + ms;
  while (performance.now() < end) {
    await sleep(16);
    const now = performance.now();
    net.update(now - last, intent);
    last = now;
  }
}
const dropAll = (s: RunningServer): void => {
  for (const ws of s.gateway.wss.clients) ws.terminate();
};

describe('resume through the real gateway', () => {
  it('a dropped connection is resumed automatically: same character and entity id, state carried over, world visible again', async () => {
    const s = await server();
    const a = client(s, 'res_a');
    const b = client(s, 'res_b');
    await a.connect();
    await b.connect();
    await frames(a, 600);
    await frames(b, 600);
    const id = a.entityId;
    const posBefore = { ...a.selfPosition()! };
    expect(b.remotes().some((r) => r.entityId === id)).toBe(true);
    const resumed: boolean[] = [];
    a.events = { onReconnect: (i) => resumed.push(i.resumed) };

    // drop ONLY a's connection (server side terminate of its socket)
    const wsA = [...s.gateway.wss.clients].find((w) => w !== undefined)!;
    // identify a's socket: the first connected client belongs to a
    const sockets = [...s.gateway.wss.clients];
    sockets[0]!.terminate();
    void wsA;
    await until(() => a.reconnects === 1 && a.status === 'online');
    expect(a.entityId).toBe(id); // the same entity
    expect(resumed).toEqual([true]);
    await frames(a, 700);
    await frames(b, 100);
    expect(a.predictor!.ready).toBe(true);
    const pos = a.selfPosition()!;
    expect(Math.hypot(pos.i - posBefore.i, pos.j - posBefore.j)).toBeLessThan(0.5); // it stood still while held
    expect(s.world.clients.size).toBe(2); // no duplicate character
    expect(a.remotes().some((r) => r.entityId === b.entityId)).toBe(true); // AOI re-announced
    expect(b.remotes().some((r) => r.entityId === id)).toBe(true); // b never saw it leave
    a.close();
    b.close();
  }, 30_000);

  it('after the hold expired the client logs in again (fresh character, resumed=false)', async () => {
    const s = await server(300);
    const a = client(s, 'res_exp', { backoffMs: [700] });
    await a.connect();
    await frames(a, 300);
    const oldId = a.entityId;
    const flags: boolean[] = [];
    a.events = { onReconnect: (i) => flags.push(i.resumed) };
    dropAll(s);
    await until(() => a.reconnects === 1 && a.status === 'online');
    expect(flags).toEqual([false]);
    expect(s.world.clients.size).toBe(1); // the held entity was released, not duplicated
    expect(s.world.clients.has(oldId) && a.entityId === oldId).toBe(false);
    a.close();
  }, 30_000);

  it('logging out (close) removes the character at once, an abnormal drop holds it', async () => {
    const s = await server();
    const a = client(s, 'res_out');
    await a.connect();
    await frames(a, 200);
    a.close();
    await until(() => s.world.clients.size === 0);

    const b = client(s, 'res_drop', false);
    await b.connect();
    await frames(b, 200);
    dropAll(s);
    await sleep(300);
    expect(s.world.clients.size).toBe(1); // held, not removed
    expect(b.status).toBe('closed'); // reconnect: false -> the old behaviour on the client side
  }, 30_000);

  it('a kick is final: no reconnect after being replaced by a login elsewhere', async () => {
    const s = await server();
    const first = client(s, 'res_kick');
    await first.connect();
    await frames(first, 200);
    const second = client(s, 'res_kick');
    await second.connect();
    await until(() => first.status === 'closed');
    await sleep(600);
    expect(first.reconnects).toBe(0);
    expect(first.status).toBe('closed');
    expect(second.status).toBe('online');
    expect(s.world.clients.size).toBe(1);
    second.close();
  }, 30_000);

  it('raw resume hello: a wrong token is refused and leaves the held character alone; the right token works once', async () => {
    const s = await server();
    const a = client(s, 'res_raw', false);
    await a.connect();
    await frames(a, 200);
    const id = a.entityId;
    const token = s.world.resumeTokenOf(id)!;
    dropAll(s);
    await until(() => s.world.clients.size === 1 && a.status === 'closed');

    const hello = (resume: unknown): Promise<{ ack: Record<string, unknown> | null; closed: boolean }> =>
      new Promise((resolve) => {
        const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
        let ack: Record<string, unknown> | null = null;
        ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocolMin: 3, protocolMax: 3, resume })));
        ws.on('message', (d, bin) => {
          if (!bin) ack = JSON.parse(d.toString()) as Record<string, unknown>;
        });
        ws.on('close', () => resolve({ ack, closed: true }));
        if (resume && (resume as { token?: string }).token === token) setTimeout(() => ws.close(1000), 400);
      });
    const bad = await hello({ entityId: id, token: 'f'.repeat(32) });
    expect(bad.ack).toBeNull();
    expect(s.world.clients.has(id)).toBe(true);
    const good = await hello({ entityId: id, token });
    expect(good.ack).toMatchObject({ type: 'hello_ack', entityId: id, resumed: true });
    expect(good.ack!.resumeToken).not.toBe(token);
    const again = await hello({ entityId: id, token });
    expect(again.ack).toBeNull(); // single use
  }, 30_000);

  it('a fresh login of the same account while its character is held releases the old one (no duplicate)', async () => {
    const s = await server();
    const a = client(s, 'res_fresh', false);
    await a.connect();
    await frames(a, 200);
    const oldId = a.entityId;
    dropAll(s);
    await until(() => a.status === 'closed');
    expect(s.world.clients.has(oldId)).toBe(true); // held
    const b = client(s, 'res_fresh', false);
    await b.connect();
    expect(s.world.clients.size).toBe(1);
    expect(s.world.clients.has(oldId) && b.entityId === oldId).toBe(false);
    b.close();
  }, 30_000);
});
