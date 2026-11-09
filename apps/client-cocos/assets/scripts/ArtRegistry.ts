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

/** Skill VFX stills of the owner's PART 3 group Q (vfx/<class>.png, 3 panels each): see tools/procgen manifest.json `vfx`. */
export const VFX_CLASSES: readonly string[] = ['kiem', 'phap', 'the', 'dan_phu', 'thuong', 'dao'];
export const VFX_PANELS: readonly string[] = ['proj', 'burst', 'ring'];
/** Particle texture name of a class' VFX still: `vfxTex('phap', 'proj')` -> `vfx_phap_proj`. */
export const vfxTex = (path: string, panel: string): string => `vfx_${path}_${panel}`;
const VFX_USE: Record<string, string> = {
  proj: 'projectile (points +x, tail on the left): full-colour art, draw untinted',
  burst: 'impact burst: full-colour art, draw untinted',
  ring: 'ground ring / zone mark (top-down circle, squash for the iso ellipse): full-colour art, draw untinted',
};
const VFX_SIZE: Record<string, number> = { proj: 128, burst: 160, ring: 256 };
const VFX_PARTICLES: ParticleSpec[] = VFX_CLASSES.flatMap((c) =>
  VFX_PANELS.map((p): ParticleSpec => ({
    name: vfxTex(c, p),
    blend: 'alpha',
    size: VFX_SIZE[p]!,
    use: `${c} ${VFX_USE[p]}`,
  })),
);

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
  ...VFX_PARTICLES,
];

export const PARTICLE_NAMES: readonly string[] = PARTICLES.map((p) => p.name);

const BY_NAME = new Map(PARTICLES.map((p) => [p.name, p] as const));

/** Spec of a registered particle, or undefined. */
export function particleSpec(name: string): ParticleSpec | undefined {
  return BY_NAME.get(name);
}

/** HUD / social icons (PART 3 group P), in the 4 x 4 grid order of tools/procgen manifest.json `hud.ids`: round, on their own backing disc. */
export const HUD_ICON_IDS: readonly string[] = [
  'friend_add',
  'friend_remove',
  'chat',
  'party_invite',
  'leader',
  'online',
  'offline',
  'world',
  'zone',
  'quest_available',
  'quest_turnin',
  'sect',
  'bag',
  'map',
  'settings',
  'close',
];

/** Chat channel -> HUD icon (the channel the next line goes to: plain text World, /z Zone, /w /r whisper, /p party). */
export const CHAT_CHANNEL_ICON: Readonly<Record<'world' | 'zone' | 'whisper' | 'party', string>> = {
  world: 'world',
  zone: 'zone',
  whisper: 'chat',
  party: 'party_invite',
};

/** Which chat channel a typed line will use, from its first characters (same rules as `parseChatInput` in client-core). */
export function channelOfInput(raw: string): 'world' | 'zone' | 'whisper' | 'party' {
  const m = /^\/(\S*)/.exec(raw.trimStart());
  if (!m || raw.trimStart().startsWith('//')) return 'world';
  switch (m[1]!.toLowerCase()) {
    case 'z':
    case 'zone':
    case 'v':
      return 'zone';
    case 'w':
    case 't':
    case 'whisper':
    case 'r':
    case 'reply':
      return 'whisper';
    case 'p':
    case 'party':
    case 'd':
      return 'party';
    default:
      return 'world';
  }
}

/**
 * Sect library manual -> item icon key (PART 3 group O: `manual_t<tier>_<form>`). Tier follows the manual's level (the data marks the
 * tome skills at 20 / 31 / 40 / 51 / 65: low <= 31, mid <= 51, high above); the form (book / scroll / tablet) follows its index in the
 * class library so a library does not show one shape three times in a row.
 */
export function manualIconKey(levelMin: number, index: number): string {
  const tier = levelMin <= 31 ? 1 : levelMin <= 51 ? 2 : 3;
  const form = ['book', 'scroll', 'tablet'][((Math.trunc(index) % 3) + 3) % 3]!;
  return `manual_t${tier}_${form}`;
}

/**
 * Item key -> icon key for items whose art was exported under a descriptive name (PART 3 group O: the alchemy pills). Items without an
 * entry keep their own key; icons without an item stay registered (the alchemy herbs and the Cống hiến token have no item def yet).
 * PROVISIONAL mapping by colour / name: ho_mach_pill (hộ mạch, green mist), dinh_tam_pill (định tâm, blue wave); the Trúc Cơ and Kết Kim
 * pill recipe ids (D108) take the gold ring and the white wind. Re-map when the owner confirms which pill is which.
 */
export const ITEM_ICON_ALIASES: Readonly<Record<string, string>> = {
  ho_mach_pill: 'pill_green_mist',
  dinh_tam_pill: 'pill_blue_wave',
  truc_co_pill: 'pill_gold_ring',
  ket_kim_pill: 'pill_white_wind',
  pill_truc_co_dan: 'pill_gold_ring',
  pill_ket_kim_dan: 'pill_white_wind',
};
export const itemIconKey = (key: string): string => ITEM_ICON_ALIASES[key] ?? key;
