/**
 * Render layer model L0–L7 and draw order (docs/04-tilemap.md §3–4, docs/06-toi-uu-render.md §2).
 *
 *  - Only L3 is Y-sorted (with the player / monsters). L0–L2 and L4–L7 keep insertion order.
 *  - Order inside L3 is `compareDrawOrder` from @vgtd/shared: elevation group → sortY → x → id.
 *  - Multi-tile objects sort by the footprint's bottom (S) vertex; footprints wider than `maxUnslicedSpan`
 *    (default 2) are cut into one-column slices, each with its own pivot (docs: "vật lớn cắt lát dọc rộng 1 ô").
 *  - Ground of level k is drawn between Y-sort group k-1 and group k (cliff faces belong to the LOWER group).
 *
 * y is screen-down; the Cocos client must flip y when feeding sprite positions.
 */
import {
  Layer,
  MAX_HEIGHT_LEVELS,
  TILE_HALF_HEIGHT,
  TILE_HALF_WIDTH,
  Y_SORTED_LAYER,
  cliffFaceGroup,
  compareDrawOrder,
  footprintSortY,
  pivotSortY,
  tileToScreen,
} from '@vgtd/shared';
import type { Rect, Sortable } from '@vgtd/shared';
import type { WorldObject } from './types.js';

/**
 * Static objects are nudged slightly *behind* on sortY ties; the bigger the footprint the more, so that
 *  - an entity (bias 0) standing in the cell directly in front (+j) of a prop is drawn after it
 *    (shared's x tie-break alone would flip it), and
 *  - on an exact tie a larger footprint is drawn before a smaller neighbour (a 1×1 directly in front of a 2×2).
 * The nudge stays far below the 16 px spacing of integer footprint vertices.
 */
export const STATIC_SORT_BIAS = 0.01;
const AREA_BIAS = 0.001;

export function staticSortBias(footprintArea: number): number {
  return STATIC_SORT_BIAS + AREA_BIAS * Math.min(footprintArea, 100);
}

/** Ids of slices are `sourceId * SLICE_ID_STRIDE + k`; entities use `entityId * SLICE_ID_STRIDE`. */
export const SLICE_ID_STRIDE = 64;

export interface DrawItem extends Sortable {
  layer: Layer;
  /** Screen bounding box of the (slice of the) sprite, px @1x, y down. Used by occlusion. */
  rect: Rect;
  /** Id of the object / entity this item belongs to (slices share it). */
  sourceId: number;
  dynamic: boolean;
  /** Original tile footprint of the source (for diagnostics / tests). */
  footprint?: { i0: number; j0: number; w: number; h: number };
}

// ------------------------------------------------------------------ item factories
/** Draw items for a static object: 1 item, or one per screen column when the footprint is wider than maxUnslicedSpan (L3 only). */
export function objectDrawItems(o: WorldObject, maxUnslicedSpan = 2): DrawItem[] {
  const s = tileToScreen(o.i0 + o.w, o.j0 + o.h, o.group); // S vertex, lifted by elevation
  const base = {
    layer: o.layer,
    group: o.group,
    dynamic: false,
    sourceId: o.id,
    footprint: { i0: o.i0, j0: o.j0, w: o.w, h: o.h },
  };
  const bias = staticSortBias(o.w * o.h);
  const left = s.x - o.spriteWidth / 2;
  const top = s.y - o.spriteHeight;
  const whole: DrawItem = {
    ...base,
    id: o.id * SLICE_ID_STRIDE,
    sortY: (o.sortY ?? footprintSortY(o.i0, o.j0, o.w, o.h)) - bias,
    x: s.x,
    rect: { x: left, y: top, width: o.spriteWidth, height: o.spriteHeight },
  };
  if (o.layer !== Y_SORTED_LAYER || Math.max(o.w, o.h) <= maxUnslicedSpan) return [whole];

  const dMin = o.i0 - (o.j0 + o.h - 1);
  const dMax = o.i0 + o.w - 1 - o.j0;
  if (dMax - dMin + 1 > SLICE_ID_STRIDE) throw new Error(`footprint ${o.w}x${o.h} too large to slice`);
  const right = left + o.spriteWidth;
  const out: DrawItem[] = [];
  for (let d = dMin; d <= dMax; d++) {
    // front-most cell of the column i - j = d: largest i with j = i - d inside the footprint
    const i = Math.min(o.i0 + o.w - 1, o.j0 + o.h - 1 + d);
    const j = i - d;
    const x0 = d === dMin ? left : Math.max(left, d * TILE_HALF_WIDTH - TILE_HALF_WIDTH / 2);
    const x1 = d === dMax ? right : Math.min(right, d * TILE_HALF_WIDTH + TILE_HALF_WIDTH / 2);
    out.push({
      ...base,
      id: o.id * SLICE_ID_STRIDE + (d - dMin),
      sortY: footprintSortY(i, j, 1, 1) - staticSortBias(1), // a slice behaves like its 1×1 front cell
      x: tileToScreen(i + 1, j + 1).x,
      rect: { x: x0, y: top, width: x1 - x0, height: o.spriteHeight },
    });
  }
  return out;
}

