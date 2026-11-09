/**
 * INTERIM skill VFX presets (engine-free, unit-tested): which particles a skill throws, per class (Đạo Lộ) and per skill archetype.
 * Everything visual is in THIS table; SkillVfx.ts only plays it. To swap in the owner's Gemini part-3 VFX stills later:
 *   1. add the stills to the particle registry (ArtRegistry.ts `PARTICLES` + tools/procgen manifest `particles`),
 *   2. point `tex` of the affected emitter defs at the new names (per class in `FLAVOUR`, per element in `ELEMENT_TEX`, or per skill
 *      in `SKILL_OVERRIDES`), and tune count / size / life here. No code change is needed elsewhere.
 *
 * Archetypes (what happens at `cast_done`; every damage event on an enemy additionally plays the class' `burst` at the target, small):
 *   trail  - projectile / line / far single target: a streak of particles swept from the caster to the target
 *   burst  - melee cone / single: a swing + sparks in front of the caster
 *   ring   - circle area (self or ground): an expanding ground ring, sized from the shape radius
 *   aura   - no damage effect (heal / shield / buff / hot ...): rising motes and a glow around the target (self)
 * The colour comes from the skill's element (kim, moc, thuy, hoa, tho, loi, phong); skills with `root_main` / `none` use the class'
 * own element. The main texture follows the element too when it differs from the class' (a Thuy skill of a Moc class throws ice).
 */
import { PARTICLE_NAMES } from './ArtRegistry';

export type VfxArchetype = 'trail' | 'burst' | 'ring' | 'aura';
export type Rgb = readonly [number, number, number];
export type Tint = 'primary' | 'secondary' | 'white';

export interface EmitterDef {
  /** particle texture name (ArtRegistry PARTICLES) */
  tex: string;
  count: number;
  /** seconds */
  life: number;
  /** [start, end] draw size in design px; with `fit` they are multipliers of that length */
  size: readonly [number, number];
  /** `diameter`: ring size = shape diameter on the ground (iso ellipse); `range`: not used for size */
  fit?: 'diameter';
  /** outward speed, design px / s (random 60..100 %) */
  speed?: number;
  /** emission cone half-width in radians around the facing direction (default: all directions) */
  spread?: number;
  drag?: number;
  /** vertical acceleration, px / s^2 (positive = rising) */
  rise?: number;
  /** seconds between consecutive particles (a streak when combined with `along`) */
  stagger?: number;
  /** spawn the particles along the caster -> target segment instead of at one point */
  along?: boolean;
  /** random offset of the spawn point, design px */
  jitter?: number;
  /** ground-plane squash (0.5 = iso ellipse); default 1 */
  squash?: number;
  /** rotate the sprite to face the cast direction (slashes, bolts) */
  face?: boolean;
  spin?: number;
  tint: Tint;
  /** peak opacity 0..1 */
  alpha: number;
}

export interface ClassFlavour {
  /** main + accent texture names */
  main: string;
  accent: string;
}

/** Element -> colours (art bible swatches where one exists: mountain blue #5E8798, jade #78B79A, bronze #B58A4A / #E3C07F). */
export const ELEMENT_COLORS: Record<string, { primary: Rgb; secondary: Rgb }> = {
  kim: { primary: [208, 226, 240], secondary: [94, 135, 152] },
  moc: { primary: [120, 183, 154], secondary: [196, 238, 170] },
  thuy: { primary: [96, 166, 232], secondary: [176, 228, 250] },
  hoa: { primary: [255, 124, 54], secondary: [255, 206, 96] },
  tho: { primary: [181, 138, 74], secondary: [227, 192, 127] },
  loi: { primary: [244, 218, 96], secondary: [196, 156, 255] },
  phong: { primary: [112, 216, 202], secondary: [214, 250, 242] },
};

/** Main texture of an element when the skill's element is not the class' own. */
export const ELEMENT_TEX: Record<string, string> = {
  kim: 'p_slash',
  moc: 'p_leaf',
  thuy: 'p_ice',
  hoa: 'p_flame',
  tho: 'p_smoke',
  loi: 'p_lightning',
  phong: 'p_smoke',
};

/** Per class (Đạo Lộ id = shared PathId): the signature textures. The class' element comes from shared skills.json `classes`. */
export const FLAVOUR: Record<string, ClassFlavour> = {
  kiem: { main: 'p_slash', accent: 'p_spark' },
  phap: { main: 'p_flame', accent: 'p_spark' },
  the: { main: 'p_smoke', accent: 'p_rune' },
  dan_phu: { main: 'p_leaf', accent: 'p_glow' },
  thuong: { main: 'p_lightning', accent: 'p_spark' },
  dao: { main: 'p_slash', accent: 'p_smoke' },
};

