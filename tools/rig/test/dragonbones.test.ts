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

describe('weighted mesh export', () => {
  const rig0 = buildReferenceHumanoid('E');
  // a quad on the body slot (spine_mid), weighted between spine_mid and spine_upper (bone-local, y up)
  const weightedRig = {
    ...rig0,
    skins: [
      ...rig0.skins,
      {
        name: 'weighted',
        attachments: {
          body: {
            body: {
              type: 'mesh' as const,
              path: 'body',
              width: 22,
              height: 30,
              uvs: [0, 1, 1, 1, 1, 0, 0, 0],
              vertices: [-11, 0, 11, 0, 11, 28, -11, 28],
              triangles: [0, 1, 2, 0, 2, 3],
              weights: [
                [['spine_mid', 1]],
                [['spine_mid', 1]],
                [
                  ['spine_mid', 0.5],
                  ['spine_upper', 0.5],
                ],
                [
                  ['spine_mid', 0.25],
                  ['spine_upper', 0.75],
                ],
              ] as [string, number][][],
            },
          },
        },
      },
    ],
  };

  it('exports slotPose / bonePose / weights in the engine format', () => {
    const out = exportDragonBones([{ rig: weightedRig, clips: [] }], atlasFor(rig0), { name: 'w' });
    const arm = (out.ske.armature as Record<string, unknown>[])[0]!;
    const skin = (arm.skin as { name: string; slot: { name: string; display: Record<string, unknown>[] }[] }[]).find(
      (s) => s.name === 'weighted',
    )!;
    const mesh = skin.slot.find((s) => s.name === 'body')!.display[0]!;
    expect(mesh.type).toBe('mesh');
    expect((mesh.slotPose as number[]).length).toBe(6);
    expect((mesh.bonePose as number[]).length).toBe(14); // 2 bones x [index, a b c d tx ty]
    expect(mesh.weights).toEqual([1, 2, 1, 1, 2, 1, 2, 2, 0.5, 3, 0.5, 2, 2, 0.25, 3, 0.75]);
  });

  const maybeEngine = engineRuntimePath() ? it : it.skip;
  maybeEngine('is accepted by the engine parser and converts to the same bone-local coordinates', async () => {
    const out = exportDragonBones([{ rig: weightedRig, clips: [] }], atlasFor(rig0), { name: 'w' });
    const rt = await loadRuntime();
    const loaded = rt.load(out.ske, out.tex);
    const mesh = loaded.data.getArmature('E').getMesh('weighted', 'body', 'body');
    expect(mesh).toBeTruthy();
    const weight = mesh.vertices.weight;
    expect(weight.count).toBe(6);
    expect(weight.bones.map((b: { name: string }) => b.name)).toEqual(['spine_mid', 'spine_upper']);
    // vertex 2 on spine_upper: engine bone-local (y down) must equal our y-up bone-local with y flipped
    const ints = loaded.data.intArray as number[];
    const floats = loaded.data.floatArray as number[];
    const floatOffset = ints[weight.offset + 1]!;
    const rest = evalPose(weightedRig, null, 0, { noIk: true });
    const slotW = rest.byName.get('spine_mid')!.world;
    const upperW = rest.byName.get('spine_upper')!.world;
    const world = { x: slotW.a * 11 + slotW.c * 28 + slotW.tx, y: slotW.b * 11 + slotW.d * 28 + slotW.ty };
    const det = upperW.a * upperW.d - upperW.b * upperW.c;
    const dx = world.x - upperW.tx;
    const dy = world.y - upperW.ty;
    const lx = (upperW.d * dx - upperW.c * dy) / det;
    const ly = (-upperW.b * dx + upperW.a * dy) / det;
    // weights of vertex 2 start after vertex 0 (1 influence) and 1 (1 influence): index 2 in the float stream
    const base = floatOffset + 3 * 2; // two single-influence vertices come first
    expect(floats[base + 3 + 0]).toBeCloseTo(0.5, 6); // second influence (spine_upper): weight
    expect(floats[base + 3 + 1]).toBeCloseTo(lx, 2);
    expect(floats[base + 3 + 2]).toBeCloseTo(-ly, 2);
  });
});

maybe('events through the real runtime', () => {
  it('fires every authored event of a non-looping clip by the end of playback, in order', async () => {
    const rig = buildReferenceHumanoid('E');
    const clips = authorKiemTuSet(rig, { only: ['attack', 'cast'] });
    const out = exportDragonBones([{ rig, clips }], atlasFor(rig), { name: 'ev' });
    const loaded = (await loadRuntime()).load(out.ske, out.tex);
    const armature = loaded.build('E');
    for (const clip of clips) {
      loaded.events.length = 0;
      armature.animation.fadeIn(clip.name, 0, 1);
      for (let i = 0; i <= clip.frames + 2; i++) loaded.advance(1 / 30);
      const fired = loaded.events.filter((e) => e.type === 'frameEvent').map((e) => e.name);
      expect(fired, clip.name).toEqual(clip.events.map((e) => e.name));
      armature.animation.reset();
    }
  });
});

describe('2x atlas with 1x logical geometry', () => {
  it('scales image displays by logical size / packed size', () => {
    const rig = buildReferenceHumanoid('E');
    const atlas = atlasFor(rig);
    const doubled = {
      ...atlas,
      regions: atlas.regions.map((r) => ({ ...r, width: r.width * 2, height: r.height * 2 })),
    };
    const out = exportDragonBones([{ rig, clips: [] }], doubled, { name: 'x2' });
    const arm = (out.ske.armature as Record<string, unknown>[])[0]!;
    const skin = (arm.skin as { slot: { display: { transform: Record<string, number> }[] }[] }[])[0]!;
    // reference attachments are 56 wide in the atlas (28 in rig px for `cape`), so a 2x region halves the scale
    const cape = (arm.slot as { name: string }[]).findIndex((s) => s.name === 'cape');
    const t = skin.slot[cape]!.display[0]!.transform;
    expect(t.scX).toBeCloseTo(28 / 120, 3);
    expect(t.scY).toBeCloseTo(44 / 120, 3);
  });
});
