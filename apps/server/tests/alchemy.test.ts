/**
 * Minimal alchemy on the server (D108): refusals, the timed job, the atomic exchange, the ledger sink, determinism, cancellation,
 * replay, mastery persistence and the roll log. The WorldNode is driven directly with sim time only.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
  CraftOp,
  CraftOutcome,
  CraftReason,
  ErrorCode,
  decode,
  encode,
  type CraftResultMsg,
  type CraftStateMsg,
  type Message,
} from '@vgtd/protocol';
import { ALCHEMY, NETWORK, craftFee, itemDefByKey, recipeByKey, rngSeed, rollCraft, type DropRoll } from '@vgtd/shared';
import {
  InMemoryProgressionStore,
  InventoryService,
  ProgressionService,
  WorldNode,
  newRecord,
  openFileStores,
  type ClientTransport,
  type CraftLogEntry,
} from '../src/index.js';

const MAT = itemDefByKey('craft_material')!.id;
const flush = (): Promise<void> => new Promise((r) => setImmediate(r));
const hex = (n: number): string => n.toString(16).padStart(32, '0');
const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

class Tr implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  send(d: Uint8Array): void {
    try {
      this.msgs.push(decode(d, { baseline: () => ({ qi: 0, qj: 0 }) }));
    } catch {
      /* snapshots need baselines the test does not track */
    }
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  results(): CraftResultMsg[] {
    return this.msgs.filter((m): m is CraftResultMsg => m.type === 'craft_result');
  }
  states(): CraftStateMsg[] {
    return this.msgs.filter((m): m is CraftStateMsg => m.type === 'craft_state');
  }
}

interface Rig {
  n: WorldNode;
  inv: InventoryService;
  prog: ProgressionService;
  store: InMemoryProgressionStore;
  log: CraftLogEntry[];
  a: { id: number; t: Tr; acc: string };
  seq: number;
  cmd(op: CraftOp, recipeKey?: string, count?: number, id?: string): void;
  run(ms: number): void;
  grant(mat: number, stones?: number): void;
  stones(): bigint;
  mat(): number;
  sink(): bigint;
}
async function rig(
  o: { realm?: number; store?: InMemoryProgressionStore; seed?: number; inv?: InventoryService } = {},
): Promise<Rig> {
  const store = o.store ?? new InMemoryProgressionStore();
  const acc = 'acct-alchemist';
  if (!(await store.load(acc)))
    await store.save(
      { ...newRecord(acc, { type: 'don', elements: ['moc'], mutation: null }), realm: o.realm ?? 2, version: 1 },
      0,
    );
  const inv = o.inv ?? new InventoryService();
  const prog = new ProgressionService({ store, seed: 1 });
  const log: CraftLogEntry[] = [];
  const n: WorldNode = new WorldNode({
    mapTiles: 96,
    spawn: { i0: 30, j0: 30, side: 20 },
    progression: prog,
    inventory: inv,
    craft: { seed: o.seed ?? 7, onLog: (e) => log.push(e) },
    packetClock: () => n.world.timeMs,
  });
  const t = new Tr();
  const id = n.addPlayer(t, acc);
  await flush();
  const r: Rig = {
    n,
    inv,
    prog,
    store,
    log,
    a: { id, t, acc },
    seq: 0,
    cmd(op, recipeKey, count = 1, rid) {
      const recipe = recipeKey ? recipeByKey(recipeKey)! : undefined;
      n.receive(
        id,
        encode({
          type: 'craft_cmd',
          requestId: rid ?? hex(++r.seq),
          op,
          recipeId: op === CraftOp.Start ? recipe!.wireId : 0,
          count: op === CraftOp.Start ? count : 0,
        }),
      );
    },
    run(ms) {
      for (let k = 0; k < Math.ceil(ms / NETWORK.TICK_MS); k++) n.tick();
    },
    grant(mat, stones = 0) {
      const rolls: DropRoll[] = [];
      if (mat > 0) rolls.push({ item: 'craft_material', qty: mat, quality: 0 } as DropRoll);
      if (stones > 0) rolls.push({ item: 'stone_ha', qty: stones, quality: 0 } as DropRoll);
      inv.grantDrops(acc, rolls, 'field', `grant-${++r.seq}`);
    },
    stones: () => inv.wallet(acc, 'LT_HA'),
    mat: () => inv.bagOf(acc).count(MAT),
    sink: () => inv.ledger.balance({ kind: 'SYSTEM_SINK_CRAFT_FEE', ownerId: null, currency: 'LT_HA' }),
  };
  r.run(100);
  return r;
}
const last = <T>(a: T[]): T => a[a.length - 1]!;

