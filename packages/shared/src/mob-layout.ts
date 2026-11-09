/**
 * Layout numbers of the default mob area (D74 margin, D83 tier bands), read from `data/world_layout.json` so the server, the Cocos
 * client (engine-safe vendor subset, no `data` index import) and the JS tile generator (D95) all use the same numbers.
 */
import layout from './data/world_layout.json';

export type MobBandTier = 'normal' | 'elite' | 'boss';

/**
 * Where a tier lives, as a fraction of the half-size `R` of the mob area (the distance from the area's centre, the
 * player spawn square, measured as Chebyshev tiles): safe zone around the centre where nothing spawns, then normal
 * mobs near, elites farther, bosses farthest. Fractions, so any map size works. PLACEHOLDERS (D83, cần game designer duyệt).
 */
export const MOB_BANDS: Readonly<Record<MobBandTier, { minFrac: number; maxFrac: number }>> = layout.mobBands;

/** Tiles trimmed off each map edge by the default mob layout (D74): at least 8, a 32nd of the map. */
export function mobZoneMargin(mapTiles: number): number {
  return Math.max(layout.mobZoneMargin.min, Math.floor(mapTiles / layout.mobZoneMargin.divisor));
}

/** Half-size R of the default mob area of a `mapTiles` square map (the unit of the tier bands). */
export function mobAreaHalfSize(mapTiles: number): number {
  return Math.max(1, (mapTiles - 2 * mobZoneMargin(mapTiles)) / 2);
}
