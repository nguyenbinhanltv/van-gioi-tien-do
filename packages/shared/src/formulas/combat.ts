/**
 * Công thức §4 — Ngũ hành matrix and total damage formula (current values, Hồ sơ §4):
 *   countering: +25% damage and target DEF × 0.85 for that hit; countered: −15% damage;
 *   generating (sinh): damage unchanged, supporter's ally restores 10% max MP (10 s cooldown per pair).
 *
 *   Raw      = ATK · c_skill
 *   DEF_eff  = DEF · D_elem · (1 − Pen),  D_elem = 0.85 if countering else 1
 *   DMG      = Raw² / (Raw + DEF_eff) · M_elem · Crit · Suppress · U(0.95, 1.05)
 *   Suppress = clamp(1 − 0.15·max(0, r_def − r_atk), 0.4, 1)
 */
import { clamp } from './breakthrough.js';

export type Element = 'kim' | 'moc' | 'thuy' | 'hoa' | 'tho';
export const ELEMENTS: readonly Element[] = ['kim', 'moc', 'thuy', 'hoa', 'tho'];

/** Wire code of an element (D120, `EnterEntity.element`): 0 = none, 1..5 = position in `ELEMENTS` + 1. */
export function elementWireId(e: Element | null | undefined): number {
  const k = e ? ELEMENTS.indexOf(e) : -1;
  return k < 0 ? 0 : k + 1;
}
/** Inverse of `elementWireId`; null for 0 or an unknown code. */
export function elementOfWireId(n: number): Element | null {
  return ELEMENTS[n - 1] ?? null;
}

/** Khắc (overcomes): Kim → Mộc → Thổ → Thủy → Hỏa → Kim. */
export const OVERCOMES: Readonly<Record<Element, Element>> = {
  kim: 'moc',
  moc: 'tho',
  tho: 'thuy',
  thuy: 'hoa',
  hoa: 'kim',
};
/** Sinh (generates): Kim → Thủy → Mộc → Hỏa → Thổ → Kim. */
export const GENERATES: Readonly<Record<Element, Element>> = {
  kim: 'thuy',
  thuy: 'moc',
  moc: 'hoa',
  hoa: 'tho',
  tho: 'kim',
};

export type Mutation = 'phong' | 'loi' | 'bang';
/** Mutated elements use the row/column of their base element. */
export const MUTATION_BASE: Readonly<Record<Mutation, Element>> = { phong: 'moc', loi: 'kim', bang: 'thuy' };

export const NGU_HANH = {
  OVERCOME_DAMAGE: 1.25,
  OVERCOME_DEF_MULTIPLIER: 0.85,
  COUNTERED_DAMAGE: 0.85,
  GENERATE_MP_RESTORE_PCT: 0.1,
  GENERATE_COOLDOWN_S: 10,
  MUTATION_CHANCE: 0.02,
} as const;

/**
 * Server combat rules taken from the docs (D75): base crit chance 5% inside a 60% cap (docs/31 B-10), PvE respawn after 10 s at
 * the nearest spawn point (docs/01 §12.2, "Thiết kế mới – chờ duyệt"). Crit multiplier is `CRIT_DEFAULT`.
 */
export const COMBAT_RULES = {
  BASE_CRIT_CHANCE: 0.05,
  CRIT_CHANCE_CAP: 0.6,
  RESPAWN_PVE_MS: 10_000,
} as const;

/** `skill_result.hits[].flags` bits on the wire: bit0 crit, bit1 the hit killed its target. */
export const HIT_FLAG_CRIT = 1;
export const HIT_FLAG_KILL = 2;

export const CRIT_DEFAULT = 1.5;
export const PEN_MAX = 0.4;
export const SUPPRESS_PER_REALM = 0.15;
export const SUPPRESS_FLOOR = 0.4;
export const DAMAGE_JITTER: readonly [number, number] = [0.95, 1.05];
/** Gear/skills/artifacts add at most 60% of base stats at the same realm. */
export const GEAR_BONUS_CAP = 0.6;

export type AnyElement = Element | Mutation;
export function baseElement(e: AnyElement): Element {
  return e in MUTATION_BASE ? MUTATION_BASE[e as Mutation] : (e as Element);
}

export type Relation = 'overcomes' | 'overcome_by' | 'generates' | 'generated_by' | 'neutral';
/** Relation of attacker element `a` to defender element `d`. */
export function relation(a: AnyElement, d: AnyElement): Relation {
  const A = baseElement(a);
  const D = baseElement(d);
  if (OVERCOMES[A] === D) return 'overcomes';
  if (OVERCOMES[D] === A) return 'overcome_by';
  if (GENERATES[A] === D) return 'generates';
  if (GENERATES[D] === A) return 'generated_by';
  return 'neutral';
}