describe('refusals leave everything untouched', () => {
  it('a Luyện Khí character cannot craft (crafting opens at Trúc Cơ); a recipe above the realm is refused too', async () => {
    const r = await rig({ realm: 1 });
    r.grant(50, 500);
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan');
    expect(last(r.a.t.results())).toMatchObject({ outcome: CraftOutcome.Rejected, reason: CraftReason.RealmTooLow });
    const r2 = await rig({ realm: 2 });
    r2.grant(50, 500);
    r2.cmd(CraftOp.Start, 'pill_hoi_huyet_dan'); // tier 1: fine at realm 2
    expect(last(r2.a.t.results()).outcome).toBe(CraftOutcome.Accepted);
  });

  it('no materials and no stones are refused with their own reasons, nothing consumed', async () => {
    const r = await rig();
    r.cmd(CraftOp.Start, 'pill_truc_co_dan');
    expect(last(r.a.t.results()).reason).toBe(CraftReason.NotEnoughMaterials);
    r.grant(15); // materials but no stones
    r.cmd(CraftOp.Start, 'pill_truc_co_dan');
    expect(last(r.a.t.results()).reason).toBe(CraftReason.NotEnoughStones);
    expect({ mat: r.mat(), stones: r.stones() }).toEqual({ mat: 15, stones: 0n });
  });

  it('a bag with no room for the product refuses up front (BagFull) and consumes nothing', async () => {
    const r = await rig({ inv: new InventoryService({ bagSlots: 2 }) });
    r.grant(20, 1000); // slot 1: materials, slot 2: the stones are in the wallet, so fill slot 2 with something else
    r.inv.bagOf(r.a.acc).add({ defId: itemDefByKey('heal_pill')!.id, quality: 0, qty: 1 });
    expect(r.inv.bagOf(r.a.acc).freeSlots()).toBe(0);
    r.cmd(CraftOp.Start, 'pill_truc_co_dan'); // 15 of 20 are consumed: the stack stays, the pill has no slot
    expect(last(r.a.t.results())).toMatchObject({ outcome: CraftOutcome.Rejected, reason: CraftReason.BagFull });
    expect({ mat: r.mat(), stones: r.stones() }).toEqual({ mat: 20, stones: 1000n });
  });

  it('too far from the furnace NPC is refused by the server', async () => {
    const r = await rig();
    r.grant(15, 1000);
    r.n.world = {
      ...r.n.world,
      entities: r.n.world.entities.map((e) => (e.id === r.a.id ? { ...e, i: 90, j: 90 } : e)),
    };
    r.n.tick();
    r.cmd(CraftOp.Start, 'pill_truc_co_dan');
    expect(last(r.a.t.results())).toMatchObject({ outcome: CraftOutcome.Rejected, reason: CraftReason.TooFar });
  });

  it('a second start while a job runs is Busy; commands are rate limited', async () => {
    const r = await rig();
    r.grant(60, 1000);
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 2);
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 1);
    expect(last(r.a.t.results())).toMatchObject({ outcome: CraftOutcome.Rejected, reason: CraftReason.Busy });
    for (let k = 0; k < 8; k++) r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 1);
    expect(r.a.t.results().some((m) => m.reason === CraftReason.RateLimited)).toBe(true);
  });

  it('a node built without alchemy treats craft messages as unexpected', async () => {
    const n = new WorldNode({ mapTiles: 96, spawn: { i0: 30, j0: 30, side: 20 } });
    const t = new Tr();
    const id = n.addPlayer(t, 'x');
    n.receive(id, encode({ type: 'craft_cmd', requestId: hex(1), op: CraftOp.Cancel, recipeId: 0, count: 0 }));
    expect(t.msgs.some((m) => m.type === 'error')).toBe(true);
  });
});

