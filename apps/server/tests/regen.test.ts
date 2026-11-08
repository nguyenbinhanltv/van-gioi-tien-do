import { describe, expect, it } from 'vitest';
import { NETWORK, REGEN } from '@vgtd/shared';
import {
  TileGrid,
  compileSkills,
  createWorld,
  spawnEntity,
  step,
  type EntityState,
  type SimContext,
  type SimInput,
  type SimWorld,
} from '@vgtd/sim';
import { CombatSystem, type MobCombatStats, type MobPort } from '../src/index.js';

const MOB = 1_000_001;
const ctx: SimContext = {
  grid: TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64))),
  skills: compileSkills(),
};
const TICK = NETWORK.TICK_MS;

class FakeMobs implements MobPort {
  killed: number[] = [];
  combatStats(id: number): MobCombatStats | undefined {
    return id === MOB && !this.killed.length
      ? { defense: 40, realm: 1, element: 'moc', dropSource: 'field', hpMax: 100_000 }
      : undefined;
  }
  kill(world: SimWorld, id: number): SimWorld {
    this.killed.push(id);
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }
}

interface Rig {
  combat: CombatSystem;
  world: SimWorld;
  meditating: Set<number>;
  hpMax: number;
  mpMax: number;
  me(): EntityState;
  /** one tick with the real combat pipeline (preStep, sim step, postStep) */
  tick(inputs?: SimInput[]): void;
  /** postStep only: no sim step, no inputs (regeneration depends on nothing else) */
  idle(ms: number): void;
  set(hp: number, mp: number): void;
}

function rig(withMob = false): Rig {
  const meditating = new Set<number>();
  const mobs = new FakeMobs();
  const combat = new CombatSystem(ctx, {
    seed: 1,
    mobs: withMob ? mobs : undefined,
    isMeditating: (id) => meditating.has(id),
  });
  const st = combat.addPlayer(1, 'kiem');
  let world = spawnEntity(createWorld(1), { id: 1, i: 20.5, j: 20.5, hp: st.hpMax, mpMax: st.mpMax });
  if (withMob) world = spawnEntity(world, { id: MOB, i: 22.5, j: 20.5, hp: 100_000, mpMax: 0 });
  const r: Rig = {
    combat,
    world,
    meditating,
    hpMax: st.hpMax,
    mpMax: st.mpMax,
    me: () => r.world.entities.find((e) => e.id === 1)!,
    tick(inputs = []) {
      const pre = combat.preStep(inputs as never, r.world);
      const s = step(r.world, pre.inputs, ctx, TICK);
      r.world = combat.postStep(s.world, s.events).world;
    },
    idle(ms) {
      for (let k = 0; k < Math.round(ms / TICK); k++) {
        const w = { ...r.world, tick: r.world.tick + 1, timeMs: r.world.timeMs + TICK };
        r.world = combat.postStep(w, []).world;
      }
    },
    set(hp, mp) {
      r.world = { ...r.world, entities: r.world.entities.map((e) => (e.id === 1 ? { ...e, hp, mp } : e)) };
    },
  };
  return r;
}

const near = (a: number, b: number, tol: number): void => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol);
const SECOND = 1000;

