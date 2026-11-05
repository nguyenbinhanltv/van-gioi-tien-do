/**
 * Công thức §1 — base stats by realm.
 *   x(r,k)    = (r − 1) + α · (k − 1)/K_r,  α = 0.6
 *   Stat      = B · λ^x            (HP, MP, ATK, DEF)
 *   ThânPháp  = B_TP · (1 + 0.15 · x)   (linear)
 */
import { DEFAULT_SUBSTAGES, LUYEN_KHI_SUBSTAGES, REALM_COUNT, TOTAL_STAGES } from '../constants.js';

export const ALPHA = 0.6;

export type StatKey = 'hp' | 'mp' | 'atk' | 'def';
export interface StatParam {
  readonly base: number;
  readonly lambda: number;
}
export const STAT_PARAMS: Readonly<Record<StatKey, StatParam>> = {
  hp: { base: 1200, lambda: 1.78 },
  mp: { base: 400, lambda: 1.7 },
  atk: { base: 60, lambda: 1.75 },
  def: { base: 40, lambda: 1.72 },
};
export const AGI_BASE = 100;
export const AGI_SLOPE = 0.15;

export interface Stats {
  hp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
}

/** K_r: number of sub-stages in realm r (Luyện Khí 9, others 4). */
export function subStageCount(r: number): number {
  assertRealm(r);
  return r === 1 ? LUYEN_KHI_SUBSTAGES : DEFAULT_SUBSTAGES;
}

/** Cultivation progress x(r, k); r = 1..9, k = 1..K_r. */
export function progressX(r: number, k: number, alpha = ALPHA): number {
  const K = subStageCount(r);
  if (!Number.isInteger(k) || k < 1 || k > K) throw new RangeError(`sub-stage k=${k} out of range 1..${K} for realm ${r}`);
  return r - 1 + (alpha * (k - 1)) / K;
}

export function expStat(param: StatParam, x: number): number {
  return param.base * Math.pow(param.lambda, x);
}
export function agility(x: number, base = AGI_BASE, slope = AGI_SLOPE): number {
  return base * (1 + slope * x);
}

/** Unrounded stats at (r, k). */
export function statsAt(r: number, k: number): Stats {
  const x = progressX(r, k);
  return statsAtX(x);
}
export function statsAtX(x: number): Stats {
  return {
    hp: expStat(STAT_PARAMS.hp, x),
    mp: expStat(STAT_PARAMS.mp, x),
    atk: expStat(STAT_PARAMS.atk, x),
    def: expStat(STAT_PARAMS.def, x),
    agi: agility(x),
  };
}
/** Integer stats as stored/sent by the server (rounded to nearest). */
export function roundedStatsAt(r: number, k: number): Stats {
  const s = statsAt(r, k);
  return { hp: Math.round(s.hp), mp: Math.round(s.mp), atk: Math.round(s.atk), def: Math.round(s.def), agi: Math.round(s.agi) };
}

/** Max (Viên Mãn) sub-stage of a realm. */
export function maxSubStage(r: number): number {
  return subStageCount(r);
}

// ---------------------------------------------------------------- 41 stages
export interface StageRef {
  /** 1..41 */
  stage: number;
  realm: number;
  subStage: number;
}

/** Flat stage index 1..41 → (realm, sub-stage). Luyện Khí = stages 1–9, then 4 per realm. */
export function stageToRealm(stage: number): StageRef {
  if (!Number.isInteger(stage) || stage < 1 || stage > TOTAL_STAGES) throw new RangeError(`stage ${stage} out of range 1..${TOTAL_STAGES}`);
  if (stage <= LUYEN_KHI_SUBSTAGES) return { stage, realm: 1, subStage: stage };
  const rest = stage - LUYEN_KHI_SUBSTAGES - 1;
  return { stage, realm: 2 + Math.floor(rest / DEFAULT_SUBSTAGES), subStage: (rest % DEFAULT_SUBSTAGES) + 1 };
}
export function realmToStage(r: number, k: number): number {
  progressX(r, k); // validates
  return r === 1 ? k : LUYEN_KHI_SUBSTAGES + (r - 2) * DEFAULT_SUBSTAGES + k;
}

/** Per-hit damage ratio helper: hits needed to kill an equal-stat opponent (uses damage formula with c_skill=1, no extras). */
export function hitsToKillEqual(s: Pick<Stats, 'hp' | 'atk' | 'def'>): number {
  const dmg = (s.atk * s.atk) / (s.atk + s.def);
  return s.hp / dmg;
}

function assertRealm(r: number): void {
  if (!Number.isInteger(r) || r < 1 || r > REALM_COUNT) throw new RangeError(`realm ${r} out of range 1..${REALM_COUNT}`);
}
