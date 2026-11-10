import { describe, expect, it } from 'vitest';
import { TileGrid } from '@vgtd/sim';
import { decode, encode, type Message, type SelfState } from '@vgtd/protocol';
import { NetClient, type NetDeps, type NetEvents, type SocketLike } from '@vgtd/client-core';

class FakeSocket implements SocketLike {
  static last: FakeSocket;
  binaryType = '';
  readyState = 1;
  sent: (string | Uint8Array)[] = [];
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  constructor(readonly url: string) {
    FakeSocket.last = this;
    queueMicrotask(() => this.onopen?.({}));
  }
  send(d: string | Uint8Array): void {
    this.sent.push(d);
    if (typeof d === 'string') {
      // the hello: answer with hello_ack
      queueMicrotask(() =>
        this.onmessage?.({
          data: JSON.stringify({
            type: 'hello_ack',
            entityId: 1,
            serverTimeMs: 0,
            tickHz: 20,
            protocol: 4,
            mapTiles: 64,
          }),
        }),
      );
    }
  }
  close(): void {
    this.readyState = 3;
  }
  /** server -> client binary frame */
  push(m: Message): void {
    const b = encode(m);
    this.onmessage?.({ data: b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) });
  }
}

const deps: NetDeps = {
  fetch: async (url) => ({
    status: url.endsWith('/auth/register') ? 201 : 200,
    json: async () => ({ token: 'tok' }),
  }),
  WebSocket: FakeSocket as unknown as NetDeps['WebSocket'],
  now: () => 1000,
};

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
  status: null,
};

async function client(events: NetEvents): Promise<{ net: NetClient; sock: FakeSocket }> {
  const net = new NetClient({
    baseUrl: 'http://x',
    username: 'u',
    password: 'p',
    deps,
    makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
    events,
  });
  await net.connect();
  return { net, sock: FakeSocket.last };
}

const enterMsg = (index: number, entityId: number, hp = 100): Message => ({
  type: 'aoi_enter',
  entities: [{ index, entityId, kind: 1, defId: 5, qi: 20 * 32, qj: 20 * 32, anim: 0, dir: 0, hpPct: hp, maxHp: 500 }],
});

describe('NetClient event hooks', () => {
  it('delivers skill_result, aoi_enter, aoi_leave and snapshot to the callbacks, in wire order', async () => {
    const log: string[] = [];
    const { sock } = await client({
      onAoiEnter: (e) => log.push(`enter ${e.map((x) => `${x.index}=${x.entityId}`).join(',')}`),
      onAoiLeave: (i) => log.push(`leave ${i.join(',')}`),
      onSnapshot: (tick, ents, self) =>
        log.push(`snap tick=${tick} n=${ents.length} hp=${ents[0]?.hpPct ?? '-'} self=${self ? 'y' : 'n'}`),
      onSkillResult: (m) => log.push(`skill ${m.skillId} reason=${m.reason} hits=${m.hits.length}`),
    });
    sock.push(enterMsg(3, 77));
    sock.push({
      type: 'snapshot',
      seq: 1,
      baselineSeq: null,
      tick: 42,
      self: SELF,
      entities: [{ index: 3, qi: 21 * 32, qj: 20 * 32, anim: 1, dir: 2, hpPct: 60 }],
    });
    sock.push({
      type: 'skill_result',
      seq: 9,
      reason: 0,
      skillId: 4,
      readyAtMs: 5000,
      casterIndex: 0,
      hits: [{ targetIndex: 3, damage: 25, flags: 0 }],
    });
    sock.push({ type: 'aoi_leave', indices: [3] });
    expect(log).toEqual(['enter 3=77', 'snap tick=42 n=1 hp=60 self=y', 'skill 4 reason=0 hits=1', 'leave 3']);
  });

  it('delivers boss_phase to onBossPhase (D91) and ignores it when no hook is set', async () => {
    const seen: string[] = [];
    const { sock } = await client({
      onBossPhase: (m) => seen.push(`${m.mobEntityId}:${m.phase}:${m.transformMs}`),
    });
    sock.push({ type: 'boss_phase', mobEntityId: 1_000_003, phase: 1, transformMs: 1800 });
    sock.push({ type: 'boss_phase', mobEntityId: 1_000_003, phase: 2, transformMs: 1800 });
    expect(seen).toEqual(['1000003:1:1800', '1000003:2:1800']);
    const quiet = await client({});
    expect(() => quiet.sock.push({ type: 'boss_phase', mobEntityId: 1, phase: 1, transformMs: 0 })).not.toThrow();
  });

  it('delivers major_event and tribulation_strike to net.majorEvents (a separate object from net.events)', async () => {
    const seen: string[] = [];
    const { net, sock } = await client({});
    net.majorEvents = {
      onMajorEvent: (m) => seen.push(`event ${m.phase}/${m.result}`),
      onTribulationStrike: (m) => seen.push(`strike ${m.wave}/${m.waves} ${m.damage}`),
    };
    net.events = {}; // the scene replacing `events` must not drop them
    sock.push({
      type: 'major_event',
      phase: 3,
      wave: 1,
      waves: 3,
      remainingMs: 0,
      strengthPct: 120,
      result: 0,
      tier: 0,
      expLostPct: 0,
      lockMin: 0,
      tamMaId: 0,
    });
    sock.push({ type: 'tribulation_strike', wave: 1, waves: 3, strike: 0, qi: 640, qj: 640, damage: 4200 });
    expect(seen).toEqual(['event 3/0', 'strike 1/3 4200']);
  });

  it('a status mask of another player is forgotten when it leaves the view (its mask-0 update may never arrive), and kept while in view', async () => {
    const { net, sock } = await client({});
    sock.push(enterMsg(3, 77));
    sock.push({ type: 'status_update', entityId: 77, mask: 1 });
    expect(net.statusMaskOf(77)).toBe(1);
    sock.push({ type: 'aoi_leave', indices: [3] });
    expect(net.statusMaskOf(77)).toBe(0);
    // back in view later without a new status_update: nothing stale is shown
    sock.push(enterMsg(3, 77));
    expect(net.statusMaskOf(77)).toBe(0);
    sock.push({ type: 'status_update', entityId: 77, mask: 2 });
    expect(net.statusMaskOf(77)).toBe(2);
  });

  it('entityOfIndex resolves enters and snapshots, and still resolves inside onAoiLeave but not after it', async () => {
    const seen: (number | undefined)[] = [];
    const { net, sock } = await client({
      onSkillResult: (m) => seen.push(net.entityOfIndex(m.hits[0]!.targetIndex)),
      onAoiLeave: (idx) => seen.push(net.entityOfIndex(idx[0]!)), // before removal
    });
    expect(net.entityOfIndex(3)).toBeUndefined();
    sock.push(enterMsg(3, 77));
    expect(net.entityOfIndex(3)).toBe(77);
    sock.push({
      type: 'skill_result',
      seq: 1,
      reason: 0,
      skillId: 1,
      readyAtMs: 0,
      casterIndex: 0,
      hits: [{ targetIndex: 3, damage: 1, flags: 0 }],
    });
    sock.push({ type: 'aoi_leave', indices: [3] });
    expect(seen).toEqual([77, 77]);
    expect(net.entityOfIndex(3)).toBeUndefined();
  });

  it('onSnapshot runs after the position was recorded and the self state reconciled', async () => {
    let selfAtHook: { i: number; j: number } | null = null;
    let posAtHook: number | undefined;
    const { net, sock } = await client({
      onSnapshot: () => {
        selfAtHook = net.selfPosition();
        posAtHook = net.remote.entities.get(3)?.samples.at(-1)?.i;
      },
    });
    sock.push(enterMsg(3, 77));
    sock.push({
      type: 'snapshot',
      seq: 1,
      baselineSeq: null,
      tick: 1,
      self: SELF,
      entities: [{ index: 3, qi: 25 * 32, qj: 20 * 32, anim: 1, dir: 0, hpPct: null }],
    });
    expect(selfAtHook).toEqual({ i: 10, j: 10 });
    expect(posAtHook).toBe(25);
  });

  it('a throwing hook is reported in lastError and does not break later messages or the other hooks', async () => {
    let enters = 0;
    const { net, sock } = await client({
      onSkillResult: () => {
        throw new Error('boom');
      },
      onAoiEnter: () => enters++,
    });
    sock.push({
      type: 'skill_result',
      seq: 1,
      reason: 0,
      skillId: 1,
      readyAtMs: 0,
      casterIndex: 0,
      hits: [],
    });
    expect(net.lastError).toBe('hook: boom');
    sock.push(enterMsg(1, 5));
    expect(enters).toBe(1);
    expect(net.entityOfIndex(1)).toBe(5);
  });

  it('events can be attached later and omitted callbacks are fine', async () => {
    const { net, sock } = await client({});
    sock.push(enterMsg(2, 9)); // no hooks: nothing happens, state is still tracked
    expect(net.entityOfIndex(2)).toBe(9);
    const got: number[] = [];
    net.events = { onAoiEnter: (e) => got.push(...e.map((x) => x.entityId)) };
    sock.push(enterMsg(4, 11));
    expect(got).toEqual([11]);
  });
});

