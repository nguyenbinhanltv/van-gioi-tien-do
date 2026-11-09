import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import {
  MOB_BANDS,
  SECT_BUILDINGS,
  fieldBandStart,
  mobAreaHalfSize,
  mobZoneMargin,
  sectBlockedTiles,
  sectOrigin,
} from '@vgtd/shared';
import { TILE_WALKABLE, TileGrid, circleBlocked } from '@vgtd/sim';
import { COLLIDER_RADIUS_TILES } from '@vgtd/shared';
import {
  MobManager,
  TerrainFormatError,
  blockSectBuildings,
  defaultMobZones,
  isMobId,
  openRows,
  parseTerrain,
  terrainGrid,
} from '../src/index.js';

// the tile generator is plain CommonJS next to the server tests' reach: read its zone module the way the generator does
const require = createRequire(import.meta.url);
const Z = require('../../../tools/procgen/src/tilemap/zones.js');
const Gen = require('../../../tools/procgen/src/tilemap/generate_tilemap.js');

describe('the generator zones are the server mob zones (D95)', () => {
  it.each([64, 128, 256, 512])(
    'map %i: margin, half-size, rectangles and the plaza agree with @vgtd/shared and defaultMobZones',
    (n) => {
      expect(Z.mobZoneMargin(n)).toBe(mobZoneMargin(n));
      expect(Z.mobAreaHalfSize(n)).toBe(mobAreaHalfSize(n));
      const server = defaultMobZones(n).map((z) => ({ id: z.zone, i0: z.i0, j0: z.j0, i1: z.i1, j1: z.j1 }));
      expect(Z.zoneRects(n)).toEqual(server);
      // the plaza keeps the D83 safe zone (where no mob spawns) plus a margin
      expect(Z.plazaRadius(n)).toBeCloseTo(fieldBandStart(n) + 4, 9);
      expect(Z.plazaRadius(n)).toBeGreaterThan(MOB_BANDS.normal.minFrac * mobAreaHalfSize(n));
    },
  );
});

const walk = (g: TileGrid, i: number, j: number): boolean => (g.flags(i, j) & TILE_WALKABLE) !== 0;

describe('terrain.json (D95)', () => {
  const ok = { format: 'tutien-terrain', version: 1, seed: 3, width: 4, height: 3, rows: ['..#.', '.##.', '....'] };
  it('parses and builds a grid that blocks exactly the # tiles', () => {
    const t = parseTerrain(ok);
    expect([t.width, t.height, t.seed]).toEqual([4, 3, 3]);
    const g = terrainGrid(t);
    expect(walk(g, 0, 0)).toBe(true);
    expect(walk(g, 2, 0)).toBe(false);
    expect(walk(g, 1, 1)).toBe(false);
    expect(walk(g, 3, 2)).toBe(true);
  });
  it('rejects anything malformed with a TerrainFormatError', () => {
    const bad = (o: unknown): void => expect(() => parseTerrain(o)).toThrow(TerrainFormatError);
    bad(null);
    bad({ ...ok, format: 'nope' });
    bad({ ...ok, version: 2 });
    bad({ ...ok, width: 0 });
    bad({ ...ok, rows: ['..#.', '.##.'] }); // wrong height
    bad({ ...ok, rows: ['..#.', '.##', '....'] }); // ragged
    bad({ ...ok, rows: ['..#.', '.#x.', '....'] }); // unknown tile char
  });
});

