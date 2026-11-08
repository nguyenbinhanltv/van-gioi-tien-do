import { describe, expect, it } from 'vitest';
import {
  BreakthroughOutcome,
  CHAR_FLAG,
  ProgressionReason,
  type ColdServerMessage,
  type MeditateResultMsg,
} from '@vgtd/protocol';
import {
  NETWORK,
  ROOT_TYPES,
  TOTAL_STAGES,
  minutesForStage,
  realmToStage,
  requiredCultivation,
  rngFloat,
  rngFork,
  rngSeed,
  totalHours,
  match,
  speedFactor,
  rootType,
} from '@vgtd/shared';
import {
  InMemoryProgressionStore,
  InMemoryRollLog,
  PROGRESSION_CONFIG,
  ProgressionService,
  advanceTuVi,
  applyBreakthrough,
  meditationRate,
  newRecord,
  planBreakthrough,
  rollSpiritRoot,
  rootWeights,
  stageOf,
  type MeditationEnv,
  type ProgressRecord,
  type ProgressionOptions,
  type SpiritRoot,
} from '../src/index.js';

const TICK = NETWORK.TICK_MS;
const flush = () => new Promise<void>((r) => setImmediate(r));
const hex = (n: number) => n.toString(16).padStart(32, '0');
const TAP_TAM: SpiritRoot = { type: 'tap_tam', elements: ['kim', 'moc', 'thuy'], mutation: null };
const DON_MOC: SpiritRoot = { type: 'don', elements: ['moc'], mutation: null };
const POISON_FOREST: MeditationEnv = { rho: 1, land: { moc: 0.5, thuy: 0.3, hoa: 0.2 } };

function record(patch: Partial<ProgressRecord> = {}, root: SpiritRoot = TAP_TAM): ProgressRecord {
  return { ...newRecord('acc1', root), ...patch };
}
interface Rig {
  svc: ProgressionService;
  store: InMemoryProgressionStore;
  log: InMemoryRollLog;
  now: number;
  out: ColdServerMessage[];
  run(ticks: number): void;
  cmd(msg: Parameters<ProgressionService['handle']>[1]): ColdServerMessage[];
}
async function rig(patch?: Partial<ProgressRecord>, opts: ProgressionOptions = {}, root?: SpiritRoot): Promise<Rig> {
  const store = new InMemoryProgressionStore();
  const log = new InMemoryRollLog();
  if (patch) await store.save({ ...record(patch, root), version: 1 }, 0);
  const svc = new ProgressionService({ store, rollLog: log, seed: 1, ...opts });
  svc.join(1, 'acc1', 0);
  await flush();
  const r: Rig = {
    svc,
    store,
    log,
    now: 10_000,
    out: [],
    run(ticks) {
      for (let k = 0; k < ticks; k++) {
        r.now += TICK;
        r.out.push(...svc.tick(r.now, TICK).map((o) => o.msg));
      }
    },
    cmd(msg) {
      return svc.handle(1, msg, r.now).map((o) => o.msg);
    },
  };
  r.run(1); // delivers the first char_state
  return r;
}
const meditate = (id: number) => ({ type: 'meditate_start' as const, requestId: hex(id) });
const stop = (id: number) => ({ type: 'meditate_stop' as const, requestId: hex(id) });
const bt = (id: number) => ({ type: 'breakthrough_start' as const, requestId: hex(id) });
const result = <T extends ColdServerMessage['type']>(msgs: ColdServerMessage[], type: T) =>
  msgs.filter((m): m is Extract<ColdServerMessage, { type: T }> => m.type === type);

