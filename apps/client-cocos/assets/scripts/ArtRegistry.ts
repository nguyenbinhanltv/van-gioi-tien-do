/**
 * Registries of the PART 2 Gemini art ids (engine-free: no `cc` import; unit-tested against tools/procgen manifest.json): status
 * icons, realm badges and particle textures. The frames themselves come from PropArt.ts (`getStatusIcon`, `getRealmBadge`,
 * `getParticleFrame`).
 *
 * Particles: white / coloured glows with alpha = luminance of the black-background exports, so they work with additive blending
 * (glow, fire, lightning, light) and with normal alpha blending (leaf, smoke). VFX code asks `particleSpec(name)` for the blend and
 * a sensible size, then `getParticleFrame(name)` for the frame.
 */

/** Ids of the status icons (4 x 3 grid order of tools/procgen manifest.json `status.ids`; names follow shared StatusId + buffs). */
export const STATUS_ICON_IDS: readonly string[] = [
  'root',
  'slow',
  'poison',
  'burn',
  'stun',
  'shield',
  'meditate',
  'regen',
  'atk_up',
  'def_up',
  'invulnerable',
  'breakthrough_buff',
];

/** Realm badges: Luyen Khi .. Do Kiep, index = REALM_NAMES index (server realm - 1). */
export const REALM_BADGE_COUNT = 9;

export type ParticleBlend = 'additive' | 'alpha';

export interface ParticleSpec {
  readonly name: string;
  /** Blend mode the texture was made for. */
  readonly blend: ParticleBlend;
  /** Natural draw size in design px (the @2x texture is 192 px, drawn at half, so it stays sharp at the 2x camera zoom). */
  readonly size: number;
  /** What it is for (VFX code picks by role, not by file name). */
  readonly use: string;
}

export const PARTICLES: readonly ParticleSpec[] = [
  { name: 'p_flame', blend: 'additive', size: 64, use: 'fire / burn / Hoa skills' },
  { name: 'p_glow', blend: 'additive', size: 96, use: 'soft orb: aura, heal, level-up / breakthrough flare' },
  { name: 'p_ice', blend: 'additive', size: 64, use: 'ice shard / Thuy skills' },
  { name: 'p_leaf', blend: 'alpha', size: 40, use: 'leaf: Moc skills, ambient' },
  { name: 'p_lightning', blend: 'additive', size: 96, use: 'lightning bolt / Loi skills' },
  { name: 'p_ring', blend: 'additive', size: 96, use: 'expanding ring: shockwave, cast pulse' },
  { name: 'p_rune', blend: 'additive', size: 128, use: 'rune circle: formation, breakthrough, cast ground mark' },
  { name: 'p_slash', blend: 'additive', size: 96, use: 'sword / blade slash arc' },
  { name: 'p_smoke', blend: 'alpha', size: 80, use: 'smoke puff: death, dash dust' },
  { name: 'p_spark', blend: 'additive', size: 48, use: 'four-point spark: hit flash, sparkle' },
];

export const PARTICLE_NAMES: readonly string[] = PARTICLES.map((p) => p.name);

const BY_NAME = new Map(PARTICLES.map((p) => [p.name, p] as const));

/** Spec of a registered particle, or undefined. */
export function particleSpec(name: string): ParticleSpec | undefined {
  return BY_NAME.get(name);
}
