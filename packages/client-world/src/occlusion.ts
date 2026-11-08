/**
 * Occlusion data (docs/06-toi-uu-render.md §3.1, docs/04-tilemap.md §4).
 *
 * Only the LOCAL player triggers anything. For every candidate we output flags the renderer applies:
 *  - L3 objects drawn after the player whose sprite rect overlaps the player's pick box get `inFront`
 *    (the "hole-punch" shader flag, vertex colour B). If an object taller than 2 tiles covers > 40 % of the pick
 *    box it also fades to 60 % alpha. `xray` tells the renderer to draw the silhouette pass (PC / high mobile).
 *  - L4/L5 overhead objects with a trigger polygon fade to 35 % while the player pivot is inside it
 *    (100 → 35 % in 0.2 s, back in 0.3 s — see FadeAnimator). `passive` overhead (clouds) is never triggered.
 */
import { PICK_BOX_PX, Layer, Y_SORTED_LAYER, compareDrawOrder, pivotSortY, tileToScreen } from '@vgtd/shared';
import type { Rect, Sortable } from '@vgtd/shared';
import type { DrawItem } from './draw-order.js';
import type { WorldObject } from './types.js';

export const OCCLUSION = {
  /** Alpha of a tall (> 2 tiles) object covering more than COVER_THRESHOLD of the player. */
  TALL_FADE_ALPHA: 0.6,
  COVER_THRESHOLD: 0.4,
  TALL_TILES: 2,
  /** Overhead zone alpha while the player is inside. */
  ZONE_ALPHA: 0.35,
  FADE_IN_S: 0.2, // towards the faded alpha
  FADE_OUT_S: 0.3, // back to 1
  /** Drifting clouds stay at constant 60–80 % alpha. */
  CLOUD_ALPHA: 0.7,
} as const;

export interface OccluderCandidate {
  item: DrawItem;
  heightTiles: number;
  zone?: Array<{ i: number; j: number }>;
  passive?: boolean;
}

/** Wrap draw items built from one WorldObject (e.g. its slices) as occlusion candidates. */
export function occluderCandidates(o: WorldObject, items: DrawItem[]): OccluderCandidate[] {
  const heightTiles = o.heightTiles ?? o.spriteHeight / 32;
  return items.map((item) => ({ item, heightTiles, zone: o.zone, passive: o.passive }));
}

export interface PlayerOcclusionInput {
  id: number;
  /** Continuous tile position of the pivot. */
  i: number;
  j: number;
  /** Elevation group. */
  group: number;
}

export interface OcclusionOptions {
  /** Renderer supports the silhouette X-Ray pass (PC, high mobile). */
  xray?: boolean;
  /** Pick box px @1x, bottom-centre at the pivot. Default PICK_BOX_PX (48 × 100). */
  pickBox?: { width: number; height: number };
}

export type OcclusionReason = 'front' | 'tall' | 'zone' | 'passive';

export interface OcclusionFlag {
  sourceId: number;
  layer: Layer;
  /** Shader flag: object is in front of the player and overlaps the pick box. */
  inFront: boolean;
  /** Fraction of the pick box area covered (0..1; sum over slices, bbox-based so slightly conservative). */
  coverage: number;
  /** Alpha the renderer should animate this object's sprite to (1 = untouched). */
  targetAlpha: number;
  reason: OcclusionReason;
}

export interface OcclusionResult {
  pickBox: Rect;
  flags: Map<number, OcclusionFlag>;
  /** Draw the X-Ray silhouette pass this frame (player partially hidden and renderer supports it). */
  xray: boolean;
}

export function playerPickBox(p: PlayerOcclusionInput, size: { width: number; height: number } = PICK_BOX_PX): Rect {
  const s = tileToScreen(p.i, p.j, p.group);
  return { x: s.x - size.width / 2, y: s.y - size.height, width: size.width, height: size.height };
}

function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  return w > 0 && h > 0 ? w * h : 0;
}

export function pointInPolygon(i: number, j: number, poly: ReadonlyArray<{ i: number; j: number }>): boolean {
  let inside = false;
  for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
    const pa = poly[a]!;
    const pb = poly[b]!;
    if (pa.j > j !== pb.j > j && i < ((pb.i - pa.i) * (j - pa.j)) / (pb.j - pa.j) + pa.i) inside = !inside;
  }
  return inside;
}

