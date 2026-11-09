import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULES,
  MOB_AI,
  MOB_ID_BASE,
  MOB_TIERS,
  NETWORK,
  MOB_TRANSFORM_MS,
  mobAttacksOf,
  mobPhasesOf,
  mobDefByKey,
  MOB_DEFS,
  type MobDef,
} from '@vgtd/shared';
import {
  TileGrid,
  compileSkills,
  createWorld,
  spawnEntity,
  step,
  type SimContext,
  type SimInput,
  type SimWorld,
} from '@vgtd/sim';
import {
  CombatSystem,
  MobAttackSystem,
  WorldNode,
  type CombatEvent,
  type MobAttackPort,
  type MobAttackView,
  type MobTelegraphEvent,
} from '../src/index.js';

const MOB = MOB_ID_BASE;
const PLAYER = 1;

class FakeView implements MobAttackPort {
  views = new Map<number, MobAttackView>();
  threat: Array<{ id: number; attackerId: number; amount: number }> = [];
  onDamage(id: number, attackerId: number, amount: number): void {
    this.threat.push({ id, attackerId, amount });
  }
  attackView(id: number): MobAttackView | undefined {
    return this.views.get(id);
  }
}

interface Rig {
  world: SimWorld;
  combat: CombatSystem;
  attacks: MobAttackSystem;
  port: FakeView;
  events: CombatEvent[];
  phases: Array<{ mobId: number; phase: number }>;
  telegraphs: MobTelegraphEvent[];
  /** inputs for the next tick */
  pending: SimInput[];
  tick(n?: number): void;
  hp(): number;
  move(id: number, i: number, j: number): void;
}

function rig(
  o: {
    key?: string;
    mob?: { i: number; j: number };
    player?: { i: number; j: number };
    rows?: string[];
    seed?: number;
    state?: string;
    level?: number;
    /** max HP of the main mob (default 5000) and its starting HP (default = max) */
    hpMax?: number;
    hp?: number;
    extraMobs?: Array<{ id: number; key: string; i: number; j: number }>;
  } = {},
): Rig {
  const rows = o.rows ?? Array.from({ length: 64 }, () => '.'.repeat(64));
  const ctx: SimContext = { grid: TileGrid.fromRows(rows), skills: compileSkills() };
  const hpMax = o.hpMax ?? 5000;
  const link: { attacks?: MobAttackSystem } = {};
  const combat = new CombatSystem(ctx, {
    seed: o.seed ?? 1,
    mobs: {
      combatStats: (id) =>
        id === MOB ? { hpMax, defense: 40, realm: 5, element: 'moc', dropSource: 'field' } : undefined,
      kill: (w) => w,
    },
    isInvulnerable: (id) => link.attacks?.isInvulnerable(id) ?? false,
  });
  const def = mobDefByKey(o.key ?? 'mob_hoi_lang') as MobDef;
  let world = createWorld(o.seed ?? 1);
  const st = combat.addPlayer(PLAYER, 'kiem');
  world = spawnEntity(world, {
    id: PLAYER,
    i: o.player?.i ?? 20.5,
    j: o.player?.j ?? 20.5,
    hp: st.hpMax,
    mpMax: st.mpMax,
  });
  world = spawnEntity(world, { id: MOB, i: o.mob?.i ?? 21.7, j: o.mob?.j ?? 20.5, hp: o.hp ?? hpMax, mpMax: 0 });
  const port = new FakeView();
  port.views.set(MOB, { state: o.state ?? 'chase', target: PLAYER, level: o.level ?? 12, def });
  for (const m of o.extraMobs ?? []) {
    world = spawnEntity(world, { id: m.id, i: m.i, j: m.j, hp: 100, mpMax: 0 });
    port.views.set(m.id, { state: 'idle', target: 0, level: 12, def: mobDefByKey(m.key) as MobDef });
  }
  const attacks = new MobAttackSystem(ctx, combat, port, o.seed ?? 1);
  link.attacks = attacks;
  const r: Rig = {
    world,
    combat,
    attacks,
    port,
    events: [],
    phases: [],
    telegraphs: [],
    pending: [],
    tick(n = 1) {
      for (let k = 0; k < n; k++) {
        const pre = combat.preStep(r.pending, r.world);
        r.pending = [];
        const sim = step(r.world, pre.inputs, ctx, 50);
        const post = combat.postStep(sim.world, sim.events); // status ticks, regen, player casts
        const out = attacks.step(post.world);
        r.world = out.world;
        r.events.push(...post.events, ...out.events);
        r.phases.push(...out.phases);
        r.telegraphs.push(...out.telegraphs);
      }
    },
    hp: () => r.world.entities.find((e) => e.id === PLAYER)!.hp,
    move(id, i, j) {
      r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === id ? { ...e, i, j } : e)) };
    },
  };
  return r;
}

