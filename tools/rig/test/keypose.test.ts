import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  GAIT_PROFILES,
  authorFromKeyPoses,
  authorKeyPoseClip,
  runQa,
  tableGroundSpeed,
  type PoseFit,
  keyPoseFrames,
  authorKiemTuSet,
  createImage,
  evalPose,
  evenKeyFrames,
  finishedLandmarkRms,
  fitPose,
  landmarksFromPose,
  loadCharacterData,
  maskIoU,
  sampleScalar,
  type Clip,
  type KeyPoseLandmarks,
} from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const view = { scale: 2, pivot: [64, 116] as const };
const rig = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('E')!.rig;
const run = authorKiemTuSet(rig, { only: ['run'], secondary: false, gait: GAIT_PROFILES.robe })[0]!;

/** The fit of landmarks measured on a known pose must reproduce that pose (the reference images replace this source). */
describe('fitPose', () => {
  for (const f of [0, 3, 7, 11]) {
    it(`recovers the landmarks of run frame ${f} within 1.5 px (@1x)`, () => {
      const pose = evalPose(rig, run, f);
      const lm = landmarksFromPose(rig, pose, view) as KeyPoseLandmarks;
      const fit = fitPose(rig, lm, view);
      expect(fit.maxError).toBeLessThan(1.5);
      expect(fit.lengthMismatch).toEqual([]);
    });
  }

  it('skips inferred landmarks in the error report and throws on a missing skeleton landmark', () => {
    const lm = landmarksFromPose(rig, evalPose(rig, run, 3), view) as Record<string, unknown>;
    const fit = fitPose(rig, { ...lm, _inferred: ['knee_L'] } as KeyPoseLandmarks, view);
    expect(fit.error.knee_L).toBeUndefined();
    const { pelvis: _omit, ...rest } = lm;
    expect(() => fitPose(rig, rest as KeyPoseLandmarks, view)).toThrow(/pelvis/);
  });
});

describe('authorFromKeyPoses', () => {
  const N = 15;
  const frames = evenKeyFrames(8, N);
  const keys = frames.map((frame, i) => ({
    frame,
    fit: fitPose(rig, landmarksFromPose(rig, evalPose(rig, run, frame), view) as KeyPoseLandmarks, view),
    planted: { L: i < 4, R: i >= 4 },
  }));
  const clip: Clip = authorFromKeyPoses(rig, { name: 'run', frames: N, loop: true, keys });

  it('places the keys at their frames and the clip loops on the first key', () => {
    expect(frames).toEqual([0, 2, 4, 6, 8, 9, 11, 13]);
    expect(clip.frames).toBe(N);
    expect(clip.loop).toBe(true);
    const hips = clip.bones.find((b) => b.bone === rig.roles.hips)!.translate!;
    expect(hips[0]!.frame).toBe(0);
    expect(hips[hips.length - 1]!.frame).toBe(N);
    expect(hips[hips.length - 1]!.value).toEqual(hips[0]!.value);
    expect(clip.motion?.planted?.[rig.roles.foot_L!]?.[0]).toBe(true);
  });

  it('reproduces the key poses exactly at the key frames', () => {
    for (const k of keys) {
      const want = evalPose(rig, run, k.frame);
      const got = evalPose(rig, clip, k.frame);
      for (const b of [rig.roles.hand_R!, rig.roles.foot_L!, rig.roles.foot_R!, rig.roles.head!]) {
        const a = want.byName.get(b)!.pos;
        const c = got.byName.get(b)!.pos;
        expect(Math.hypot(a.x - c.x, a.y - c.y), `${b}@${k.frame}`).toBeLessThan(3);
      }
    }
  });

  it('rotations take the short way round between keys', () => {
    for (const t of clip.bones)
      for (let i = 1; i < (t.rotate?.length ?? 0); i++)
        expect(Math.abs(t.rotate![i]!.value - t.rotate![i - 1]!.value)).toBeLessThan(180);
  });
});

describe('maskIoU', () => {
  it('is 1 for identical masks, 0 for disjoint ones and rejects different sizes', () => {
    const a = createImage(4, 4);
    const b = createImage(4, 4);
    for (let i = 0; i < 8; i++) a.data[i * 4 + 3] = 255;
    for (let i = 8; i < 16; i++) b.data[i * 4 + 3] = 255;
    expect(maskIoU(a, a)).toBe(1);
    expect(maskIoU(a, b)).toBe(0);
    expect(() => maskIoU(a, createImage(2, 2))).toThrow(/same size/);
  });
});

