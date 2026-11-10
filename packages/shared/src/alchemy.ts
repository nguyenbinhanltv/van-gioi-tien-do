/**
 * Minimal alchemy (luyện đan tối giản, D108): the formulas of docs/13 §4-§6 and the MVP recipe table of §5.2.
 *
 * Every number here comes from docs/13 (success chance, promotion ladder, failure loss, furnace fee, reference cost, craft time, queue) except
 * the ones marked PROVISIONAL, which docs/13 leaves to a data file that does not exist yet (`recipes.json`): material counts, the quality
 * ceiling of a recipe, the mastery gain, the rounding of the fee, the furnace range. They are listed in docs/DECISIONS.md D108 and
 * docs/OPEN-ITEMS.md and need a game designer / economy review. In-game currency only; there is no price in real money anywhere.
 *
 * Pure and deterministic: rolls take and return an RNG state (`rng.ts`), nothing reads a clock.
 */
import { rngFloat, type RngState } from './rng.js';

export const ALCHEMY = {
  /** crafting opens at Trúc Cơ (realm 2): docs/13 §1, docs/07 §8 `unlocks: crafting` */
  MIN_REALM: 2,
  /** casting time of one craft and the longest queue (docs/13 §9) */
  CRAFT_MS: 5000,
  QUEUE_MAX: 10,
  /** how close to the furnace NPC a player must stand (tiles). PROVISIONAL: the same 20 tiles as the sect NPC (D98), enough for the dev spawn area */
  FURNACE_RANGE_TILES: 20,
  /** P_ok = clamp(S_D + SCORE_STEP * score, P_MIN, P_MAX), S_D = S0 - D_STEP * (D - 1)   (docs/13 §4.2) */
  S0: 0.95,
  D_STEP: 0.07,
  SCORE_STEP: 0.02,
  P_MIN: 0.4,
  P_MAX: 0.98,
  /** promotion ladder: from tier k to k+1 with probability clamp(a_k + PROMOTE_SCORE * score, 0, PROMOTE_MAX)   (docs/13 §4.3) */
  PROMOTE_BASE: [0.5, 0.4, 0.3, 0.18, 0.08] as readonly number[],
  PROMOTE_SCORE: 0.04,
  PROMOTE_MAX: 0.9,
  /** a failed craft destroys this share of the MAIN materials, rounded up; the catalyst is lost entirely (docs/13 §4.4) */
  FAIL_DESTROY: 0.6,
  /** furnace fee = FEE_RATE x V(r, q) in Linh thạch hạ, paid to the NPC and destroyed (docs/13 §6.1). Rounded UP, at least 1: PROVISIONAL */
  FEE_RATE: 0.03,
  /** V_ref(r) = V_REF_R1 x V_REF_GROWTH^(r-1) (docs/13 §5.1) and kappa by tier for a main pill; a support pill is half, a restore pill 0,01 */
  V_REF_R1: 1610,
  V_REF_GROWTH: 1.5,
  KAPPA_MAIN: [0.15, 0.25, 0.4, 0.7, 1.2, 2.0] as readonly number[],
  KAPPA_SUPPORT_FACTOR: 0.5,
  KAPPA_RESTORE: 0.01,
  /** mastery points 0..100 per recipe: Score 0 below 50, 1 for 50..99, 2 at 100 (docs/13 §4.1) */
  MASTERY_MAX: 100,
  /** points gained by a successful craft: "cộng điểm giảm dần" with no numbers in the doc. PROVISIONAL: round(5 x (1 - m/100)), at least 1 */
  MASTERY_GAIN_BASE: 5,
} as const;

/** Quality tier indices (docs/13 §4.3): 0 Trắng .. 5 Đỏ. */
export const QUALITY_MAX = 5;

export type RecipeKind = 'restore' | 'main' | 'support';
/** Items a recipe can produce. They are bag item keys (items.ts). */
export type CraftOutputKey = 'heal_pill' | 'breakthrough_pill' | 'ho_mach_pill' | 'dinh_tam_pill';

