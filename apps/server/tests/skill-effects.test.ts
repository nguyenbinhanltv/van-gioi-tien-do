/**
 * Skill effects of the combat core (D116): every effect type the shipped `skills.json` uses, through the real `CombatSystem` + sim `step`.
 * One deterministic scenario per effect; the numbers asserted come from the skill data and `SKILL_EFFECTS`.
 */
import { describe, expect, it } from 'vitest';
import {
  COLLIDER_RADIUS_TILES,
  MOB_ID_BASE,
  NETWORK,
  SKILL_EFFECTS,
  mobDefByKey,
  skillDefinitions,
  type PathId,
  type SkillEffect,
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
  makeProfile,
  resolveCast,
  MobAttackSystem,
  MobManager,
  type CombatEvent,
  type MobCombatStats,
  type MobPort,
} from '../src/index.js';

const SKILLS = compileSkills();
const wireOf = (key: string): number => SKILLS.find((s) => s.key === key)!.id;
const dataOf = (key: string) => skillDefinitions.skills.find((s) => s.id === key)!;
const effectOf = (key: string, type: string): SkillEffect => dataOf(key).effects.find((e) => e.type === type)!;
const TICK = NETWORK.TICK_MS;

class FakeMobs implements MobPort {
  stats = new Map<number, MobCombatStats>();
  killed: number[] = [];
  threat: Array<{ id: number; by: number; amount: number }> = [];
  combatStats(id: number): MobCombatStats | undefined {
    return this.killed.includes(id) ? undefined : this.stats.get(id);
  }
  kill(w: SimWorld, id: number): SimWorld {
    this.killed.push(id);
    return { ...w, entities: w.entities.filter((e) => e.id !== id) };
  }
  onDamage(id: number, by: number, amount: number): void {
    this.threat.push({ id, by, amount });
  }
}

interface RigOptions {
  path?: PathId;
  realm?: number;
  mobs?: Array<{ id: number; i: number; j: number; hp?: number; tier?: 'normal' | 'elite' | 'boss'; def?: number }>;
  /** extra players, standing at (i, j) */
  allies?: Array<{ id: number; path: PathId; i: number; j: number; hp?: number }>;
  rows?: string[];
  seed?: number;
  party?: boolean;
  at?: { i: number; j: number };
}
const PLAYER = 1;

function rig(o: RigOptions = {}) {
  const rows = o.rows ?? Array.from({ length: 64 }, () => '.'.repeat(64));
  const ctx: SimContext = { grid: TileGrid.fromRows(rows), skills: SKILLS };
  const mobs = new FakeMobs();
  const ids = [PLAYER, ...(o.allies ?? []).map((a) => a.id)];
  const combat = new CombatSystem(ctx, {
    seed: o.seed ?? 1,
    mobs,
    partyOf: o.party ? () => ids : undefined,
  });
  let world = createWorld(o.seed ?? 1);
  const add = (id: number, path: PathId, i: number, j: number, hp?: number): void => {
    const st = combat.addPlayer(id, path, o.realm ?? 3, 1);
    world = spawnEntity(world, { id, i, j, hp: hp ?? st.hpMax, mpMax: st.mpMax });
  };
  add(PLAYER, o.path ?? 'kiem', o.at?.i ?? 20.5, o.at?.j ?? 20.5);
  for (const a of o.allies ?? []) add(a.id, a.path, a.i, a.j, a.hp);
  for (const m of o.mobs ?? []) {
    const hpMax = m.hp ?? 100_000;
    mobs.stats.set(m.id, {
      hpMax,
      defense: m.def ?? 40,
      realm: o.realm ?? 3,
      element: null,
      dropSource: 'field',
      tier: m.tier,
    });
    world = spawnEntity(world, { id: m.id, i: m.i, j: m.j, hp: hpMax, mpMax: 0 });
  }
  const seqs = new Map<number, number>();
  const r = {
    ctx,
    combat,
    mobs,
    world,
    events: [] as CombatEvent[],
    pending: [] as SimInput[],
    cast(key: string, c: { by?: number; target?: number; aim?: { i: number; j: number } } = {}) {
      const by = c.by ?? PLAYER;
      const seq = (seqs.get(by) ?? 0) + 1;
      seqs.set(by, seq);
      r.pending.push({
        kind: 'cast',
        entityId: by,
        seq,
        skillId: wireOf(key),
        targetId: c.target ?? 0,
        rttMs: 0,
        aim: c.aim ?? null,
      } as SimInput);
    },
    tick(n = 1) {
      for (let k = 0; k < n; k++) {
        const pre = combat.preStep(r.pending, r.world);
        r.pending = [];
        const sim = step(r.world, pre.inputs, ctx, TICK);
        const post = combat.postStep(sim.world, sim.events);
        r.world = post.world;
        r.events.push(...post.events);
      }
    },
    /** advance by ms of sim time */
    run(ms: number) {
      r.tick(Math.ceil(ms / TICK));
    },
    ent: (id: number) => r.world.entities.find((e) => e.id === id)!,
    now: () => r.world.timeMs,
    damageEvents: (target: number) =>
      r.events.filter((e) => e.type === 'damage' && e.targetId === target) as Extract<
        CombatEvent,
        { type: 'damage' }
      >[],
  };
  return r;
}
const MOB = MOB_ID_BASE;
const dist = (a: { i: number; j: number }, b: { i: number; j: number }): number => Math.hypot(a.i - b.i, a.j - b.j);

