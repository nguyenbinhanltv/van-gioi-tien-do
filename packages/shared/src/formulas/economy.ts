/**
 * Công thức §6–7 — drop rates, market tax, teleport fee, durability, repair.
 * Currency unit: hạ phẩm Linh thạch (trung = 100, thượng = 10,000).
 */
import { clamp } from './breakthrough.js';

export const STONE_VALUE = { ha: 1, trung: 100, thuong: 10_000 } as const;

// ---------------------------------------------------------------- drop matrix
export type DropSource = 'field' | 'elite' | 'boss';
export interface DropEntry {
  /** probability 0..1 */
  p: number;
  /** inclusive quantity range */
  qty?: readonly [number, number];
}
export type DropItem =
  | 'stone_ha'
  | 'stone_trung'
  | 'stone_thuong'
  | 'heal_pill'
  | 'breakthrough_pill'
  | 'blueprint_white_green'
  | 'blueprint_blue_purple'
  | 'blueprint_gold_red'
  | 'craft_material';

export const DROP_TABLE: Readonly<Record<DropSource, Readonly<Partial<Record<DropItem, DropEntry>>>>> = {
  field: {
    stone_ha: { p: 0.35, qty: [1, 3] },
    stone_trung: { p: 0.005, qty: [1, 1] },
    heal_pill: { p: 0.03, qty: [1, 1] },
    breakthrough_pill: { p: 0.0002 },
    blueprint_white_green: { p: 0.0005 },
    craft_material: { p: 0.25, qty: [1, 2] },
  },
  elite: {
    stone_ha: { p: 1, qty: [5, 12] },
    stone_trung: { p: 0.08, qty: [1, 1] },
    stone_thuong: { p: 0.001, qty: [1, 1] },
    heal_pill: { p: 0.15, qty: [1, 2] },
    breakthrough_pill: { p: 0.005 },
    blueprint_white_green: { p: 0.01 },
    blueprint_blue_purple: { p: 0.0005 },
    craft_material: { p: 0.6, qty: [2, 4] },
  },
  boss: {
    stone_ha: { p: 1, qty: [40, 80] },
    stone_trung: { p: 1, qty: [2, 5] },
    stone_thuong: { p: 0.12, qty: [1, 1] },
    heal_pill: { p: 1, qty: [2, 4] },
    breakthrough_pill: { p: 0.06 },
    blueprint_white_green: { p: 0.15 },
    blueprint_blue_purple: { p: 0.03 },
    blueprint_gold_red: { p: 0.002 },
    craft_material: { p: 1, qty: [3, 6] },
  },
};

/** Quality distribution when a pill/blueprint drops: [Trắng, Lục, Lam, Tím, Vàng, Đỏ]. */
export const QUALITY_DISTRIBUTION: Readonly<Record<DropSource, readonly number[]>> = {
  field: [0.5, 0.3, 0.14, 0.05, 0.009, 0.001],
  elite: [0.3, 0.35, 0.22, 0.1, 0.025, 0.005],
  boss: [0.1, 0.25, 0.35, 0.22, 0.07, 0.01],
};

const STONE_ITEMS: Readonly<Record<string, number>> = {
  stone_ha: STONE_VALUE.ha,
  stone_trung: STONE_VALUE.trung,
  stone_thuong: STONE_VALUE.thuong,
};

/** Expected Linh thạch (in hạ phẩm) per kill at realm 1, before modifiers. */
export function expectedStoneValue(source: DropSource): number {
  let total = 0;
  for (const [item, value] of Object.entries(STONE_ITEMS)) {
    const e = DROP_TABLE[source][item as DropItem];
    if (!e) continue;
    const avg = e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1;
    total += e.p * avg * value;
  }
  return total;
}

/** Realm multiplier on stone quantities: 1.5^(r−1). */
export function stoneRealmMultiplier(monsterRealm: number): number {
  return Math.pow(1.5, monsterRealm - 1);
}

