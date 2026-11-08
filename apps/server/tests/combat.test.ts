import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULES,
  NETWORK,
  damageBreakdown,
  resolveDrops,
  rngFloat,
  rngFork,
  rngSeed,
  skillDefinitions,
  skillsOf,
  type DropRoll,
  type PathId,
  type SkillDef,
} from '@vgtd/shared';
import { ErrorCode, decode, encode, type BaselinePos, type Message } from '@vgtd/protocol';
import {
  CastReason,
  TileGrid,
  compileSkills,
  createWorld,
  spawnEntity,
  stateHash,
  step,
  type EntityState,
  type SimContext,
  type SimEvent,
  type SimInput,
  type SimWorld,
} from '@vgtd/sim';
import {
  CombatSystem,
  HIT_FLAG_CRIT,
  HIT_FLAG_KILL,
  MobManager,
  WorldNode,
  defaultMobZones,
  inShape,
  isMobId,
  makeProfile,
  resolveCast,
  skillElement,
  InMemoryProgressionStore,
  ProgressionService,
  newRecord,
  type ClientTransport,
  type CombatEvent,
  type CombatResult,
  type MobCombatStats,
  type MobPort,
  type ResolveTarget,
} from '../src/index.js';

// ---------------------------------------------------------------------------------------------------- helpers
const MOB = 1_000_001;
const dataSkill = (id: string): SkillDef => skillDefinitions.skills.find((s) => s.id === id)!;

class FakeMobs implements MobPort {
  killed: number[] = [];
  constructor(readonly stats = new Map<number, MobCombatStats>()) {}
  combatStats(id: number): MobCombatStats | undefined {
    return this.killed.includes(id) ? undefined : this.stats.get(id);
  }
  kill(world: SimWorld, id: number): SimWorld {
    this.killed.push(id);
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }
}

const mobStats = (over: Partial<MobCombatStats> = {}): MobCombatStats => ({
  defense: 40,
  realm: 1,
  element: 'moc',
  dropSource: 'field',
  hpMax: 3000,
  ...over,
});

interface Rig {
  ctx: SimContext;
  combat: CombatSystem;
  mobs: FakeMobs;
  world: SimWorld;
  results: CombatResult[];
  events: CombatEvent[];
  simEvents: SimEvent[];
  drops: DropRoll[][];
  seq: number;
  tick(inputs?: SimInput[]): void;
  run(ms: number, inputs?: SimInput[]): void;
  cast(skillKey: string, targetId?: number, id?: number, aim?: { i: number; j: number } | null): SimInput;
}

function rig(
  o: {
    path?: PathId;
    seed?: number;
    rows?: string[];
    mobs?: Array<{ id?: number; i: number; j: number; hp?: number; stats?: Partial<MobCombatStats> }>;
    player?: { i: number; j: number; facing?: number };
  } = {},
): Rig {
  const rows = o.rows ?? Array.from({ length: 64 }, () => '.'.repeat(64));
  const ctx: SimContext = { grid: TileGrid.fromRows(rows), skills: compileSkills() };
  const mobs = new FakeMobs();
  const drops: DropRoll[][] = [];
  const combat = new CombatSystem(ctx, {
    seed: o.seed ?? 1,
    mobs,
    onDrops: (d) => drops.push([...d.rolls]),
    respawnPoint: () => ({ i: 5.5, j: 5.5 }),
  });
  let world = createWorld(o.seed ?? 1);
  const st = combat.addPlayer(1, o.path ?? 'kiem');
  world = spawnEntity(world, {
    id: 1,
    i: o.player?.i ?? 20.5,
    j: o.player?.j ?? 20.5,
    hp: st.hpMax,
    mpMax: st.mpMax,
    facing: o.player?.facing ?? 0,
  });
  for (const m of o.mobs ?? []) {
    const id = m.id ?? MOB;
    const s = mobStats(m.stats);
    mobs.stats.set(id, s);
    world = spawnEntity(world, { id, i: m.i, j: m.j, hp: m.hp ?? s.hpMax, mpMax: 0 });
  }
  const r: Rig = {
    ctx,
    combat,
    mobs,
    world,
    results: [],
    events: [],
    simEvents: [],
    drops,
    seq: 0,
    tick(inputs = []) {
      const pre = combat.preStep(inputs, r.world);
      r.results.push(...pre.results);
      const s = step(r.world, pre.inputs, ctx, NETWORK.TICK_MS);
      r.simEvents.push(...s.events);
      const post = combat.postStep(s.world, s.events);
      r.world = post.world;
      r.results.push(...post.results);
      r.events.push(...post.events);
    },
    run(ms, inputs = []) {
      const n = Math.round(ms / NETWORK.TICK_MS);
      for (let k = 0; k < n; k++) r.tick(k === 0 ? inputs : []);
    },
    cast(skillKey, targetId = 0, id = 1, aim = null) {
      const skillId = ctx.skills.find((s) => s.key === skillKey)!.id;
      return { kind: 'cast', entityId: id, seq: ++r.seq, skillId, targetId, rttMs: 0, aim } as SimInput;
    },
  };
  return r;
}

const entity = (r: Rig, id: number): EntityState | undefined => r.world.entities.find((e) => e.id === id);
const rejected = (r: Rig): CastReason[] => r.simEvents.flatMap((e) => (e.type === 'cast_rejected' ? [e.reason] : []));