describe('control statuses on mobs (stun / freeze / knock-up, root, slow)', () => {
  it('a stun from a cone skill holds the mobs in it for the data duration and not a moment longer', () => {
    const r = rig({ path: 'kiem', mobs: [{ id: MOB, i: 22.5, j: 20.5 }] });
    r.cast('kim_quang_quet', { aim: { i: 22.5, j: 20.5 } });
    r.run(dataOf('kim_quang_quet').timing.cast_ms + 100);
    const dur = effectOf('kim_quang_quet', 'status').duration_ms!;
    expect(r.combat.effects.isStunned(MOB, r.now())).toBe(true);
    expect(r.combat.effects.maskOfMob(MOB, r.now()) & 8).toBe(8); // the wire mask carries Stun
    r.run(dur + 100);
    expect(r.combat.effects.isStunned(MOB, r.now())).toBe(false);
    expect(r.combat.effects.maskOfMob(MOB, r.now())).toBe(0);
  });

  it('a mob outside the cone is not stunned', () => {
    const r = rig({ path: 'kiem', mobs: [{ id: MOB, i: 17.5, j: 20.5 }] }); // behind the caster
    r.cast('kim_quang_quet', { aim: { i: 23, j: 20.5 } });
    r.run(800);
    expect(r.combat.effects.isStunned(MOB, r.now())).toBe(false);
  });

  it('root and slow (with its magnitude) from a ground skill', () => {
    const r = rig({ path: 'phap', mobs: [{ id: MOB, i: 24.5, j: 20.5 }] });
    r.cast('bang_phong_thuat', { aim: { i: 24.5, j: 20.5 } });
    r.run(1000);
    expect(r.combat.effects.isRooted(MOB, r.now())).toBe(true);
    expect(r.combat.effects.speedFactor(MOB, r.now())).toBeCloseTo(
      1 - (effectOf('bang_phong_thuat', 'status') ? 0.5 : 0),
      9,
    );
    expect(r.combat.effects.maskOfMob(MOB, r.now())).toBe(1 | 2); // root + slow
    r.run(2500); // the root (2 s) is over, the slow (3 s) is not
    expect(r.combat.effects.isRooted(MOB, r.now())).toBe(false);
    expect(r.combat.effects.speedFactor(MOB, r.now())).toBe(0.5);
    r.run(1500);
    expect(r.combat.effects.speedFactor(MOB, r.now())).toBe(1);
  });

  it('knock-up counts as a stun; a hard CC on a BOSS only interrupts its attack, a slow works at a share', () => {
    const r = rig({ path: 'kiem', mobs: [{ id: MOB, i: 22.5, j: 20.5, tier: 'boss' }] });
    r.cast('kim_quang_quet', { aim: { i: 22.5, j: 20.5 } });
    r.run(900);
    expect(r.combat.effects.isStunned(MOB, r.now())).toBe(false); // bosses are CC-immune (D49)
    expect(r.combat.interrupted.has(MOB)).toBe(true); // ... but the stun cancels the attack in progress
    const s = rig({ path: 'phap', mobs: [{ id: MOB, i: 24.5, j: 20.5, tier: 'boss' }] });
    s.cast('bang_phong_thuat', { aim: { i: 24.5, j: 20.5 } });
    s.run(1000);
    expect(s.combat.effects.isRooted(MOB, s.now())).toBe(false);
    expect(s.combat.effects.speedFactor(MOB, s.now())).toBeCloseTo(1 - 0.5 * SKILL_EFFECTS.BOSS_SLOW_MULT, 9);
  });
});