describe('a craft job', () => {
  it('takes CRAFT_MS per craft, then exchanges atomically: stones to the sink, materials destroyed, product added', async () => {
    const r = await rig();
    r.grant(60, 1000);
    const recipe = recipeByKey('pill_truc_co_dan')!;
    const fee = craftFee(recipe);
    r.cmd(CraftOp.Start, 'pill_truc_co_dan', 1);
    expect(last(r.a.t.results()).outcome).toBe(CraftOutcome.Accepted);
    r.run(ALCHEMY.CRAFT_MS - 100);
    expect(r.a.t.results().filter((m) => m.index === 0)).toHaveLength(0); // not yet
    expect(r.mat()).toBe(60); // nothing consumed while it is running
    r.run(300);
    const res = r.a.t.results().find((m) => m.index === 0)!;
    expect([CraftOutcome.Success, CraftOutcome.Failed]).toContain(res.outcome);
    expect(r.stones()).toBe(1000n - BigInt(fee));
    expect(r.sink()).toBe(BigInt(fee));
    expect(r.inv.ledger.reconcile()).toEqual([]);
    if (res.outcome === CraftOutcome.Success) {
      expect(r.mat()).toBe(60 - recipe.materials);
      expect(res).toMatchObject({ qty: 1, lost: 0 });
      expect(r.inv.bagOf(r.a.acc).count(itemDefByKey('breakthrough_pill')!.id, res.quality)).toBe(1);
      expect(res.quality).toBeLessThanOrEqual(recipe.qualityCap);
    } else {
      expect(r.mat()).toBe(60 - Math.ceil(recipe.materials * 0.6)); // 60 % destroyed, rounded up
      expect(res).toMatchObject({ qty: 0, lost: 9 });
      expect(r.inv.bagOf(r.a.acc).count(itemDefByKey('breakthrough_pill')!.id)).toBe(0);
    }
    expect(last(r.a.t.states()).job.recipeId).toBe(0); // the job is over
  });

  it('a queue of crafts runs one per CRAFT_MS and stops with a reason when the materials run out', async () => {
    const r = await rig();
    r.grant(30, 1000); // enough for 3 hoi huyet crafts of 3 materials only if all succeed: plenty
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 10);
    r.run(ALCHEMY.CRAFT_MS * 10 + 500);
    const done = r.a.t.results().filter((m) => m.index < 10 && m.outcome !== CraftOutcome.Accepted);
    expect(done.length).toBeGreaterThan(0);
    expect(done.length).toBeLessThanOrEqual(10);
    // every craft index appears at most once
    expect(new Set(done.map((m) => `${m.index}:${m.outcome}`)).size).toBe(done.length);
    expect(r.inv.ledger.reconcile()).toEqual([]);
    const fees = BigInt(craftFee(recipeByKey('pill_hoi_huyet_dan')!)) * BigInt(r.log.length);
    expect(r.sink()).toBe(fees); // one fee per completed craft, never more
    expect(r.stones()).toBe(1000n - fees);
  });

  it('every roll is deterministic and logged: the logged draws reproduce the outcome', async () => {
    const run = async (): Promise<CraftLogEntry[]> => {
      const r = await rig({ seed: 99 });
      r.grant(200, 5000);
      r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 10, hex(4242));
      r.run(ALCHEMY.CRAFT_MS * 10 + 500);
      return r.log;
    };
    const a = await run();
    const b = await run();
    expect(a.length).toBe(10);
    expect(a).toEqual(b); // same seed, same request: same rolls
    for (const e of a) {
      expect(e.chance).toBeGreaterThan(0.4);
      expect(e.drawA < e.chance).toBe(e.success);
      expect(e.fee).toBe(1);
    }
    const c = await (async () => {
      const r = await rig({ seed: 100 });
      r.grant(200, 5000);
      r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 10, hex(4242));
      r.run(ALCHEMY.CRAFT_MS * 10 + 500);
      return r.log;
    })();
    expect(c.map((e) => e.drawA)).not.toEqual(a.map((e) => e.drawA)); // another server seed rolls differently
  });

  it('the roll of craft i does not depend on which other crafts happened (seeded per request and index)', () => {
    const recipe = recipeByKey('pill_truc_co_dan')!;
    const [x] = rollCraft(recipe, 0, rngSeed(5));
    const [y] = rollCraft(recipe, 0, rngSeed(5));
    expect(x).toEqual(y);
  });
});