describe('authorKeyPoseClip', () => {
  const fitAt = (f: number) =>
    fitPose(rig, landmarksFromPose(rig, evalPose(rig, run, f), view) as KeyPoseLandmarks, view);

  it('a run cycle: 8 keys over the 15-frame table duration, loops, planted feet from the key labels', () => {
    const fits = Array.from({ length: 8 }, (_, i) => fitAt(Math.round((i * 15) / 8)));
    const c = authorKeyPoseClip(rig, 'run', fits, 15, true);
    expect(c.frames).toBe(15);
    expect(c.loop).toBe(true);
    // evenly spaced, not rounded (uneven spacing hitches the loop seam); the offset puts R_contact on footstep_R
    const even = keyPoseFrames('run', 15);
    even.forEach((f, i) => expect(f).toBeCloseTo((i * 15) / 8, 6));
    const shifted = keyPoseFrames('run', 15, undefined, [{ frame: 11, name: 'footstep_R' }]);
    expect(shifted[0]).toBeCloseTo(11, 6);
    expect(shifted[2]).toBeCloseTo(((2 * 15) / 8 + 11) % 15, 6);
    const lf = c.motion!.planted![rig.roles.foot_L!]!;
    expect(lf.slice(0, 2)).toEqual([false, false]); // R contact keys: the left foot is in the air
    expect(lf[8]).toBe(true); // L contact
  });

  it('a one-shot clip (attack) eases in from and back to the rest pose, keys at the table phases', () => {
    const fits = [fitAt(3), fitAt(6), fitAt(9)];
    const c = authorKeyPoseClip(rig, 'attack', fits, 13, false, { windup_end: 4, hit_frame: 6, combo_window: 9 });
    expect(c.loop).toBe(false);
    const sp = c.bones.find((b) => b.bone === rig.roles.spine_mid)!.rotate!;
    expect(sampleScalar(sp, 0)).toBeCloseTo(0, 3);
    expect(sampleScalar(sp, 13)).toBeCloseTo(0, 3);
    [4, 6, 9].forEach((f, i) => expect(sampleScalar(sp, f)).toBeCloseTo(fits[i]!.rotations[rig.roles.spine_mid!]!, 1));
  });

  it('rejects a wrong number of key poses', () => {
    expect(() => authorKeyPoseClip(rig, 'run', [fitAt(0)], 15, true)).toThrow(/needs 8/);
  });
});

describe('key-pose locomotion runs at the table ground speed', () => {
  const N = 15;
  // one gait cycle per clip (8 keys = one L+R cycle): the table gait
  const handRun = authorKiemTuSet(rig, { only: ['run'], secondary: false, gait: GAIT_PROFILES.free })[0]!;
  const at = keyPoseFrames('run', N, handRun.phases, handRun.events);
  const fitAt = (f: number) =>
    fitPose(rig, landmarksFromPose(rig, evalPose(rig, handRun, f), view) as KeyPoseLandmarks, view);

  it('motion.speed equals the hand-authored run of the same rig, and the planted feet do not slide at that speed', () => {
    const fits = at.map((f) => fitAt(f));
    const clip = authorKeyPoseClip(rig, 'run', fits, N, true, handRun.phases, handRun.events);
    expect(clip.motion!.speed).toBe(handRun.motion!.speed);
    expect(clip.motion!.speed).toBe(tableGroundSpeed(rig, 'run'));
    const qa = runQa(rig, clip, { mesh: false });
    expect(qa.issues.filter((i) => i.check === 'foot-slide')).toEqual([]);
  });

  it('drawings with a wider stride are normalised: the speed stays the table speed, the contacts are shifted onto the line', () => {
    // stretch the reference feet apart by 60 %: the drawings now imply a faster ground speed
    const wide = at.map((f) => {
      const fit = fitAt(f);
      const stretch = (p: { x: number; y: number }) => ({ x: p.x * 1.6, y: p.y });
      return { ...fit, feet: Object.fromEntries(Object.entries(fit.feet).map(([k, p]) => [k, stretch(p)])) };
    });
    const out: { fits?: PoseFit[]; impliedSpeedPxS?: number | null; tableSpeedPxS?: number | null } = {};
    const clip = authorKeyPoseClip(rig, 'run', wide, N, true, handRun.phases, handRun.events, out);
    expect(out.impliedSpeedPxS!).toBeGreaterThan(out.tableSpeedPxS! * 1.2);
    expect(clip.motion!.speed).toBe(handRun.motion!.speed);
    expect(runQa(rig, clip, { mesh: false }).issues.filter((i) => i.check === 'foot-slide')).toEqual([]);
  });
});

