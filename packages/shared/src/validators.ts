/**
 * JSON Schema (draft 2020-12, via Ajv) validation plus the extra "CI script" checks that the
 * schema cannot express (Công thức §8–9).
 */
import * as Ajv2020Module from 'ajv/dist/2020.js';
import {
  APPROVED_STAT_TABLE,
  type ElementalMatrix,
  type RealmProgression,
  elementalMatrixSchema,
  realmProgressionSchema,
  skillDefinitionsSchema,
} from './data.js';
import { PATHS, type SkillDefinitions, skillE } from './formulas/skills.js';
import { ELEMENTS } from './formulas/combat.js';

// Ajv is CJS; under NodeNext/ESM the constructor may be on `.default` or the namespace itself.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile(
    schema: unknown,
  ): ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
};
const Ajv: AjvCtor = ((Ajv2020Module as unknown as { default?: { default?: AjvCtor } & AjvCtor }).default?.default ??
  (Ajv2020Module as unknown as { default?: AjvCtor }).default ??
  (Ajv2020Module as unknown as AjvCtor)) as AjvCtor;

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

const ajv = new Ajv({ allErrors: true, strict: true, strictRequired: false });
const validateRealmSchema = ajv.compile(realmProgressionSchema);
const validateElementalSchema = ajv.compile(elementalMatrixSchema);
const validateSkillSchema = ajv.compile(skillDefinitionsSchema);

