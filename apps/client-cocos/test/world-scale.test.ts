import { describe, it, expect } from 'vitest';
import {
  CHIBI_MASTER_PX,
  MOB_HEIGHT_TILES,
  MOB_WIDTH_OVERHANG_TILES,
  NPC_HEIGHT_TILES,
  PLAYER_HEIGHT_TILES,
  PROP_HEIGHT_TILES,
  chibiScale,
  mobHeightTiles,
  mobScale,
  propScale,
  scaleForHeight,
} from '../assets/scripts/WorldScale';

const TILE = 64; // the test tile width; the client passes shared.TILE_WIDTH

describe('world scale table (D123)', () => {
  it('orders the heights player < elite < boss and keeps normal mobs near the player', () => {
    expect(mobHeightTiles('normal', 1)).toBeLessThan(PLAYER_HEIGHT_TILES + 0.01);
    expect(mobHeightTiles('elite', 1)).toBeGreaterThan(PLAYER_HEIGHT_TILES);
    expect(mobHeightTiles('boss', 2)).toBe(MOB_HEIGHT_TILES.boss2);
    expect(mobHeightTiles('boss', 4)).toBe(MOB_HEIGHT_TILES.boss4);
    expect(MOB_HEIGHT_TILES.boss4).toBeGreaterThanOrEqual(MOB_HEIGHT_TILES.boss2);
    expect(NPC_HEIGHT_TILES).toBe(PLAYER_HEIGHT_TILES);
  });

  it('chibi scale makes the master art stand at the player height', () => {
    expect(chibiScale(TILE) * CHIBI_MASTER_PX).toBeCloseTo(PLAYER_HEIGHT_TILES * TILE, 6);
  });

  it('fits a sprite to its target height regardless of the art size', () => {
    expect(scaleForHeight(2, 256, TILE) * 256).toBeCloseTo(128, 6);
    expect(mobScale('normal', 1, { w: 100, h: 128 }, TILE) * 128).toBeCloseTo(MOB_HEIGHT_TILES.normal * TILE, 6);
    // a 512 px boss art no longer renders 512 px tall
    expect(mobScale('boss', 4, { w: 400, h: 512 }, TILE) * 512).toBeLessThanOrEqual(
      MOB_HEIGHT_TILES.boss4 * TILE + 1e-6,
    );
  });

  it('caps a very wide mob by its footprint allowance', () => {
    const s = mobScale('normal', 1, { w: 300, h: 100 }, TILE);
    expect(s * 300).toBeCloseTo((1 + MOB_WIDTH_OVERHANG_TILES) * TILE, 6);
  });

  it('leaves props without an entry at their art size', () => {
    expect(propScale('tree_pine_01', 230, TILE)).toBe(1);
    const name = Object.keys(PROP_HEIGHT_TILES)[0]!;
    expect(propScale(name, 200, TILE) * 200).toBeCloseTo(PROP_HEIGHT_TILES[name]! * TILE, 6);
  });
});
