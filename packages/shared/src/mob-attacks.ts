/**
 * Mob attacks (docs/10 §4, D86): what each mob does to a player in reach. Pure data; the server-authoritative system that
 * runs it is `MobAttackSystem` (apps/server world/combat/mob-attacks.ts).
 *
 * Every attack is telegraphed: the mob picks a target, LOCKS the facing and (for ground attacks) the anchor point, and the damage
 * lands `telegraphMs` later on whoever is still inside the shape, so moving out of the area dodges it. Shapes reuse the player skill
 * shapes (`SkillShape`: circle / cone / line, tile space).
 *
 * PLACEHOLDERS - cần game designer duyệt khi cân bằng: docs/10 §4 gives only the skill name, shape kind and (for most) the
 * telegraph time; radii, lengths, ranges, cooldowns, coefficients and the basic-attack wind-up are NOT specified and are
 * implemented as listed below. Elites and bosses (D91): status effects (root, slow, poison, ground poison pool) run on the server
 * (`StatusSystem`), "Tru gọi" is a call for help (the 2 nearest Hôi Lang are pulled onto the target: no new entity is spawned,
 * placeholder for a real summon), and bosses have skill sets and HP-threshold phases with a transform window (docs/10 §4, docs/03 §6).
 * Boss skill shapes / numbers are placeholders; the art side of the phase swap (skin / atlas) is client work.
 */
import { MOB_AI, MOB_TIERS, type MobDef, type MobTier } from './mobs.js';
import type { SkillShape } from './formulas/skills.js';

/** What an attack does besides its damage (D91). `root` / `slow` / `poison` apply to every victim that is hit; `pool` leaves a damaging zone on the anchor; `call_help` pulls nearby mobs onto the target. */
export type MobEffect =
  | { type: 'root'; ms: number }
  | { type: 'slow'; ms: number; /** speed multiplier 0..1 */ factor: number }
  | {
      type: 'poison';
      ms: number;
      tickMs: number;
      /** damage per tick = `atk * coeff` through `damageBreakdown` */ coeff: number;
    }
  | { type: 'pool'; ms: number; tickMs: number; radius: number; coeff: number }
  | { type: 'call_help'; defKey: string; count: number; radius: number };

/** One HP-threshold phase of a mob (bosses; every other mob has the single phase 0). The attacks listed are the WHOLE set for that phase. */
export interface MobPhase {
  /** the phase begins when HP / max HP is at or below this (phase 0 = 1) */
  atHpFrac: number;
  /** invulnerable, attack-less transform window before the phase starts (ms): docs/03 §6 transform_start 0.8 s + transform_end 1.0 s */
  transformMs: number;
  /** multiplies the mob's ATK in this phase */
  atkMult: number;
  /** multiplies every cooldown in this phase */
  cooldownMult: number;
  attacks: readonly MobAttack[];
}

export interface MobAttack {
  /** stable id inside the mob def (`basic`, `skill_1`, ...) */
  id: string;
  kind: 'basic' | 'skill';
  shape: SkillShape;
  /** `caster`: cone / line / circle around the mob, aimed at the target when the telegraph starts; `target`: ground circle on the target's position at that moment */
  anchor: 'caster' | 'target';
  /** the mob starts the attack when its target is within this distance (tiles) */
  rangeTiles: number;
  /** wind-up before the damage lands (ms): docs/10 §4 for skills, placeholder for the basic attack */
  telegraphMs: number;
  /** minimum time between two starts of THIS attack (ms) */
  cooldownMs: number;
  /** damage coefficient: `atk * coeff` goes through `damageBreakdown` like a player skill (07 §4); 0 = no direct damage (a pure effect, e.g. the call for help) */
  coeff: number;
  effect?: MobEffect;
}