type Preset = Record<VfxArchetype, EmitterDef[]>;

/** The four archetypes built from a main and an accent texture. */
export function buildPreset(main: string, accent: string): Preset {
  return {
    trail: [
      {
        tex: main,
        count: 9,
        life: 0.34,
        size: [64, 26],
        along: true,
        stagger: 0.02,
        face: true,
        tint: 'primary',
        alpha: 0.95,
      },
      {
        tex: 'p_spark',
        count: 10,
        life: 0.4,
        size: [26, 8],
        along: true,
        stagger: 0.018,
        jitter: 10,
        speed: 30,
        tint: 'secondary',
        alpha: 1,
      },
    ],
    burst: [
      {
        tex: main,
        count: 2,
        life: 0.3,
        size: [70, 120],
        spread: 0.5,
        speed: 40,
        face: true,
        tint: 'primary',
        alpha: 0.95,
      },
      { tex: accent, count: 7, life: 0.45, size: [26, 8], speed: 120, drag: 2.2, tint: 'secondary', alpha: 1 },
      { tex: 'p_glow', count: 1, life: 0.22, size: [30, 90], tint: 'primary', alpha: 0.55 },
    ],
    ring: [
      {
        tex: 'p_ring',
        count: 1,
        life: 0.55,
        size: [0.15, 1],
        fit: 'diameter',
        squash: 0.5,
        tint: 'primary',
        alpha: 0.95,
      },
      {
        tex: 'p_glow',
        count: 1,
        life: 0.4,
        size: [0.1, 0.8],
        fit: 'diameter',
        squash: 0.5,
        tint: 'secondary',
        alpha: 0.35,
      },
      {
        tex: main,
        count: 8,
        life: 0.55,
        size: [30, 14],
        speed: 90,
        drag: 1.8,
        rise: 40,
        jitter: 22,
        tint: 'secondary',
        alpha: 0.9,
      },
    ],
    aura: [
      { tex: 'p_glow', count: 1, life: 0.7, size: [40, 110], tint: 'primary', alpha: 0.5 },
      { tex: 'p_ring', count: 1, life: 0.6, size: [30, 120], squash: 0.5, tint: 'secondary', alpha: 0.85 },
      {
        tex: accent === 'p_rune' ? 'p_glow' : accent,
        count: 8,
        life: 0.9,
        size: [22, 8],
        speed: 18,
        rise: 70,
        jitter: 30,
        stagger: 0.04,
        tint: 'secondary',
        alpha: 1,
      },
    ],
  };
}

/** Class-specific replacements of whole archetype lists (a class can shape its own look without touching the generic ones). */
export const CLASS_OVERRIDES: Record<string, Partial<Preset>> = {
  // Thể tu (earth tank): heavy impacts, dust and rune marks instead of sparks
  the: {
    ring: [
      {
        tex: 'p_rune',
        count: 1,
        life: 0.7,
        size: [0.2, 1],
        fit: 'diameter',
        squash: 0.5,
        tint: 'secondary',
        alpha: 0.8,
      },
      {
        tex: 'p_ring',
        count: 1,
        life: 0.5,
        size: [0.15, 1],
        fit: 'diameter',
        squash: 0.5,
        tint: 'primary',
        alpha: 0.95,
      },
      {
        tex: 'p_smoke',
        count: 7,
        life: 0.7,
        size: [34, 70],
        speed: 80,
        drag: 1.6,
        rise: 25,
        jitter: 24,
        tint: 'primary',
        alpha: 0.7,
      },
    ],
  },
  // Pháp tu (fire fan): flames rise from the ring
  phap: {
    ring: [
      {
        tex: 'p_ring',
        count: 1,
        life: 0.55,
        size: [0.15, 1],
        fit: 'diameter',
        squash: 0.5,
        tint: 'primary',
        alpha: 0.95,
      },
      {
        tex: 'p_flame',
        count: 9,
        life: 0.6,
        size: [34, 58],
        speed: 30,
        rise: 110,
        jitter: 40,
        stagger: 0.03,
        tint: 'primary',
        alpha: 0.9,
      },
    ],
  },
  // Lôi / Thương tu: a crackle of bolts around the ring
  thuong: {
    ring: [
      {
        tex: 'p_ring',
        count: 1,
        life: 0.5,
        size: [0.15, 1],
        fit: 'diameter',
        squash: 0.5,
        tint: 'primary',
        alpha: 0.95,
      },
      {
        tex: 'p_lightning',
        count: 5,
        life: 0.28,
        size: [70, 90],
        spread: Math.PI * 2,
        jitter: 40,
        stagger: 0.06,
        face: false,
        tint: 'secondary',
        alpha: 1,
      },
    ],
  },
};

