/**
 * Major breakthrough events (D97): Tâm Ma shadow, Thiên Mệnh roll, Lôi Kiếp bolts, outcomes, persistence, determinism. Real WorldNode with
 * the real ProgressionService; the roll is steered by picking a seed whose first draw lands where the test needs it.
 */
import { describe, expect, it } from 'vitest';
import { compileSkills } from '@vgtd/sim';
import {
  MOB_ID_BASE,
  ConsequenceTier,
  MAJOR_EVENT,
  MajorPhase,
  MajorResult,
  boltSchedule,
  hpRefOf,
  maxSubStage,
  rngFloat,
  rngFork,
  rngSeed,
  TRIBULATIONS,
  breakthroughSuccess,
  tamMaStrength,
} from '@vgtd/shared';
import { BreakthroughOutcome, ProgressionReason, decode, encode, type BaselinePos, type Message } from '@vgtd/protocol';
import {
  InMemoryProgressionStore,
  ProgressionService,
  SHADOW_ID_BASE,
  WorldNode,
  newRecord,
  tuViRequired,
  type ClientTransport,
} from '../src/index.js';

class Client implements ClientTransport {
  msgs: Message[] = [];
  known = new Map<number, BaselinePos>();
  send(data: Uint8Array): void {
    const m = decode(data, { baseline: (i) => this.known.get(i) });
    this.msgs.push(m);
    if (m.type === 'snapshot') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_enter') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_leave') for (const i of m.indices) this.known.delete(i);
  }
  close(): void {}
  buffered(): number {
    return 0;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.msgs.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
}

const ROOT = { type: 'don' as const, elements: ['moc'] as 'moc'[], mutation: null };
const REQ = 'ab'.repeat(16);

/** a seed whose FIRST breakthrough draw is below (`success`) / at or above `chance` */
function seedFor(success: boolean, chance: number): number {
  for (let seed = 1; seed < 400; seed++) {
    const [draw] = rngFloat(rngFork(rngSeed(seed), 'breakthrough'));
    if (success ? draw < chance : draw >= chance) return seed;
  }
  throw new Error('no seed');
}

interface Rig {
  node: WorldNode;
  c: Client;
  id: number;
  store: InMemoryProgressionStore;
  service: ProgressionService;
  run(ms: number): void;
  me(): { hp: number; i: number; j: number };
  hpMax(): number;
  start(requestId?: string): void;
  setHp(hp: number): void;
  killShadow(): void;
  shadowId(): number;
}

async function rig(
  o: { realm: number; seed?: number; karma?: number; nFail?: number; exp?: number } = { realm: 3 },
): Promise<Rig> {
  const store = new InMemoryProgressionStore();
  const sub = maxSubStage(o.realm);
  const rec = {
    ...newRecord('acc', ROOT),
    realm: o.realm,
    subRealm: sub,
    karma: o.karma ?? 0,
    nFail: o.nFail ?? 0,
    version: 1,
  };
  await store.save({ ...rec, exp: o.exp ?? tuViRequired(rec) }, 0);
  const service = new ProgressionService({ store, seed: o.seed ?? 1 });
  const node = new WorldNode({
    seed: 7,
    mapTiles: 64,
    spawn: { i0: 30, j0: 30, side: 1 },
    combat: {},
    progression: service,
    resumeHoldMs: 300_000,
  });
  const c = new Client();
  const id = node.addPlayer(c, 'acc');
  await new Promise<void>((r) => setImmediate(r));
  for (let k = 0; k < 10; k++) node.tick();
  const ent = () => node.world.entities.find((e) => e.id === id)!;
  const r: Rig = {
    node,
    c,
    id,
    store,
    service,
    run(ms) {
      for (let k = 0; k < Math.round(ms / 50); k++) node.tick();
    },
    me: () => ({ hp: ent().hp, i: ent().i, j: ent().j }),
    hpMax: () => node.combat!.maxHpOf(id)!,
    start(requestId = REQ) {
      node.receive(id, encode({ type: 'breakthrough_start', requestId }));
    },
    setHp(hp) {
      node.world = { ...node.world, entities: node.world.entities.map((e) => (e.id === id ? { ...e, hp } : e)) };
    },
    killShadow() {
      const sid = r.shadowId();
      node.world = { ...node.world, entities: node.world.entities.map((e) => (e.id === sid ? { ...e, hp: 0 } : e)) };
    },
    shadowId: () => node.major!.shadowOf(id),
  };
  return r;
}