/** Basic attack wind-up (ms). PLACEHOLDER: docs/10 gives the interval (1.8 s normal / 1.6 s elite / 1.5 s boss), not the wind-up. */
export const MOB_BASIC_TELEGRAPH_MS = 400;
/** Minimum basic attack reach (tiles). PLACEHOLDER. */
export const MOB_BASIC_RANGE = 1.6;
/** The basic reach is at least this much longer than the tier's `engageRange` (where a chasing mob stops), or a mob would settle just out of its own reach. */
export const MOB_BASIC_REACH_MARGIN = 0.4;
/** Basic attack reach and cone radius of a tier: `max(MOB_BASIC_RANGE, engageRange + margin)` = 1.6 normal, 1.8 elite, 2.9 boss. */
export const mobBasicRange = (tier: MobTier): number =>
  Math.max(MOB_BASIC_RANGE, MOB_AI[tier].engageRange + MOB_BASIC_REACH_MARGIN);
/** Ticks of grace before the same mob may start any attack again after one lands (ms). PLACEHOLDER. */
export const MOB_ATTACK_GAP_MS = 300;

const basic = (tier: MobTier): MobAttack => ({
  id: 'basic',
  kind: 'basic',
  shape: { type: 'cone', radius: mobBasicRange(tier), angle_deg: 120 },
  anchor: 'caster',
  rangeTiles: mobBasicRange(tier),
  telegraphMs: MOB_BASIC_TELEGRAPH_MS,
  cooldownMs: MOB_TIERS[tier].attackIntervalMs,
  coeff: 1,
});

const skill = (
  n: number,
  shape: SkillShape,
  anchor: MobAttack['anchor'],
  rangeTiles: number,
  telegraphMs: number,
  coeff: number,
  cooldownMs: number,
  effect?: MobEffect,
): MobAttack => ({
  id: `skill_${n}`,
  kind: 'skill',
  shape,
  anchor,
  rangeTiles,
  telegraphMs,
  cooldownMs,
  coeff,
  ...(effect ? { effect } : {}),
});

const cone = (radius: number, angle_deg: number): SkillShape => ({ type: 'cone', radius, angle_deg });
const line = (length: number, width: number): SkillShape => ({ type: 'line', length, width });
const circle = (radius: number): SkillShape => ({ type: 'circle', radius });

/** Skills per mob def key (docs/10 §4 "Kỹ năng đặc biệt"); defs not listed (Độc Thố, the bosses) only have the basic attack. */
const SKILLS: Readonly<Record<string, readonly MobAttack[]>> = {
  mob_hoi_lang: [skill(1, cone(2.5, 60), 'caster', 2.5, 800, 1.6, 6000)], // Vồ
  mob_thanh_xa: [
    skill(1, line(4, 1), 'caster', 4, 800, 1.6, 6000, { type: 'poison', ms: 4000, tickMs: 1000, coeff: 0.15 }),
  ], // Phun độc nhỏ
  mob_doc_chu: [skill(1, cone(3, 90), 'caster', 3, 1000, 1.4, 6000, { type: 'slow', ms: 2000, factor: 0.5 })], // Phun tơ làm chậm
  mob_doc_thiem: [skill(1, circle(2.5), 'target', 6, 1200, 1.6, 7000)], // Phun độc
  mob_co_can: [skill(1, circle(1.5), 'target', 5, 1000, 1.6, 6000)], // Rễ trồi
  mob_huyet_diep: [
    skill(1, cone(3, 90), 'caster', 3, 1000, 1.4, 6000, { type: 'poison', ms: 4000, tickMs: 1000, coeff: 0.15 }),
  ], // Phấn độc
  mob_xich_diem: [skill(1, line(5, 1.2), 'caster', 5, 1000, 1.8, 7000)], // Phun lửa
  elite_lang_vuong: [
    skill(1, cone(3, 60), 'caster', 3, 800, 2.2, 5000), // Vồ mạnh
    skill(2, circle(0.5), 'caster', 8, 1000, 0, 15000, {
      type: 'call_help',
      defKey: 'mob_hoi_lang',
      count: 2,
      radius: 10,
    }), // Tru gọi 2 Hôi Lang
  ],
  elite_thiem_vuong: [
    skill(1, circle(2), 'target', 6, 1000, 2, 6000), // Nhảy đè
    skill(2, circle(3), 'target', 7, 1200, 0.6, 12000, { type: 'pool', ms: 6000, tickMs: 1000, radius: 3, coeff: 0.3 }), // Vũng độc vùng r3
  ],
  elite_co_can_mau: [
    skill(1, circle(2.5), 'target', 6, 1000, 1.2, 8000, { type: 'root', ms: 1500 }), // Trói rễ
    skill(2, circle(2.5), 'target', 7, 1200, 0.6, 12000, {
      type: 'pool',
      ms: 5000,
      tickMs: 1000,
      radius: 2.5,
      coeff: 0.3,
    }), // vùng độc
  ],
  elite_xich_mang: [
    skill(1, cone(3, 120), 'caster', 3, 800, 2, 5000), // Quét đuôi
    skill(2, circle(3), 'caster', 3, 1200, 2.2, 8000), // Vòng lửa
  ],
};

