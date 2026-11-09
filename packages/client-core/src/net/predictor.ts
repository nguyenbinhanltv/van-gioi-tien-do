/**
 * Client-side prediction + reconciliation (docs/08 §5). The predicted character runs the SAME `stepMove` the World Node
 * runs, so an honest client and the server agree to float precision; the snapshot's `self` block only corrects drift
 * (collisions with things the client cannot see, anti-cheat pushes).
 */
import { DIR_IDLE, MAG_MAX, seqNewer, stepMove, type CollisionGrid, type MoveState } from '@vgtd/sim';
import type { InputPacket, SelfState } from '@vgtd/protocol';

export interface MoveIntent {
  /** 0..254 direction code, 255 = idle */
  dir: number;
  /** 0..15 */
  mag: number;
  flags: number;
}

/** Corrections above this many tiles are applied instantly (pushed back / controlled), docs/08 §5. */
export const SNAP_ERROR_TILES = 2;
/** Below this the correction is invisible and eased over 100 ms; above it over 200 ms. */
export const SMALL_ERROR_TILES = 0.15;
export const SMALL_ERROR_EASE_MS = 100;
export const LARGE_ERROR_EASE_MS = 200;
/** Inputs kept while waiting for the server's ack (about 6 s at 20 Hz); older ones are dropped, never replayed. */
export const MAX_PENDING_INPUTS = 128;

/**
 * Movement statuses the server applies to this player's inputs (D94): root = magnitude 0, slow = magnitude x factor. The predictor applies the
 * SAME rewrite to its predicted inputs and to the replay of pending inputs (the packets it sends stay the original ones: the server rewrites
 * them itself), so a rooted / slowed player moves exactly as the server moves them instead of rubber-banding. Times count down by each
 * input's `dtMs` and are re-synced from the server's status block (sent when an effect is applied / refreshed / expires).
 */
export interface MoveStatus {
  rootMs: number;
  slowMs: number;
  /** speed factor 0..1 while `slowMs` > 0 */
  slowFactor: number;
}
const NO_STATUS: MoveStatus = { rootMs: 0, slowMs: 0, slowFactor: 1 };

/** The input after root / slow (the same arithmetic as the server's `StatusSystem.adjustMove`). */
function adjustedInput(pkt: InputPacket, st: MoveStatus): InputPacket {
  if (st.rootMs > 0) return pkt.mag === 0 ? pkt : { ...pkt, mag: 0 };
  if (st.slowMs > 0 && st.slowFactor < 1) return { ...pkt, mag: Math.floor(pkt.mag * st.slowFactor) };
  return pkt;
}

function consumed(st: MoveStatus, dtMs: number): MoveStatus {
  if (st.rootMs <= 0 && st.slowMs <= 0) return NO_STATUS;
  return {
    rootMs: Math.max(0, st.rootMs - dtMs),
    slowMs: Math.max(0, st.slowMs - dtMs),
    slowFactor: st.slowFactor,
  };
}

export function selfToMoveState(s: SelfState, agi: number): MoveState {
  return {
    i: s.i,
    j: s.j,
    vi: 0,
    vj: 0,
    layer: s.layer,
    flying: s.flying,
    qinggong: s.qinggong,
    facing: s.facing,
    agi,
    dashLeftMs: s.dashLeftMs,
    dashCdMs: s.dashCdMs,
    invulnMs: s.invulnMs,
  };
}

export const IDLE_INTENT: MoveIntent = { dir: DIR_IDLE, mag: 0, flags: 0 };

export class Predictor {
  /** null until the first snapshot tells us where the server put us */
  state: MoveState | null = null;
  private pending: InputPacket[] = [];
  /** root / slow time left BEFORE each pending input (parallel to `pending`): the replay after an ack starts from the right values */
  private pendingStatus: MoveStatus[] = [];
  /** root / slow time left after the newest pushed input */
  private status: MoveStatus = NO_STATUS;
  private seq = 0;
  /** displayed position = predicted state + this offset, which decays to zero */
  private offI = 0;
  private offJ = 0;
  private easeMs = 0;
  private easeTotalMs = 1;
  /** last |predicted - replayed| in tiles, for the HUD / tests */
  lastError = 0;

