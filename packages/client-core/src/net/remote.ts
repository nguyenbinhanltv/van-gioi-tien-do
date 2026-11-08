/**
 * Other entities: snapshot interpolation (docs/08 §5). Positions are buffered with their arrival time and drawn
 * in the past, linearly interpolated between the two samples that bracket that time. Beyond the newest sample the
 * entity holds still (no extrapolation in this skeleton, see docs/OPEN-ITEMS.md).
 *
 * The delay is per entity (D73): max(base, 1.25 x the entity's observed snapshot spacing), capped at the Mobile maximum.
 * Entities in the 10 / 5 Hz bands (100 / 200 ms between snapshots) therefore get 150 / 250 ms instead of running
 * out of samples and freezing for part of every cycle. The server also omits records that did not change (D73), so a
 * sample that arrives after a long quiet gap is preceded by a synthetic "still standing here" sample: the entity then
 * starts moving smoothly instead of popping.
 */
import { LIMITS, type AoiEnterMsg, type AoiLeaveMsg, type BaselinePos, type SnapshotMsg } from '@vgtd/protocol';
import { NETWORK } from '@vgtd/shared';

/** Mobile / Web base delay (docs/08 §5 table). */
export const DEFAULT_INTERP_DELAY_MS: number = NETWORK.INTERP_DELAY_MS_MOBILE;
/** Upper bound of the adaptive delay. */
export const MAX_INTERP_DELAY_MS: number = NETWORK.INTERP_DELAY_MS_MOBILE_MAX;
const MAX_SAMPLES = 8;
/** Gaps longer than this are idle periods (no record sent), not a snapshot rate: they do not feed the spacing estimate. */
const MAX_SPACING_SAMPLE_MS = 400;
/** A gap above this multiple of the known spacing means the entity was unchanged for a while. */
const QUIET_GAP_FACTOR = 1.5;
/** EWMA weight of the newest spacing observation. */
const SPACING_ALPHA = 0.3;

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
  /** smoothed ms between this entity's snapshot records (0 = not observed yet) */
  spacingMs: number;
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

  constructor(
    private readonly delayMs = DEFAULT_INTERP_DELAY_MS,
    private readonly maxDelayMs = MAX_INTERP_DELAY_MS,
  ) {}

  /** Interpolation delay currently used for one entity (ms). */
  delayOf(e: Pick<RemoteEntity, 'spacingMs'>): number {
    const want = NETWORK.INTERP_SPACING_FACTOR * e.spacingMs;
    return Math.min(Math.max(this.delayMs, want), Math.max(this.delayMs, this.maxDelayMs));
  }

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
        spacingMs: 0,
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
      const prev = e.samples[e.samples.length - 1]!;
      const gap = nowMs - prev.t;
      if (e.spacingMs > 0 && gap > QUIET_GAP_FACTOR * e.spacingMs && nowMs - e.spacingMs > prev.t) {
        // unchanged for a while: it stood still until about one spacing ago, then this record arrived
        e.samples.push({ t: nowMs - e.spacingMs, i: prev.i, j: prev.j });
      }
      if (gap > 0 && gap <= MAX_SPACING_SAMPLE_MS)
        e.spacingMs = e.spacingMs === 0 ? gap : e.spacingMs * (1 - SPACING_ALPHA) + gap * SPACING_ALPHA;
      e.samples.push({ t: nowMs, i: s.qi / LIMITS.POS_SCALE, j: s.qj / LIMITS.POS_SCALE });
      while (e.samples.length > MAX_SAMPLES) e.samples.shift();
    }
  }

  clear(): void {
    this.entities.clear();
    this.known.clear();
  }

  /** Everything to draw at wall-clock `nowMs`. */
  sample(nowMs: number): RemoteView[] {
    const out: RemoteView[] = [];
    for (const e of this.entities.values()) {
      const t = nowMs - this.delayOf(e);
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