export interface EntityLike {
  id: number;
  /** Continuous tile position of the pivot (feet). */
  i: number;
  j: number;
  /** Elevation group the entity stands on. */
  group: number;
  /** Sprite size px @1x, bottom-centre anchored at the pivot. */
  width: number;
  height: number;
  /** Boss n×n: pass the side n; sortY then = footprint bottom vertex of the n×n footprint around the centre. */
  bossSize?: number;
}

/** Player / monster / NPC. Pivot sortY ignores jump / knock-up height (pass elevation only through `group`). */
export function entityDrawItem(e: EntityLike): DrawItem {
  const p = tileToScreen(e.i, e.j, e.group);
  const n = e.bossSize ?? 0;
  const sortY = n > 0 ? footprintSortY(e.i - n / 2, e.j - n / 2, n, n) : pivotSortY(e.i, e.j);
  return {
    layer: Layer.L3_YSORT,
    group: e.group,
    sortY,
    x: tileToScreen(e.i, e.j).x,
    id: e.id * SLICE_ID_STRIDE,
    sourceId: e.id,
    dynamic: true,
    rect: { x: p.x - e.width / 2, y: p.y - e.height, width: e.width, height: e.height },
  };
}

/**
 * Cliff face of the HIGHER tile (i, j) whose top is `topLevel`; its SE / SW faces drop towards +i / +j.
 * Belongs to the lower group (cliffFaceGroup); sprite is 64 × (32 + 32·levels). Pivot sits on the foot edge nearest
 * the viewer, sortY = (i + j + 1)·16, so an entity standing on the lower ground in front of the face (sum ≥ i+j+1)
 * is always drawn after it.
 */
export function cliffFaceObject(id: number, i: number, j: number, topLevel: number, levels = 1): WorldObject {
  const group = Math.min(MAX_HEIGHT_LEVELS, cliffFaceGroup(topLevel));
  return {
    id,
    layer: Layer.L3_YSORT,
    i0: i,
    j0: j,
    w: 1,
    h: 1,
    group,
    spriteWidth: 64,
    spriteHeight: 32 + 32 * levels,
    sortY: (i + j + 1) * TILE_HALF_HEIGHT,
    heightTiles: levels,
    kind: 'cliff',
  };
}

// ------------------------------------------------------------------ ordering
/** Sort the L3 items in place (stable for equal keys because the comparator ends with id) and return them. */
export function sortYSortLayer<T extends Sortable>(items: T[]): T[] {
  return items.sort(compareDrawOrder);
}

/** Flat draw order: layers ascending; only L3 is sorted, other layers keep the caller's order. */
export function orderForDraw(items: readonly DrawItem[]): DrawItem[] {
  const buckets: DrawItem[][] = [];
  for (const it of items) (buckets[it.layer] ??= []).push(it);
  const out: DrawItem[] = [];
  for (let l = 0; l < buckets.length; l++) {
    const b = buckets[l];
    if (!b) continue;
    out.push(...(l === Y_SORTED_LAYER ? sortYSortLayer(b) : b));
  }
  return out;
}

