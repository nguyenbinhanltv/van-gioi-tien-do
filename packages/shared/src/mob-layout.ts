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

/** The four mob zones of docs/10 section 4 (the ids of `MobZoneId` in mobs.ts, repeated here to keep this file import-free). */
export type MobLayoutZone = 'bia_rung' | 'dam_lay_doc' | 'co_thu_trung_tam' | 'doc_hoa_dam';

/**
 * The default mob zone a tile of a `mapTiles` square map belongs to, or null (zone margin and the dead cross between the
 * quadrants). Same rectangles as the server's `defaultMobZones` (apps/server/src/world/mobs/manager.ts), so client dressing
 * (swamp reeds in the Dam lay doc, ancient trees around the Co thu trung tam, lava props in the Doc Hoa Dam) lands where
 * the zone's mobs live. A real map supplies its own rectangles.
 */
export function mobZoneAt(i: number, j: number, mapTiles: number): MobLayoutZone | null {
  const h = mapTiles / 2;
  const m = mobZoneMargin(mapTiles);
  const west = i >= m && i < h - m,
    east = i >= h + m && i < mapTiles - m;
  const north = j >= m && j < h - m,
    south = j >= h + m && j < mapTiles - m;
  if (west && north) return 'bia_rung';
  if (east && north) return 'dam_lay_doc';
  if (west && south) return 'co_thu_trung_tam';
  if (east && south) return 'doc_hoa_dam';
  return null;
}
