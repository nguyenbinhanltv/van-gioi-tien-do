/**
 * Engine-free smoothing helpers for the render side (no `cc` import, unit-tested in test/smoothing.test.ts).
 *
 * The authoritative / predicted player position advances in 50 ms ticks (20 Hz), the screen redraws at 60+ Hz. Drawing it raw makes the
 * character and the camera step every ~3rd frame, and a per-frame speed estimate flips between 0 and 3x. Everything here is
 * frame-rate independent: the same wall-clock time gives the same result at 30, 60 or 144 fps.
 */

/** Blend factor in [0, 1] for an exponential approach with time constant `tauSec` over `dtSec` (1 - e^(-dt/tau)). */
export function dampFactor(dtSec: number, tauSec: number): number {
  if (!(dtSec > 0)) return 0;
  if (!(tauSec > 0)) return 1;
  return 1 - Math.exp(-dtSec / tauSec);
}

export interface Vec2 {
  x: number;
  y: number;
}

/**
 * Camera follow filter in shared screen px: a small dead-zone (the camera does not move while the target stays within `deadZone` px of it,
 * so sub-pixel jitter never reaches the screen) plus exponential damping once the target leaves it. A target farther than `snapDistance`
 * (teleport, zone change, respawn) or the first sample snaps instantly.
 */
export class CameraFilter {
  private cx = 0;
  private cy = 0;
  private ready = false;

  constructor(
    private readonly tauSec: number,
    private readonly deadZone: number,
    private readonly snapDistance: number,
  ) {}

  get position(): Vec2 {
    return { x: this.cx, y: this.cy };
  }

  /** Jump onto `target` with no easing (first frame, teleport, scene rebuild). */
  snap(target: Vec2): void {
    this.cx = target.x;
    this.cy = target.y;
    this.ready = true;
  }

  /** Advance by `dtSec` towards `target` and return the new camera centre. */
  update(target: Vec2, dtSec: number): Vec2 {
    if (!this.ready) {
      this.snap(target);
      return this.position;
    }
    const dx = target.x - this.cx;
    const dy = target.y - this.cy;
    const dist = Math.hypot(dx, dy);
    if (dist > this.snapDistance) {
      this.snap(target);
      return this.position;
    }
    if (dist <= this.deadZone) return this.position;
    // aim at the dead-zone edge, not the target, so the camera never trails by more than the zone and never overshoots it
    const k = dampFactor(dtSec, this.tauSec);
    const pull = ((dist - this.deadZone) / dist) * k;
    this.cx += dx * pull;
    this.cy += dy * pull;
    return this.position;
  }
}

/**
 * Smooths a tile-space position that arrives in steps. Exponential approach with `tauSec`; a jump larger than `snapTiles` (teleport,
 * hard server correction) is taken instantly. Also reports the speed (tiles/s) of the smoothed motion, which is what animation selection should read.
 */
export class PositionSmoother {
  private i = 0;
  private j = 0;
  private ready = false;
  /** Tiles per second the smoothed position moved during the last `update`. */
  speed = 0;
  /** Smoothed tile-space displacement of the last `update` (for facing). */
  di = 0;
  dj = 0;

  constructor(
    private readonly tauSec: number,
    private readonly snapTiles: number,
  ) {}

  get position(): { i: number; j: number } {
    return { i: this.i, j: this.j };
  }

  snap(i: number, j: number): void {
    this.i = i;
    this.j = j;
    this.ready = true;
    this.speed = 0;
    this.di = this.dj = 0;
  }

  update(target: { i: number; j: number }, dtSec: number): { i: number; j: number } {
    if (!this.ready || Math.hypot(target.i - this.i, target.j - this.j) > this.snapTiles) {
      this.snap(target.i, target.j);
      return this.position;
    }
    const k = dampFactor(dtSec, this.tauSec);
    this.di = (target.i - this.i) * k;
    this.dj = (target.j - this.j) * k;
    // snap the tail: once within a hair of the target stop, so a standing character really stands still
    if (Math.hypot(target.i - this.i, target.j - this.j) < 0.002) {
      this.i = target.i;
      this.j = target.j;
      this.di = this.dj = 0;
    } else {
      this.i += this.di;
      this.j += this.dj;
    }
    this.speed = dtSec > 0 ? Math.hypot(this.di, this.dj) / dtSec : 0;
    return this.position;
  }
}

/**
 * Debounces a discrete state: the wanted value must be asked for continuously for `holdSec` before it becomes the current one, so a one-frame
 * speed blip does not restart the idle/walk/run clip. The very first call adopts the value at once.
 */
export class HoldGate<T> {
  private cur: T | undefined;
  private pending: T | undefined;
  private pendingFor = 0;

  constructor(private readonly holdSec: number) {}

  update(want: T, dtSec: number): T {
    if (this.cur === undefined) {
      this.cur = want;
      return want;
    }
    if (want === this.cur) {
      this.pending = undefined;
      this.pendingFor = 0;
      return this.cur;
    }
    if (want !== this.pending) {
      this.pending = want;
      this.pendingFor = 0;
    }
    this.pendingFor += dtSec;
    if (this.pendingFor >= this.holdSec) {
      this.cur = want;
      this.pending = undefined;
      this.pendingFor = 0;
    }
    return this.cur;
  }
}
