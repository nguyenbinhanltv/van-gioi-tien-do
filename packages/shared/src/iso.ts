/**
 * Isometric (dimetric 2:1) math. Projection (px @1x, y grows downward):
 *   x = (i − j) · 32,   y = (i + j) · 16
 * Integer (i, j) addresses the N vertex of tile (i, j); the tile centre is (i + .5, j + .5).
 * Footprints therefore span [i0, i0+w) × [j0, j0+h) and their S vertex is (i0+w, j0+h).
 */
import {
  AOI,
  CHUNK_PX_HEIGHT,
  CHUNK_PX_WIDTH,
  CHUNK_SIZE,
  HEIGHT_LEVEL_PX,
  MAX_HEIGHT_LEVELS,
  TILE_HALF_HEIGHT,
  TILE_HALF_WIDTH,
} from './constants.js';

export interface Vec2 {
  x: number;
  y: number;
}
export interface TileCoord {
  i: number;
  j: number;
}
export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

// ------------------------------------------------------------ tile <-> screen
/** Continuous tile coord → screen px @1x (y down). Pass `elevation` (levels) to lift the image 32 px/level. */
export function tileToScreen(i: number, j: number, elevation = 0): Vec2 {
  return {
    x: (i - j) * TILE_HALF_WIDTH,
    y: (i + j) * TILE_HALF_HEIGHT - elevation * HEIGHT_LEVEL_PX,
  };
}

/** Screen px → continuous tile coord (inverse of tileToScreen at the same elevation). */
export function screenToTile(x: number, y: number, elevation = 0): TileCoord {
  const yy = y + elevation * HEIGHT_LEVEL_PX;
  const a = x / TILE_HALF_WIDTH; // i − j
  const b = yy / TILE_HALF_HEIGHT; // i + j
  return { i: (a + b) / 2, j: (b - a) / 2 };
}

/** Screen point → integer tile cell containing it (floor of the continuous coord). */
export function screenToTileCell(x: number, y: number, elevation = 0): TileCoord {
  const t = screenToTile(x, y, elevation);
  return { i: Math.floor(t.i), j: Math.floor(t.j) };
}

/** Screen position of the centre of tile (i, j). */
export function tileCenterToScreen(i: number, j: number, elevation = 0): Vec2 {
  return tileToScreen(i + 0.5, j + 0.5, elevation);
}

/** Screen-axis coords used by the server AOI: u = i − j, w = i + j. */
export function toUW(i: number, j: number): { u: number; w: number } {
  return { u: i - j, w: i + j };
}
export function fromUW(u: number, w: number): TileCoord {
  return { i: (u + w) / 2, j: (w - u) / 2 };
}

// ------------------------------------------------------------ chunks
export interface ChunkCoord {
  ci: number;
  cj: number;
}

export function chunkOf(i: number, j: number): ChunkCoord {
  return { ci: Math.floor(i / CHUNK_SIZE), cj: Math.floor(j / CHUNK_SIZE) };
}
export function chunkKey(ci: number, cj: number): string {
  return `${ci},${cj}`;
}
export function parseChunkKey(key: string): ChunkCoord {
  const [a, b] = key.split(',');
  const ci = Number(a);
  const cj = Number(b);
  if (!Number.isInteger(ci) || !Number.isInteger(cj)) throw new Error(`Invalid chunk key: ${key}`);
  return { ci, cj };
}
/** Tile coords local to its chunk, 0..31. */
export function localInChunk(i: number, j: number): TileCoord {
  const m = (n: number) => ((Math.floor(n) % CHUNK_SIZE) + CHUNK_SIZE) % CHUNK_SIZE;
  return { i: m(i), j: m(j) };
}
/** Bounding rect of a chunk on screen: always 2048 × 1024 px @1x. */
export function chunkScreenRect(ci: number, cj: number): Rect {
  return {
    x: (ci * CHUNK_SIZE - (cj * CHUNK_SIZE + CHUNK_SIZE)) * TILE_HALF_WIDTH,
    y: (ci + cj) * CHUNK_SIZE * TILE_HALF_HEIGHT,
    width: CHUNK_PX_WIDTH,
    height: CHUNK_PX_HEIGHT,
  };
}
/** (2r+1)² chunks around a chunk, e.g. r=1 → 3×3, r=2 → 5×5, r=3 → 7×7. */
export function chunksAround(center: ChunkCoord, radius: number): ChunkCoord[] {
  const out: ChunkCoord[] = [];
  for (let dj = -radius; dj <= radius; dj++) {
    for (let di = -radius; di <= radius; di++) out.push({ ci: center.ci + di, cj: center.cj + dj });
  }
  return out;
}