describe('tu vi accumulation (docs/07 §5 golden numbers)', () => {
  it('Absorb(1) = 100 x P_n x sqrt(Match) per minute; Req(1) = 1000 = 10 minutes for a Tạp Tam at Match 1', () => {
    const r = record();
    expect(meditationRate(r, { rho: 1, land: { kim: 0.2, moc: 0.2, thuy: 0.2, hoa: 0.2, tho: 0.2 } })).toBeCloseTo(
      100,
      10,
    );
    expect(requiredCultivation(1)).toBe(1000);
  });
  it.each([
    ['Đơn Mộc', DON_MOC, 2.53, 18.5],
    [
      'Tạp Ngũ',
      { type: 'tap_ngu', elements: ['kim', 'moc', 'thuy', 'hoa', 'tho'], mutation: null } as SpiritRoot,
      0.7,
      67,
    ],
    ['Đơn Kim', { type: 'don', elements: ['kim'], mutation: null } as SpiritRoot, 0.51, 92],
  ])(
    '%s at Bí Cảnh Rừng Độc: speed factor %s, ~%s h for all 41 stages (docs/07 §5 table)',
    (_n, root, factor, hours) => {
      const w = rootWeights(root);
      const m = match(w, POISON_FOREST.land);
      expect(speedFactor(rootType(root.type).purity, m)).toBeCloseTo(factor, 2);
      // chain every stage through the server's own rate function
      let minutes = 0;
      for (let s = 1; s <= TOTAL_STAGES; s++) {
        const stageRecord = { ...record({}, root), realm: 1, subRealm: 1 };
        const at = stageToPosition(s);
        const rec = { ...stageRecord, ...at };
        minutes += requiredCultivation(s) / meditationRate(rec, POISON_FOREST);
      }
      expect(minutes / 60).toBeCloseTo(totalHours(1, rootType(root.type).purity, m), 9);
      expect(minutes / 60).toBeGreaterThan(hours - 0.6);
      expect(minutes / 60).toBeLessThan(hours + 0.6);
    },
  );
  it('20 Hz ticking reaches Req(1) at the analytic time (Đơn Mộc at the poison forest: 3.95 minutes)', async () => {
    const x = await rig({ spiritRoot: DON_MOC }, { env: () => POISON_FOREST });
    expect(result(x.cmd(meditate(1)), 'meditate_result')[0]).toMatchObject({
      meditating: true,
      reason: ProgressionReason.Ok,
    });
    const started = x.now;
    let ticks = 0;
    while (x.svc.isMeditating(1) && ticks < 20_000) {
      x.run(1);
      ticks++;
    }
    const minutes = (ticks * TICK) / 60_000;
    expect(Math.abs(minutes - minutesForStage(1, 1, 1.6, 2.5))).toBeLessThan(TICK / 60_000 + 1e-9);
    expect(x.now - started).toBe(ticks * TICK);
    const last = result(x.out, 'char_state').at(-1)!;
    expect(last.tuVi).toBe(1000);
    expect(last.flags & CHAR_FLAG.BREAKTHROUGH_READY).toBeTruthy();
    expect(last.flags & CHAR_FLAG.MEDITATING).toBe(0);
  });
  it('tu vi never exceeds Req(s) and advanceTuVi is exact and pure', () => {
    const r = record({ exp: 990 });
    const env = { rho: 1, land: { kim: 0.2, moc: 0.2, thuy: 0.2, hoa: 0.2, tho: 0.2 } };
    expect(advanceTuVi(r, 6000, env)).toEqual({ exp: 1000, full: true });
    expect(advanceTuVi(r, 3000, env).exp).toBeCloseTo(995, 10);
    expect(r.exp).toBe(990);
  });
  it('progress is pushed about once a second, not every tick', async () => {
    const x = await rig({}, {});
    x.cmd(meditate(1));
    const before = result(x.out, 'char_state').length;
    x.run(100); // 5 s
    const n = result(x.out, 'char_state').length - before;
    expect(n).toBeGreaterThanOrEqual(4);
    expect(n).toBeLessThanOrEqual(7);
  });
});

