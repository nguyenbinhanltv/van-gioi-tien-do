/**
 * Công thức §3 — Lôi Kiếp (pure damage: ignores DEF and Ngũ hành).
 *   Strike(w) = HP_ref · κ_r · g^(w−1),  g = 1.22,  w = 1..W_r
 *   Total_r   = HP_ref · κ_r · m_r · (g^W − 1)/(g − 1)
 * HP_ref = base HP at Viên Mãn of the realm being tribulated.
 */
export const LIGHTNING_GROWTH = 1.22;
export const STRIKE_INTERVAL_S = 1.5;
export const WAVE_INTERVAL_S = 8;

export interface TribulationSpec {
  /** total strikes (đạo) = waves × strikesPerWave */
  strikes: number;
  /** W: number of waves (đợt) */
  waves: number;
  /** m: strikes per wave */
  strikesPerWave: number;
  /** κ_r */
  kappa: number;
}

/** The six lightning thresholds (Kim Đan → Nguyên Anh … Độ Kiếp → Phi Thăng). */
export const TRIBULATIONS: readonly TribulationSpec[] = [
  { strikes: 3, waves: 3, strikesPerWave: 1, kappa: 0.162 },
  { strikes: 6, waves: 6, strikesPerWave: 1, kappa: 0.115 },
  { strikes: 9, waves: 9, strikesPerWave: 1, kappa: 0.0794 },
  { strikes: 18, waves: 9, strikesPerWave: 2, kappa: 0.0485 },
  { strikes: 36, waves: 9, strikesPerWave: 4, kappa: 0.0287 },
  { strikes: 81, waves: 9, strikesPerWave: 9, kappa: 0.0147 },
];

/** One strike of wave w (1-based). */
export function strikeDamage(hpRef: number, kappa: number, w: number, g = LIGHTNING_GROWTH): number {
  return hpRef * kappa * Math.pow(g, w - 1);
}
/** All m strikes of wave w. */
export function waveDamage(hpRef: number, kappa: number, m: number, w: number, g = LIGHTNING_GROWTH): number {
  return strikeDamage(hpRef, kappa, w, g) * m;
}
/** Total damage as a multiple of HP_ref. */
export function totalMultiplier(spec: TribulationSpec, g = LIGHTNING_GROWTH): number {
  return (spec.kappa * spec.strikesPerWave * (Math.pow(g, spec.waves) - 1)) / (g - 1);
}
/** Last wave damage as a multiple of HP_ref. */
export function lastWaveMultiplier(spec: TribulationSpec, g = LIGHTNING_GROWTH): number {
  return waveDamage(1, spec.kappa, spec.strikesPerWave, spec.waves, g);
}
export function totalDamage(hpRef: number, spec: TribulationSpec, g = LIGHTNING_GROWTH): number {
  return hpRef * totalMultiplier(spec, g);
}

/** Wave of m strikes 1.5 s apart ⇒ (m−1)·1.5 s; waves 8 s apart. 81-strike: 9·12 + 8·8 = 172 s. */
export function tribulationDurationS(spec: TribulationSpec, strikeIntervalS = STRIKE_INTERVAL_S, waveIntervalS = WAVE_INTERVAL_S): number {
  return spec.waves * (spec.strikesPerWave - 1) * strikeIntervalS + (spec.waves - 1) * waveIntervalS;
}

// ---------------------------------------------------------------- mitigation sources
/** Shield = HP_ref × coef by quality (Trắng → Đỏ). */
export const SHIELD_COEF: readonly number[] = [0.15, 0.25, 0.35, 0.45, 0.6, 0.8];
/** Formation (trận pháp) reduction R per strike by quality. */
export const FORMATION_REDUCTION: readonly number[] = [0.1, 0.16, 0.22, 0.28, 0.34, 0.4];
/** Body-cultivator technique adds +10%; total reduction (formation + technique) capped at 50%. */
export const BODY_CULT_REDUCTION = 0.1;
export const MAX_TOTAL_REDUCTION = 0.5;
/** Hộ Mạch Đan: heals 20% HP_ref, 45 s cooldown. */
export const HEAL_PILL_PCT = 0.2;
export const HEAL_PILL_COOLDOWN_S = 45;
/** Escort (đồng đạo hộ pháp): each takes 25% of every strike, max 2. */
export const ESCORT_SHARE = 0.25;
export const MAX_ESCORTS = 2;
/** Artifact durability lost per wave. */
export const SHIELD_DURABILITY_LOSS_PER_WAVE = 0.1;
/** Durability lost by equipment when dying in a tribulation. */
export const TRIBULATION_DEATH_DURABILITY_LOSS = 0.15;

/** Number of Hộ Mạch Đan doses usable during `durationS` (first at t = 0): 172 s → 4. */
export function maxHealPills(durationS: number): number {
  return Math.floor(durationS / HEAL_PILL_COOLDOWN_S) + 1;
}

export function totalReduction(formationQuality: number | null, bodyCultivator: boolean): number {
  const r = (formationQuality === null ? 0 : (FORMATION_REDUCTION[formationQuality] ?? 0)) + (bodyCultivator ? BODY_CULT_REDUCTION : 0);
  return Math.min(MAX_TOTAL_REDUCTION, r);
}

export interface TribulationOutcomeInput {
  hpRef: number;
  /** Real max HP including gear (e.g. HP_ref × 1.4). */
  hpMax: number;
  spec: TribulationSpec;
  /** Override total multiplier (the doc's example uses the rounded table value 3.0). */
  totalMultiplierOverride?: number;
  formationQuality?: number | null;
  bodyCultivator?: boolean;
  shieldQuality?: number | null;
  /** Hộ Mạch Đan doses consumed (capped by maxHealPills). */
  healPills?: number;
  /** Escorts sharing damage (0..2). */
  escorts?: number;
}
export interface TribulationOutcome {
  raw: number;
  reduction: number;
  afterReduction: number;
  shield: number;
  heal: number;
  /** damage that reaches HP after all sources (can be ≤ 0) */
  net: number;
  survives: boolean;
  /** net − hpMax; positive = overkill */
  overkill: number;
  remainingHpFraction: number;
}

/**
 * Aggregate survival check:  Σ D_i·(1 − R) − Shield − Heal < HP_max.
 * Escort sharing is applied after the formation reduction (spec is silent on order — see PR notes).
 */
export function tribulationOutcome(inp: TribulationOutcomeInput): TribulationOutcome {
  const raw = inp.hpRef * (inp.totalMultiplierOverride ?? totalMultiplier(inp.spec));
  const reduction = totalReduction(inp.formationQuality ?? null, inp.bodyCultivator ?? false);
  const escorts = Math.min(MAX_ESCORTS, Math.max(0, inp.escorts ?? 0));
  const afterReduction = raw * (1 - reduction) * (1 - ESCORT_SHARE * escorts);
  const shield = inp.shieldQuality == null ? 0 : inp.hpRef * (SHIELD_COEF[inp.shieldQuality] ?? 0);
  const pills = Math.min(inp.healPills ?? 0, maxHealPills(tribulationDurationS(inp.spec)));
  const heal = pills * HEAL_PILL_PCT * inp.hpRef;
  const net = afterReduction - shield - heal;
  const survives = net < inp.hpMax;
  return {
    raw,
    reduction,
    afterReduction,
    shield,
    heal,
    net,
    survives,
    overkill: net - inp.hpMax,
    remainingHpFraction: Math.max(0, (inp.hpMax - net) / inp.hpMax),
  };
}
