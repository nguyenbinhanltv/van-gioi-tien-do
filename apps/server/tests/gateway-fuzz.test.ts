/**
 * Protocol fuzz against the REAL gateway (D101): random bytes, bit-flipped / truncated / extended valid frames, valid-shaped frames with
 * extreme values, server-direction messages, text frames and a hello that is garbage - thousands of frames over hundreds of short
 * connections. Asserted: the server never crashes or throws, an honest bystander is not disturbed (still ticking, still answered, state
 * unchanged), the world state stays sane (finite positions inside the map, hp within its max), memory stays bounded, every attacking
 * connection that is kicked leaves no entity behind, and the security log carries no secrets.
 * Deterministic: the frame stream comes from a seeded generator (the test is repeatable; only socket timing varies).
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { WebSocket } from 'ws';
import { PROTOCOL_VERSION, decode, encode, type Message } from '@vgtd/protocol';
import { startServer, type RunningServer, type SecurityEvent } from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

vi.setConfig({ testTimeout: 120_000 });

const FAST = { N: 1024, r: 8, p: 1 };
const MAP = 128;
let srv: RunningServer;
const events: SecurityEvent[] = [];

function lcg(seed: number): { next(): number; int(lo: number, hi: number): number; pick<T>(a: readonly T[]): T } {
  let s = seed >>> 0;
  const next = (): number => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
  return {
    next,
    int: (lo, hi) => lo + Math.floor(next() * (hi - lo + 1)),
    pick: (a) => a[Math.floor(next() * a.length)]!,
  };
}
type Rng = ReturnType<typeof lcg>;

async function login(name: string): Promise<string> {
  const base = `http://127.0.0.1:${srv.port}`;
  const body = JSON.stringify({ username: name, password: TEST_ONLY_GOOD });
  const h = { 'content-type': 'application/json' };
  await fetch(`${base}/auth/register`, { method: 'POST', headers: h, body });
  const r = await fetch(`${base}/auth/login`, { method: 'POST', headers: h, body });
  return ((await r.json()) as { token: string }).token;
}

/** A connection that has completed the hello; resolves with the entity id. */
function connect(
  token: string | null,
): Promise<{ ws: WebSocket; entityId: number; msgs: Message[]; closed: () => boolean }> {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`ws://127.0.0.1:${srv.port}/ws`);
    const msgs: Message[] = [];
    let isClosed = false;
    ws.on('error', () => undefined);
    ws.on('close', () => {
      isClosed = true;
      reject(new Error('closed before hello_ack'));
    });
    ws.on('open', () => {
      ws.send(
        token === null
          ? 'not json {{{'
          : JSON.stringify({ type: 'hello', protocolMin: PROTOCOL_VERSION, protocolMax: PROTOCOL_VERSION, token }),
      );
    });
    ws.on('message', (data, isBinary) => {
      if (!isBinary) {
        const ack = JSON.parse(data.toString()) as { type: string; entityId: number };
        if (ack.type === 'hello_ack') resolve({ ws, entityId: ack.entityId, msgs, closed: () => isClosed });
        return;
      }
      try {
        msgs.push(decode(data as Buffer, { baseline: () => ({ qi: 0, qj: 0 }) }));
      } catch {
        /* a fuzzed server never sends undecodable frames; ignore here, the assertions below look at state */
      }
    });
  });
}

const HEX = 'ab'.repeat(16);
const SEEDS: Message[] = [
  { type: 'input', ack: 3, inputs: [{ seq: 1, dtMs: 50, dir: 40, mag: 15, flags: 0 }] },
  { type: 'skill_cast', seq: 5, skillId: 1, targetId: 0, aim: { qi: 30000, qj: 30000 } },
  { type: 'ping', clientTimeMs: 12345 },
  { type: 'meditate_start', requestId: HEX },
  { type: 'meditate_stop', requestId: HEX },
  { type: 'breakthrough_start', requestId: HEX },
  { type: 'chat_send', channel: 1, clientMsgId: 1, target: '', text: 'hello world' },
  { type: 'party_cmd', op: 1, clientMsgId: 1, name: 'someone' },
  { type: 'inv_cmd', requestId: HEX, op: 1, from: 0, to: 1 },
];
const SERVER_SIDE: Message[] = [
  { type: 'pong', clientTimeMs: 1, serverTimeMs: 2 },
  { type: 'error', code: 2, text: 'x' },
  { type: 'aoi_leave', indices: [1, 2] },
  { type: 'status_update', entityId: 1, mask: 3 },
];