// ---------------------------------------------------------------------------------------------------- golden numbers
describe('damage: golden numbers from docs/07 §4', () => {
  // docs/07 examples have no passives: base 5% crit, no armour penetration
  const profile = { ...makeProfile('kiem'), realm: 1, critChance: COMBAT_RULES.BASE_CRIT_CHANCE, pen: 0 };
  profile.stats = { ...profile.stats, atk: 563 }; // docs/07 worked example: Hóa Thần sơ kỳ ATK 563
  const probe = (element: string, defElement: ResolveTarget['element'], rand: () => number) => {
    const skill = {
      ...dataSkill('kiem_khi_tram'),
      element,
      shape: { type: 'single' as const },
      effects: [
        { type: 'damage' as const, applies_to: 'enemy' as const, scale: { stat: 'atk' as const, coeff: 1 }, hits: 1 },
      ],
    };
    const enemy: ResolveTarget = { id: MOB, i: 1, j: 0, hpMax: 9999, defense: 350, realm: 1, element: defElement };
    return resolveCast({
      casterId: 1,
      caster: { i: 0, j: 0 },
      facing: 0,
      profile,
      skill,
      targetId: MOB,
      enemies: [enemy],
      rand,
    });
  };
  const flat = () => 0.5; // no crit (0.5 >= 5%), jitter exactly 1.0

  it('neutral: 563^2 / (563 + 350) = 347', () => {
    expect(probe('none', 'kim', flat).hits[0]!.damage).toBe(347);
  });
  it('Hỏa vs Kim (khắc): 460, Hỏa vs Thủy (bị khắc): 295', () => {
    expect(probe('hoa', 'kim', flat).hits[0]!.damage).toBe(460);
    expect(probe('hoa', 'thuy', flat).hits[0]!.damage).toBe(295);
  });
  it('crit multiplies by 1.5 and sets the crit flag; draw order is crit then jitter', () => {
    const seq = [0.0, 0.5];
    let k = 0;
    const out = probe('none', 'kim', () => seq[k++]!);
    expect(out.hits[0]).toMatchObject({ damage: 521, crit: true }); // 347.18 x 1.5
    expect(k).toBe(2);
  });
  it('jitter spans U(0.95, 1.05): rand 0 -> 330, rand 1 -> 365', () => {
    const jit = (j: number) => {
      const seq = [0.9, j]; // 0.9 = no crit
      let k = 0;
      return probe('none', 'kim', () => seq[k++]!).hits[0]!.damage;
    };
    expect(jit(0)).toBe(330);
    expect(jit(0.999999)).toBe(365);
  });
  it('a real kit skill equals the shared formula with its own data (root_main = class element, passive pen and crit)', () => {
    const p = makeProfile('kiem');
    expect(p.critChance).toBeCloseTo(COMBAT_RULES.BASE_CRIT_CHANCE + 0.05, 10); // Kiếm Tâm +5% crit
    expect(p.pen).toBeCloseTo(0.06, 10); // Kiếm Tâm pen
    const skill = dataSkill('kiem_khi_tram');
    expect(skillElement(skill, p)).toBe('kim');
    const enemy: ResolveTarget = { id: MOB, i: 1, j: 0, hpMax: 3000, defense: 40, realm: 1, element: 'moc' };
    const out = resolveCast({
      casterId: 1,
      caster: { i: 0, j: 0 },
      facing: 0,
      profile: p,
      skill,
      targetId: 0,
      enemies: [enemy],
      rand: () => 0.5,
    });
    const expected = Math.round(
      damageBreakdown({
        atk: p.stats.atk,
        def: 40,
        cSkill: 1.3,
        attackerElement: 'kim',
        defenderElement: 'moc',
        pen: p.pen,
        attackerRealm: 1,
        defenderRealm: 1,
        rand: 0.5,
      }).damage,
    );
    expect(out.hits).toEqual([{ targetId: MOB, damage: expected, crit: false }]);
    expect(expected).toBe(Math.round(((p.stats.atk * 1.3) ** 2 / (p.stats.atk * 1.3 + 40 * 0.85 * (1 - 0.06))) * 1.25));
  });
});

// ---------------------------------------------------------------------------------------------------- shapes
describe('skill shapes (target selection)', () => {
  const origin = { i: 10, j: 10 };
  it('cone: radius, half angle and facing (code 0 = +i, 64 = +j)', () => {
    const cone = { type: 'cone' as const, anchor: 'caster' as const, radius: 3.5, angle_deg: 120 };
    expect(inShape(cone, origin, 0, origin, { i: 13, j: 10 })).toBe(true);
    expect(inShape(cone, origin, 0, origin, { i: 14, j: 10 })).toBe(false); // beyond radius
    expect(inShape(cone, origin, 0, origin, { i: 10, j: 12 })).toBe(false); // 90 degrees off axis, outside 60 half angle
    expect(inShape(cone, origin, 0, origin, { i: 11.5, j: 12 })).toBe(true); // ~53 degrees: inside
    expect(inShape(cone, origin, 0, origin, { i: 7, j: 10 })).toBe(false); // behind
    expect(inShape(cone, origin, 64, origin, { i: 10, j: 13 })).toBe(true); // facing +j
  });
  it('line and ring', () => {
    const line = { type: 'line' as const, anchor: 'caster' as const, length: 8, width: 1 };
    expect(inShape(line, origin, 0, origin, { i: 17, j: 10.4 })).toBe(true);
    expect(inShape(line, origin, 0, origin, { i: 17, j: 11 })).toBe(false);
    expect(inShape(line, origin, 0, origin, { i: 19, j: 10 })).toBe(false);
    expect(inShape(line, origin, 0, origin, { i: 9, j: 10 })).toBe(false);
    const ring = { type: 'ring' as const, anchor: 'caster' as const, radius: 5, inner_radius: 2 };
    expect(inShape(ring, origin, 0, origin, { i: 11, j: 10 })).toBe(false);
    expect(inShape(ring, origin, 0, origin, { i: 14, j: 10 })).toBe(true);
    expect(inShape(ring, origin, 0, origin, { i: 16, j: 10 })).toBe(false);
  });
});

