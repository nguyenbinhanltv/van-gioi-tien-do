/**
 * Class skill kits (D49, docs/11 §2/§4): types, typed data access and static helpers.
 * Every number in `data/skills.json` is "Đề xuất – chờ duyệt"; the balance simulation lives in `skill_sim.ts`.
 */
import { SKILL_DEFINITIONS_JSON } from '../generated.js';
import { statsAt, statsAtX, type Stats } from './stats.js';

export type PathId = 'kiem' | 'phap' | 'the' | 'dan_phu' | 'thuong' | 'dao';
export const PATHS: readonly PathId[] = ['kiem', 'phap', 'the', 'dan_phu', 'thuong', 'dao'];
export type BranchMode = 'solo' | 'team';
export type EffectContext = 'any' | 'solo' | 'group';
export type StatusId = 'stun' | 'root' | 'slow' | 'freeze' | 'knockup' | 'silence';
/** Hard CC (stun / freeze / knock-up / root) can interrupt a boss cast even though bosses are CC-immune (D49). */
export const HARD_CC: readonly StatusId[] = ['stun', 'freeze', 'knockup', 'root'];

export interface SkillScale {
  stat: 'atk' | 'def' | 'hp_max' | 'target_hp_max' | 'mp_max' | 'agi';
  coeff: number;
}
export interface SkillEffect {
  type:
    | 'damage'
    | 'heal'
    | 'shield'
    | 'dot'
    | 'hot'
    | 'status'
    | 'dash'
    | 'knockback'
    | 'pull'
    | 'taunt'
    | 'buff'
    | 'debuff'
    | 'mark'
    | 'detonate'
    | 'summon'
    | 'revive'
    | 'restore_mp'
    | 'passive_stat';
  applies_to?: 'enemy' | 'ally' | 'self' | 'all';
  context?: EffectContext;
  scale?: SkillScale;
  hits?: number;
  duration_ms?: number;
  tick_interval_ms?: number;
  status_id?: StatusId;
  magnitude?: number;
  distance_tiles?: number;
  direction?: 'forward' | 'back';
  radius?: number;
  pen?: number;
  mark_id?: string;
  max_stacks?: number;
  detonate_coeff?: number;
  detonate_radius?: number;
  overheal_to_shield?: number;
  shield_duration_ms?: number;
  explode?: { coeff: number; radius: number };
  stat?: string;
  pvp_mult?: number;
}
export interface SkillShape {
  type: 'single' | 'circle' | 'ring' | 'cone' | 'line';
  anchor?: 'caster' | 'target' | 'ground_point';
  radius?: number;
  inner_radius?: number;
  angle_deg?: number;
  length?: number;
  width?: number;
}
export type SkillTag = 'context_aware' | 'dual_use' | 'cc' | 'interrupt' | 'mobility' | 'sustain' | 'pet';
export interface SkillDef {
  id: string;
  name_key: string;
  desc_key?: string;
  owner: 'player';
  path: PathId;
  kind: 'active' | 'passive';
  tier: 'basic' | 'core' | 'ultimate';
  element: string;
  elemental_rider?: boolean;
  unlock: { level_min: number; realm_min?: string; source?: string };
  targeting: { mode: string; range_tiles?: number; requires_los?: boolean; aim_ui?: string };
  shape: SkillShape;
  timing: {
    cast_ms: number;
    channel_ms?: number;
    channel_ticks?: number;
    recovery_ms?: number;
    cooldown_ms: number;
    gcd?: boolean;
    move_during_cast?: 'lock' | 'slow' | 'free';
    interruptible?: boolean;
    invuln_ms?: number;
  };
  cost?: { mp_pct?: number };
  effects: SkillEffect[];
  tags: SkillTag[];
  anim_clip?: string;
  progression: { max_rank: number; coeff_per_rank?: number; mp_cost_reduction_per_rank?: number };
  vfx?: { cast_fx?: string; projectile_fx?: string; hit_fx?: string; max_draw_calls?: number; instanced?: boolean };
  icon_id?: string;
}
export interface StatWeights {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
}
export interface ClassTrait {
  id: string;
  gain_on: 'hit_dealt' | 'hit_taken' | 'both';
  max_stacks: number;
  duration_ms: number;
  per_stack: { dr_pct?: number; lifesteal?: number; dmg_pct?: number };
}
export interface ClassDef {
  path: PathId;
  name_key: string;
  weapon: string;
  element: string;
  role: string;
  stat_weights: StatWeights;
  basic_attack: { range_tiles: number; interval_ms: number; coeffs: number[] };
  trait?: ClassTrait;
  solo_branch: string;
  team_branch: string;
}
export interface SkillPatch {
  damage_mult?: number;
  cooldown_mult?: number;
  shield_mult?: number;
  buff_mult?: number;
  debuff_mult?: number;
  duration_mult?: number;
}
export interface BranchDef {
  id: string;
  path: PathId;
  mode: BranchMode;
  name_key: string;
  unlock_level: number;
  switch: 'out_of_combat';
  stat_mods: {
    dmg_mult?: number;
    dmg_taken_mult?: number;
    heal_mult?: number;
    shield_mult?: number;
    threat_mult?: number;
    lifesteal_add?: number;
    ally_crit_bonus?: number;
    team_dmg?: number;
    team_dr?: number;
  };
  skill_patches: Record<string, SkillPatch>;
}
export interface SkillDefinitions {
  schema_version: string;
  global: { gcd_ms?: number; max_targets_per_cast?: number; cdr_cap?: number };
  classes: ClassDef[];
  branches: BranchDef[];
  skills: SkillDef[];
}