describe('damage over time, heal over time, pets', () => {
  it('a dot ticks on the data interval for the data duration, each tick the same amount, and the kill still drops loot', () => {
    const r = rig({ path: 'phap', mobs: [{ id: MOB, i: 24.5, j: 20.5, hp: 1_000_000 }] });
    r.cast('liet_diem_phan_thien', { aim: { i: 24.5, j: 20.5 } });
    r.run(dataOf('liet_diem_phan_thien').timing.cast_ms + 50);
    const e = effectOf('liet_diem_phan_thien', 'dot');
    const before = r.damageEvents(MOB).length; // the skill's own hit
    r.run(e.duration_ms! + 200);
    const ticks = r.damageEvents(MOB).slice(before);
    expect(ticks).toHaveLength(e.duration_ms! / e.tick_interval_ms!);
    expect(new Set(ticks.map((t) => t.amount)).size).toBe(1); // fixed per tick (no crit, no jitter)
    expect(ticks[0]!.amount).toBeGreaterThan(0);
    expect(r.combat.effects.dots).toHaveLength(0); // pruned once over
  });

  it('a dot that kills a mob gives the kill to its source (death event, loot, mob removed)', () => {
    const r = rig({ path: 'phap', mobs: [{ id: MOB, i: 24.5, j: 20.5, hp: 500 }] });
    r.cast('liet_diem_phan_thien', { aim: { i: 24.5, j: 20.5 } });
    r.run(6000);
    expect(r.mobs.killed).toContain(MOB);
    expect(r.events.some((e) => e.type === 'death' && e.id === MOB && e.killerId === PLAYER)).toBe(true);
    expect(r.events.some((e) => e.type === 'drops' && e.mobId === MOB)).toBe(true);
  });

  it('a heal-over-time zone heals the wounded ally in range on every tick, never above max HP, and not one out of range', () => {
    const r = rig({
      path: 'dan_phu',
      party: true,
      allies: [
        { id: 2, path: 'kiem', i: 22.5, j: 20.5, hp: 200 },
        { id: 3, path: 'kiem', i: 40.5, j: 20.5, hp: 200 },
      ],
      mobs: [{ id: MOB, i: 24.5, j: 20.5 }],
    });
    r.cast('van_moc_hoi_xuan', { aim: { i: 22.5, j: 20.5 } });
    r.run(dataOf('van_moc_hoi_xuan').timing.cast_ms + 50);
    const hot = effectOf('van_moc_hoi_xuan', 'hot');
    r.run(hot.duration_ms! + 200);
    const healsOn = (id: number) => r.events.filter((e) => e.type === 'heal' && e.targetId === id);
    expect(healsOn(2).length).toBe(hot.duration_ms! / hot.tick_interval_ms!);
    expect(healsOn(3)).toHaveLength(0); // out of the zone
    expect(r.ent(2).hp).toBeGreaterThan(200);
    expect(r.ent(2).hp).toBeLessThanOrEqual(r.combat.maxHpOf(2)!);
  });

  it('the pet of a passive summon strikes the nearest mob in range on its interval, and waits when there is none', () => {
    const r = rig({
      path: 'dan_phu',
      mobs: [
        { id: MOB, i: 24.5, j: 20.5 },
        { id: MOB + 1, i: 22.5, j: 20.5 },
      ],
    });
    const pet = skillDefinitions.skills.find((s) => s.id === 'phu_linh')!.effects.find((e) => e.type === 'summon')!;
    r.run(3000);
    const hits = r.events.filter((e) => e.type === 'damage' && e.sourceId === PLAYER);
    expect(hits.length).toBeGreaterThanOrEqual(Math.floor(3000 / pet.tick_interval_ms!) - 1);
    expect(hits.every((h) => h.type === 'damage' && h.targetId === MOB + 1)).toBe(true); // the nearer mob
    const far = rig({ path: 'dan_phu', mobs: [{ id: MOB, i: 20.5 + SKILL_EFFECTS.PET_RANGE + 2, j: 20.5 }] });
    far.run(3000);
    expect(far.events.filter((e) => e.type === 'damage')).toHaveLength(0);
    const kiem = rig({ path: 'kiem', mobs: [{ id: MOB, i: 22.5, j: 20.5 }] });
    kiem.run(3000);
    expect(kiem.events.filter((e) => e.type === 'damage')).toHaveLength(0); // only classes with a summon have a pet
  });
});