describe('cancelling never costs anything', () => {
  it.each([
    [
      'moving',
      (r: Rig) =>
        r.n.receive(
          r.a.id,
          encode({ type: 'input', ack: 0, inputs: [{ seq: 1, dtMs: 50, dir: 0, mag: 15, flags: 0 }] }),
        ),
      CraftReason.Moved,
    ],
    [
      'a skill cast',
      (r: Rig) => r.n.receive(r.a.id, encode({ type: 'skill_cast', seq: 1, skillId: 1, targetId: 0, aim: null })),
      CraftReason.InCombat,
    ],
    ['the cancel command', (r: Rig) => r.cmd(CraftOp.Cancel), CraftReason.ByPlayer],
  ] as const)('%s cancels the job and consumes nothing', async (_n, act, reason) => {
    const r = await rig();
    r.grant(60, 1000);
    r.cmd(CraftOp.Start, 'pill_truc_co_dan', 3);
    r.run(2000);
    act(r);
    r.run(ALCHEMY.CRAFT_MS * 3);
    expect(last(r.a.t.results().filter((m) => m.outcome === CraftOutcome.Cancelled))).toMatchObject({ reason });
    expect(r.mat()).toBe(60);
    expect(r.stones()).toBe(1000n);
    expect(r.sink()).toBe(0n);
    expect(last(r.a.t.states()).job.recipeId).toBe(0);
  });

  it('walking away from the furnace between starting and completing interrupts the craft', async () => {
    const r = await rig();
    r.grant(60, 1000);
    r.cmd(CraftOp.Start, 'pill_truc_co_dan', 1);
    r.n.world = {
      ...r.n.world,
      entities: r.n.world.entities.map((e) => (e.id === r.a.id ? { ...e, i: 95, j: 95 } : e)),
    };
    r.run(ALCHEMY.CRAFT_MS + 200);
    expect(last(r.a.t.results().filter((m) => m.outcome === CraftOutcome.Cancelled)).reason).toBe(
      CraftReason.Interrupted,
    );
    expect(r.mat()).toBe(60);
  });
});

describe('replay and atomicity', () => {
  it('the same requestId gets the same answer and starts nothing twice', async () => {
    const r = await rig();
    r.grant(60, 1000);
    r.cmd(CraftOp.Start, 'pill_truc_co_dan', 1, hex(77));
    r.cmd(CraftOp.Start, 'pill_truc_co_dan', 1, hex(77));
    const answers = r.a.t.results().filter((m) => m.requestId === hex(77));
    expect(answers).toHaveLength(2);
    expect(answers[1]).toEqual(answers[0]);
    r.run(ALCHEMY.CRAFT_MS + 300);
    expect(r.log).toHaveLength(1);
  });

  it('InventoryService.craftExchange is all or nothing and replays by key', () => {
    const inv = new InventoryService();
    const o = 'owner';
    inv.onJoin(o);
    inv.grantDrops(
      o,
      [
        { item: 'craft_material', qty: 20, quality: 0 },
        { item: 'stone_ha', qty: 100, quality: 0 },
      ] as DropRoll[],
      'field',
      'k1',
    );
    const prod = { defId: itemDefByKey('breakthrough_pill')!.id, quality: 2, qty: 1 };
    const ex = { key: 'c1', materialDefId: MAT, consume: 15, fee: 34n, produce: prod };
    // short of stones: nothing changes
    expect(inv.craftExchange(o, { ...ex, key: 'poor', fee: 101n })).toEqual({ ok: false, reason: 'NOT_ENOUGH_STONES' });
    expect(inv.bagOf(o).count(MAT)).toBe(20);
    expect(inv.wallet(o, 'LT_HA')).toBe(100n);
    // short of materials
    expect(inv.craftExchange(o, { ...ex, key: 'thin', consume: 21 })).toEqual({
      ok: false,
      reason: 'NOT_ENOUGH_MATERIALS',
    });
    // happy path, then the same key again
    expect(inv.craftExchange(o, ex)).toEqual({ ok: true, replayed: false });
    expect(inv.craftExchange(o, ex)).toEqual({ ok: true, replayed: true });
    expect(inv.bagOf(o).count(MAT)).toBe(5);
    expect(inv.wallet(o, 'LT_HA')).toBe(66n);
    expect(inv.bagOf(o).count(prod.defId, 2)).toBe(1);
    expect(inv.ledger.reconcile()).toEqual([]);
    expect(inv.bagOf(o).check()).toEqual([]);
  });

  it('a product that does not fit rolls the whole exchange back (no fee, no materials lost)', () => {
    const inv = new InventoryService({ bagSlots: 2 });
    const o = 'owner';
    inv.onJoin(o);
    inv.grantDrops(
      o,
      [
        { item: 'craft_material', qty: 20, quality: 0 },
        { item: 'stone_ha', qty: 100, quality: 0 },
      ] as DropRoll[],
      'field',
      'k1',
    );
    // the bag has 2 slots: materials in one; fill the other with something else
    inv.bagOf(o).add({ defId: itemDefByKey('heal_pill')!.id, quality: 0, qty: 1 });
    const r = inv.craftExchange(o, {
      key: 'full',
      materialDefId: MAT,
      consume: 5, // the material stack stays: the product has nowhere to go
      fee: 10n,
      produce: { defId: itemDefByKey('breakthrough_pill')!.id, quality: 1, qty: 1 },
    });
    expect(r).toEqual({ ok: false, reason: 'NO_SPACE' });
    expect(inv.bagOf(o).count(MAT)).toBe(20);
    expect(inv.wallet(o, 'LT_HA')).toBe(100n);
    expect(inv.ledger.balance({ kind: 'SYSTEM_SINK_CRAFT_FEE', ownerId: null, currency: 'LT_HA' })).toBe(0n);
  });
});