const events = (r: Rig) => r.c.of('major_event');
const lastEvent = (r: Rig) => events(r)[events(r).length - 1]!;
const results = (r: Rig) => r.c.of('breakthrough_result');

/** play a Kim Đan -> Nguyên Anh attempt up to the moment the first bolt is about to hit */
async function toTribulation(r: Rig): Promise<void> {
  r.start();
  r.run(100);
  r.killShadow();
  r.run(100 + MAJOR_EVENT.DESTINY_PAUSE_MS + 200);
}

describe('major breakthrough: Tâm Ma + Lôi Kiếp (D97)', () => {
  it('Kim Đan -> Nguyên Anh, the whole way: Tâm Ma shadow, roll, 3 bolts on the schedule, success, stage up, persisted', async () => {
    const chance = breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 });
    const r = await rig({ realm: 3, seed: seedFor(true, chance) });
    const hpMax0 = r.hpMax();
    r.start();
    expect(results(r)).toHaveLength(0); // no immediate answer: the event runs
    r.run(100);
    // Tâm Ma: a real shadow entity, stats x strength, a kind-monster in the player's view
    const first = events(r)[0]!;
    expect(first).toMatchObject({ phase: MajorPhase.TamMa, waves: 3, remainingMs: MAJOR_EVENT.TAM_MA_LIMIT_MS });
    expect(first.tamMaId).toBeGreaterThanOrEqual(SHADOW_ID_BASE);
    expect(first.strengthPct).toBe(Math.round(tamMaStrength(MAJOR_EVENT.DEFAULT_DAO_TAM, 0) * 100));
    const shadow = node(r).world.entities.find((e) => e.id === first.tamMaId)!;
    expect(shadow.hp).toBeGreaterThan(hpMax0); // x 1.2
    const enters = r.c
      .of('aoi_enter')
      .flatMap((m) => m.entities)
      .filter((e) => e.entityId === first.tamMaId);
    expect(enters[0]).toMatchObject({ kind: 1, defId: 200 });
    // its attack is telegraphed on the D89 path
    r.run(MAJOR_EVENT.TAM_MA_ATTACK_INTERVAL_MS);
    expect(r.c.of('telegraph_start').some((t) => t.mobEntityId === first.tamMaId)).toBe(true);
    // the player kills it: Thiên Mệnh pause, then the clouds
    r.killShadow();
    r.run(100);
    expect(lastEvent(r)).toMatchObject({ phase: MajorPhase.Destiny });
    expect(node(r).world.entities.some((e) => e.id === first.tamMaId)).toBe(false);
    r.run(MAJOR_EVENT.DESTINY_PAUSE_MS + 200);
    expect(lastEvent(r)).toMatchObject({ phase: MajorPhase.Tribulation, wave: 0, waves: 3 });
    // the bolts: warning decal 1.2 s before each, damage from the 07 §3 schedule, unavoidable
    const plan = boltSchedule(TRIBULATIONS[0]!, hpRefOf(3));
    const hp0 = r.me().hp;
    r.run(MAJOR_EVENT.CLOUD_GATHER_MS + 17_200 + 500);
    const strikes = r.c.of('tribulation_strike');
    expect(strikes.map((s) => [s.wave, s.waves, s.strike, s.damage])).toEqual(
      plan.map((b) => [b.wave, 3, b.strike, b.damage]),
    );
    expect(plan.reduce((a, b) => a + b.damage, 0) / hpRefOf(3)).toBeCloseTo(0.6, 1); // 0.6 x HP_ref in total, survivable without mitigation
    expect(r.me().hp).toBeLessThan(hp0); // the bolts hurt (out-of-combat regen heals some between the waves: only the direction is asserted)
    // success: answer, final event, stage up, persisted
    expect(results(r)).toHaveLength(1);
    expect(results(r)[0]).toMatchObject({
      requestId: REQ,
      outcome: BreakthroughOutcome.Success,
      kind: 2,
      fromStage: 17,
      toStage: 18,
    });
    expect(lastEvent(r)).toMatchObject({ phase: MajorPhase.Ended, result: MajorResult.Success, tier: 0, lockMin: 0 });
    await new Promise<void>((res) => setImmediate(res));
    expect(r.store.peek('acc')).toMatchObject({ realm: 4, subRealm: 1, exp: 0, nFail: 0 });
    expect(r.node.major!.size).toBe(0);
    // every bolt warning has its end
    const tStart = r.c.of('telegraph_start').filter((t) => t.mobEntityId === 0);
    const tEnd = r.c.of('telegraph_end');
    expect(tStart).toHaveLength(3);
    for (const t of tStart)
      expect(tEnd.filter((e) => e.id === t.id)).toEqual([{ type: 'telegraph_end', id: t.id, cancelled: false }]);
  });

  it('Trúc Cơ -> Kim Đan (Tâm Ma nhẹ only): no bolts, success after the roll', async () => {
    const r = await rig({ realm: 2, seed: seedFor(true, breakthroughSuccess({ realm: 2, karma: 0, nFail: 0 })) });
    r.start();
    r.run(100);
    expect(events(r)[0]).toMatchObject({ phase: MajorPhase.TamMa, waves: 0 });
    r.killShadow();
    r.run(100 + MAJOR_EVENT.DESTINY_PAUSE_MS + 300);
    expect(r.c.of('tribulation_strike')).toHaveLength(0);
    expect(results(r)[0]).toMatchObject({ outcome: BreakthroughOutcome.Success, fromStage: 13, toStage: 14 });
    expect(lastEvent(r)).toMatchObject({ phase: MajorPhase.Ended, result: MajorResult.Success });
  });

  it('Luyện Khí -> Trúc Cơ has no event: a plain roll answered at once', async () => {
    const r = await rig({ realm: 1, seed: seedFor(true, breakthroughSuccess({ realm: 1, karma: 0, nFail: 0 })) });
    r.start();
    expect(results(r)).toHaveLength(1);
    expect(results(r)[0]).toMatchObject({ outcome: BreakthroughOutcome.Success, kind: 2 });
    expect(events(r)).toHaveLength(0);
    expect(r.node.major!.size).toBe(0);
  });

  it('a missed Thiên Mệnh roll: pity +1, no Kiếp, no tu vi loss, no lock', async () => {
    const r = await rig({ realm: 3, seed: seedFor(false, breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 })) });
    const exp0 = r.service.recordOf(r.id)!.exp;
    r.start();
    r.run(100);
    r.killShadow();
    r.run(100 + MAJOR_EVENT.DESTINY_PAUSE_MS + 300);
    expect(r.c.of('tribulation_strike')).toHaveLength(0);
    expect(results(r)[0]).toMatchObject({ outcome: BreakthroughOutcome.Failure, kind: 2, nFail: 1 });
    expect(lastEvent(r)).toMatchObject({
      phase: MajorPhase.Ended,
      result: MajorResult.RollFailed,
      tier: 0,
      expLostPct: 0,
      lockMin: 0,
    });
    const rec = r.service.recordOf(r.id)!;
    expect(rec).toMatchObject({ realm: 3, nFail: 1, exp: exp0 });
    expect(r.service.majorLockLeftMs(r.id, r.node.world.timeMs)).toBe(0);
  });

  it('a lost Tâm Ma (time runs out): no roll, no pity, 30 min lock, the shadow is gone, the roll stream untouched', async () => {
    const r = await rig({ realm: 3 });
    const rngBefore = JSON.stringify(r.service.rngState());
    r.start();
    r.run(100);
    const sid = r.shadowId();
    r.run(MAJOR_EVENT.TAM_MA_LIMIT_MS + 500);
    expect(results(r)[0]).toMatchObject({ outcome: BreakthroughOutcome.Failure, nFail: 0, chance: 0 });
    expect(lastEvent(r)).toMatchObject({ phase: MajorPhase.Ended, result: MajorResult.TamMaLost, lockMin: 30 });
    expect(r.node.world.entities.some((e) => e.id === sid)).toBe(false);
    expect(JSON.stringify(r.service.rngState())).toBe(rngBefore); // no roll happened
    // the lock refuses the next attempt
    r.run(4000);
    r.start('cd'.repeat(16));
    expect(results(r)[1]).toMatchObject({ outcome: BreakthroughOutcome.Rejected, reason: ProgressionReason.Locked });
  }, 30_000);

  it('dying in the Kiếp: consequence by waves survived (Nặng / Trung / Nhẹ), tu vi loss, pity +1, Nặng locks 24 h', async () => {
    const chance = breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 });
    const cases: Array<{ dieAtWave: number; tier: ConsequenceTier; loss: number; lockMin: number }> = [
      { dieAtWave: 1, tier: ConsequenceTier.Heavy, loss: 50, lockMin: 1440 },
      { dieAtWave: 2, tier: ConsequenceTier.Medium, loss: 25, lockMin: 0 },
      { dieAtWave: 3, tier: ConsequenceTier.Light, loss: 0, lockMin: 0 },
    ];
    for (const c of cases) {
      const r = await rig({ realm: 3, seed: seedFor(true, chance) });
      const exp0 = r.service.recordOf(r.id)!.exp;
      await toTribulation(r);
      // let the first (dieAtWave - 1) bolts hit, then leave the player with 1 HP so the next one kills
      const hitAt = (w: number) => MAJOR_EVENT.CLOUD_GATHER_MS + MAJOR_EVENT.BOLT_WARN_MS + (w - 1) * 8000;
      let t = 0;
      for (let w = 1; w <= c.dieAtWave; w++) {
        const until = hitAt(w) - 400;
        r.run(until - t);
        t = until;
        if (w === c.dieAtWave) r.setHp(1);
        else r.setHp(r.hpMax()); // keep the earlier waves survivable
        r.run(500);
        t += 500;
      }
      r.run(500);
      expect(results(r)).toHaveLength(1);
      expect(results(r)[0], `die at wave ${c.dieAtWave}`).toMatchObject({
        outcome: BreakthroughOutcome.Failure,
        nFail: 1,
      });
      expect(lastEvent(r)).toMatchObject({
        phase: MajorPhase.Ended,
        result: MajorResult.Died,
        tier: c.tier,
        expLostPct: c.loss,
        lockMin: c.lockMin,
        wave: c.dieAtWave - 1,
      });
      const rec = r.service.recordOf(r.id)!;
      expect(rec.exp).toBe(Math.floor(exp0 * (1 - c.loss / 100)));
      expect(rec.realm).toBe(3); // never drops a realm
      expect(r.service.majorLockLeftMs(r.id, r.node.world.timeMs) > 0).toBe(c.lockMin > 0);
    }
  }, 60_000);

  it('the Nặng lock is persisted (time left) and still refuses an attempt after a restart (new service + node, same store)', async () => {
    const chance = breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 });
    const r = await rig({ realm: 3, seed: seedFor(true, chance) });
    await toTribulation(r);
    r.setHp(1); // dies to the first bolt: Nặng
    r.run(MAJOR_EVENT.CLOUD_GATHER_MS + 3000);
    expect(lastEvent(r)).toMatchObject({ result: MajorResult.Died, tier: ConsequenceTier.Heavy });
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setImmediate(res));
    const stored = r.store.peek('acc')!;
    expect(stored.majorLockMs).toBeGreaterThan(24 * 3600_000 - 60_000);
    expect(stored.majorLockMs).toBeLessThanOrEqual(24 * 3600_000);
    // a restart: new service + node on the same store
    const service2 = new ProgressionService({ store: r.store, seed: 99 });
    const node2 = new WorldNode({
      seed: 7,
      mapTiles: 64,
      spawn: { i0: 30, j0: 30, side: 1 },
      combat: {},
      progression: service2,
    });
    const c2 = new Client();
    const id2 = node2.addPlayer(c2, 'acc');
    await new Promise<void>((res) => setImmediate(res));
    for (let k = 0; k < 80; k++) node2.tick();
    node2.receive(id2, encode({ type: 'breakthrough_start', requestId: 'ef'.repeat(16) }));
    expect(c2.of('breakthrough_result')[0]).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.Locked,
    });
    expect(service2.majorLockLeftMs(id2, node2.world.timeMs)).toBeGreaterThan(24 * 3600_000 - 120_000);
  }, 30_000);

  it('start conditions: nearly full HP is required, one event at a time, and leaving mid-event counts as losing it', async () => {
    const r = await rig({ realm: 3 });
    r.setHp(Math.floor(r.hpMax() * 0.5));
    r.start();
    expect(results(r)[0]).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.NotPrepared,
    });
    r.setHp(r.hpMax());
    r.run(3500); // the attempt cooldown of the refused one is not counted, but wait anyway
    r.start('11'.repeat(16));
    r.run(100);
    expect(events(r)).toHaveLength(1);
    r.start('22'.repeat(16)); // a second start while the event runs
    expect(results(r)[1]).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.EventActive,
    });
    const sid = r.shadowId();
    r.node.removePlayer(r.id, r.c); // leaves: Tâm Ma lost, outcome applied before the character is written
    expect(r.node.world.entities.some((e) => e.id === sid)).toBe(false);
    await new Promise<void>((res) => setImmediate(res));
    await new Promise<void>((res) => setImmediate(res));
    expect(r.store.peek('acc')!.majorLockMs).toBeGreaterThan(29 * 60_000);
    expect(r.store.peek('acc')!.nFail).toBe(0);
  });

  it('is deterministic: the same seed and the same inputs give the same messages, world and digests (full 3-bolt success run)', async () => {
    const chance = breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 });
    const seed = seedFor(true, chance);
    const play = async () => {
      const r = await rig({ realm: 3, seed });
      await toTribulation(r);
      r.run(MAJOR_EVENT.CLOUD_GATHER_MS + 17_200 + 500);
      const log = r.c.msgs.filter((m) => m.type !== 'snapshot' && m.type !== 'aoi_enter').map((m) => JSON.stringify(m));
      return {
        log,
        digest: r.node.major!.digest(),
        hp: r.me().hp,
        rng: JSON.stringify(r.service.rngState()),
        tick: r.node.world.tick,
      };
    };
    const a = await play();
    const b = await play();
    expect(a).toEqual(b);
    expect(a.log.some((l) => l.includes('"major_event"'))).toBe(true);
    // a different seed changes the roll (here: it fails) and with it the whole log
    const failSeed = seedFor(false, chance);
    const r2 = await rig({ realm: 3, seed: failSeed });
    r2.start();
    r2.run(100);
    r2.killShadow();
    r2.run(3000);
    expect(lastEvent(r2)).toMatchObject({ result: MajorResult.RollFailed });
  }, 60_000);
});