/** Per-skill replacements (skill id -> archetype lists); empty on purpose, the hook for hand-tuned effects and the part-3 stills. */
export const SKILL_OVERRIDES: Record<string, Partial<Preset>> = {};

/** Structural subset of shared `SkillDef` the resolver reads (keeps this module free of imports). */
export interface SkillLike {
  id: string;
  element: string;
  shape: { type: string; radius?: number };
  targeting: { mode: string; range_tiles?: number };
  effects: ReadonlyArray<{ type: string }>;
  vfx?: { projectile_fx?: string } | null;
}

/** Which archetype plays at `cast_done` for `skill`. */
export function archetypeOf(skill: SkillLike): VfxArchetype {
  if (!skill.effects.some((e) => e.type === 'damage')) return 'aura';
  if (skill.shape.type === 'circle') return 'ring';
  if (skill.vfx?.projectile_fx || skill.shape.type === 'line') return 'trail';
  if (skill.targeting.mode === 'enemy' && (skill.targeting.range_tiles ?? 0) > 3) return 'trail';
  return 'burst';
}

export interface ResolvedVfx {
  archetype: VfxArchetype;
  primary: Rgb;
  secondary: Rgb;
  /** emitters of the cast archetype */
  cast: EmitterDef[];
  /** small impact burst played on every enemy hit */
  hit: EmitterDef[];
  /** element actually used (skill element, or the class' own for root_main / none) */
  element: string;
}

const cache = new Map<string, ResolvedVfx>();

/** Scale a def for the small hit burst (fewer, shorter, smaller particles). */
function toHit(defs: EmitterDef[]): EmitterDef[] {
  return defs.map((d) => ({
    ...d,
    count: Math.max(1, Math.ceil(d.count * 0.6)),
    size: [d.size[0] * 0.7, d.size[1] * 0.7] as const,
    life: d.life * 0.8,
  }));
}

/**
 * Resolves the effect of `skill` for a class. `classElement` = shared skills.json `classes[].element` of the skill's path.
 * Results are cached per (path, skill id).
 */
export function resolveVfx(path: string, classElement: string, skill: SkillLike): ResolvedVfx {
  const key = `${path}/${skill.id}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const element = ELEMENT_COLORS[skill.element] ? skill.element : classElement;
  const colors = ELEMENT_COLORS[element] ?? ELEMENT_COLORS.kim!;
  const flav = FLAVOUR[path] ?? FLAVOUR.kiem!;
  // the main texture follows the skill's element only when it differs from the class' own
  const main = element !== classElement && ELEMENT_TEX[element] ? ELEMENT_TEX[element]! : flav.main;
  const base = buildPreset(main, flav.accent);
  const preset: Preset = { ...base, ...(CLASS_OVERRIDES[path] ?? {}), ...(SKILL_OVERRIDES[skill.id] ?? {}) };
  const archetype = archetypeOf(skill);
  const out: ResolvedVfx = {
    archetype,
    primary: colors.primary,
    secondary: colors.secondary,
    cast: preset[archetype],
    hit: toHit(preset.burst),
    element,
  };
  cache.set(key, out);
  return out;
}

/** Every texture name a preset may use must be a registered particle; returns the unknown ones (tested). */
export function unknownTextures(): string[] {
  const known = new Set(PARTICLE_NAMES);
  const bad = new Set<string>();
  const check = (defs: readonly EmitterDef[]) => defs.forEach((d) => !known.has(d.tex) && bad.add(d.tex));
  const all = new Set<string>([
    ...Object.values(ELEMENT_TEX),
    ...Object.values(FLAVOUR).flatMap((f) => [f.main, f.accent]),
  ]);
  for (const t of all) {
    const p = buildPreset(t, t);
    for (const l of Object.values(p)) check(l);
  }
  for (const o of [...Object.values(CLASS_OVERRIDES), ...Object.values(SKILL_OVERRIDES)])
    for (const l of Object.values(o)) check(l ?? []);
  return [...bad].sort();
}