describe('the client can never pick or repeat a roll (review: replayable requestId)', () => {
  it('the outcome does not depend on the client requestId: two requests with different ids on the same server state roll identically', async () => {
    const roll = async (rid: string): Promise<number[]> => {
      const r = await rig({ seed: 31 });
      r.grant(100, 2000);
      r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 6, rid);
      r.run(ALCHEMY.CRAFT_MS * 6 + 500);
      return r.log.map((e) => e.drawA);
    };
    const a = await roll(hex(1));
    const b = await roll(hex(999_999));
    expect(a).toHaveLength(6);
    expect(a).toEqual(b);
  });

  it('reusing a requestId after the answer cache forgot it is refused: no new draws, no mastery, nothing consumed', async () => {
    const r = await rig();
    r.grant(200, 3000);
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 1, hex(500));
    r.run(ALCHEMY.CRAFT_MS + 300);
    expect(r.log).toHaveLength(1);
    const state = {
      mat: r.mat(),
      stones: r.stones(),
      mastery: r.prog.masteryOf(r.a.id, 'pill_hoi_huyet_dan'),
      draws: r.log[0]!.drawA,
    };
    // evict the stored answer: more than ANSWERS_KEPT other commands (cancels with fresh ids also fill it)
    for (let k = 0; k < 40; k++) {
      r.run(1100); // keep under the command rate limit
      r.cmd(CraftOp.Cancel, undefined, 1, hex(1000 + k));
    }
    const before = r.a.t.results().length;
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 1, hex(500));
    expect(r.a.t.results().length).toBe(before + 1);
    expect(last(r.a.t.results())).toMatchObject({ outcome: CraftOutcome.Rejected, reason: CraftReason.Replayed });
    r.run(ALCHEMY.CRAFT_MS * 2);
    expect(r.log).toHaveLength(1);
    expect({
      mat: r.mat(),
      stones: r.stones(),
      mastery: r.prog.masteryOf(r.a.id, 'pill_hoi_huyet_dan'),
      draws: r.log[0]!.drawA,
    }).toEqual(state);
  });

  it('a relog or a restart does not reset it: the used ids and the roll counter are saved with the character', async () => {
    const store = new InMemoryProgressionStore();
    const inv = new InventoryService();
    const first = await rig({ store, inv, seed: 5 });
    first.grant(300, 3000);
    first.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 2, hex(77));
    first.run(ALCHEMY.CRAFT_MS * 2 + 500);
    expect(first.log.map((e) => e.drawA)).toHaveLength(2);
    await first.prog.leave(first.a.id);
    const rec = await store.load(first.a.acc);
    expect(rec?.craftNonce).toBe(2);
    expect(rec?.craftRequests).toContain(hex(77));
    // a new session (a restart: new services over the same stores) tries the same request id
    const second = await rig({ store, inv, seed: 5 });
    second.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 1, hex(77));
    expect(last(second.a.t.results())).toMatchObject({ outcome: CraftOutcome.Rejected, reason: CraftReason.Replayed });
    // a fresh id works and its draws are NOT the ones the first session saw (the counter went on)
    second.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 2, hex(78));
    second.run(ALCHEMY.CRAFT_MS * 2 + 500);
    expect(second.log.map((e) => e.drawA)).not.toEqual(first.log.map((e) => e.drawA));
    expect((await store.load(first.a.acc))?.craftNonce).toBeGreaterThanOrEqual(2);
  });

  it('InventoryService.craftExchange reports a replayed key, and the service treats it as no craft', () => {
    const inv = new InventoryService();
    inv.onJoin('o');
    inv.grantDrops(
      'o',
      [
        { item: 'craft_material', qty: 10, quality: 0 },
        { item: 'stone_ha', qty: 50, quality: 0 },
      ] as DropRoll[],
      'field',
      'g',
    );
    const ex = {
      key: 'o:n1',
      materialDefId: MAT,
      consume: 3,
      fee: 1n,
      produce: { defId: itemDefByKey('heal_pill')!.id, quality: 1, qty: 1 },
    };
    expect(inv.craftExchange('o', ex)).toEqual({ ok: true, replayed: false });
    expect(inv.craftExchange('o', ex)).toEqual({ ok: true, replayed: true });
    expect(inv.bagOf('o').count(itemDefByKey('heal_pill')!.id)).toBe(1); // applied once
  });
});

