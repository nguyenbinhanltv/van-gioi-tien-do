import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  assembleContinuous,
  createImage,
  loadCharacterData,
  validateRig,
  type Image,
  type Landmarks,
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

/** A 256 canvas with a painted polyline of the given half-width (texture px). */
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

describe('assembleContinuous', () => {
  const base = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('E')!.rig;
  const parts = new Map<string, Image>([
    [
      'arm_L',
      stroke(
        [
          [112, 84],
          [110, 110],
          [116, 134],
          [116, 140],
        ],
        9,
      ),
    ],
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
      'torso',
      stroke(
        [
          [118, 70],
          [118, 120],
          [118, 140],
        ],
        14,
      ),
    ],
    [
      'head',
      stroke(
        [
          [124, 40],
          [124, 56],
        ],
        12,
      ),
    ],
    [
      'hand_L_relaxed',
      stroke(
        [
          [116, 134],
          [116, 142],
        ],
        5,
      ),
    ],
    [
      'hand_L_fist',
      stroke(
        [
          [116, 134],
          [117, 144],
        ],
        6,
      ),
    ],
    [
      'ribbon_tail_L',
      stroke(
        [
          [120, 40],
          [118, 70],
          [116, 100],
        ],
        4,
      ),
    ],
    [
      'robe_front',
      stroke(
        [
          [118, 120],
          [118, 190],
        ],
        20,
      ),
    ],
  ]);
  const res = assembleContinuous({ base, landmarks, view, parts });

  it('assembles the present parts, reports the missing ones, and the rig validates within RIG_LIMITS', () => {
    expect(res.used).toEqual(
      expect.arrayContaining(['arm_L', 'leg_L', 'torso', 'head', 'ribbon_tail_L', 'robe_front']),
    );
    expect(res.missing).toContain('arm_R');
    expect(res.stats.limits.meshVertices).toBeGreaterThan(res.stats.vertices);
    expect(res.stats.limits.bones).toBeGreaterThan(res.stats.bones);
    expect(validateRig(res.rig).filter((i) => i.severity === 'error')).toEqual([]);
  });

  it('uses whole-limb meshes (smooth weights), rigid regions for small parts, display variants in one slot', () => {
    const att = res.rig.skins[0]!.attachments;
    const arm = att.arm_L!.arm_L!;
    expect(arm.type).toBe('mesh');
    if (arm.type === 'mesh') {
      const bonesUsed = new Set(arm.weights!.flatMap((w) => w.map(([b]) => b)));
      expect([...bonesUsed].sort()).toEqual(['hand_L', 'lower_arm_L', 'upper_arm_L']);
      for (const w of arm.weights!) expect(w.length).toBeLessThanOrEqual(2);
    }
    expect(att.head!.head!.type).toBe('region');
    expect(Object.keys(att.hand_L!)).toEqual(['hand_L_relaxed', 'hand_L_fist']);
    expect(res.rig.slots.find((s) => s.name === 'hand_L')!.attachment).toBe('hand_L_relaxed');
  });

  it('lays the ribbon chain along the art and groups it into a detail chain', () => {
    expect(res.rig.chains!.map((c) => c.name)).toEqual(['ribbon_group']);
    expect(res.rig.bones.filter((b) => b.name.startsWith('ribbon_tail_L_'))).toHaveLength(3);
  });

  it('packs every crop into one atlas page with a region per attachment', () => {
    const names = new Set(res.atlas.data.regions.map((r) => r.name));
    for (const id of res.used) expect(names.has(id)).toBe(true);
    expect(res.atlas.data.width).toBe(res.atlas.image.width);
    expect(res.atlas.data.premultipliedAlpha).toBe(true);
  });
});
