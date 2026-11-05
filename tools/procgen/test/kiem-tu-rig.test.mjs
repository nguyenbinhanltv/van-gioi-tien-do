import { describe, it, expect } from 'vitest';
import { DRAWN_DIRECTIONS, DIRECTIONS } from '@vgtd/shared';
import { getCharacterViewState, SLOT_IDS, SPINE_SLOT_IDS } from '@vgtd/character';
import {
  boneRig,
  makeSkeleton,
  validateSkeleton,
  animatedWorld,
  idleAnimation,
  PIVOT,
} from '../scripts/kiem_tu_rig.mjs';
import { separateParts, alphaBounds, renderPose } from '../scripts/kiem_tu_rig.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js');
function fixture(direction) {
  const parts = [{ name: 'sword', slot: 'weapon_R', bone: 'weapon', box: { x: 35, y: 120, w: 28, h: 94 } }];
  const atlas = { pages: [{ width: 128, height: 128 }], frames: { sword: { x: 3, y: 3, w: 28, h: 94 } } };
  return makeSkeleton(direction, parts, atlas);
}
describe('Spine 4.2 handoff', () => {
  it('keeps exact API slot order without introducing helper slots', () => {
    for (const direction of DRAWN_DIRECTIONS) {
      const data = fixture(direction);
      expect(validateSkeleton(data, direction).slots).toBe(SPINE_SLOT_IDS.length);
      expect(data.slots.map((s) => s.name)).toEqual(
        getCharacterViewState({ kind: 'player', direction, animation: 'idle', equipped: SLOT_IDS }).slotOrder,
      );
    }
    for (const direction of DIRECTIONS) {
      const state = getCharacterViewState({
        kind: 'player',
        direction,
        animation: 'idle',
        equipped: SLOT_IDS,
        drawnInEight: false,
      });
      expect(DRAWN_DIRECTIONS).toContain(state.skeletonDirection);
      expect(state.slotOrder).toHaveLength(SPINE_SLOT_IDS.length);
    }
  });
  it('round trips weighted sword vertices from bone-local space to pivot space', () => {
    for (const direction of DRAWN_DIRECTIONS) {
      const data = fixture(direction),
        world = animatedWorld(data, 0),
        mesh = data.skins[0].attachments.weapon_R.weapon_R;
      const expected = [
        [35, 120],
        [63, 120],
        [63, 214],
        [35, 214],
      ];
      for (let n = 0; n < 4; n++) {
        const i = n * 5,
          bone = data.bones[mesh.vertices[i + 1]],
          p = world[bone.name],
          angle = (p.rotation * Math.PI) / 180;
        const x = mesh.vertices[i + 2],
          y = mesh.vertices[i + 3];
        expect(p.x + x * Math.cos(angle) - y * Math.sin(angle)).toBeCloseTo(expected[n][0] / 2 - PIVOT[0], 3);
        expect(p.y + x * Math.sin(angle) + y * Math.cos(angle)).toBeCloseTo(PIVOT[1] - expected[n][1] / 2, 3);
      }
      expect(data.bones.find((b) => b.name === 'weapon').parent).toBe('hand_R');
    }
  });
  it('loops idle and keeps planted feet fixed while secondary chains move', () => {
    const data = fixture('S'),
      start = animatedWorld(data, 0),
      mid = animatedWorld(data, 0.5),
      end = animatedWorld(data, 2);
    expect(end).toEqual(start);
    expect(mid.foot_R).toEqual(start.foot_R);
    expect(mid.foot_L).toEqual(start.foot_L);
    expect(mid.ribbon_2.rotation).not.toBe(start.ribbon_2.rotation);
    expect(mid.chest.y).toBeGreaterThan(start.chest.y);
    expect(idleAnimation().bones.hair_back_1.rotate[1]).toHaveProperty('value');
    expect(boneRig('S').bones[0]).toMatchObject({ name: 'root', x: 0, y: 0 });
  });
  it('rejects corrupt triangles and UVs instead of reporting a valid rig', () => {
    const data = fixture('S');
    data.skins[0].attachments.weapon_R.weapon_R.triangles[0] = 999;
    expect(() => validateSkeleton(data, 'S')).toThrow();
    const other = fixture('S');
    other.skins[0].attachments.weapon_R.weapon_R.uvs[0] = 1.1;
    expect(() => validateSkeleton(other, 'S')).toThrow();
  });
  it('keeps hidden joint underpaint from obscuring opaque source pixels at rest', () => {
    const source = new Image(256, 256);
    source.fill(81, 113, 127, 255);
    const parts = separateParts(source, 'S');
    for (const part of parts) part.box = alphaBounds(part.image);
    const recomposed = renderPose(fixture('S'), parts, 0);
    expect(recomposed.data).toEqual(source.data);
  });
});
