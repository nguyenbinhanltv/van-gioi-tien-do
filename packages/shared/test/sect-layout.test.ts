import { describe, expect, it } from 'vitest';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import { SECT_BUILDINGS, fieldBandStart, sectBlockedTiles, sectOrigin } from '../src/index.js';

describe('Son Mon sect layout (D115)', () => {
  it('every building is a sect prop of the art manifest, with the very same footprint (the server blocks what the client draws)', () => {
    const props = manifest.props as Record<string, { block: number[][]; biomes: string[]; weight: number }>;
    for (const b of SECT_BUILDINGS) {
      const def = props[b.name];
      expect(def, b.name).toBeDefined();
      expect(def!.block, b.name).toEqual(b.block.map((x) => [...x]));
      // placed by this layout only: never scattered
      expect(def!.biomes, b.name).toEqual([]);
      expect(def!.weight, b.name).toBe(0);
    }
    // all nine exported sect props are used
    const used = new Set(SECT_BUILDINGS.map((b) => b.name));
    expect([...used].sort()).toEqual(
      [
        'sect_alchemy_furnace',
        'sect_banner',
        'sect_contribution_board',
        'sect_forge_anvil',
        'sect_gate',
        'sect_lantern_post',
        'sect_main_hall',
        'sect_scripture_pavilion',
        'sect_training_dummy',
      ].sort(),
    );
  });

  it('origin is the centre tile; offsets keep every footprint inside the open plaza of a 256 map, outside the spawn clear radius and off the gate approach', () => {
    expect(sectOrigin(256)).toEqual({ i: 128, j: 128 });
    expect(sectOrigin(255)).toEqual({ i: 127, j: 127 });
    const plaza = fieldBandStart(256) + 4; // the D95 dirt plaza: D83 normal-band start + plazaMarginTiles
    const seen = new Set<string>();
    for (const b of SECT_BUILDINGS) {
      for (const [bi, bj] of [[0, 0], ...b.block] as Array<[number, number]>) {
        const di = b.di + bi;
        const dj = b.dj + bj;
        expect(Math.max(Math.abs(di), Math.abs(dj)), `${b.name} ${di},${dj}`).toBeLessThan(plaza);
        expect(Math.max(Math.abs(di), Math.abs(dj)), `${b.name} ${di},${dj} spawn clear`).toBeGreaterThan(6);
        // the approach corridor of the courtyard gate: |di - dj| <= 1 along screen-up for k = 3..12
        const k = -Math.min(di, dj);
        if (di <= -3 && dj <= -3 && k <= 13)
          expect(Math.abs(di - dj), `${b.name} ${di},${dj} corridor`).toBeGreaterThan(1);
      }
      // blocked tiles never overlap another building
      for (const [bi, bj] of b.block) {
        const key = `${b.di + bi},${b.dj + bj}`;
        expect(seen.has(key), `${b.name} overlaps at ${key}`).toBe(false);
        seen.add(key);
      }
    }
  });

  it('blocked tiles: exact count, inside the map, unique, and what a smaller map cannot hold is dropped', () => {
    const total = SECT_BUILDINGS.reduce((n, b) => n + b.block.length, 0);
    const tiles = sectBlockedTiles(256);
    expect(tiles).toHaveLength(total);
    expect(new Set(tiles.map(([i, j]) => `${i},${j}`)).size).toBe(tiles.length);
    for (const [i, j] of tiles) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(256);
    }
    // the main hall (3 x 3) around origin + (-17, -17)
    expect(tiles).toContainEqual([128 - 17, 128 - 17]);
    expect(tiles).toContainEqual([128 - 18, 128 - 16]);
    // a 32-tile map cannot hold buildings 17 tiles out on every side: whatever lies outside is dropped, nothing throws
    for (const [i, j] of sectBlockedTiles(32)) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(32);
      expect(j).toBeGreaterThanOrEqual(0);
      expect(j).toBeLessThan(32);
    }
  });
});
