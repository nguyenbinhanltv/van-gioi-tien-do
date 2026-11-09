/**
 * Deterministic prop placement for the Son Mon slice map. Engine-free (no `cc`, no vendor bundle) so it is unit-tested
 * with vitest: same map + seed + defs -> same props.
 *
 * Tile terms: integer (i, j) is a tile; +i runs screen right-down, +j screen left-down, so screen-up is (-1, -1) and
 * screen-right is (+1, -1). A prop's *anchor tile* is the tile that contains its foot point.
 *
 * Biomes (the slice map only has water / dirt / grass terrain; no lava yet):
 *   sect      land: pine / bamboo / peach / bush / mossy + spirit rocks / spirit herbs
 *   swamp     land within SWAMP_REACH tiles of water: dead swamp trees
 *   lava      land within SWAMP_REACH tiles of `lava` terrain (none in the slice map today): cooled lava rocks
 *   courtyard fixed Son Mon courtyard (gate, pavilion, well, lanterns, incense burner, fence), laid out relative to spawn
 *
 * Zones (PART 2 dressing): the slice map has no swamp / lava / old-forest terrain, so props that belong to a mob zone (swamp reeds in
 * the Dam lay doc, ancient trees around the Co thu trung tam, lava props in the Doc Hoa Dam) are scattered by the tile's zone
 * (`PlacementInput.zoneAt`, the same quadrants the server spawns that zone's mobs in) on whatever land is there.
 */

export type Terrain = 'water' | 'dirt' | 'grass' | 'lava';
export type TileOffset = readonly [number, number];

export interface PropDef {
  /** Tile offsets from the anchor tile that the prop blocks; [] = walk-through decoration. */
  block: ReadonlyArray<TileOffset>;
  biomes: ReadonlyArray<string>;
  /** Mob zones (`MobLayoutZone`) whose dressing this prop is; scattered there in the dressing pass (`zoneAt`). */
  zones?: ReadonlyArray<string>;
  /** Relative scatter frequency (0 = never scattered, courtyard only). */
  weight: number;
  /** Free tiles kept around the anchor when scattered (default 1; tall trees 2 so crowns do not pile up). */
  spacing?: number;
}

export interface PlacedProp {
  name: string;
  /** Anchor tile (contains the foot point). */
  i: number;
  j: number;
}

/** One building of the Sơn Môn sect layout (`SECT_BUILDINGS` of @vgtd/shared: the SAME list the server blocks its grid with). */
export interface SectPlacement {
  name: string;
  di: number;
  dj: number;
}

export interface PlacementInput {
  width: number;
  height: number;
  seed: number;
  spawn: { i: number; j: number };
  /** Terrain of a tile, null outside the map. */
  terrain(i: number, j: number): Terrain | null;
  defs: Readonly<Record<string, PropDef>>;
  /** Mob zone of a tile (null outside every zone); omit to scatter by biome only (the original behaviour). */
  zoneAt?(i: number, j: number): string | null;
  /** Scatter attempts target (props placed <= count). */
  count: number;
  /** Scatter within +-radius tiles of the spawn. */
  radius: number;
  /** Zone dressing props on top of `count` (default ZONE_COUNT); only used with `zoneAt`. */
  zoneCount?: number;
  /**
   * The Sơn Môn sect buildings (D115): offsets from `sectOrigin` (default: the spawn), placed at EXACTLY those tiles with no nudging (the
   * server blocks the very same tiles, so a building that moved would leave an invisible wall) and only when every tile of its footprint is
   * land inside the map; a building that does not fit is skipped. Like the courtyard they block tiles and keep scatter away.
   */
  sect?: ReadonlyArray<SectPlacement>;
  /** reference tile of `sect` (the map centre, `sectOrigin` of @vgtd/shared); default `spawn` */
  sectOrigin?: { i: number; j: number };
}

export interface PlacementResult {
  props: PlacedProp[];
  /** Tiles blocked by props (to be merged into the walkability grid). */
  blocked: Array<[number, number]>;
  courtyard: PlacedProp[];
}

/** Tiles around the spawn (Chebyshev) that stay completely free: spawn safe zone, visual clearance only. */
export const SPAWN_CLEAR_RADIUS = 6;
/** A tile with water this close is "swamp". */
export const SWAMP_REACH = 2;
/** Share of shore tiles that grow a swamp tree. */
export const SWAMP_SHARE = 0.35;
/** Zone dressing props scattered ON TOP of the base scatter (a separate pass, own PRNG stream). */
export const ZONE_COUNT = 60;
/**
 * Zone dressing starts this many tiles (Chebyshev) from the spawn: the start view stays as before (the big zone props would add
 * draw calls there: more L3 runs between the animated bodies, docs/33 gate), the dressing is what you find walking into a zone.
 */
export const ZONE_MIN_DIST = 16;