// ---------------------------------------------------------------------------------------------------- cast pipeline
describe('cast pipeline: sim validation + combat resolution', () => {
  it('a cone skill needs no target, waits cast_ms (400) and hits only the mobs inside it', () => {
    const r = rig({
      mobs: [
        { id: MOB, i: 22.5, j: 20.5 }, // 2 tiles ahead (+i): inside the 2.5 radius, 90 degree cone
        { id: MOB + 1, i: 20.5, j: 23.5 }, // 3 tiles to the side: outside
        { id: MOB + 2, i: 17.5, j: 20.5 }, // behind
      ],
    });
    r.tick([r.cast('kiem_khi_tram')]);
    expect(r.results).toHaveLength(0); // not resolved yet: cast time
    r.run(300);
    expect(r.results).toHaveLength(0);
    r.run(100);
    expect(r.results).toHaveLength(1);
    const res = r.results[0]!;
    expect(res).toMatchObject({ entityId: 1, seq: 1, reason: CastReason.Ok });
    expect(res.hits.map((h) => h.targetId)).toEqual([MOB]);
    expect(entity(r, MOB)!.hp).toBe(3000 - res.hits[0]!.damage);
    expect(entity(r, MOB + 1)!.hp).toBe(3000);
    expect(res.readyAtMs).toBeGreaterThan(r.world.timeMs);
  });

  it('rejects casts of a skill the class does not own (UnknownSkill) without touching the sim state', () => {
    const r = rig({ mobs: [{ i: 22.5, j: 20.5 }] });
    const mp0 = entity(r, 1)!.mp;
    r.tick([r.cast('linh_khi_dan', MOB)]); // a phap skill cast by a kiem
    expect(r.results).toEqual([
      {
        entityId: 1,
        seq: 1,
        skillId: expect.any(Number),
        reason: CastReason.UnknownSkill,
        readyAtMs: expect.any(Number),
        hits: [],
      },
    ]);
    expect(entity(r, 1)!.mp).toBe(mp0);
    r.run(2000);
    expect(entity(r, MOB)!.hp).toBe(3000);
  });

  it('GCD, cooldown and MP rejections come from the sim and deal no damage', () => {
    const r = rig({ mobs: [{ i: 22.5, j: 20.5 }] });
    r.tick([r.cast('kiem_khi_tram')]);
    r.tick([r.cast('lien_hoan_kiem')]); // within the 800 ms GCD
    expect(rejected(r)).toEqual([CastReason.Gcd]);
    r.run(900);
    r.tick([r.cast('kiem_khi_tram')]); // GCD over, 3 s cooldown not
    expect(rejected(r)).toEqual([CastReason.Gcd, CastReason.Cooldown]);
    // drain MP, then an otherwise ready skill is refused
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === 1 ? { ...e, mp: 0 } : e)) };
    r.run(1000);
    r.tick([r.cast('lien_hoan_kiem')]);
    expect(rejected(r).pop()).toBe(CastReason.NoMp);
    const dmgEvents = r.events.filter((e) => e.type === 'damage');
    expect(dmgEvents).toHaveLength(1); // only the first cast ever landed
  });

  it('single-target skills enforce range and line of sight (phap linh_khi_dan: range 8, LOS)', () => {
    const rows = Array.from({ length: 64 }, (_, j) =>
      j === 20 ? '.'.repeat(24) + '#' + '.'.repeat(39) : '.'.repeat(64),
    );
    const far = rig({ path: 'phap', rows, mobs: [{ i: 40.5, j: 20.5 }] });
    far.tick([far.cast('linh_khi_dan', MOB)]);
    expect(rejected(far)).toEqual([CastReason.OutOfRange]);
    const walled = rig({ path: 'phap', rows, mobs: [{ i: 27.5, j: 20.5 }] }); // 7 tiles away, wall at i = 24
    walled.tick([walled.cast('linh_khi_dan', MOB)]);
    expect(rejected(walled)).toEqual([CastReason.NoLineOfSight]);
    const ok = rig({ path: 'phap', mobs: [{ i: 27.5, j: 20.5 }] });
    ok.tick([ok.cast('linh_khi_dan', MOB)]);
    ok.run(500);
    expect(rejected(ok)).toEqual([]);
    expect(ok.results[0]!.hits.map((h) => h.targetId)).toEqual([MOB]);
    const bad = rig({ path: 'phap', mobs: [{ i: 27.5, j: 20.5 }] });
    bad.tick([bad.cast('linh_khi_dan', 4242)]); // no such entity
    expect(rejected(bad)).toEqual([CastReason.BadTarget]);
  });

  it('flags crits and kills on the wire result, calls MobPort.kill and resolves drops from the shared table', () => {
    const r = rig({ mobs: [{ i: 22.5, j: 20.5, hp: 1 }] });
    r.tick([r.cast('kiem_khi_tram')]);
    r.run(400);
    const res = r.results.find((x) => x.entityId === 1)!;
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0]!.flags & HIT_FLAG_KILL).toBe(HIT_FLAG_KILL);
    expect(r.mobs.killed).toEqual([MOB]);
    expect(entity(r, MOB)).toBeUndefined();
    const dropEvent = r.events.find((e) => e.type === 'drops');
    expect(dropEvent).toBeDefined();
    expect(r.drops).toHaveLength(1);
    // the drop stream is the seeded 'drop' fork of the shared PRNG: same resolver, same rolls
    let st = rngFork(rngSeed(1), 'drop');
    const rng = () => {
      const [v, n] = rngFloat(st);
      st = n;
      return v;
    };
    expect(r.drops[0]).toEqual(resolveDrops({ source: 'field', monsterRealm: 1, realmGap: 0, partySize: 1 }, rng));
    expect(HIT_FLAG_CRIT).toBe(1);
  });

  it('heal and shield skills act on the caster (dan_phu) and shields absorb later damage', () => {
    const r = rig({ path: 'dan_phu' });
    const hpMax = r.combat.maxHpOf(1)!;
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === 1 ? { ...e, hp: 10 } : e)) };
    r.tick([r.cast('hoi_xuan_chu', 1)]);
    r.run(900);
    expect(entity(r, 1)!.hp).toBeGreaterThan(10);
    expect(entity(r, 1)!.hp).toBeLessThanOrEqual(hpMax);
    expect(r.events.some((e) => e.type === 'heal')).toBe(true);
    r.run(2000);
    r.tick([r.cast('ho_the_phu', 1)]);
    r.run(600);
    const shield = r.events.find((e) => e.type === 'shield');
    expect(shield).toBeDefined();
    const before = entity(r, 1)!.hp;
    const amt = (shield as { amount: number }).amount;
    const hit = r.combat.damagePlayer(r.world, 1, amt - 1, MOB);
    expect(entity(Object.assign(r, { world: hit.world }), 1)!.hp).toBe(before); // fully absorbed
  });
});