const ms = (n: number): number => Math.ceil(n / 50);

describe('mob attack table', () => {
  it('every def has a basic attack at its tier interval; the listed skills carry their docs/10 telegraph times', () => {
    for (const d of MOB_DEFS) {
      const a = mobAttacksOf(d);
      expect(a[0]).toMatchObject({ id: 'basic', kind: 'basic', cooldownMs: MOB_TIERS[d.tier].attackIntervalMs });
    }
    const t = (key: string): number[] =>
      mobAttacksOf(mobDefByKey(key)!)
        .slice(1)
        .map((x) => x.telegraphMs);
    expect(t('mob_hoi_lang')).toEqual([800]);
    expect(t('mob_thanh_xa')).toEqual([800]);
    expect(t('mob_doc_chu')).toEqual([1000]);
    expect(t('mob_doc_thiem')).toEqual([1200]);
    expect(t('mob_co_can')).toEqual([1000]);
    expect(t('mob_xich_diem')).toEqual([1000]);
    expect(t('mob_doc_tho')).toEqual([]); // only the basic attack
    expect(t('boss_ho_vuong')).toEqual([1000, 1200, 1000]); // 3 skills (D91)
    expect(t('boss_co_mang')).toEqual([1000, 1000, 1200, 1400]); // 4 skills
  });
});

describe('basic attack reach vs the AI stop distance', () => {
  it('every tier can reach a target at the distance its mob stops at (bosses included)', () => {
    for (const tier of ['normal', 'elite', 'boss'] as const) {
      const d = MOB_DEFS.find((x) => x.tier === tier)!;
      const basic = mobAttacksOf(d)[0]!;
      expect(basic.rangeTiles, tier).toBeGreaterThan(MOB_AI[tier].engageRange);
      expect(basic.shape.radius, tier).toBe(basic.rangeTiles);
    }
  });

  it('a boss standing at its engage distance starts and lands its basic attack', () => {
    const r = rig({ key: 'boss_ho_vuong', mob: { i: 20.5 + MOB_AI.boss.engageRange, j: 20.5 }, level: 57 });
    const hp0 = r.hp();
    r.tick(ms(1300)); // its first skill (1000 ms telegraph) is in reach at the engage distance
    expect(r.hp()).toBeLessThan(hp0);
    expect(r.events[0]).toMatchObject({ type: 'damage', sourceId: MOB, targetId: PLAYER });
  });
});