describe('buffs, passives and debuffs', () => {
  it('dmg_pct raises the damage of a hit by the data magnitude: the cast reads the buff of the caster', () => {
    const profile = makeProfile('dao', 3, 1);
    const skill = skillDefinitions.skills.find((x) => x.path === 'dao' && x.tier === 'basic' && x.kind === 'active')!;
    const mag = dataOf('cuong_huyet').effects.find(
      (e) => e.type === 'buff' && e.stat === 'dmg_pct' && (e.context ?? 'any') !== 'group',
    )!.magnitude!;
    const hit = (dmgMult: number): number => {
      const out = resolveCast({
        casterId: 1,
        caster: { i: 20.5, j: 20.5 },
        facing: 0,
        profile,
        skill,
        targetId: MOB,
        aim: { i: 21.5, j: 20.5 },
        enemies: [{ id: MOB, i: 21.5, j: 20.5, hpMax: 1e6, defense: 40, realm: 3, element: null }],
        rand: () => 0.9, // no crit, high jitter: identical in both calls
        mods: { dmgMult, critBonus: 0, penBonus: 0 },
      });
      return out.hits.reduce((n, h) => n + h.damage, 0);
    };
    expect(hit(1 + mag) / hit(1)).toBeCloseTo(1 + mag, 1);
    // and through the system: casting the buff puts exactly that magnitude on the caster
    const r = rig({ path: 'dao' });
    r.cast('cuong_huyet');
    r.run(500);
    expect(r.combat.effects.buffSum(PLAYER, 'dmg_pct', r.now())).toBeCloseTo(mag, 9);
    expect(r.combat.effects.buffSum(PLAYER, 'lifesteal', r.now())).toBeGreaterThan(0);
  });

  it('a buff lasts exactly its duration and recasting refreshes instead of stacking', () => {
    const r = rig({ path: 'dao' });
    const d = effectOf('cuong_huyet', 'buff').duration_ms!;
    r.cast('cuong_huyet');
    r.run(400);
    const at = r.now();
    expect(r.combat.effects.buffSum(PLAYER, 'dmg_pct', at)).toBeCloseTo(0.25, 9);
    r.combat.effects.addBuff(PLAYER, { stat: 'dmg_pct', mag: 0.25, untilMs: at + d, src: PLAYER }); // a refresh from the same source
    expect(r.combat.effects.buffSum(PLAYER, 'dmg_pct', at)).toBeCloseTo(0.25, 9);
    expect(r.combat.effects.buffSum(PLAYER, 'dmg_pct', at + d + 1)).toBe(0);
  });

  it('lifesteal heals a share of the damage dealt; the passive of the class counts too', () => {
    const r = rig({ path: 'dao', mobs: [{ id: MOB, i: 21.5, j: 20.5 }] });
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === PLAYER ? { ...e, hp: 100 } : e)) };
    r.cast('cuong_huyet');
    r.run(500);
    const basic = skillDefinitions.skills.find((s) => s.path === 'dao' && s.tier === 'basic' && s.kind === 'active')!;
    r.world = {
      ...r.world,
      entities: r.world.entities.map((e) =>
        e.id === PLAYER ? { ...e, cooldowns: e.cooldowns.map(() => 0), gcdReadyAt: 0 } : e,
      ),
    };
    const hp0 = r.ent(PLAYER).hp;
    r.cast(basic.id, { target: MOB, aim: { i: 21.5, j: 20.5 } });
    r.run(1500);
    const dealt = r.damageEvents(MOB).reduce((n, e) => n + e.amount, 0);
    const heals = r.events
      .filter((e) => e.type === 'heal' && e.targetId === PLAYER)
      .reduce((n, e) => n + (e.type === 'heal' ? e.amount : 0), 0);
    expect(heals).toBeGreaterThan(0);
    expect(heals).toBeCloseTo(dealt * (0.12 + 0.04), -1); // buff 12 % + the dao_y passive 4 %: rounding per hit
    expect(r.ent(PLAYER).hp).toBeGreaterThan(hp0);
  });

  it('class passives are read: lifesteal / def_pct / low_hp_dmg_pct / potion_power, and the heal pill gets its power', () => {
    const kiem = rig({ path: 'kiem' }).combat.profileOf(PLAYER)!;
    expect(kiem.lifesteal).toBeCloseTo(0.04, 9);
    const the = rig({ path: 'the' }).combat.profileOf(PLAYER)!;
    expect(the.defPct).toBeCloseTo(0.08, 9);
    const dao = rig({ path: 'dao' }).combat.profileOf(PLAYER)!;
    expect(dao.lowHpDmgPct).toBeCloseTo(0.12, 9);
    const dp = rig({ path: 'dan_phu' });
    const prof = dp.combat.profileOf(PLAYER)!;
    expect(prof.potionPower).toBeCloseTo(0.12, 9);
    expect(prof.pet).toEqual({ coeff: 0.7, intervalMs: 1200 });
    dp.world = { ...dp.world, entities: dp.world.entities.map((e) => (e.id === PLAYER ? { ...e, hp: 100 } : e)) };
    const hpMax = dp.combat.maxHpOf(PLAYER)!;
    const pill = dp.combat.usePill(dp.world, PLAYER);
    expect(pill.healed).toBe(Math.round(hpMax * 0.18 * 1.12));
  });

  it('dr_pct buffs reduce damage taken (capped); def_pct changes the DEF a mob attack is resolved against', () => {
    const r = rig({ path: 'thuong' });
    const before = r.ent(PLAYER).hp;
    r.combat.effects.addBuff(PLAYER, { stat: 'dr_pct', mag: 0.3, untilMs: 5000, src: PLAYER });
    const a = r.combat.damagePlayer(r.world, PLAYER, 1000, MOB);
    expect(before - a.world.entities.find((e) => e.id === PLAYER)!.hp).toBe(700);
    r.combat.effects.addBuff(PLAYER, { stat: 'dr_pct', mag: 0.9, untilMs: 5000, src: 99 });
    expect(r.combat.drOf(PLAYER, 0)).toBe(SKILL_EFFECTS.DR_CAP);
    const base = r.combat.profileOf(PLAYER)!.stats.def;
    expect(r.combat.defenseOf(PLAYER, 0)).toBe(base);
    r.combat.effects.addBuff(PLAYER, { stat: 'def_pct', mag: -0.15, untilMs: 5000, src: PLAYER });
    expect(r.combat.defenseOf(PLAYER, 0)).toBeCloseTo(base * 0.85, 6);
    r.combat.effects.addBuff(PLAYER, { stat: 'def_pct', mag: -5, untilMs: 5000, src: 5 });
    expect(r.combat.defenseOf(PLAYER, 0)).toBeCloseTo(base * SKILL_EFFECTS.DEF_FACTOR_MIN, 6); // floored
  });

  it('def_shred lowers the mob DEF for the next hits (capped), and is gone after its duration', () => {
    const r = rig({ path: 'thuong', mobs: [{ id: MOB, i: 22.5, j: 20.5 }] });
    const e = effectOf('doan_hon_thich', 'debuff');
    expect(r.combat.effects.defMult(MOB, 0)).toBe(1);
    r.cast('doan_hon_thich', { aim: { i: 22.5, j: 20.5 } });
    r.run(dataOf('doan_hon_thich').timing.cast_ms + 100);
    expect(r.combat.effects.defMult(MOB, r.now())).toBeCloseTo(1 - e.magnitude!, 9);
    r.run(e.duration_ms! + 200);
    expect(r.combat.effects.defMult(MOB, r.now())).toBe(1);
    for (let k = 0; k < 6; k++) r.combat.effects.shredMob(MOB, 0, 10_000, 0.15);
    expect(r.combat.effects.defMult(MOB, 1)).toBe(1 - SKILL_EFFECTS.SHRED_CAP);
  });

  it('restore_mp gives back its share of max MP', () => {
    const r = rig({ path: 'phap', mobs: [{ id: MOB, i: 23.5, j: 20.5 }] });
    r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === PLAYER ? { ...e, mp: 10 } : e)) };
    r.world = {
      ...r.world,
      entities: r.world.entities.map((e) => (e.id === PLAYER ? { ...e, mp: Math.ceil(e.mpMax * 0.5) } : e)),
    };
    const mpMax = r.ent(PLAYER).mpMax;
    const mp0 = r.ent(PLAYER).mp;
    r.cast('phien_phong_bo', { aim: { i: 23.5, j: 20.5 } });
    r.run(400);
    const cost = Math.ceil(dataOf('phien_phong_bo').cost!.mp_pct! * mpMax);
    expect(r.ent(PLAYER).mp).toBeGreaterThanOrEqual(mp0 - cost + Math.round(mpMax * 0.06) - 3);
  });
});