// ---------------------------------------------------------------------------------------------------- client-influenced targets (security)
describe('reach is re-validated at resolve time', () => {
  const moveMob = (r: Rig, id: number, i: number, j: number): void => {
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === id ? { ...e, i, j } : e)) };
  };

  it('a ground skill cannot be anchored on a far target through targetId (the sim does not range-check ground skills)', () => {
    // ngu_kiem_tran: ground, range 8, circle r4, 3 s channel
    const r = rig({
      mobs: [
        { id: MOB, i: 22.5, j: 20.5 }, // 2 tiles from the caster: inside the circle when anchored on the caster
        { id: MOB + 1, i: 55.5, j: 20.5 }, // the far "anchor" a malicious client names
        { id: MOB + 2, i: 57.5, j: 20.5 }, // next to the far anchor
      ],
    });
    r.tick([r.cast('ngu_kiem_tran', MOB + 1)]);
    r.run(3100); // channel_ms 3000: the hits land when the channel ends
    const hit = r.results.flatMap((x) => x.hits.map((h) => h.targetId));
    expect(hit).toEqual([MOB]); // anchored on the caster, not on the far mob
    expect(entity(r, MOB + 1)!.hp).toBe(3000);
    expect(entity(r, MOB + 2)!.hp).toBe(3000);
  });

  it('a ground skill anchored on a target within range still works (area around the target)', () => {
    const r = rig({
      mobs: [
        { id: MOB, i: 26.5, j: 20.5 }, // 6 tiles away: inside range 8, the named anchor
        { id: MOB + 1, i: 29.5, j: 20.5 }, // 3 tiles from the anchor, 9 from the caster
      ],
    });
    r.tick([r.cast('ngu_kiem_tran', MOB)]);
    r.run(3100);
    expect(r.results.flatMap((x) => x.hits.map((h) => h.targetId)).sort()).toEqual([MOB, MOB + 1]);
  });

  it('a target that moved out of range during the cast time is not hit', () => {
    const r = rig({ path: 'phap', mobs: [{ i: 27.5, j: 20.5 }] }); // linh_khi_dan: range 8, cast 500 ms
    r.tick([r.cast('linh_khi_dan', MOB)]);
    expect(rejected(r)).toEqual([]); // accepted by the sim
    moveMob(r, MOB, 40.5, 20.5);
    r.run(500);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.hits).toEqual([]);
    expect(entity(r, MOB)!.hp).toBe(3000);
  });

  it('a wall that appears between caster and target by resolve time also blocks the hit', () => {
    const rows = Array.from({ length: 64 }, (_, j) =>
      j === 20 ? '.'.repeat(24) + '#' + '.'.repeat(39) : '.'.repeat(64),
    );
    const r = rig({ path: 'phap', mobs: [{ i: 27.5, j: 18.5 }] }); // open map: accepted
    r.tick([r.cast('linh_khi_dan', MOB)]);
    expect(rejected(r)).toEqual([]);
    // swap in a grid with a wall on the line (the caster is on row 20, the mob moves behind the wall)
    Object.assign(r.ctx, { grid: TileGrid.fromRows(rows) });
    moveMob(r, MOB, 27.5, 20.5);
    r.run(500);
    expect(r.results[0]!.hits).toEqual([]);
  });

  it('two casts with the same seq in one tick: the first wins, the second (far target) is dropped before the sim and never redirects it', () => {
    const r = rig({
      path: 'phap',
      mobs: [
        { id: MOB, i: 27.5, j: 20.5 }, // valid target
        { id: MOB + 1, i: 40.5, j: 20.5 }, // out of range: only reachable through the redirect
      ],
    });
    const first = r.cast('linh_khi_dan', MOB);
    const second = { ...first, targetId: MOB + 1 } as SimInput;
    const pre = r.combat.preStep([first, second], r.world);
    expect(pre.inputs).toHaveLength(1);
    r.tick([first, second]);
    r.run(500);
    expect(r.results).toHaveLength(1);
    expect(r.results[0]!.hits.map((h) => h.targetId)).toEqual([MOB]);
    expect(entity(r, MOB + 1)!.hp).toBe(3000);
  });
});

// ---------------------------------------------------------------------------------------------------- players: HP / death / respawn
describe('player HP, death and respawn', () => {
  it('lethal damage kills, blocks casts and moves, and respawns after 10 s at the respawn point with full HP / MP and cleared cooldowns', () => {
    const r = rig({ mobs: [{ i: 22.5, j: 20.5 }] });
    const hpMax = r.combat.maxHpOf(1)!;
    r.tick([r.cast('kiem_khi_tram')]);
    r.run(400);
    const d = r.combat.damagePlayer(r.world, 1, hpMax + 5, MOB);
    r.world = d.world;
    expect(d.events.map((e) => e.type)).toEqual(['damage', 'death']);
    expect(entity(r, 1)!.hp).toBe(0);
    expect(r.combat.isAlive(1)).toBe(false);
    // dead: casts answered Controlled, moves dropped
    r.results.length = 0;
    r.tick([r.cast('lien_hoan_kiem'), { kind: 'move', entityId: 1, seq: 1, dtMs: 50, dir: 0, mag: 15, flags: 0 }]);
    expect(r.results[0]).toMatchObject({ reason: CastReason.Controlled, hits: [] });
    expect(entity(r, 1)!.i).toBeCloseTo(20.5, 5);
    // respawn exactly after the delay
    r.run(COMBAT_RULES.RESPAWN_PVE_MS - 200);
    expect(r.combat.isAlive(1)).toBe(false);
    r.run(400);
    expect(r.combat.isAlive(1)).toBe(true);
    const e = entity(r, 1)!;
    expect(e).toMatchObject({ hp: hpMax, mp: e.mpMax, i: 5.5, j: 5.5 });
    expect(e.cooldowns.every((c) => c === 0)).toBe(true);
    expect(r.events.some((x) => x.type === 'respawn')).toBe(true);
  });

  it('a caster that dies during a cast time cancels the cast (no damage)', () => {
    const r = rig({ mobs: [{ i: 22.5, j: 20.5 }] });
    r.tick([r.cast('kiem_khi_tram')]);
    const d = r.combat.damagePlayer(r.world, 1, 10 ** 9, MOB);
    r.world = d.world;
    r.run(500);
    expect(entity(r, MOB)!.hp).toBe(3000);
    expect(r.results).toEqual([]); // the pending cast was dropped with the caster
  });
});