describe('MobAttackSystem', () => {
  it('a chasing mob in reach telegraphs then hits its target; the hit takes a few percent of HP, not a one-shot', () => {
    const r = rig({ key: 'mob_doc_tho' });
    const hp0 = r.hp();
    r.tick(ms(300));
    expect(r.hp()).toBe(hp0); // still telegraphing
    r.tick(ms(200));
    expect(r.hp()).toBeLessThan(hp0);
    expect(r.hp()).toBeGreaterThan(hp0 * 0.7);
    expect(r.events.filter((e) => e.type === 'damage')).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: 'damage', sourceId: MOB, targetId: PLAYER });
  });

  it('the basic attack repeats at the tier interval', () => {
    const r = rig({ key: 'mob_doc_tho' });
    r.tick(ms(1700));
    expect(r.events.filter((e) => e.type === 'damage')).toHaveLength(1);
    r.tick(ms(700)); // past 1800 ms + the wind-up
    expect(r.events.filter((e) => e.type === 'damage')).toHaveLength(2);
  });

  it('moving out of the telegraphed shape dodges the hit', () => {
    const r = rig({ key: 'mob_doc_tho' });
    const hp0 = r.hp();
    r.tick(ms(100)); // telegraph started
    r.move(PLAYER, 12.5, 20.5);
    r.tick(ms(600));
    expect(r.hp()).toBe(hp0);
    expect(r.events).toHaveLength(0);
  });

  it('a ground skill is anchored on where the target stood when the telegraph started', () => {
    // Độc Thiềm: circle r2.5 on the target, 1.2 s, range 6; the mob stands 5 tiles away so only the skill is in reach
    const r = rig({ key: 'mob_doc_thiem', mob: { i: 25.5, j: 20.5 } });
    const hp0 = r.hp();
    r.tick(ms(200));
    r.move(PLAYER, 20.5, 24.5); // 4 tiles from the anchor: outside the circle
    r.tick(ms(1200));
    expect(r.hp()).toBe(hp0);
    // standing still it lands
    const s = rig({ key: 'mob_doc_thiem', mob: { i: 25.5, j: 20.5 } });
    s.tick(ms(1400));
    expect(s.hp()).toBeLessThan(s.combat.maxHpOf(PLAYER)!);
  });

  it('prefers a ready skill to the basic attack, and a skill is not repeated before its cooldown', () => {
    const r = rig({ key: 'mob_hoi_lang', mob: { i: 21.2, j: 20.5 } });
    r.tick(ms(900)); // Vồ: 800 ms telegraph
    expect(r.events.filter((e) => e.type === 'damage')).toHaveLength(1);
    const first = r.events[0]!.type === 'damage' ? (r.events[0] as { amount: number }).amount : 0;
    r.tick(ms(2000)); // the basic attack fills the gap while the skill is on cooldown (6 s)
    const dmg = r.events.filter((e): e is Extract<CombatEvent, { type: 'damage' }> => e.type === 'damage');
    expect(dmg.length).toBeGreaterThanOrEqual(2);
    expect(dmg[1]!.amount).toBeLessThan(first); // coeff 1 vs the skill's 1.6
  });

  it('nothing happens out of reach, without line of sight, or when the mob is not chasing', () => {
    const far = rig({ key: 'mob_doc_tho', mob: { i: 30.5, j: 20.5 } });
    far.tick(ms(3000));
    expect(far.events).toHaveLength(0);
    const rows = Array.from({ length: 64 }, (_, j) =>
      j === 20 ? '.'.repeat(21) + '#' + '.'.repeat(42) : '.'.repeat(64),
    );
    const wall = rig({ key: 'mob_doc_tho', rows, mob: { i: 22.2, j: 20.5 }, player: { i: 20.5, j: 20.5 } });
    wall.move(MOB, 21.9, 20.5);
    wall.tick(ms(3000));
    expect(wall.events).toHaveLength(0);
    const idle = rig({ key: 'mob_doc_tho', state: 'wander' });
    idle.tick(ms(3000));
    expect(idle.events).toHaveLength(0);
  });

  it('a mob that dies or despawns during its telegraph cancels the attack', () => {
    const r = rig({ key: 'mob_doc_tho' });
    const hp0 = r.hp();
    r.tick(ms(100));
    r.world = { ...r.world, entities: r.world.entities.filter((e) => e.id !== MOB) };
    r.tick(ms(600));
    expect(r.hp()).toBe(hp0);
  });

  it('a lethal hit kills the player through the combat core (death event, dead flag, no further attacks on a corpse)', () => {
    const r = rig({ key: 'mob_doc_tho', level: 60 });
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === PLAYER ? { ...e, hp: 3 } : e)) };
    r.tick(ms(600));
    expect(r.events.some((e) => e.type === 'death' && e.id === PLAYER && e.killerId === MOB)).toBe(true);
    expect(r.combat.isAlive(PLAYER)).toBe(false);
    expect(r.hp()).toBe(0);
    const n = r.events.length;
    r.tick(ms(3000));
    expect(r.events.length).toBe(n);
  });

  it('is deterministic: the same world + seed give the same hits and digest, a different seed a different jitter', () => {
    const run = (seed: number) => {
      const r = rig({ key: 'mob_hoi_lang', mob: { i: 21.2, j: 20.5 }, seed });
      r.tick(ms(6000));
      return { hp: r.hp(), digest: r.attacks.digest(), events: JSON.stringify(r.events) };
    };
    expect(run(7)).toEqual(run(7));
    expect(run(7).events).not.toBe(run(8).events);
  });
});