function schemaErrors(v: { errors?: { instancePath: string; message?: string }[] | null }): string[] {
  return (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message ?? 'invalid'}`);
}

const EPS = 1e-9;
const close = (a: number, b: number, eps = EPS) => Math.abs(a - b) <= eps;

/** Schema-only validation. */
export function validateRealmProgressionSchema(data: unknown): ValidationResult {
  const ok = validateRealmSchema(data);
  return { valid: ok, errors: ok ? [] : schemaErrors(validateRealmSchema) };
}
export function validateElementalMatrixSchema(data: unknown): ValidationResult {
  const ok = validateElementalSchema(data);
  return { valid: ok, errors: ok ? [] : schemaErrors(validateElementalSchema) };
}

/** Recompute stats from `data.stat_formula` using the doc's formula. */
function statFromData(data: RealmProgression, key: 'hp' | 'mp' | 'atk' | 'def' | 'agi', x: number): number {
  const p = data.stat_formula.stats[key];
  if (p.model === 'exponential') return p.base * Math.pow(p.lambda ?? NaN, x);
  return p.base * (1 + (p.slope ?? NaN) * x);
}

/** Schema + extra checks: order, `to` chain, strikes = waves × per-wave, level ranges, stat table within 1%. */
export function validateRealmProgression(data: unknown): ValidationResult {
  const s = validateRealmProgressionSchema(data);
  if (!s.valid) return s;
  const d = data as RealmProgression;
  const errors: string[] = [];

  d.realms.forEach((r, idx) => {
    if (r.order !== idx + 1) errors.push(`realms[${idx}].order must be ${idx + 1}, got ${r.order}`);
    const next = d.realms[idx + 1];
    const expectTo = next ? next.id : 'phi_thang';
    if (r.breakthrough.to !== expectTo)
      errors.push(`realms[${idx}].breakthrough.to must be "${expectTo}", got "${r.breakthrough.to}"`);
    const t = r.breakthrough.tribulation;
    if (
      t.strikes !== undefined &&
      t.waves !== undefined &&
      t.strikes_per_wave !== undefined &&
      t.strikes !== t.waves * t.strikes_per_wave
    ) {
      errors.push(
        `realms[${idx}] strikes (${t.strikes}) != waves × strikes_per_wave (${t.waves * t.strikes_per_wave})`,
      );
    }
    const [lo, hi] = r.level_range;
    if (lo > hi) errors.push(`realms[${idx}].level_range is not ascending`);
    const prev = d.realms[idx - 1];
    if (prev && lo <= prev.level_range[1]) errors.push(`realms[${idx}].level_range overlaps realms[${idx - 1}]`);
  });
  const sumStages = d.realms.reduce((n, r) => n + r.sub_stages, 0);
  if (d.realms.length === 9 && sumStages !== 41) errors.push(`9 realms must total 41 stages, got ${sumStages}`);

  // Recompute the approved table; > 1% deviation blocks the build.
  for (const row of APPROVED_STAT_TABLE) {
    const K = d.realms[row.realm - 1]?.sub_stages;
    if (K === undefined) continue; // fewer realms in data than the table covers
    const x = row.realm - 1 + (d.stat_formula.alpha * (row.subStage - 1)) / K;
    for (const key of ['hp', 'mp', 'atk', 'def', 'agi'] as const) {
      const got = statFromData(d, key, x);
      const want = row[key];
      if (!Number.isFinite(got) || Math.abs(got - want) / want > 0.01) {
        errors.push(
          `stat table mismatch at "${row.label}" ${key}: computed ${got.toFixed(1)} vs approved ${want} (>1%)`,
        );
      }
    }
  }
  return { valid: errors.length === 0, errors };
}

/** Is `map` a single 5-cycle visiting every element exactly once? */
function isFiveCycle(map: Record<string, string>): boolean {
  const seen = new Set<string>();
  let cur: string = ELEMENTS[0]!;
  for (let n = 0; n < 5; n++) {
    if (seen.has(cur)) return false;
    seen.add(cur);
    const nxt = map[cur];
    if (nxt === undefined) return false;
    cur = nxt;
  }
  return cur === ELEMENTS[0] && seen.size === 5;
}

/** Schema + extra checks: matrix consistent with overcomes, single 5-cycles, spawn weights sum 1, unique counts. */
export function validateElementalMatrix(data: unknown): ValidationResult {
  const s = validateElementalMatrixSchema(data);
  if (!s.valid) return s;
  const d = data as ElementalMatrix;
  const errors: string[] = [];

  if (!isFiveCycle(d.overcomes)) errors.push('overcomes must form exactly one 5-element cycle');
  if (!isFiveCycle(d.generates)) errors.push('generates must form exactly one 5-element cycle');

  for (const a of d.elements) {
    for (const b of d.elements) {
      const v = d.damage_matrix[a]?.[b];
      let want = 1;
      if (d.overcomes[a] === b) want = 1.25;
      else if (d.overcomes[b] === a) want = 0.85;
      if (v === undefined || !close(v, want)) errors.push(`damage_matrix[${a}][${b}] must be ${want}, got ${v}`);
    }
  }
  const sw = d.root_types.reduce((n, r) => n + r.spawn_weight, 0);
  if (!close(sw, 1, 1e-6)) errors.push(`root_types spawn_weight must sum to 1, got ${sw}`);
  const counts = d.root_types.map((r) => r.element_count);
  if (new Set(counts).size !== counts.length) errors.push('root_types element_count must be unique');
  return { valid: errors.length === 0, errors };
}

export function validateSkillDefinitionsSchema(data: unknown): ValidationResult {
  const ok = validateSkillSchema(data);
  return { valid: ok, errors: ok ? [] : schemaErrors(validateSkillSchema) };
}

/** E bounds per tier (docs/11 §6): total damage E of a skill must stay inside its tier band. */
const E_BAND = { basic: [0, 3.5], core: [0, 6], ultimate: [4, 16] } as const;

/**
 * Schema + the D49 structural rules: 6 paths x 8 skills, 2 branches per path (one solo, one team), no skill useless
 * solo, buffs/heals always include the caster, context-aware skills declare both contexts, every path can interrupt a
 * boss cast, unique ids, monotone unlock levels.
 */
export function validateSkillDefinitions(data: unknown): ValidationResult {
  const s = validateSkillDefinitionsSchema(data);
  if (!s.valid) return s;
  const d = data as SkillDefinitions;
  const errors: string[] = [];
  const ids = new Set<string>();
  for (const sk of d.skills) {
    if (ids.has(sk.id)) errors.push(`duplicate skill id ${sk.id}`);
    ids.add(sk.id);
  }
  for (const path of PATHS) {
    const cls = d.classes.filter((c) => c.path === path);
    if (cls.length !== 1) errors.push(`path ${path}: expected exactly 1 class, got ${cls.length}`);
    const c = cls[0];
    const skills = d.skills.filter((k) => k.path === path).sort((a, b) => a.unlock.level_min - b.unlock.level_min);
    if (skills.length !== 8) errors.push(`path ${path}: expected 8 skills, got ${skills.length}`);
    skills.forEach((k, i) => {
      const prev = skills[i - 1];
      if (prev && k.unlock.level_min <= prev.unlock.level_min) errors.push(`${k.id}: unlock level not increasing`);
    });
    if (skills.filter((k) => k.kind === 'active').length > 8) errors.push(`path ${path}: more than 8 active skills`);
    if (skills.filter((k) => k.tier === 'ultimate').length !== 1)
      errors.push(`path ${path}: expected exactly 1 ultimate`);
    const solo = d.branches.filter((b) => b.path === path && b.mode === 'solo');
    const team = d.branches.filter((b) => b.path === path && b.mode === 'team');
    if (solo.length !== 1 || team.length !== 1) errors.push(`path ${path}: expected 1 solo + 1 team branch`);
    if (c && (solo[0]?.id !== c.solo_branch || team[0]?.id !== c.team_branch))
      errors.push(`path ${path}: class solo_branch/team_branch do not match the branches`);
    for (const b of [...solo, ...team]) {
      if (b.unlock_level !== 20) errors.push(`${b.id}: branches unlock at level 20`);
      for (const sid of Object.keys(b.skill_patches))
        if (!skills.some((k) => k.id === sid)) errors.push(`${b.id}: patch targets unknown skill ${sid}`);
    }
    // Solo kit (D49 principle 1): damage, sustain/protection, mobility/escape, crowd control.
    const active = skills.filter((k) => k.kind === 'active');
    const soloFx = (k: (typeof skills)[number]) => k.effects.filter((e) => (e.context ?? 'any') !== 'group');
    const has = (pred: (t: string) => boolean) =>
      skills.some((k) => soloFx(k).some((e) => pred(e.type)) || k.tags.some((t) => pred(t)));
    if (!active.some((k) => soloFx(k).some((e) => e.type === 'damage'))) errors.push(`path ${path}: no damage skill`);
    if (
      !has((t) => ['heal', 'shield', 'sustain', 'lifesteal'].includes(t)) &&
      !skills.some((k) => soloFx(k).some((e) => e.stat === 'lifesteal'))
    )
      errors.push(`path ${path}: no solo sustain`);
    if (!active.some((k) => soloFx(k).some((e) => e.type === 'dash') || k.tags.includes('mobility')))
      errors.push(`path ${path}: no mobility/escape skill`);
    if (!active.some((k) => k.tags.includes('cc'))) errors.push(`path ${path}: no crowd control`);
    // D49 principle 5: any path can interrupt a boss cast (hard CC or knockback).
    if (
      !active.some((k) =>
        k.effects.some(
          (e) =>
            e.type === 'knockback' ||
            (e.type === 'status' && ['stun', 'root', 'freeze', 'knockup'].includes(e.status_id ?? '')),
        ),
      )
    )
      errors.push(`path ${path}: no boss-interrupt capability`);
  }
  for (const k of d.skills) {
    const grouped = k.effects.filter((e) => (e.context ?? 'any') !== 'solo');
    const soloEff = k.effects.filter((e) => (e.context ?? 'any') !== 'group');
    // Dual-use (principle 2): never useless solo, never useless grouped.
    const usefulSolo = soloEff.some((e) => e.applies_to !== 'ally' || k.targeting.mode === 'ally_or_self');
    if (k.kind === 'active' && !usefulSolo) errors.push(`${k.id}: useless solo`);
    if (k.kind === 'active' && grouped.length === 0) errors.push(`${k.id}: no effect when grouped`);
    // Buffs always include the caster; ally-targeted skills must be self-castable.
    for (const e of k.effects) {
      if ((e.type === 'buff' || e.type === 'hot') && e.applies_to === 'ally')
        errors.push(`${k.id}: ${e.type} must include the caster`);
    }
    if (k.effects.some((e) => e.applies_to === 'ally' && e.type !== 'revive') && k.targeting.mode !== 'ally_or_self')
      errors.push(`${k.id}: ally effects require targeting.mode = ally_or_self`);
    // Context-aware: tagged skills must have at least one solo-only or group-only effect, and vice versa.
    const ctxEffects = k.effects.some((e) => (e.context ?? 'any') !== 'any');
    if (k.tags.includes('context_aware') !== ctxEffects)
      errors.push(`${k.id}: context_aware tag must match context effects`);
    if (k.kind === 'active') {
      const [lo, hi] = E_BAND[k.tier];
      const e = skillE(k);
      if (e === 0 && k.tags.includes('sustain')) continue;
      if (e < lo || e > hi) errors.push(`${k.id}: damage E ${e.toFixed(2)} outside ${k.tier} band ${lo}-${hi}`);
      const t = k.timing;
      if (t.cooldown_ms * (1 - (d.global.cdr_cap ?? 0)) < t.cast_ms + (t.channel_ms ?? 0))
        errors.push(`${k.id}: cooldown shorter than cast + channel`);
      if (t.channel_ms && !t.channel_ticks) errors.push(`${k.id}: channel needs channel_ticks`);
      const hits = k.effects.find((e) => e.type === 'damage')?.hits;
      if (t.channel_ms && hits !== undefined && hits !== t.channel_ticks)
        errors.push(`${k.id}: damage hits must equal channel_ticks`);
    }
  }
  return { valid: errors.length === 0, errors };
}
