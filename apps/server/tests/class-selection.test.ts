import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { DEFAULT_CLASS, PATHS, classWireId, type PathId } from '@vgtd/shared';
import { ErrorCode, PROTOCOL_VERSION, decode } from '@vgtd/protocol';
import { TileGrid } from '@vgtd/sim';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js'; // engine-free netcode only
import {
  InMemoryProgressionStore,
  ProgressionService,
  newRecord,
  startServer,
  type ProgressRecord,
  type RunningServer,
} from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

/** Class selection on the wire (D82): hello `classId`, the stored class wins, defId carries it to other players, combat uses it. */
const FAST = { N: 1024, r: 8, p: 1 };
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let srv: RunningServer | undefined;
afterEach(async () => {
  await srv?.stop();
  srv = undefined;
});
async function boot(over: { combat?: boolean } = {}): Promise<RunningServer> {
  srv = await startServer({
    port: 0,
    auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
    world: { mapTiles: 64, spawn: { i0: 20, j0: 20, side: 8 }, ...(over.combat ? { combat: {} } : {}) },
  });
  return srv;
}
const base = (s: RunningServer): string => `http://127.0.0.1:${s.port}`;
async function token(s: RunningServer, name: string): Promise<string> {
  const cred = { username: name, password: TEST_ONLY_GOOD };
  const post = (p: string) =>
    fetch(base(s) + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(cred) });
  await post('/auth/register');
  return ((await (await post('/auth/login')).json()) as { token: string }).token;
}
/** Raw hello: resolves with the first reply (hello_ack JSON, or the error frame the server closes with). */
async function hello(
  s: RunningServer,
  tok: string,
  extra: Record<string, unknown>,
): Promise<{ ack?: Record<string, unknown>; error?: { code: number; text: string }; ws: WebSocket }> {
  const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
  ws.binaryType = 'arraybuffer';
  return new Promise((resolve) => {
    ws.on('open', () =>
      ws.send(
        JSON.stringify({
          type: 'hello',
          protocolMin: PROTOCOL_VERSION,
          protocolMax: PROTOCOL_VERSION,
          token: tok,
          ...extra,
        }),
      ),
    );
    ws.on('message', (d, isBinary) => {
      if (!isBinary) return resolve({ ack: JSON.parse(d.toString()) as Record<string, unknown>, ws });
      const m = decode(new Uint8Array(d as ArrayBuffer));
      if (m.type === 'error') resolve({ error: { code: m.code, text: m.text }, ws });
    });
  });
}

describe('hello classId', () => {
  it('a new character is created with the class it asks for (path id or wire id) and the ack says which class it has', async () => {
    const s = await boot();
    const a = await hello(s, await token(s, 'cls_a'), { classId: 'phap' });
    expect(a.ack).toMatchObject({ type: 'hello_ack', classId: classWireId('phap') });
    a.ws.close();
    const b = await hello(s, await token(s, 'cls_b'), { classId: 6 });
    expect(b.ack?.classId).toBe(classWireId('dao'));
    b.ws.close();
  });

  it('no classId (or null) gives the default class', async () => {
    const s = await boot();
    const a = await hello(s, await token(s, 'cls_c'), {});
    expect(a.ack?.classId).toBe(classWireId(DEFAULT_CLASS));
    a.ws.close();
    const b = await hello(s, await token(s, 'cls_d'), { classId: null });
    expect(b.ack?.classId).toBe(classWireId(DEFAULT_CLASS));
    b.ws.close();
  });

  it.each([['nope'], [0], [7], [99], [-1], [1.5], [true], [{}], [[]], ['KIEM'], ['kiem-tu'], ['__proto__']])(
    'an invalid classId %j is refused with BadMessage and creates nothing',
    async (bad) => {
      const s = await boot();
      const name = `cls_bad${Math.floor(Math.random() * 1e6)}`;
      const r = await hello(s, await token(s, name), { classId: bad });
      expect(r.ack).toBeUndefined();
      expect(r.error).toMatchObject({ code: ErrorCode.BadMessage });
      expect(s.world.clients.size).toBe(0);
      r.ws.close();
    },
  );

  it('the class is decided ONCE: a later login asking for another class keeps the stored one', async () => {
    const s = await boot();
    const tok = await token(s, 'cls_once');
    const first = await hello(s, tok, { classId: 'thuong' });
    expect(first.ack?.classId).toBe(classWireId('thuong'));
    first.ws.close(1000);
    await sleep(100);
    const again = await hello(s, await token(s, 'cls_once'), { classId: 'dao' });
    expect(again.ack?.classId).toBe(classWireId('thuong'));
    again.ws.close(1000);
    // and it is persisted with the character
    const stored = [...(s.world.progression!.store as InMemoryProgressionStore)['rows'].values()].find(
      (r: ProgressRecord) => r.classId === 'thuong',
    );
    expect(stored).toBeDefined();
  });

  it('combat builds the profile of the stored class', async () => {
    const s = await boot({ combat: true });
    const r = await hello(s, await token(s, 'cls_fight'), { classId: 'the' });
    const id = r.ack!.entityId as number;
    expect(s.world.combat!.profileOf(id)?.path).toBe('the');
    expect(s.world.classPathOf(id)).toBe('the');
    expect(s.world.classWireIdOf(id)).toBe(classWireId('the'));
    r.ws.close();
  });
});

