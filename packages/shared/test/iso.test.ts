import { describe, expect, it } from 'vitest';
import {
  AOI,
  BUDGETS,
  CHUNK_PX_HEIGHT,
  CHUNK_PX_WIDTH,
  DIRECTIONS,
  DIRECTION_TILE_VECTORS,
  DRAWN_DIRECTIONS,
  HEIGHT_LEVEL_PX,
  Layer,
  LAYER_NAMES,
  MIRRORED_DIRECTIONS,
  NETWORK,
  QUALITY_TIERS,
  TILE_HEIGHT,
  TILE_WIDTH,
  aoiCell,
  aoiCentre,
  bossSortY,
  chunkKey,
  chunkOf,
  chunkScreenRect,
  chunksAround,
  cliffFaceGroup,
  compareDrawOrder,
  footprintSortY,
  inAoi,
  localInChunk,
  parseChunkKey,
  pivotSortY,
  screenToTile,
  screenToTileCell,
  sortKey,
  tileCenterToScreen,
  tileToScreen,
  toUW,
  fromUW,
  type Sortable,
} from '../src/index.js';

describe('constants (Hồ sơ §3)', () => {
  it('grid, chunk, layers, directions, tiers', () => {
    expect([TILE_WIDTH, TILE_HEIGHT]).toEqual([64, 32]);
    expect([CHUNK_PX_WIDTH, CHUNK_PX_HEIGHT]).toEqual([2048, 1024]);
    expect(HEIGHT_LEVEL_PX).toBe(32);
    expect(LAYER_NAMES).toHaveLength(8);
    expect(Layer.L3_YSORT).toBe(3);
    expect(DIRECTIONS).toHaveLength(8);
    expect(DRAWN_DIRECTIONS).toHaveLength(5);
    expect(MIRRORED_DIRECTIONS).toEqual({ SW: 'SE', W: 'E', NW: 'NE' });
    expect(QUALITY_TIERS.map((t) => t.name)).toEqual(['Trắng', 'Lục', 'Lam', 'Tím', 'Vàng', 'Đỏ']);
  });
  it('network, AOI, budgets', () => {
    expect([NETWORK.TICK_HZ, NETWORK.AOI_HZ]).toEqual([20, 10]);
    expect(NETWORK.INPUT_HZ_PC).toBe(30);
    expect(NETWORK.LAG_COMP_MAX_MS).toBe(200);
    expect([AOI.HALF_U, AOI.HALF_W]).toEqual([40, 45]);
    expect(Math.round(AOI.HALF_U * AOI.EXIT_FACTOR)).toBe(AOI.EXIT_HALF_U); // 46
    expect(Math.round(AOI.HALF_W * AOI.EXIT_FACTOR)).toBe(AOI.EXIT_HALF_W); // 52
    expect(BUDGETS.INITIAL_DOWNLOAD_MB_WEB).toBe(25);
    expect(BUDGETS.DRAW_CALLS_WEB_MOBILE).toBe(80);
  });
  it('direction vectors project to the right screen quadrants', () => {
    for (const d of DIRECTIONS) {
      const [di, dj] = DIRECTION_TILE_VECTORS[d];
      const p = tileToScreen(di, dj);
      if (d === 'S') expect(p.y).toBe(32);
      if (d === 'N') expect(p.y).toBe(-32);
      if (d === 'E') expect(p.x).toBeGreaterThan(0);
      if (d === 'W') expect(p.x).toBeLessThan(0);
    }
    expect(tileToScreen(...DIRECTION_TILE_VECTORS.E)).toEqual({ x: 64, y: 0 });
  });
});

describe('iso projection', () => {
  it('x = (i−j)·32, y = (i+j)·16', () => {
    expect(tileToScreen(0, 0)).toEqual({ x: 0, y: 0 });
    expect(tileToScreen(1, 0)).toEqual({ x: 32, y: 16 });
    expect(tileToScreen(0, 1)).toEqual({ x: -32, y: 16 });
    expect(tileToScreen(5, 3)).toEqual({ x: 64, y: 128 });
    expect(tileCenterToScreen(0, 0)).toEqual({ x: 0, y: 16 });
  });
  it('elevation lifts the image 32 px per level', () => {
    expect(tileToScreen(2, 2, 1).y).toBe(tileToScreen(2, 2).y - 32);
    expect(screenToTile(tileToScreen(7, 4, 3).x, tileToScreen(7, 4, 3).y, 3)).toEqual({ i: 7, j: 4 });
  });
  it('screenToTile is the inverse of tileToScreen (round trip)', () => {
    for (const [i, j] of [
      [0, 0],
      [10, 3],
      [-4, 9],
      [31.5, 0.25],
      [100, 100],
    ] as const) {
      const p = tileToScreen(i, j);
      const t = screenToTile(p.x, p.y);
      expect(t.i).toBeCloseTo(i, 10);
      expect(t.j).toBeCloseTo(j, 10);
    }
  });
  it('screenToTileCell: tile centre maps back to its own cell', () => {
    for (const [i, j] of [
      [0, 0],
      [3, 8],
      [-2, 5],
      [40, 40],
    ] as const) {
      const c = tileCenterToScreen(i, j);
      expect(screenToTileCell(c.x, c.y)).toEqual({ i, j });
    }
  });
  it('u/w conversion', () => {
    expect(toUW(10, 4)).toEqual({ u: 6, w: 14 });
    expect(fromUW(6, 14)).toEqual({ i: 10, j: 4 });
  });
});

