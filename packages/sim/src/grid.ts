/**
 * Walkability / height grid. Tile (ti, tj) occupies [ti, ti+1) × [tj, tj+1) in (i, j) space
 * (integer coordinates are the tile's N vertex — see @vgtd/shared iso.ts).
 */

/** Tile flags. */
export const TILE_WALKABLE = 1;
/** Stair tiles rise toward +i / −i / +j / −j (exactly one set). A stair at level L joins levels L and L+1. */
export const TILE_STAIR_PI = 2;
export const TILE_STAIR_NI = 4;
export const TILE_STAIR_PJ = 8;
export const TILE_STAIR_NJ = 16;
/** Flying entities cannot enter no-fly tiles (they ignore everything else except the map edge). */
export const TILE_NOFLY = 32;
/** Overlap must exceed this (squared distance) to block, so exact contact is not a collision. */
const OVERLAP_EPS = 1e-9;
const STAIR_MASK = TILE_STAIR_PI | TILE_STAIR_NI | TILE_STAIR_PJ | TILE_STAIR_NJ;

export interface CollisionGrid {
  readonly width: number;
  readonly height: number;
  flags(ti: number, tj: number): number;
  /** Elevation level of the tile (0..4); for stairs the lower of the two joined levels. */
  level(ti: number, tj: number): number;
}

export class TileGrid implements CollisionGrid {
  constructor(
    readonly width: number,
    readonly height: number,
    private readonly f: Uint8Array,
    private readonly l: Uint8Array,
  ) {
    if (f.length !== width * height || l.length !== width * height) throw new RangeError('grid array size mismatch');
  }

  flags(ti: number, tj: number): number {
    if (ti < 0 || tj < 0 || ti >= this.width || tj >= this.height) return 0;
    return this.f[tj * this.width + ti]!;
  }
  level(ti: number, tj: number): number {
    if (ti < 0 || tj < 0 || ti >= this.width || tj >= this.height) return 0;
    return this.l[tj * this.width + ti]!;
  }

  /** Build a grid from text rows (rows[tj][ti]). Legend: '#' blocked · '.' walkable level 0 · '1'..'4' walkable at that level ·
   * '>' '<' 'v' '^' stair rising toward +i, −i, +j, −j (level 0→1) · 'n' walkable but no-fly. */
  static fromRows(rows: readonly string[]): TileGrid {
    const h = rows.length;
    const w = rows[0]?.length ?? 0;
    const f = new Uint8Array(w * h);
    const l = new Uint8Array(w * h);
    rows.forEach((row, tj) => {
      if (row.length !== w) throw new RangeError('ragged rows');
      for (let ti = 0; ti < w; ti++) {
        const c = row[ti]!;
        const k = tj * w + ti;
        if (c === '#') continue;
        if (c === '.') f[k] = TILE_WALKABLE;
        else if (c >= '1' && c <= '4') {
          f[k] = TILE_WALKABLE;
          l[k] = Number(c);
        } else if (c === '>') f[k] = TILE_WALKABLE | TILE_STAIR_PI;
        else if (c === '<') f[k] = TILE_WALKABLE | TILE_STAIR_NI;
        else if (c === 'v') f[k] = TILE_WALKABLE | TILE_STAIR_PJ;
        else if (c === '^') f[k] = TILE_WALKABLE | TILE_STAIR_NJ;
        else if (c === 'n') f[k] = TILE_WALKABLE | TILE_NOFLY;
        else throw new RangeError(`bad tile char ${c}`);
      }
    });
    return new TileGrid(w, h, f, l);
  }
}

/** Can an entity standing on elevation `layer` overlap tile (ti, tj)? */
export function tilePassable(grid: CollisionGrid, ti: number, tj: number, layer: number, flying: boolean): boolean {
  if (ti < 0 || tj < 0 || ti >= grid.width || tj >= grid.height) return false;
  const f = grid.flags(ti, tj);
  if (flying) return (f & TILE_NOFLY) === 0;
  if ((f & TILE_WALKABLE) === 0) return false;
  const lv = grid.level(ti, tj);
  if ((f & STAIR_MASK) !== 0) return layer === lv || layer === lv + 1;
  return layer === lv;
}

