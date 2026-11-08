/**
 * Mob attack telegraphs on the client (D87, protocol v5): the ground decals that warn where a mob attack will land. Engine-free: the
 * Cocos layer just draws `NetClient.telegraphs()` every frame (shape, tile-space geometry, `progress` 0..1 for the fill).
 *
 * A telegraph lives from `telegraph_start` until `telegraph_end` (landed or cancelled) or, if that frame is lost, until its own time
 * is up plus a short grace. Time runs on the local clock from the moment the start arrived (latency is ignored: it is a warning
 * decal, the server decides who is hit). The shape is locked by the server at the start, so it never follows the mob.
 */
import { dequantizePos, TelegraphShape, type TelegraphEndMsg, type TelegraphStartMsg } from '@vgtd/protocol';

/** Keep a decal this long (ms) past its duration in case `telegraph_end` is late or lost; then drop it. */
export const TELEGRAPH_GRACE_MS = 250;
/** A client never holds more than this many decals (a hostile / buggy stream cannot grow memory). */
export const TELEGRAPH_MAX_ACTIVE = 128;

export interface TelegraphView {
  id: number;
  mobEntityId: number;
  shape: 'circle' | 'cone' | 'line';
  /** circle: centre; cone / line: origin. Tile space (y-down shared math; the renderer flips y). */
  i: number;
  j: number;
  /** direction code 0-254 (cone / line); the renderer converts it with the shared direction table */
  facing: number;
  /** circle / cone radius, line length (tiles) */
  size: number;
  /** cone: full angle (degrees); line: width (tiles); circle: 0 */
  angleDeg: number;
  width: number;
  /** 0 at the start .. 1 when the damage lands */
  progress: number;
}

interface Live {
  msg: TelegraphStartMsg;
  startedMs: number;
}

const SHAPES: Record<number, TelegraphView['shape']> = {
  [TelegraphShape.Circle]: 'circle',
  [TelegraphShape.Cone]: 'cone',
  [TelegraphShape.Line]: 'line',
};

export class TelegraphTracker {
  private readonly live = new Map<number, Live>();

  start(msg: TelegraphStartMsg, nowMs: number): void {
    // a reused id (u16 wrap) replaces the old decal; over the cap, the oldest goes
    this.live.delete(msg.id);
    this.live.set(msg.id, { msg, startedMs: nowMs });
    if (this.live.size > TELEGRAPH_MAX_ACTIVE) this.live.delete(this.live.keys().next().value as number);
  }

  end(msg: TelegraphEndMsg): void {
    this.live.delete(msg.id);
  }

  clear(): void {
    this.live.clear();
  }

  /** The decals to draw at `nowMs`; expired ones are dropped on the way. */
  active(nowMs: number): TelegraphView[] {
    const out: TelegraphView[] = [];
    for (const [id, l] of this.live) {
      const age = nowMs - l.startedMs;
      if (age > l.msg.durationMs + TELEGRAPH_GRACE_MS) {
        this.live.delete(id);
        continue;
      }
      const m = l.msg;
      const shape = SHAPES[m.shape] ?? 'circle';
      out.push({
        id,
        mobEntityId: m.mobEntityId,
        shape,
        i: dequantizePos(m.qi),
        j: dequantizePos(m.qj),
        facing: m.facing,
        size: dequantizePos(m.size),
        angleDeg: shape === 'cone' ? m.extra : 0,
        width: shape === 'line' ? dequantizePos(m.extra) : 0,
        progress: m.durationMs > 0 ? Math.min(1, Math.max(0, age / m.durationMs)) : 1,
      });
    }
    return out;
  }

  get size(): number {
    return this.live.size;
  }
}