describe('marks and detonation', () => {
  it('stacking a mark to its limit detonates on the marked mob, with a share on its neighbours; the stacks reset', () => {
    const r = rig({
      path: 'dan_phu',
      mobs: [
        { id: MOB, i: 24.5, j: 20.5 },
        { id: MOB + 1, i: 25.5, j: 20.5 },
        { id: MOB + 2, i: 40.5, j: 40.5 },
      ],
    });
    const m = effectOf('phu_tien', 'mark');
    for (let k = 0; k < m.max_stacks!; k++) {
      r.cast('phu_tien', { target: MOB });
      r.run(2100);
      if (k < m.max_stacks! - 1) expect(r.combat.effects.marksOf(MOB, m.mark_id!, r.now())).toBe(k + 1);
    }
    expect(r.combat.effects.marksOf(MOB, m.mark_id!, r.now())).toBe(0);
    const onMarked = r.damageEvents(MOB).filter((e) => e.sourceId === PLAYER).length;
    expect(onMarked).toBeGreaterThanOrEqual(m.max_stacks!); // the detonation hits (plus the skill's own damage)
    const splash = r.damageEvents(MOB + 1);
    expect(splash.length).toBeGreaterThan(0); // inside detonate_radius
    expect(r.damageEvents(MOB + 2)).toHaveLength(0); // outside it
  });

  it('a mark expires if it is not refreshed in time', () => {
    const r = rig({ path: 'dan_phu', mobs: [{ id: MOB, i: 24.5, j: 20.5 }] });
    const m = effectOf('phu_tien', 'mark');
    r.cast('phu_tien', { target: MOB });
    r.run(600);
    expect(r.combat.effects.marksOf(MOB, m.mark_id!, r.now())).toBe(1);
    r.run(m.duration_ms! + 500);
    expect(r.combat.effects.marksOf(MOB, m.mark_id!, r.now())).toBe(0);
  });

  it('detonate consumes the marks in its radius and hits once per stack', () => {
    const m = effectOf('phu_tien', 'mark');
    const play = (detonate: boolean): { marks: number; hits: number } => {
      const r = rig({ path: 'dan_phu', mobs: [{ id: MOB, i: 24.5, j: 20.5 }] });
      for (let k = 0; k < 2; k++) {
        r.cast('phu_tien', { target: MOB });
        r.run(2100);
      }
      expect(r.combat.effects.marksOf(MOB, m.mark_id!, r.now())).toBe(2);
      const before = r.damageEvents(MOB).length;
      if (detonate) r.cast('tuong_sinh_phap');
      r.run(800);
      return { marks: r.combat.effects.marksOf(MOB, m.mark_id!, r.now()), hits: r.damageEvents(MOB).length - before };
    };
    const quiet = play(false); // what the pet alone does in the same time
    const boom = play(true);
    expect(quiet.marks).toBe(2);
    expect(boom.marks).toBe(0);
    expect(boom.hits - quiet.hits).toBe(2); // one hit per stack
  });
});