describe('WorldNode with real mobs', () => {
  const makeNode = (mobAttacks?: boolean) =>
    new WorldNode({
      seed: 5,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      mobs: { zones: [{ zone: 'bia_rung', i0: 14, j0: 14, i1: 28, j1: 28 }], density: 0.4 },
      combat: { mobAttacks },
    });
  const client = () => ({
    send() {},
    close() {},
    buffered: () => 0,
  });

  it('a player standing among aggroed mobs is hurt, dies, and respawns at the spawn point with full HP', () => {
    const node = makeNode();
    const id = node.addPlayer(client(), 'acc');
    const me = () => node.world.entities.find((e) => e.id === id)!;
    const spawn = { i: me().i, j: me().j };
    const hpMax = node.combat!.maxHpOf(id)!;
    let hurt = false;
    let diedAt = -1;
    for (let k = 0; k < 4000 && diedAt < 0; k++) {
      node.tick();
      if (me().hp < hpMax) hurt = true;
      if (!node.combat!.isAlive(id)) diedAt = node.world.timeMs;
    }
    expect(hurt).toBe(true);
    expect(diedAt).toBeGreaterThan(0);
    expect(me().hp).toBe(0);
    // the combat core respawns it after COMBAT_RULES.RESPAWN_PVE_MS at the node's spawn point
    for (let k = 0; k < Math.ceil(COMBAT_RULES.RESPAWN_PVE_MS / NETWORK.TICK_MS) + 2; k++) node.tick();
    expect(node.combat!.isAlive(id)).toBe(true);
    expect(me().hp).toBeGreaterThan(0);
    expect(Math.hypot(me().i - spawn.i, me().j - spawn.j)).toBeLessThan(3);
  });

  it('combat.mobAttacks = false keeps mobs harmless', () => {
    const node = makeNode(false);
    expect(node.mobAttacks).toBeNull();
    const id = node.addPlayer(client(), 'acc');
    for (let k = 0; k < 1500; k++) node.tick();
    expect(node.world.entities.find((e) => e.id === id)!.hp).toBe(node.combat!.maxHpOf(id));
  });
});