describe('WorldNode with mobs: true and combat: {} (default MobPort wiring)', () => {
  it('a player cast damages a spawned mob, the kill despawns it and starts its respawn timer, and drops fire', () => {
    const drops: DropRoll[][] = [];
    const node = new WorldNode({
      seed: 4,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      mobs: true,
      combat: { onDrops: (d) => drops.push([...d.rolls]) },
    });
    expect(node.mobs).not.toBeNull();
    expect(node.combat).not.toBeNull();
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    const mob = node.world.entities.find((e) => isMobId(e.id))!;
    expect(mob).toBeDefined();
    const mobHpMax = node.mobs!.combatStats(mob.id)!.hpMax;
    // stand 1.5 tiles west of the mob, facing +i (the cone of kiem_khi_tram covers it), mob at 1 HP
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) =>
        e.id === id ? { ...e, i: mob.i - 1.5, j: mob.j, facing: 0 } : e.id === mob.id ? { ...e, hp: 1 } : e,
      ),
    };
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    node.receive(id, encode({ type: 'skill_cast', seq: 1, skillId: kiem.id, targetId: 0, aim: null }));
    for (let k = 0; k < 14; k++) node.tick();
    expect(mobHpMax).toBeGreaterThan(1);
    expect(node.world.entities.some((e) => e.id === mob.id)).toBe(false); // killed: despawned by MobManager.kill
    const info = node.mobs!.info(mob.id)!;
    expect(info.alive).toBe(false);
    expect(info.respawnAtTick).toBeGreaterThan(node.world.tick);
    expect(drops).toHaveLength(1);
    const res = c.msgs.filter((m): m is Extract<Message, { type: 'skill_result' }> => m.type === 'skill_result');
    expect(res).toHaveLength(1);
    expect(res[0]).toMatchObject({ seq: 1, reason: CastReason.Ok });
  });

  it('opts.combat.mobs still overrides the default port', () => {
    const port = new FakeMobs();
    const node = new WorldNode({ seed: 4, mapTiles: 64, mobs: true, combat: { mobs: port } });
    expect(node.combat!.mobHpMax(1_000_000)).toBeUndefined(); // the fake knows no mob: the manager is not consulted
  });
});

describe('aim point (wire v3)', () => {
  it('a ground skill is anchored on the aim point within range and line of sight (area around the aim, not the caster)', () => {
    // ngu_kiem_tran: ground, range 8, circle r4, 3 s channel. Aim 6 tiles east; a mob there is hit, one beside the caster is not.
    const r = rig({
      mobs: [
        { id: MOB, i: 26.5, j: 20.5 }, // at the aim
        { id: MOB + 1, i: 20.5, j: 23.5 }, // 3 tiles from the caster, 6 from the aim: outside
      ],
    });
    r.tick([r.cast('ngu_kiem_tran', 0, 1, { i: 26.5, j: 20.5 })]);
    r.run(3100);
    expect(r.results.flatMap((x) => x.hits.map((h) => h.targetId))).toEqual([MOB]);
  });

  it('the aim wins over the target; an aim beyond range or behind a wall is ignored (anchored on the target, else the caster)', () => {
    const near = { i: 26.5, j: 20.5 };
    const far = { i: 60.5, j: 20.5 };
    const r = rig({
      mobs: [
        { id: MOB, i: 22.5, j: 20.5 },
        { id: MOB + 1, i: 60.5, j: 20.5 },
      ],
    });
    r.tick([r.cast('ngu_kiem_tran', 0, 1, far)]); // 40 tiles away: ignored, anchored on the caster
    r.run(3100);
    expect(r.results.flatMap((x) => x.hits.map((h) => h.targetId))).toEqual([MOB]);
    expect(entity(r, MOB + 1)!.hp).toBe(3000);
    // wall between caster and aim
    const rows = Array.from({ length: 64 }, (_, j) =>
      j === 20 ? '.'.repeat(24) + '#' + '.'.repeat(39) : '.'.repeat(64),
    );
    const w = rig({ rows, mobs: [{ id: MOB, i: 27.5, j: 20.5 }] });
    w.tick([w.cast('ngu_kiem_tran', 0, 1, near)]);
    w.run(3100);
    expect(w.results.flatMap((x) => x.hits.map((h) => h.targetId))).toEqual([]);
  });

  it('a cone / line is cast toward the aim point instead of the facing', () => {
    // facing +i, mob at +j; kiem_khi_tram is a 90 degree cone, radius 2.5
    const r = rig({ mobs: [{ i: 20.5, j: 22.5 }] });
    r.tick([r.cast('kiem_khi_tram')]);
    r.run(400);
    expect(r.results[0]!.hits).toEqual([]); // facing +i: the mob at +j is outside the cone
    const r2 = rig({ mobs: [{ i: 20.5, j: 22.5 }] });
    r2.tick([r2.cast('kiem_khi_tram', 0, 1, { i: 20.5, j: 23.5 })]); // aim toward +j
    r2.run(400);
    expect(r2.results[0]!.hits.map((h) => h.targetId)).toEqual([MOB]);
    // a non-finite aim cannot poison the result
    const r3 = rig({ mobs: [{ i: 22.5, j: 20.5 }] });
    r3.tick([r3.cast('kiem_khi_tram', 0, 1, { i: Number.NaN, j: Number.NaN })]);
    r3.run(400);
    expect(r3.results[0]!.hits.map((h) => h.targetId)).toEqual([MOB]); // fell back to the facing
  });

  it('over the wire: skill_cast with an aim reaches combat (quantized to 1/32 tile)', () => {
    const mobs = new FakeMobs();
    const node = new WorldNode({ seed: 8, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 1 }, combat: { mobs } });
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    const me = node.world.entities.find((e) => e.id === id)!;
    mobs.stats.set(MOB, mobStats());
    node.world = spawnEntity(node.world, { id: MOB, i: me.i, j: me.j + 2, hp: 3000, mpMax: 0 }); // east/+j side, facing is +i
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    node.receive(
      id,
      encode({
        type: 'skill_cast',
        seq: 1,
        skillId: kiem.id,
        targetId: 0,
        aim: { qi: Math.round(me.i * 32), qj: Math.round((me.j + 2) * 32) },
      }),
    );
    for (let k = 0; k < 14; k++) node.tick();
    expect(node.world.entities.find((e) => e.id === MOB)!.hp).toBeLessThan(3000);
  });
});

