import { describe, expect, it } from 'vitest';
import {
  CANVAS_BY_FOOTPRINT,
  COLLIDER_RADIUS_TILES,
  HIT_VOLUMES_BY_FOOTPRINT,
  HURTBOX_RADIUS_TILES,
  PICK_BOX_PX,
} from '../src/index.js';

describe('HIT_VOLUMES_BY_FOOTPRINT (docs/03 §5)', () => {
  it('1x1 reuses the shared singletons', () => {
    expect(HIT_VOLUMES_BY_FOOTPRINT['1x1']).toEqual({
      colliderRadius: COLLIDER_RADIUS_TILES,
      hurtboxRadius: HURTBOX_RADIUS_TILES,
      pickBox: PICK_BOX_PX,
    });
  });
  it('2x2 and 4x4 rows', () => {
    expect(HIT_VOLUMES_BY_FOOTPRINT['2x2']).toEqual({
      colliderRadius: 0.8,
      hurtboxRadius: 0.95,
      pickBox: { width: 120, height: 180 },
    });
    expect(HIT_VOLUMES_BY_FOOTPRINT['4x4']).toEqual({
      colliderRadius: 1.7,
      hurtboxRadius: 1.9,
      pickBox: { width: 240, height: 340 },
    });
  });
  it('canvas sizes of the boss footprints', () => {
    expect([CANVAS_BY_FOOTPRINT['2x2'], CANVAS_BY_FOOTPRINT['4x4']]).toEqual([256, 512]);
  });
});