export const FARM_DEPLETION = { AFTER_HOURS: 2, MULTIPLIER: 0.5, RECOVER_HOURS: 6 } as const;
export const LOW_REALM_MULTIPLIER = 0.2;

/**
 * Drop-rate multiplier for kills where the monster is `realmGap` realms below the player.
 * 0 → 1.0, 1 → ×0.2, ≥2 → null (only crafting materials drop).
 */
export function lowRealmFactor(realmGap: number): number | null {
  if (realmGap <= 0) return 1;
  if (realmGap === 1) return LOW_REALM_MULTIPLIER;
  return null;
}
/** Party personal-loot factor 1/√n per member (4 players → 0.5 each, 2× total). */
export function partyFactor(partySize: number): number {
  return 1 / Math.sqrt(Math.max(1, partySize));
}
export function depletionFactor(continuousFarmHours: number): number {
  return continuousFarmHours > FARM_DEPLETION.AFTER_HOURS ? FARM_DEPLETION.MULTIPLIER : 1;
}

/** Gold/Red blueprint pity: chance of the n-th attempt (n ≥ 1) = 0.002·(1 + 0.15n); guaranteed at n = 30. */
export const BLUEPRINT_PITY = { BASE: 0.002, SLOPE: 0.15, GUARANTEE_AT: 30 } as const;
export function blueprintPityChance(n: number): number {
  if (n >= BLUEPRINT_PITY.GUARANTEE_AT) return 1;
  return BLUEPRINT_PITY.BASE * (1 + BLUEPRINT_PITY.SLOPE * n);
}
/** Weekly boss chest repeat kills: stone × 0.3, no blueprint. */
export const BOSS_REPEAT_STONE_FACTOR = 0.3;

// ---------------------------------------------------------------- market
export const MARKET = {
  LISTING_FEE: 0.01,
  LISTING_FEE_MIN: 1,
  TAX_MIN: 0.05,
  TAX_MAX: 0.1,
  TAX_CPI_SLOPE: 0.5,
  TAX_CPI_THRESHOLD: 1.02,
  DIRECT_TRADE_TAX: 0.03,
} as const;

/** τ = clamp(0.05 + 0.5 · max(0, CPI_w − 1.02), 0.05, 0.10). `cpi` is the ratio this week / last week. */
export function marketSaleTax(cpi: number): number {
  return clamp(
    MARKET.TAX_MIN + MARKET.TAX_CPI_SLOPE * Math.max(0, cpi - MARKET.TAX_CPI_THRESHOLD),
    MARKET.TAX_MIN,
    MARKET.TAX_MAX,
  );
}
/** Non-refundable listing fee: 1% of price, min 1 hạ phẩm (rounded up). */
export function listingFee(price: number): number {
  return Math.max(MARKET.LISTING_FEE_MIN, Math.ceil(price * MARKET.LISTING_FEE));
}
/** What the seller receives after tax τ. */
export function sellerProceeds(price: number, tax: number): number {
  return price * (1 - tax);
}
export function directTradeTax(amount: number): number {
  return amount * MARKET.DIRECT_TRADE_TAX;
}

// ---------------------------------------------------------------- teleport / durability / repair
/** Fee = 20 · 1.5^(r−1) · (1 + 0.5·d) hạ phẩm; r = player realm, d = zones crossed. */
export function teleportFee(realm: number, zonesCrossed: number): number {
  return 20 * Math.pow(1.5, realm - 1) * (1 + 0.5 * zonesCrossed);
}

export type DurabilityEvent = 'death_pve' | 'death_pvp' | 'death_tribulation';
export const DURABILITY_LOSS: Readonly<Record<DurabilityEvent, number>> = {
  death_pve: 0.08,
  death_pvp: 0.04,
  death_tribulation: 0.15,
};
export const DURABILITY_LOSS_PER_30MIN_COMBAT = 0.01;
export const DEMONIC_DURABILITY_MULTIPLIER = 1.5;
export function durabilityLoss(event: DurabilityEvent, demonic = false): number {
  return DURABILITY_LOSS[event] * (demonic ? DEMONIC_DURABILITY_MULTIPLIER : 1);
}
/** RepairCost = V_item · 0.004 · Δ%  (Δ% in percentage points, 0..100). */
export function repairCost(itemValue: number, deltaPercentPoints: number): number {
  return itemValue * 0.004 * deltaPercentPoints;
}
/** Player blacksmith: materials + 50% of the NPC Linh thạch fee. */
export const PLAYER_SMITH_STONE_FACTOR = 0.5;

