import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateRigSet, KIEMTU_REQUIRED_ROLES, exportDragonBones } from '@vgtd/rig';

const root = new URL('../../../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const set = json('tools/rig/data/kiem-tu.rig.json');
const idle = json('tools/rig/data/kiem-tu.idle.json');
const assets = json('tools/rig/data/kiem-tu.assets.json');

describe('Committed Kiếm tu art data through the public rig toolkit', () => {
  it('validates the full RigSet and animation roles against the canonical schema', () => {
    expect(validateRigSet(set, { requireRoles: KIEMTU_REQUIRED_ROLES })).toEqual([]);
    for (const rig of Object.values(set.rigs)) {
      expect(rig.ik.map((constraint) => constraint.name)).toEqual(
        expect.arrayContaining(['ik_leg_L', 'ik_leg_R']),
      );
    }
  });

  it('exports every real atlas, weighted skin, fallback skin and idle without writing runtime output', () => {
    for (const [direction, rig] of Object.entries(set.rigs)) {
      const atlas = json(assets.directions[direction].atlas);
      const result = exportDragonBones([{ rig, clips: [idle] }], atlas, { name: rig.id });
      const armature = result.ske.armature[0];
      expect(result.ske.version).toBe('5.5');
      expect(result.tex.premultipliedAlpha).toBe(true);
      expect(result.tex.width).toBe(512);
      expect(armature.bone).toHaveLength(rig.bones.length);
      expect(armature.slot).toHaveLength(rig.slots.length);
      expect(armature.ik).toHaveLength(4);
      // DragonBones encodes its default skin with the empty name.
      expect(armature.skin.map((skin) => skin.name)).toEqual(['', 'bones-only']);
      const displays = armature.skin[0].slot.flatMap((slot) => slot.display).filter(Boolean);
      expect(displays.length).toBeGreaterThan(0);
      expect(displays.every((display) => display.type === 'mesh' && display.weights.length > 0)).toBe(true);
      expect(armature.animation[0]).toMatchObject({ name: 'idle', duration: 60, playTimes: 0 });
    }
  });
});