/** Circle (centre i, j, radius r) vs blocked squares. Touching is allowed (strict overlap blocks). */
export function circleBlocked(
  grid: CollisionGrid,
  i: number,
  j: number,
  r: number,
  layer: number,
  flying = false,
): boolean {
  const t0i = Math.floor(i - r);
  const t1i = Math.floor(i + r);
  const t0j = Math.floor(j - r);
  const t1j = Math.floor(j + r);
  for (let tj = t0j; tj <= t1j; tj++) {
    for (let ti = t0i; ti <= t1i; ti++) {
      const cx = i < ti ? ti : i > ti + 1 ? ti + 1 : i;
      const cy = j < tj ? tj : j > tj + 1 ? tj + 1 : j;
      const dx = i - cx;
      const dy = j - cy;
      if (dx * dx + dy * dy < r * r - OVERLAP_EPS && !tilePassable(grid, ti, tj, layer, flying)) return true;
    }
  }
  return false;
}

/**
 * Unit normal pointing away from the nearest blocking square the circle overlaps (null when free), plus the
 * closest point (px, pj) on that square.
 * Used to slide along corners that axis-separated movement cannot resolve (exact diagonal into a corner).
 */
export function blockingNormal(
  grid: CollisionGrid,
  i: number,
  j: number,
  r: number,
  layer: number,
  flying = false,
): { ni: number; nj: number; px: number; pj: number } | null {
  let best = Infinity;
  let bi = 0;
  let bj = 0;
  let px = 0;
  let pj = 0;
  for (let tj = Math.floor(j - r); tj <= Math.floor(j + r); tj++) {
    for (let ti = Math.floor(i - r); ti <= Math.floor(i + r); ti++) {
      if (tilePassable(grid, ti, tj, layer, flying)) continue;
      const cx = i < ti ? ti : i > ti + 1 ? ti + 1 : i;
      const cy = j < tj ? tj : j > tj + 1 ? tj + 1 : j;
      const dx = i - cx;
      const dy = j - cy;
      const d2 = dx * dx + dy * dy;
      if (d2 < r * r - OVERLAP_EPS && d2 < best) {
        best = d2;
        bi = dx;
        bj = dy;
        px = cx;
        pj = cy;
      }
    }
  }
  if (best === Infinity) return null;
  const len = Math.sqrt(best);
  if (len < 1e-12) return null;
  return { ni: bi / len, nj: bj / len, px, pj };
}

/** Elevation layer implied by a ground position (used after each move; stairs switch at their midpoint). */
export function layerAt(grid: CollisionGrid, i: number, j: number, current: number): number {
  const ti = Math.floor(i);
  const tj = Math.floor(j);
  const f = grid.flags(ti, tj);
  if ((f & TILE_WALKABLE) === 0) return current;
  const lv = grid.level(ti, tj);
  if ((f & STAIR_MASK) === 0) return lv;
  const fi = i - ti;
  const fj = j - tj;
  const up =
    (f & TILE_STAIR_PI) !== 0 ? fi : (f & TILE_STAIR_NI) !== 0 ? 1 - fi : (f & TILE_STAIR_PJ) !== 0 ? fj : 1 - fj;
  return up > 0.5 ? lv + 1 : lv;
}

/** Straight-line visibility between two points for ground skills (samples every 0.25 tile; any non-passable tile blocks). */
export function lineOfSight(
  grid: CollisionGrid,
  i0: number,
  j0: number,
  i1: number,
  j1: number,
  layer: number,
  flying = false,
): boolean {
  const di = i1 - i0;
  const dj = j1 - j0;
  const n = Math.max(1, Math.ceil(Math.sqrt(di * di + dj * dj) / 0.25));
  for (let k = 0; k <= n; k++) {
    const i = i0 + (di * k) / n;
    const j = j0 + (dj * k) / n;
    if (!tilePassable(grid, Math.floor(i), Math.floor(j), layer, flying)) {
      // stairs raise the line one level; allow either side of a stair
      const f = grid.flags(Math.floor(i), Math.floor(j));
      if ((f & STAIR_MASK) !== 0 && tilePassable(grid, Math.floor(i), Math.floor(j), layer + 1, flying)) continue;
      return false;
    }
  }
  return true;
}
