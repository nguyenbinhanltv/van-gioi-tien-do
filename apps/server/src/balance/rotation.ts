/**
 * The scripted player of the class-balance harness (D115): a greedy rotation driven only by the skill data, never by skill ids, the way the design
 * simulation of docs/11 §4.5 plays. One decision per tick, as a real client sends one cast at a time:
 *
 *  1. a heal when an ally (or itself) is below 65 % HP, aimed at the most hurt one;
 *  2. a shield whenever it is ready (no cost to waiting: the server only keeps the amount for its duration);
 *  3. a utility skill (control, buff, debuff, mark, taunt, dot ...: D116) whenever it is ready and in reach: it costs nothing to use;
 *  4. otherwise the damage skill with the best damage-per-second of cast time among the ready ones (damage in basic-hit equivalents, so a
 *     cooldown skill wins when it is ready and the basic attack fills the gaps).
 *
 * A skill is cast only when the server would accept it (cooldown, GCD, MP, not stunned, in reach, not in the middle of an earlier cast), so the
 * anti-cheat never sees a rejected cast. Skills whose every effect the combat core ignores (see `kitCoverage`; none of the shipped data since
 * D116) are not cast. Positional skills (dash, knock-back, pull, revive) are not cast: the scripted player never moves and has no corpse to raise;
 * effects that need a party (`context: group`) are inactive here, the harness has no party service.
 */
import { equivalentHits, type PathId, type SkillDef, type SkillDefinitions, type SkillEffect } from '@vgtd/shared';
import { mpCostOf, type EntityState, type SkillDef as SimSkill } from '@vgtd/sim';
import { quantizePos, type SkillCastMsg } from '@vgtd/protocol';
import { STATE_EFFECTS } from '../world/combat/resolve.js';

const SUPPORTED: ReadonlySet<SkillEffect['type']> = new Set<SkillEffect['type']>([
  'damage',
  'heal',
  'shield',
  ...STATE_EFFECTS,
]);
/** utility effects the scripted player uses (the positional ones are left out) */
const UTILITY: ReadonlySet<SkillEffect['type']> = new Set<SkillEffect['type']>([
  'status',
  'dot',
  'hot',
  'buff',
  'debuff',
  'mark',
  'detonate',
  'taunt',
  'restore_mp',
]);
const HURTBOX = 0.45;
const HEAL_BELOW = 0.65;

interface Entry {
  sim: SimSkill;
  data: SkillDef;
  /** per-skill numbers */
  damageE: number;
  heals: boolean;
  shields: boolean;
  /** no damage / heal / shield, only utility effects */
  utility: boolean;
  busyMs: number;
  reach: number;
}

function reachOf(s: SkillDef): number {
  const t = s.targeting;
  const sh = s.shape;
  const shape = sh.type === 'line' ? (sh.length ?? 0) : (sh.radius ?? 0);
  if (t.mode === 'enemy' || t.mode === 'ally_or_self') return t.range_tiles ?? shape;
  if (sh.anchor === 'ground_point') return t.range_tiles ?? shape;
  return shape;
}

export class Rotation {
  private readonly skills: Entry[] = [];
  private seq = 0;
  private busyUntil = 0;

  constructor(
    private readonly id: number,
    path: PathId,
    defs: SkillDefinitions,
    sim: readonly SimSkill[],
  ) {
    for (const data of defs.skills) {
      if (data.path !== path || data.kind !== 'active') continue;
      const s = sim.find((x) => x.key === data.id);
      if (!s) continue;
      const eff = data.effects.filter((e) => e.type !== 'passive_stat' && (e.context ?? 'any') !== 'group');
      if (!eff.some((e) => SUPPORTED.has(e.type))) continue; // does nothing on the server
      const t = data.timing;
      this.skills.push({
        sim: s,
        data,
        damageE: eff
          .filter((e) => e.type === 'damage' && e.scale)
          .reduce((n, e) => n + equivalentHits(e.scale!.coeff, e.hits ?? 1), 0),
        heals: eff.some((e) => e.type === 'heal'),
        shields: eff.some((e) => e.type === 'shield'),
        utility:
          !eff.some((e) => e.type === 'damage' || e.type === 'heal' || e.type === 'shield') &&
          eff.some((e) => UTILITY.has(e.type)),
        busyMs: Math.max(s.gcdMs, t.cast_ms + (t.channel_ms ?? 0) + (t.recovery_ms ?? 0)),
        reach: reachOf(data),
      });
    }
  }

  /** The cast to send this tick, or null. `allies` includes this player. */
  next(
    nowMs: number,
    me: EntityState,
    mob: EntityState,
    allies: readonly { id: number; hpPct: number }[],
    mobId: number,
  ): SkillCastMsg | null {
    if (nowMs < this.busyUntil || me.stunMs > 0 || nowMs < me.gcdReadyAt) return null;
    const dist = Math.hypot(me.i - mob.i, me.j - mob.j);
    const ready = (e: Entry): boolean => (me.cooldowns[e.sim.id] ?? 0) <= nowMs && me.mp >= mpCostOf(e.sim, me.mpMax);
    const hurt = [...allies].sort((a, b) => a.hpPct - b.hpPct)[0];
    const castOf = (e: Entry, targetId: number, aimAtMob: boolean): SkillCastMsg => {
      this.busyUntil = nowMs + e.busyMs;
      const aim = aimAtMob && dist <= e.reach ? { qi: quantizePos(mob.i), qj: quantizePos(mob.j) } : null;
      return { type: 'skill_cast', seq: ++this.seq & 0xffff, skillId: e.sim.id, targetId, aim };
    };
    // 1. heal the most hurt ally
    if (hurt && hurt.hpPct < HEAL_BELOW) {
      const h = this.skills.find((e) => e.heals && ready(e));
      if (h) return castOf(h, h.sim.targeting === 'ally_or_self' ? hurt.id : 0, false);
    }
    // 2. shields whenever ready (while the fight is on)
    const sh = this.skills.find((e) => e.shields && !e.heals && ready(e));
    if (sh) return castOf(sh, sh.sim.targeting === 'ally_or_self' ? (hurt?.id ?? this.id) : 0, false);
    // 3. utility skills whenever ready (and, when they target enemies, in reach)
    const ut = this.skills.find((e) => {
      if (!e.utility || !ready(e)) return false;
      if (e.sim.targeting === 'enemy') return dist <= e.reach;
      return e.reach <= 0 || dist <= e.reach + HURTBOX;
    });
    if (ut) return castOf(ut, ut.sim.targeting === 'enemy' ? mobId : 0, ut.reach > 0);
    // 4. the best damage skill that is ready and in reach
    let best: Entry | null = null;
    let bestScore = 0;
    for (const e of this.skills) {
      if (e.damageE <= 0 || !ready(e)) continue;
      const needs = e.sim.targeting === 'enemy' ? e.reach : e.reach + HURTBOX;
      if (needs > 0 && dist > needs + (e.sim.targeting === 'enemy' ? 0 : HURTBOX)) continue;
      const score = e.damageE / (e.busyMs / 1000);
      if (score > bestScore) {
        bestScore = score;
        best = e;
      }
    }
    return best ? castOf(best, best.sim.targeting === 'enemy' ? mobId : 0, true) : null;
  }
}
