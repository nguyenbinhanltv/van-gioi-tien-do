/**
 * End to end (D94): a real NetClient against the real gateway + World Node while the server roots / slows the player. The client reads the
 * status block, predicts the locked movement and stays on the server's path instead of rubber-banding.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { NetClient, type NetDeps, type MoveIntent } from '@vgtd/client-core/src/net/index.js';
import { TileGrid } from '@vgtd/sim';
import { StatusBit } from '@vgtd/protocol';
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
const EAST: MoveIntent = { dir: 0, mag: 15, flags: 0 };
const IDLE: MoveIntent = { dir: 255, mag: 0, flags: 0 };

beforeAll(async () => {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: MAP, spawn: { i0: 50, j0: 50, side: 10 }, combat: {} },
    gateway: { corsOrigins: ['http://localhost:8456'] },
  });
});
afterAll(async () => {
  await srv.stop();
});

describe('status effects over the real wire (D94)', () => {
  it('a rooted player pressing a direction stays on the server path (small prediction error), a slowed one walks slower, and the HUD data is right', async () => {
    const a = makeClient('st_walker');
    const b = makeClient('st_watcher');
    await Promise.all([a.connect(), b.connect()]);
    await run(
      [
        [a, IDLE],
        [b, IDLE],
      ],
      500,
    );
    const server = srv.world;
    const entity = () => server.world.entities.find((e) => e.id === a.entityId)!;
    // root for 1.5 s while the player keeps walking east
    const p0 = a.selfPosition()!;
    server.combat!.status.rootPlayer(a.entityId, server.world.timeMs, 1500);
    let maxErr = 0;
    let sawRoot = false;
    await run(
      [
        [a, EAST],
        [b, IDLE],
      ],
      1200,
      () => {
        maxErr = Math.max(maxErr, a.predictor!.lastError);
        if (a.ownStatus().rootMs > 0) sawRoot = true;
      },
    );
    expect(sawRoot).toBe(true);
    const moved = Math.hypot(entity().i - p0.i, entity().j - p0.j);
    expect(moved).toBeLessThan(0.3); // the server held the player
    const shown = a.selfPosition()!;
    expect(Math.hypot(shown.i - entity().i, shown.j - entity().j)).toBeLessThan(0.6); // the client did not run away from it
    expect(maxErr).toBeLessThan(0.6);
    // another player sees the root through status_update
    expect(b.statusMaskOf(a.entityId) & StatusBit.Root).toBe(StatusBit.Root);
    // after the root ends the same input moves the player again, and the other player's flag clears
    await run(
      [
        [a, EAST],
        [b, IDLE],
      ],
      1500,
    );
    expect(a.ownStatus().rootMs).toBe(0);
    expect(b.statusMaskOf(a.entityId)).toBe(0);
    expect(Math.hypot(entity().i - p0.i, entity().j - p0.j)).toBeGreaterThan(1);
    // slow: half speed over a fixed time
    server.combat!.status.slowPlayer(a.entityId, server.world.timeMs, 3000, 0.5);
    await run([[a, IDLE]], 300);
    const s0 = { i: entity().i, j: entity().j };
    await run([[a, EAST]], 1000);
    const slowed = Math.hypot(entity().i - s0.i, entity().j - s0.j);
    await run([[a, EAST]], 2500); // past the slow
    const t0 = { i: entity().i, j: entity().j };
    await run([[a, EAST]], 1000);
    const free = Math.hypot(entity().i - t0.i, entity().j - t0.j);
    expect(slowed).toBeLessThan(free * 0.75);
    expect(a.ownStatus().slowMs).toBe(0);
    a.close();
    b.close();
  }, 30_000);
});
