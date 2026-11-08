/**
 * Other entities: snapshot interpolation (docs/08 §5). Positions are buffered with their arrival time and drawn
 * `delayMs` in the past, linearly interpolated between the two samples that bracket that time. Beyond the newest
 * sample the entity holds still (no extrapolation in this skeleton, see docs/OPEN-ITEMS.md).
 */
import { LIMITS, type AoiEnterMsg, type AoiLeaveMsg, type BaselinePos, type SnapshotMsg } from '@vgtd/protocol';

/** Mobile / Web default (docs/08 §5 table). The adaptive 100-250 ms rule is not implemented yet. */
export const DEFAULT_INTERP_DELAY_MS = 150;
const MAX_SAMPLES = 8;

export interface RemoteSample {
  t: number;
  i: number;
  j: number;
}
export interface RemoteEntity {
  index: number;
  entityId: number;
  /** 0 player, 1 monster, 2 npc ... (EnterEntity.kind) */
  kind: number;
  anim: number;
  /** 0-7, @vgtd/shared DIRECTIONS order */
  dir: number;
  hpPct: number;
  samples: RemoteSample[];
}
export interface RemoteView {
  index: number;
  entityId: number;
  kind: number;
  i: number;
  j: number;
  anim: number;
  dir: number;
  hpPct: number;
  /** tiles / s between the bracketing samples (0 when holding), for idle/walk/run */
  speed: number;
}

export class RemoteWorld {
  readonly entities = new Map<number, RemoteEntity>();
  private readonly known = new Map<number, BaselinePos>();

  constructor(private readonly delayMs = DEFAULT_INTERP_DELAY_MS) {}

  /** Pass to `decode(bytes, { baseline })`: per-index last known position the server deltas against. */
  baseline = (index: number): BaselinePos | undefined => this.known.get(index);

  onEnter(msg: AoiEnterMsg, nowMs: number): void {
    for (const e of msg.entities) {
      if (e.index < 0 || e.index > LIMITS.MAX_LOCAL_INDEX) continue;
      this.known.set(e.index, { qi: e.qi, qj: e.qj });
      this.entities.set(e.index, {
        index: e.index,
        entityId: e.entityId,
        kind: e.kind,
        anim: e.anim,
        dir: e.dir,
        hpPct: e.hpPct,
        samples: [{ t: nowMs, i: e.qi / LIMITS.POS_SCALE, j: e.qj / LIMITS.POS_SCALE }],
      });
    }
  }

  onLeave(msg: AoiLeaveMsg): void {
    for (const idx of msg.indices) {
      this.known.delete(idx);
      this.entities.delete(idx);
    }
  }

  /** Record a decoded snapshot (call after `decode`, which needs `baseline` to be the state BEFORE this snapshot). */
  onSnapshot(msg: SnapshotMsg, nowMs: number): void {
    for (const s of msg.entities) {
      this.known.set(s.index, { qi: s.qi, qj: s.qj });
      const e = this.entities.get(s.index);
      if (!e) continue; // an index whose enter we have not seen (or already left)
      e.anim = s.anim;
      e.dir = s.dir;
      if (s.hpPct !== null) e.hpPct = s.hpPct;
      e.samples.push({ t: nowMs, i: s.qi / LIMITS.POS_SCALE, j: s.qj / LIMITS.POS_SCALE });
      if (e.samples.length > MAX_SAMPLES) e.samples.shift();
    }
  }

  clear(): void {
    this.entities.clear();
    this.known.clear();
  }

  /** Everything to draw at wall-clock `nowMs`. */
  sample(nowMs: number): RemoteView[] {
    const t = nowMs - this.delayMs;
    const out: RemoteView[] = [];
    for (const e of this.entities.values()) {
      const s = e.samples;
      // newest sample at or before t (a) and the first one after it (b)
      let a = s[0]!;
      let b: RemoteSample | null = null;
      for (const p of s) {
        if (p.t <= t) a = p;
        else {
          b = p;
          break;
        }
      }
      let i = a.i;
      let j = a.j;
      let speed = 0;
      if (b && t > a.t) {
        const f = (t - a.t) / (b.t - a.t);
        i = a.i + (b.i - a.i) * f;
        j = a.j + (b.j - a.j) * f;
        speed = Math.hypot(b.i - a.i, b.j - a.j) / ((b.t - a.t) / 1000);
      }
      out.push({
        index: e.index,
        entityId: e.entityId,
        kind: e.kind,
        i,
        j,
        anim: e.anim,
        dir: e.dir,
        hpPct: e.hpPct,
        speed,
      });
    }
    return out;
  }
}
