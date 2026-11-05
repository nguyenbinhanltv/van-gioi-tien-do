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
} from './data.js';
import { ELEMENTS } from './formulas/combat.js';

// Ajv is CJS; under NodeNext/ESM the constructor may be on `.default` or the namespace itself.
type AjvCtor = new (opts?: Record<string, unknown>) => {
  compile(schema: unknown): ((data: unknown) => boolean) & { errors?: { instancePath: string; message?: string }[] | null };
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
    if (r.breakthrough.to !== expectTo) errors.push(`realms[${idx}].breakthrough.to must be "${expectTo}", got "${r.breakthrough.to}"`);
    const t = r.breakthrough.tribulation;
    if (t.strikes !== undefined && t.waves !== undefined && t.strikes_per_wave !== undefined && t.strikes !== t.waves * t.strikes_per_wave) {
      errors.push(`realms[${idx}] strikes (${t.strikes}) != waves × strikes_per_wave (${t.waves * t.strikes_per_wave})`);
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
        errors.push(`stat table mismatch at "${row.label}" ${key}: computed ${got.toFixed(1)} vs approved ${want} (>1%)`);
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
