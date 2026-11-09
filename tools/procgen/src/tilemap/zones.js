'use strict';
/**
 * World zones of the slice map (D95): the four docs/10 §4 zones laid out on the SAME quadrants as the server's default mob zones
 * (`defaultMobZones`, D74/D83), with their own ground materials. Pure functions, deterministic for a seed, no I/O.
 *
 * Layout numbers (margins, tier bands, border width) come from packages/shared/src/data/world_layout.json, the single source the
 * server, the client and this generator share.
 *
 * A corner holds a LEVEL (same Wang model as the base map: a layer is drawn where the corners reach its level):
 *   0 liquid (water, or lava in Độc Hỏa Đàm) · 1 dirt (neutral ground, the only thing zones share) · 2 zone ground · 3 stone ring
 * Zone ground: bia_rung grass · dam_lay_doc swamp · co_thu_trung_tam grass (+ a stone ring around the giant-tree clearing at level 3)
 * · doc_hoa_dam stone crust over lava.
 *
 * Rules that keep every cell renderable from ONE zone's tiles:
 *  - the zone borders (the quadrant lines) and the plaza around the map centre (the player spawn square + the D83 safe radius) are dirt;
 *    the border band is `zoneBorderCorners` corners wide on each side, so two zone families never share a cell;
 *  - lava never touches dirt: a stone-crust ring (level 2) separates them, so the white foam rim of the dirt tiles never meets lava.
 */
const layout = require('../../../../packages/shared/src/data/world_layout.json');

const ZONE_IDS = layout.zones.map((z) => z.id);
const LEVEL = { LIQUID: 0, DIRT: 1, GROUND: 2, STONE: 3 };

/** Tiles trimmed off each map edge, same rule as `mobZoneMargin` in @vgtd/shared (the test pins that they agree). */
const mobZoneMargin = (n) => Math.max(layout.mobZoneMargin.min, Math.floor(n / layout.mobZoneMargin.divisor));
/** Half-size R of the mob area: the unit of the D83 tier bands. */
const mobAreaHalfSize = (n) => Math.max(1, (n - 2 * mobZoneMargin(n)) / 2);
/** Chebyshev radius around the map centre kept as the dirt plaza: the D83 normal-band start (spawn safe zone) plus a margin. */
const plazaRadius = (n) => layout.mobBands.normal.minFrac * mobAreaHalfSize(n) + layout.plazaMarginTiles;

/** The four zone rectangles in tile coordinates (identical to `defaultMobZones(n)` of the server, in `layout.zones` order). */
function zoneRects(n) {
  const h = n / 2;
  const m = mobZoneMargin(n);
  return layout.zones.map((z) => {
    const [qi, qj] = z.quadrant;
    return { id: z.id, i0: qi ? h + m : m, j0: qj ? h + m : m, i1: qi ? n - m : h - m, j1: qj ? n - m : h - m };
  });
}

/** Zone index (into ZONE_IDS) of a point in tile / corner coordinates: the quadrant of the map centre. */
function zoneIndexAt(i, j, n) {
  const h = n / 2;
  const qi = i >= h ? 1 : 0;
  const qj = j >= h ? 1 : 0;
  return layout.zones.findIndex((z) => z.quadrant[0] === qi && z.quadrant[1] === qj);
}

const ZONE = Object.fromEntries(ZONE_IDS.map((id, k) => [id, k]));

/**
 * Corner levels and zone ids for an `n`-tile square map. `fields(i, j)` returns `{ h, m }` (height and moisture noise in 0..1).
 * Returns `{ W1, H1, level, zone }` (Uint8Arrays, row-major (n+1) x (n+1)).
 */