describe('own vitals in the snapshot (wire v3)', () => {
  const selfs = (c: Client) => c.msgs.flatMap((m) => (m.type === 'snapshot' && m.self ? [m.self] : []));

  it('the first snapshot carries them; later ones only when HP / MP / shield changed', () => {
    const node = new WorldNode({ seed: 9, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 1 }, combat: {} });
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    for (let k = 0; k < 30; k++) node.tick();
    node.receive(id, encode({ type: 'ping', clientTimeMs: 1 })); // keeps the client "alive" for acks
    const first = selfs(c)[0]!;
    const p = makeProfile('kiem');
    expect(first.vitals).toEqual({ hp: p.stats.hp, hpMax: p.stats.hp, mp: p.stats.mp, mpMax: p.stats.mp, shield: 0 });
    // acknowledge so later snapshots are deltas, then nothing changes -> no vitals
    const before = c.msgs.length;
    node.receive(
      id,
      encode({
        type: 'input',
        ack: c.msgs.filter((m) => m.type === 'snapshot').length,
        inputs: [{ seq: 1, dtMs: 50, dir: 255, mag: 0, flags: 0 }],
      }),
    );
    for (let k = 0; k < 10; k++) node.tick();
    const quiet = c.msgs.slice(before).flatMap((m) => (m.type === 'snapshot' && m.self ? [m.self] : []));
    expect(quiet.length).toBeGreaterThan(0);
    expect(quiet.every((s) => s.vitals === null)).toBe(true);
    // damage the player: the next snapshot carries the new HP once
    const hit = node.combat!.damagePlayer(node.world, id, 100, MOB);
    node.world = hit.world;
    const mark = c.msgs.length;
    for (let k = 0; k < 6; k++) node.tick();
    const after = c.msgs.slice(mark).flatMap((m) => (m.type === 'snapshot' && m.self ? [m.self] : []));
    const withV = after.filter((s) => s.vitals !== null);
    expect(withV).toHaveLength(1);
    expect(withV[0]!.vitals).toMatchObject({ hp: p.stats.hp - 100, hpMax: p.stats.hp });
  });

  it('a node without combat never sends vitals', () => {
    const node = new WorldNode({ seed: 9, mapTiles: 64 });
    const c = new Client();
    node.addPlayer(c, 'acc');
    for (let k = 0; k < 10; k++) node.tick();
    expect(selfs(c).length).toBeGreaterThan(0);
    expect(selfs(c).every((s) => s.vitals === null)).toBe(true);
  });
});

describe('progression -> combat (onStageChange -> setRealm)', () => {
  it('a stored Luyện Khí 3-2 character gets the combat stats of that stage once its profile loads; vitals follow on the wire', async () => {
    const store = new InMemoryProgressionStore();
    const root = {
      type: 'tap_tam' as const,
      elements: ['kim', 'moc', 'thuy'] as ('kim' | 'moc' | 'thuy')[],
      mutation: null,
    };
    await store.save({ ...newRecord('acc9', root), realm: 3, subRealm: 2, version: 1 }, 0);
    const node = new WorldNode({
      seed: 12,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      combat: {},
      progression: new ProgressionService({ store, seed: 12 }),
    });
    const c = new Client();
    const id = node.addPlayer(c, 'acc9');
    const level1 = makeProfile('kiem', 1, 1).stats.hp;
    expect(node.combat!.maxHpOf(id)).toBe(level1); // registered at the default stage until the profile arrives
    await new Promise<void>((r) => setImmediate(r)); // the async profile load finishes
    const stage = makeProfile('kiem', 3, 2);
    expect(stage.stats.hp).toBeGreaterThan(level1);
    expect(node.combat!.maxHpOf(id)).toBe(stage.stats.hp);
    expect(node.combat!.profileOf(id)).toMatchObject({ realm: 3, substage: 2 });
    const me = node.world.entities.find((e) => e.id === id)!;
    expect(me.hp).toBe(stage.stats.hp); // full HP stays full
    expect(me.mpMax).toBe(stage.stats.mp);
    // the snapshot's own vitals follow (hpMax / mpMax changed, so they are re-sent)
    for (let k = 0; k < 6; k++) node.tick();
    const selfs = c.msgs.flatMap((m) => (m.type === 'snapshot' && m.self?.vitals ? [m.self.vitals] : []));
    expect(selfs[selfs.length - 1]).toMatchObject({ hp: stage.stats.hp, hpMax: stage.stats.hp, mpMax: stage.stats.mp });
  });

  it('a node without combat ignores stage changes, and a stage change for an id that left is a no-op', async () => {
    const store = new InMemoryProgressionStore();
    const root = { type: 'don' as const, elements: ['moc'] as 'moc'[], mutation: null };
    await store.save({ ...newRecord('acc8', root), realm: 2, subRealm: 1, version: 1 }, 0);
    const plain = new WorldNode({ seed: 1, mapTiles: 64, progression: new ProgressionService({ store, seed: 1 }) });
    plain.addPlayer(new Client(), 'acc8');
    await new Promise<void>((r) => setImmediate(r));
    expect(plain.combat).toBeNull();
    // the player leaves before the profile load callback runs: nothing breaks, nothing is registered
    const node = new WorldNode({
      seed: 1,
      mapTiles: 64,
      combat: {},
      progression: new ProgressionService({ store, seed: 1 }),
    });
    const t = new Client();
    const id = node.addPlayer(t, 'acc8');
    node.removePlayer(id, t);
    await new Promise<void>((r) => setImmediate(r));
    expect(node.combat!.profileOf(id)).toBeUndefined();
  });
});

describe('player id recycling and combat registration', () => {
  it('a stale removePlayer(id, oldTransport) after the id was recycled leaves the new owner combat state intact', () => {
    const mobs = new FakeMobs();
    const node = new WorldNode({
      seed: 6,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      playerIdQuarantineMs: 100,
      combat: { mobs },
    });
    const ta = new Client();
    const a = node.addPlayer(ta, 'a');
    node.removePlayer(a, ta); // A leaves: its id is quarantined for 100 ms of sim time
    expect(node.combat!.profileOf(a)).toBeUndefined(); // unregistered with the removal
    for (let k = 0; k < 4; k++) node.tick(); // 200 ms > quarantine
    const tb = new Client();
    const b = node.addPlayer(tb, 'b');
    expect(b).toBe(a); // the id was recycled to B
    expect(node.combat!.profileOf(b)).toBeDefined();

    // the old socket of A closes late: bound to A transport, so it must be ignored
    node.removePlayer(a, ta);
    expect(node.clients.has(b)).toBe(true);
    expect(node.combat!.profileOf(b)).toBeDefined();

    // B can still cast and hit: a mob 1.5 tiles ahead, facing +i
    const me = node.world.entities.find((e) => e.id === b)!;
    mobs.stats.set(MOB, mobStats());
    node.world = spawnEntity(node.world, { id: MOB, i: me.i + 1.5, j: me.j, hp: 3000, mpMax: 0 });
    node.world = { ...node.world, entities: node.world.entities.map((e) => (e.id === b ? { ...e, facing: 0 } : e)) };
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    node.receive(b, encode({ type: 'skill_cast', seq: 1, skillId: kiem.id, targetId: 0, aim: null }), tb);
    for (let k = 0; k < 14; k++) node.tick();
    expect(node.world.entities.find((e) => e.id === MOB)!.hp).toBeLessThan(3000);
    const res = tb.msgs.filter((m) => m.type === 'skill_result');
    expect(res).toHaveLength(1);
    // and an internal removal (no transport) still unregisters the owner
    node.removePlayer(b);
    expect(node.combat!.profileOf(b)).toBeUndefined();
  });
});

