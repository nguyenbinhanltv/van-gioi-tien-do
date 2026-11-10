/**
 * THE world-scale table (D123, PROVISIONAL): how tall everything that stands in the world is, in TILES (1 tile = `TILE_WIDTH`
 * design px, the iso tile width), so a player, a mob, an NPC and a building read as one consistent scene. Art is authored at
 * arbitrary pixel sizes (Gemini concepts, chibi masters), so every visual is fitted to its entry here instead of being drawn
 * at its raw size. Purely visual: server hit radii, footprints and blocking tiles are untouched. Engine-free (unit-tested);
 * callers pass `tileWidth` from `shared.TILE_WIDTH`, this module holds no tile constant.
 */

/** Player body height. The chibi masters are `CHIBI_MASTER_PX` tall (in a 256 px cell), see ChibiBody. */
export const PLAYER_HEIGHT_TILES = 1.5;
/** Painted height of the chibi master art (px), the value `CHIBI_SCALE` is derived from. */
export const CHIBI_MASTER_PX = 208;
/** NPCs stand as tall as the player. */
export const NPC_HEIGHT_TILES = PLAYER_HEIGHT_TILES;

/** Mob height by tier / footprint (MOB_DEFS `tier`, `footprint`). */
export const MOB_HEIGHT_TILES = {
  normal: 1.2,
  elite: 1.7,
  /** boss on a 2x2 footprint */
  boss2: 2.6,
  /** boss on a 4x4 footprint */
  boss4: 3.2,
} as const;
/** A mob sprite may overhang its footprint: width cap = (footprint + this) tiles, so a wide crouched pose does not dwarf the map. */
export const MOB_WIDTH_OVERHANG_TILES = 0.5;

/**
 * Props / buildings: height in tiles for the art that needs one (key = sidecar prop key). A prop not listed keeps the size of
 * its art (scale 1): trees, rocks and decoration already read right next to the player. Buildings are enlarged so a door is
 * about 1.2x the player height without outgrowing their blocked footprint by more than a quarter.
 */
export const PROP_HEIGHT_TILES: Readonly<Record<string, number>> = {
  sect_main_hall: 4.0,
  sect_gate: 4.0,
  sect_scripture_pavilion: 4.0,
  pavilion_small: 4.0,
};

export type MobTierKey = 'normal' | 'elite' | 'boss';

/** Target height (tiles) of a mob of `tier` on a `footprint`-tile square. */
export function mobHeightTiles(tier: MobTierKey, footprint: number): number {
  if (tier === 'boss') return footprint >= 4 ? MOB_HEIGHT_TILES.boss4 : MOB_HEIGHT_TILES.boss2;
  return tier === 'elite' ? MOB_HEIGHT_TILES.elite : MOB_HEIGHT_TILES.normal;
}

/** Uniform scale that makes a sprite `spriteHeightPx` tall stand `heightTiles` tall. */
export function scaleForHeight(heightTiles: number, spriteHeightPx: number, tileWidth: number): number {
  return (heightTiles * tileWidth) / spriteHeightPx;
}

/** Mob scale: the height target, capped by the width allowance of its footprint. */
export function mobScale(
  tier: MobTierKey,
  footprint: number,
  sprite: { w: number; h: number },
  tileWidth: number,
): number {
  const byHeight = scaleForHeight(mobHeightTiles(tier, footprint), sprite.h, tileWidth);
  const byWidth = ((footprint + MOB_WIDTH_OVERHANG_TILES) * tileWidth) / sprite.w;
  return Math.min(byHeight, byWidth);
}

/** Chibi root scale for the player and chibi NPCs. */
export function chibiScale(tileWidth: number): number {
  return scaleForHeight(PLAYER_HEIGHT_TILES, CHIBI_MASTER_PX, tileWidth);
}

/** Prop scale: 1 unless the prop has a height entry. */
export function propScale(name: string, spriteHeightPx: number, tileWidth: number): number {
  const t = PROP_HEIGHT_TILES[name];
  return t === undefined ? 1 : scaleForHeight(t, spriteHeightPx, tileWidth);
}