export interface Recipe {
  /** wire id (u8), stable, never renumbered */
  readonly wireId: number;
  /** docs/13 §5.2 id (D24 naming) */
  readonly key: string;
  readonly name: string;
  /** recipe tier b: the realm of the threshold the pill serves; the crafter's realm must be >= b (docs/13 §2.1) */
  readonly tier: number;
  /** difficulty D 1..6 */
  readonly difficulty: number;
  readonly kind: RecipeKind;
  readonly output: CraftOutputKey;
  /** `craft_material` units per craft (PROVISIONAL: docs/13 §5.2 puts the counts in a data file that does not exist yet) */
  readonly materials: number;
  /** highest quality tier a craft can reach, the quality of the recipe scroll (docs/13 §4.3). PROVISIONAL: Tím for every NPC-taught recipe; Vàng / Đỏ stay with boss-dropped scrolls, which do not exist yet */
  readonly qualityCap: number;
}

/**
 * The MVP recipes that have an item to produce today. Left out on purpose (gaps in OPEN-ITEMS D108): `pill_tu_khi_dan` (no tu vi pill effect
 * defined), `pill_hoi_khi_dan` (no mana pill item), everything of Luyện Khí and Chế Phù (docs/10 §7: beta is Luyện Đan only).
 */
export const RECIPES: readonly Recipe[] = [
  {
    wireId: 1,
    key: 'pill_hoi_huyet_dan',
    name: 'Hồi Huyết Đan',
    tier: 1,
    difficulty: 1,
    kind: 'restore',
    output: 'heal_pill',
    materials: 3,
    qualityCap: 3,
  },
  {
    wireId: 2,
    key: 'pill_truc_co_dan',
    name: 'Trúc Cơ Đan',
    tier: 1,
    difficulty: 3,
    kind: 'main',
    output: 'breakthrough_pill',
    materials: 15,
    qualityCap: 3,
  },
  {
    wireId: 3,
    key: 'pill_ket_kim_dan',
    name: 'Kết Kim Đan',
    tier: 2,
    difficulty: 4,
    kind: 'main',
    output: 'breakthrough_pill',
    materials: 25,
    qualityCap: 3,
  },
  {
    wireId: 4,
    key: 'pill_ho_mach_dan',
    name: 'Hộ Mạch Đan',
    tier: 2,
    difficulty: 3,
    kind: 'support',
    output: 'ho_mach_pill',
    materials: 10,
    qualityCap: 3,
  },
  {
    wireId: 5,
    key: 'pill_dinh_tam_dan',
    name: 'Định Tâm Đan',
    tier: 2,
    difficulty: 3,
    kind: 'support',
    output: 'dinh_tam_pill',
    materials: 10,
    qualityCap: 3,
  },
];
export const recipeByWireId = (id: number): Recipe | undefined => RECIPES.find((r) => r.wireId === id);
export const recipeByKey = (key: string): Recipe | undefined => RECIPES.find((r) => r.key === key);

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));

/** Mastery component of the Score (docs/13 §4.1): 0 below 50, 1 for 50..99, 2 at 100. */
export function masteryScore(points: number): number {
  return points >= ALCHEMY.MASTERY_MAX ? 2 : points >= 50 ? 1 : 0;
}
/** Points a successful craft adds (PROVISIONAL, diminishing); never above MASTERY_MAX. */
export function masteryGain(points: number): number {
  const p = clamp(Math.floor(points), 0, ALCHEMY.MASTERY_MAX);
  return Math.min(
    ALCHEMY.MASTERY_MAX - p,
    Math.max(1, Math.round(ALCHEMY.MASTERY_GAIN_BASE * (1 - p / ALCHEMY.MASTERY_MAX))),
  );
}

/**
 * Score 0..5 of a craft (docs/13 §4.1): mastery 0..2 + tool 0..2 + catalyst 0..1. The sect furnace is a white-green one (tool 0) and no
 * catalyst item exists yet, so today only the mastery counts; the other two are parameters for the day they do.
 */
export function craftScore(masteryPoints: number, tool = 0, catalyst = 0): number {
  return clamp(masteryScore(masteryPoints) + clamp(tool, 0, 2) + clamp(catalyst, 0, 1), 0, 5);
}