function generateZoneCorners(o, fields) {
  const n = o.width;
  if (o.height !== n) throw new Error('zones need a square map');
  const W1 = n + 1;
  const half = n / 2;
  const R = mobAreaHalfSize(n);
  const plaza = plazaRadius(n);
  const border = layout.zoneBorderCorners;
  const level = new Uint8Array(W1 * W1);
  const zone = new Uint8Array(W1 * W1);
  const centreOf = (z) => {
    const r = zoneRects(n)[z];
    return [(r.i0 + r.i1) / 2, (r.j0 + r.j1) / 2];
  };
  const centres = ZONE_IDS.map((_, z) => centreOf(z));
  const clearR = layout.clearingFrac * R;
  const ringR = layout.stoneRingFrac * R;
  const lavaLevel = 0.52;
  const swampWater = o.waterLevel + 0.07;

  const raw = (i, j) => {
    const z = zoneIndexAt(i, j, n);
    const { h, m } = fields(i, j);
    switch (z) {
      case ZONE.bia_rung:
        return h < o.waterLevel ? LEVEL.LIQUID : m > o.grassLevel ? LEVEL.GROUND : LEVEL.DIRT;
      case ZONE.dam_lay_doc:
        return h < swampWater ? LEVEL.LIQUID : m > 0.4 ? LEVEL.GROUND : LEVEL.DIRT;
      case ZONE.co_thu_trung_tam: {
        const [ci, cj] = centres[z];
        const r = Math.hypot(i - ci, j - cj);
        if (r < clearR) return LEVEL.GROUND; // the clearing around the giant tree
        if (r < ringR && m > 0.34) return LEVEL.STONE; // rocky ring with gaps
        return h < o.waterLevel - 0.03 ? LEVEL.LIQUID : m > 0.42 ? LEVEL.GROUND : LEVEL.DIRT;
      }
      default: // doc_hoa_dam
        return h < lavaLevel ? LEVEL.LIQUID : LEVEL.GROUND;
    }
  };

  for (let j = 0; j < W1; j++) for (let i = 0; i < W1; i++) {
    level[j * W1 + i] = raw(i, j);
    zone[j * W1 + i] = zoneIndexAt(i, j, n);
  }

  // despeckle: a corner with no 4-neighbour of its own level takes the most common neighbour level (same pass as the base map)
  for (let pass = 0; pass < 2; pass++) {
    const copy = level.slice();
    for (let j = 0; j < W1; j++) for (let i = 0; i < W1; i++) {
      const me = copy[j * W1 + i];
      const counts = [0, 0, 0, 0];
      let same = 0;
      for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ni = i + di, nj = j + dj;
        if (ni < 0 || nj < 0 || ni >= W1 || nj >= W1) continue;
        const nm = copy[nj * W1 + ni];
        counts[nm]++;
        if (nm === me) same++;
      }
      if (same === 0) level[j * W1 + i] = counts.indexOf(Math.max(...counts));
    }
  }

  // overrides last, so they always hold: plaza + zone borders are dirt, lava is kept off the dirt by a stone-crust ring
  for (let j = 0; j < W1; j++) for (let i = 0; i < W1; i++) {
    const k = j * W1 + i;
    const cheb = Math.max(Math.abs(i - half), Math.abs(j - half));
    const dBorder = Math.min(Math.abs(i - half), Math.abs(j - half));
    if (cheb <= plaza || dBorder < border) level[k] = LEVEL.DIRT;
    else if (zone[k] === ZONE.doc_hoa_dam && level[k] === LEVEL.LIQUID && (cheb <= plaza + 3 || dBorder < border + 3)) level[k] = LEVEL.GROUND;
  }
  // the crust ring must also hold after the despeckle: a lava corner next to a dirt corner becomes crust
  for (let j = 0; j < W1; j++) for (let i = 0; i < W1; i++) {
    const k = j * W1 + i;
    if (zone[k] !== ZONE.doc_hoa_dam || level[k] !== LEVEL.LIQUID) continue;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
      const ni = i + di, nj = j + dj;
      if (ni < 0 || nj < 0 || ni >= W1 || nj >= W1) continue;
      if (level[nj * W1 + ni] === LEVEL.DIRT) { level[k] = LEVEL.GROUND; break; }
    }
  }
  return { W1, H1: W1, level, zone };
}

/**
 * The tile stack of each zone: the liquid under the cell and the layers drawn over it, in draw order. `min` = the corner level a
 * layer needs; `fullOnly` = the layer is only drawn when all four corners reach it (dirt in the lava zone: its partial tiles carry
 * a white water-foam rim that must never sit next to lava).
 */
const STACKS = {
  bia_rung: { liquid: 'water', layers: [{ name: 'dirt', min: 1 }, { name: 'grass', min: 2 }] },
  dam_lay_doc: { liquid: 'water', layers: [{ name: 'dirt', min: 1 }, { name: 'swamp_bank', min: 2 }] },
  co_thu_trung_tam: { liquid: 'water', layers: [{ name: 'dirt', min: 1 }, { name: 'grass', min: 2 }, { name: 'stone_bank', min: 3 }] },
  doc_hoa_dam: { liquid: 'lava', layers: [{ name: 'dirt', min: 1, fullOnly: true }, { name: 'lava_crust', min: 2 }] },
};
/** Layer names in draw order (the order of `drawOrder` in tileset.json and of the layers in map.json). */
const LAYER_ORDER = ['liquid', 'dirt', 'grass', 'swamp_bank', 'stone_bank', 'lava_crust'];

/** Named places of the zone map (for prop scatter): the centre and radius (tiles) of the giant-tree clearing in Cổ thụ trung tâm. */
function landmarks(n) {
  const r = zoneRects(n)[ZONE.co_thu_trung_tam];
  return [{ id: 'co_thu_clearing', i: (r.i0 + r.i1) / 2, j: (r.j0 + r.j1) / 2, radius: layout.clearingFrac * mobAreaHalfSize(n) }];
}

module.exports = { landmarks, ZONE_IDS, LEVEL, ZONE, STACKS, LAYER_ORDER, mobZoneMargin, mobAreaHalfSize, plazaRadius, zoneRects, zoneIndexAt, generateZoneCorners };