export type DrawStep =
  | { kind: 'ground'; level: number; items: DrawItem[] }
  | { kind: 'ysort'; group: number; items: DrawItem[] }
  | { kind: 'layer'; layer: Layer; items: DrawItem[] };

/**
 * Draw plan honouring elevation groups: for level 0..4 → ground (L0–L2 of that level, shifted up 32 px per level
 * by the caller) then Y-sort group of that level; afterwards L4..L7 in order.
 */
export function buildDrawPlan(items: readonly DrawItem[]): DrawStep[] {
  const ground: DrawItem[][] = [];
  const ysort: DrawItem[][] = [];
  const upper: DrawItem[][] = [];
  const clamp = (g: number): number => Math.min(MAX_HEIGHT_LEVELS, Math.max(0, g));
  for (const it of items) {
    if (it.layer === Y_SORTED_LAYER) (ysort[clamp(it.group)] ??= []).push(it);
    else if (it.layer < Y_SORTED_LAYER) (ground[clamp(it.group)] ??= []).push(it);
    else (upper[it.layer] ??= []).push(it);
  }
  const steps: DrawStep[] = [];
  for (let level = 0; level <= MAX_HEIGHT_LEVELS; level++) {
    const g = ground[level];
    if (g?.length) steps.push({ kind: 'ground', level, items: [...g].sort((a, b) => a.layer - b.layer) });
    const y = ysort[level];
    if (y?.length) steps.push({ kind: 'ysort', group: level, items: sortYSortLayer(y) });
  }
  for (let layer = Y_SORTED_LAYER + 1; layer < upper.length; layer++) {
    const u = upper[layer];
    if (u?.length) steps.push({ kind: 'layer', layer, items: u });
  }
  return steps;
}

// ------------------------------------------------------------------ verification helper
/**
 * Ground-truth "A must be drawn before B" for two non-overlapping footprints in the same group:
 * A is behind B when it lies entirely on the lower-i side (A.i1 ≤ B.i0) or lower-j side (A.j1 ≤ B.j0), unless the
 * opposite relation also holds on the other axis (then they sit side by side on screen and any order is fine).
 */
export function footprintMustPrecede(
  a: { i0: number; j0: number; w: number; h: number },
  b: { i0: number; j0: number; w: number; h: number },
): boolean {
  const aBehindI = a.i0 + a.w <= b.i0 && a.j0 < b.j0 + b.h;
  const aBehindJ = a.j0 + a.h <= b.j0 && a.i0 < b.i0 + b.w;
  const bBehindI = b.i0 + b.w <= a.i0 && b.j0 < a.j0 + a.h;
  const bBehindJ = b.j0 + b.h <= a.j0 && b.i0 < a.i0 + a.w;
  return (aBehindI || aBehindJ) && !(bBehindI || bBehindJ);
}

export interface OrderInversion {
  first: DrawItem;
  second: DrawItem;
}

function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Finds pairs in an already ordered L3 list whose screen rects overlap yet whose drawing order contradicts
 * `footprintMustPrecede` (same group) or group order. O(n²): meant for tests / debug overlays.
 */
export function findDrawOrderInversions(ordered: readonly DrawItem[]): OrderInversion[] {
  const out: OrderInversion[] = [];
  for (let x = 0; x < ordered.length; x++) {
    for (let y = x + 1; y < ordered.length; y++) {
      const first = ordered[x]!;
      const second = ordered[y]!;
      if (first.sourceId === second.sourceId && first.dynamic === second.dynamic) continue;
      if (!rectsOverlap(first.rect, second.rect)) continue;
      if (first.group > second.group) {
        out.push({ first, second });
        continue;
      }
      if (first.group === second.group && first.footprint && second.footprint) {
        if (footprintMustPrecede(second.footprint, first.footprint)) out.push({ first, second });
      }
    }
  }
  return out;
}
