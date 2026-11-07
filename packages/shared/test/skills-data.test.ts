import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  PATHS,
  branchOf,
  classOf,
  effectActive,
  skillDefinitions,
  skillDefinitionsSchema,
  skillsOf,
  staticTtkMatrix,
  validateSkillDefinitions,
  validateSkillDefinitionsSchema,
  type SkillDefinitions,
} from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => JSON.parse(readFileSync(join(here, '..', rel), 'utf8'));
const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v));

describe('skills.json (D49)', () => {
  it('passes schema + structural checks, and generated.ts is in sync', () => {
    expect(validateSkillDefinitions(skillDefinitions)).toEqual({ valid: true, errors: [] });
    expect(skillDefinitions).toEqual(read('src/data/skills.json'));
    expect(skillDefinitionsSchema).toEqual(read('src/schemas/skill_definitions.schema.json'));
  });
  it('has 6 paths x 8 skills and 2 branches per path (1 solo + 1 team, level 20)', () => {
    expect(PATHS).toHaveLength(6);
    for (const p of PATHS) {
      expect(skillsOf(p)).toHaveLength(8);
      const c = classOf(p);
      expect(branchOf(c.solo_branch).mode).toBe('solo');
      expect(branchOf(c.team_branch).mode).toBe('team');
      expect(branchOf(c.solo_branch).unlock_level).toBe(20);
    }
    expect(skillDefinitions.skills).toHaveLength(48);
    expect(skillDefinitions.branches).toHaveLength(12);
  });
  it('every class has damage, sustain, mobility and CC; every path can interrupt a boss cast', () => {
    const bad = validateSkillDefinitions(skillDefinitions).errors.filter((e) =>
      /no (damage|solo sustain|mobility|crowd|boss-interrupt)/.test(e),
    );
    expect(bad).toEqual([]);
  });
  it('rejects broken data', () => {
    const noCost = clone(skillDefinitions);
    delete (noCost.skills[0] as { cost?: unknown }).cost;
    expect(validateSkillDefinitionsSchema(noCost).valid).toBe(false);
    const dup = clone(skillDefinitions);
    dup.skills[1]!.id = dup.skills[0]!.id;
    expect(validateSkillDefinitions(dup).errors.join()).toMatch(/duplicate skill id/);
    const useless = clone(skillDefinitions) as SkillDefinitions;
    const heal = useless.skills.find((s) => s.id === 'hoi_xuan_chu')!;
    heal.targeting.mode = 'enemy';
    expect(validateSkillDefinitions(useless).valid).toBe(false);
    const buffNoCaster = clone(skillDefinitions) as SkillDefinitions;
    buffNoCaster.skills.find((s) => s.id === 'ngu_kiem_tran')!.effects.find((e) => e.type === 'buff')!.applies_to =
      'ally';
    expect(validateSkillDefinitions(buffNoCaster).errors.join()).toMatch(/must include the caster/);
  });
  it('context filtering: group-only effects are skipped solo and vice versa', () => {
    const taunt = skillDefinitions.skills.find((s) => s.id === 'khieu_khich')!;
    const solo = taunt.effects.filter((e) => effectActive(e, false)).map((e) => e.type);
    const group = taunt.effects.filter((e) => effectActive(e, true)).map((e) => e.type);
    expect(solo).toEqual(['pull', 'buff']); // gathers mobs + lifesteal
    expect(group).toEqual(['taunt']); // forced aggro
  });
  it('static TTK matrix stays inside the 23–51 band (docs/11 §2.2)', () => {
    const m = staticTtkMatrix();
    for (const a of PATHS)
      for (const d of PATHS) {
        expect(m[a][d], `${a} -> ${d}`).toBeGreaterThanOrEqual(23);
        expect(m[a][d], `${a} -> ${d}`).toBeLessThanOrEqual(51);
      }
  });
});