describe('elite and boss skills (D91)', () => {
  const dmgEvents = (r: Rig) =>
    r.events.filter((e): e is Extract<CombatEvent, { type: 'damage' }> => e.type === 'damage');

  it('the phase table: one phase for normal / elite mobs, Hổ Vương 2 (50% HP), Cổ Mãng 3 (60% / 25%), transform window of docs/03 §6', () => {
    expect(mobPhasesOf(mobDefByKey('mob_hoi_lang')!)).toHaveLength(1);
    expect(mobPhasesOf(mobDefByKey('elite_lang_vuong')!)).toHaveLength(1);
    const ho = mobPhasesOf(mobDefByKey('boss_ho_vuong')!);
    expect(ho.map((p) => p.atHpFrac)).toEqual([1, 0.5]);
    const mang = mobPhasesOf(mobDefByKey('boss_co_mang')!);
    expect(mang.map((p) => p.atHpFrac)).toEqual([1, 0.6, 0.25]);
    expect(mang.map((p) => p.transformMs)).toEqual([0, MOB_TRANSFORM_MS, MOB_TRANSFORM_MS]);
    expect(MOB_TRANSFORM_MS).toBe(1800); // 0.8 s start + 1.0 s end
    // later phases hit harder and faster
    for (const list of [ho, mang])
      for (let k = 1; k < list.length; k++) {
        expect(list[k]!.atkMult).toBeGreaterThan(list[k - 1]!.atkMult);
        expect(list[k]!.cooldownMult).toBeLessThan(list[k - 1]!.cooldownMult);
      }
  });

  it('Trói rễ roots the player it hits; the root ends on its own', () => {
    const r = rig({ key: 'elite_co_can_mau', mob: { i: 25.5, j: 20.5 } });
    r.tick(ms(1300));
    expect(r.combat.status.isRooted(PLAYER, r.world.timeMs)).toBe(true);
    r.tick(ms(1600));
    expect(r.combat.status.isRooted(PLAYER, r.world.timeMs)).toBe(false);
  });

  it('Phun tơ slows; Phun độc poisons and the poison ticks damage after the hit', () => {
    const slow = rig({ key: 'mob_doc_chu', mob: { i: 22.8, j: 20.5 } });
    slow.tick(ms(1200));
    expect(slow.combat.status.slowFactor(PLAYER, slow.world.timeMs)).toBe(0.5);
    const poison = rig({ key: 'mob_thanh_xa', mob: { i: 23.5, j: 20.5 } });
    poison.tick(ms(1000));
    expect(poison.combat.status.isPoisoned(PLAYER, poison.world.timeMs)).toBe(true);
    const hpAfterHit = poison.hp();
    poison.tick(ms(2200));
    expect(poison.hp()).toBeLessThan(hpAfterHit); // damage over time (the mob may also bite again: only the direction matters)
  });

  it('Vũng độc leaves a pool on the target position that keeps hurting a player who stays in it', () => {
    const r = rig({ key: 'elite_thiem_vuong', mob: { i: 26.5, j: 20.5 } });
    r.tick(ms(4200)); // jump (skill 1) first, then the pool (skill 2): its 1.2 s telegraph is over
    expect(r.combat.status.poolCount).toBeGreaterThan(0);
    const before = r.hp();
    r.tick(ms(3000));
    expect(r.hp()).toBeLessThan(before);
  });

  it("Tru gọi pulls the 2 nearest Hôi Lang within range onto the attacked player's threat table, no more, none out of range", () => {
    const r = rig({
      key: 'elite_lang_vuong',
      mob: { i: 26.5, j: 20.5 },
      extraMobs: [
        { id: MOB + 1, key: 'mob_hoi_lang', i: 28.5, j: 20.5 },
        { id: MOB + 2, key: 'mob_hoi_lang', i: 27.5, j: 24.5 },
        { id: MOB + 3, key: 'mob_hoi_lang', i: 29.5, j: 26.5 },
        { id: MOB + 4, key: 'mob_hoi_lang', i: 60.5, j: 60.5 }, // out of the 10-tile radius
        { id: MOB + 5, key: 'mob_doc_tho', i: 26.8, j: 20.5 }, // the wrong kind, even though it is the closest
      ],
    });
    r.tick(ms(1300)); // Tru gọi is the only skill in reach at 6 tiles: 1 s howl
    expect(r.port.threat.map((t) => t.id)).toEqual([MOB + 1, MOB + 2]);
    expect(r.port.threat.every((t) => t.attackerId === PLAYER && t.amount > 0)).toBe(true);
    expect(dmgEvents(r)).toHaveLength(0); // a pure effect: no damage
  });

  it('a boss changes phase at its HP threshold: transform window (invulnerable, no attacks), then stronger, faster attacks', () => {
    const r = rig({ key: 'boss_ho_vuong', mob: { i: 22.5, j: 20.5 }, level: 57, hpMax: 10_000 });
    r.tick(ms(200));
    expect(r.attacks.phaseIndex(MOB)).toBe(0);
    expect(r.attacks.isInvulnerable(MOB)).toBe(false);
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === MOB ? { ...e, hp: 4900 } : e)) }; // 49%
    r.tick(1);
    expect(r.attacks.phaseIndex(MOB)).toBe(1);
    expect(r.phases).toEqual([{ mobId: MOB, phase: 1, transformMs: MOB_TRANSFORM_MS }]);
    expect(r.attacks.isInvulnerable(MOB)).toBe(true);
    const n = dmgEvents(r).length;
    r.tick(ms(1500));
    expect(dmgEvents(r).length).toBe(n); // no attack lands while it transforms
    expect(r.attacks.isInvulnerable(MOB)).toBe(true);
    r.tick(ms(400));
    expect(r.attacks.isInvulnerable(MOB)).toBe(false);
    r.tick(ms(3000));
    expect(dmgEvents(r).length).toBeGreaterThan(n); // it fights again
    expect(r.phases).toHaveLength(1); // one change only
  });

  it('a large drop crosses two thresholds at once (Cổ Mãng 100% -> 20%): it lands in phase 2 with ONE transform', () => {
    const r = rig({ key: 'boss_co_mang', mob: { i: 23.5, j: 20.5 }, level: 67, hpMax: 10_000 });
    r.tick(ms(100));
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === MOB ? { ...e, hp: 2000 } : e)) };
    r.tick(1);
    expect(r.attacks.phaseIndex(MOB)).toBe(2);
    expect(r.phases).toEqual([{ mobId: MOB, phase: 2, transformMs: MOB_TRANSFORM_MS }]);
  });

  it('the transform window makes the boss untargetable for player skills (CombatOptions.isInvulnerable), and it is hurt again afterwards', () => {
    const r = rig({ key: 'boss_ho_vuong', mob: { i: 22.5, j: 20.5 }, level: 57, hpMax: 100_000, hp: 49_000 });
    const cast = (seq: number): SimInput =>
      ({
        kind: 'cast',
        entityId: PLAYER,
        seq,
        skillId: compileSkills().find((c) => c.key === 'kiem_khi_tram')!.id,
        targetId: MOB,
        rttMs: 0,
        aim: null,
      }) as SimInput;
    r.tick(1); // phase 1 starts: invulnerable
    expect(r.attacks.isInvulnerable(MOB)).toBe(true);
    const mobHp = () => r.world.entities.find((e) => e.id === MOB)!.hp;
    const before = mobHp();
    r.pending.push(cast(1));
    r.tick(ms(800));
    expect(mobHp()).toBe(before); // the cast resolved on nobody
    r.tick(ms(2400)); // the window is over (and the first cast's cooldown too)
    r.pending.push(cast(2));
    r.tick(ms(800));
    expect(mobHp()).toBeLessThan(before);
  });

  it('a respawned boss starts again in phase 0, and phases are part of the digest', () => {
    const r = rig({ key: 'boss_ho_vuong', mob: { i: 22.5, j: 20.5 }, level: 57, hpMax: 10_000, hp: 4000 });
    r.tick(1);
    expect(r.attacks.phaseIndex(MOB)).toBe(1);
    expect(r.attacks.digest()).toContain('"phases":[[1000000,1');
    r.world = { ...r.world, entities: r.world.entities.filter((e) => e.id !== MOB) }; // killed: gone from the world
    r.tick(1);
    expect(r.attacks.phaseIndex(MOB)).toBe(0);
  });

  it('is deterministic with effects and phases: same seed = same digest and hits (boss fight, 12 s)', () => {
    const run = (seed: number) => {
      const r = rig({ key: 'boss_co_mang', mob: { i: 22.5, j: 20.5 }, level: 67, hpMax: 10_000, hp: 5000, seed });
      r.tick(ms(12_000));
      return { hp: r.hp(), digest: r.attacks.digest() + r.combat.status.digest(), events: JSON.stringify(r.events) };
    };
    expect(run(3)).toEqual(run(3));
  });
});

