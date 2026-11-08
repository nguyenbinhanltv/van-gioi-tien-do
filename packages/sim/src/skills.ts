/**
 * Runtime skill table for the sim, compiled from the real D49 skill data in `@vgtd/shared`
 * (`skillDefinitions`, docs/11-he-phai-ky-nang.md). The wire carries a small integer `skillId`
 * (index into the compiled table, < MAX_SKILLS); the string id stays the source of truth.
 */
import { skillDefinitions, type SkillDef as DataSkillDef, type SkillDefinitions } from '@vgtd/shared';
import { MAX_SKILLS } from './constants.js';

/** `none`: no target entity (self / ground / direction). `enemy` / `ally_or_self`: a targetId is required. */
export type SkillTargeting = 'none' | 'enemy' | 'ally_or_self';

export interface SkillDef {
  /** wire id = index in the compiled table */
  id: number;
  /** data id, e.g. "kiem_tu.xxx" */
  key: string;
  cooldownMs: number;
  /** shared global cooldown applied after the cast (0 when the skill ignores GCD) */
  gcdMs: number;
  /** MP cost as a fraction of the caster's max MP (data `cost.mp_pct`) */
  mpCostPct: number;
  /** max distance to the target in tiles; 0 = no target distance check */
  range: number;
  /** line of sight is required for targeted skills unless the data says `requires_los: false` */
  requiresLos: boolean;
  targeting: SkillTargeting;
}

/** Fallback global cooldown when the data omits `global.gcd_ms` (mirrors the shared skill sim). */
const DEFAULT_GCD_MS = 800;

export function toSimSkill(d: DataSkillDef, id: number, defs: SkillDefinitions = skillDefinitions): SkillDef {
  const mode = d.targeting.mode;
  const targeting: SkillTargeting = mode === 'enemy' ? 'enemy' : mode === 'ally_or_self' ? 'ally_or_self' : 'none';
  return {
    id,
    key: d.id,
    cooldownMs: d.timing.cooldown_ms,
    gcdMs: d.timing.gcd === false ? 0 : (defs.global.gcd_ms ?? DEFAULT_GCD_MS),
    mpCostPct: d.cost?.mp_pct ?? 0,
    range: targeting === 'none' ? 0 : (d.targeting.range_tiles ?? 0),
    requiresLos: targeting !== 'none' && d.targeting.requires_los !== false,
    targeting,
  };
}

/** Active skills only (passives cannot be cast), in data order so ids are stable for a given data version. */
export function compileSkills(defs: SkillDefinitions = skillDefinitions): SkillDef[] {
  const active = defs.skills.filter((s) => s.kind === 'active');
  if (active.length > MAX_SKILLS) throw new Error(`too many active skills (${active.length} > ${MAX_SKILLS})`);
  return active.map((s, k) => toSimSkill(s, k, defs));
}

/** Absolute MP cost for a caster. */
export function mpCostOf(skill: SkillDef, mpMax: number): number {
  return Math.max(0, Math.ceil(skill.mpCostPct * mpMax - 1e-9));
}