const node = (r: Rig): WorldNode => r.node;

describe('the Tâm Ma shadow belongs to its owner alone (D97)', () => {
  it('others cannot see, target, damage or be hit by it; its decals go to the owner only; mobs never aggro it; its attacks only ever target the owner', async () => {
    const store = new InMemoryProgressionStore();
    const rec = { ...newRecord('acc', ROOT), realm: 3, subRealm: maxSubStage(3), version: 1 };
    await store.save({ ...rec, exp: tuViRequired(rec) }, 0);
    const service = new ProgressionService({ store, seed: 3 });
    const n = new WorldNode({
      seed: 7,
      mapTiles: 64,
      spawn: { i0: 30, j0: 30, side: 1 },
      combat: {},
      mobs: { zones: [{ zone: 'bia_rung', i0: 24, j0: 24, i1: 40, j1: 40 }], density: 0.5 },
      progression: service,
    });
    const owner = new Client();
    const other = new Client();
    const ownerId = n.addPlayer(owner, 'acc');
    const otherId = n.addPlayer(other, 'other');
    await new Promise<void>((r) => setImmediate(r));
    for (let k = 0; k < 10; k++) n.tick();
    n.receive(ownerId, encode({ type: 'breakthrough_start', requestId: REQ }));
    for (let k = 0; k < 4; k++) n.tick();
    const shadowId = n.major!.shadowOf(ownerId);
    expect(shadowId).toBeGreaterThanOrEqual(SHADOW_ID_BASE);
    const ent = (id: number) => n.world.entities.find((e) => e.id === id)!;
    // the other player stands right next to the shadow
    n.world = {
      ...n.world,
      entities: n.world.entities.map((e) =>
        e.id === otherId ? { ...e, i: ent(shadowId).i + 1, j: ent(shadowId).j } : e,
      ),
    };
    for (let k = 0; k < 40; k++) n.tick(); // 2 s: AOI updates run
    const seen = (c: Client) =>
      c
        .of('aoi_enter')
        .flatMap((m) => m.entities)
        .some((e) => e.entityId === shadowId);
    expect(seen(owner)).toBe(true);
    expect(seen(other)).toBe(false); // invisible to everybody else
    // the owner's view of the shadow's attack decals; the other player gets none of them
    for (let k = 0; k < 100; k++) n.tick();
    expect(owner.of('telegraph_start').some((t) => t.mobEntityId === shadowId)).toBe(true);
    expect(other.of('telegraph_start').some((t) => t.mobEntityId === shadowId)).toBe(false);
    // the other player's skill aimed at the shadow does nothing; the owner's does
    const skill = compileSkills().find((c) => c.key === 'kiem_khi_tram')!;
    const hpBefore = ent(shadowId).hp;
    n.receive(otherId, encode({ type: 'skill_cast', seq: 1, skillId: skill.id, targetId: shadowId, aim: null }));
    for (let k = 0; k < 20; k++) n.tick();
    expect(ent(shadowId).hp).toBe(hpBefore);
    // no mob ever aggroed it: every mob's chase target is a player (or none)
    for (let k = 0; k < MOB_COUNT_PROBE; k++) {
      const info = n.mobs!.info(MOB_ID_BASE + k);
      if (info)
        expect(info.target === 0 || info.target < MOB_ID_BASE, `mob ${info.id} target ${info.target}`).toBe(true);
    }
    // and it is not drawn to the other player: the shadow never moved
    expect(Math.hypot(ent(shadowId).i - 33, ent(shadowId).j - 30)).toBeLessThan(10);
  }, 30_000);
});
const MOB_COUNT_PROBE = 400;