describe('WorldNode: a real boss fight (D91)', () => {
  it('the boss next to a player fights it, transforms at 50% HP (invulnerable, then stronger) and the node reports the phase change', () => {
    const node = new WorldNode({
      seed: 8,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      mobs: { zones: [{ zone: 'co_thu_trung_tam', i0: 14, j0: 14, i1: 30, j1: 30 }], density: 1 },
      combat: {},
    });
    const id = node.addPlayer({ send() {}, close() {}, buffered: () => 0 }, 'acc');
    const mobs = node.mobs!;
    let bossId = 0;
    for (let k = 0; k < mobs.size; k++)
      if (mobs.info(MOB_ID_BASE + k)?.def.key === 'boss_ho_vuong') bossId = MOB_ID_BASE + k;
    expect(bossId).toBeGreaterThan(0);
    const info = mobs.info(bossId)!;
    // stand the player next to the boss
    const boss = () => node.world.entities.find((e) => e.id === bossId)!;
    const me = () => node.world.entities.find((e) => e.id === id)!;
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) => (e.id === id ? { ...e, i: boss().i + 2, j: boss().j } : e)),
    };
    const hpMax = node.combat!.maxHpOf(id)!;
    for (let k = 0; k < 400 && me().hp === hpMax; k++) node.tick(); // it aggros and attacks
    expect(me().hp).toBeLessThan(hpMax);
    expect(node.mobAttacks!.phaseIndex(bossId)).toBe(0);
    // push it under 50%: it transforms
    node.world = {
      ...node.world,
      entities: node.world.entities.map((e) => (e.id === bossId ? { ...e, hp: Math.floor(info.maxHp * 0.45) } : e)),
    };
    node.tick();
    expect(node.mobAttacks!.phaseIndex(bossId)).toBe(1);
    expect(node.mobAttacks!.isInvulnerable(bossId)).toBe(true);
    for (let k = 0; k < Math.ceil(MOB_TRANSFORM_MS / NETWORK.TICK_MS) + 2; k++) node.tick();
    expect(node.mobAttacks!.isInvulnerable(bossId)).toBe(false);
  });
});