describe('mobs on a generated zone map', () => {
  const N = 256;
  const o = { ...Gen.parseArgs([]), width: N, height: N };
  const zc = Z.generateZoneCorners(o, Gen.zoneFields(o));
  // walkability rows exactly as the generator derives them (tile ids are irrelevant here)
  const rows: string[] = Gen.buildZoneMap(o, zc, new Proxy({}, { get: () => 1 })).rows;
  const grid = TileGrid.fromRows(rows);

  it('lava and water are blocked, the spawn plaza is open, and a good part of every zone is walkable', () => {
    const half = N / 2;
    const r = Math.floor(fieldBandStart(N));
    for (let j = half - r; j < half + r; j++) for (let i = half - r; i < half + r; i++) expect(rows[j]![i]).toBe('.');
    for (const z of Z.zoneRects(N) as { i0: number; j0: number; i1: number; j1: number }[]) {
      let open = 0;
      let all = 0;
      for (let j = z.j0; j < z.j1; j++)
        for (let i = z.i0; i < z.i1; i++) {
          all++;
          if (rows[j]![i] === '.') open++;
        }
      expect(open / all).toBeGreaterThan(0.35);
      expect(open / all).toBeLessThan(0.99); // each zone has blocked water / lava too
    }
  });

  it('every mob of the default layout stands on walkable ground (never in water or lava), deterministically', () => {
    const make = (): MobManager => new MobManager({ seed: 5, zones: defaultMobZones(N), grid });
    const m = make();
    expect(m.size).toBeGreaterThan(100);
    for (let k = 0; k < m.size; k++) {
      const info = m.info(1_000_000 + k)!;
      expect(isMobId(info.id)).toBe(true);
      expect(circleBlocked(grid, info.home.i, info.home.j, COLLIDER_RADIUS_TILES, 0, false)).toBe(false);
      expect(rows[Math.floor(info.home.j)]![Math.floor(info.home.i)]).toBe('.');
    }
    expect(make().stateHash()).toBe(m.stateHash());
  });
});

describe('Son Mon sect buildings on the server grid (D115)', () => {
  const N = 256;
  const o = { ...Gen.parseArgs([]), width: N, height: N };
  const zoneRows: string[] = Gen.buildZoneMap(
    o,
    Z.generateZoneCorners(o, Gen.zoneFields(o)),
    new Proxy({}, { get: () => 1 }),
  ).rows;

  it('blocks exactly the shared tiles on an open map and leaves every other tile alone', () => {
    const rows = blockSectBuildings(openRows(N));
    const mine = new Set(sectBlockedTiles(N).map(([i, j]) => `${i},${j}`));
    let blocked = 0;
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++) {
        const b = rows[j]![i] === '#';
        expect(b, `${i},${j}`).toBe(mine.has(`${i},${j}`));
        if (b) blocked++;
      }
    expect(blocked).toBe(mine.size);
    const g = TileGrid.fromRows(rows);
    const c = sectOrigin(N);
    expect(walk(g, c.i, c.j)).toBe(true); // the spawn centre stays open
    expect(walk(g, c.i - 17, c.j - 17)).toBe(false); // the main hall
    expect(circleBlocked(g, c.i - 17 + 0.5, c.j - 17 + 0.5, COLLIDER_RADIUS_TILES, 0, false)).toBe(true);
  });

  it('on the D95 zone map every footprint tile is land (the buildings stand on the open plaza, never on water / lava) and the plaza stays connected', () => {
    for (const [i, j] of sectBlockedTiles(N)) expect(zoneRows[j]![i], `${i},${j}`).toBe('.');
    for (const b of SECT_BUILDINGS) expect(zoneRows[sectOrigin(N).j + b.dj]![sectOrigin(N).i + b.di], b.name).toBe('.');
    // from the centre every side of the plaza is still reachable: breadth-first over walkable tiles reaches the field distance
    const rows = blockSectBuildings(zoneRows);
    const c = sectOrigin(N);
    const target = fieldBandStart(N) + 2;
    const seen = new Set<number>([c.j * N + c.i]);
    const queue: Array<[number, number]> = [[c.i, c.j]];
    const sides = new Set<string>();
    while (queue.length) {
      const [i, j] = queue.shift()!;
      const d = Math.max(Math.abs(i - c.i), Math.abs(j - c.j));
      if (d >= target) sides.add(Math.abs(i - c.i) >= Math.abs(j - c.j) ? (i > c.i ? 'E' : 'W') : j > c.j ? 'S' : 'N');
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const a = i + di;
        const b = j + dj;
        if (a < 0 || b < 0 || a >= N || b >= N || rows[b]![a] !== '.' || seen.has(b * N + a)) continue;
        seen.add(b * N + a);
        queue.push([a, b]);
      }
    }
    expect([...sides].sort()).toEqual(['E', 'N', 'S', 'W']);
  });

  it('does not touch a map that is not square, and never changes the input rows', () => {
    const ragged = ['....', '...'];
    expect(blockSectBuildings(ragged)).toEqual(ragged);
    const rows = openRows(64);
    const before = rows.join('\n');
    const out = blockSectBuildings(rows);
    expect(rows.join('\n')).toBe(before);
    expect(out.join('\n')).not.toBe(before);
  });
});