function stageToPosition(s: number): { realm: number; subRealm: number } {
  for (let realm = 1; realm <= 9; realm++)
    for (let k = 1; k <= (realm === 1 ? 9 : 4); k++) if (realmToStage(realm, k) === s) return { realm, subRealm: k };
  throw new Error(`no position for stage ${s}`);
}

describe('breakthrough rates (docs/07 §2)', () => {
  it('minor: 0.90 Luyện Khí / 0.85 others; major: Base_r, pity +8% per failure (cap +40%), karma penalty', () => {
    expect(planBreakthrough(record())).toMatchObject({ kind: 'minor', chance: 0.9, fromStage: 1, toStage: 2 });
    expect(planBreakthrough(record({ realm: 2, subRealm: 2 }))).toMatchObject({ kind: 'minor', chance: 0.85 });
    expect(planBreakthrough(record({ realm: 1, subRealm: 9 }))).toMatchObject({
      kind: 'major',
      chance: 0.7,
      toStage: 10,
    });
    // Kim Đan -> Nguyên Anh, 2 failures, karma -400: 0.45 + 0.16 - 0.08 = 0.53
    expect(planBreakthrough(record({ realm: 3, subRealm: 4, nFail: 2, karma: -400 }))!.chance).toBeCloseTo(0.53, 12);
    // pity caps at +40% (5 failures): Base 0.45 + 0.40
    expect(planBreakthrough(record({ realm: 3, subRealm: 4, nFail: 9 }))!.chance).toBeCloseTo(0.85, 12);
    // karma halved on minor
    expect(planBreakthrough(record({ karma: -800 }))!.chance).toBeCloseTo(0.9 - 0.5 * 0.16, 12);
    expect(planBreakthrough(record({ realm: 9, subRealm: 4 }))).toBeNull();
  });
  it('success moves up one stage and resets tu vi; failure never drops the realm and only majors feed the pity counter', () => {
    const major = record({ realm: 1, subRealm: 9, exp: 5000 });
    const plan = planBreakthrough(major)!;
    const ok = applyBreakthrough({ ...major, nFail: 3 }, plan, true);
    expect([ok.realm, ok.subRealm, ok.exp, ok.nFail, stageOf(ok)]).toEqual([2, 1, 0, 0, 10]);
    const bad = applyBreakthrough(major, plan, false);
    expect([bad.realm, bad.subRealm, bad.exp, bad.nFail]).toEqual([1, 9, 5000, 1]);
    const minor = record({ exp: 1200 });
    const minorFail = applyBreakthrough(minor, planBreakthrough(minor)!, false);
    expect([minorFail.subRealm, minorFail.nFail, minorFail.exp]).toEqual([1, 0, 1200]);
  });
});

describe('spirit root creation roll', () => {
  it('is deterministic per seed and follows docs/07 §5 weights', () => {
    const roll = (seed: number) => rollSpiritRoot(rngFork(rngSeed(seed), 'root'))[0];
    expect(roll(5)).toEqual(roll(5));
    let rng = rngSeed(2026);
    const counts: Record<string, number> = {};
    let mutated = 0;
    const n = 30_000;
    for (let k = 0; k < n; k++) {
      let root: SpiritRoot;
      [root, rng] = rollSpiritRoot(rng);
      counts[root.type] = (counts[root.type] ?? 0) + 1;
      if (root.mutation) mutated++;
      expect(new Set(root.elements).size).toBe(root.elements.length);
      expect(root.elements.length).toBe(ROOT_TYPES.find((t) => t.id === root.type)!.elementCount);
    }
    for (const t of ROOT_TYPES) expect((counts[t.id] ?? 0) / n).toBeCloseTo(t.spawnWeight, 1);
    // 2% mutation roll x the chance the picked element has a mutated form (Mộc, Kim, Thủy) ~ 1.2%
    expect(mutated / n).toBeGreaterThan(0.006);
    expect(mutated / n).toBeLessThan(0.02);
  });
});

