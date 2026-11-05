import { describe, expect, it } from 'vitest';
import { DIRECTIONS, DIRECTION_TILE_VECTORS, tileToScreen, type Direction } from '@vgtd/shared';
import {
  directionDistance,
  directionFromScreenVector,
  directionFromTileVector,
  getDirectionPolicy,
  mirrorPoint,
  mirrorX,
  resolveDirection,
  type EntityKind,
} from '../src/index.js';

describe('direction policy', () => {
  it.each<EntityKind>(['player', 'boss', 'mob', 'npc', 'pet'])(
    '%s draws S, SE, E, NE, N and mirrors SW, W, NW',
    (kind) => {
      const p = getDirectionPolicy(kind, '1x1');
      expect(p.scheme).toBe('five_mirror');
      expect(p.drawn).toEqual(['S', 'SE', 'E', 'NE', 'N']);
      expect(p.mirrored).toEqual({ SW: 'SE', W: 'E', NW: 'NE' });
    },
  );

  it('only Spine Player/Boss may draw asymmetric animations in 8', () => {
    expect(getDirectionPolicy('player').allowFullEight).toBe(true);
    expect(getDirectionPolicy('boss', '4x4').allowFullEight).toBe(true);
    for (const k of ['mob', 'npc', 'pet'] as const) expect(getDirectionPolicy(k).allowFullEight).toBe(false);
  });

  it('8x8 pieced boss has 1–3 directions', () => {
    const p = getDirectionPolicy('boss', '8x8');
    expect(p.scheme).toBe('parts_1_3');
    expect(p.partsDirectionRange).toEqual({ min: 1, max: 3 });
  });
});

describe('resolveDirection', () => {
  it('drawn directions play as-is', () => {
    for (const d of ['S', 'SE', 'E', 'NE', 'N'] as Direction[]) {
      expect(resolveDirection('player', d)).toEqual({ direction: d, drawn: d, mirrored: false, scaleX: 1 });
    }
  });
  it('SW/W/NW reuse SE/E/NE with scaleX = −1', () => {
    expect(resolveDirection('mob', 'SW')).toEqual({ direction: 'SW', drawn: 'SE', mirrored: true, scaleX: -1 });
    expect(resolveDirection('npc', 'W')).toEqual({ direction: 'W', drawn: 'E', mirrored: true, scaleX: -1 });
    expect(resolveDirection('boss', 'NW', { footprint: '4x4' })).toEqual({
      direction: 'NW',
      drawn: 'NE',
      mirrored: true,
      scaleX: -1,
    });
  });
  it('animations drawn in 8 skip the mirror for Player/Boss only', () => {
    expect(resolveDirection('player', 'W', { drawnInEight: true })).toEqual({
      direction: 'W',
      drawn: 'W',
      mirrored: false,
      scaleX: 1,
    });
    expect(() => resolveDirection('mob', 'W', { drawnInEight: true })).toThrow();
    expect(() => resolveDirection('pet', 'W', { drawnInEight: true })).toThrow();
  });
  it('pieced boss snaps to the nearest available direction', () => {
    expect(resolveDirection('boss', 'NW', { footprint: '8x8', available: ['S'] }).drawn).toBe('S');
    expect(resolveDirection('boss', 'NE', { footprint: '8x8', available: ['S', 'E', 'N'] }).drawn).toBe('E');
    expect(() => resolveDirection('boss', 'S', { footprint: '8x8', available: [] })).toThrow(RangeError);
    expect(() => resolveDirection('boss', 'S', { footprint: '8x8', available: ['S', 'E', 'N', 'W'] })).toThrow(
      RangeError,
    );
  });
  it('directionDistance is circular', () => {
    expect(directionDistance('S', 'SW')).toBe(1);
    expect(directionDistance('S', 'N')).toBe(4);
    expect(directionDistance('SW', 'SE')).toBe(2);
  });
});

describe('mirror transform', () => {
  it('flips only x', () => {
    expect(mirrorX(-18, true)).toBe(18);
    expect(mirrorX(-18, false)).toBe(-18);
    expect(mirrorPoint({ x: 18, y: 52 }, true)).toEqual({ x: -18, y: 52 });
  });
});

describe('direction from movement vector', () => {
  it('maps the shared tile vectors to their own direction', () => {
    for (const d of DIRECTIONS) {
      const [di, dj] = DIRECTION_TILE_VECTORS[d];
      expect(directionFromTileVector(di, dj)).toBe(d);
      expect(directionFromTileVector(di * 3.7, dj * 3.7)).toBe(d);
    }
  });
  it('screen vectors of the projected steps give the same direction (y down)', () => {
    for (const d of DIRECTIONS) {
      const [di, dj] = DIRECTION_TILE_VECTORS[d];
      const a = tileToScreen(0, 0);
      const b = tileToScreen(di, dj);
      expect(directionFromScreenVector(b.x - a.x, b.y - a.y)).toBe(d);
    }
    expect(directionFromScreenVector(0, 10)).toBe('S'); // down on screen
    expect(directionFromScreenVector(0, -10)).toBe('N');
    expect(directionFromScreenVector(10, 0)).toBe('E');
    expect(directionFromScreenVector(-10, 0)).toBe('W');
  });
  it('zero vector keeps the fallback', () => {
    expect(directionFromTileVector(0, 0, 'NE')).toBe('NE');
    expect(directionFromScreenVector(0, 0)).toBe('S');
  });
  it('slightly off-axis input snaps to the nearest 45° sector', () => {
    expect(directionFromTileVector(1, 0.2)).toBe('SE');
    expect(directionFromTileVector(1, -0.2)).toBe('SE'.replace('SE', 'E') === 'E' ? 'SE' : 'E');
  });
});
