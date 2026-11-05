/**
 * Công thức §2 — breakthrough success rate (current formula, Hồ sơ §4).
 *   Success   = clamp(Base_eff · (1 + Pill) − Karma_Penalty, 5%, 95%)
 *   Base_eff  = Base_r + min(0.08 · n_fail, 0.40)
 *   Pill      = min(1, 1 − Π(1 − b_i)), m ≤ 3, b_i = b0 · q · (right realm ? 1 : 0.3)
 *   Karma_Penalty = 0.20 · max(0, −K)/1000
 */
import { QUALITY_TIERS } from '../constants.js';

export const BREAKTHROUGH = {
  MIN_RATE: 0.05,
  MAX_RATE: 0.95,
  PITY_PER_FAIL: 0.08,
  PITY_CAP: 0.4,
  MAX_PILLS: 3,
  WRONG_REALM_PILL_FACTOR: 0.3,
  KARMA_PENALTY_PER_1000: 0.2,
  MINOR_BASE_LUYEN_KHI: 0.9,
  MINOR_BASE_DEFAULT: 0.85,
  MINOR_KARMA_FACTOR: 0.5,
  /** Ma đạo threshold: K ≤ −700. */
  DEMONIC_KARMA: -700,
  /** Base b0 per pill kind. */
  PILL_B0: { main: 0.4, support: 0.2 },
} as const;

/** Base_r for the 8 major thresholds (index 0 = Luyện Khí → Trúc Cơ … index 8 = Độ Kiếp → Phi Thăng). */
export const BASE_RATE_BY_REALM: readonly number[] = [0.7, 0.55, 0.45, 0.35, 0.3, 0.25, 0.2, 0.15, 0.1];

export function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

/** Base for realm r (1..9) major breakthrough. */
export function baseRate(r: number): number {
  const v = BASE_RATE_BY_REALM[r - 1];
  if (v === undefined) throw new RangeError(`realm ${r} out of range 1..9`);
  return v;
}

export function pityBonus(nFail: number): number {
  return Math.min(BREAKTHROUGH.PITY_PER_FAIL * Math.max(0, nFail), BREAKTHROUGH.PITY_CAP);
}
export function baseEff(base: number, nFail: number): number {
  return base + pityBonus(nFail);
}

export interface PillInput {
  kind: 'main' | 'support';
  /** quality index 0..5 (Trắng … Đỏ) */
  quality: number;
  /** true when the pill matches the breakthrough threshold */
  rightRealm: boolean;
}
/** b_i for a single pill. */
export function pillStrength(p: PillInput): number {
  const tier = QUALITY_TIERS[p.quality];
  if (!tier) throw new RangeError(`quality ${p.quality} out of range 0..5`);
  return BREAKTHROUGH.PILL_B0[p.kind] * tier.pillFactor * (p.rightRealm ? 1 : BREAKTHROUGH.WRONG_REALM_PILL_FACTOR);
}
/** Pill = min(1, 1 − Π(1 − b_i)); throws if more than 3 pills. */
export function pillBonus(pills: readonly PillInput[]): number {
  if (pills.length > BREAKTHROUGH.MAX_PILLS) throw new RangeError(`at most ${BREAKTHROUGH.MAX_PILLS} pills`);
  let prod = 1;
  for (const p of pills) prod *= 1 - pillStrength(p);
  return Math.min(1, 1 - prod);
}
/** K = karma (−1000..+1000). Only negative karma hurts. */
export function karmaPenalty(karma: number): number {
  return (BREAKTHROUGH.KARMA_PENALTY_PER_1000 * Math.max(0, -karma)) / 1000;
}

export interface BreakthroughInput {
  /** realm being left, 1..9 */
  realm: number;
  pills?: readonly PillInput[];
  karma?: number;
  /** consecutive failures at this threshold */
  nFail?: number;
  /** override Base_r (e.g. from realm_progression.json) */
  base?: number;
}
export interface BreakthroughBreakdown {
  baseEff: number;
  pill: number;
  karmaPenalty: number;
  raw: number;
  success: number;
}
export function breakthroughBreakdown(input: BreakthroughInput): BreakthroughBreakdown {
  const base = input.base ?? baseRate(input.realm);
  const be = baseEff(base, input.nFail ?? 0);
  const pill = pillBonus(input.pills ?? []);
  const kp = karmaPenalty(input.karma ?? 0);
  const raw = be * (1 + pill) - kp;
  return {
    baseEff: be,
    pill,
    karmaPenalty: kp,
    raw,
    success: clamp(raw, BREAKTHROUGH.MIN_RATE, BREAKTHROUGH.MAX_RATE),
  };
}
export function breakthroughSuccess(input: BreakthroughInput): number {
  return breakthroughBreakdown(input).success;
}

/**
 * Minor sub-stage breakthrough: Base 0.90 (Luyện Khí) / 0.85 (others), no tribulation,
 * Karma_Penalty halved. Pills and pity are NOT applied (spec silent — see PR notes).
 */
export function minorBreakthroughSuccess(realm: number, karma = 0): number {
  const base = realm === 1 ? BREAKTHROUGH.MINOR_BASE_LUYEN_KHI : BREAKTHROUGH.MINOR_BASE_DEFAULT;
  const raw = base - BREAKTHROUGH.MINOR_KARMA_FACTOR * karmaPenalty(karma);
  return clamp(raw, BREAKTHROUGH.MIN_RATE, BREAKTHROUGH.MAX_RATE);
}

export function isDemonic(karma: number): boolean {
  return karma <= BREAKTHROUGH.DEMONIC_KARMA;
}
