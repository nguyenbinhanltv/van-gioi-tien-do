import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { compileSkills } from '@vgtd/sim';
import { startServer, type RunningServer } from '../src/index.js';
import { Bot } from '../src/loadtest/bot.js';
import { connectFleet } from '../src/loadtest/runner.js';
import { summarize, type ServerSample } from '../src/loadtest/runner.js';

const FAST = { N: 1024, r: 8, p: 1 };
let srv: RunningServer;
const url = (p: string): string => `http://127.0.0.1:${srv.port}${p}`;
const post = async (p: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
  const r = await fetch(url(p), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  return { status: r.status, json: (await r.json()) as Record<string, unknown> };
};
const until = async (cond: () => boolean, ms = 5000): Promise<void> => {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error('timeout waiting for condition');
    await new Promise((r) => setTimeout(r, 20));
  }
};
const bot = (name: string): Bot => new Bot({ host: '127.0.0.1', port: srv.port, name });

beforeAll(async () => {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0 },
    gateway: { helloTimeoutMs: 300 },
    world: { mapTiles: 128, spawn: { i0: 40, j0: 40, side: 30 } },
  });
});
afterAll(async () => {
  await srv.stop();
});

describe('Gateway HTTP auth', () => {
  it('register, duplicate, weak password, bad login, health, 404', async () => {
    expect((await post('/auth/register', { username: 'httpuser', password: 'correct horse battery' })).status).toBe(
      201,
    );
    expect((await post('/auth/register', { username: 'httpuser', password: 'correct horse battery' })).status).toBe(
      409,
    );
    expect((await post('/auth/register', { username: 'weakling', password: 'short' })).status).toBe(400);
    expect((await post('/auth/login', { username: 'httpuser', password: 'nope nope nope' })).status).toBe(401);
    const ok = await post('/auth/login', { username: 'httpuser', password: 'correct horse battery' });
    expect(ok.status).toBe(200);
    expect(String(ok.json.token).split('.')).toHaveLength(3);
    const health = await fetch(url('/health'));
    expect(((await health.json()) as { ok: boolean }).ok).toBe(true);
    expect((await fetch(url('/nope'))).status).toBe(404);
    const bad = await fetch(url('/auth/login'), { method: 'POST', body: '{not json' });
    expect(bad.status).toBe(400);
  });

  it('account lockout surfaces as 429 with Retry-After', async () => {
    await post('/auth/register', { username: 'lockme', password: 'correct horse battery' });
    for (let k = 0; k < 5; k++) await post('/auth/login', { username: 'lockme', password: 'wrong wrong wrong' });
    const r = await fetch(url('/auth/login'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ username: 'lockme', password: 'correct horse battery' }),
    });
    expect(r.status).toBe(429);
    expect(Number(r.headers.get('retry-after'))).toBeGreaterThan(0);
  });
});

describe('Gateway WebSocket', () => {
  it('hello with a valid token -> hello_ack, then snapshots flow and inputs move the player', async () => {
    const b = bot('wsplayer1');
    await b.connect();
    expect(b.entityId).toBeGreaterThan(0);
    await until(() => b.report.snapshots >= 3);
    const e0 = srv.world.world.entities.find((e) => e.id === b.entityId)!;
    b.startInputs();
    await until(() => (srv.world.statsOf(b.entityId)?.packetsIn ?? 0) >= 20);
    b.stop();
    expect(srv.world.statsOf(b.entityId)!.snapshots).toBeGreaterThan(5);
    expect(e0).toBeDefined();
  });

  it('bad token, missing hello and bad protocol version are refused', async () => {
    await expect(bot('x1').openSocket('garbage')).rejects.toThrow(/closed before hello_ack/);
    await expect(bot('x2').openSocket('a.b.c')).rejects.toThrow();
    const login = await post('/auth/login', { username: 'httpuser', password: 'correct horse battery' });
    await expect(bot('x3').openSocket(String(login.json.token), { protocolMin: 7, protocolMax: 9 })).rejects.toThrow(
      /closed before hello_ack/,
    );
  });

  it('a connection that never says hello is closed after the timeout', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    expect(code).toBe(1008);
  });

  it('binary before hello and oversize frames are rejected', async () => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((r) => ws.on('open', r));
    ws.send(new Uint8Array([1, 8, 0, 0, 0, 1]), { binary: true });
    const code = await new Promise<number>((resolve) => ws.on('close', (c) => resolve(c)));
    expect(code).toBe(1008);
    const ws2 = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    await new Promise((r) => ws2.on('open', r));
    ws2.send(new Uint8Array(5000), { binary: true });
    const code2 = await new Promise<number>((resolve) => ws2.on('close', (c) => resolve(c)));
    expect(code2).toBe(1009);
  });

  it('logging in again replaces the older connection', async () => {
    const first = bot('dupe1');
    await first.connect();
    const firstId = first.entityId;
    const second = bot('dupe1');
    await second.connect();
    await until(() => first.socket.readyState === WebSocket.CLOSED);
    expect(srv.world.clients.has(firstId)).toBe(false);
    expect(srv.world.clients.has(second.entityId)).toBe(true);
    second.stop();
  });

  it('disconnecting removes the player from the world', async () => {
    const b = bot('leaver1');
    await b.connect();
    const id = b.entityId;
    expect(srv.world.clients.has(id)).toBe(true);
    b.stop();
    await until(() => !srv.world.clients.has(id));
    expect(srv.world.world.entities.some((e) => e.id === id)).toBe(false);
  });
});