describe('server HP / MP regeneration (D88)', () => {
  it('a new player is out of combat: HP and MP regenerate at the idle rates (docs/11 §2.4 MP 4 %/s, HP placeholder 2 %/s)', () => {
    const r = rig();
    r.set(Math.round(r.hpMax * 0.5), 0);
    r.idle(10 * SECOND);
    near(r.me().mp, r.mpMax * REGEN.mpIdlePctPerS * 10, 2);
    near(r.me().hp, r.hpMax * 0.5 + r.hpMax * REGEN.hpIdlePctPerS * 10, 2);
  });

  it('regeneration is applied in 4 Hz steps, never above the maximum, and a full bar stays full', () => {
    const r = rig();
    r.set(r.hpMax - 1, r.mpMax - 1);
    r.idle(5 * SECOND);
    expect(r.me().hp).toBe(r.hpMax);
    expect(r.me().mp).toBe(r.mpMax);
    r.idle(2 * SECOND);
    expect(r.me().hp).toBe(r.hpMax);
    // vitals change only every REGEN.periodTicks ticks
    r.set(0 + Math.round(r.hpMax * 0.2), 0);
    const seen: number[] = [];
    for (let k = 0; k < 20; k++) {
      r.idle(TICK);
      seen.push(r.me().mp);
    }
    const changes = seen.filter((v, k) => k > 0 && v !== seen[k - 1]).length;
    expect(changes).toBeLessThanOrEqual(Math.ceil(20 / REGEN.periodTicks));
    expect(changes).toBeGreaterThan(0);
  });

  it('after taking damage only the in-combat MP trickle applies (1 %/s, no HP) until the out-of-combat delay passes', () => {
    const r = rig();
    r.set(Math.round(r.hpMax * 0.5), 0);
    const hit = r.combat.damagePlayer(r.world, 1, 10, MOB);
    r.world = hit.world;
    const hp0 = r.me().hp;
    r.idle(REGEN.outOfCombatDelayMs - TICK * 5); // still inside the window
    expect(r.me().hp).toBe(hp0); // no HP regeneration in combat
    near(r.me().mp, r.mpMax * REGEN.mpCombatPctPerS * ((REGEN.outOfCombatDelayMs - TICK * 5) / 1000), 2);
    r.idle(TICK * 10); // past the window
    r.idle(4 * SECOND);
    expect(r.me().hp).toBeGreaterThan(hp0 + r.hpMax * REGEN.hpIdlePctPerS * 3); // HP regeneration has started
  });

  it('dealing damage counts as combat too (a cast that hits a mob holds back HP regeneration)', () => {
    const r = rig(true);
    const skillId = ctx.skills.find((s) => s.key === 'kiem_khi_tram')!.id;
    r.set(Math.round(r.hpMax * 0.5), r.mpMax);
    r.tick([
      { kind: 'cast', entityId: 1, seq: 1, skillId, targetId: MOB, rttMs: 0, aim: { i: 25, j: 20.5 } } as SimInput,
    ]);
    for (let k = 0; k < 20; k++) r.tick(); // the cast resolves after its cast time
    const mob = r.world.entities.find((e) => e.id === MOB)!;
    expect(mob.hp).toBeLessThan(100_000); // the hit landed
    const hp = r.me().hp;
    for (let k = 0; k < 40; k++) r.tick(); // 2 s later, still inside the 5 s window
    expect(r.me().hp).toBe(hp);
  });

  it('meditating raises out-of-combat MP to 8 %/s (docs/11 §2.4) but not HP, and not while in combat', () => {
    const idle = rig();
    idle.set(idle.hpMax, 0);
    idle.idle(5 * SECOND);
    const med = rig();
    med.set(med.hpMax, 0);
    med.meditating.add(1);
    med.idle(5 * SECOND);
    near(idle.me().mp, idle.mpMax * REGEN.mpIdlePctPerS * 5, 2);
    near(med.me().mp, med.mpMax * REGEN.mpMeditationPctPerS * 5, 2);
    // in combat the meditation bonus does not apply
    const fight = rig();
    fight.set(fight.hpMax, 0);
    fight.meditating.add(1);
    fight.world = fight.combat.damagePlayer(fight.world, 1, 1, MOB).world;
    fight.set(fight.hpMax, 0);
    fight.idle(3 * SECOND);
    near(fight.me().mp, fight.mpMax * REGEN.mpCombatPctPerS * 3, 2);
  });

  it('a dead player does not regenerate; the respawn restores full HP / MP as before', () => {
    const r = rig();
    r.world = r.combat.damagePlayer(r.world, 1, r.hpMax * 10, MOB).world; // dies
    r.set(0, 0);
    r.idle(5 * SECOND);
    expect(r.me().hp).toBe(0);
    expect(r.me().mp).toBe(0);
    r.idle(10 * SECOND); // the 10 s respawn delay passes
    expect(r.me().hp).toBe(r.hpMax);
    expect(r.me().mp).toBe(r.mpMax);
  });

  it('is deterministic: the same script gives the same vitals and the same combat state digest', () => {
    const run = (): { hp: number; mp: number; digest: string } => {
      const r = rig();
      r.set(Math.round(r.hpMax * 0.3), Math.round(r.mpMax * 0.1));
      r.world = r.combat.damagePlayer(r.world, 1, 5, MOB).world;
      r.idle(3 * SECOND);
      r.meditating.add(1);
      r.idle(9 * SECOND);
      return { hp: r.me().hp, mp: r.me().mp, digest: r.combat.stateDigest() };
    };
    expect(run()).toEqual(run());
  });

  it('the first-session budget works out: with regeneration a full bar is spent and refilled in well under a minute out of combat', () => {
    const r = rig();
    r.set(r.hpMax, 0);
    r.idle(25 * SECOND); // 4 %/s of max = full in 25 s
    expect(r.me().mp).toBe(r.mpMax);
  });
});