/** M_elem: damage multiplier (row = attacker, column = defender). */
export function elementDamageMultiplier(attacker: AnyElement, defender: AnyElement): number {
  const r = relation(attacker, defender);
  if (r === 'overcomes') return NGU_HANH.OVERCOME_DAMAGE;
  if (r === 'overcome_by') return NGU_HANH.COUNTERED_DAMAGE;
  return 1;
}
/** D_elem: 0.85 only when the attacker overcomes the defender. */
export function defenseElementMultiplier(attacker: AnyElement, defender: AnyElement): number {
  return relation(attacker, defender) === 'overcomes' ? NGU_HANH.OVERCOME_DEF_MULTIPLIER : 1;
}

/** Full 5×5 matrix [attacker][defender]. */
export function buildDamageMatrix(): Record<Element, Record<Element, number>> {
  const m = {} as Record<Element, Record<Element, number>>;
  for (const a of ELEMENTS) {
    m[a] = {} as Record<Element, number>;
    for (const d of ELEMENTS) m[a][d] = elementDamageMultiplier(a, d);
  }
  return m;
}

/** Tương sinh khi hỗ trợ: does supporter element generate ally element (not self)? */
export function supportGeneratesAlly(supporter: AnyElement, ally: AnyElement): boolean {
  return GENERATES[baseElement(supporter)] === baseElement(ally);
}
/** MP restored to the ally (10% of max MP), or 0 when no sinh bond / self / on cooldown. */
export function generateSupportRestore(opts: {
  supporter: AnyElement;
  ally: AnyElement;
  allyMaxMp: number;
  isSelf?: boolean;
  /** seconds since the last restore for this (supporter → ally) pair */
  secondsSinceLast?: number;
}): number {
  if (opts.isSelf) return 0;
  if (!supportGeneratesAlly(opts.supporter, opts.ally)) return 0;
  if (opts.secondsSinceLast !== undefined && opts.secondsSinceLast < NGU_HANH.GENERATE_COOLDOWN_S) return 0;
  return opts.allyMaxMp * NGU_HANH.GENERATE_MP_RESTORE_PCT;
}

/** Defence element: armour element if any, otherwise the main root (highest-weight element). */
export function defenseElement(
  armourElement: AnyElement | null | undefined,
  rootWeights: Partial<Record<AnyElement, number>>,
): AnyElement {
  if (armourElement) return armourElement;
  let best: AnyElement | undefined;
  let bw = -Infinity;
  for (const [e, w] of Object.entries(rootWeights) as [AnyElement, number][]) {
    if (w > bw) {
      bw = w;
      best = e;
    }
  }
  if (!best) throw new Error('defenseElement: no armour element and empty root weights');
  return best;
}

/** Suppress: only the lower-realm attacker is penalised, −15% per realm, floor 40%. */
export function suppress(defRealm: number, atkRealm: number): number {
  return clamp(1 - SUPPRESS_PER_REALM * Math.max(0, defRealm - atkRealm), SUPPRESS_FLOOR, 1);
}

export interface DamageInput {
  atk: number;
  def: number;
  cSkill?: number;
  attackerElement?: AnyElement;
  defenderElement?: AnyElement;
  /** armour penetration 0..0.4 */
  pen?: number;
  crit?: boolean;
  critMultiplier?: number;
  attackerRealm?: number;
  defenderRealm?: number;
  /** random in [0,1) → mapped to U(0.95, 1.05); omit for the deterministic mean (1.0). */
  rand?: number;
}
export interface DamageBreakdown {
  raw: number;
  defEff: number;
  base: number;
  elementMultiplier: number;
  crit: number;
  suppress: number;
  jitter: number;
  damage: number;
}
export function damageBreakdown(i: DamageInput): DamageBreakdown {
  const raw = i.atk * (i.cSkill ?? 1);
  const hasElements = i.attackerElement !== undefined && i.defenderElement !== undefined;
  const dElem = hasElements ? defenseElementMultiplier(i.attackerElement!, i.defenderElement!) : 1;
  const mElem = hasElements ? elementDamageMultiplier(i.attackerElement!, i.defenderElement!) : 1;
  const pen = clamp(i.pen ?? 0, 0, PEN_MAX);
  const defEff = i.def * dElem * (1 - pen);
  const base = (raw * raw) / (raw + defEff);
  const crit = i.crit ? (i.critMultiplier ?? CRIT_DEFAULT) : 1;
  const sup = suppress(i.defenderRealm ?? 0, i.attackerRealm ?? 0);
  const jitter = i.rand === undefined ? 1 : DAMAGE_JITTER[0] + (DAMAGE_JITTER[1] - DAMAGE_JITTER[0]) * i.rand;
  return {
    raw,
    defEff,
    base,
    elementMultiplier: mElem,
    crit,
    suppress: sup,
    jitter,
    damage: base * mElem * crit * sup * jitter,
  };
}
export function computeDamage(i: DamageInput): number {
  return damageBreakdown(i).damage;
}