describe('MobManager (#204) as the MobPort', () => {
  it('combat kills a real mob through combatStats / kill: it despawns, drops resolve and the respawn timer runs', () => {
    const grid = TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64)));
    const ctx: SimContext = { grid, skills: compileSkills() };
    const manager = new MobManager({ seed: 5, grid, zones: defaultMobZones(64), density: 0.2 });
    let world = manager.populate(createWorld(5));
    const mob = world.entities.find((e) => isMobId(e.id))!;
    expect(mob).toBeDefined();
    const drops: DropRoll[][] = [];
    const combat = new CombatSystem(ctx, { seed: 5, mobs: manager, onDrops: (d) => drops.push([...d.rolls]) });
    const st = combat.addPlayer(1, 'kiem');
    world = spawnEntity(world, { id: 1, i: mob.i - 1.5, j: mob.j, hp: st.hpMax, mpMax: st.mpMax, facing: 0 });
    // one-shot the mob: the cone in front of the caster (facing +i) covers it
    world = { ...world, entities: world.entities.map((e) => (e.id === mob.id ? { ...e, hp: 1 } : e)) };
    const kiem = ctx.skills.find((s) => s.key === 'kiem_khi_tram')!;
    let results: CombatResult[] = [];
    for (let t = 0; t < 12; t++) {
      const inputs: SimInput[] =
        t === 0 ? [{ kind: 'cast', entityId: 1, seq: 1, skillId: kiem.id, targetId: 0, rttMs: 0 }] : [];
      const pre = combat.preStep(inputs, world);
      const s = step(world, pre.inputs, ctx, NETWORK.TICK_MS);
      const post = combat.postStep(s.world, s.events);
      world = post.world;
      results = results.concat(post.results);
    }
    expect(results[0]!.hits.map((h) => h.targetId)).toContain(mob.id);
    expect(results[0]!.hits.find((h) => h.targetId === mob.id)!.flags & HIT_FLAG_KILL).toBe(HIT_FLAG_KILL);
    expect(manager.info(mob.id)!.alive).toBe(false);
    expect(world.entities.some((e) => e.id === mob.id)).toBe(false);
    expect(manager.info(mob.id)!.respawnAtTick).toBeGreaterThan(world.tick);
    expect(drops).toHaveLength(1);
  });
});

describe('setRealm (progression hook)', () => {
  it('re-derives max HP / MP and ATK from the new realm, keeping the HP and MP ratios and the class', () => {
    const r = rig({ mobs: [{ i: 22.5, j: 20.5 }] });
    const before = makeProfile('kiem', 1, 1);
    r.world = {
      ...r.world,
      entities: r.world.entities.map((e) => (e.id === 1 ? { ...e, hp: before.stats.hp / 2, mp: e.mpMax / 4 } : e)),
    };
    r.world = r.combat.setRealm(r.world, 1, 2, 1);
    const after = makeProfile('kiem', 2, 1);
    expect(after.stats.hp).toBeGreaterThan(before.stats.hp);
    expect(r.combat.maxHpOf(1)).toBe(after.stats.hp);
    const e = entity(r, 1)!;
    expect(e.mpMax).toBe(after.stats.mp);
    expect(e.hp).toBeCloseTo(after.stats.hp / 2, -1);
    expect(e.mp).toBeCloseTo(after.stats.mp / 4, -1);
    expect(r.combat.profileOf(1)!.path).toBe('kiem');
    expect(r.combat.profileOf(1)!.stats.atk).toBe(after.stats.atk);
    // unknown id: no-op
    expect(r.combat.setRealm(r.world, 999, 3, 1)).toBe(r.world);
  });
});

// ---------------------------------------------------------------------------------------------------- determinism
describe('determinism', () => {
  function scenario(seed: number): string {
    const r = rig({
      seed,
      mobs: [
        { id: MOB, i: 22.5, j: 20.5, stats: { element: 'moc' } },
        { id: MOB + 1, i: 22.0, j: 21.5, stats: { element: 'tho', dropSource: 'elite' } },
        { id: MOB + 2, i: 21.5, j: 19.0, hp: 400 },
      ],
    });
    const keys = [
      'kiem_khi_tram',
      'lien_hoan_kiem',
      'phi_kiem_thuat',
      'kim_quang_quet',
      'thiem_kiem_bo',
      'ngu_kiem_tran',
    ];
    for (let t = 0; t < 400; t++) {
      const inputs: SimInput[] = t % 12 === 0 ? [r.cast(keys[(t / 12) % keys.length]!)] : [];
      r.tick(inputs);
    }
    return JSON.stringify([stateHash(r.world), r.combat.stateDigest(), r.results, r.events, r.drops]);
  }
  it('same seed + same inputs -> identical world hash, combat state, results, events and drops', () => {
    const a = scenario(7);
    expect(scenario(7)).toBe(a);
    expect(a.length).toBeGreaterThan(200);
  });
  it('a different seed gives a different outcome', () => {
    expect(scenario(8)).not.toBe(scenario(7));
  });
  it('the combat module reads no clock or ambient randomness', async () => {
    const { readFileSync, readdirSync } = await import('node:fs');
    const dir = new URL('../src/world/combat/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\/\/.*$/gm, '');
      expect(src, f).not.toMatch(
        /Math\.random|Date\.now|performance\.now|setTimeout|setInterval|Math\.(sin|cos|pow|hypot)\b/,
      );
    }
  });
});

