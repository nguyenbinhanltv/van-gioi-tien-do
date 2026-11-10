/**
 * Player spawn / respawn only on ground the player can stand on and walk away from (D95 follow-up): the default 96-tile spawn square of a
 * 256-tile map reaches the water and lava of the zone map (e.g. tile 131,80), so a joining player could appear inside a blocked tile.
 */
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { COLLIDER_RADIUS_TILES, rngFork, rngFloat, rngSeed } from '@vgtd/shared';
import { TILE_WALKABLE, TileGrid, circleBlocked } from '@vgtd/sim';
import { WorldNode, type ClientTransport } from '../src/index.js';

const require = createRequire(import.meta.url);
const Gen = require('../../../tools/procgen/src/tilemap/generate_tilemap.js');
const Z = require('../../../tools/procgen/src/tilemap/zones.js');

const N = 256;
/** the real D95 zone map walkability, exactly as `npm run gen:tilemap` writes it to terrain.json */
const o = { ...Gen.parseArgs([]), width: N, height: N };
const zc = Z.generateZoneCorners(o, Gen.zoneFields(o));
const rows: string[] = Gen.buildZoneMap(o, zc, new Proxy({}, { get: () => 1 })).rows;
const grid = TileGrid.fromRows(rows);
const walk = (i: number, j: number): boolean => (grid.flags(i, j) & TILE_WALKABLE) !== 0;

const nullTransport: ClientTransport = { send: () => undefined, close: () => undefined, buffered: () => 0 };

/** independent flood fill from the centre of a square over the walkable tiles of `g` */
function reachableFrom(g: TileGrid, ci: number, cj: number): Uint8Array {
  const seen = new Uint8Array(g.width * g.height);
  const q: number[] = [cj * g.width + ci];
  seen[q[0]!] = 1;
  for (let k = 0; k < q.length; k++) {
    const t = q[k]!;
    const i = t % g.width;
    const j = (t - i) / g.width;
    for (const [di, dj] of [
      [1, 0],
      [-1, 0],
      [0, 1],
      [0, -1],
    ]) {
      const ni = i + di!;
      const nj = j + dj!;
      if (ni < 0 || nj < 0 || ni >= g.width || nj >= g.height || seen[nj * g.width + ni]) continue;
      if ((g.flags(ni, nj) & TILE_WALKABLE) === 0) continue;
      seen[nj * g.width + ni] = 1;
      q.push(nj * g.width + ni);
    }
  }
  return seen;
}
const legacy = (seed: number, side: number, n: number): { i: number; j: number }[] => {
  const i0 = (N - side) / 2;
  let s = rngFork(rngSeed(seed), 'spawn');
  const out: { i: number; j: number }[] = [];
  for (let k = 0; k < n; k++) {
    const [a, r1] = rngFloat(s);
    const [b, r2] = rngFloat(r1);
    s = r2;
    out.push({ i: i0 + a * side, j: i0 + b * side });
  }
  return out;
};
const spawnOf = (n: WorldNode): { i: number; j: number } =>
  (n as unknown as { spawnPoint(): { i: number; j: number } }).spawnPoint();

describe('the real zone map has water and lava inside the default spawn square', () => {
  it('the old spawn rule would have put players in blocked tiles (this test is meaningful)', () => {
    const bad = legacy(1, 96, 2000).filter((p) => !walk(Math.floor(p.i), Math.floor(p.j)));
    expect(bad.length).toBeGreaterThan(20);
  });
});

