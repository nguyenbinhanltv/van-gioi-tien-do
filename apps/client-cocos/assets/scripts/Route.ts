import { core } from './vendor/vgtd.mjs';
import type { TilePos } from './Actors';

/**
 * Scripted walk for the P1 streaming measurement (`?route=1`): visits waypoints spread over the whole map (a ring around the
 * map centre plus the diagonals) along client-core A* paths, looping forever. Feeds the same `{ move, magnitude }` frame the
 * real input does, so movement, camera follow and chunk streaming take the normal path. Paths are computed up front (one A*
 * per leg) so no search hitches land inside the measured walk.
 */
export class RouteWalker {
  private readonly points: TilePos[] = [];
  private idx = 0;
  /** Legs completed (a full lap = number of waypoints). */
  legs = 0;
  /** Tiles walked so far (path length, for the report). */
  tilesWalked = 0;

  constructor(
    grid: { width: number; height: number; isWalkable: (i: number, j: number) => boolean },
    start: TilePos,
    /** Ring radius in tiles around the map centre. */
    radius: number,
  ) {
    const finder = new core.IsoPathfinder(grid);
    const cx = grid.width / 2;
    const cj = grid.height / 2;
    const waypoints: TilePos[] = [];
    const steps = 8;
    for (let k = 0; k < steps; k++) {
      const a = (k / steps) * Math.PI * 2;
      const t = finder.nearestWalkable(
        { i: Math.floor(cx + Math.cos(a) * radius), j: Math.floor(cj + Math.sin(a) * radius) },
        16,
      );
      if (t) waypoints.push(t);
    }
    waypoints.push({ i: Math.floor(start.i), j: Math.floor(start.j) });
    let from: TilePos = { i: Math.floor(start.i), j: Math.floor(start.j) };
    for (const w of waypoints) {
      const path = finder.findPath(from, w, { maxExpanded: grid.width * grid.height, smooth: true });
      if (path) {
        for (const p of path) this.points.push(p);
        from = w;
      }
    }
  }

  /** True when no leg could be planned (isolated spawn). */
  get empty(): boolean {
    return this.points.length === 0;
  }

  /** Waypoints in the current lap (all legs concatenated). */
  get length(): number {
    return this.points.length;
  }

  /** Unit move vector towards the next path point; advances when close. `pos` is the continuous tile position. */
  step(pos: TilePos): { move: TilePos; magnitude: number } {
    if (this.points.length === 0) return { move: { i: 0, j: 0 }, magnitude: 0 };
    let p = this.points[this.idx]!;
    let di = p.i - pos.i;
    let dj = p.j - pos.j;
    while (Math.hypot(di, dj) < 0.35) {
      this.idx = (this.idx + 1) % this.points.length;
      if (this.idx === 0) this.legs++;
      this.tilesWalked++;
      p = this.points[this.idx]!;
      di = p.i - pos.i;
      dj = p.j - pos.j;
    }
    const len = Math.hypot(di, dj) || 1;
    return { move: { i: di / len, j: dj / len }, magnitude: 1 };
  }
}
