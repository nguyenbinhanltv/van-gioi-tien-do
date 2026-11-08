/**
 * End to end: two real client-core NetClients (the code the Cocos client runs) against the real gateway + World Node.
 * Checks prediction/reconciliation against the authoritative state and interpolation of the other player.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NetClient, type NetDeps, type MoveIntent } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only (the package index also pulls DOM input code)
import { TileGrid } from '@vgtd/sim';
import { startServer, type RunningServer } from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const FAST = { N: 1024, r: 8, p: 1 };
const MAP = 128;
let srv: RunningServer;

const deps: NetDeps = {
  fetch: (url, init) => fetch(url, init),
  WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
  now: () => performance.now(),
};
const makeClient = (name: string): NetClient =>
  new NetClient({
    baseUrl: `http://127.0.0.1:${srv.port}`,
    username: name,
    password: TEST_ONLY_GOOD,
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
  });
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** drive the per-frame update at ~60 fps like the game loop does */
async function run(clients: [NetClient, MoveIntent][], ms: number, each?: () => void): Promise<void> {
  let last = performance.now();
  const end = last + ms;
  while (performance.now() < end) {
    await sleep(16);
    const now = performance.now();
    for (const [c, intent] of clients) c.update(now - last, intent);
    last = now;
    each?.();
  }
}

beforeAll(async () => {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: MAP, spawn: { i0: 50, j0: 50, side: 10 } },
    gateway: { corsOrigins: ['http://localhost:7456'] },
  });
});
afterAll(async () => {
  await srv.stop();
});

describe('NetClient against the real server', () => {
  it('registers, logs in, learns the map size and receives its first self state', async () => {
    const a = makeClient('netc_a');
    await a.connect();
    expect(a.status).toBe('online');
    expect(a.mapTiles).toBe(MAP);
    expect(a.entityId).toBeGreaterThan(0);
    await run([[a, { dir: 255, mag: 0, flags: 0 }]], 400);
    expect(a.predictor!.ready).toBe(true);
    const p = a.selfPosition()!;
    const srvEntity = srv.world.world.entities.find((e) => e.id === a.entityId)!;
    expect(Math.hypot(p.i - srvEntity.i, p.j - srvEntity.j)).toBeLessThan(0.01);
    a.close();
    // a second login of the same name re-uses the account (register answers 409, login still works)
    const again = makeClient('netc_a');
    await again.connect();
    expect(again.status).toBe('online');
    again.close();
  });

  it('predicts ahead of the server, stays within the reconciliation tolerance, and a second client sees it interpolated', async () => {
    const a = makeClient('netc_walker');
    const b = makeClient('netc_watcher');
    await Promise.all([a.connect(), b.connect()]);
    await run(
      [
        [a, { dir: 255, mag: 0, flags: 0 }],
        [b, { dir: 255, mag: 0, flags: 0 }],
      ],
      500,
    );
    const start = { ...a.selfPosition()! };
    let maxErr = 0;
    let maxAhead = 0;
    await run(
      [
        [a, { dir: 0, mag: 15, flags: 0 }], // east
        [b, { dir: 255, mag: 0, flags: 0 }],
      ],
      2500,
      () => {
        maxErr = Math.max(maxErr, a.predictor!.lastError);
        const e = srv.world.world.entities.find((x) => x.id === a.entityId)!;
        const me = a.selfPosition()!;
        maxAhead = Math.max(maxAhead, me.i - e.i);
      },
    );
    const end = a.selfPosition()!;
    expect(end.i - start.i).toBeGreaterThan(8); // about 2.5 s at 4.5 tiles/s
    // honest client and server run the same stepMove: drift is only float32 on the wire
    expect(maxErr).toBeLessThan(0.05);
    // prediction really runs ahead of the authoritative state (that is the point of it)
    expect(maxAhead).toBeGreaterThan(0.1);

    // B sees A (kind 0) near where A really is, lagging by roughly the interpolation delay
    const seen = b.remotes().find((r) => r.entityId === a.entityId);
    expect(seen).toBeDefined();
    const e = srv.world.world.entities.find((x) => x.id === a.entityId)!;
    const lag = e.i - seen!.i;
    expect(lag).toBeGreaterThan(0); // behind the server by the interpolation delay
    expect(lag).toBeLessThan(4.5 * 0.6); // but not by more than ~0.6 s of walking
    expect(Math.abs(e.j - seen!.j)).toBeLessThan(0.1);
    expect(seen!.speed).toBeGreaterThan(2); // moving while we watch
    expect(seen!.kind).toBe(0);
    a.close();
    b.close();
  });

  it('a speedhacking intent is impossible by construction: the client emits at most one 50 ms input per tick', async () => {
    const a = makeClient('netc_fast');
    await a.connect();
    await run([[a, { dir: 255, mag: 0, flags: 0 }]], 300);
    const s0 = { ...a.selfPosition()! };
    // one 400 ms "stall" frame must not become 8 inputs of claimed time
    a.update(400, { dir: 0, mag: 15, flags: 0 });
    expect(a.predictor!.lastSeq).toBeLessThanOrEqual(3 + 20); // bounded burst (capped at 3 ticks per update)
    const moved = a.selfPosition()!.i - s0.i;
    expect(moved).toBeLessThan(4.5 * 0.2); // 3 ticks = 150 ms at most
    a.close();
  });

  it('answers CORS preflight and tags responses only for allowed origins', async () => {
    const pre = await fetch(`http://127.0.0.1:${srv.port}/auth/login`, {
      method: 'OPTIONS',
      headers: { origin: 'http://localhost:7456', 'access-control-request-method': 'POST' },
    });
    expect(pre.status).toBe(204);
    expect(pre.headers.get('access-control-allow-origin')).toBe('http://localhost:7456');
    expect(pre.headers.get('access-control-allow-headers')).toContain('content-type');
    const bad = await fetch(`http://127.0.0.1:${srv.port}/health`, { headers: { origin: 'http://evil.example' } });
    expect(bad.headers.get('access-control-allow-origin')).toBeNull();
    const ok = await fetch(`http://127.0.0.1:${srv.port}/health`, { headers: { origin: 'http://localhost:7456' } });
    expect(ok.headers.get('access-control-allow-origin')).toBe('http://localhost:7456');
  });
});