/** mulberry32: deterministic PRNG shared with Bootstrap's prop scatter. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const isLand = (t: Terrain | null): boolean => t === 'dirt' || t === 'grass';

/**
 * Courtyard layout in spawn-relative tile offsets. The approach from the spawn to the gate runs along screen-up
 * (-1,-1); the gate straddles it (pillars at +-(2,-2) of its centre, the passage between stays free), lanterns flank
 * the approach, the pavilion sits to the screen-right, the well to the screen-left. Everything is >= 7 tiles from the
 * spawn (clear zone 6) and never on the centre line of the approach.
 */
export const COURTYARD: ReadonlyArray<{ name: string; di: number; dj: number }> = [
  { name: 'sect_gate_paifang', di: -10, dj: -10 },
  { name: 'lantern_stone', di: -6, dj: -10 },
  { name: 'lantern_stone', di: -10, dj: -6 },
  { name: 'pavilion_small', di: 6, dj: -7 },
  { name: 'incense_burner', di: 3, dj: -7 },
  { name: 'well_stone', di: -7, dj: 5 },
  { name: 'fence_wood_segment', di: -13, dj: -8 },
  { name: 'fence_wood_segment', di: -8, dj: -13 },
];

export function placeProps(input: PlacementInput): PlacementResult {
  const { width, height, spawn, terrain, defs } = input;
  const occupied = new Set<number>();
  const key = (i: number, j: number) => j * width + i;
  const inMap = (i: number, j: number) => i >= 0 && j >= 0 && i < width && j < height;
  const clear = (i: number, j: number) => Math.max(Math.abs(i - spawn.i), Math.abs(j - spawn.j)) <= SPAWN_CLEAR_RADIUS;
  const tilesOf = (name: string, i: number, j: number): Array<[number, number]> =>
    (defs[name]?.block ?? []).map(([di, dj]) => [i + di, j + dj] as [number, number]);
  /** The anchor needs land on all four sides; every blocked tile (and the anchor itself) must be land, free, inside the map and outside the spawn clear zone. */
  const fits = (name: string, i: number, j: number): boolean => {
    if (!inMap(i, j) || !isLand(terrain(i, j)) || occupied.has(key(i, j)) || clear(i, j)) return false;
    // coast cells only show a rim of land (the dirt / grass overlay is a transition tile): keep props off them
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ] as const)
      if (!isLand(terrain(i + di, j + dj))) return false;
    for (const [ti, tj] of tilesOf(name, i, j)) {
      if (!inMap(ti, tj) || !isLand(terrain(ti, tj)) || occupied.has(key(ti, tj)) || clear(ti, tj)) return false;
    }
    return true;
  };
  const blocked: Array<[number, number]> = [];
  /** Tiles that must stay free of other props: within `spacing` of a placed prop's anchor or blocked tiles. */
  const halo = new Set<number>();
  const take = (name: string, i: number, j: number) => {
    const gap = defs[name]?.spacing ?? 1;
    for (const [ti, tj] of [[i, j] as [number, number], ...tilesOf(name, i, j)]) {
      for (let dj = -gap; dj <= gap; dj++) for (let di = -gap; di <= gap; di++) halo.add(key(ti + di, tj + dj));
    }
    for (const [ti, tj] of tilesOf(name, i, j)) {
      occupied.add(key(ti, tj));
      blocked.push([ti, tj]);
    }
    occupied.add(key(i, j));
  };

  // 1. courtyard: fixed layout; an item whose tiles are not land is nudged up to 2 tiles away along screen-up/down,
  // otherwise skipped (the map is procedural, the courtyard adapts instead of forcing terrain)
  const courtyard: PlacedProp[] = [];
  for (const c of COURTYARD) {
    if (!defs[c.name]) continue;
    const bi = spawn.i + c.di,
      bj = spawn.j + c.dj;
    let at: [number, number] | null = null;
    for (const [oi, oj] of [
      [0, 0],
      [1, 1],
      [-1, -1],
      [2, 2],
      [-2, -2],
      [1, -1],
      [-1, 1],
    ] as const) {
      if (fits(c.name, bi + oi, bj + oj)) {
        at = [bi + oi, bj + oj];
        break;
      }
    }
    if (!at) continue;
    take(c.name, at[0], at[1]);
    courtyard.push({ name: c.name, i: at[0], j: at[1] });
  }
  // 1b. sect buildings (D115): fixed tiles shared with the server grid, never nudged
  if (input.sect) {
    const o = input.sectOrigin ?? spawn;
    for (const b of input.sect) {
      if (!defs[b.name]) continue;
      const bi = o.i + b.di,
        bj = o.j + b.dj;
      const tiles = [[bi, bj] as [number, number], ...tilesOf(b.name, bi, bj)];
      // land under the whole footprint and around the anchor (a coast tile only shows a rim of land), free, inside the map
      const ok =
        tiles.every(([ti, tj]) => inMap(ti, tj) && isLand(terrain(ti, tj)) && !occupied.has(key(ti, tj))) &&
        !clear(bi, bj);
      if (!ok) continue;
      take(b.name, bi, bj);
      courtyard.push({ name: b.name, i: bi, j: bj });
    }
  }
  // the passage under the gate must stay walkable: nothing may be scattered on the approach line either
  const reserve = new Set<number>();
  for (let k = 3; k <= 12; k++)
    for (const w of [-1, 0, 1]) {
      const i = spawn.i - k + w,
        j = spawn.j - k - w;
      if (inMap(i, j)) reserve.add(key(i, j));
    }

  // 2. scatter
  const rand = mulberry32(input.seed);
  const scatter = Object.entries(defs).filter(([, d]) => d.weight > 0);
  const byBiome = (b: string) => scatter.filter(([, d]) => d.biomes.includes(b));
  const byZone = (z: string) => scatter.filter(([, d]) => d.zones?.includes(z));
  // zone dressing draws from its OWN stream: the base scatter stays exactly what it was without zones (same props at the same
  // tiles near the spawn), so adding or retuning dressing never reshuffles the start view (and its draw-call count)
  const zrand = mulberry32((input.seed ^ 0x5bd1e995) >>> 0);
  const pick = (list: Array<[string, PropDef]>, rng: () => number = rand): string | null => {
    const total = list.reduce((s, [, d]) => s + d.weight, 0);
    if (total <= 0) return null;
    let r = rng() * total;
    for (const [n, d] of list) {
      r -= d.weight;
      if (r < 0) return n;
    }
    return list[list.length - 1]![0];
  };
  const near = (i: number, j: number, t: Terrain): boolean => {
    for (let dj = -SWAMP_REACH; dj <= SWAMP_REACH; dj++)
      for (let di = -SWAMP_REACH; di <= SWAMP_REACH; di++) if (terrain(i + di, j + dj) === t) return true;
    return false;
  };
  const props: PlacedProp[] = [];
  /** Places `name` at (i, j) when it fits and keeps its distance to everything placed so far; true when taken. */
  const tryPlace = (name: string, i: number, j: number): boolean => {
    if (!fits(name, i, j)) return false;
    // `spacing` free tiles around the anchor AND every blocked tile (so 2x2 rocks keep a gap too), both ways: this prop's own
    // radius against what is placed, and the halo of what is placed against this prop. Keeps paths open, crowns apart.
    const gap = defs[name]!.spacing ?? 1;
    const tight = [[i, j] as [number, number], ...tilesOf(name, i, j)].some(([ti, tj]) => {
      if (halo.has(key(ti, tj))) return true;
      for (let dj = -gap; dj <= gap; dj++)
        for (let di = -gap; di <= gap; di++) if (occupied.has(key(ti + di, tj + dj))) return true;
      return false;
    });
    if (tight) return false;
    if (tilesOf(name, i, j).some(([ti, tj]) => reserve.has(key(ti, tj)))) return false;
    take(name, i, j);
    props.push({ name, i, j });
    return true;
  };
  for (let n = 0; n < input.count * 12 && props.length < input.count; n++) {
    const i = Math.floor(spawn.i + (rand() * 2 - 1) * input.radius);
    const j = Math.floor(spawn.j + (rand() * 2 - 1) * input.radius);
    if (!inMap(i, j) || !isLand(terrain(i, j)) || reserve.has(key(i, j))) continue;
    // shore tiles take a swamp tree only some of the time (a pond is not a swamp); lava edges always take lava rocks
    const biome = near(i, j, 'lava') ? 'lava' : near(i, j, 'water') && rand() < SWAMP_SHARE ? 'swamp' : 'sect';
    const list = byBiome(biome);
    const name = pick(list.length ? list : byBiome('sect'));
    if (!name) continue;
    tryPlace(name, i, j);
  }

  // 3. zone dressing: a separate pass AFTER the base scatter with its own PRNG stream, on top of the base props (they keep their
  // tiles), only where a mob zone has dressing and never closer than ZONE_MIN_DIST to the spawn
  if (input.zoneAt) {
    const target = input.zoneCount ?? ZONE_COUNT;
    let placed = 0;
    for (let n = 0; n < target * 12 && placed < target; n++) {
      const i = Math.floor(spawn.i + (zrand() * 2 - 1) * input.radius);
      const j = Math.floor(spawn.j + (zrand() * 2 - 1) * input.radius);
      if (!inMap(i, j) || !isLand(terrain(i, j)) || reserve.has(key(i, j))) continue;
      if (Math.max(Math.abs(i - spawn.i), Math.abs(j - spawn.j)) < ZONE_MIN_DIST) continue;
      const zone = input.zoneAt(i, j);
      const list = zone ? byZone(zone) : [];
      if (list.length === 0) continue;
      const name = pick(list, zrand);
      if (name && tryPlace(name, i, j)) placed++;
    }
  }
  return { props, blocked, courtyard };
}