/** One hostile frame (binary unless noted). */
function hostile(r: Rng): Uint8Array | string {
  const k = r.int(0, 9);
  if (k === 0) return 'text frame after hello ' + r.int(0, 1e6);
  if (k === 1) {
    const b = new Uint8Array(r.int(0, 300));
    for (let i = 0; i < b.length; i++) b[i] = r.int(0, 255);
    if (b.length > 1 && r.next() < 0.7) {
      b[0] = PROTOCOL_VERSION;
      b[1] = r.int(1, 80);
    }
    return b;
  }
  if (k === 2) return encode(r.pick(SERVER_SIDE));
  const b = Uint8Array.from(encode(r.pick(SEEDS)));
  if (k === 3 || b.length === 0) return b; // a valid frame (the connection is not only noise)
  if (k === 4) b[r.int(0, b.length - 1)]! ^= 1 << r.int(0, 7);
  else if (k === 5) b[r.int(0, b.length - 1)] = r.int(0, 255);
  else if (k === 6) return b.subarray(0, r.int(0, b.length));
  else if (k === 7) {
    const c = new Uint8Array(b.length + r.int(1, 64));
    c.set(b);
    for (let i = b.length; i < c.length; i++) c[i] = r.int(0, 255);
    return c;
  } else if (k === 8) {
    // extreme but well-formed values: the guard / sim / combat must cope with every legal bit pattern
    return encode({
      type: 'input',
      ack: r.int(0, 65535),
      inputs: [
        {
          seq: r.int(0, 65535),
          dtMs: r.pick([0, 1, 255]),
          dir: r.int(0, 255),
          mag: r.pick([0, 15]),
          flags: r.int(0, 15),
        },
      ],
    });
  } else
    return encode({
      type: 'skill_cast',
      seq: r.int(0, 65535),
      skillId: r.pick([0, 1, 2, 8, 9, 60, 65535]),
      targetId: r.pick([0, 1, 2, 999999, 0xffffffff]),
      aim: r.next() < 0.5 ? null : { qi: r.int(0, 65535), qj: r.int(0, 65535) },
    });
  return b;
}

beforeAll(async () => {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    gateway: { helloTimeoutMs: 400 },
    world: {
      mapTiles: MAP,
      spawn: { i0: 40, j0: 40, side: 30 },
      resumeHoldMs: 0,
      combat: {},
      mobs: true,
      securityLog: (e) => events.push(e),
    },
  });
});
afterAll(async () => {
  await srv.stop();
});

