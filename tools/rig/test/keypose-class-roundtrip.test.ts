import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  applyLandmarks,
  authorClassSet,
  evalPose,
  fitPose,
  landmarksFromPose,
  loadCharacterData,
  snapIkTargets,
  type Landmarks,
} from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const view = { scale: 2, pivot: [64, 116] as const };
const base = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('E')!.rig;
// Thể tu E landmarks: the neck landmark sits 14 px to the right of the chest, so the spine axis is NOT the chest-to-neck vector
const landmarks: Landmarks = {
  neck: [131, 82],
  head: [130, 65],
  shoulder_R: [114, 98],
  elbow_R: [104, 119],
  wrist_R: [100, 133],
  shoulder_L: [148, 101],
  elbow_L: [154, 117],
  wrist_L: [157, 132],
  hip_R: [119, 150],
  knee_R: [116, 184],
  ankle_R: [115, 214],
  foot_tip_R: [126, 229],
  hip_L: [141, 150],
  knee_L: [147, 183],
  ankle_L: [145, 213],
  foot_tip_L: [158, 226],
  waist: [133, 126],
};

describe('fitPose round trip on a class rig whose neck / shoulders are offset from the spine axis', () => {
  it('landmarksFromPose -> fitPose reproduces the idle pose of the Thể tu landmark rig (rms < 0.5 px)', () => {
    const rig = snapIkTargets(applyLandmarks({ ...base, chains: [] }, landmarks, view));
    const idle = authorClassSet('the-tu', rig, { secondary: false }).find((c) => c.name === 'idle')!;
    for (const f of [0, 15]) {
      const lm = landmarksFromPose(rig, evalPose(rig, idle, f), view);
      const fit = fitPose(rig, lm, view);
      expect(fit.rms, `frame ${f}`).toBeLessThan(0.5);
      expect(fit.maxError, `frame ${f}`).toBeLessThan(1);
    }
  });
});