describe('chunks', () => {
  it('chunk index = floor(i/32), floor(j/32) incl. negatives', () => {
    expect(chunkOf(0, 0)).toEqual({ ci: 0, cj: 0 });
    expect(chunkOf(31, 32)).toEqual({ ci: 0, cj: 1 });
    expect(chunkOf(-1, -32)).toEqual({ ci: -1, cj: -1 });
    expect(chunkOf(-33, 0)).toEqual({ ci: -2, cj: 0 });
  });
  it('local coordinates and keys', () => {
    expect(localInChunk(33, 31)).toEqual({ i: 1, j: 31 });
    expect(localInChunk(-1, -32)).toEqual({ i: 31, j: 0 });
    expect(parseChunkKey(chunkKey(-3, 7))).toEqual({ ci: -3, cj: 7 });
    expect(() => parseChunkKey('a,b')).toThrow();
  });
  it('chunk screen rect is always 2048 × 1024 and tiles of the chunk fit inside', () => {
    for (const [ci, cj] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [-2, 3],
    ] as const) {
      const r = chunkScreenRect(ci, cj);
      expect([r.width, r.height]).toEqual([2048, 1024]);
      for (const [li, lj] of [
        [0, 0],
        [31, 0],
        [0, 31],
        [31, 31],
      ] as const) {
        const p = tileToScreen(ci * 32 + li, cj * 32 + lj);
        expect(p.x).toBeGreaterThanOrEqual(r.x);
        expect(p.x).toBeLessThanOrEqual(r.x + r.width);
        expect(p.y).toBeGreaterThanOrEqual(r.y);
        expect(p.y).toBeLessThanOrEqual(r.y + r.height);
      }
    }
  });
  it('streaming windows 3×3 / 5×5 / 7×7', () => {
    expect(chunksAround({ ci: 0, cj: 0 }, 1)).toHaveLength(9);
    expect(chunksAround({ ci: 0, cj: 0 }, 2)).toHaveLength(25);
    expect(chunksAround({ ci: 4, cj: 4 }, 3)).toHaveLength(49);
  });
});

describe('AOI', () => {
  it('hash cell = (floor(u/16), floor(w/16))', () => {
    expect(aoiCell(0, 0)).toEqual({ cu: 0, cw: 0 });
    expect(aoiCell(20, 0)).toEqual({ cu: 1, cw: 1 });
    expect(aoiCell(0, 20)).toEqual({ cu: -2, cw: 1 });
  });
  it('|u−u0| ≤ 40 and |w−w0| ≤ 45; exit 46/52', () => {
    const c = { i: 100, j: 100 }; // u0 = 0, w0 = 200
    const at = (u: number, w: number) => fromUW(u, w);
    expect(inAoi(at(40, 245), c)).toBe(true);
    expect(inAoi(at(41, 200), c)).toBe(false);
    expect(inAoi(at(0, 246), c)).toBe(false);
    expect(inAoi(at(41, 246), c, true)).toBe(true);
    expect(inAoi(at(47, 200), c, true)).toBe(false);
    expect(inAoi(at(0, 253), c, true)).toBe(false);
  });
  it('flight shifts the AOI centre by v × 0.5 s', () => {
    expect(aoiCentre({ i: 10, j: 10 }, { i: 18, j: 0 }, true)).toEqual({ i: 19, j: 10 });
    expect(aoiCentre({ i: 10, j: 10 }, { i: 18, j: 0 }, false)).toEqual({ i: 10, j: 10 });
  });
});

describe('Y-sort', () => {
  const s = (group: number, sortY: number, x: number, id: number): Sortable => ({ group, sortY, x, id });
  it('sort key = ground Y of pivot, unaffected by jump height', () => {
    expect(pivotSortY(5, 3)).toBe(128);
  });
  it('multi-tile footprint uses the S vertex: sortY = (i0+w+j0+h)·16', () => {
    expect(footprintSortY(10, 10, 3, 2)).toBe((10 + 3 + 10 + 2) * 16);
    expect(footprintSortY(0, 0, 1, 1)).toBe(32);
  });
  it('boss n×n: sortY = y_centre + n·16 (== S vertex of the footprint)', () => {
    for (const n of [2, 4, 8]) {
      const i0 = 5;
      const j0 = 9;
      const centreY = (i0 + n / 2 + (j0 + n / 2)) * 16;
      expect(bossSortY(centreY, n)).toBe(footprintSortY(i0, j0, n, n));
    }
  });
  it('draw order: elevation group, then Y, then X, then id', () => {
    const list = [s(1, 0, 0, 1), s(0, 100, 5, 2), s(0, 100, 5, 1), s(0, 100, -5, 9), s(0, 50, 0, 3)];
    list.sort(compareDrawOrder);
    expect(list.map((e) => e.id)).toEqual([3, 9, 1, 2, 1]);
    expect(list[4]!.group).toBe(1);
  });
  it('cliff faces belong to the lower elevation group', () => {
    expect(cliffFaceGroup(1)).toBe(0);
    expect(cliffFaceGroup(4)).toBe(3);
    expect(cliffFaceGroup(0)).toBe(0);
  });
  it('numeric sortKey is group-major', () => {
    expect(sortKey(1, 0)).toBeGreaterThan(sortKey(0, 100_000));
    expect(sortKey(0, 20)).toBeLessThan(sortKey(0, 21));
  });
});