describe('load-test tooling (small fleet)', () => {
  it('connects bots, measures the window and produces an exit-criteria report', async () => {
    const skills = compileSkills();
    const fleet = await connectFleet({
      host: '127.0.0.1',
      port: srv.port,
      bots: 6,
      speedhackers: 1,
      teleporters: 1,
      inputHz: 20,
      area: { i0: 40, j0: 40, side: 30 },
      skillCount: skills.length,
      speedFactor: 3,
      prefix: 'smoke',
      seed: 3,
    });
    await new Promise((r) => setTimeout(r, 500));
    srv.world.tickMs.length = 0;
    const base = new Map([...srv.world.clients.values()].map((c) => [c.id, { ...c.stats }]));
    fleet.startMeasuring();
    await new Promise((r) => setTimeout(r, 4500));
    const clients = [...srv.world.clients.values()].map((c) => {
      const b = base.get(c.id);
      const s = c.stats;
      return {
        entityId: c.id,
        bytesOut: s.bytesOut - (b?.bytesOut ?? 0),
        wireBytesOut: s.wireBytesOut - (b?.wireBytesOut ?? 0),
        framesOut: s.framesOut,
        bytesIn: s.bytesIn - (b?.bytesIn ?? 0),
        packetsIn: s.packetsIn,
        snapshots: s.snapshots - (b?.snapshots ?? 0),
        snapshotsSkipped: 0,
        aoiEnter: s.aoiEnter - (b?.aoiEnter ?? 0),
        aoiLeave: s.aoiLeave - (b?.aoiLeave ?? 0),
        visibleSum: s.visibleSum - (b?.visibleSum ?? 0),
        visibleSamples: s.visibleSamples - (b?.visibleSamples ?? 0),
        visibleMax: s.visibleMax,
      };
    });
    const sample: ServerSample = {
      tickMs: [...srv.world.tickMs],
      tickIntervalMs: [...srv.world.tickIntervalMs],
      clients,
      durationS: 4.5,
      phases: { ...srv.world.phases },
      metrics: { ...srv.world.metrics },
      cpuUserMs: 0,
      cpuSystemMs: 0,
      rssMb: 0,
    };
    const reports = fleet.stop();
    const r = summarize(
      { bots: 6, speedhackers: 1, teleporters: 1, durationS: 4, areaTiles: 30, inputHz: 20 },
      sample,
      reports,
    );
    expect(r.honest).toMatchObject({ connected: 6, kicked: 0, closedUnexpectedly: 0, decodeErrors: 0 });
    expect(r.tickMs.p99).toBeLessThan(40);
    expect(r.downKBpsWire.max).toBeLessThan(8);
    expect(r.aoi.visibleMax).toBeGreaterThan(0);
    expect(r.cheaters.map((c) => c.kind).sort()).toEqual(['speedhack', 'teleport']);
    for (const c of r.cheaters) expect(c.kicked).toBe(c.count);
    expect(r.criteria.every((c) => c.pass)).toBe(true);
  });
});