describe('only the owner can hurt the Tâm Ma shadow (D97)', () => {
  it('the owner real skill damages it, a bystander skill aimed at it does nothing', async () => {
    const r = await rig({ realm: 3 });
    const other = new Client();
    const otherId = r.node.addPlayer(other, 'other');
    r.start();
    r.run(200);
    const sid = r.shadowId();
    const ent = (id: number) => r.node.world.entities.find((e) => e.id === id)!;
    // the bystander stands beside it; the owner faces it (it appears on the owner's +i side)
    r.node.world = {
      ...r.node.world,
      entities: r.node.world.entities.map((e) =>
        e.id === otherId
          ? { ...e, i: ent(sid).i + 1, j: ent(sid).j, facing: 0 }
          : e.id === r.id
            ? { ...e, i: ent(sid).i - 1.5, j: ent(sid).j, facing: 0 } // within the skill's 2.5-tile reach
            : e,
      ),
    };
    const skill = compileSkills().find((c) => c.key === 'kiem_khi_tram')!;
    const hp0 = ent(sid).hp;
    r.node.receive(otherId, encode({ type: 'skill_cast', seq: 1, skillId: skill.id, targetId: sid, aim: null }));
    r.run(1000);
    expect(ent(sid).hp).toBe(hp0);
    r.node.receive(r.id, encode({ type: 'skill_cast', seq: 1, skillId: skill.id, targetId: sid, aim: null }));
    r.run(1000);
    expect(ent(sid).hp).toBeLessThan(hp0);
    // standing next to the shadow through several of its attacks never hurts the bystander (the owner alone is its target)
    r.node.world = {
      ...r.node.world,
      entities: r.node.world.entities.map((e) => (e.id === otherId ? { ...e, i: ent(sid).i + 0.5, j: ent(sid).j } : e)),
    };
    r.run(8000);
    expect(ent(otherId).hp).toBe(r.node.combat!.maxHpOf(otherId));
  }, 30_000);
});