describe('server authority and anti-abuse', () => {
  it('a new character gets a seeded root, stage 1 and a char_state', async () => {
    const x = await rig();
    const s = x.svc.stateOf(1)!;
    expect(s).toMatchObject({ type: 'char_state', stage: 1, tuVi: 0, tuViReq: 1000, nFail: 0, karma: 0 });
    expect(result(x.out, 'char_state')[0]).toEqual(s);
    expect(x.store.peek('acc1')).toBeDefined();
  });
  it('commands before the profile is loaded answer NotReady', () => {
    const svc = new ProgressionService({ seed: 1 });
    svc.join(1, 'acc1', 0); // load not flushed yet
    const [out] = svc.handle(1, meditate(1), 0);
    expect(out!.msg).toMatchObject({ type: 'meditate_result', meditating: false, reason: ProgressionReason.NotReady });
  });
  it('meditation is refused while moving (input within the grace window) and allowed once still', async () => {
    const x = await rig();
    x.svc.onInput(1, 5, x.now);
    expect(result(x.cmd(meditate(1)), 'meditate_result')[0]).toMatchObject({
      meditating: false,
      reason: ProgressionReason.Moving,
    });
    x.run(PROGRESSION_CONFIG.MOVE_GRACE_MS / TICK + 1);
    expect(result(x.cmd(meditate(2)), 'meditate_result')[0]).toMatchObject({
      meditating: true,
      reason: ProgressionReason.Ok,
    });
    // zero-magnitude inputs (idle) neither block nor interrupt
    x.svc.onInput(1, 0, x.now);
    expect(x.svc.isMeditating(1)).toBe(true);
  });
  it('moving while meditating interrupts it at once and stops the accumulation', async () => {
    const x = await rig();
    x.cmd(meditate(1));
    x.run(40);
    const gained = x.svc.recordOf(1)!.exp;
    expect(gained).toBeGreaterThan(0);
    x.svc.onInput(1, 8, x.now);
    expect(x.svc.isMeditating(1)).toBe(false);
    x.run(40);
    expect(x.svc.recordOf(1)!.exp).toBe(gained);
    const last = result(x.out, 'char_state').at(-1)!;
    expect(last.flags & CHAR_FLAG.MEDITATING).toBe(0);
  });
  it('meditation is refused during combat (cast or hit) for the lock window and interrupted by it', async () => {
    const x = await rig();
    x.svc.onCombat(1, x.now);
    expect(result(x.cmd(meditate(1)), 'meditate_result')[0]).toMatchObject({ reason: ProgressionReason.InCombat });
    x.run(PROGRESSION_CONFIG.COMBAT_LOCK_MS / TICK - 2);
    expect(result(x.cmd(meditate(2)), 'meditate_result')[0]!.reason).toBe(ProgressionReason.InCombat);
    x.run(4);
    expect(result(x.cmd(meditate(3)), 'meditate_result')[0]).toMatchObject({
      meditating: true,
      reason: ProgressionReason.Ok,
    });
    x.svc.onCombat(1, x.now);
    expect(x.svc.isMeditating(1)).toBe(false);
  });
  it('a dead character cannot meditate or break through, and death ends meditation', async () => {
    let alive = true;
    const x = await rig({ exp: 1000 }, { isAlive: () => alive });
    x.cmd(meditate(1));
    alive = false;
    expect(result(x.cmd(meditate(2)), 'meditate_result')[0]!.reason).toBe(ProgressionReason.Dead);
    expect(result(x.cmd(bt(3)), 'breakthrough_result')[0]).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.Dead,
    });
    const y = await rig({}, { isAlive: () => alive });
    alive = true;
    y.cmd(meditate(1));
    alive = false;
    y.run(1);
    expect(y.svc.isMeditating(1)).toBe(false);
  });
  it('rate limit: a burst beyond the token bucket is refused, then refills', async () => {
    const x = await rig();
    const replies: MeditateResultMsg[] = [];
    for (let k = 1; k <= PROGRESSION_CONFIG.CMD_BUCKET + 3; k++)
      replies.push(result(x.cmd(stop(k)), 'meditate_result')[0]!);
    const limited = replies.filter((m) => m.reason === ProgressionReason.RateLimited);
    expect(limited).toHaveLength(3);
    expect(replies.slice(0, PROGRESSION_CONFIG.CMD_BUCKET).every((m) => m.reason === ProgressionReason.Ok)).toBe(true);
    x.run((PROGRESSION_CONFIG.CMD_REFILL_MS * 2) / TICK);
    expect(result(x.cmd(stop(99)), 'meditate_result')[0]!.reason).toBe(ProgressionReason.Ok);
    expect(x.svc.metrics.rejected[ProgressionReason.RateLimited]).toBe(3);
  });
  it('commands from an unknown entity are ignored (the character comes from the authenticated connection only)', async () => {
    const x = await rig();
    expect(x.svc.handle(42, meditate(1), x.now)).toEqual([]);
  });
  it('start/stop are idempotent and meditation with a full stage refuses nothing but stays idle', async () => {
    const x = await rig();
    x.cmd(meditate(1));
    expect(result(x.cmd(meditate(2)), 'meditate_result')[0]).toMatchObject({
      meditating: true,
      reason: ProgressionReason.Ok,
    });
    expect(result(x.cmd(stop(3)), 'meditate_result')[0]).toMatchObject({
      meditating: false,
      reason: ProgressionReason.Ok,
    });
    expect(result(x.cmd(stop(4)), 'meditate_result')[0]).toMatchObject({
      meditating: false,
      reason: ProgressionReason.Ok,
    });
    const full = await rig({ exp: 1000 });
    expect(result(full.cmd(meditate(1)), 'meditate_result')[0]).toMatchObject({
      meditating: false,
      reason: ProgressionReason.Ok,
    });
  });
});