describe('movement skills (dash, knock-back, pull) respect the D95 grid', () => {
  const wall = (rows: string[], i: number): string[] => rows.map((row) => row.slice(0, i) + '#' + row.slice(i + 1));
  const open = Array.from({ length: 64 }, () => '.'.repeat(64));

  it('a forward dash covers its distance along the aim in open ground', () => {
    const r = rig({ path: 'kiem' });
    r.cast('thiem_kiem_bo', { aim: { i: 30, j: 20.5 } });
    r.run(500);
    expect(r.ent(PLAYER).j).toBeCloseTo(20.5, 6);
    expect(r.ent(PLAYER).i).toBeCloseTo(20.5 + effectOf('thiem_kiem_bo', 'dash').distance_tiles!, 1);
  });

  it('a dash stops in front of a wall / water instead of crossing it', () => {
    const r = rig({ path: 'kiem', rows: wall(open, 23) });
    r.cast('thiem_kiem_bo', { aim: { i: 30, j: 20.5 } });
    r.run(500);
    expect(r.ent(PLAYER).i).toBeLessThan(23);
    expect(r.ent(PLAYER).i).toBeGreaterThan(21);
  });

  it('a dash stops short of the nearest mob instead of running through it', () => {
    const r = rig({ path: 'kiem', mobs: [{ id: MOB, i: 24.5, j: 20.5 }] });
    r.cast('thiem_kiem_bo', { aim: { i: 24.5, j: 20.5 } });
    r.run(500);
    expect(dist(r.ent(PLAYER), r.ent(MOB))).toBeGreaterThanOrEqual(SKILL_EFFECTS.DASH_STOP_TILES - 0.3);
    expect(r.ent(PLAYER).i).toBeLessThan(24.5);
  });

  it('a backward dash (kite) moves away from the mob', () => {
    const r = rig({ path: 'phap', mobs: [{ id: MOB, i: 22.5, j: 20.5 }] });
    const d0 = dist(r.ent(PLAYER), r.ent(MOB));
    r.cast('phien_phong_bo', { aim: { i: 22.5, j: 20.5 } });
    r.run(500);
    expect(dist(r.ent(PLAYER), r.ent(MOB))).toBeGreaterThan(d0 + 2);
  });

  it('a dash never leaves the map and never crosses lava on the zone map rows', () => {
    const rows = open.map((row, j) => (j === 20 ? '#'.repeat(25) + row.slice(25) : row));
    const r = rig({ path: 'kiem', at: { i: 26.5, j: 20.5 }, rows });
    r.cast('thiem_kiem_bo', { aim: { i: 10, j: 20.5 } });
    r.run(500);
    expect(r.ent(PLAYER).i).toBeGreaterThanOrEqual(25 + COLLIDER_RADIUS_TILES - 0.01);
    expect(r.ent(PLAYER).i).toBeLessThan(26.5);
  });

  it('knock-back pushes a mob away by the data distance (stopping at walls); a boss is not moved but its attack is interrupted', () => {
    const r = rig({ path: 'the', mobs: [{ id: MOB, i: 22.5, j: 20.5 }] });
    r.cast('thiet_son_khao', { aim: { i: 22.5, j: 20.5 } });
    r.run(700);
    const kb = effectOf('thiet_son_khao', 'knockback').distance_tiles!;
    expect(r.ent(MOB).i).toBeCloseTo(22.5 + kb, 1);
    const b = rig({ path: 'the', mobs: [{ id: MOB, i: 22.5, j: 20.5, tier: 'boss' }] });
    b.cast('thiet_son_khao', { aim: { i: 22.5, j: 20.5 } });
    b.run(700);
    expect(b.ent(MOB).i).toBeCloseTo(22.5, 6);
    expect(b.combat.interrupted.has(MOB)).toBe(true);
    const w = rig({ path: 'the', mobs: [{ id: MOB, i: 22.5, j: 20.5 }], rows: wall(open, 24) });
    w.cast('thiet_son_khao', { aim: { i: 22.5, j: 20.5 } });
    w.run(700);
    expect(w.ent(MOB).i).toBeLessThan(24);
  });

  it('solo khieu_khich pulls mobs in range toward the caster up to the data distance, never closer than the pull limit; bosses stay', () => {
    const r = rig({
      path: 'the',
      mobs: [
        { id: MOB, i: 24.5, j: 20.5 },
        { id: MOB + 1, i: 20.5, j: 26.5 },
        { id: MOB + 2, i: 24, j: 21, tier: 'boss' },
      ],
    });
    const pull = effectOf('khieu_khich', 'pull');
    const d0 = dist(r.ent(PLAYER), r.ent(MOB));
    r.cast('khieu_khich');
    r.run(600);
    expect(dist(r.ent(PLAYER), r.ent(MOB))).toBeCloseTo(
      Math.max(SKILL_EFFECTS.PULL_MIN_TILES, d0 - pull.distance_tiles!),
      1,
    );
    expect(dist(r.ent(PLAYER), r.ent(MOB + 1))).toBeCloseTo(6, 6); // beyond the radius: untouched
    expect(r.ent(MOB + 2).i).toBeCloseTo(24, 6);
  });
});

describe('taunt, group context, revive', () => {
  it('khieu_khich taunts in a group (a forced target for the data duration) and pulls when alone', () => {
    const solo = rig({ path: 'the', mobs: [{ id: MOB, i: 23.5, j: 20.5 }] });
    solo.cast('khieu_khich');
    solo.run(600);
    expect(solo.combat.effects.taunter(MOB, solo.now())).toBe(0);
    const grp = rig({
      path: 'the',
      party: true,
      allies: [{ id: 2, path: 'kiem', i: 19.5, j: 20.5 }],
      mobs: [{ id: MOB, i: 23.5, j: 20.5 }],
    });
    grp.cast('khieu_khich');
    grp.run(600);
    expect(grp.combat.effects.taunter(MOB, grp.now())).toBe(PLAYER);
    const t = effectOf('khieu_khich', 'taunt');
    grp.run(t.duration_ms! + 200);
    expect(grp.combat.effects.taunter(MOB, grp.now())).toBe(0);
    expect(dist(grp.ent(PLAYER), grp.ent(MOB))).toBeCloseTo(3, 6); // the pull is the SOLO effect: nothing moved
  });

  it('group buffs reach the party members in range only; solo versions apply to the caster', () => {
    const r = rig({
      path: 'kiem',
      party: true,
      allies: [
        { id: 2, path: 'phap', i: 22.5, j: 20.5 },
        { id: 3, path: 'phap', i: 50.5, j: 50.5 },
      ],
    });
    r.cast('ngu_kiem_tran', { aim: { i: 21.5, j: 20.5 } });
    r.run(dataOf('ngu_kiem_tran').timing.cast_ms + (dataOf('ngu_kiem_tran').timing.channel_ms ?? 0) + 400);
    const crit = effectOf('ngu_kiem_tran', 'buff').magnitude!;
    expect(r.combat.effects.buffSum(PLAYER, 'crit_chance', r.now())).toBeCloseTo(crit, 9);
    expect(r.combat.effects.buffSum(2, 'crit_chance', r.now())).toBeCloseTo(crit, 9);
    expect(r.combat.effects.buffSum(3, 'crit_chance', r.now())).toBe(0); // out of range
  });

  it('thien_y_vo_phung-style revive brings a dead party member back with the data share of its HP', () => {
    const r = rig({ path: 'dan_phu', realm: 4, party: true, allies: [{ id: 2, path: 'kiem', i: 22.5, j: 20.5 }] });
    const dead = r.combat.damagePlayer(r.world, 2, 10_000_000, MOB);
    r.world = dead.world;
    expect(r.combat.isAlive(2)).toBe(false);
    r.cast('thien_y_vo_phung', { target: 2, aim: { i: 22.5, j: 20.5 } });
    r.run(2600);
    expect(r.combat.isAlive(2)).toBe(true);
    expect(r.ent(2).hp).toBeGreaterThanOrEqual(
      Math.round(r.combat.maxHpOf(2)! * effectOf('thien_y_vo_phung', 'revive').magnitude!) - 5,
    );
  });

  it('revive refuses a dead player outside the caster party (the target id is client-supplied)', () => {
    // player 2 is NOT grouped with the caster here: no party
    const solo = rig({ path: 'dan_phu', realm: 4, allies: [{ id: 2, path: 'kiem', i: 22.5, j: 20.5 }] });
    solo.world = solo.combat.damagePlayer(solo.world, 2, 10_000_000, MOB).world;
    solo.cast('thien_y_vo_phung', { target: 2, aim: { i: 22.5, j: 20.5 } });
    solo.run(2600);
    expect(solo.combat.isAlive(2)).toBe(false);
  });

  it('a ground effect anchors on the caster when the aim point is beyond the skill range', () => {
    const r = rig({ path: 'dan_phu', party: true, allies: [{ id: 2, path: 'kiem', i: 22.5, j: 20.5 }] });
    const key = 'van_moc_hoi_xuan';
    const sk = dataOf(key);
    r.cast(key, { aim: { i: 20.5 + (sk.targeting.range_tiles ?? 5) + 20, j: 20.5 } });
    r.run(sk.timing.cast_ms + 200);
    const z = r.combat.effects.zones[0]!;
    expect(z).toBeDefined();
    expect(dist({ i: z.i, j: z.j }, r.ent(PLAYER))).toBeLessThan(1e-6);
  });
});

