/**
 * Layout numbers of the default mob area (D74 margin, D83 tier bands). Kept in a file with no imports from `data` so the Cocos
 * client (engine-safe vendor subset) can use the same numbers as the server instead of copying them.
 */
export type MobBandTier = 'normal' | 'elite' | 'boss';

/**
 * Where a tier lives, as a fraction of the half-size `R` of the mob area (the distance from the area's centre, the
 * player spawn square, measured as Chebyshev tiles): safe zone around the centre where nothing spawns, then normal
 * mobs near, elites farther, bosses farthest. Fractions, so any map size works. PLACEHOLDERS (D83, cần game designer duyệt).
 */
export const MOB_BANDS: Readonly<Record<MobBandTier, { minFrac: number; maxFrac: number }>> = {
  normal: { minFrac: 0.12, maxFrac: 0.55 },
  elite: { minFrac: 0.4, maxFrac: 0.85 },
  boss: { minFrac: 0.7, maxFrac: 1.0 },
};

/** Tiles trimmed off each map edge by the default mob layout (D74): at least 8, a 32nd of the map. */
export function mobZoneMargin(mapTiles: number): number {
  return Math.max(8, Math.floor(mapTiles / 32));
}

/** Half-size R of the default mob area of a `mapTiles` square map (the unit of the tier bands). */
export function mobAreaHalfSize(mapTiles: number): number {
  return Math.max(1, (mapTiles - 2 * mobZoneMargin(mapTiles)) / 2);
}