describe('mastery and persistence (D92)', () => {
  it('successful crafts raise the mastery of that recipe only; it is saved with the character and survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-alch-'));
    dirs.push(dir);
    const s1 = openFileStores(dir);
    const inv1 = new InventoryService({ store: s1.inventories, ledger: s1.ledger });
    const r = await rig({ store: s1.progression as unknown as InMemoryProgressionStore, inv: inv1 });
    r.grant(300, 5000);
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 10);
    r.run(ALCHEMY.CRAFT_MS * 10 + 500);
    const wins = r.a.t.results().filter((m) => m.outcome === CraftOutcome.Success).length;
    expect(wins).toBeGreaterThan(0);
    const m = r.prog.masteryOf(r.a.id, 'pill_hoi_huyet_dan');
    expect(m).toBeGreaterThanOrEqual(wins); // at least +1 per success (docs: diminishing, never zero below 100)
    expect(r.prog.masteryOf(r.a.id, 'pill_truc_co_dan')).toBe(0);
    expect(last(r.a.t.states()).mastery).toEqual([{ recipeId: recipeByKey('pill_hoi_huyet_dan')!.wireId, points: m }]);
    await r.prog.leave(r.a.id);
    r.inv.flushAll();
    s1.flush();
    // restart: a new service over the same files
    const s2 = openFileStores(dir);
    const rec = await s2.progression.load(r.a.acc);
    expect(rec?.craftMastery?.pill_hoi_huyet_dan).toBe(m);
    expect(s2.ledger.reconcile()).toEqual([]);
    const sink = s2.ledger.balance({ kind: 'SYSTEM_SINK_CRAFT_FEE', ownerId: null, currency: 'LT_HA' });
    expect(sink).toBe(BigInt(r.log.length)); // one stone per hoi huyet craft
  });

  it('mastery lifts the Score the roll uses (50 points = +1) and caps at 100', async () => {
    const r = await rig();
    r.grant(500, 5000);
    r.prog.addMastery(r.a.id, 'pill_hoi_huyet_dan', 60, ALCHEMY.MASTERY_MAX);
    r.cmd(CraftOp.Start, 'pill_hoi_huyet_dan', 1);
    r.run(ALCHEMY.CRAFT_MS + 300);
    expect(r.log[0]!.score).toBe(1);
    r.prog.addMastery(r.a.id, 'pill_hoi_huyet_dan', 500, ALCHEMY.MASTERY_MAX);
    expect(r.prog.masteryOf(r.a.id, 'pill_hoi_huyet_dan')).toBe(100);
  });
});