describe('shields: overheal and explosion', () => {
  it('a heal beyond max HP becomes a shield of the data share of the overheal', () => {
    const r = rig({ path: 'dan_phu', allies: [{ id: 2, path: 'kiem', i: 22.5, j: 20.5 }] });
    const heal = effectOf('hoi_xuan_chu', 'heal');
    r.cast('hoi_xuan_chu', { target: 2 });
    r.run(1000);
    const prof = r.combat.profileOf(PLAYER)!;
    const raw = Math.round(prof.stats.atk * heal.scale!.coeff);
    expect(r.combat.shieldOf(2, r.now())).toBe(
      Math.min(r.combat.maxHpOf(2)!, Math.round(raw * heal.overheal_to_shield!)),
    );
  });

  it('a shield with an explosion bursts when it ends: mobs in its radius take the data coefficient, mobs outside do not', () => {
    const r = rig({
      path: 'the',
      mobs: [
        { id: MOB, i: 22.5, j: 20.5 },
        { id: MOB + 1, i: 40.5, j: 40.5 },
      ],
    });
    const sh = effectOf('thiet_bo_sam', 'shield');
    r.cast('thiet_bo_sam');
    r.run(600);
    expect(r.combat.shieldOf(PLAYER, r.now())).toBeGreaterThan(0);
    expect(r.damageEvents(MOB)).toHaveLength(0);
    r.run(sh.duration_ms! + 200);
    expect(r.damageEvents(MOB)).toHaveLength(1);
    expect(r.damageEvents(MOB + 1)).toHaveLength(0);
    expect(r.combat.shieldOf(PLAYER, r.now())).toBe(0);
  });

  it('a shield with an explosion also bursts when a mob attack breaks it', () => {
    const r = rig({ path: 'the', mobs: [{ id: MOB, i: 22.5, j: 20.5 }] });
    r.cast('thiet_bo_sam');
    r.run(600);
    const hit = r.combat.damagePlayer(r.world, PLAYER, 10_000_000, MOB + 99);
    const bursts = hit.events.filter((e) => e.type === 'damage' && e.targetId === MOB);
    expect(bursts.length).toBe(1);
  });
});

describe('determinism and coverage', () => {
  it('the same seed gives the same state after a busy fight (digest of combat + effects)', () => {
    const run = (): string => {
      const r = rig({
        path: 'dan_phu',
        seed: 11,
        party: true,
        allies: [{ id: 2, path: 'the', i: 21.5, j: 20.5 }],
        mobs: [{ id: MOB, i: 24.5, j: 20.5 }],
      });
      for (const k of ['phu_tien', 'van_moc_hoi_xuan', 'hoi_xuan_chu']) {
        r.cast(k, { target: k === 'hoi_xuan_chu' ? 2 : MOB, aim: { i: 24.5, j: 20.5 } });
        r.run(1500);
      }
      return r.combat.stateDigest() + JSON.stringify(r.world.entities.map((e) => [e.id, e.hp, e.i, e.j]));
    };
    expect(run()).toBe(run());
  });

  it('every effect type of the shipped skills is handled: nothing is reported unsupported any more', () => {
    const types = new Set(skillDefinitions.skills.flatMap((s) => s.effects.map((e) => e.type)));
    const handled = new Set([
      'damage',
      'heal',
      'shield',
      'passive_stat',
      'summon',
      'status',
      'dot',
      'hot',
      'buff',
      'debuff',
      'mark',
      'detonate',
      'dash',
      'knockback',
      'pull',
      'taunt',
      'restore_mp',
      'revive',
    ]);
    for (const t of types) expect(handled.has(t), t).toBe(true);
    const r = rig({ path: 'phap', mobs: [{ id: MOB, i: 24.5, j: 20.5 }] });
    r.cast('bang_phong_thuat', { aim: { i: 24.5, j: 20.5 } });
    r.run(1200);
    expect(r.events.some((e) => e.type === 'unsupported_effect')).toBe(false);
  });
});

