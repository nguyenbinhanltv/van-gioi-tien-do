import { describe, expect, it } from 'vitest';
import {
  buildReferenceHumanoid,
  exportDragonBones,
  evalPose,
  ClipBuilder,
  EASE,
  type AtlasData,
} from '../src/index.js';
import { engineRuntimePath, loadRuntime } from './helpers/dbRuntime.js';

const atlas = (rig: ReturnType<typeof buildReferenceHumanoid>): AtlasData => ({
  imagePath: 'ref.png',
  width: 512,
  height: 512,
  premultipliedAlpha: true,
  regions: rig.slots.map((s, i) => ({
    name: s.name,
    x: (i % 8) * 60,
    y: Math.floor(i / 8) * 60,
    width: 56,
    height: 56,
  })),
});

const maybe = engineRuntimePath() ? describe : describe.skip;

maybe('DragonBones export vs the real Cocos 3.8.8 runtime', () => {
  it('is accepted by the engine parser and plays back to the same pose as our evaluator', async () => {
    const rig = buildReferenceHumanoid('E');
    const c = new ClipBuilder(rig, { name: 'wave', frames: 12, loop: false });
    c.rotate('spine_mid', [
      [0, 0],
      [6, 12, EASE.inOut],
      [12, -4],
    ]);
    c.translate('hips', [
      [0, 0, 0],
      [6, 3, -2],
      [12, 0, 0],
    ]);
    c.rotate('head', [
      [0, 0, 'stepped'],
      [4, 20],
      [12, 5],
    ]);
    const clip = c.build();
    const out = exportDragonBones([{ rig, clips: [clip] }], atlas(rig), { name: 'ref' });

    const rt = await loadRuntime();
    const loaded = rt.load(out.ske, out.tex);
    expect(loaded.armatures).toEqual(['E']);
    const armature = loaded.build('E');
    expect(armature).toBeTruthy();

    for (const frame of [0, 3, 6, 9, 11.99]) {
      armature.animation.gotoAndStopByFrame('wave', frame);
      armature.advanceTime(0);
      const ours = evalPose(rig, clip, frame, { noIk: false });
      for (const b of ['hips', 'spine_upper', 'head', 'hand_R', 'foot_L']) {
        const got = armature.getBone(b).global;
        const want = ours.byName.get(b)!;
        // the runtime's armature-space output is y-up (DragonBones.yDown = false), like our rig space
        expect(got.x, `${b}.x @${frame}`).toBeCloseTo(want.pos.x, 1);
        expect(got.y, `${b}.y @${frame}`).toBeCloseTo(want.pos.y, 1);
      }
    }
  });

  it('solves IK like our evaluator (knee side and foot reach)', async () => {
    const rig = buildReferenceHumanoid('E');
    const c = new ClipBuilder(rig, { name: 'step', frames: 10, loop: false });
    c.translate('ik_foot_L', [
      [0, 0, 0],
      [10, 9, 7, EASE.inOut],
    ]);
    c.translate('ik_foot_R', [
      [0, 0, 0],
      [10, -8, 4],
    ]);
    const clip = c.build();
    const out = exportDragonBones([{ rig, clips: [clip] }], atlas(rig), { name: 'ref' });
    const armature = (await loadRuntime()).load(out.ske, out.tex).build('E');
    for (const frame of [0, 5, 9.99]) {
      armature.animation.gotoAndStopByFrame('step', frame);
      armature.advanceTime(0);
      const ours = evalPose(rig, clip, frame);
      for (const b of ['shin_L', 'foot_L', 'shin_R', 'foot_R']) {
        const got = armature.getBone(b).global;
        const want = ours.byName.get(b)!;
        expect(got.x, `${b}.x @${frame}`).toBeCloseTo(want.pos.x, 1);
        expect(got.y, `${b}.y @${frame}`).toBeCloseTo(want.pos.y, 1);
      }
    }
  });
});
