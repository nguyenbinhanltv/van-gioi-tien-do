/**
 * Công thức §6 — composite drop resolution on top of the printed drop matrix (economy.ts).
 *
 * Pure and deterministic: no Math.random / Date.now; the caller supplies a uniform [0,1) generator (for example the
 * seeded `mulberry32`). Draw order is fixed (see `DROP_ITEM_ORDER`): one draw per item for the hit test, then one for the
 * quantity (only on a hit, only for items with a range), then one for the quality (only on a hit, only for pills and
 * blueprints). The same seed and context therefore always give the same result.
 *
 * Documented defaults where docs/07 §6 is ambiguous are listed in docs/OPEN-ITEMS.md section 16.
 */
import {
  BOSS_REPEAT_STONE_FACTOR,
  DROP_TABLE,
  QUALITY_DISTRIBUTION,
  blueprintPityChance,
  depletionFactor,
  lowRealmFactor,
  partyFactor,
  stoneRealmMultiplier,
  type DropItem,
  type DropSource,
} from './economy.js';

/** Fixed iteration order (also the RNG draw order). */
export const DROP_ITEM_ORDER: readonly DropItem[] = [
  'stone_ha',
  'stone_trung',
  'stone_thuong',
  'heal_pill',
  'breakthrough_pill',
  'blueprint_white_green',
  'blueprint_blue_purple',
  'blueprint_gold_red',
  'craft_material',
];
export const STONE_ITEMS: readonly DropItem[] = ['stone_ha', 'stone_trung', 'stone_thuong'];
/** Quality index 0..5 = Trắng, Lục, Lam, Tím, Vàng, Đỏ. */
export const QUALITY_NAMES = ['trang', 'luc', 'lam', 'tim', 'vang', 'do'] as const;
/** Inclusive quality-index range of each blueprint line (docs/07 §6: "roll trong khoảng phẩm của dòng đã trúng"). */
export const BLUEPRINT_QUALITY_RANGE: Readonly<Partial<Record<DropItem, readonly [number, number]>>> = {
  blueprint_white_green: [0, 1],
  blueprint_blue_purple: [2, 3],
  blueprint_gold_red: [4, 5],
};
/** Items that roll a quality when they drop. */
export const QUALITY_ITEMS: readonly DropItem[] = [
  'heal_pill',
  'breakthrough_pill',
  'blueprint_white_green',
  'blueprint_blue_purple',
  'blueprint_gold_red',
];

export interface DropContext {
  readonly source: DropSource;
  /** Monster realm r >= 1 (stone quantities x 1.5^(r-1)). */
  readonly monsterRealm: number;
  /** Player realm minus monster realm (0 = same realm; 1 = one lower; >= 2 = materials only). */
  readonly realmGap?: number;
  /** Continuous farming in the same zone, hours (> 2 -> x 0.5). */
  readonly continuousFarmHours?: number;
  /** Party size n >= 1 (personal loot, each member x 1/sqrt(n)). */
  readonly partySize?: number;
  /** Boss only: this is a repeat kill of the weekly chest (stones only, x 0.3, no blueprint). */
  readonly bossRepeat?: boolean;
  /** Gold/Red blueprint attempts so far including this one (n >= 1); enables the pity chance. */
  readonly goldRedAttempt?: number;
}
export interface DropRoll {
  readonly item: DropItem;
  readonly qty: number;
  /** Quality index 0..5 for pills and blueprints. */
  readonly quality?: number;
}

/** Items that can drop at all under the context's realm gap / repeat-kill rules (before probabilities). */
function allowed(item: DropItem, ctx: DropContext): boolean {
  // Both restrictions apply together: 2+ realms lower leaves only materials, a boss repeat leaves only stones.
  if (lowRealmFactor(ctx.realmGap ?? 0) === null && item !== 'craft_material') return false;
  if (ctx.bossRepeat && ctx.source === 'boss' && !STONE_ITEMS.includes(item)) return false;
  return true;
}