// ------------------------------------------------------------ AOI helpers (server + client prediction)
export function aoiCell(i: number, j: number): { cu: number; cw: number } {
  const { u, w } = toUW(i, j);
  return { cu: Math.floor(u / AOI.HASH_CELL), cw: Math.floor(w / AOI.HASH_CELL) };
}
/** Exact AOI filter: |u − u0| ≤ 40 and |w − w0| ≤ 45 (46 / 52 when `exiting`). */
export function inAoi(entity: TileCoord, centre: TileCoord, exiting = false): boolean {
  const e = toUW(entity.i, entity.j);
  const c = toUW(centre.i, centre.j);
  const hu = exiting ? AOI.EXIT_HALF_U : AOI.HALF_U;
  const hw = exiting ? AOI.EXIT_HALF_W : AOI.HALF_W;
  return Math.abs(e.u - c.u) <= hu && Math.abs(e.w - c.w) <= hw;
}
/** AOI centre; shifted by velocity × 0.5 s while flying. Velocity is in tiles/s. */
export function aoiCentre(pos: TileCoord, vel: TileCoord, flying: boolean): TileCoord {
  const lead = flying ? AOI.FLIGHT_LEAD_S : 0;
  return { i: pos.i + vel.i * lead, j: pos.j + vel.j * lead };
}

// ------------------------------------------------------------ Y-sort
export interface Sortable {
  /** Elevation group (0..4): the level the entity stands on; cliff faces use the lower level. */
  group: number;
  /** Sort Y in px @1x (ground Y of pivot — NOT the image Y). */
  sortY: number;
  /** Screen X of the pivot (tie-break 1). */
  x: number;
  /** Stable id (tie-break 2) so order never flickers between frames. */
  id: number;
}

/** Sort Y of a point entity: ground Y of its pivot, ignoring any jump/knock-up height. */
export function pivotSortY(i: number, j: number): number {
  return (i + j) * TILE_HALF_HEIGHT;
}
/** Multi-tile footprint (w × h from N-corner tile (i0, j0)): bottom (S) vertex, sortY = (i0+w+j0+h)·16. */
export function footprintSortY(i0: number, j0: number, w: number, h: number): number {
  return (i0 + w + j0 + h) * TILE_HALF_HEIGHT;
}
/** n × n boss: sortY = y_centre + n·16 (equals footprintSortY of the same footprint). */
export function bossSortY(centreY: number, n: number): number {
  return centreY + n * TILE_HALF_HEIGHT;
}
/** A cliff face between level L−1 and L belongs to the lower group (L−1). */
export function cliffFaceGroup(topLevel: number): number {
  return Math.max(0, topLevel - 1);
}
export function clampElevation(level: number): number {
  return Math.min(MAX_HEIGHT_LEVELS, Math.max(0, Math.trunc(level)));
}
/**
 * Draw order: group asc (low levels first), then sortY asc (bigger Y drawn later), then x, then id.
 * Use as an Array.sort comparator.
 */
export function compareDrawOrder(a: Sortable, b: Sortable): number {
  return a.group - b.group || a.sortY - b.sortY || a.x - b.x || a.id - b.id;
}
/**
 * D65: static objects are nudged slightly *behind* on sortY ties; the bigger the footprint the more, so that
 *  - an entity (bias 0) standing in the cell directly in front (+j) of a prop is drawn after it
 *    (the `x` tie-break of compareDrawOrder alone would flip it), and
 *  - on an exact tie a larger footprint is drawn before a smaller neighbour.
 * Subtract it from a static object's sortY. Stays far below the 16 px spacing of integer footprint vertices.
 */
export const STATIC_SORT_BIAS = 0.01;
const STATIC_SORT_AREA_BIAS = 0.001;
export function staticSortBias(footprintArea: number): number {
  return STATIC_SORT_BIAS + STATIC_SORT_AREA_BIAS * Math.min(footprintArea, 100);
}
/** Single comparable number for hot loops: group-major, then Y (x/id tie-breaks still need compareDrawOrder). */
export function sortKey(group: number, sortY: number): number {
  // sortY of a 4-level map stays far below 2^20 px, so group · 2^21 keeps group-major ordering exact.
  return group * 2_097_152 + sortY;
}
