import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  E_PIECES,
  EVENT_FRAME_TOLERANCE,
  GAIT_PROFILES,
  clipSpec,
  touchdowns,
  STRIP_SLOTS,
  assembleContinuous,
  authorKiemTuSet,
  createImage,
  loadCharacterData,
  lowerBodyMetrics,
  lowerBodyQa,
  runQa,
  principalAxis,
  stripQa,
  type Image,
  type Landmarks,
  type PieceSpec,
} from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const view = { scale: 2, pivot: [64, 116] as const };
const landmarks: Landmarks = {
  neck: [118, 78],
  head: [124, 55],
  shoulder_R: [120, 86],
  elbow_R: [120, 112],
  wrist_R: [128, 138],
  shoulder_L: [112, 86],
  elbow_L: [110, 110],
  wrist_L: [116, 134],
  hip_R: [118, 139],
  knee_R: [118, 185],
  ankle_R: [120, 221],
  foot_tip_R: [140, 230],
  hip_L: [126, 139],
  knee_L: [124, 185],
  ankle_L: [124, 219],
  foot_tip_L: [140, 228],
};

function stroke(points: readonly (readonly [number, number])[], r: number): Image {
  const img = createImage(256, 256);
  for (let y = 0; y < 256; y++)
    for (let x = 0; x < 256; x++)
      for (let i = 0; i + 1 < points.length; i++) {
        const [ax, ay] = points[i]!;
        const [bx, by] = points[i + 1]!;
        const l2 = (bx - ax) ** 2 + (by - ay) ** 2 || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / l2));
        if (Math.hypot(x - ax - t * (bx - ax), y - ay - t * (by - ay)) <= r) img.data[(y * 256 + x) * 4 + 3] = 255;
      }
  return img;
}

/** A robe with a wide, thin hem strip at its bottom edge, hem bound as given. */
function build(hemBinding: PieceSpec['binding']) {
  const base = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('E')!.rig;
  const parts = new Map<string, Image>([
    [
      'leg_L',
      stroke(
        [
          [126, 130],
          [124, 185],
          [124, 219],
          [138, 228],
        ],
        9,
      ),
    ],
    [
      'leg_R',
      stroke(
        [
          [118, 130],
          [118, 185],
          [120, 221],
          [138, 230],
        ],
        9,
      ),
    ],
    [
      'torso',
      stroke(
        [
          [118, 70],
          [118, 140],
        ],
        14,
      ),
    ],
    [
      'robe_front',
      stroke(
        [
          [118, 120],
          [118, 190],
        ],
        22,
      ),
    ],
    [
      'robe_hem_front',
      stroke(
        [
          [100, 197],
          [136, 197],
        ],
        2,
      ),
    ],
  ]);
  const pieces = E_PIECES.map((p) => (p.id === 'robe_hem_front' ? { ...p, binding: hemBinding } : p));
  return assembleContinuous({ base, landmarks, view, parts, pieces });
}

describe('strip QA (hem / cuff / lining strips)', () => {
  it('recognises strip slots by name and measures the principal axis of a thin band', () => {
    for (const s of ['robe_hem_front', 'sleeve_trim_L', 'vest_edges', 'sleeve_lining_R'])
      expect(STRIP_SLOTS.test(s)).toBe(true);
    for (const s of ['torso', 'robe_front', 'head']) expect(STRIP_SLOTS.test(s)).toBe(false);
    const band = [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 2 },
      { x: 0, y: 2 },
    ];
    const ax = principalAxis(band);
    expect(Math.abs(ax.angle)).toBeLessThan(1);
    expect(ax.length).toBeCloseTo(20, 0);
    expect(ax.width).toBeCloseTo(2, 0);
  });

  it('a hem that co-deforms with the skirt passes in run', () => {
    const res = build({ kind: 'skirt' });
    const run = authorKiemTuSet(res.rig, { only: ['run'], secondary: false })[0]!;
    expect(stripQa(res.rig, run)).toEqual([]);
  });

  it('catches the broken binding: a thin wide hem on a vertical chain (flips under the feet in run)', () => {
    const res = build({ kind: 'hanging', template: 'robe_hem_front', cols: 4 });
    expect(res.rig.bones.some((b) => b.name.startsWith('robe_hem_front_'))).toBe(true);
    // swing the chain bone far like the real bug did (a body-driven spring on a 2 px lever arm)
    const run = authorKiemTuSet(res.rig, { only: ['run'], secondary: false })[0]!;
    const swung = {
      ...run,
      bones: [
        ...run.bones,
        {
          bone: 'robe_hem_front_1',
          rotate: [
            { frame: 0, value: 0 },
            { frame: 3, value: 80 },
            { frame: run.frames, value: 0 },
          ],
        },
      ],
    };
    const issues = stripQa(res.rig, swung);
    expect(issues.length).toBeGreaterThan(0);
    expect(issues.every((i) => i.check === 'strip' && i.severity === 'error')).toBe(true);
  });
});

