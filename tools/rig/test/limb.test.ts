import { describe, expect, it } from 'vitest';
import {
  ClipBuilder,
  buildLimbMesh,
  buildSkirtMesh,
  buildReferenceHumanoid,
  createImage,
  evalPose,
  skinAttachment,
  type CanvasView,
} from '../src/index.js';

const view: CanvasView = { scale: 2, pivot: [64, 116] };

/** A straight painted "arm": a capsule of `width` px @1x along the rest chain upper_arm_R → hand tip, extended past both ends. */
function armImage(extendTop = 6, width = 10) {
  const rig = buildReferenceHumanoid('E');
  const rest = evalPose(rig, null, 0, { noIk: true });
  const a = rest.byName.get('upper_arm_R')!.pos;
  const b = rest.byName.get('hand_R')!.tip;
  const img = createImage(256, 256);
  const len = Math.hypot(b.x - a.x, b.y - a.y);
  const t = { x: (b.x - a.x) / len, y: (b.y - a.y) / len };
  for (let y = 0; y < 256; y++) {
    for (let x = 0; x < 256; x++) {
      const p = { x: (x + 0.5) / view.scale - view.pivot[0], y: view.pivot[1] - (y + 0.5) / view.scale };
      const u = (p.x - a.x) * t.x + (p.y - a.y) * t.y;
      const d = Math.abs(-(p.x - a.x) * t.y + (p.y - a.y) * t.x);
      if (u >= -extendTop && u <= len && d <= width / 2) {
        const o = (y * 256 + x) * 4;
        img.data[o + 3] = 255;
      }
    }
  }
  return { rig, img };
}

describe('buildLimbMesh', () => {
  const { rig, img } = armImage();
  const limb = buildLimbMesh(rig, {
    name: 'arm_R',
    slotBone: 'upper_arm_R',
    chain: ['upper_arm_R', 'lower_arm_R', 'hand_R'],
    view,
    image: img,
  });
  const m = limb.attachment;

  it('makes one small mesh with at most two bones per vertex and normalised weights', () => {
    expect(limb.vertexCount).toBeGreaterThan(8);
    expect(limb.vertexCount).toBeLessThan(120);
    expect(m.weights!.length).toBe(limb.vertexCount);
    for (const w of m.weights!) {
      expect(w.length).toBeLessThanOrEqual(2);
      expect(w.reduce((s, [, v]) => s + v, 0)).toBeCloseTo(1, 3);
    }
  });

  it('weights ramp smoothly through the elbow: 100 % upper arm above, 50/50 at the joint, 100 % forearm below', () => {
    const pose = evalPose(rig, null, 0, { noIk: true });
    const elbow = pose.byName.get('lower_arm_R')!.pos;
    const sk = skinAttachment(m, 'upper_arm_R', pose, pose);
    let best = 0;
    let bd = Infinity;
    sk.verts.forEach((v, i) => {
      const d = Math.hypot(v.x - elbow.x, v.y - elbow.y);
      if (d < bd) {
        bd = d;
        best = i;
      }
    });
    const wl = Object.fromEntries(m.weights![best]!);
    expect(wl.upper_arm_R ?? 0).toBeGreaterThan(0.3);
    expect(wl.lower_arm_R ?? 0).toBeGreaterThan(0.3);
    const top = m.weights![0]!;
    expect(top).toEqual([['upper_arm_R', 1]]);
  });

  it('stays one connected, non-folded surface when the elbow bends 75 degrees', () => {
    const c = new ClipBuilder(rig, { name: 'bend', frames: 2, loop: false });
    c.rotate('lower_arm_R', [
      [0, 0],
      [2, 75],
    ]);
    const clip = c.build();
    const rest = evalPose(rig, null, 0, { noIk: true });
    const pose = evalPose(rig, clip, 2);
    const sk = skinAttachment(m, 'upper_arm_R', pose, rest);
    const r0 = skinAttachment(m, 'upper_arm_R', rest, rest);
    const area = (verts: typeof sk.verts, t: number) => {
      const [a, b, d] = [m.triangles[t]!, m.triangles[t + 1]!, m.triangles[t + 2]!].map((i) => verts[i]!) as [
        (typeof verts)[0],
        (typeof verts)[0],
        (typeof verts)[0],
      ];
      return (b.x - a.x) * (d.y - a.y) - (b.y - a.y) * (d.x - a.x);
    };
    let flipped = 0;
    for (let t = 0; t < m.triangles.length; t += 3)
      if (Math.sign(area(sk.verts, t)) !== Math.sign(area(r0.verts, t))) flipped++;
    expect(flipped).toBe(0);
  });

  it('rejects an empty part and a zero-length chain bone', () => {
    expect(() =>
      buildLimbMesh(rig, {
        name: 'x',
        slotBone: 'upper_arm_R',
        chain: ['upper_arm_R'],
        view,
        image: createImage(8, 8),
      }),
    ).toThrow(/no painted/);
    expect(() => buildLimbMesh(rig, { name: 'x', slotBone: 'root', chain: ['root'], view, image: img })).toThrow(
      /zero length/,
    );
  });
});

