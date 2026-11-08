/**
 * Reconnect / resume (docs/24 section 4): a dropped player's entity is held, a matching single-use token re-attaches a new
 * connection to the SAME entity, combat / progression registrations are never re-created, and the wire / anti-cheat state restarts.
 */
import { afterAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import {
  ErrorCode,
  PROTOCOL_VERSION,
  decode,
  encode,
  type BaselinePos,
  type Message,
  type SnapshotMsg,
} from '@vgtd/protocol';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js';
import { ANTICHEAT, TileGrid, budgetMs } from '@vgtd/sim';
import {
  AuthService,
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

  it('resume: same entity and id, rotated token, full resync (aoi_enter + full snapshot + vitals), numbering restarts, anti-cheat budget not banked', () => {
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
    const acAtDrop = ent(n, a.id)!.ac;
    const timeAtDrop = n.world.timeMs;
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
    // anti-cheat accounting carries over untouched; the sim's sliding rule was applied once, so no time budget was banked while away
    expect(e.ac.claimedMs).toBe(acAtDrop.claimedMs);
    expect(e.ac.score).toBe(acAtDrop.score);
    expect(budgetMs(e.ac, n.world.timeMs) - e.ac.claimedMs).toBeLessThanOrEqual(ANTICHEAT.SLIDE_LAG_MS + 1e-6);
    void timeAtDrop;

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
    // hold of 8.5 s: shorter than the sim's own 10 s sliding period, so only the slide applied AT the resume can prevent banking
    const n = node({ resumeHoldMs: 9000 });
    const away = join(n);
    const idle = join(n); // control: an identical player that stays attached and silent for the same time
    ticks(n, 20);
    const token = n.resumeTokenOf(away.id)!;
    n.suspendPlayer(away.id, away);
    ticks(n, 170);
    const fresh = new Fake();
    expect(n.resumePlayer(away.id, token, fresh)).not.toBeNull();
    const lead = (id: number): number => {
      const e = ent(n, id)!;
      return budgetMs(e.ac, n.world.timeMs) - e.ac.claimedMs; // how much movement time the player may still claim
    };
    // the silent attached player has banked ~8.7 s of budget; the resumed one is back at the sim's normal slide lag (1 s)
    expect(lead(idle.id)).toBeGreaterThan(8000);
    expect(lead(away.id)).toBeLessThanOrEqual(ANTICHEAT.SLIDE_LAG_MS + 1e-6);
    expect(lead(away.id)).toBeGreaterThan(0);
  });

  it('dropping and resuming never launders the anti-cheat record (score, claimed time, ratio windows, hot windows)', () => {
    const n = node({ resumeHoldMs: 20_000 });
    const a = join(n);
    ticks(n, 10);
    n.world = {
      ...n.world,
      entities: n.world.entities.map((e) =>
        e.id === a.id ? { ...e, ac: { ...e.ac, score: 7, hotWindows: 1, windowClaimedMs: 1234, claimedMs: 4321 } } : e,
      ),
    };
    let current: Fake = a;
    for (let round = 0; round < 3; round++) {
      const token = n.resumeTokenOf(a.id)!;
      expect(n.suspendPlayer(a.id, current)).toBe(true);
      ticks(n, 5);
      const next = new Fake();
      expect(n.resumePlayer(a.id, token, next)).not.toBeNull();
      current = next;
      const acNow = ent(n, a.id)!.ac;
      expect(acNow.hotWindows).toBe(1);
      expect(acNow.windowClaimedMs).toBe(1234);
      expect(acNow.claimedMs).toBe(4321);
      expect(acNow.score).toBeGreaterThan(6.5); // decays by time only (1/min), never reset
    }
  });

  it('a token that matches but whose session is no longer valid (revoked) cannot resume and releases the held player', () => {
    const n = node();
    const a = join(n);
    n.stampSession(a.id, { sessionId: 's1', version: 3 });
    const token = n.resumeTokenOf(a.id)!;
    n.suspendPlayer(a.id, a);
    const checked: unknown[] = [];
    // the wrong token never reaches the validity check (and never releases anything)
    expect(n.resumePlayer(a.id, 'nope', new Fake(), () => false)).toBeNull();
    expect(n.clients.has(a.id)).toBe(true);
    expect(
      n.resumePlayer(a.id, token, new Fake(), (acc, stamp) => {
        checked.push(acc, stamp);
        return false;
      }),
    ).toBeNull();
    expect(checked).toEqual([expect.any(String), { sessionId: 's1', version: 3 }]);
    expect(n.clients.has(a.id)).toBe(false); // released: a revoked session does not keep its character
    expect(n.combat!.maxHpOf(a.id)).toBeUndefined();
  });

  it('a live socket resuming on a revoked session is closed and its player removed', () => {
    const n = node();
    const a = join(n);
    const token = n.resumeTokenOf(a.id)!;
    expect(n.resumePlayer(a.id, token, new Fake(), () => false)).toBeNull();
    expect(a.closed?.code).toBe(ErrorCode.Unauthorized);
    expect(n.clients.has(a.id)).toBe(false);
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
/** Run the game loops of `nets` (idle input) until `cond()` holds, or fail after `ms`. */
async function drive(nets: NetClient[], cond: () => boolean, ms = 15_000): Promise<void> {
  let last = performance.now();
  const t0 = last;
  while (!cond()) {
    if (performance.now() - t0 > ms) throw new Error('timeout driving the clients');
    await sleep(16);
    const now = performance.now();
    for (const n of nets) n.update(now - last, { dir: 255, mag: 0, flags: 0 });
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
    const sees = (x: NetClient, y: NetClient): boolean => x.remotes().some((r) => r.entityId === y.entityId);
    // run both game loops until each is synchronised and sees the other (condition-driven: no fixed sleeps, CI machines are slower)
    await drive([a, b], () => !!a.predictor?.ready && !!b.predictor?.ready && sees(a, b) && sees(b, a));
    const id = a.entityId;
    const posBefore = { ...a.selfPosition()! };
    const resumed: boolean[] = [];
    a.events = { onReconnect: (i) => resumed.push(i.resumed) };

    // drop ONLY a's connection: a connected first, so its server-side socket is the first one
    [...s.gateway.wss.clients][0]!.terminate();
    await until(() => a.reconnects === 1 && a.status === 'online');
    expect(a.entityId).toBe(id); // the same entity
    expect(resumed).toEqual([true]);
    await drive([a, b], () => !!a.predictor?.ready && sees(a, b) && sees(b, a));
    const pos = a.selfPosition()!;
    expect(Math.hypot(pos.i - posBefore.i, pos.j - posBefore.j)).toBeLessThan(0.5); // it stood still while held
    expect(s.world.clients.size).toBe(2); // no duplicate character
    expect(sees(a, b)).toBe(true); // AOI re-announced
    expect(sees(b, a)).toBe(true); // b never saw it leave
    expect(b.remotes().find((r) => r.entityId === id)).toBeDefined();
    a.close();
    b.close();
  }, 40_000);

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
        ws.on('open', () =>
          ws.send(
            JSON.stringify({ type: 'hello', protocolMin: PROTOCOL_VERSION, protocolMax: PROTOCOL_VERSION, resume }),
          ),
        );
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

  it('a resume is refused once the session was revoked (the 10 s hold does not outlive a revocation)', async () => {
    const s = await server();
    const post = async (path: string, body: unknown): Promise<Record<string, unknown>> =>
      (await (
        await fetch(`http://127.0.0.1:${s.port}${path}`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body),
        })
      ).json()) as Record<string, unknown>;
    await post('/auth/register', { username: 'res_rev', password: TEST_ONLY_GOOD });
    const login = await post('/auth/login', { username: 'res_rev', password: TEST_ONLY_GOOD });
    const first = await new Promise<{ id: number; token: string }>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'hello',
            protocolMin: PROTOCOL_VERSION,
            protocolMax: PROTOCOL_VERSION,
            token: login.token,
          }),
        ),
      );
      ws.on('message', (d, bin) => {
        if (bin) return;
        const m = JSON.parse(d.toString()) as { entityId: number; resumeToken: string };
        resolve({ id: m.entityId, token: m.resumeToken });
        ws.terminate(); // a drop
      });
      ws.on('error', reject);
    });
    await until(() => s.world.clients.size === 1);
    s.auth.revokeSession(login.sessionId as string);
    const ack = await new Promise<unknown>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
      let got: unknown = null;
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'hello',
            protocolMin: PROTOCOL_VERSION,
            protocolMax: PROTOCOL_VERSION,
            resume: { entityId: first.id, token: first.token },
          }),
        ),
      );
      ws.on('message', (d, bin) => {
        if (!bin) got = JSON.parse(d.toString());
      });
      ws.on('close', () => resolve(got));
    });
    expect(ack).toBeNull(); // refused: no hello_ack
    await until(() => s.world.clients.size === 0); // and the held character was released
  }, 30_000);

  it('AuthService.isSessionCurrent: valid until revoked or the token_version changes', async () => {
    const auth = new AuthService({ scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 });
    const reg = await auth.register('iscur1', TEST_ONLY_GOOD, '9.9.9.9');
    const r = await auth.login('iscur1', TEST_ONLY_GOOD, '9.9.9.9');
    const who = auth.authenticate(r.token);
    expect(who.accountId).toBe(reg.accountId);
    expect(auth.isSessionCurrent(who.accountId, who.sessionId, who.version)).toBe(true);
    expect(auth.isSessionCurrent(who.accountId, who.sessionId, who.version + 1)).toBe(false); // token_version moved on
    expect(auth.isSessionCurrent('no-such-account', who.sessionId, who.version)).toBe(false);
    auth.revokeSession(who.sessionId);
    expect(auth.isSessionCurrent(who.accountId, who.sessionId, who.version)).toBe(false);
  });

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