describe('lower-body QA and the robe gait', () => {
  const res = build({ kind: 'skirt', panel: 'robe_front' });
  const stride = (gait: keyof typeof GAIT_PROFILES) =>
    lowerBodyMetrics(
      res.rig,
      authorKiemTuSet(res.rig, { only: ['run'], secondary: false, gait: GAIT_PROFILES[gait] })[0]!,
    )!;

  it('the free gait spreads the feet over a leg length; the robe gait keeps the stride short', () => {
    const free = stride('free');
    const robe = stride('robe');
    expect(free.strideRatio).toBeGreaterThan(0.75);
    expect(robe.strideRatio).toBeLessThan(free.strideRatio * 0.9);
    expect(robe.strideRatio).toBeLessThanOrEqual(0.7);
  });

  it('flags a squat stride and passes the robe gait', () => {
    const run = (g: keyof typeof GAIT_PROFILES) =>
      lowerBodyQa(res.rig, authorKiemTuSet(res.rig, { only: ['run'], secondary: false, gait: GAIT_PROFILES[g] })[0]!);
    expect(run('free').some((i) => /squat stride/.test(i.message))).toBe(true);
    expect(run('robe').some((i) => /squat stride/.test(i.message))).toBe(false);
  });

  it('the skirt panels follow the legs: the front panel bone is weighted into the front skirt mesh', () => {
    const front = res.rig.skins[0]!.attachments.robe_front!.robe_front!;
    expect(front.type).toBe('mesh');
    if (front.type === 'mesh') expect(front.weights!.some((w) => w.some(([b]) => b === 'robe_front'))).toBe(true);
    expect((res.rig.chains ?? []).some((c) => c.name === 'skirt_group')).toBe(true);
  });
});

describe('the robe gait bakes its cadence into the clip (no runtime timeScale)', () => {
  const res = build({ kind: 'skirt', panel: 'robe_front' });
  const clipOf = (name: 'run' | 'walk', gait: keyof typeof GAIT_PROFILES) =>
    authorKiemTuSet(res.rig, { only: [name], secondary: false, gait: GAIT_PROFILES[gait] })[0]!;

  it('the authored ground speed is the real speed for every gait (the movement speed, so timeScale stays 1)', () => {
    for (const name of ['run', 'walk'] as const) {
      expect(clipOf(name, 'robe').motion!.speed).toBe(clipOf(name, 'free').motion!.speed);
      expect(clipOf(name, 'free').motion!.speed).toBeGreaterThan(0);
    }
  });

  it('the robe clips keep the animation-table duration and hold two step pairs: the foot lifts twice per clip', () => {
    for (const name of ['run', 'walk'] as const) {
      const free = clipOf(name, 'free');
      const robe = clipOf(name, 'robe');
      expect(robe.frames).toBe(free.frames);
      const lifts = (c: typeof free) => {
        const foot = c.motion!.planted![res.rig.roles.foot_L!]!;
        let n = 0;
        for (let f = 1; f < foot.length; f++) if (foot[f - 1] && !foot[f]) n++;
        return n;
      };
      expect(lifts(robe)).toBe(2 * lifts(free));
    }
  });

  it('the shorter stride stays reachable: no foot-slide error and no IK-reach error on the robe run', () => {
    const run = clipOf('run', 'robe');
    const issues = runQa(res.rig, run, { mesh: false });
    expect(
      issues.issues.filter((i) => i.severity === 'error' && (i.check === 'foot-slide' || i.check === 'ik-reach')),
    ).toEqual([]);
  });

  it('footstep events fire at the real touchdowns: 4 in a robe run clip, each within the tolerance of a touchdown of that foot', () => {
    const touch = (c: ReturnType<typeof clipOf>, foot: 'L' | 'R') => {
      const planted = c.motion!.planted![foot === 'L' ? res.rig.roles.foot_L! : res.rig.roles.foot_R!]!;
      return touchdowns(planted, c.frames);
    };
    const free = clipOf('run', 'free');
    const robe = clipOf('run', 'robe');
    expect(free.events.filter((e) => e.name.startsWith('footstep')).length).toBe(2);
    expect(robe.events.filter((e) => e.name.startsWith('footstep')).length).toBe(4);
    for (const c of [free, robe])
      for (const e of c.events.filter((x) => x.name.startsWith('footstep'))) {
        const frames = touch(c, e.name === 'footstep_L' ? 'L' : 'R');
        expect(
          frames.some((f) => Math.abs(f - e.frame) <= EVENT_FRAME_TOLERANCE),
          `${c.name} ${e.name}@${e.frame}`,
        ).toBe(true);
      }
    // the table's footstep frames hold for the one-cycle gait; the robe gait passes the QA with one per cycle
    expect(
      runQa(res.rig, robe, { mesh: false, spec: clipSpec('run') }).issues.filter((i) => i.check === 'events'),
    ).toEqual([]);
  });
});