  constructor(
    private readonly grid: CollisionGrid,
    private readonly agi = 100,
  ) {}

  get ready(): boolean {
    return this.state !== null;
  }
  get pendingCount(): number {
    return this.pending.length;
  }
  get lastSeq(): number {
    return this.seq;
  }
  /** The movement status the predictor currently assumes (for tests / the HUD). */
  get moveStatus(): Readonly<MoveStatus> {
    return this.status;
  }

  /** Run one input locally and queue it for resending until acked. Returns the packet to send (null before `ready`). */
  push(intent: MoveIntent, dtMs: number): InputPacket | null {
    if (!this.state) return null;
    this.seq = (this.seq + 1) & 0xffff;
    const pkt: InputPacket = {
      seq: this.seq,
      dtMs,
      dir: intent.dir,
      mag: Math.min(MAG_MAX, Math.max(0, intent.mag)),
      flags: intent.flags & 0xf,
    };
    this.pendingStatus.push(this.status);
    this.state = stepMove(this.state, adjustedInput(pkt, this.status), this.grid);
    this.status = consumed(this.status, dtMs);
    this.pending.push(pkt);
    if (this.pending.length > MAX_PENDING_INPUTS) {
      this.pending.shift();
      this.pendingStatus.shift();
    }
    return pkt;
  }

  /** The newest <= 3 unacked inputs, oldest first (redundancy against loss; the server dedupes by seq). */
  recent(n = 3): InputPacket[] {
    return this.pending.slice(-n);
  }

  /** Apply a snapshot's `self` block: drop acked inputs, adopt the server state, replay the rest. */
  reconcile(self: SelfState): void {
    const first = this.pending.findIndex((p) => seqNewer(p.seq, self.lastSeq));
    const keepFrom = first < 0 ? this.pending.length : first; // acked inputs are a prefix
    // the status at the moment of the ack: the server's block when it sent one, else what we had before the first unacked input
    let st: MoveStatus = self.status
      ? { rootMs: self.status.rootMs, slowMs: self.status.slowMs, slowFactor: self.status.slowMs > 0 ? self.status.slowPct / 100 : 1 }
      : (this.pendingStatus[keepFrom] ?? this.status);
    this.pending = this.pending.slice(keepFrom);
    this.pendingStatus = this.pendingStatus.slice(keepFrom);
    let s = selfToMoveState(self, this.agi);
    this.pending.forEach((p, k) => {
      this.pendingStatus[k] = st;
      s = stepMove(s, adjustedInput(p, st), this.grid);
      st = consumed(st, p.dtMs);
    });
    this.status = st;
    const old = this.state;
    const shown = this.display();
    this.state = s;
    this.offI = this.offJ = this.easeMs = 0;
    if (!old || !shown) {
      this.lastError = 0;
      return;
    }
    const err = Math.hypot(s.i - old.i, s.j - old.j);
    this.lastError = err;
    if (err > SNAP_ERROR_TILES || err < 1e-6) return; // snap (or nothing to hide)
    // keep drawing where the player currently sees the character, then ease onto the corrected state
    this.offI = shown.i - s.i;
    this.offJ = shown.j - s.j;
    this.easeTotalMs = err < SMALL_ERROR_TILES ? SMALL_ERROR_EASE_MS : LARGE_ERROR_EASE_MS;
    this.easeMs = this.easeTotalMs;
  }

  /** Advance the visual correction by real elapsed time. */
  advance(dtMs: number): void {
    if (this.easeMs <= 0) return;
    this.easeMs = Math.max(0, this.easeMs - dtMs);
    if (this.easeMs === 0) this.offI = this.offJ = 0;
  }

  /** Position to draw: predicted state plus the (decaying) correction offset. */
  display(): { i: number; j: number } | null {
    if (!this.state) return null;
    const k = this.easeMs > 0 ? this.easeMs / this.easeTotalMs : 0;
    return { i: this.state.i + this.offI * k, j: this.state.j + this.offJ * k };
  }
}