describe('a held player gets the event state back when it resumes (D97)', () => {
  /** drop the connection, let `ms` of sim time pass, come back on a new transport; the node re-sends the state on the next tick */
  const dropAndResume = (r: Rig, ms: number): Client => {
    const token = r.node.resumeTokenOf(r.id)!;
    expect(r.node.suspendPlayer(r.id, r.c)).toBe(true);
    const seen = r.c.msgs.length;
    r.run(ms);
    expect(r.c.msgs.length).toBe(seen); // nothing reached the dead connection
    const back = new Client();
    expect(r.node.resumePlayer(r.id, token, back)).not.toBeNull();
    expect(back.of('major_event')).toHaveLength(0); // not before the client has handled the hello_ack
    r.run(100);
    return back;
  };

  it('mid Tâm Ma: the live phase, the time left and the shadow id', async () => {
    const r = await rig();
    r.start();
    r.run(200);
    const sid = r.shadowId();
    expect(sid).toBeGreaterThan(0);
    const back = dropAndResume(r, 20_000);
    const ev = back.of('major_event');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ phase: MajorPhase.TamMa, result: MajorResult.Running, tamMaId: sid });
    expect(ev[0]!.remainingMs).toBeGreaterThan(0);
    expect(ev[0]!.remainingMs).toBeLessThan(MAJOR_EVENT.TAM_MA_LIMIT_MS - 19_000);
  });

  it('the phase changed during the hold: the client gets the CURRENT phase', async () => {
    const r = await rig({ realm: 3, seed: seedFor(true, breakthroughSuccess({ realm: 3, karma: 0, nFail: 0 })) });
    r.start();
    r.run(100);
    r.killShadow();
    r.run(100);
    const token = r.node.resumeTokenOf(r.id)!;
    expect(r.node.suspendPlayer(r.id, r.c)).toBe(true);
    r.run(MAJOR_EVENT.DESTINY_PAUSE_MS + 400); // Thiên Mệnh rolls, the clouds start gathering
    const back = new Client();
    expect(r.node.resumePlayer(r.id, token, back)).not.toBeNull();
    r.run(100);
    const ev = back.of('major_event');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ phase: MajorPhase.Tribulation, result: MajorResult.Running, tamMaId: 0 });
  });

  it('the event ended during the hold: its final major_event and breakthrough_result are delivered at the resume', async () => {
    const r = await rig();
    r.start();
    r.run(200);
    const back = dropAndResume(r, MAJOR_EVENT.TAM_MA_LIMIT_MS + 2000); // the time runs out while held
    expect(r.node.major!.isActive(r.id)).toBe(false);
    expect(back.of('major_event').map((m) => m.result)).toContain(MajorResult.TamMaLost);
    expect(back.of('breakthrough_result')).toHaveLength(1);
  });

  it('nothing is queued when no event runs', async () => {
    const r = await rig();
    r.run(100);
    const back = dropAndResume(r, 1000);
    expect(back.of('major_event')).toHaveLength(0);
    expect(back.of('breakthrough_result')).toHaveLength(0);
  });
});
