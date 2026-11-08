/**
 * Direction model (docs/03 §2 "Dựng rig cho 8 hướng", Hồ sơ §3 "Hướng", locked decision 2026-11-05).
 *
 * Eight logical directions (shared `Direction`). Art is drawn for S, SE, E, NE, N; SW, W, NW reuse
 * SE, E, NE with scaleX = −1. Player/Boss Spine rigs follow the same 5 + mirror rule; an animation whose
 * silhouette is asymmetric (right-hand weapon) may instead be drawn fully in 8 — that is flagged per animation
 * (see animations.ts `asymmetric` / `drawnInEight`), not per entity.
 */
import {
  DIRECTIONS,
  DIRECTION_TILE_VECTORS,
  DRAWN_DIRECTIONS,
  MIRRORED_DIRECTIONS,
  TILE_HEIGHT,
  TILE_WIDTH,
  type Direction,
  type Vec2,
} from '@vgtd/shared';

export type EntityKind = 'player' | 'boss' | 'mob' | 'npc' | 'pet';
export const ENTITY_KINDS: readonly EntityKind[] = ['player', 'boss', 'mob', 'npc', 'pet'];

/** Footprint classes used across the character package ('elite' = 1 × 1 logical, 192 canvas). */
export type FootprintClass = '1x1' | 'elite' | '2x2' | '4x4' | '8x8';

export type DirectionScheme =
  /** Draw S, SE, E, NE, N; SW, W, NW are mirrors of SE, E, NE. */
  | 'five_mirror'
  /** Multi-skeleton pieced boss: 1–3 directions only (static or slow turn). */
  | 'parts_1_3';

export interface DirectionPolicy {
  readonly kind: EntityKind;
  readonly scheme: DirectionScheme;
  /** Drawn directions (empty for `parts_1_3`: chosen per asset, 1–3 of them). */
  readonly drawn: readonly Direction[];
  /** Mirrored direction → the drawn direction it reuses. */
  readonly mirrored: Readonly<Partial<Record<Direction, Direction>>>;
  /** True if an asymmetric animation may be drawn in all 8 directions instead of mirroring. */
  readonly allowFullEight: boolean;
  /** Only for `parts_1_3`. */
  readonly partsDirectionRange?: { readonly min: number; readonly max: number };
}

const FIVE_MIRROR = {
  scheme: 'five_mirror',
  drawn: DRAWN_DIRECTIONS,
  mirrored: MIRRORED_DIRECTIONS,
} as const;

/** Policy of an entity kind; `footprint` only matters for bosses (8 × 8 is pieced, 1–3 directions). */
export function getDirectionPolicy(kind: EntityKind, footprint: FootprintClass = '1x1'): DirectionPolicy {
  if (kind === 'boss' && footprint === '8x8') {
    return {
      kind,
      scheme: 'parts_1_3',
      drawn: [],
      mirrored: {},
      allowFullEight: false,
      partsDirectionRange: { min: 1, max: 3 },
    };
  }
  // Player & Boss are Spine rigs: asymmetric animations may be drawn fully in 8. Mobs (pre-render),
  // NPCs and pets stay strictly 5 + mirror.
  const allowFullEight = kind === 'player' || kind === 'boss';
  return { kind, ...FIVE_MIRROR, allowFullEight };
}

export interface ResolvedDirection {
  /** Logical facing requested. */
  readonly direction: Direction;
  /** The direction whose art/rig is actually played. */
  readonly drawn: Direction;
  readonly mirrored: boolean;
  /** Node scaleX to apply (−1 when mirrored). */
  readonly scaleX: 1 | -1;
}

export interface ResolveDirectionOptions {
  readonly footprint?: FootprintClass;
  /** The current animation is flagged "drawn in 8": play the true direction, no mirroring. */
  readonly drawnInEight?: boolean;
  /** Pieced bosses only: the 1–3 directions this asset provides. */
  readonly available?: readonly Direction[];
}

/** Circular distance between two directions in 45° steps (0..4). */
export function directionDistance(a: Direction, b: Direction): number {
  const d = Math.abs(DIRECTIONS.indexOf(a) - DIRECTIONS.indexOf(b));
  return Math.min(d, 8 - d);
}

/** Which art to play for `direction`, and whether to flip it. */
export function resolveDirection(
  kind: EntityKind,
  direction: Direction,
  options: ResolveDirectionOptions = {},
): ResolvedDirection {
  const policy = getDirectionPolicy(kind, options.footprint);
  if (policy.scheme === 'parts_1_3') {
    const avail = options.available ?? [];
    const range = policy.partsDirectionRange!;
    if (avail.length < range.min || avail.length > range.max) {
      throw new RangeError(`pieced boss needs ${range.min}–${range.max} available directions, got ${avail.length}`);
    }
    let best = avail[0]!;
    for (const d of avail) if (directionDistance(direction, d) < directionDistance(direction, best)) best = d;
    return { direction, drawn: best, mirrored: false, scaleX: 1 };
  }
  if (options.drawnInEight) {
    if (!policy.allowFullEight) {
      throw new Error(`entity kind '${kind}' cannot draw animations in 8 directions (5 + mirror only)`);
    }
    return { direction, drawn: direction, mirrored: false, scaleX: 1 };
  }
  const reuse = policy.mirrored[direction];
  return reuse
    ? { direction, drawn: reuse, mirrored: true, scaleX: -1 }
    : { direction, drawn: direction, mirrored: false, scaleX: 1 };
}

/** Mirroring flips x only; sockets "đảo dấu x" (docs/03 §4). Pivot is at x = 0 in pivot space. */
export function mirrorX(x: number, mirrored: boolean): number {
  return mirrored ? -x : x;
}
export function mirrorPoint(p: Vec2, mirrored: boolean): Vec2 {
  return { x: mirrorX(p.x, mirrored), y: p.y };
}

// ------------------------------------------------------------------ direction from vector
// Sector centres in the un-squashed screen plane (y down): E 0°, SE 45°, S 90°, SW 135°, W 180°, NW −135°, N −90°, NE −45°.
const SECTOR_ORDER: readonly Direction[] = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];

function directionFromPlane(x: number, y: number): Direction | null {
  if (x === 0 && y === 0) return null;
  const deg = (Math.atan2(y, x) * 180) / Math.PI; // −180..180
  const idx = ((Math.round(deg / 45) % 8) + 8) % 8;
  return SECTOR_ORDER[idx]!;
}

/**
 * Facing from a tile-space movement vector (di, dj). The iso projection x = i − j, y = i + j is a rotated
 * 2:1 view of a uniform square plane, so the 8 directions are 45° sectors of (di − dj, di + dj).
 * (1,1) → S, (1,0) → SE, (1,−1) → E, (0,−1) → NE, (−1,−1) → N, (−1,0) → NW, (−1,1) → W, (0,1) → SW.
 * Returns `fallback` for the zero vector (keep the previous facing).
 */
export function directionFromTileVector(di: number, dj: number, fallback: Direction = 'S'): Direction {
  return directionFromPlane(di - dj, di + dj) ?? fallback;
}

/** Facing from a screen-space vector in px (y down); the 2:1 squash is undone (dy × 2). */
export function directionFromScreenVector(dx: number, dy: number, fallback: Direction = 'S'): Direction {
  return directionFromPlane(dx, dy * (TILE_WIDTH / TILE_HEIGHT)) ?? fallback;
}

/** Tile-space unit-step of a direction (shared table). */
export function tileVectorOf(direction: Direction): readonly [number, number] {
  return DIRECTION_TILE_VECTORS[direction];
}
