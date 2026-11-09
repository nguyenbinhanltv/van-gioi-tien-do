/**
 * Plays resolved skill VFX (SkillVfxPresets.ts) into one particle pool (engine-free, unit-tested). Positions are Cocos world px (y up):
 * the caller converts tiles with IsoAdapter. Nothing here allocates per call: `emit` reads the static def and writes numbers into the
 * pool's typed arrays.
 *
 * Blending: every particle draws with NORMAL alpha blending. Cocos 3.8 `Sprite` has no per-sprite blend factors (setting them is a
 * no-op) and a custom additive `builtin-sprite` material breaks rendering (OPEN-ITEMS "Asset Gemini PART 2" item 5), so the
 * `ParticleSpec.blend` of the registry is only the blend the art was made for; the textures are luminance -> alpha, so they read fine
 * as soft translucent shapes. The presets' `alpha` (peak opacity) values are tuned for that.
 */
import { PARTICLE_NAMES } from './ArtRegistry';
import { ParticlePool, VfxRng } from './ParticleSim';
import type { EmitterDef, ResolvedVfx, Rgb } from './SkillVfxPresets';

export const POOL_CAPACITY = 160;

export function makePool(): ParticlePool {
  return new ParticlePool(POOL_CAPACITY);
}

const TEX_INDEX = new Map(PARTICLE_NAMES.map((n, i) => [n, i] as const));
const DEG = 180 / Math.PI;

/** Where a cast / hit happens, in Cocos world px. `dx, dy` = unit facing direction. */
export interface FxPlace {
  x: number;
  y: number;
  dx: number;
  dy: number;
  /** end point of a trail / line (for `along` emitters) */
  tx: number;
  ty: number;
  /** ground diameter in px for `fit: 'diameter'` emitters (the shape radius mapped through the iso projection) */
  diameter: number;
}

export class VfxPlayer {
  constructor(
    readonly pool: ParticlePool,
    private readonly rng: VfxRng = new VfxRng(),
  ) {}

  /** Emit one def. `delay0` seconds before the first particle is born; `scale` multiplies sizes (not counts). Returns particles spawned. */
  emit(def: EmitterDef, rgb: Rgb, place: FxPlace, delay0 = 0, scale = 1): number {
    const tex = TEX_INDEX.get(def.tex);
    if (tex === undefined) return 0; // unknown name: skip (the registry test catches typos)
    const pool = this.pool;
    const rng = this.rng;
    const base = Math.atan2(place.dy, place.dx);
    const sq = def.squash ?? 1;
    const s0 = def.fit === 'diameter' ? def.size[0] * place.diameter : def.size[0] * scale;
    const s1 = def.fit === 'diameter' ? def.size[1] * place.diameter : def.size[1] * scale;
    const jit = def.jitter ?? 0;
    for (let n = 0; n < def.count; n++) {
      const t = def.along ? (def.count > 1 ? n / (def.count - 1) : 0.5) : 0;
      const px = (def.along ? place.x + (place.tx - place.x) * t : place.x) + rng.signed() * jit;
      const py = (def.along ? place.y + (place.ty - place.y) * t : place.y) + rng.signed() * jit * sq * 0.5;
      const a = def.spread === undefined ? rng.signed() * Math.PI : base + rng.signed() * def.spread;
      const v = (def.speed ?? 0) * (0.6 + 0.4 * rng.next());
      const rot = def.face ? base * DEG : def.spin ? rng.signed() * 180 : 0;
      pool.spawn(
        tex,
        px,
        py,
        Math.cos(a) * v,
        Math.sin(a) * v * (sq < 1 ? 0.6 : 1),
        def.rise ?? 0,
        def.drag ?? 0,
        delay0 + n * (def.stagger ?? 0),
        def.life,
        s0,
        s1,
        sq,
        rot,
        def.spin ? def.spin * rng.signed() : 0,
        rgb[0],
        rgb[1],
        rgb[2],
        def.alpha,
      );
    }
    return def.count;
  }

  /** The cast effect of a resolved skill at `place`. */
  cast(vfx: ResolvedVfx, place: FxPlace, delay0 = 0): void {
    for (const d of vfx.cast)
      this.emit(d, d.tint === 'secondary' ? vfx.secondary : d.tint === 'white' ? WHITE : vfx.primary, place, delay0);
  }

  /** The small impact burst on an enemy hit, `delay0` = how long after the cast (the trail travel time). */
  hit(vfx: ResolvedVfx, place: FxPlace, delay0 = 0): void {
    for (const d of vfx.hit)
      this.emit(d, d.tint === 'secondary' ? vfx.secondary : d.tint === 'white' ? WHITE : vfx.primary, place, delay0);
  }

  step(dt: number): void {
    this.pool.step(dt);
  }

  get count(): number {
    return this.pool.count;
  }

  clear(): void {
    this.pool.clear();
  }
}

const WHITE: Rgb = [255, 255, 255];

/** Trail travel time (s) from the caster to a target `distPx` away: the hit burst is delayed by this much. */
export function trailTravelS(distPx: number): number {
  return Math.min(0.32, 0.08 + distPx / 1400);
}