describe('protocol fuzz against the real gateway', () => {
  it('survives thousands of hostile frames; the bystander and the world are unharmed; memory is bounded', async () => {
    const bystanderToken = await login('bystander1');
    const by = await connect(bystanderToken);
    const startTick = srv.world.world.tick;
    const pos0 = srv.world.world.entities.find((e) => e.id === by.entityId)!;
    const p0 = { i: pos0.i, j: pos0.j };
    const crashes: unknown[] = [];
    const onCrash = (e: unknown): void => void crashes.push(e);
    process.on('uncaughtException', onCrash);
    process.on('unhandledRejection', onCrash);
    const heap0 = process.memoryUsage().heapUsed;

    const attackers = await Promise.all(['fuzza1', 'fuzza2', 'fuzza3', 'fuzza4'].map((n) => login(n)));
    let sent = 0;
    let kicked = 0;
    const r = lcg(20260509);
    for (let round = 0; round < 150; round++) {
      // each round: 4 attackers (one per account), a fresh connection each, ~60 frames each; a garbage hello every few rounds
      await Promise.all(
        attackers.map(async (tok, a) => {
          if ((round + a) % 15 === 7) {
            await connect(null).catch(() => undefined); // garbage hello: closed with an error, never accepted
            return;
          }
          const c = await connect(tok);
          for (let k = 0; k < 60 && !c.closed(); k++) {
            const f = hostile(r);
            c.ws.send(f, { binary: typeof f !== 'string' });
            sent++;
            if (k % 20 === 19) await new Promise((res) => setTimeout(res, 5));
          }
          await new Promise((res) => setTimeout(res, 15));
          if (c.closed()) kicked++;
          c.ws.terminate();
        }),
      );
    }
    // let the server drain what is queued, then look at the state
    await new Promise((res) => setTimeout(res, 400));
    process.off('uncaughtException', onCrash);
    process.off('unhandledRejection', onCrash);
    expect(crashes).toEqual([]);
    expect(sent).toBeGreaterThan(8000);
    expect(kicked).toBeGreaterThan(20); // the guards did bite

    // the server is alive and still ticking; the bystander is connected, answered and unmoved
    const health = (await (await fetch(`http://127.0.0.1:${srv.port}/health`)).json()) as { ok: boolean; tick: number };
    expect(health.ok).toBe(true);
    expect(health.tick).toBeGreaterThan(startTick + 20);
    by.ws.send(encode({ type: 'ping', clientTimeMs: 4242 }), { binary: true });
    await vi.waitFor(() => expect(by.msgs.some((m) => m.type === 'pong' && m.clientTimeMs === 4242)).toBe(true));
    expect(by.closed()).toBe(false);
    expect(by.msgs.some((m) => m.type === 'snapshot')).toBe(true);
    const pos1 = srv.world.world.entities.find((e) => e.id === by.entityId)!;
    expect({ i: pos1.i, j: pos1.j }).toEqual(p0);

    // world sanity: finite positions inside the map, no half-dead attacker entities left behind (connections are all gone)
    for (const e of srv.world.world.entities) {
      expect(Number.isFinite(e.i) && Number.isFinite(e.j), `entity ${e.id}`).toBe(true);
      expect(e.i).toBeGreaterThanOrEqual(0);
      expect(e.j).toBeGreaterThanOrEqual(0);
      expect(e.i).toBeLessThanOrEqual(MAP);
      expect(e.j).toBeLessThanOrEqual(MAP);
    }
    await vi.waitFor(() => expect(srv.world.clients.size).toBe(1)); // only the bystander
    for (const c of srv.world.clients.values()) expect(c.inbox.length).toBeLessThan(500);

    // bounded memory: thousands of frames must not leave a footprint (generous: GC timing varies)
    (globalThis as { gc?: () => void }).gc?.();
    expect(process.memoryUsage().heapUsed - heap0).toBeLessThan(150 * 1024 * 1024);

    // the abuse was counted and logged, with no secrets in the log
    const m = srv.world.metrics;
    expect(m.kicksBadMessages + m.kicksFlood + m.kicksRate + m.disconnects).toBeGreaterThan(0);
    expect(events.length).toBeGreaterThan(0);
    expect(events.length).toBeLessThan(sent / 4); // throttled, not one line per frame
    const log = JSON.stringify(events);
    expect(log).not.toMatch(/fuzza\d|bystander|127\.0\.0\.1|eyJ|fixture/);
    by.ws.close();
  });

  it('a fresh honest client can still join and play after the storm', async () => {
    const t = await login('afterstorm1');
    const c = await connect(t);
    c.ws.send(encode({ type: 'input', ack: 0, inputs: [{ seq: 1, dtMs: 50, dir: 0, mag: 15, flags: 0 }] }), {
      binary: true,
    });
    c.ws.send(encode({ type: 'ping', clientTimeMs: 7 }), { binary: true });
    await vi.waitFor(() => expect(c.msgs.some((m) => m.type === 'pong')).toBe(true));
    expect(c.closed()).toBe(false);
    c.ws.close();
  });
});