/** Target sink composition (shares sum to 1). */
export const SINK_TARGETS = {
  breakthrough: 0.35,
  marketTax: 0.15,
  repair: 0.15,
  guardianArrayAndLeyLine: 0.15,
  teleport: 0.08,
  tierSwapAndOther: 0.12,
} as const;
export const SINK_SOURCE_RATIO_TARGET: readonly [number, number] = [0.9, 1.0];

// ---------------------------------------------------------------- crafting (docs/13 s4-s6, "Đề xuất")
/** docs/13 s5.1: value factor of a product by quality [Trắng … Đỏ]; V(r, q) = kappa_q · V_ref(r), V_ref(r) = 1610 · 1.5^(r−1). */
export const CRAFT_QUALITY_KAPPA: readonly number[] = [0.15, 0.25, 0.4, 0.7, 1.2, 2.0];
/** docs/13 s6: furnace fee = 3% of V(r, q) per craft, paid to the NPC and destroyed (`SYSTEM_SINK_CRAFT_FEE`). */
export const CRAFT_FEE_RATE = 0.03;
/** docs/13 s4.3 quality ladder: at rung k (0..4) promote with p_k = clamp(a_k + 0.04 · Score, 0, 0.9). */
export const CRAFT_LADDER = { A: [0.5, 0.4, 0.3, 0.18, 0.08], SCORE_STEP: 0.04, MAX_P: 0.9 } as const;
/** docs/13 s4.2: P_ok = clamp(S_D + 0.02 · Score, 0.40, 0.98), S_D = 0.95 − 0.07 · (D − 1), D = recipe difficulty 1..6. */
export const CRAFT_SUCCESS = { BASE: 0.95, PER_DIFFICULTY: 0.07, PER_SCORE: 0.02, MIN: 0.4, MAX: 0.98 } as const;

/** Value (hạ phẩm) of a product of `realm` and `quality` index 0..5: kappa_q · V_ref(r). */
export function craftValue(realm: number, quality: number): number {
  const k = CRAFT_QUALITY_KAPPA[quality];
  if (k === undefined) throw new RangeError(`quality ${quality} out of range 0..5`);
  return k * expectedStoneValue('boss') * stoneRealmMultiplier(realm);
}
/** Chance of promoting from rung `k` (0..4) to quality k + 1 at crafting `score` 0..5. */
export function craftPromoteChance(k: number, score: number): number {
  const a = CRAFT_LADDER.A[k];
  if (a === undefined) throw new RangeError(`rung ${k} out of range 0..4`);
  return clamp(a + CRAFT_LADDER.SCORE_STEP * score, 0, CRAFT_LADDER.MAX_P);
}
/** Step A: chance that a craft of difficulty `difficulty` (1..6) succeeds. */
export function craftSuccessChance(difficulty: number, score: number): number {
  return clamp(
    CRAFT_SUCCESS.BASE - CRAFT_SUCCESS.PER_DIFFICULTY * (difficulty - 1) + CRAFT_SUCCESS.PER_SCORE * score,
    CRAFT_SUCCESS.MIN,
    CRAFT_SUCCESS.MAX,
  );
}
/** Step B: probability of each final quality 0..5 at `score` (before the recipe's quality ceiling clamps it). */
export function craftQualityDistribution(score: number): number[] {
  const out: number[] = [];
  let reach = 1;
  for (let k = 0; k < 5; k++) {
    const p = craftPromoteChance(k, score);
    out.push(reach * (1 - p));
    reach *= p;
  }
  out.push(reach);
  return out;
}
