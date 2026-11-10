/**
 * Fixed-capacity particle simulation (engine-free: no `cc` import, unit-tested). Struct-of-arrays, allocated once in the
 * constructor; `spawn` and `step` never allocate, so a combat scene with many casts produces no GC pressure. The view
 * (SkillVfx.ts) owns one Sprite node per slot and reads the arrays by index.
 *
 * Time model: a particle is born with `age = -delay`, it is invisible until age reaches 0 and dies at `age >= life`.
 * Spawning a whole streak at once with staggered delays is how projectile trails are done (no per-frame emitters).
 * Colour and size are interpolated by the normalised age `k = age / life` (size s0 -> s1 with ease-out, alpha fades in
 * over the first 12 % and out over the rest).
 */
export class ParticlePool {
  readonly capacity: number;
  /** 1 = the slot is in use (waiting for its delay or alive) */
  readonly used: Uint8Array;
  readonly x: Float32Array;
  readonly y: Float32Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  /** constant acceleration (design px / s^2) added to vy: positive = rising (Cocos y is up), negative = falling */
  readonly ay: Float32Array;
  /** velocity damping per second (0 = none) */
  readonly drag: Float32Array;
  readonly age: Float32Array;
  readonly life: Float32Array;
  readonly s0: Float32Array;
  readonly s1: Float32Array;
  /** vertical squash (1 = round; 0.5 = a ground-plane ellipse) */
  readonly sq: Float32Array;
  /** rotation in degrees and its speed (deg / s) */
  readonly rot: Float32Array;
  readonly spin: Float32Array;
  readonly r: Uint8Array;
  readonly g: Uint8Array;
  readonly b: Uint8Array;
  /** peak opacity 0..1 */
  readonly peak: Float32Array;
  /** index into the particle name table (PARTICLE_NAMES) */
  readonly tex: Uint8Array;
  private next = 0;
  private liveCount = 0;

  constructor(capacity: number) {
    this.capacity = capacity;
    const f = () => new Float32Array(capacity);
    const u = () => new Uint8Array(capacity);
    this.used = u();
    this.x = f();
    this.y = f();
    this.vx = f();
    this.vy = f();
    this.ay = f();
    this.drag = f();
    this.age = f();
    this.life = f();
    this.s0 = f();
    this.s1 = f();
    this.sq = f();
    this.rot = f();
    this.spin = f();
    this.r = u();
    this.g = u();
    this.b = u();
    this.peak = f();
    this.tex = u();
  }

  /** Number of used slots (waiting + alive). */
  get count(): number {
    return this.liveCount;
  }

  /**
   * Claims a slot (a free one, else the oldest-claimed slot: a burst of casts never fails, it recycles) and fills it. Returns the
   * slot index. All arguments are numbers: no object is created.
   */
  spawn(
    tex: number,
    x: number,
    y: number,
    vx: number,
    vy: number,
    ay: number,
    drag: number,
    delay: number,
    life: number,
    s0: number,
    s1: number,
    sq: number,
    rot: number,
    spin: number,
    r: number,
    g: number,
    b: number,
    peak: number,
  ): number {
    let slot = -1;
    for (let n = 0; n < this.capacity; n++) {
      const k = (this.next + n) % this.capacity;
      if (!this.used[k]) {
        slot = k;
        break;
      }
    }
    if (slot < 0)
      slot = this.next; // full: recycle the oldest claim
    else this.liveCount++;
    this.next = (slot + 1) % this.capacity;
    this.used[slot] = 1;
    this.tex[slot] = tex;
    this.x[slot] = x;
    this.y[slot] = y;
    this.vx[slot] = vx;
    this.vy[slot] = vy;
    this.ay[slot] = ay;
    this.drag[slot] = drag;
    this.age[slot] = -delay;
    this.life[slot] = life;
    this.s0[slot] = s0;
    this.s1[slot] = s1;
    this.sq[slot] = sq;
    this.rot[slot] = rot;
    this.spin[slot] = spin;
    this.r[slot] = r;
    this.g[slot] = g;
    this.b[slot] = b;
    this.peak[slot] = peak;
    return slot;
  }

  /** Advances every used slot by `dt` seconds; slots past their life are released. */
  step(dt: number): void {
    for (let i = 0; i < this.capacity; i++) {
      if (!this.used[i]) continue;
      const a = this.age[i]! + dt;
      this.age[i] = a;
      if (a >= this.life[i]!) {
        this.used[i] = 0;
        this.liveCount--;
        continue;
      }
      if (a <= 0) continue;
      // integrate only the part of the step after the particle was born
      const h = a < dt ? a : dt;
      const damp = Math.max(0, 1 - this.drag[i]! * h);
      this.vx[i] = this.vx[i]! * damp;
      this.vy[i] = (this.vy[i]! + this.ay[i]! * h) * damp;
      this.x[i] = this.x[i]! + this.vx[i]! * h;
      this.y[i] = this.y[i]! + this.vy[i]! * h;
      this.rot[i] = this.rot[i]! + this.spin[i]! * h;
    }
  }

  /** True when slot `i` is born (past its delay) and not finished. */
  alive(i: number): boolean {
    return this.used[i] === 1 && this.age[i]! > 0;
  }

  /** Normalised age 0..1 of slot `i` (0 before birth). */
  k(i: number): number {
    const a = this.age[i]!;
    return a <= 0 ? 0 : Math.min(1, a / this.life[i]!);
  }

  /** Draw size (design px) of slot `i` now: ease-out from s0 to s1. */
  size(i: number): number {
    const k = this.k(i);
    const e = 1 - (1 - k) * (1 - k);
    return this.s0[i]! + (this.s1[i]! - this.s0[i]!) * e;
  }

  /** Opacity 0..255 of slot `i` now: quick fade-in, then a fade-out to the end of life. */
  opacity(i: number): number {
    const k = this.k(i);
    const fade = k < 0.12 ? k / 0.12 : 1 - (k - 0.12) / 0.88;
    return Math.round(255 * this.peak[i]! * Math.max(0, fade));
  }

  clear(): void {
    this.used.fill(0);
    this.liveCount = 0;
    this.next = 0;
  }
}

/** Tiny deterministic generator for visual jitter (xorshift32): the same casts always look the same, tests can replay them. */
export class VfxRng {
  private s: number;
  constructor(seed = 0x9e3779b9) {
    this.s = seed >>> 0 || 1;
  }
  /** 0 <= v < 1 */
  next(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x / 4294967296;
  }
  /** -1 <= v < 1 */
  signed(): number {
    return this.next() * 2 - 1;
  }
}