describe('NetClient.sendSkillCast (wire v3)', () => {
  it('sends a skill_cast with the aim quantized to 1/32 tile, or none', async () => {
    const { net, sock } = await client({});
    const before = sock.sent.length;
    expect(net.sendSkillCast({ seq: 3, skillId: 7, targetId: 1_000_002, aim: { i: 20.5, j: 31.25 } })).toBe(true);
    expect(net.sendSkillCast({ seq: 0x10004, skillId: 1, targetId: 0, aim: null })).toBe(true);
    const frames = sock.sent.slice(before).map((d) => decode(d as Uint8Array));
    expect(frames[0]).toEqual({
      type: 'skill_cast',
      seq: 3,
      skillId: 7,
      targetId: 1_000_002,
      aim: { qi: 656, qj: 1000 },
    });
    expect(frames[1]).toEqual({ type: 'skill_cast', seq: 4, skillId: 1, targetId: 0, aim: null }); // seq wraps to u16
  });

  it('an aim outside the map or not finite never throws: it is clamped to the wire range, or dropped', async () => {
    const { net, sock } = await client({});
    const before = sock.sent.length;
    expect(net.sendSkillCast({ seq: 1, skillId: 1, targetId: 0, aim: { i: -5, j: 5000 } })).toBe(true);
    expect(net.sendSkillCast({ seq: 2, skillId: 1, targetId: 0, aim: { i: Number.NaN, j: 1 } })).toBe(true);
    const frames = sock.sent.slice(before).map((d) => decode(d as Uint8Array));
    expect(frames[0]).toEqual({ type: 'skill_cast', seq: 1, skillId: 1, targetId: 0, aim: { qi: 0, qj: 65535 } });
    expect(frames[1]).toEqual({ type: 'skill_cast', seq: 2, skillId: 1, targetId: 0, aim: null });
  });

  it('returns false (and sends nothing) when the socket is not open', async () => {
    const { net, sock } = await client({});
    sock.readyState = 3;
    const n = sock.sent.length;
    expect(net.sendSkillCast({ seq: 1, skillId: 1, targetId: 0, aim: null })).toBe(false);
    expect(sock.sent.length).toBe(n);
  });
});
