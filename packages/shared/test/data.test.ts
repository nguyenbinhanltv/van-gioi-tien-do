import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  BASE_RATE_BY_REALM,
  BREAKTHROUGH,
  QUALITY_TIERS,
  STAT_PARAMS,
  TRIBULATIONS,
  realmProgression,
  elementalMatrix,
  totalMultiplier,
  validateElementalMatrix,
  validateElementalMatrixSchema,
  validateRealmProgression,
  validateRealmProgressionSchema,
  type ElementalMatrix,
  type RealmProgression,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(join(here, '..', rel), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('sample data validity', () => {
  it('realm_progression.json passes schema + CI checks', () => {
    expect(validateRealmProgression(realmProgression)).toEqual({ valid: true, errors: [] });
    expect(validateRealmProgression(read('src/data/realm_progression.json')).valid).toBe(true);
  });
  it('elemental_matrix.json passes schema + CI checks', () => {
    expect(validateElementalMatrix(elementalMatrix)).toEqual({ valid: true, errors: [] });
  });
  it('generated.ts is in sync with src/data and src/schemas (run `npm run gen:data` if this fails)', () => {
    expect(realmProgression).toEqual(read('src/data/realm_progression.json'));
    expect(elementalMatrix).toEqual(read('src/data/elemental_matrix.json'));
  });
  it('9 realms / 41 stages and tribulation specs agree with the TS constants', () => {
    expect(realmProgression.realms).toHaveLength(9);
    expect(realmProgression.realms.reduce((n, r) => n + r.sub_stages, 0)).toBe(41);
    expect(realmProgression.realms.map((r) => r.breakthrough.base_rate)).toEqual([...BASE_RATE_BY_REALM]);
    const lightning = realmProgression.realms.filter((r) => r.breakthrough.tribulation.kappa !== undefined);
    expect(lightning).toHaveLength(TRIBULATIONS.length);
    lightning.forEach((r, i) => {
      const t = r.breakthrough.tribulation;
      const spec = TRIBULATIONS[i]!;
      expect([t.strikes, t.waves, t.strikes_per_wave, t.kappa]).toEqual([
        spec.strikes,
        spec.waves,
        spec.strikesPerWave,
        spec.kappa,
      ]);
      expect(t.wave_growth).toBe(1.22);
      expect(totalMultiplier(spec)).toBeGreaterThan(0.5);
    });
  });
  it('rules and stat params agree with the TS constants', () => {
    const b = realmProgression.breakthrough_rules;
    expect(b.min_rate).toBe(BREAKTHROUGH.MIN_RATE);
    expect(b.max_rate).toBe(BREAKTHROUGH.MAX_RATE);
    expect(b.pity_per_fail).toBe(BREAKTHROUGH.PITY_PER_FAIL);
    expect(b.pity_cap).toBe(BREAKTHROUGH.PITY_CAP);
    expect(b.max_pills).toBe(BREAKTHROUGH.MAX_PILLS);
    expect(b.karma_penalty_per_1000).toBe(BREAKTHROUGH.KARMA_PENALTY_PER_1000);
    expect(b.quality_multipliers).toEqual(QUALITY_TIERS.map((t) => t.pillFactor));
    for (const k of ['hp', 'mp', 'atk', 'def'] as const) {
      expect(realmProgression.stat_formula.stats[k].base).toBe(STAT_PARAMS[k].base);
      expect(realmProgression.stat_formula.stats[k].lambda).toBe(STAT_PARAMS[k].lambda);
    }
  });
});

describe('realm_progression validation rejects bad data', () => {
  const bad = (mutate: (d: RealmProgression) => void) => {
    const d = clone(realmProgression);
    mutate(d);
    return validateRealmProgression(d);
  };
  it('schema: missing field / wrong type / unknown property', () => {
    const d = clone(realmProgression) as unknown as Record<string, unknown>;
    delete d.cultivation;
    expect(validateRealmProgressionSchema(d).valid).toBe(false);
    expect(bad((x) => ((x.stat_formula.alpha as number) = 1)).valid).toBe(false); // exclusiveMaximum 1
    expect(validateRealmProgressionSchema({ ...clone(realmProgression), extra: 1 }).valid).toBe(false);
    expect(bad((x) => ((x.schema_version as string) = 'v1')).valid).toBe(false);
  });
  it('schema: lightning tribulation needs all its fields', () => {
    const r = bad((x) => delete x.realms[2]!.breakthrough.tribulation.kappa);
    expect(r.valid).toBe(false);
  });
  it('extra: order must be 1…n', () => {
    expect(bad((x) => (x.realms[3]!.order = 9)).errors.join()).toMatch(/order/);
  });
  it('extra: breakthrough.to must point to the next realm', () => {
    expect(bad((x) => (x.realms[0]!.breakthrough.to = 'kim_dan')).errors.join()).toMatch(/breakthrough\.to/);
    expect(bad((x) => (x.realms[8]!.breakthrough.to = 'do_kiep')).errors.join()).toMatch(/phi_thang/);
  });
  it('extra: strikes = waves × strikes_per_wave', () => {
    expect(bad((x) => (x.realms[8]!.breakthrough.tribulation.strikes = 80)).errors.join()).toMatch(/strikes/);
  });
  it('extra: level_range ascending and non-overlapping', () => {
    expect(bad((x) => (x.realms[1]!.level_range = [20, 50])).errors.join()).toMatch(/overlap/);
    expect(bad((x) => (x.realms[1]!.level_range = [50, 31])).errors.join()).toMatch(/ascending/);
  });
  it('extra: recomputed stat table deviating > 1% blocks the build', () => {
    const r = bad((x) => (x.stat_formula.stats.hp.lambda = 1.9));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/stat table mismatch/);
    // within 1%: tweak λ by 0.01% — still valid
    expect(bad((x) => (x.stat_formula.stats.hp.lambda = 1.78 * 1.0001)).valid).toBe(true);
  });
});

describe('elemental_matrix validation rejects bad data', () => {
  const bad = (mutate: (d: ElementalMatrix) => void) => {
    const d = clone(elementalMatrix);
    mutate(d);
    return validateElementalMatrix(d);
  };
  it('schema errors', () => {
    expect(validateElementalMatrixSchema({}).valid).toBe(false);
    expect(bad((d) => d.elements.pop()).valid).toBe(false);
    expect(bad((d) => (d.mutation_chance = 2)).valid).toBe(false);
  });
  it('matrix must be 1.25 / 0.85 / 1.00 as derived from overcomes', () => {
    expect(bad((d) => (d.damage_matrix.kim.moc = 1.3)).errors.join()).toMatch(/damage_matrix\[kim\]\[moc\]/);
    expect(bad((d) => (d.damage_matrix.moc.kim = 1)).errors.join()).toMatch(/damage_matrix\[moc\]\[kim\]/);
    expect(bad((d) => (d.damage_matrix.kim.thuy = 1.1)).valid).toBe(false);
  });
  it('overcomes / generates must each be one 5-cycle', () => {
    expect(bad((d) => (d.overcomes.kim = 'kim')).errors.join()).toMatch(/overcomes/);
    expect(bad((d) => ((d.generates.kim = 'moc'), (d.generates.thuy = 'kim'))).errors.join()).toMatch(/generates/);
  });
  it('root types: spawn weights sum to 1, element counts unique', () => {
    expect(bad((d) => (d.root_types[0]!.spawn_weight = 0.5)).errors.join()).toMatch(/spawn_weight/);
    expect(bad((d) => (d.root_types[1]!.element_count = 1)).errors.join()).toMatch(/element_count/);
  });
});
