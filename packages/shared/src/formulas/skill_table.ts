/**
 * D49 skill table: the 6 classes x 8 skills as flat typed rows (cooldown / GCD / MP / range / cast), derived from
 * `data/skills.json` (docs/11 §4). No numbers live here: `skillDefinitions` stays the single source and the golden test
 * checks every row against the printed tables of docs/11.
 */
import { PATHS, skillDefinitions, skillsOf, type PathId, type SkillDefinitions } from './skills.js';

export interface SkillRow {
  readonly id: string;
  readonly path: PathId;
  /** 1-based position in the class table (K1..K8 order). */
  readonly slot: number;
  readonly kind: 'active' | 'passive';
  readonly tier: 'basic' | 'core' | 'ultimate';
  readonly levelMin: number;
  /** Cast time only, ms (channel excluded). */
  readonly castMs: number;
  readonly channelMs: number;
  readonly cooldownMs: number;
  /** Whether the skill triggers the global cooldown (passives never do). */
  readonly gcd: boolean;
  /** Fraction of max MP (0.01 = 1%); 0 for passives. */
  readonly mpPct: number;
  /** Targeting range in tiles, null for self / passive skills. */
  readonly rangeTiles: number | null;
}

export function skillTable(defs: SkillDefinitions = skillDefinitions): SkillRow[] {
  return PATHS.flatMap((path) =>
    skillsOf(path, defs).map((s, i) => ({
      id: s.id,
      path,
      slot: i + 1,
      kind: s.kind,
      tier: s.tier,
      levelMin: s.unlock.level_min,
      castMs: s.timing.cast_ms,
      channelMs: s.timing.channel_ms ?? 0,
      cooldownMs: s.timing.cooldown_ms,
      gcd: s.kind === 'active' && s.timing.gcd === true,
      mpPct: s.cost?.mp_pct ?? 0,
      rangeTiles: s.targeting.range_tiles ?? null,
    })),
  );
}

/** Global timing constants (docs/11 §3: GCD 800 ms, cooldown-reduction cap 30%). */
function required(v: number | undefined, key: string): number {
  if (v === undefined) throw new Error(`skills.json global.${key} is missing`);
  return v;
}
export const SKILL_GLOBAL = {
  gcdMs: required(skillDefinitions.global.gcd_ms, 'gcd_ms'),
  cdrCap: required(skillDefinitions.global.cdr_cap, 'cdr_cap'),
} as const;

/** Cooldown after reduction, ms: `cooldown x (1 - min(cdr, cap))`. */
export function effectiveCooldownMs(cooldownMs: number, cdr: number, cap: number = SKILL_GLOBAL.cdrCap): number {
  return cooldownMs * (1 - Math.min(Math.max(cdr, 0), cap));
}