// ---------------------------------------------------------------------------------------------------- World Node integration
class Client implements ClientTransport {
  msgs: Message[] = [];
  closed: ErrorCode | null = null;
  known = new Map<number, BaselinePos>();
  send(data: Uint8Array): void {
    const m = decode(data, { baseline: (i) => this.known.get(i) });
    this.msgs.push(m);
    if (m.type === 'snapshot') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_enter') for (const e of m.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
    else if (m.type === 'aoi_leave') for (const i of m.indices) this.known.delete(i);
  }
  close(code: ErrorCode): void {
    this.closed = code;
  }
  buffered(): number {
    return 0;
  }
}

describe('WorldNode with combat', () => {
  it('answers a resolved cast with a skill_result carrying hits (visible index, damage, flags) and keeps hpPct in sync', () => {
    const mobs = new FakeMobs();
    const node = new WorldNode({
      seed: 3,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      combat: { mobs },
    });
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    expect(node.combat).not.toBeNull();
    const me = node.world.entities.find((e) => e.id === id)!;
    mobs.stats.set(MOB, mobStats());
    node.world = spawnEntity(node.world, { id: MOB, i: me.i + 2, j: me.j, hp: 3000, mpMax: 0 });
    for (let k = 0; k < 12; k++) node.tick(); // AOI runs at 10 Hz: the mob becomes visible
    const enter = c.msgs.flatMap((m) => (m.type === 'aoi_enter' ? m.entities : []));
    const mobEnter = enter.find((e) => e.entityId === MOB);
    expect(mobEnter).toBeDefined();
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    node.receive(id, encode({ type: 'skill_cast', seq: 1, skillId: kiem.id, targetId: 0, aim: null }));
    for (let k = 0; k < 14; k++) node.tick();
    const results = c.msgs.filter((m): m is Extract<Message, { type: 'skill_result' }> => m.type === 'skill_result');
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ seq: 1, reason: CastReason.Ok, skillId: kiem.id });
    expect(results[0]!.hits).toHaveLength(1);
    expect(results[0]!.hits[0]!.targetIndex).toBe(mobEnter!.index);
    expect(results[0]!.hits[0]!.damage).toBeGreaterThan(0);
    // the player's own max HP comes from the combat profile (07 §1 stats), not the skeleton constant
    expect(node.combat!.maxHpOf(id)).toBe(makeProfile('kiem').stats.hp);
    // a rejected (cooldown) cast is answered immediately by the sim path, without hits
    node.receive(id, encode({ type: 'skill_cast', seq: 2, skillId: kiem.id, targetId: 0, aim: null }));
    node.tick();
    const last = c.msgs.filter((m) => m.type === 'skill_result').pop() as Extract<Message, { type: 'skill_result' }>;
    expect(last).toMatchObject({ seq: 2, reason: CastReason.Cooldown, hits: [] });
  });

  it('mob hpPct and maxHp come from the MobPort (not the player constant) and follow the damage in snapshots', () => {
    const mobs = new FakeMobs();
    const node = new WorldNode({ seed: 3, mapTiles: 64, spawn: { i0: 20, j0: 20, side: 1 }, combat: { mobs } });
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    const me = node.world.entities.find((e) => e.id === id)!;
    const HP_MAX = 9000; // differs from WORLD_CONFIG.PLAYER_MAX_HP (1000) and from any player profile HP
    mobs.stats.set(MOB, mobStats({ hpMax: HP_MAX }));
    node.world = spawnEntity(node.world, { id: MOB, i: me.i + 2, j: me.j, hp: HP_MAX, mpMax: 0 });
    for (let k = 0; k < 12; k++) node.tick();
    const enter = c.msgs.flatMap((m) => (m.type === 'aoi_enter' ? m.entities : [])).find((e) => e.entityId === MOB)!;
    expect(enter.maxHp).toBe(HP_MAX);
    expect(enter.hpPct).toBe(100);
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    node.receive(id, encode({ type: 'skill_cast', seq: 1, skillId: kiem.id, targetId: 0, aim: null }));
    for (let k = 0; k < 40; k++) node.tick();
    const hp = node.world.entities.find((e) => e.id === MOB)!.hp;
    expect(hp).toBeLessThan(HP_MAX);
    const pcts = c.msgs.flatMap((m) =>
      m.type === 'snapshot'
        ? m.entities.filter((e) => e.index === enter.index && e.hpPct !== null).map((e) => e.hpPct)
        : [],
    );
    expect(pcts.length).toBeGreaterThan(0);
    expect(pcts[pcts.length - 1]).toBe(Math.round((hp / HP_MAX) * 100));
    // with the player constant (1000) the same HP would clamp to 127; the real percentage stays <= 100
    expect(pcts[pcts.length - 1]).toBeLessThanOrEqual(100);
  });

  it('a node built without opts.combat behaves as before: ok result with empty hits', () => {
    const node = new WorldNode({ seed: 3, mapTiles: 64 });
    const c = new Client();
    const id = node.addPlayer(c, 'acc');
    const skill = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    node.receive(id, encode({ type: 'skill_cast', seq: 1, skillId: skill.id, targetId: 0, aim: null }));
    node.tick();
    const res = c.msgs.find((m) => m.type === 'skill_result') as Extract<Message, { type: 'skill_result' }>;
    expect(res).toMatchObject({ seq: 1, reason: CastReason.Ok, hits: [] });
    expect(node.combat).toBeNull();
  });
});

// keeps the data import honest: every class has 8 skills the combat module can resolve
describe('skill data coverage', () => {
  it('every active skill of every class compiles to a wire id and resolves without throwing', () => {
    const compiled = compileSkills();
    for (const path of ['kiem', 'phap', 'the', 'dan_phu', 'thuong', 'dao'] as PathId[]) {
      const p = makeProfile(path);
      for (const s of skillsOf(path).filter((x) => x.kind === 'active')) {
        expect(compiled.some((c) => c.key === s.id)).toBe(true);
        const enemy: ResolveTarget = { id: MOB, i: 1, j: 0, hpMax: 3000, defense: 40, realm: 1, element: 'moc' };
        expect(() =>
          resolveCast({
            casterId: 1,
            caster: { i: 0, j: 0 },
            facing: 0,
            profile: p,
            skill: s,
            targetId: MOB,
            enemies: [enemy],
            rand: () => 0.5,
          }),
        ).not.toThrow();
      }
    }
  });
});
