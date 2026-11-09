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

// ---------------------------------------------------------------- PART 3

/**
 * Equipment icons (tools/procgen manifest.json `equip.ids`, 4 x 3 grid order): the six WEAPON TYPES of skills.json (`classes[].weapon`) then
 * the body slots. Neutral art: the UI draws a quality frame / tint from `QUALITY_TIERS`. `getEquipIcon(id)` in PropArt.ts.
 */
export const EQUIP_ICON_IDS: readonly string[] = [
  'sword',
  'fan',
  'gauntlets',
  'whisk_talisman',
  'spear',
  'heavy_saber',
  'robe',
  'boots',
  'belt',
  'ring',
  'pendant',
  'charm',
];

/** Minimap marker ids (manifest `map.icons.ids`, 4 x 2 grid order). */
export const MINIMAP_ICON_IDS: readonly string[] = [
  'self',
  'party',
  'player',
  'quest',
  'elite',
  'boss',
  'portal',
  'herb',
];

/** Tribulation effect names (manifest `tribulation.fx`): bolt, storm cloud, strike warning decal, scorch mark. */
export const FX_NAMES: readonly string[] = ['fx_strike', 'fx_cloud', 'fx_warning', 'fx_scorch'];

export type WorldMapRegion = 'bia_rung' | 'dam_lay_doc' | 'co_thu_trung_tam' | 'doc_hoa_dam' | 'son_mon';

/**
 * Where each region lies on the parchment `world_map.png` (fractions 0..1 of the picture). The painting does NOT follow the quadrants of the
 * D95 map (forest NW, swamp NE, ancient trees SW, lava SE): its forest is NW, lava NE, giant trees E and swamp SW, so a player marker is
 * placed by region, not by raw tile position (see `worldMapPoint`). OPEN-ITEMS: ask the owner to regenerate the map in the quadrant layout.
 */
export const WORLD_MAP_REGIONS: Readonly<Record<WorldMapRegion, { x0: number; y0: number; x1: number; y1: number }>> = {
  bia_rung: { x0: 0.12, y0: 0.1, x1: 0.46, y1: 0.4 },
  dam_lay_doc: { x0: 0.07, y0: 0.62, x1: 0.4, y1: 0.92 },
  co_thu_trung_tam: { x0: 0.64, y0: 0.4, x1: 0.92, y1: 0.8 },
  doc_hoa_dam: { x0: 0.62, y0: 0.08, x1: 0.92, y1: 0.34 },
  son_mon: { x0: 0.34, y0: 0.36, x1: 0.62, y1: 0.64 },
};

/** Vietnamese names of the regions (docs/10 section 3.1). */
export const WORLD_MAP_NAMES: Readonly<Record<WorldMapRegion, string>> = {
  bia_rung: 'Bìa rừng',
  dam_lay_doc: 'Đầm lầy độc',
  co_thu_trung_tam: 'Cổ thụ trung tâm',
  doc_hoa_dam: 'Độc Hỏa Đàm',
  son_mon: 'Sơn Môn',
};

export interface ZoneRect {
  id: string;
  i0: number;
  i1: number;
  j0: number;
  j1: number;
}

/** The region a tile belongs to for the map: its zone, Son Mon when near the centre, else the nearest zone. */
export function worldMapRegionAt(i: number, j: number, mapTiles: number, zones: readonly ZoneRect[]): WorldMapRegion {
  for (const z of zones) if (i >= z.i0 && i < z.i1 && j >= z.j0 && j < z.j1) return z.id as WorldMapRegion;
  const fx = i / mapTiles - 0.5;
  const fy = j / mapTiles - 0.5;
  if (Math.abs(fx) < 0.18 && Math.abs(fy) < 0.18) return 'son_mon';
  let best: WorldMapRegion = 'son_mon';
  let bd = Infinity;
  for (const z of zones) {
    const dx = Math.max(z.i0 - i, 0, i - z.i1);
    const dy = Math.max(z.j0 - j, 0, j - z.j1);
    const d = dx * dx + dy * dy;
    if (d < bd) {
      bd = d;
      best = z.id as WorldMapRegion;
    }
  }
  return best;
}

/**
 * Position of a tile on the parchment, fractions 0..1 of the picture (y down). Inside a zone: the tile's place within the zone mapped into the
 * painted region of that zone; outside every zone (margin, the cross between the quadrants, the Son Mon plaza) the nearest region's edge / centre.
 */
export function worldMapPoint(
  i: number,
  j: number,
  mapTiles: number,
  zones: readonly ZoneRect[],
): { x: number; y: number; region: WorldMapRegion } {
  const region = worldMapRegionAt(i, j, mapTiles, zones);
  const r = WORLD_MAP_REGIONS[region];
  const z = zones.find((q) => q.id === region);
  let u = 0.5;
  let v = 0.5;
  if (z) {
    u = Math.min(1, Math.max(0, (i - z.i0) / Math.max(1, z.i1 - z.i0)));
    v = Math.min(1, Math.max(0, (j - z.j0) / Math.max(1, z.j1 - z.j0)));
  } else if (region === 'son_mon') {
    u = Math.min(1, Math.max(0, (i / mapTiles - 0.32) / 0.36));
    v = Math.min(1, Math.max(0, (j / mapTiles - 0.32) / 0.36));
  }
  return { x: r.x0 + u * (r.x1 - r.x0), y: r.y0 + v * (r.y1 - r.y0), region };
}