describe('telegraph events stay consistent with phase changes and effect-only attacks (D89 + D91)', () => {
  /** every telegraph start has exactly one end (resolved or cancelled) once the fight is quiet */
  const pairs = (r: Rig) => {
    const starts = r.telegraphs.filter((t): t is Extract<MobTelegraphEvent, { kind: 'start' }> => t.kind === 'start');
    const ends = r.telegraphs.filter((t): t is Extract<MobTelegraphEvent, { kind: 'end' }> => t.kind === 'end');
    return { starts, ends };
  };

  it('a boss that crosses an HP threshold during a telegraph cancels it on the wire (end cancelled) and never leaves a decal behind', () => {
    const r = rig({ key: 'boss_ho_vuong', mob: { i: 22.5, j: 20.5 }, level: 57, hpMax: 10_000 });
    r.tick(ms(300)); // its first skill (1000 ms telegraph) has started
    const open = pairs(r).starts;
    expect(open.length).toBeGreaterThan(0);
    expect(pairs(r).ends).toHaveLength(0);
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === MOB ? { ...e, hp: 4900 } : e)) };
    r.tick(1); // phase change: the windup is dropped
    const cancelled = pairs(r).ends.filter((t) => t.cancelled);
    expect(cancelled.map((t) => t.id)).toEqual(open.map((t) => t.id));
    r.tick(ms(6000)); // transform, then phase 2 attacks: every one starts and ends
    const { starts, ends } = pairs(r);
    for (const st of starts.slice(0, -1))
      expect(
        ends.filter((e) => e.id === st.id),
        `telegraph ${st.id}`,
      ).toHaveLength(1);
    expect(starts.length).toBeGreaterThan(open.length); // phase 2 attacks produced telegraphs too
  });

  it('an effect-only attack (Tru goi, coeff 0) still sends a start and a non-cancelled end', () => {
    const r = rig({
      key: 'elite_lang_vuong',
      mob: { i: 26.5, j: 20.5 },
      extraMobs: [{ id: MOB + 1, key: 'mob_hoi_lang', i: 28.5, j: 20.5 }],
    });
    r.tick(ms(1300));
    const { starts, ends } = pairs(r);
    const howl = starts.find((t) => t.attack.effect?.type === 'call_help');
    expect(howl).toBeDefined();
    expect(howl!.durationMs).toBe(1000);
    expect(ends.filter((e) => e.id === howl!.id)).toEqual([{ kind: 'end', id: howl!.id, cancelled: false }]);
  });
});
