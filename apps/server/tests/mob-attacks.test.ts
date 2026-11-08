import { describe, expect, it } from 'vitest';
import {
  COMBAT_RULES,
  MOB_ID_BASE,
  MOB_TIERS,
  NETWORK,
  mobAttacksOf,
  mobDefByKey,
  MOB_DEFS,
  type MobDef,
} from '@vgtd/shared';
import { TileGrid, compileSkills, createWorld, spawnEntity, step, type SimContext, type SimWorld } from '@vgtd/sim';
import {
  CombatSystem,
  MobAttackSystem,
  WorldNode,
  type CombatEvent,
  type MobAttackPort,
  type MobAttackView,
} from '../src/index.js';

const MOB = MOB_ID_BASE;
const PLAYER = 1;

class FakeView implements MobAttackPort {
  views = new Map<number, MobAttackView>();
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
  } = {},
): Rig {
  const rows = o.rows ?? Array.from({ length: 64 }, () => '.'.repeat(64));
  const ctx: SimContext = { grid: TileGrid.fromRows(rows), skills: compileSkills() };
  const combat = new CombatSystem(ctx, { seed: o.seed ?? 1 });
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
  world = spawnEntity(world, { id: MOB, i: o.mob?.i ?? 21.7, j: o.mob?.j ?? 20.5, hp: 5000, mpMax: 0 });
  const port = new FakeView();
  port.views.set(MOB, { state: o.state ?? 'chase', target: PLAYER, level: o.level ?? 12, def });
  const attacks = new MobAttackSystem(ctx, combat, port, o.seed ?? 1);
  const r: Rig = {
    world,
    combat,
    attacks,
    port,
    events: [],
    tick(n = 1) {
      for (let k = 0; k < n; k++) {
        r.world = step(r.world, [], ctx, 50).world;
        const out = attacks.step(r.world);
        r.world = out.world;
        r.events.push(...out.events);
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
    expect(t('boss_ho_vuong')).toEqual([]); // TODO placeholder
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