/**
 * Probability that `item` drops from one kill under `ctx` (0 when it cannot). Modifiers multiply: low realm x0.2,
 * depletion x0.5, party 1/sqrt(n); the Gold/Red pity chance replaces the printed 0.2% when `goldRedAttempt` is given.
 * Crafting materials of 2+ realms lower keep their printed rate (only "nguyên liệu" remain), still party/depletion scaled.
 */
export function effectiveDropChance(item: DropItem, ctx: DropContext): number {
  const entry = DROP_TABLE[ctx.source][item];
  if (!entry || !allowed(item, ctx)) return 0;
  let p = entry.p;
  if (item === 'blueprint_gold_red' && ctx.goldRedAttempt !== undefined) p = blueprintPityChance(ctx.goldRedAttempt);
  const gap = lowRealmFactor(ctx.realmGap ?? 0);
  if (gap !== null) p *= gap;
  p *= depletionFactor(ctx.continuousFarmHours ?? 0);
  p *= partyFactor(ctx.partySize ?? 1);
  return Math.min(1, p);
}

/** Quantity multiplier of an item: stones x 1.5^(r-1), x 0.3 more on a boss repeat kill; others x 1. */
export function dropQuantityFactor(item: DropItem, ctx: DropContext): number {
  if (!STONE_ITEMS.includes(item)) return 1;
  return (
    stoneRealmMultiplier(ctx.monsterRealm) * (ctx.bossRepeat && ctx.source === 'boss' ? BOSS_REPEAT_STONE_FACTOR : 1)
  );
}

/** Expected quantity of `item` per kill: P(drop) x mean(range) x quantity factor (before integer rounding). */
export function expectedDropQuantity(item: DropItem, ctx: DropContext): number {
  const entry = DROP_TABLE[ctx.source][item];
  if (!entry) return 0;
  const mean = entry.qty ? (entry.qty[0] + entry.qty[1]) / 2 : 1;
  return effectiveDropChance(item, ctx) * mean * dropQuantityFactor(item, ctx);
}

/** Expected Linh thạch (hạ phẩm) per kill under the context, before integer rounding. */
export function expectedStones(ctx: DropContext): number {
  const values: Readonly<Record<string, number>> = { stone_ha: 1, stone_trung: 100, stone_thuong: 10_000 };
  return STONE_ITEMS.reduce((n, item) => n + expectedDropQuantity(item, ctx) * values[item]!, 0);
}

/**
 * Pick a quality index from the source's distribution, restricted (and renormalised) to `range` when given.
 * `u` is a uniform [0,1) draw.
 */
export function rollQuality(source: DropSource, u: number, range: readonly [number, number] = [0, 5]): number {
  const dist = QUALITY_DISTRIBUTION[source];
  let total = 0;
  for (let q = range[0]; q <= range[1]; q++) total += dist[q]!;
  let acc = 0;
  const target = u * total;
  for (let q = range[0]; q <= range[1]; q++) {
    acc += dist[q]!;
    if (target < acc) return q;
  }
  return range[1];
}

/** Integer quantity in [lo, hi] from a uniform draw. */
export function rollQuantity(lo: number, hi: number, u: number): number {
  return lo + Math.min(hi - lo, Math.floor(u * (hi - lo + 1)));
}

/** Resolve one kill: returns the drops in `DROP_ITEM_ORDER`. */
export function resolveDrops(ctx: DropContext, rng: () => number): DropRoll[] {
  const out: DropRoll[] = [];
  for (const item of DROP_ITEM_ORDER) {
    const entry = DROP_TABLE[ctx.source][item];
    if (!entry) continue;
    const hit = rng() < effectiveDropChance(item, ctx);
    if (!hit) continue;
    let qty = 1;
    if (entry.qty) qty = rollQuantity(entry.qty[0], entry.qty[1], rng());
    // Default rounding: half up of qty x factor, at least 1 after a hit (OPEN-ITEMS section 16).
    qty = Math.max(1, Math.round(qty * dropQuantityFactor(item, ctx)));
    const roll: { item: DropItem; qty: number; quality?: number } = { item, qty };
    if (QUALITY_ITEMS.includes(item)) roll.quality = rollQuality(ctx.source, rng(), BLUEPRINT_QUALITY_RANGE[item]);
    out.push(roll);
  }
  return out;
}
