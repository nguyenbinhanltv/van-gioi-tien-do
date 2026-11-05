import { describe, it, expect } from 'vitest';
import { DRAWN_DIRECTIONS, DIRECTIONS } from '@vgtd/shared';
import { getCharacterViewState, SLOT_IDS, SPINE_SLOT_IDS } from '@vgtd/character';
import { createRequire } from 'node:module';
import {
  boneRig,
  makeRigDocument,
  validateRigDocument,
  animatedWorld,
  idleClip,
  PIVOT,
  separateParts,
  alphaBounds,
  renderPose,
} from '../scripts/kiem_tu_rig.mjs';
const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js');
function fixture(direction) {
  const box = { x: 35, y: 120, w: 28, h: 94 },
    parts = [{ name: 'sword', slot: 'weapon_R', bone: 'weapon', box }];
  const atlas = {
    pages: [{ width: 128, height: 128 }],
    frames: { sword: { x: 3, y: 3, w: 28, h: 94 }, slot_weapon_R: { x: 3, y: 3, w: 28, h: 94 } },
  };
  return makeRigDocument(direction, parts, atlas, [{ name: 'weapon_R', box }]);
}
describe('Neutral Kiếm tu rig data', () => {
  it('keeps exact API paperdoll order and no helper slots', () => {
    for (const direction of DRAWN_DIRECTIONS) {
      const rig = fixture(direction);
      expect(rig.format).toBe('vgtd-rig');
      expect(validateRigDocument(rig).slots).toBe(SPINE_SLOT_IDS.length);
      expect(rig.slots.map((s) => s.paperdoll)).toEqual(
        getCharacterViewState({ kind: 'player', direction, animation: 'idle', equipped: SLOT_IDS }).slotOrder,
      );
      expect(rig.bones[0]).toMatchObject({ name: 'root', parent: null, x: 0, y: 0 });
    }
    for (const direction of DIRECTIONS)
      expect(DRAWN_DIRECTIONS).toContain(
        getCharacterViewState({ kind: 'player', direction, animation: 'idle', equipped: SLOT_IDS, drawnInEight: false })
          .skeletonDirection,
      );
  });
  it('round trips slot-local mesh vertices while preserving named bone weights', () => {
    for (const direction of DRAWN_DIRECTIONS) {
      const rig = fixture(direction),
        world = animatedWorld(rig, 0),
        mesh = rig.skins[0].attachments.weapon_R.weapon_R,
        slot = rig.slots.find((s) => s.name === 'weapon_R'),
        p = world[slot.bone],
        angle = (p.rotation * Math.PI) / 180;
      const expected = [
        [35, 120],
        [63, 120],
        [63, 214],
        [35, 214],
      ];
      for (let n = 0; n < 4; n++) {
        const x = mesh.vertices[n * 2],
          y = mesh.vertices[n * 2 + 1];
        expect(p.x + x * Math.cos(angle) - y * Math.sin(angle)).toBeCloseTo(expected[n][0] / 2 - PIVOT[0], 3);
        expect(p.y + x * Math.sin(angle) + y * Math.cos(angle)).toBeCloseTo(PIVOT[1] - expected[n][1] / 2, 3);
        expect(mesh.weights[n]).toEqual([['weapon', 1]]);
      }
      expect(rig.bones.find((b) => b.name === 'weapon').parent).toBe('hand_R');
    }
  });
  it('provides independent root IK targets, semantic roles and six valid chains', () => {
    const rig = fixture('S');
    expect(rig.bones).toHaveLength(38);
    expect(rig.ik).toHaveLength(4);
    expect(rig.chains).toHaveLength(6);
    for (const side of ['L', 'R'])
      for (const limb of ['foot', 'hand']) {
        const name = 'ik_' + limb + '_' + side;
        expect(rig.roles[name]).toBe(name);
        expect(rig.bones.find((b) => b.name === name).parent).toBe('root');
      }
    for (const time of [0, 0.5, 1, 2]) {
      const world = animatedWorld(rig, time);
      for (const side of ['L', 'R']) {
        expect(world['ik_hand_' + side].x).toBeCloseTo(world['hand_' + side].x, 3);
        expect(world['ik_hand_' + side].y).toBeCloseTo(world['hand_' + side].y, 3);
      }
    }
  });
  it('loops typed idle keys while keeping feet fixed and moving secondary bones', () => {
    const rig = fixture('S'),
      start = animatedWorld(rig, 0),
      mid = animatedWorld(rig, 0.5),
      end = animatedWorld(rig, 2);
    expect(end).toEqual(start);
    expect(mid.foot_R).toEqual(start.foot_R);
    expect(mid.foot_L).toEqual(start.foot_L);
    expect(mid.ribbon_2.rotation).not.toBe(start.ribbon_2.rotation);
    expect(mid.spine_upper.y).toBeGreaterThan(start.spine_upper.y);
    const clip = idleClip();
    expect(clip.frames).toBe(60);
    expect(clip.loop).toBe(true);
    expect(clip.bones[0].translate.every((k) => Number.isInteger(k.frame))).toBe(true);
    expect(boneRig('S').world.root).toMatchObject({ x: 0, y: 0 });
  });
  it('ships a region-only fallback and rejects corrupt triangles/UVs', () => {
    const fallback = fixture('S').skins.find((s) => s.name === 'bones-only');
    expect(fallback.attachments.weapon_R.weapon_R).toMatchObject({
      type: 'region',
      path: 'slot_weapon_R',
      width: 14,
      height: 47,
    });
    const bad = fixture('S');
    bad.skins[0].attachments.weapon_R.weapon_R.triangles[0] = 999;
    expect(() => validateRigDocument(bad)).toThrow();
    const other = fixture('S');
    other.skins[0].attachments.weapon_R.weapon_R.uvs[0] = 1.1;
    expect(() => validateRigDocument(other)).toThrow();
  });
  it('does not obscure opaque source pixels with hidden joint underpaint', () => {
    const source = new Image(256, 256);
    source.fill(81, 113, 127, 255);
    const parts = separateParts(source, 'S');
    for (const part of parts) part.box = alphaBounds(part.image);
    expect(renderPose(fixture('S'), parts, 0).data).toEqual(source.data);
  });
});
