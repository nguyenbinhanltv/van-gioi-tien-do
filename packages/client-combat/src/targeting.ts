/**
 * Target selection: click (nearest hostile to a picked point) and Tab-cycling (nearest first within range, wrapping).
 * Tile coordinates are continuous `(i, j)` (integer = N vertex, same convention as @vgtd/shared).
 */
export interface TilePoint {
  i: number;
  j: number;
}

export interface Targetable {
  id: number;
  pos: TilePoint;
  alive: boolean;
  hostile: boolean;
}

const dist = (a: TilePoint, b: TilePoint): number => Math.hypot(a.i - b.i, a.j - b.j);

export class TargetSelector {
  private currentId: number | null = null;

  get current(): number | null {
    return this.currentId;
  }

  select(id: number | null): void {
    this.currentId = id;
  }

  clear(): void {
    this.currentId = null;
  }

  /** Drop the target when it died or no longer exists. Returns true when the selection was cleared. */
  validate(entities: readonly Targetable[]): boolean {
    if (this.currentId === null) return false;
    const t = entities.find((e) => e.id === this.currentId);
    if (!t || !t.alive) {
      this.currentId = null;
      return true;
    }
    return false;
  }

  /** Nearest alive hostile within `radius` tiles of `point`; selects and returns its id, or null (selection unchanged). */
  pickAt(entities: readonly Targetable[], point: TilePoint, radius = 1): number | null {
    let best: Targetable | null = null;
    let bestD = radius;
    for (const e of entities) {
      if (!e.alive || !e.hostile) continue;
      const d = dist(e.pos, point);
      if (d <= bestD) {
        best = e;
        bestD = d;
      }
    }
    if (!best) return null;
    this.currentId = best.id;
    return best.id;
  }

  /**
   * Tab: cycle alive hostiles within `maxRange` tiles of `from`, nearest first (ties by id). The next target follows the
   * current one in that order and wraps; with no current target the nearest is picked. `reverse` (Shift+Tab) walks backwards.
   */
  cycle(entities: readonly Targetable[], from: TilePoint, maxRange = 15, reverse = false): number | null {
    const order = entities
      .filter((e) => e.alive && e.hostile && dist(e.pos, from) <= maxRange)
      .sort((a, b) => dist(a.pos, from) - dist(b.pos, from) || a.id - b.id);
    if (order.length === 0) {
      this.currentId = null;
      return null;
    }
    const at = order.findIndex((e) => e.id === this.currentId);
    const next = at < 0 ? (reverse ? order.length - 1 : 0) : (at + (reverse ? -1 : 1) + order.length) % order.length;
    this.currentId = order[next]!.id;
    return this.currentId;
  }
}