describe('buildSkirtMesh', () => {
  it('weights hips at the waist and the thighs at the hem, one connected panel', () => {
    const rig = buildReferenceHumanoid('E');
    const img = createImage(256, 256);
    for (let y = 100; y < 196; y++) for (let x = 100; x < 160; x++) img.data[(y * 256 + x) * 4 + 3] = 255;
    const s = buildSkirtMesh(rig, {
      name: 'robe_front',
      slotBone: 'hips',
      hips: 'hips',
      thighs: ['thigh_L', 'thigh_R'],
      view,
      image: img,
    });
    const m = s.attachment;
    expect(s.vertexCount).toBeGreaterThan(20);
    expect(s.vertexCount).toBeLessThan(260);
    const pose = evalPose(rig, null, 0, { noIk: true });
    const sk = skinAttachment(m, 'hips', pose, pose);
    const ys = sk.verts.map((v) => v.y);
    const top = m.weights![ys.indexOf(Math.max(...ys))]!;
    const bottom = m.weights![ys.indexOf(Math.min(...ys))]!;
    expect(top).toEqual([['hips', 1]]);
    expect(bottom.find(([b]) => b === 'hips')?.[1] ?? 0).toBeLessThan(0.05);
    for (const w of m.weights!) expect(w.reduce((a, [, v]) => a + v, 0)).toBeCloseTo(1, 3);
  });
});

describe('option validation', () => {
  const { rig, img } = armImage();
  const base = { name: 'a', slotBone: 'upper_arm_R', chain: ['upper_arm_R', 'lower_arm_R'], view, image: img };
  it('rejects step / ramp / cols / scale that would hang or give NaN weights', () => {
    for (const step of [0, -1, NaN, Infinity]) expect(() => buildLimbMesh(rig, { ...base, step })).toThrow(RangeError);
    for (const ramp of [0, -2, NaN, [4, 0]]) expect(() => buildLimbMesh(rig, { ...base, ramp })).toThrow(RangeError);
    for (const cols of [1, 6, 2.5]) expect(() => buildLimbMesh(rig, { ...base, cols })).toThrow(/cols/);
    expect(() => buildLimbMesh(rig, { ...base, view: { scale: 0, pivot: [64, 116] } })).toThrow(/scale/);
  });
  it('rejects a skirt cell <= 0 and a bad scale', () => {
    const sk = {
      name: 's',
      slotBone: 'hips',
      hips: 'hips',
      thighs: ['thigh_L', 'thigh_R'] as [string, string],
      view,
      image: img,
    };
    for (const cell of [0, -3, NaN]) expect(() => buildSkirtMesh(rig, { ...sk, cell })).toThrow(RangeError);
    expect(() => buildSkirtMesh(rig, { ...sk, view: { scale: -1, pivot: [64, 116] } })).toThrow(/scale/);
  });
});