// A seed whose first breakthrough draw fails a 0.9 / 0.7 chance and one that succeeds (searched, not hard-coded).
const firstDraw = (seed: number) => rngFloat(rngFork(rngSeed(seed), 'breakthrough'))[0];
const FAIL_SEED = Array.from({ length: 200 }, (_, k) => k + 1).find((s) => firstDraw(s) > 0.95)!;
const WIN_SEED = Array.from({ length: 200 }, (_, k) => k + 1).find((s) => firstDraw(s) < 0.3)!;

describe('breakthrough attempts', () => {
  it('needs enough tu vi and is rejected without rolling', async () => {
    const x = await rig({ exp: 999 });
    const r = result(x.cmd(bt(1)), 'breakthrough_result')[0]!;
    expect(r).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.NotEnoughTuVi,
      chance: 0,
    });
    expect(x.log.entries).toHaveLength(0);
  });
  it('rolls with the seeded stream: draw < chance succeeds, the roll is logged, tu vi resets on success', async () => {
    const win = await rig({ exp: 1000 }, { seed: WIN_SEED });
    const replies = win.cmd(bt(1));
    const r = result(replies, 'breakthrough_result')[0]!;
    expect(r).toMatchObject({ outcome: BreakthroughOutcome.Success, kind: 1, fromStage: 1, toStage: 2, chance: 9000 });
    expect(win.log.entries).toEqual([
      expect.objectContaining({
        stream: 'breakthrough',
        characterId: 'acc1',
        kind: 'minor',
        chance: 0.9,
        success: true,
        draw: firstDraw(WIN_SEED),
      }),
    ]);
    expect(win.svc.recordOf(1)).toMatchObject({ realm: 1, subRealm: 2, exp: 0 });
    // the new state rides right behind the answer
    expect(result(replies, 'char_state').at(-1)).toMatchObject({ stage: 2, tuVi: 0, tuViReq: requiredCultivation(2) });

    const lose = await rig({ exp: 1000 }, { seed: FAIL_SEED });
    const f = result(lose.cmd(bt(1)), 'breakthrough_result')[0]!;
    expect(f).toMatchObject({ outcome: BreakthroughOutcome.Failure, fromStage: 1, toStage: 1, nFail: 0 });
    expect(lose.svc.recordOf(1)).toMatchObject({ realm: 1, subRealm: 1, exp: 1000 });
  });
  it('a major failure raises the pity counter and the next chance (0.70 -> 0.78)', async () => {
    const x = await rig({ realm: 1, subRealm: 9, exp: requiredCultivation(9) }, { seed: FAIL_SEED });
    const first = result(x.cmd(bt(1)), 'breakthrough_result')[0]!;
    expect([first.kind, first.chance, first.nFail, first.outcome]).toEqual([2, 7000, 1, BreakthroughOutcome.Failure]);
    expect(x.svc.stateOf(1)).toMatchObject({ nFail: 1, stage: 9 });
    x.run(PROGRESSION_CONFIG.BREAKTHROUGH_COOLDOWN_MS / TICK + 1);
    const second = result(x.cmd(bt(2)), 'breakthrough_result')[0]!;
    expect(second).toMatchObject({ kind: 2, chance: 7800 });
    expect(x.log.entries.map((e) => e.nFailBefore)).toEqual([0, 1]);
    expect(x.log.entries[0]!.chance).toBeCloseTo(0.7, 12);
    expect(x.log.entries[1]!.chance).toBeCloseTo(0.78, 12);
  });
  it('a re-sent requestId returns the stored result without rolling again', async () => {
    const x = await rig({ exp: 1000 }, { seed: WIN_SEED });
    const a = result(x.cmd(bt(7)), 'breakthrough_result')[0]!;
    const rngAfter = x.svc.rngState();
    const b = result(x.cmd(bt(7)), 'breakthrough_result')[0]!;
    expect(b).toEqual(a);
    expect(x.log.entries).toHaveLength(1);
    expect(x.svc.rngState()).toEqual(rngAfter);
  });
  it('attempts are rate limited by a cooldown (new requestId inside the window is refused)', async () => {
    const x = await rig({ exp: 1000 }, { seed: FAIL_SEED });
    x.cmd(bt(1));
    const r = result(x.cmd(bt(2)), 'breakthrough_result')[0]!;
    expect(r).toMatchObject({ outcome: BreakthroughOutcome.Rejected, reason: ProgressionReason.Cooldown });
    expect(x.log.entries).toHaveLength(1);
  });
  it('is refused while moving or in combat, stops meditation when it starts, and the last stage cannot advance', async () => {
    const x = await rig({ exp: 1000 }, { seed: WIN_SEED });
    x.svc.onInput(1, 9, x.now);
    expect(result(x.cmd(bt(1)), 'breakthrough_result')[0]!.reason).toBe(ProgressionReason.Moving);
    x.svc.onCombat(1, x.now);
    x.run(PROGRESSION_CONFIG.COMBAT_LOCK_MS / TICK + 1);
    const z = await rig({ exp: 500 });
    z.cmd(meditate(1));
    expect(z.svc.isMeditating(1)).toBe(true);
    const top = await rig({ realm: 9, subRealm: 4, exp: requiredCultivation(TOTAL_STAGES) });
    expect(result(top.cmd(bt(1)), 'breakthrough_result')[0]).toMatchObject({
      outcome: BreakthroughOutcome.Rejected,
      reason: ProgressionReason.AtMaxStage,
    });
  });
});

