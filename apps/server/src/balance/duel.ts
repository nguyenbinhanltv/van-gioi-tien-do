/**
 * Class-balance harness (D115), 1v1 duel model. INFORMATIONAL.
 *
 * The server has no player-versus-player combat yet (casts only hit mobs), so a duel cannot be run on the node. This is a minimal two-body loop on the
 * real resolution function: `makeProfile` (the server's player stats), `resolveCast` (damage with Ngũ hành, crit, pen, suppress, jitter; heal and
 * shield) and the same scripted rotation as the PvE fights. It models cooldowns, the global cooldown, MP, cast time, shields and HP exactly as the
 * combat core does for a player, and nothing else: no movement (both stand 2 tiles apart), no statuses, no pills, no PvP damage multipliers
 * (`pvp_mult` is ignored by the server too), and each side simply fights the other. Read it as "what the class kits do against each other with
 * the effects the server implements", not as a PvP forecast.
 */
import { NETWORK, skillDefinitions, type PathId, type SkillDef, type SkillDefinitions } from '@vgtd/shared';
import { compileSkills, type EntityState } from '@vgtd/sim';
import { makeProfile } from '../world/combat/profile.js';
import { resolveCast, type ResolveTarget } from '../world/combat/resolve.js';
import { branchDefs, type BranchMode } from './defs.js';
import { Rotation } from './rotation.js';

/** Small seeded generator (the harness never touches `Math.random`). */
export function mulberry(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

interface Body {
  path: PathId;
  hpMax: number;
  hp: number;
  shield: number;
  shieldUntilMs: number;
  mp: number;
  mpMax: number;
  cooldowns: number[];
  gcdReadyAt: number;
  rotation: Rotation;
  pending: { at: number; skill: SkillDef; wire: number }[];
  profile: ReturnType<typeof makeProfile>;
}

export interface DuelResult {
  /** 'a' / 'b' won, 'draw' = both alive at the limit */
  winner: 'a' | 'b' | 'draw';
  timeS: number;
  /** HP left of the winner, 0..1 */
  hpLeft: number;
}

export function runDuel(
  a: PathId,
  b: PathId,
  mode: BranchMode,
  realm: number,
  subStage: number,
  seed: number,
  limitS = 180,
  base: SkillDefinitions = skillDefinitions,
): DuelResult {
  let defs = branchDefs(a, mode, base);
  defs = branchDefs(b, mode, defs);
  const sim = compileSkills(defs);
  const rand = mulberry(seed);
  const make = (path: PathId): Body => {
    const profile = makeProfile(path, realm, subStage, defs);
    return {
      path,
      hpMax: profile.stats.hp,
      hp: profile.stats.hp,
      shield: 0,
      shieldUntilMs: 0,
      mp: profile.stats.mp,
      mpMax: profile.stats.mp,
      cooldowns: new Array<number>(sim.length).fill(0),
      gcdReadyAt: 0,
      rotation: new Rotation(path === a ? 1 : 2, path, defs, sim),
      pending: [],
      profile,
    };
  };
  // the same class on both sides gets two independent bodies (ids 1 and 2)
  const bodies = [make(a), make(b)];
  bodies[0]!.rotation = new Rotation(1, a, defs, sim);
  bodies[1]!.rotation = new Rotation(2, b, defs, sim);
  const tickMs = NETWORK.TICK_MS;
  const entity = (x: Body, i: number, j: number): EntityState =>
    ({
      i,
      j,
      mp: x.mp,
      mpMax: x.mpMax,
      cooldowns: x.cooldowns,
      gcdReadyAt: x.gcdReadyAt,
      stunMs: 0,
      hp: x.hp,
    }) as unknown as EntityState;
  const asTarget = (x: Body, id: number, at: { i: number; j: number }): ResolveTarget => ({
    id,
    i: at.i,
    j: at.j,
    hpMax: x.hpMax,
    // a player's defence: the same 07 §1 curve every player has (the server gives no class weights)
    defense: x.profile.stats.def,
    realm: x.profile.realm,
    element: x.profile.element,
  });
  const pos = [
    { i: 10, j: 10 },
    { i: 12, j: 10 },
  ];
  const ticks = Math.ceil((limitS * 1000) / tickMs);
  for (let k = 0; k < ticks; k++) {
    const now = k * tickMs;
    for (let s = 0; s < 2; s++) {
      const me = bodies[s]!;
      const foe = bodies[1 - s]!;
      if (me.hp <= 0) continue;
      // resolve casts whose cast time is over
      for (const p of me.pending.filter((x) => x.at <= now)) {
        const out = resolveCast({
          casterId: s + 1,
          caster: pos[s]!,
          facing: 0,
          profile: me.profile,
          skill: p.skill,
          targetId: 2 - s,
          aim: pos[1 - s]!,
          enemies: [asTarget(foe, 2 - s, pos[1 - s]!)],
          rand,
          defs,
        });
        for (const h of out.hits) {
          const absorbed = now < foe.shieldUntilMs ? Math.min(foe.shield, h.damage) : 0;
          foe.shield -= absorbed;
          foe.hp -= h.damage - absorbed;
        }
        if (out.heal > 0) me.hp = Math.min(me.hpMax, me.hp + out.heal);
        if (out.shield > 0) {
          me.shield = out.shield;
          me.shieldUntilMs = now + out.shieldDurationMs;
        }
      }
      me.pending = me.pending.filter((x) => x.at > now);
      if (foe.hp <= 0) break;
      const cast = me.rotation.next(
        now,
        entity(me, pos[s]!.i, pos[s]!.j),
        entity(foe, pos[1 - s]!.i, pos[1 - s]!.j),
        [{ id: s + 1, hpPct: me.hp / me.hpMax }],
        2 - s,
      );
      if (!cast) continue;
      const data = defs.skills.find((d) => d.id === sim[cast.skillId]!.key)!;
      const simSkill = sim[cast.skillId]!;
      me.mp -= Math.max(0, Math.ceil(simSkill.mpCostPct * me.mpMax - 1e-9));
      me.cooldowns[cast.skillId] = now + simSkill.cooldownMs;
      me.gcdReadyAt = now + simSkill.gcdMs;
      me.pending.push({ at: now + data.timing.cast_ms, skill: data, wire: cast.skillId });
    }
    // out-of-combat regeneration is not modelled; MP regenerates 1 % of max per second while fighting (the combat rate of D88)
    for (const x of bodies) if (x.hp > 0) x.mp = Math.min(x.mpMax, x.mp + (x.mpMax * 0.01 * tickMs) / 1000);
    if (bodies[0]!.hp <= 0 || bodies[1]!.hp <= 0) {
      const w = bodies[0]!.hp > 0 ? 0 : bodies[1]!.hp > 0 ? 1 : -1;
      if (w < 0) return { winner: 'draw', timeS: (k * tickMs) / 1000, hpLeft: 0 };
      return { winner: w === 0 ? 'a' : 'b', timeS: (k * tickMs) / 1000, hpLeft: bodies[w]!.hp / bodies[w]!.hpMax };
    }
  }
  return { winner: 'draw', timeS: limitS, hpLeft: 0 };
}
