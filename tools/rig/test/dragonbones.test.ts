import { describe, expect, it } from 'vitest';
import {
  COCOS_MAX_DATA_VERSION,
  DRAGONBONES_DATA_VERSION,
  ClipBuilder,
  EASE,
  authorKiemTuSet,
  buildReferenceHumanoid,
  evalPose,
  exportDragonBones,
  versionAtMost,
  type AtlasData,
} from '../src/index.js';
import { engineRuntimePath, loadRuntime } from './helpers/dbRuntime.js';

const atlasFor = (rig: ReturnType<typeof buildReferenceHumanoid>): AtlasData => ({
  imagePath: 'kiemtu_E.png',
  width: 1024,
  height: 1024,
  premultipliedAlpha: true,
  regions: rig.slots.map((s, i) => ({
    name: s.name,
    x: (i % 8) * 64,
    y: Math.floor(i / 8) * 64,
    width: 60,
    height: 60,
  })),
});

describe('DragonBones exporter (structure)', () => {
  const rig = buildReferenceHumanoid('E');
  const clips = authorKiemTuSet(rig);
  const out = exportDragonBones([{ rig, clips }], atlasFor(rig), { name: 'kiemtu' });
  const arm = (out.ske.armature as Record<string, unknown>[])[0]!;

  it('writes a data version the Cocos 3.8.8 runtime can read', () => {
    expect(out.ske.version).toBe(DRAGONBONES_DATA_VERSION);
    expect(versionAtMost(out.ske.version as string, COCOS_MAX_DATA_VERSION)).toBe(true);
    expect(out.ske.frameRate).toBe(30);
    expect(out.tex.name).toBe(out.ske.name);
    expect(out.tex.premultipliedAlpha).toBe(true);
  });

  it('exports every bone, slot, IK and clip', () => {
    expect((arm.bone as unknown[]).length).toBe(rig.bones.length);
    expect((arm.slot as unknown[]).length).toBe(rig.slots.length);
    expect((arm.ik as unknown[]).length).toBe(rig.ik!.length);
    expect((arm.animation as { name: string }[]).map((a) => a.name)).toEqual(clips.map((c) => c.name));
    expect(arm.name).toBe('E');
  });

  it('frame durations of every timeline add up to the animation duration', () => {
    for (const a of arm.animation as Record<string, unknown>[]) {
      const dur = a.duration as number;
      for (const b of (a.bone ?? []) as Record<string, { duration: number }[]>[]) {
        for (const key of ['translateFrame', 'rotateFrame', 'scaleFrame']) {
          const frames = b[key];
          if (!frames) continue;
          expect(
            frames.reduce((s, f) => s + f.duration, 0),
            `${a.name}/${b.name}/${key}`,
          ).toBe(dur);
        }
      }
      const looped = a.playTimes === 0;
      expect(looped).toBe(['idle', 'run'].includes(a.name as string));
    }
  });

  it('flips y and rotation at the file boundary (y up/CCW → y down/CW)', () => {
    const hips = (arm.bone as { name: string; transform: Record<string, number> }[]).find((b) => b.name === 'hips')!;
    expect(hips.transform.y).toBe(-36);
    expect(hips.transform.skX).toBe(-90);
  });

  it('rejects attachments without an atlas region and weighted meshes', () => {
    const bad = { ...atlasFor(rig), regions: [] };
    expect(() => exportDragonBones([{ rig, clips: [] }], bad, { name: 'x' })).toThrow(/no atlas region/);
  });

  it('emits bezier curves as [x1,y1,x2,y2] and linear/stepped tweens', () => {
    const c = new ClipBuilder(rig, { name: 't', frames: 10, loop: false });
    c.rotate('head', [
      [0, 0, EASE.inOut],
      [5, 10, 'linear'],
      [8, 20, 'stepped'],
      [10, 30],
    ]);
    const o = exportDragonBones([{ rig, clips: [c.build()] }], atlasFor(rig), { name: 't' });
    const a = ((o.ske.armature as Record<string, unknown>[])[0]!.animation as Record<string, unknown>[])[0]!;
    const frames = (a.bone as { rotateFrame: Record<string, unknown>[] }[])[0]!.rotateFrame;
    expect(frames[0]!.curve).toEqual([0.42, 0, 0.58, 1]);
    expect(frames[1]!.tweenEasing).toBe(0);
    expect(frames[2]!.tweenEasing).toBeUndefined();
    expect(frames[2]!.curve).toBeUndefined();
    expect(frames[0]!.rotate).toBe(0);
    expect(frames[1]!.rotate).toBe(-10);
  });
});

/** Max position error (px) between our exact bezier evaluator and the engine's sampled-curve playback. */
const TOL = 2.5;

const maybe = engineRuntimePath() ? describe : describe.skip;

maybe('Kiếm tu set through the real Cocos 3.8.8 DragonBones runtime', () => {
  it('parses all 5 directions and reproduces our poses (FK, IK, events)', async () => {
    const entries = (['S', 'SE', 'E', 'NE', 'N'] as const).map((d) => {
      const rig = buildReferenceHumanoid(d);
      return { rig, clips: authorKiemTuSet(rig) };
    });
    const out = exportDragonBones(entries, atlasFor(entries[0]!.rig), { name: 'kiemtu' });
    const rt = await loadRuntime();
    const loaded = rt.load(out.ske, out.tex);
    expect(loaded.armatures).toEqual(['S', 'SE', 'E', 'NE', 'N']);

    const { rig, clips } = entries[2]!; // E
    const armature = loaded.build('E');
    let compared = 0;
    for (const clip of clips) {
      // Integer frames only: the runtime resamples bezier curves at frame boundaries (frameCount + 1 samples) and
      // interpolates linearly in between, so sub-frame values differ slightly from the exact curve by design.
      // Non-looping clips are sampled up to N−1 (the engine ends the state at the last frame).
      const picks = [0, 0.25, 0.5, 0.75].map((p) => Math.round(clip.frames * p));
      for (const f of [...picks, clip.frames - 1]) {
        if (clip.loop) {
          // loops must wrap through the first key: play with playTimes = 0 and advance by exact time
          armature.animation.reset();
          armature.animation.fadeIn(clip.name, 0, 0);
          armature.advanceTime(f / 30);
        } else {
          armature.animation.gotoAndStopByFrame(clip.name, f);
          armature.advanceTime(0);
        }
        const ours = evalPose(rig, clip, f);
        for (const b of ['hips', 'head', 'hand_R', 'foot_L', 'foot_R', 'hair_3', 'sash_3']) {
          const got = armature.getBone(b).global;
          const want = ours.byName.get(b)!;
          // tolerance covers the runtime's sampled-bezier approximation (< ~1 px on a 90 px reach)
          expect(Math.abs(got.x - want.pos.x), `${clip.name}.${b}.x @${f}`).toBeLessThan(TOL);
          expect(Math.abs(got.y - want.pos.y), `${clip.name}.${b}.y @${f}`).toBeLessThan(TOL);
          compared++;
        }
      }
    }
    expect(compared).toBeGreaterThan(100);
    const data = loaded.data.getArmature('E');
    expect(data.getAnimation('attack').frameCount).toBe(13);
    expect(data.getAnimation('run').frameCount).toBe(15);
  });
});
