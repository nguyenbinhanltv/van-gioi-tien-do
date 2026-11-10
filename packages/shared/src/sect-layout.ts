/**
 * Layout of the Sơn Môn Đại Phái buildings (D118): where the nine owner-provided sect props stand around the map centre, and which tiles
 * they block. ONE source for the server (blocks the tiles on its walkability grid, so prediction and the real simulation agree) and the
 * client (draws the buildings and merges the same tiles into its own walkability). All positions are tile offsets from the ORIGIN, the
 * centre tile of the map (`sectOrigin`), the same point the players spawn around.
 *
 * The footprints equal the `block` lists of the sect props in tools/procgen `src/gemini/manifest.json` (a test pins that), and every
 * building lies inside the open dirt plaza of the D95 zone map (radius = D83 normal-band start + 4 tiles = 18.4 on a 256 map), outside the
 * spawn clear radius (6) and off the approach corridor to the gate, so none of them can stand on water or lava or box a player in.
 *
 * Offsets follow the screen convention of the client: +i runs right-down, +j left-down, so screen-up is (-1, -1). PLACEHOLDER layout,
 * cần game designer duyệt (the NPC ring of apps/client-cocos NpcPlacement is the reference for who stands next to what).
 */

export type SectTileOffset = readonly [number, number];

export interface SectBuilding {
  /** the prop key (= the sidecar key of `gen:gemini`) */
  readonly name: string;
  /** tile offset of the anchor tile from the origin */
  readonly di: number;
  readonly dj: number;
  /** tiles the building blocks, as offsets from its anchor tile ([] = walk-through) */
  readonly block: readonly SectTileOffset[];
  /** what it is, and which NPC or system it stands for */
  readonly role: string;
}

const ONE: readonly SectTileOffset[] = [[0, 0]];
const TWO_BY_TWO: readonly SectTileOffset[] = [
  [0, 0],
  [1, 0],
  [0, 1],
  [1, 1],
];
const THREE_BY_THREE: readonly SectTileOffset[] = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [0, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];
/** a gate: the two pillars block, the passage between them stays open (same shape as the courtyard paifang) */
const GATE: readonly SectTileOffset[] = [
  [-2, 2],
  [2, -2],
];

export const SECT_BUILDINGS: readonly SectBuilding[] = [
  {
    name: 'sect_main_hall',
    di: -17,
    dj: -17,
    block: THREE_BY_THREE,
    role: 'Đại điện: behind the courtyard gate, at the end of the approach',
  },
  { name: 'sect_gate', di: 13, dj: -13, block: GATE, role: 'Cổng phụ: the east entrance towards Hậu sơn' },
  {
    name: 'sect_scripture_pavilion',
    di: -3,
    dj: -14,
    block: TWO_BY_TWO,
    role: 'Tàng Kinh Các: the class library of manuals (D98), by the elder NPC',
  },
  {
    name: 'sect_alchemy_furnace',
    di: -2,
    dj: -9,
    block: ONE,
    role: 'Đan lô: the alchemy furnace (D108 range is 20 tiles from the spawn centre), next to the elder NPC',
  },
  { name: 'sect_forge_anvil', di: 8, dj: -3, block: TWO_BY_TWO, role: 'Lò rèn: next to the blacksmith NPC' },
  {
    name: 'sect_training_dummy',
    di: -10,
    dj: 4,
    block: ONE,
    role: 'Mộc nhân: the tutorial training dummy (a prop only: no mob def yet, OPEN-ITEMS D114)',
  },
  { name: 'sect_contribution_board', di: -11, dj: -1, block: ONE, role: 'Bảng Cống hiến: by the sect head NPC (D98)' },
  { name: 'sect_lantern_post', di: -8, dj: -6, block: ONE, role: 'Đèn đá: flanks the approach' },
  { name: 'sect_lantern_post', di: -6, dj: -8, block: ONE, role: 'Đèn đá: flanks the approach' },
  { name: 'sect_lantern_post', di: -14, dj: -11, block: ONE, role: 'Đèn đá: flanks the approach, before the hall' },
  { name: 'sect_lantern_post', di: -11, dj: -14, block: ONE, role: 'Đèn đá: flanks the approach, before the hall' },
  { name: 'sect_banner', di: -14, dj: -18, block: ONE, role: 'Cờ phái: by the main hall' },
  { name: 'sect_banner', di: -18, dj: -14, block: ONE, role: 'Cờ phái: by the main hall' },
  { name: 'sect_banner', di: 11, dj: -15, block: ONE, role: 'Cờ phái: by the east gate' },
  { name: 'sect_banner', di: 15, dj: -11, block: ONE, role: 'Cờ phái: by the east gate' },
];

/** The layout origin of a `mapTiles` square map: its centre tile (where the spawn square is centred). */
export function sectOrigin(mapTiles: number): { i: number; j: number } {
  const c = Math.floor(mapTiles / 2);
  return { i: c, j: c };
}

/** Every tile the sect buildings block on a `mapTiles` square map (inside the map only, each tile once). */
export function sectBlockedTiles(mapTiles: number): Array<[number, number]> {
  const o = sectOrigin(mapTiles);
  const seen = new Set<number>();
  const out: Array<[number, number]> = [];
  for (const b of SECT_BUILDINGS)
    for (const [bi, bj] of b.block) {
      const i = o.i + b.di + bi;
      const j = o.j + b.dj + bj;
      if (i < 0 || j < 0 || i >= mapTiles || j >= mapTiles) continue;
      const k = j * mapTiles + i;
      if (seen.has(k)) continue;
      seen.add(k);
      out.push([i, j]);
    }
  return out;
}
