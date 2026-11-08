import { describe, expect, it } from 'vitest';
import { TileGrid } from '@vgtd/sim';
import { ErrorCode, encode, type Message, type SelfState } from '@vgtd/protocol';
import { NetClient, type NetDeps, type NetEvents, type SocketLike } from '@vgtd/client-core';

type Hello = { type: string; token?: string; resume?: { entityId: number; token: string } };

/** Scripted server: `answer(hello, sock)` decides what each connection attempt gets. */
class Fake implements SocketLike {
  static all: Fake[] = [];
  static answer: (hello: Hello, sock: Fake) => void = () => undefined;
  binaryType = '';
  readyState = 1;
  sent: string[] = [];
  hellos: Hello[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    Fake.all.push(this);
    queueMicrotask(() => this.onopen?.({}));
  }
  send(d: string | Uint8Array): void {
    if (typeof d !== 'string') return;
    const hello = JSON.parse(d) as Hello;
    this.hellos.push(hello);
    queueMicrotask(() => Fake.answer(hello, this));
  }
  close(): void {
    this.readyState = 3;
  }
  ack(entityId: number, token: string, resumed = false, holdMs = 10_000): void {
    this.onmessage?.({
      data: JSON.stringify({
        type: 'hello_ack',
        entityId,
        mapTiles: 64,
        resumed,
        resumeToken: token,
        resumeHoldMs: holdMs,
      }),
    });
  }
  drop(code = 1006, reason = ''): void {
    this.readyState = 3;
    this.onclose?.({ code, reason });
  }
  error(code: ErrorCode, text: string): void {
    const b = encode({ type: 'error', code, text });
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }
  frame(m: Message): void {
    const b = encode(m);
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }
  snapshot(self: SelfState): void {
    const b = encode({ type: 'snapshot', seq: 1, baselineSeq: null, tick: 1, self, entities: [] });
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }
}

const SELF: SelfState = {
  lastSeq: 0,
  i: 10,
  j: 10,
  layer: 0,
  flying: false,
  qinggong: false,
  facing: 0,
  dashLeftMs: 0,
  dashCdMs: 0,
  invulnMs: 0,
  vitals: null,
};

interface Rig {
  net: NetClient;
  sleeps: number[];
  fetches: string[];
  clock: { t: number };
  events: string[];
}