describe('stage-change hook (combat re-derives stats from realm / sub-stage)', () => {
  it('fires once when the profile loads and after each successful breakthrough, not after a failure', async () => {
    const calls: number[][] = [];
    const win = await rig({ exp: 1000 }, { seed: WIN_SEED, onStageChange: (id, r, k) => calls.push([id, r, k]) });
    expect(calls).toEqual([[1, 1, 1]]);
    win.cmd(bt(1));
    expect(calls).toEqual([
      [1, 1, 1],
      [1, 1, 2],
    ]);
    const calls2: number[][] = [];
    const lose = await rig({ exp: 1000 }, { seed: FAIL_SEED, onStageChange: (id, r, k) => calls2.push([id, r, k]) });
    lose.cmd(bt(1));
    expect(calls2).toEqual([[1, 1, 1]]);
  });
});

describe('determinism and persistence', () => {
  async function script(seed: number): Promise<{ out: string; store: unknown; draws: number[] }> {
    const x = await rig({ exp: 1000 }, { seed });
    const trace: ColdServerMessage[] = [];
    let id = 1;
    for (let k = 0; k < 12; k++) {
      trace.push(...x.cmd(bt(id++)));
      x.cmd(meditate(id++));
      x.run(600);
      trace.push(...x.cmd(bt(id++)));
      x.run(100);
    }
    trace.push(...x.out);
    await x.svc.leave(1);
    return { out: JSON.stringify(trace), store: x.store.peek('acc1'), draws: x.log.entries.map((e) => e.draw) };
  }
  it('the same seed and the same inputs give identical messages, rolls and stored state', async () => {
    const a = await script(11);
    const b = await script(11);
    expect(b).toEqual(a);
    const c = await script(12);
    expect(c.draws).not.toEqual(a.draws);
  });
  it('leave writes the record; rejoin restores stage and tu vi; the version follows every write', async () => {
    const x = await rig({}, {});
    x.cmd(meditate(1));
    x.run(200);
    const exp = x.svc.recordOf(1)!.exp;
    await x.svc.leave(1);
    const stored = x.store.peek('acc1')!;
    expect(stored.exp).toBeCloseTo(exp, 9);
    expect(stored.version).toBeGreaterThan(1);
    x.svc.join(2, 'acc1', x.now);
    await flush();
    expect(x.svc.recordOf(2)).toMatchObject({ realm: 1, subRealm: 1, version: stored.version });
    expect(x.svc.recordOf(2)!.exp).toBeCloseTo(exp, 9);
    expect(x.svc.recordOf(2)!.spiritRoot).toEqual(stored.spiritRoot);
  });
  it('the store rejects a stale write (optimistic concurrency) and the service counts the conflict', async () => {
    const store = new InMemoryProgressionStore();
    const rec = { ...record(), version: 1 };
    expect(await store.save(rec, 0)).toBe(true);
    expect(await store.save({ ...rec, version: 2 }, 0)).toBe(false);
    expect(await store.save({ ...rec, version: 2 }, 1)).toBe(true);
    const x = await rig({ exp: 100 });
    await store.save({ ...x.store.peek('acc1')!, version: 99 }, x.store.peek('acc1')!.version).catch(() => undefined);
    x.cmd(meditate(1));
    x.run(20);
    // another writer bumps the stored version behind the service's back
    const stored = x.store.peek('acc1')!;
    await x.store.save({ ...stored, version: stored.version + 5 }, stored.version);
    x.cmd(stop(2));
    await flush();
    expect(x.svc.metrics.saveConflicts).toBeGreaterThan(0);
  });
  it('autosave writes dirty records at most every AUTOSAVE_MS', async () => {
    const x = await rig();
    x.cmd(meditate(1));
    x.cmd(stop(2)); // explicit writes aside, count autosaves while meditating
    x.cmd(meditate(3));
    const before = x.store.writes;
    x.run(Math.floor(PROGRESSION_CONFIG.AUTOSAVE_MS / TICK) * 2 + 2);
    await flush();
    expect(x.store.writes - before).toBeLessThanOrEqual(3);
    expect(x.store.writes - before).toBeGreaterThanOrEqual(1);
  });
});
