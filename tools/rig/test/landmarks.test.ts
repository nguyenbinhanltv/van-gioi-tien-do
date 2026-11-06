import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { applyLandmarks, evalPose, landmarkToRig, loadCharacterData, type Landmarks } from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const view = { scale: 2, pivot: [64, 116] as const };

/** The E landmarks of docs/art/rig-continuous-parts.md §2 (target values handed to art). */
const E: Landmarks = {
  neck: [118, 78],
  head: [124, 55],
  shoulder_R: [120, 86],
  elbow_R: [120, 112],
  wrist_R: [128, 138],
  shoulder_L: [112, 86],
  elbow_L: [110, 110],
  wrist_L: [116, 134],
  hip_R: [110, 139],
  knee_R: [109, 185],
  ankle_R: [108, 223],
  foot_tip_R: [120, 232],
  hip_L: [126, 139],
  knee_L: [127, 185],
  ankle_L: [128, 223],
  foot_tip_L: [140, 232],
};

describe('applyLandmarks', () => {
  const data = loadCharacterData(repoRoot, 'kiem-tu');
  const rig = data.byDirection.get('E')!.rig;

  it('puts every landmark bone origin and tip on its landmark', () => {
    const next = applyLandmarks(rig, { ...E, hip_R: [112, 140], knee_R: [112, 188] }, view);
    const p = evalPose(next, null, 0, { noIk: true });
    const at = (bone: string, which: 'pos' | 'tip') => p.byName.get(bone)![which];
    const want = (l: readonly [number, number]) => landmarkToRig(l, view);
    expect(at('thigh_R', 'pos').x).toBeCloseTo(want([112, 140]).x, 2);
    expect(at('thigh_R', 'pos').y).toBeCloseTo(want([112, 140]).y, 2);
    expect(at('thigh_R', 'tip').x).toBeCloseTo(want([112, 188]).x, 2);
    expect(at('shin_R', 'pos').y).toBeCloseTo(want([112, 188]).y, 2);
    expect(at('lower_arm_L', 'tip').x).toBeCloseTo(want(E.wrist_L!).x, 2);
    expect(at('foot_L', 'tip').y).toBeCloseTo(want(E.foot_tip_L!).y, 2);
  });

  it('keeps unrelated bones (chains, IK targets) local transforms', () => {
    const next = applyLandmarks(rig, E, view);
    for (const name of ['hair_back_1', 'sash_L_1', 'ik_foot_L', 'robe_front']) {
      const a = rig.bones.find((b) => b.name === name)!;
      const b = next.bones.find((x) => x.name === name)!;
      expect([b.x, b.y, b.rotation, b.length]).toEqual([a.x, a.y, a.rotation, a.length]);
    }
  });

  it('is nearly a no-op for the current E landmarks (within 2 px)', () => {
    const next = applyLandmarks(rig, E, view);
    const a = evalPose(rig, null, 0, { noIk: true });
    const b = evalPose(next, null, 0, { noIk: true });
    for (const n of ['upper_arm_R', 'lower_arm_R', 'thigh_L', 'shin_L', 'head'])
      expect(
        Math.hypot(a.byName.get(n)!.pos.x - b.byName.get(n)!.pos.x, a.byName.get(n)!.pos.y - b.byName.get(n)!.pos.y),
      ).toBeLessThan(2);
  });

  it('throws when a landmark is missing', () => {
    const { elbow_R: _omit, ...rest } = E;
    expect(() => applyLandmarks(rig, rest, view)).toThrow(/elbow_R/);
  });
});