function rig(opts: { reconnect?: false | { maxMs?: number; backoffMs?: number[]; staleMs?: number } } = {}): Rig {
  Fake.all = [];
  Fake.answer = () => undefined;
  const clock = { t: 1000 };
  const sleeps: number[] = [];
  const fetches: string[] = [];
  const events: string[] = [];
  const deps: NetDeps = {
    fetch: async (url) => {
      fetches.push(url.replace(/^.*\/auth\//, ''));
      return { status: url.endsWith('/auth/register') ? 201 : 200, json: async () => ({ token: 'tok' }) };
    },
    WebSocket: Fake as unknown as NetDeps['WebSocket'],
    now: () => clock.t,
    // virtual time: a "sleep" completes at once and advances the clock
    setTimeout: (fn, ms) => {
      sleeps.push(ms);
      clock.t += ms;
      queueMicrotask(fn);
      return 0;
    },
  };
  const ev: NetEvents = {
    onConnectionLost: () => events.push('lost'),
    onReconnect: (i) => events.push(`reconnect resumed=${i.resumed}`),
  };
  const net = new NetClient({
    baseUrl: 'http://x',
    username: 'u',
    password: 'p',
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
    events: ev,
    reconnect: opts.reconnect,
  });
  return { net, sleeps, fetches, clock, events };
}

const settle = async (ms = 20): Promise<void> => {
  for (let k = 0; k < ms; k++) await new Promise((r) => setTimeout(r, 0));
};

describe('NetClient reconnect / resume', () => {
  it('sends the resume token FIRST (no access token), and a resumed ack keeps the entity and rotates the token', async () => {
    const r = rig();
    Fake.answer = (h, s) => {
      if (h.resume) s.ack(7, 'tok-2', true);
      else s.ack(7, 'tok-1');
    };
    await r.net.connect();
    expect(r.net.entityId).toBe(7);
    Fake.all[0]!.snapshot(SELF);
    expect(r.net.predictor!.ready).toBe(true);
    Fake.all[0]!.drop();
    expect(r.net.status).toBe('reconnecting');
    await settle();
    const second = Fake.all[1]!;
    expect(second.hellos[0]).toMatchObject({ type: 'hello', resume: { entityId: 7, token: 'tok-1' } });
    expect(second.hellos[0]!.token).toBeUndefined();
    expect(r.net.status).toBe('online');
    expect(r.net.entityId).toBe(7);
    expect(r.net.reconnects).toBe(1);
    expect(r.events).toEqual(['lost', 'reconnect resumed=true']);
    // the client state belonged to the old connection: a new predictor adopts the server position again
    expect(r.net.predictor!.ready).toBe(false);
    expect(r.fetches).toEqual(['register', 'login']); // only the first connect used HTTP
    // the NEXT drop uses the rotated token
    second.drop();
    await settle();
    expect(Fake.all[2]!.hellos[0]!.resume!.token).toBe('tok-2');
  });

  it('a rejected resume falls back to a full login (new entity), and says resumed=false', async () => {
    const r = rig();
    Fake.answer = (h, s) => {
      if (h.resume) {
        s.error(ErrorCode.Unauthorized, 'resume rejected');
        s.drop(1008, 'resume rejected');
      } else s.ack(Fake.all.length === 1 ? 7 : 9, `tok-${Fake.all.length}`);
    };
    await r.net.connect();
    Fake.all[0]!.drop();
    await settle();
    expect(r.net.status).toBe('online');
    expect(r.net.entityId).toBe(9);
    expect(r.events).toEqual(['lost', 'reconnect resumed=false']);
    expect(r.fetches).toEqual(['register', 'login', 'register', 'login']);
    expect(Fake.all.map((s) => (s.hellos[0]!.resume ? 'resume' : 'login'))).toEqual(['login', 'resume', 'login']);
  });

  it('resumes only while the server still holds the session; later attempts log in again (backoff 250, 500, 1000...)', async () => {
    const r = rig({ reconnect: { backoffMs: [250, 500, 1000], maxMs: 60_000 } });
    // hold of 1000 ms; every connection attempt except the full login fails at the network level
    Fake.answer = (h, s) => {
      if (!h.resume && !h.token) return;
      if (h.resume) return s.drop(1006, 'refused');
      if (Fake.all.length === 1) s.ack(7, 'tok-1', false, 1000);
      else s.ack(8, 'tok-x');
    };
    await r.net.connect();
    Fake.all[0]!.drop();
    await settle(40);
    expect(r.sleeps.slice(0, 3)).toEqual([250, 500, 1000]);
    // attempts at +250 and +750 are inside the 1000 ms hold -> resume; the one at +1750 is past it -> login
    expect(Fake.all.slice(1).map((s) => (s.hellos[0]!.resume ? 'resume' : 'login'))).toEqual([
      'resume',
      'resume',
      'login',
    ]);
    expect(r.net.status).toBe('online');
    expect(r.net.entityId).toBe(8);
  });

  it('does not reconnect after the server kicked us (anti-cheat / logged in elsewhere)', async () => {
    const r = rig();
    Fake.answer = (_h, s) => s.ack(7, 'tok-1');
    await r.net.connect();
    Fake.all[0]!.error(ErrorCode.Kicked, 'logged in elsewhere');
    Fake.all[0]!.drop(1008, 'replaced');
    await settle();
    expect(r.net.status).toBe('closed');
    expect(r.net.reconnects).toBe(0);
    expect(Fake.all).toHaveLength(1);
    expect(r.net.lastError).toContain('logged in elsewhere');
  });

  it('detects a half-open connection (no server frames for staleMs) and reconnects', async () => {
    const r = rig({ reconnect: { staleMs: 3000 } });
    Fake.answer = (h, s) => s.ack(7, h.resume ? 'tok-2' : 'tok-1', !!h.resume);
    await r.net.connect();
    Fake.all[0]!.snapshot(SELF);
    r.net.update(16);
    expect(r.net.status).toBe('online');
    for (let k = 0; k < 35; k++) {
      r.clock.t += 100; // the link went silent (no close event, nothing arrives) while the frame loop keeps running
      r.net.update(16);
    }
    expect(r.net.status).toBe('reconnecting');
    expect(r.net.lastError).toContain('no server frames');
    await settle();
    expect(r.net.status).toBe('online');
    expect(r.events).toEqual(['lost', 'reconnect resumed=true']);
  });

  it('a stall of the OWN update loop is not mistaken for a dead link (no reconnect)', async () => {
    const r = rig({ reconnect: { staleMs: 3000 } });
    Fake.answer = (h, s) => s.ack(7, h.resume ? 'tok-2' : 'tok-1', !!h.resume);
    await r.net.connect();
    Fake.all[0]!.snapshot(SELF);
    r.net.update(16);
    r.clock.t += 3500; // the whole tab / host was starved: nothing ran, frames sat unread
    r.net.update(16);
    expect(r.net.status).toBe('online');
    expect(r.events).toEqual([]);
    // ...but real silence afterwards is still detected
    for (let k = 0; k < 35; k++) {
      r.clock.t += 100;
      r.net.update(16);
    }
    expect(r.net.status).toBe('reconnecting');
  });

  it('frames that arrive in the same turn as hello_ack are kept (the server sends aoi_enter right behind the ack)', async () => {
    const r = rig();
    const enter: Message = {
      type: 'aoi_enter',
      entities: [
        { index: 3, entityId: 99, kind: 0, defId: 0, qi: 320, qj: 320, anim: 0, dir: 0, hpPct: 100, maxHp: 100 },
      ],
    };
    // ack and aoi_enter delivered back to back, as `ws` does when both frames sit in one TCP chunk: no promise continuation runs between them
    Fake.answer = (h, s) => {
      s.ack(7, h.resume ? 'tok-2' : 'tok-1', !!h.resume);
      s.frame(enter);
    };
    await r.net.connect();
    expect(r.net.remotes().map((x) => x.entityId)).toEqual([99]);
    // the same on a resumed reconnect
    Fake.all[0]!.drop();
    await settle();
    expect(r.net.status).toBe('online');
    expect(r.net.reconnects).toBe(1);
    expect(r.net.remotes().map((x) => x.entityId)).toEqual([99]);
  });

  it('gives up after maxMs and ends in "closed" with a reason', async () => {
    const r = rig({ reconnect: { maxMs: 5000, backoffMs: [1000] } });
    Fake.answer = (h, s) => {
      if (h.token) s.ack(7, 'tok-1');
      else s.drop(1006, 'refused');
    };
    await r.net.connect();
    // from now on the HTTP login fails too
    (r.net as unknown as { o: { deps: NetDeps } }).o.deps.fetch = async () => ({ status: 503, json: async () => ({}) });
    Fake.all[0]!.drop();
    await settle(60);
    expect(r.net.status).toBe('closed');
    expect(r.net.lastError).toContain('gave up reconnecting');
    expect(r.sleeps.length).toBeLessThanOrEqual(6);
  });

  it('reconnect: false keeps the old behaviour (the session just ends) and close() never reconnects', async () => {
    const off = rig({ reconnect: false });
    Fake.answer = (_h, s) => s.ack(7, 'tok-1');
    await off.net.connect();
    Fake.all[0]!.drop();
    expect(off.net.status).toBe('closed');
    await settle();
    expect(Fake.all).toHaveLength(1);

    const on = rig();
    Fake.answer = (_h, s) => s.ack(7, 'tok-1');
    await on.net.connect();
    on.net.close();
    Fake.all[0]!.drop();
    await settle();
    expect(on.net.status).toBe('closed');
    expect(Fake.all).toHaveLength(1);
    expect(on.events).toEqual([]);
  });

  it('sendSkillCast refuses while reconnecting (socket not open) instead of queueing', async () => {
    const r = rig();
    Fake.answer = (_h, s) => s.ack(7, 'tok-1');
    await r.net.connect();
    Fake.all[0]!.drop();
    expect(r.net.status).toBe('reconnecting');
    expect(r.net.sendSkillCast({ seq: 1, skillId: 0, targetId: 0, aim: null })).toBe(false);
  });
});
