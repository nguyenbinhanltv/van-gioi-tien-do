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
 * implemented as listed below. Not simulated yet (TODO, docs/OPEN-ITEMS.md): slow / root / poison-pool status effects, summons
 * (Hôi Lang Vương "Tru"), the boss skill sets and phases (bosses use the basic attack only).
 */
import { MOB_AI, MOB_TIERS, type MobDef, type MobTier } from './mobs.js';
import type { SkillShape } from './formulas/skills.js';

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
  /** damage coefficient: `atk * coeff` goes through `damageBreakdown` like a player skill (07 §4) */
  coeff: number;
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
): MobAttack => ({ id: `skill_${n}`, kind: 'skill', shape, anchor, rangeTiles, telegraphMs, cooldownMs, coeff });

const cone = (radius: number, angle_deg: number): SkillShape => ({ type: 'cone', radius, angle_deg });
const line = (length: number, width: number): SkillShape => ({ type: 'line', length, width });
const circle = (radius: number): SkillShape => ({ type: 'circle', radius });

/** Skills per mob def key (docs/10 §4 "Kỹ năng đặc biệt"); defs not listed (Độc Thố, the bosses) only have the basic attack. */
const SKILLS: Readonly<Record<string, readonly MobAttack[]>> = {
  mob_hoi_lang: [skill(1, cone(2.5, 60), 'caster', 2.5, 800, 1.6, 6000)], // Vồ
  mob_thanh_xa: [skill(1, line(4, 1), 'caster', 4, 800, 1.6, 6000)], // Phun độc nhỏ
  mob_doc_chu: [skill(1, cone(3, 90), 'caster', 3, 1000, 1.4, 6000)], // Phun tơ (the slow is TODO)
  mob_doc_thiem: [skill(1, circle(2.5), 'target', 6, 1200, 1.6, 7000)], // Phun độc
  mob_co_can: [skill(1, circle(1.5), 'target', 5, 1000, 1.6, 6000)], // Rễ trồi
  mob_huyet_diep: [skill(1, cone(3, 90), 'caster', 3, 1000, 1.4, 6000)], // Phấn độc
  mob_xich_diem: [skill(1, line(5, 1.2), 'caster', 5, 1000, 1.8, 7000)], // Phun lửa
  elite_lang_vuong: [skill(1, cone(3, 60), 'caster', 3, 800, 2.2, 5000)], // Vồ mạnh (Tru gọi 2 Hôi Lang: TODO summon)
  elite_thiem_vuong: [skill(1, circle(2), 'target', 6, 1000, 2, 6000)], // Nhảy đè (Vũng độc vùng r3: TODO)
  elite_co_can_mau: [skill(1, circle(2.5), 'target', 6, 1000, 1.8, 6000)], // Trói rễ + vùng độc (root / poison: TODO)
  elite_xich_mang: [
    skill(1, cone(3, 120), 'caster', 3, 800, 2, 5000), // Quét đuôi
    skill(2, circle(3), 'caster', 3, 1200, 2.2, 8000), // Vòng lửa
  ],
};

/** All attacks of a mob, the basic one first, then its skills in table order (the mob uses the first skill that is ready and in reach, else the basic attack). */
export function mobAttacksOf(def: MobDef): readonly MobAttack[] {
  return [basic(def.tier), ...(SKILLS[def.key] ?? [])];
}