describe('default spawn on the real zone map (256 tiles, 96-tile square)', () => {
  const reach = reachableFrom(grid, 128, 128);

  it('2000 spawn / respawn points are walkable, reachable from the centre and have room for the body', () => {
    const n = new WorldNode({ mapTiles: N, grid, seed: 1 });
    for (let k = 0; k < 2000; k++) {
      const p = spawnOf(n);
      const ti = Math.floor(p.i);
      const tj = Math.floor(p.j);
      expect(walk(ti, tj), `${p.i},${p.j}`).toBe(true);
      expect(reach[tj * N + ti], `${p.i},${p.j} is cut off from the centre`).toBe(1);
      expect(circleBlocked(grid, p.i, p.j, COLLIDER_RADIUS_TILES, 0)).toBe(false);
      expect(p.i).toBeGreaterThanOrEqual(80);
      expect(p.i).toBeLessThan(176);
      expect(p.j).toBeGreaterThanOrEqual(80);
      expect(p.j).toBeLessThan(176);
    }
  });

  it('players that really join (addPlayer) stand on walkable ground; the tile 131,80 case from the report is covered', () => {
    const n = new WorldNode({ mapTiles: N, grid, seed: 9 });
    for (let k = 0; k < 300; k++) {
      const id = n.addPlayer(nullTransport, `acct${k}`);
      const e = n.world.entities.find((x) => x.id === id)!;
      expect(walk(Math.floor(e.i), Math.floor(e.j))).toBe(true);
      expect(circleBlocked(grid, e.i, e.j, COLLIDER_RADIUS_TILES, 0)).toBe(false);
    }
    expect(walk(131, 80)).toBe(false); // the tile named in the report is blocked on this map
  });

  it('is deterministic: the same seed gives the same spawn sequence', () => {
    const a = new WorldNode({ mapTiles: N, grid, seed: 4 });
    const b = new WorldNode({ mapTiles: N, grid, seed: 4 });
    for (let k = 0; k < 200; k++) expect(spawnOf(a)).toEqual(spawnOf(b));
    const c = new WorldNode({ mapTiles: N, grid, seed: 5 });
    expect(spawnOf(c)).not.toEqual(spawnOf(new WorldNode({ mapTiles: N, grid, seed: 4 })));
  });
});

describe('dev spawn (24-tile square) and open maps behave exactly as before', () => {
  it('an open map: the spawn stream is the old formula, draw for draw', () => {
    const n = new WorldNode({ mapTiles: N, seed: 3 });
    const want = legacy(3, 96, 50);
    for (const p of want) expect(spawnOf(n)).toEqual(p);
  });

  it('SPAWN_SIDE=24 at the centre of the real map: always walkable; identical to the old stream when the square is all land', () => {
    const side = 24;
    const i0 = (N - side) / 2;
    const n = new WorldNode({ mapTiles: N, grid, seed: 3, spawn: { i0, j0: i0, side } });
    let allLand = true;
    for (let j = i0; j < i0 + side; j++)
      for (let i = i0; i < i0 + side; i++)
        if (!walk(i, j) || circleBlocked(grid, i + 0.5, j + 0.5, COLLIDER_RADIUS_TILES, 0)) allLand = false;
    const want = legacy(3, side, 40);
    for (const p of want) {
      const got = spawnOf(n);
      expect(walk(Math.floor(got.i), Math.floor(got.j))).toBe(true);
      if (allLand) expect(got).toEqual(p);
    }
    expect(allLand).toBe(true); // the plaza of the real map is open ground: the dev behaviour is unchanged
  });
});

describe('odd spawn squares', () => {
  const small = (rowsOf: string[]): TileGrid => TileGrid.fromRows(rowsOf);

  it('an island of land inside the square that is cut off from the centre is never used', () => {
    // 20x20: land everywhere except a water ring around a 4x4 island in the top-left corner of the square
    const R: string[] = [];
    for (let j = 0; j < 20; j++) {
      let row = '';
      for (let i = 0; i < 20; i++) {
        const ring = i >= 1 && i <= 6 && j >= 1 && j <= 6 && (i === 1 || i === 6 || j === 1 || j === 6);
        row += ring ? '#' : '.';
      }
      R.push(row);
    }
    const g = small(R);
    const n = new WorldNode({ mapTiles: 20, grid: g, seed: 2, spawn: { i0: 0, j0: 0, side: 20 } });
    for (let k = 0; k < 1000; k++) {
      const p = spawnOf(n);
      const inIsland = p.i >= 2 && p.i < 6 && p.j >= 2 && p.j < 6;
      expect(inIsland, `${p.i},${p.j}`).toBe(false);
      expect((g.flags(Math.floor(p.i), Math.floor(p.j)) & TILE_WALKABLE) !== 0).toBe(true);
    }
  });

  it('a square that is all water falls back to the nearest walkable tile instead of spawning in water', () => {
    const R: string[] = [];
    for (let j = 0; j < 20; j++) R.push(j >= 5 && j < 15 ? '.....##########.....' : '....................');
    const g = small(R);
    const n = new WorldNode({ mapTiles: 20, grid: g, seed: 2, spawn: { i0: 5, j0: 5, side: 10 } });
    for (let k = 0; k < 20; k++) {
      const p = spawnOf(n);
      expect((g.flags(Math.floor(p.i), Math.floor(p.j)) & TILE_WALKABLE) !== 0).toBe(true);
    }
  });
});