describe('mob AI and attacks honour the control (MobManager / MobAttackSystem)', () => {
  const grid = TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64)));
  const zone = { zone: 'bia_rung' as const, i0: 8, j0: 8, i1: 56, j1: 56 };

  function world(seed = 3) {
    const m = new MobManager({ seed, zones: [zone], grid, density: 0.1 });
    let w = m.populate(createWorld(seed));
    const mob = w.entities.find((e) => e.id >= MOB_ID_BASE)!;
    // a player right next to the mob so it chases at once
    w = spawnEntity(w, { id: 1, i: mob.i + 3, j: mob.j, hp: 1000, mpMax: 100 });
    return { m, w, mobId: mob.id };
  }
  const advance = (m: MobManager, w: SimWorld, n: number): SimWorld => {
    let x = w;
    for (let k = 0; k < n; k++) x = m.step({ ...x, tick: x.tick + 1, timeMs: x.timeMs + TICK });
    return x;
  };
  const fx = (over: Partial<{ stun: boolean; root: boolean; slow: number; taunt: number }>) => ({
    isStunned: () => over.stun ?? false,
    isRooted: () => over.root ?? false,
    speedFactor: () => over.slow ?? 1,
    taunter: () => over.taunt ?? 0,
  });

  it('a stunned mob does not move; a rooted one does not move either; a slowed one moves at the reduced speed', () => {
    const run = (c: ReturnType<typeof fx> | null): number => {
      const { m, w, mobId } = world();
      m.control = c;
      const start = w.entities.find((e) => e.id === mobId)!;
      const out = advance(m, w, 15);
      const e = out.entities.find((x) => x.id === mobId)!;
      return Math.hypot(e.i - start.i, e.j - start.j);
    };
    const free = run(null);
    expect(free).toBeGreaterThan(1);
    expect(run(fx({ stun: true }))).toBe(0);
    expect(run(fx({ root: true }))).toBe(0);
    const slow = run(fx({ slow: 0.5 }));
    expect(slow).toBeGreaterThan(0.2);
    expect(slow).toBeLessThan(free * 0.8);
  });

  it('a taunt forces the mob onto the taunting player even when someone else is closer', () => {
    const { m, w, mobId } = world();
    const mob = w.entities.find((e) => e.id === mobId)!;
    const w2 = spawnEntity(w, { id: 2, i: mob.i, j: mob.j + 4.5, hp: 1000, mpMax: 100 });
    m.control = fx({ taunt: 2 });
    advance(m, w2, 3);
    expect(m.info(mobId)!.target).toBe(2);
    expect(m.info(mobId)!.state).toBe('chase');
  });

  it('a stunned mob starts no attack and an attack in progress is cancelled; an interrupted (boss) attack is cancelled too', () => {
    const key = 'mob_hoi_lang';
    const def = mobDefByKey(key)!;
    const ctx: SimContext = { grid, skills: SKILLS };
    const mobs = new FakeMobs();
    mobs.stats.set(MOB, { hpMax: 5000, defense: 40, realm: 5, element: 'moc', dropSource: 'field', tier: 'normal' });
    const combat = new CombatSystem(ctx, { mobs });
    const st = combat.addPlayer(1, 'kiem');
    let w = spawnEntity(createWorld(1), { id: 1, i: 20.5, j: 20.5, hp: st.hpMax, mpMax: st.mpMax });
    w = spawnEntity(w, { id: MOB, i: 21.7, j: 20.5, hp: 5000, mpMax: 0 });
    const view = { state: 'chase', target: 1, level: 12, def };
    const attacks = new MobAttackSystem(ctx, combat, { attackView: () => view }, 1);
    const stepOnce = (): { telegraphs: Array<{ kind: string; cancelled?: boolean }> } => {
      w = { ...w, tick: w.tick + 1, timeMs: w.timeMs + TICK };
      const out = attacks.step(w);
      w = out.world;
      return out;
    };
    // an unstunned mob starts a telegraph on the first tick
    expect(stepOnce().telegraphs.some((t) => t.kind === 'start')).toBe(true);
    // stun it mid-telegraph: the attack is cancelled and no new one starts while stunned
    combat.effects.stunMob(MOB, w.timeMs, 5000);
    const cancelled = stepOnce().telegraphs;
    expect(cancelled.some((t) => t.kind === 'end' && t.cancelled === true)).toBe(true);
    for (let k = 0; k < 20; k++) expect(stepOnce().telegraphs.some((t) => t.kind === 'start')).toBe(false);
    const hp = w.entities.find((e) => e.id === 1)!.hp;
    expect(hp).toBe(st.hpMax); // not a scratch
    // after the stun a new attack starts; an interrupt (as on a boss) cancels it again
    combat.effects.clearMob(MOB);
    let started = false;
    for (let k = 0; k < 60 && !started; k++) started = stepOnce().telegraphs.some((t) => t.kind === 'start');
    expect(started).toBe(true);
    combat.interrupted.add(MOB);
    expect(stepOnce().telegraphs.some((t) => t.kind === 'end' && t.cancelled === true)).toBe(true);
    expect(combat.interrupted.size).toBe(0); // consumed
  });

  it('mob attack damage uses the DEF with the def_pct of passives and buffs and the DR of buffs', () => {
    const ctx: SimContext = { grid, skills: SKILLS };
    const mobs = new FakeMobs();
    const combat = new CombatSystem(ctx, { mobs });
    combat.addPlayer(1, 'the');
    const base = combat.profileOf(1)!.stats.def;
    expect(combat.defenseOf(1, 0)).toBeCloseTo(base * 1.08, 6); // kim_than_cong: def_pct +8 %
  });
});