export const skillDefinitions = SKILL_DEFINITIONS_JSON as SkillDefinitions;

export function classOf(path: PathId, defs: SkillDefinitions = skillDefinitions): ClassDef {
  const c = defs.classes.find((x) => x.path === path);
  if (!c) throw new Error(`unknown class path ${path}`);
  return c;
}
export function branchOf(id: string, defs: SkillDefinitions = skillDefinitions): BranchDef {
  const b = defs.branches.find((x) => x.id === id);
  if (!b) throw new Error(`unknown branch ${id}`);
  return b;
}
export function skillsOf(path: PathId, defs: SkillDefinitions = skillDefinitions): SkillDef[] {
  return defs.skills.filter((s) => s.path === path).sort((a, b) => a.unlock.level_min - b.unlock.level_min);
}

/** Does this effect apply in the given context (solo = no living ally nearby)? */
export function effectActive(e: SkillEffect, grouped: boolean): boolean {
  const c = e.context ?? 'any';
  return c === 'any' || (c === 'group') === grouped;
}

/** f(c) = c² / (c + d), d = DEF/ATK ≈ 0.667 neutral (docs/11 §3.4). */
export function convexity(c: number, d = 2 / 3): number {
  return (c * c) / (c + d);
}
/** E = hits · f(c)/f(1): "basic-hit equivalents" of one skill damage effect. */
export function equivalentHits(coeff: number, hits = 1, d = 2 / 3): number {
  return (hits * convexity(coeff, d)) / convexity(1, d);
}
/** Total damage E of a skill at rank 1 (all `damage` effects, any context). */
export function skillE(s: SkillDef): number {
  return s.effects
    .filter((e) => e.type === 'damage' && e.scale)
    .reduce((n, e) => n + equivalentHits(e.scale!.coeff, e.hits ?? 1), 0);
}

/**
 * Integer stats of a class at (realm, sub-stage) (D117): the realm stats of docs/07 s1 (`statsAt`) times the class `stat_weights`
 * (docs/11 s2), each rounded to the nearest integer; HP and MP never drop below 1.
 */
export function classStatsAt(path: PathId, r: number, k: number, defs: SkillDefinitions = skillDefinitions): Stats {
  const base = statsAt(r, k);
  const w = classOf(path, defs).stat_weights;
  return {
    hp: Math.max(1, Math.round(base.hp * w.hp)),
    mp: Math.max(1, Math.round(base.mp * w.mp)),
    atk: Math.round(base.atk * w.atk),
    def: Math.round(base.def * w.def),
    agi: Math.round(base.agi * w.agi),
  };
}

/**
 * Static TTK matrix (docs/11 §2.2): hits (c = 1, equal stage, neutral, no crit/jitter) for attacker class to kill
 * defender class. `x` selects the stage (default Luyện Khí tầng 1; the table is stage-independent up to rounding).
 */
export function staticTtkMatrix(
  defs: SkillDefinitions = skillDefinitions,
  x = 0,
): Record<PathId, Record<PathId, number>> {
  const base = statsAtX(x);
  const out = {} as Record<PathId, Record<PathId, number>>;
  for (const a of defs.classes) {
    out[a.path] = {} as Record<PathId, number>;
    for (const d of defs.classes) {
      const atk = base.atk * a.stat_weights.atk;
      const def = base.def * d.stat_weights.def;
      const hp = base.hp * d.stat_weights.hp;
      out[a.path][d.path] = Math.ceil(hp / ((atk * atk) / (atk + def)));
    }
  }
  return out;
}