describe('players see each other with the right class (EnterEntity.defId)', () => {
  const deps: NetDeps = {
    fetch: (url, init) => fetch(url, init),
    WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
    now: () => performance.now(),
  };
  const client = (s: RunningServer, name: string, classId: string): NetClient =>
    new NetClient({
      baseUrl: base(s),
      username: name,
      password: TEST_ONLY_GOOD,
      deps,
      classId,
      makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
    });
  it('two real NetClients of different classes: each learns its own class from the ack and the other one from defId', async () => {
    const s = await boot();
    const a = client(s, 'seen_a', 'kiem');
    const b = client(s, 'seen_b', 'dan_phu');
    await a.connect();
    await b.connect();
    expect(a.classId).toBe(classWireId('kiem'));
    expect(b.classId).toBe(classWireId('dan_phu'));
    const t0 = Date.now();
    while (Date.now() - t0 < 5000 && !(a.remotes().length && b.remotes().length)) {
      a.update(50);
      b.update(50);
      await sleep(50);
    }
    expect(a.remotes().map((r) => [r.kind, r.defId])).toEqual([[0, classWireId('dan_phu')]]);
    expect(b.remotes().map((r) => [r.kind, r.defId])).toEqual([[0, classWireId('kiem')]]);
    a.close();
    b.close();
  }, 15000);

  it('the class can be chosen after construction (classRequest) and an existing character ignores it', async () => {
    const s = await boot();
    const c = client(s, 'late_pick', 'kiem');
    c.classRequest = 'phap'; // what the scene does after its picker
    await c.connect();
    expect(c.classId).toBe(classWireId('phap'));
    c.close();
    await sleep(100);
    const again = client(s, 'late_pick', 'dao');
    await again.connect();
    expect(again.classId).toBe(classWireId('phap'));
    again.close();
  });
});

describe('ProgressionService.resolveClass', () => {
  it('stores the class with the new character, then always returns the stored one', async () => {
    const store = new InMemoryProgressionStore();
    const svc = new ProgressionService({ store, seed: 3 });
    expect(await svc.resolveClass('c1', 'phap')).toBe('phap');
    expect(store.peek('c1')).toMatchObject({ classId: 'phap', realm: 1, subRealm: 1, version: 1 });
    expect(await svc.resolveClass('c1', 'dao')).toBe('phap');
    expect(await svc.resolveClass('c1')).toBe('phap');
    expect(store.writes).toBe(1);
  });
  it('invalid / absent requests mean the default class', async () => {
    const svc = new ProgressionService({ seed: 3 });
    expect(await svc.resolveClass('d1', 'nonsense')).toBe(DEFAULT_CLASS);
    expect(await svc.resolveClass('d2', undefined)).toBe(DEFAULT_CLASS);
    expect(await svc.resolveClass('d3', 42)).toBe(DEFAULT_CLASS);
  });
  it('two simultaneous logins of one account cannot disagree (first one wins, one write)', async () => {
    const store = new InMemoryProgressionStore();
    const svc = new ProgressionService({ store, seed: 3 });
    const all = await Promise.all(PATHS.map((p) => svc.resolveClass('race', p)));
    expect(new Set(all).size).toBe(1);
    expect(all[0]).toBe(PATHS[0]);
    expect(store.writes).toBe(1);
  });
  it('a record written before D82 (no class) gets its class from the next login, once', async () => {
    const store = new InMemoryProgressionStore();
    const legacy: ProgressRecord = {
      ...newRecord('old', { type: 'tap_tam', elements: ['kim', 'moc', 'thuy'], mutation: null }),
      version: 4,
    };
    await store.save(legacy, 0);
    const svc = new ProgressionService({ store, seed: 3 });
    expect(await svc.resolveClass('old', 'the')).toBe('the');
    expect(store.peek('old')).toMatchObject({ classId: 'the', version: 5, exp: 0 });
    expect(await svc.resolveClass('old', 'dao')).toBe('the');
  });
  it('waits for an in-flight write of the previous session and joins with the stored class', async () => {
    class Slow extends InMemoryProgressionStore {
      override async save(rec: ProgressRecord, expected: number): Promise<boolean> {
        await sleep(40);
        return super.save(rec, expected);
      }
    }
    const store = new Slow();
    const svc = new ProgressionService({ store, seed: 3 });
    expect(await svc.resolveClass('slow', 'thuong')).toBe('thuong');
    svc.join(1, 'slow', 0);
    await sleep(80);
    expect(svc.classOf(1)).toBe('thuong');
    expect(svc.recordOf(1)?.classId).toBe('thuong');
    // classOf of an unknown entity is the default, never a throw
    expect(svc.classOf(999)).toBe(DEFAULT_CLASS);
  });
  it('every class round-trips through the store', async () => {
    const svc = new ProgressionService({ seed: 5 });
    for (const p of PATHS as readonly PathId[]) expect(await svc.resolveClass(`rt_${p}`, p)).toBe(p);
  });
});
