/**
 * Pure resolution of one accepted cast: who is hit, for how much. No state, no clock, no ambient randomness: the caller supplies `rand`
 * (uniform [0, 1)) and the draw order below is part of the contract (golden tests pin it):
 *
 *   for each `damage` effect (data order, only effects active in the solo context)
 *     for each victim (nearest to the anchor first, ties by id; at most `global.max_targets_per_cast`)
 *       for each hit (`hits ?? 1`):  crit = rand() < critChance;  jitter = rand()
 *
 * Damage = `damageBreakdown` of `@vgtd/shared` (07 §4): Raw = stat x coeff, DEF_eff with Ngũ hành and Pen, Raw^2 / (Raw + DEF_eff) x M_elem x Crit x
 * Suppress x U(0.95, 1.05); rounded to an integer >= 1.
 *
 * Supported effects: `damage`, `heal`, `shield`. Everything else (dot, status, dash, buff ...) is reported in `unsupported` and has no
 * effect yet (needs the status / buff system).
 */
import { damageBreakdown, effectActive, skillDefinitions } from '@vgtd/shared';
import type { AnyElement, SkillDef, SkillDefinitions, SkillEffect } from '@vgtd/shared';
import { hypot } from '@vgtd/sim';
import { inShape, type Point } from './geometry.js';
import type { CombatProfile } from './types.js';

export interface ResolveTarget {
  id: number;
  i: number;
  j: number;
  hpMax: number;
  defense: number;
  realm: number;
  element: AnyElement | null;
}

export interface ResolveInput {
  casterId: number;
  caster: Point;
  facing: number;
  profile: CombatProfile;
  skill: SkillDef;
  /** The cast's `targetId` (0 = none). */
  targetId: number;
  /** Living hostile entities that can be damaged (mobs). Any order: sorted here. */
  enemies: readonly ResolveTarget[];
  rand: () => number;
  defs?: SkillDefinitions;
}

export interface HitOutcome {
  targetId: number;
  damage: number;
  crit: boolean;
}

export interface CastOutcome {
  hits: HitOutcome[];
  /** Heal / shield amounts go to `supportTargetId` (an ally when the skill is `ally_or_self` and one was targeted, else the caster). */
  heal: number;
  shield: number;
  shieldDurationMs: number;
  /** Effect types that were not simulated. */
  unsupported: string[];
}

function statValue(e: SkillEffect, p: CombatProfile, victimHpMax: number): number {
  switch (e.scale?.stat) {
    case 'atk':
      return p.stats.atk;
    case 'def':
      return p.stats.def;
    case 'hp_max':
      return p.stats.hp;
    case 'mp_max':
      return p.stats.mp;
    case 'agi':
      return p.stats.agi;
    case 'target_hp_max':
      return victimHpMax;
    default:
      return 0;
  }
}

/** Element a skill attacks with: `root_main` = the class main element, `none` = no Ngũ hành effect. */
export function skillElement(skill: SkillDef, profile: CombatProfile): AnyElement | undefined {
  if (skill.element === 'root_main') return profile.element;
  if (skill.element === 'none') return undefined;
  return skill.element as AnyElement;
}

function victimsOf(i: ResolveInput): ResolveTarget[] {
  const { skill, enemies, targetId, caster, facing } = i;
  const maxTargets = (i.defs ?? skillDefinitions).global.max_targets_per_cast ?? enemies.length;
  const target = targetId !== 0 ? enemies.find((e) => e.id === targetId) : undefined;
  const shape = skill.shape;
  if (shape.type === 'single') return target ? [target] : [];
  // circle / ring anchored on the caster, the target or the ground point; the wire has no aim point yet, so a ground skill
  // with no target is centred on the caster (OPEN-ITEMS: protocol aim point)
  const anchor: Point =
    shape.anchor === 'target' && target
      ? target
      : shape.anchor === 'ground_point' && target
        ? target
        : { i: caster.i, j: caster.j };
  const inside = enemies.filter((e) => inShape(shape, caster, facing, anchor, e));
  inside.sort((a, b) => hypot(a.i - anchor.i, a.j - anchor.j) - hypot(b.i - anchor.i, b.j - anchor.j) || a.id - b.id);
  return inside.slice(0, maxTargets);
}

export function resolveCast(i: ResolveInput): CastOutcome {
  const { skill, profile, rand } = i;
  const out: CastOutcome = { hits: [], heal: 0, shield: 0, shieldDurationMs: 0, unsupported: [] };
  const attackerElement = skillElement(skill, profile);
  const byTarget = new Map<number, HitOutcome>();
  for (const e of skill.effects) {
    if (!effectActive(e, false)) continue;
    if (e.type === 'damage' && e.scale) {
      for (const v of victimsOf(i)) {
        const hits = Math.max(1, e.hits ?? 1);
        for (let h = 0; h < hits; h++) {
          const crit = rand() < profile.critChance;
          const jitter = rand();
          const b = damageBreakdown({
            atk: statValue(e, profile, v.hpMax),
            def: v.defense,
            cSkill: e.scale.coeff,
            attackerElement,
            defenderElement: v.element ?? undefined,
            pen: (e.pen ?? 0) + profile.pen,
            crit,
            attackerRealm: profile.realm,
            defenderRealm: v.realm,
            rand: jitter,
          });
          const dmg = Math.max(1, Math.round(b.damage));
          const cur = byTarget.get(v.id);
          if (cur) {
            cur.damage += dmg;
            cur.crit ||= crit;
          } else byTarget.set(v.id, { targetId: v.id, damage: dmg, crit });
        }
      }
    } else if (e.type === 'heal' && e.scale) {
      out.heal += Math.round(statValue(e, profile, 0) * e.scale.coeff * Math.max(1, e.hits ?? 1));
    } else if (e.type === 'shield' && e.scale) {
      out.shield += Math.round(statValue(e, profile, 0) * e.scale.coeff);
      out.shieldDurationMs = Math.max(out.shieldDurationMs, e.shield_duration_ms ?? e.duration_ms ?? 0);
    } else if (e.type !== 'passive_stat') {
      out.unsupported.push(e.type);
    }
  }
  out.hits = [...byTarget.values()];
  return out;
}
