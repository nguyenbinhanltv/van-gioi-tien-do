/**
 * Class-balance harness (D115), skill data helpers.
 *
 * The server combat core (`resolveCast`) only simulates `damage`, `heal` and `shield` effects; everything else a kit has (dots, statuses,
 * buffs, marks, summons, dashes, taunts ...) is reported as `unsupported` and does nothing yet. `kitCoverage` measures how much of each class
 * kit that leaves, and `branchDefs` applies a branch (solo / team) to the skill data the way the shared design simulation does, as far as
 * the real combat core can express it: skill patches (`damage_mult`, `cooldown_mult`, `shield_mult`) and the branch `stat_mods` that map onto a
 * coefficient (`dmg_mult`, `heal_mult`, `shield_mult`). Stat mods the server has no hook for (`dmg_taken_mult`, `threat_mult`, `lifesteal_add`,
 * `ally_crit_bonus`, `team_dmg`, `team_dr`) are NOT applied and are listed by `unmodelledBranchMods`. Pure data transforms: no numbers are
 * changed in the shipped data.
 */
import {
  PATHS,
  effectActive,
  equivalentHits,
  skillDefinitions,
  type BranchDef,
  type PathId,
  type SkillDef,
  type SkillDefinitions,
  type SkillEffect,
} from '@vgtd/shared';

export type BranchMode = 'solo' | 'team';

/** The branch of a class for a mode. */
export function branchFor(path: PathId, mode: BranchMode, defs: SkillDefinitions = skillDefinitions): BranchDef {
  const cls = defs.classes.find((c) => c.path === path)!;
  const id = mode === 'solo' ? cls.solo_branch : cls.team_branch;
  return defs.branches.find((b) => b.id === id)!;
}

const SUPPORTED: ReadonlySet<SkillEffect['type']> = new Set(['damage', 'heal', 'shield', 'passive_stat']);

/** Stat mods of a branch the real combat core cannot express (they stay out of the harness and are listed in the report). */
export function unmodelledBranchMods(b: BranchDef): string[] {
  const m = b.stat_mods;
  const out: string[] = [];
  for (const k of ['dmg_taken_mult', 'threat_mult', 'lifesteal_add', 'ally_crit_bonus', 'team_dmg', 'team_dr'] as const)
    if (m[k] !== undefined) out.push(`${k}=${m[k]}`);
  return out;
}

function scaleEffect(e: SkillEffect, mult: number): SkillEffect {
  return e.scale ? { ...e, scale: { ...e.scale, coeff: e.scale.coeff * mult } } : e;
}

/** Skill data with the branch applied (only for `path`; the other classes keep their data). */
export function branchDefs(
  path: PathId,
  mode: BranchMode,
  defs: SkillDefinitions = skillDefinitions,
): SkillDefinitions {
  const b = branchFor(path, mode, defs);
  const sm = b.stat_mods;
  const skills = defs.skills.map((s): SkillDef => {
    if (s.path !== path) return s;
    const p = b.skill_patches[s.id] ?? {};
    const effects = s.effects.map((e) => {
      if (e.type === 'damage') return scaleEffect(e, (p.damage_mult ?? 1) * (sm.dmg_mult ?? 1));
      if (e.type === 'heal' || e.type === 'hot') return scaleEffect(e, sm.heal_mult ?? 1);
      if (e.type === 'shield') return scaleEffect(e, (p.shield_mult ?? 1) * (sm.shield_mult ?? 1));
      return e;
    });
    const timing = p.cooldown_mult ? { ...s.timing, cooldown_ms: s.timing.cooldown_ms * p.cooldown_mult } : s.timing;
    return { ...s, effects, timing };
  });
  return { ...defs, skills };
}

export interface KitCoverage {
  path: PathId;
  /** active skills whose every effect the server simulates / skills with at least one simulated effect / all active skills */
  fullySupported: number;
  partlySupported: number;
  active: number;
  /** share of the kit's damage (in basic-hit equivalents, solo context) that the server resolves: 1 = all of it */
  damageShare: number;
  /** effect types of the kit that have no effect on the server yet, with the number of skills using each */
  unsupportedTypes: Record<string, number>;
}

/** How much of a class kit the real combat core simulates (docs/34, `resolveCast`: damage / heal / shield only). */
export function kitCoverage(path: PathId, defs: SkillDefinitions = skillDefinitions): KitCoverage {
  const skills = defs.skills.filter((s) => s.path === path && s.kind === 'active');
  let full = 0;
  let part = 0;
  const types: Record<string, number> = {};
  let dmgAll = 0;
  let dmgSupported = 0;
  for (const s of skills) {
    const eff = s.effects.filter((e) => e.type !== 'passive_stat' && effectActive(e, false));
    const unsupported = eff.filter((e) => !SUPPORTED.has(e.type));
    if (unsupported.length === 0) full++;
    else if (unsupported.length < eff.length) part++;
    for (const t of new Set(unsupported.map((e) => e.type))) types[t] = (types[t] ?? 0) + 1;
    for (const e of eff) {
      if (e.type === 'damage' && e.scale) dmgSupported += equivalentHits(e.scale.coeff, e.hits ?? 1);
      // damage the kit gets from effects the server ignores (dots, detonations, explosions, summons)
      if ((e.type === 'dot' || e.type === 'detonate' || e.type === 'summon') && (e.scale || e.detonate_coeff))
        dmgAll += equivalentHits(e.scale?.coeff ?? e.detonate_coeff ?? 0, e.hits ?? 1);
    }
  }
  return {
    path,
    fullySupported: full,
    partlySupported: part,
    active: skills.length,
    damageShare: dmgSupported + dmgAll > 0 ? dmgSupported / (dmgSupported + dmgAll) : 1,
    unsupportedTypes: types,
  };
}

export const ALL_PATHS: readonly PathId[] = PATHS;