/** P_ok of a recipe of difficulty D at `score` (docs/13 §4.2): 0,95 / 0,88 / ... minus nothing, plus 0,02 per point, clamped 0,40..0,98. */
export function craftSuccessChance(difficulty: number, score: number): number {
  const sd = ALCHEMY.S0 - ALCHEMY.D_STEP * (clamp(Math.round(difficulty), 1, 6) - 1);
  return clamp(sd + ALCHEMY.SCORE_STEP * clamp(score, 0, 5), ALCHEMY.P_MIN, ALCHEMY.P_MAX);
}

/** Promotion probabilities p_k of the quality ladder at `score` (docs/13 §4.3). */
export function promotionChances(score: number): number[] {
  return ALCHEMY.PROMOTE_BASE.map((a) => clamp(a + ALCHEMY.PROMOTE_SCORE * clamp(score, 0, 5), 0, ALCHEMY.PROMOTE_MAX));
}

/** Probability of each quality tier 0..5 (docs/13 §4.3 table), the roll clamped by `cap`: tiers above the cap fold onto the cap. */
export function qualityDistribution(score: number, cap = QUALITY_MAX): number[] {
  const p = promotionChances(score);
  const out = [0, 0, 0, 0, 0, 0];
  let reach = 1;
  for (let k = 0; k <= QUALITY_MAX; k++) {
    const up = k < QUALITY_MAX ? p[k]! : 0;
    out[Math.min(k, cap)]! += reach * (1 - up);
    reach *= up;
  }
  return out;
}

/** Reference cost V(r, q) in Linh thạch hạ (docs/13 §5.1) of a recipe tier and quality, for the kind's kappa. */
export function referenceCost(tier: number, quality: number, kind: RecipeKind): number {
  if (kind === 'restore') return ALCHEMY.KAPPA_RESTORE * ALCHEMY.V_REF_R1 * ALCHEMY.V_REF_GROWTH ** (tier - 1);
  const kappa =
    ALCHEMY.KAPPA_MAIN[clamp(quality, 0, QUALITY_MAX)]! * (kind === 'support' ? ALCHEMY.KAPPA_SUPPORT_FACTOR : 1);
  return kappa * ALCHEMY.V_REF_R1 * ALCHEMY.V_REF_GROWTH ** (tier - 1);
}
/** Furnace fee of one craft in Linh thạch hạ: 3% of V at the recipe's quality ceiling, rounded up, at least 1 (rounding PROVISIONAL). */
export function craftFee(recipe: Recipe): number {
  return Math.max(1, Math.ceil(ALCHEMY.FEE_RATE * referenceCost(recipe.tier, recipe.qualityCap, recipe.kind) - 1e-9));
}
/** Main materials destroyed by a failed craft: 60 %, rounded up (docs/13 §4.4). */
export const failedMaterialLoss = (materials: number): number => Math.ceil(materials * ALCHEMY.FAIL_DESTROY - 1e-9);

export interface CraftRoll {
  success: boolean;
  /** quality tier 0..5 when `success`, else 0 */
  quality: number;
  /** the two draws, for the log (docs/13 §4: every roll is recorded) */
  drawA: number;
  drawsB: number[];
}

/**
 * One craft roll (docs/13 §4): step A success, then step B the promotion ladder capped by the recipe. Draw order is fixed: A, then one draw per
 * ladder step until the first failed promotion. Returns the next RNG state.
 */
export function rollCraft(recipe: Recipe, score: number, rng: RngState): [CraftRoll, RngState] {
  const [a, afterA] = rngFloat(rng);
  let s = afterA;
  const success = a < craftSuccessChance(recipe.difficulty, score);
  if (!success) return [{ success: false, quality: 0, drawA: a, drawsB: [] }, s];
  const p = promotionChances(score);
  const drawsB: number[] = [];
  let tier = 0;
  while (tier < QUALITY_MAX) {
    let u: number;
    [u, s] = rngFloat(s);
    drawsB.push(u);
    if (u < p[tier]!) tier++;
    else break;
  }
  return [{ success: true, quality: Math.min(tier, recipe.qualityCap), drawA: a, drawsB }, s];
}
