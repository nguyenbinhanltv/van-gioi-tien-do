/**
 * Công thức §5 — linh căn and spiritual-energy absorption.
 *   Match     = max(0.1, 5 · Σ a_e · v_e)       (uniform environment v_e = 0.2 ⇒ Match = 1)
 *   Absorb(s) = ρ · A_s · P_n · √Match   (cultivation per minute),  A_s = 100 · 1.25^(s−1)
 *   Req(s)    = 1000 · 1.35^(s−1)
 *   t(s)      = 10 min · 1.08^(s−1) / (ρ · P_n · √Match)
 */
import { TOTAL_STAGES } from '../constants.js';
import type { AnyElement } from './combat.js';
import { baseElement } from './combat.js';

export const CULTIVATION = {
  MATCH_FLOOR: 0.1,
  MATCH_SCALE: 5,
  REQ_BASE: 1000,
  REQ_GROWTH: 1.35,
  ABSORB_BASE: 100,
  ABSORB_GROWTH: 1.25,
  /** ρ */
  DENSITY_NORMAL: 1.0,
  DENSITY_MAIN_CITY: 0.6,
  LEY_LINE_BASE: 1.0,
  LEY_LINE_PER_GRADE: 0.25,
} as const;

export type RootTypeId = 'don' | 'song' | 'tap_tam' | 'tap_tu' | 'tap_ngu';
export interface RootType {
  id: RootTypeId;
  elementCount: number;
  /** spawn probability at character creation */
  spawnWeight: number;
  /** P_n */
  purity: number;
  /** damage penalty when using skills outside own elements */
  offElementDamagePenalty: number;
}
export const ROOT_TYPES: readonly RootType[] = [
  { id: 'don', elementCount: 1, spawnWeight: 0.05, purity: 1.6, offElementDamagePenalty: 0.3 },
  { id: 'song', elementCount: 2, spawnWeight: 0.2, purity: 1.3, offElementDamagePenalty: 0.15 },
  { id: 'tap_tam', elementCount: 3, spawnWeight: 0.35, purity: 1.0, offElementDamagePenalty: 0 },
  { id: 'tap_tu', elementCount: 4, spawnWeight: 0.25, purity: 0.85, offElementDamagePenalty: 0 },
  { id: 'tap_ngu', elementCount: 5, spawnWeight: 0.15, purity: 0.7, offElementDamagePenalty: 0 },
];
export function rootType(id: RootTypeId): RootType {
  const t = ROOT_TYPES.find((r) => r.id === id);
  if (!t) throw new Error(`unknown root type ${id}`);
  return t;
}
export function rootTypeByElementCount(n: number): RootType {
  const t = ROOT_TYPES.find((r) => r.elementCount === n);
  if (!t) throw new RangeError(`root element count ${n} out of range 1..5`);
  return t;
}

/** Weights a_e (sum 1) of the player's roots, v_e (sum 1) of the land. */
export type ElementWeights = Partial<Record<AnyElement, number>>;

export function match(playerRoots: ElementWeights, land: ElementWeights): number {
  let sum = 0;
  for (const [e, a] of Object.entries(playerRoots) as [AnyElement, number][]) {
    // mutated roots use their base element's land weight
    sum += a * (land[e] ?? land[baseElement(e)] ?? 0);
  }
  return Math.max(CULTIVATION.MATCH_FLOOR, CULTIVATION.MATCH_SCALE * sum);
}

/** Spiritual density ρ. `leyLineGrade` 1..5 when sitting on a ley line. */
export function density(opts: { mainCity?: boolean; leyLineGrade?: number } = {}): number {
  if (opts.leyLineGrade) return CULTIVATION.LEY_LINE_BASE + CULTIVATION.LEY_LINE_PER_GRADE * opts.leyLineGrade;
  return opts.mainCity ? CULTIVATION.DENSITY_MAIN_CITY : CULTIVATION.DENSITY_NORMAL;
}

/** Speed factor P_n · √Match (ρ = 1). */
export function speedFactor(purity: number, matchValue: number): number {
  return purity * Math.sqrt(matchValue);
}

/** A_s: absorb per minute at stage s (1..41) before ρ·P_n·√Match. */
export function absorbBase(s: number): number {
  return CULTIVATION.ABSORB_BASE * Math.pow(CULTIVATION.ABSORB_GROWTH, s - 1);
}
/** Cultivation points per minute. */
export function absorbPerMinute(s: number, rho: number, purity: number, matchValue: number): number {
  return rho * absorbBase(s) * purity * Math.sqrt(matchValue);
}
/** Req(s): points needed for stage s. */
export function requiredCultivation(s: number): number {
  return CULTIVATION.REQ_BASE * Math.pow(CULTIVATION.REQ_GROWTH, s - 1);
}
/** t(s) in minutes = Req(s)/Absorb(s) = 10·1.08^(s−1) / (ρ·P_n·√Match). */
export function minutesForStage(s: number, rho: number, purity: number, matchValue: number): number {
  return (10 * Math.pow(CULTIVATION.REQ_GROWTH / CULTIVATION.ABSORB_GROWTH, s - 1)) / (rho * purity * Math.sqrt(matchValue));
}
/** Total pure cultivation hours for stages 1..n (default all 41). */
export function totalHours(rho: number, purity: number, matchValue: number, fromStage = 1, toStage = TOTAL_STAGES): number {
  let minutes = 0;
  for (let s = fromStage; s <= toStage; s++) minutes += minutesForStage(s, rho, purity, matchValue);
  return minutes / 60;
}
