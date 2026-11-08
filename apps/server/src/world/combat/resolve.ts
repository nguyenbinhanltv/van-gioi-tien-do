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
 * Aim (wire v3): a `ground_point` shape is anchored on the aim point (preferred) or the target; a cone / line is cast toward the aim point
 * instead of the facing. The aim point gets the same reach check as the target.
 *
 * Reach is re-validated HERE, at resolve time, for every point the client influences (the cast's `targetId`): the sim only checks
 * range / LOS of `enemy` / `ally_or_self` skills at ACCEPT time and not at all for `direction` / `ground` skills, and a target can move away
 * during the cast time. A target (or ground anchor) beyond `targeting.range_tiles`, or without line of sight when the skill needs it, is
 * ignored: a single-target skill then hits nobody and an area skill is anchored on the caster.
 *
 * Supported effects: `damage`, `heal`, `shield`. Everything else (dot, status, dash, buff ...) is reported in `unsupported` and has no
 * effect yet (needs the status / buff system).
 */
import { damageBreakdown, effectActive, skillDefinitions } from '@vgtd/shared';
import type { AnyElement, SkillDef, SkillDefinitions, SkillEffect } from '@vgtd/shared';
import { encodeDirection, hypot } from '@vgtd/sim';
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
  /** The cast's aim point in tile coordinates (wire v3), or null / omitted. Re-validated here like the target. */
  aim?: Point | null;
  /** Living hostile entities that can be damaged (mobs). Any order: sorted here. */
  enemies: readonly ResolveTarget[];
  rand: () => number;
  /** Is there a clear line between two points for this caster? Omitted = no LOS check (pure tests). */
  losClear?: (from: Point, to: Point) => boolean;
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

/** The aim point, only if it is finite, within the skill's range of the caster and (when required) in line of sight. */
function reachableAim(i: ResolveInput): Point | undefined {
  const { skill, aim, caster } = i;
  if (!aim || !Number.isFinite(aim.i) || !Number.isFinite(aim.j)) return undefined;
  const range = skill.targeting.range_tiles ?? 0;
  if (range > 0 && hypot(aim.i - caster.i, aim.j - caster.j) > range) return undefined;
  if (skill.targeting.requires_los !== false && i.losClear && !i.losClear(caster, aim)) return undefined;
  return aim;
}

/** Facing the shape is cast along: toward the aim point when given (any direction is allowed), else the caster's facing. */
function castFacing(i: ResolveInput): number {
  const { aim, caster, facing } = i;
  if (!aim || !Number.isFinite(aim.i) || !Number.isFinite(aim.j)) return facing;
  const code = encodeDirection(aim.i - caster.i, aim.j - caster.j);
  return code === 255 ? facing : code;
}

/** The cast's target, only if it is a known enemy within the skill's range and (when required) in line of sight of the caster. */
function reachableTarget(i: ResolveInput): ResolveTarget | undefined {
  const { skill, enemies, targetId, caster } = i;
  const t = targetId !== 0 ? enemies.find((e) => e.id === targetId) : undefined;
  if (!t) return undefined;
  const range = skill.targeting.range_tiles ?? 0;
  if (range > 0 && hypot(t.i - caster.i, t.j - caster.j) > range) return undefined;
  if (skill.targeting.requires_los !== false && i.losClear && !i.losClear(caster, t)) return undefined;
  return t;
}

function victimsOf(i: ResolveInput): ResolveTarget[] {
  const { skill, enemies, caster } = i;
  const facing = castFacing(i);
  const maxTargets = (i.defs ?? skillDefinitions).global.max_targets_per_cast ?? enemies.length;
  const target = reachableTarget(i);
  const shape = skill.shape;
  if (shape.type === 'single') return target ? [target] : [];
  // circle / ring anchored on the caster, the target or the ground point; the wire has no aim point yet, so a ground skill
  // with no target is centred on the caster (OPEN-ITEMS: protocol aim point)
  const aimPoint = shape.anchor === 'ground_point' ? reachableAim(i) : undefined;
  const anchor: Point =
    shape.anchor === 'target' && target
      ? target
      : shape.anchor === 'ground_point' && (aimPoint ?? target)
        ? (aimPoint ?? target!)
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