/** transform window of a phase change (docs/03 §6: transform_start 0.8 s + transform_end 1.0 s) */
export const MOB_TRANSFORM_MS = 1800;

const bossSkills = (key: string): readonly MobAttack[] =>
  key === 'boss_ho_vuong'
    ? [
        // Độc Nha Hổ Vương (docs/10 §4: 3 skills, 2 phases): bite, roar, venom spit
        skill(1, cone(3.5, 90), 'caster', 3.5, 1000, 1.8, 6000),
        skill(2, circle(4), 'caster', 4, 1200, 1.6, 9000, { type: 'slow', ms: 2000, factor: 0.5 }),
        skill(3, line(6, 1.6), 'caster', 6, 1000, 1.8, 8000, { type: 'poison', ms: 5000, tickMs: 1000, coeff: 0.2 }),
      ]
    : [
        // Độc Hỏa Cổ Mãng (docs/10 §4: 4 skills, 3 phases): tail sweep, fire breath, fire ring, lava pool
        skill(1, cone(4, 120), 'caster', 4, 1000, 1.8, 5000),
        skill(2, line(7, 1.4), 'caster', 7, 1000, 2, 7000),
        skill(3, circle(4.5), 'caster', 4.5, 1200, 2.2, 9000),
        skill(4, circle(3), 'target', 9, 1400, 0.8, 12000, {
          type: 'pool',
          ms: 6000,
          tickMs: 1000,
          radius: 3,
          coeff: 0.35,
        }),
      ];

const phase = (atHpFrac: number, atkMult: number, cooldownMult: number, attacks: readonly MobAttack[]): MobPhase => ({
  atHpFrac,
  transformMs: atHpFrac >= 1 ? 0 : MOB_TRANSFORM_MS,
  atkMult,
  cooldownMult,
  attacks,
});

const PHASES = new Map<string, readonly MobPhase[]>();

/**
 * The phases of a mob, phase 0 first. Normal and elite mobs have exactly one. Bosses: Độc Nha Hổ Vương 2 phases (the second at 50% HP,
 * docs/10 §4), Độc Hỏa Cổ Mãng 3 phases (60% and 25% HP: the docs/03 §6 examples). Phase numbers are placeholders (cần game designer duyệt).
 */
export function mobPhasesOf(def: MobDef): readonly MobPhase[] {
  let p = PHASES.get(def.key);
  if (!p) {
    if (def.key === 'boss_ho_vuong') {
      const a = [basic(def.tier), ...bossSkills(def.key)];
      p = [phase(1, 1, 1, a), phase(0.5, 1.25, 0.7, a)];
    } else if (def.key === 'boss_co_mang') {
      const a = [basic(def.tier), ...bossSkills(def.key)];
      p = [phase(1, 1, 1, a), phase(0.6, 1.2, 0.8, a), phase(0.25, 1.5, 0.6, a)];
    } else p = [phase(1, 1, 1, [basic(def.tier), ...(SKILLS[def.key] ?? [])])];
    PHASES.set(def.key, p);
  }
  return p;
}

/** All attacks of a mob in its first phase, the basic one first, then its skills in table order (the mob uses the first skill that is ready and in reach, else the basic attack). */
export function mobAttacksOf(def: MobDef): readonly MobAttack[] {
  return mobPhasesOf(def)[0]!.attacks;
}