/**
 * Compute occlusion flags for the local player. `candidates` should be the objects near the player
 * (visible L3 + overhead); results are keyed by `sourceId` (all slices of one object fade together).
 */
export function computeOcclusion(
  player: PlayerOcclusionInput,
  candidates: readonly OccluderCandidate[],
  options: OcclusionOptions = {},
): OcclusionResult {
  const pickBox = playerPickBox(player, options.pickBox ?? PICK_BOX_PX);
  const pickArea = pickBox.width * pickBox.height;
  const playerSort: Sortable = {
    group: player.group,
    sortY: pivotSortY(player.i, player.j),
    x: tileToScreen(player.i, player.j).x,
    id: player.id,
  };
  const flags = new Map<number, OcclusionFlag>();
  const heights = new Map<number, number>();

  for (const c of candidates) {
    const it = c.item;
    if (it.layer === Y_SORTED_LAYER) {
      if (compareDrawOrder(it, playerSort) <= 0) continue; // drawn before the player: cannot hide them
      const area = overlapArea(it.rect, pickBox);
      if (area <= 0) continue;
      const cur = flags.get(it.sourceId);
      const coverage = Math.min(1, (cur?.coverage ?? 0) + area / pickArea);
      flags.set(it.sourceId, {
        sourceId: it.sourceId,
        layer: it.layer,
        inFront: true,
        coverage,
        targetAlpha: 1,
        reason: 'front',
      });
      heights.set(it.sourceId, c.heightTiles);
    } else if (it.layer === Layer.L4_AIR || it.layer === Layer.L5_WEATHER) {
      if (c.passive) {
        flags.set(it.sourceId, {
          sourceId: it.sourceId,
          layer: it.layer,
          inFront: false,
          coverage: 0,
          targetAlpha: OCCLUSION.CLOUD_ALPHA,
          reason: 'passive',
        });
      } else if (c.zone && pointInPolygon(player.i, player.j, c.zone)) {
        flags.set(it.sourceId, {
          sourceId: it.sourceId,
          layer: it.layer,
          inFront: false,
          coverage: 0,
          targetAlpha: OCCLUSION.ZONE_ALPHA,
          reason: 'zone',
        });
      }
    }
  }
  let hidden = false;
  for (const f of flags.values()) {
    if (f.reason !== 'front') continue;
    hidden = true;
    if ((heights.get(f.sourceId) ?? 0) > OCCLUSION.TALL_TILES && f.coverage > OCCLUSION.COVER_THRESHOLD) {
      f.targetAlpha = OCCLUSION.TALL_FADE_ALPHA;
      f.reason = 'tall';
    }
  }
  return { pickBox, flags, xray: hidden && !!options.xray };
}

/**
 * Smooths alphas: down to the target in FADE_IN_S, back up to 1 in FADE_OUT_S (linear in alpha range 1 → 0.35).
 * Call `update(dtSeconds, flags)` each frame; ids absent from `flags` recover to 1 and are forgotten once there.
 */
export class FadeAnimator {
  private readonly alpha = new Map<number, number>();
  private static readonly RANGE = 1 - OCCLUSION.ZONE_ALPHA;

  alphaOf(sourceId: number): number {
    return this.alpha.get(sourceId) ?? 1;
  }

  update(dt: number, flags: ReadonlyMap<number, OcclusionFlag>): void {
    const down = (FadeAnimator.RANGE / OCCLUSION.FADE_IN_S) * dt;
    const up = (FadeAnimator.RANGE / OCCLUSION.FADE_OUT_S) * dt;
    for (const [id, f] of flags) {
      // The hole-punch flag does not change sprite alpha; only objects with targetAlpha < 1 animate.
      const cur = this.alpha.get(id) ?? 1;
      this.alpha.set(id, cur > f.targetAlpha ? Math.max(f.targetAlpha, cur - down) : Math.min(f.targetAlpha, cur + up));
    }
    for (const [id, cur] of this.alpha) {
      if (flags.has(id)) continue;
      const next = Math.min(1, cur + up);
      if (next >= 1) this.alpha.delete(id);
      else this.alpha.set(id, next);
    }
  }
}