describe('the finished-clip RMS compensates the lock shift along any facing axis', () => {
  // SE: the facing axis has a vertical component, so the contact lock moves hips and feet vertically too
  const se = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('SE')!.rig;
  const N = 15;
  const hand = authorKiemTuSet(se, { only: ['run'], secondary: false, gait: GAIT_PROFILES.free })[0]!;
  const at = keyPoseFrames('run', N, hand.phases, hand.events);
  const refs = at.map((f) => landmarksFromPose(se, evalPose(se, hand, f), view) as KeyPoseLandmarks);

  it('a clip fitted to its own landmarks has a finished RMS near 0 in SE too', () => {
    const fits = refs.map((lm) => fitPose(se, lm, view));
    const out: { fits?: PoseFit[] } = {};
    const clip = authorKeyPoseClip(se, 'run', fits, N, true, hand.phases, hand.events, out);
    out.fits!.forEach((fit, i) => {
      const rms = finishedLandmarkRms(se, refs[i]!, view, clip, at[i]!, fit);
      expect(rms, `key ${i}`).toBeLessThan(0.8);
    });
  });

  it('when the lock moves the keys diagonally the compensation follows: body RMS stays at the fit RMS', () => {
    // feet drawn 1.5x wider: the lock must shift the keys along the diagonal facing; the legs (feet, knees, hips) are marked
    // inferred (the wider feet change them by construction), the body landmarks must still agree after compensation
    const feetNames = ['ankle_L', 'ankle_R', 'foot_tip_L', 'foot_tip_R', 'knee_L', 'knee_R', 'hip_L', 'hip_R'];
    const wide = refs.map((lm) => {
      const fit = fitPose(se, lm, view);
      return {
        ...fit,
        feet: Object.fromEntries(Object.entries(fit.feet).map(([k, p]) => [k, { x: p.x * 1.5, y: p.y }])),
      };
    });
    const out: { fits?: PoseFit[] } = {};
    const clip = authorKeyPoseClip(se, 'run', wide, N, true, hand.phases, hand.events, out);
    const moved = out.fits!.filter((f) => Math.hypot(f.lockShift.x, f.lockShift.y) > 1);
    expect(moved.length).toBeGreaterThan(0);
    expect(moved.some((f) => Math.abs(f.lockShift.y) > 0.3)).toBe(true); // a vertical part: the case the review is about
    out.fits!.forEach((fit, i) => {
      const lm = { ...refs[i]!, _inferred: feetNames } as KeyPoseLandmarks;
      const withLock = finishedLandmarkRms(se, lm, view, clip, at[i]!, fit);
      const withoutLock = finishedLandmarkRms(se, lm, view, clip, at[i]!, {
        shift: fit.shift,
        lockShift: { x: 0, y: 0 },
      });
      expect(withLock, `key ${i}`).toBeLessThan(wide[i]!.rms + 0.8);
      if (Math.hypot(fit.lockShift.x, fit.lockShift.y) > 1) expect(withoutLock).toBeGreaterThan(withLock + 0.5);
    });
  });
});

describe('finishedLandmarkRms in E and in a diagonal direction', () => {
  for (const dir of ['E', 'SE', 'NE'] as const) {
    it(`${dir}: a clip authored from its own key poses has a finished RMS near 0 at the key frames`, () => {
      const r = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get(dir)!.rig;
      const hand = authorKiemTuSet(r, { only: ['run'], secondary: false, gait: GAIT_PROFILES.free })[0]!;
      const keyAt = keyPoseFrames('run', 15, hand.phases, hand.events);
      const refs = keyAt.map((f) => landmarksFromPose(r, evalPose(r, hand, f), view) as KeyPoseLandmarks);
      const fits = refs.map((lm) => fitPose(r, lm, view));
      const out: { fits?: PoseFit[] } = {};
      const clip = authorKeyPoseClip(r, 'run', fits, 15, true, hand.phases, hand.events, out);
      out.fits!.forEach((fit, i) =>
        expect(finishedLandmarkRms(r, refs[i]!, view, clip, keyAt[i]!, fit), `${dir} key ${i}`).toBeLessThan(0.8),
      );
    });
  }
});
