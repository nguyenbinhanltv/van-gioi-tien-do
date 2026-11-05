import { describe, expect, it } from 'vitest';
import {
  ClipBuilder,
  buildReferenceAtlas,
  buildReferenceHumanoid,
  checkSilhouette,
  countIslands,
  createImage,
  evalPose,
  fitToSilhouette,
  meshQa,
  runQa,
  skinAttachment,
  softenSeams,
  type MeshAttachment,
  type RigDocument,
} from '../src/index.js';

/**
 * Two rigid quads on connected joints (spine_mid below, spine_upper above) touching along y = 14 at rest, like the
 * rigid-island skinning of the real rig: bending the joint opens a seam between them.
 */
function twoPieceRig(): RigDocument {
  const base = buildReferenceHumanoid('E');
  const quad = (y0: number, bone: string): MeshAttachment => ({
    type: 'mesh',
    path: 'body',
    width: 20,
    height: 14,
    uvs: [0, 1, 1, 1, 1, 0, 0, 0],
    vertices: [-10, y0, 10, y0, 10, y0 + 14, -10, y0 + 14],
    triangles: [0, 1, 2, 0, 2, 3],
    weights: [[[bone, 1]], [[bone, 1]], [[bone, 1]], [[bone, 1]]],
  });
  // one mesh = two islands: lower quad on spine_mid (slot bone), upper quad (local y 14..28) on spine_upper
  const lower = quad(0, 'spine_mid');
  const upper = quad(14, 'spine_upper');
  const mesh: MeshAttachment = {
    ...lower,
    vertices: [...lower.vertices, ...upper.vertices],
    uvs: [...lower.uvs, ...upper.uvs],
    triangles: [...lower.triangles, ...upper.triangles.map((t) => t + 4)],
    weights: [...lower.weights!, ...upper.weights!],
  };
  return { ...base, skins: [{ name: 'default', attachments: { body: { body: mesh } } }] };
}

const bend = (rig: RigDocument, deg: number) => {
  const c = new ClipBuilder(rig, { name: 'bend', frames: 4, loop: false });
  c.rotate('spine_upper', [
    [0, 0],
    [4, deg],
  ]);
  return c.build();
};

describe('mesh QA', () => {
  const rig = twoPieceRig();

  it('keeps quiet when nothing bends and flags a seam that opens at a joint', () => {
    expect(meshQa(rig, bend(rig, 0))).toEqual([]);
    const issues = meshQa(rig, bend(rig, 70));
    expect(issues.find((i) => i.check === 'detach')!.severity).toBe('warning');
    expect(meshQa(rig, bend(rig, 70), { seamSeverity: 'error' }).some((i) => i.severity === 'error')).toBe(true);
    expect(issues.some((i) => i.check === 'detach' && /come apart/.test(i.message))).toBe(true);
    expect(runQa(rig, bend(rig, 70)).issues.some((i) => i.check === 'detach')).toBe(true);
  });

  it('flags mesh stretch when two weighted bones pull a piece apart', () => {
    const stretched: RigDocument = {
      ...rig,
      skins: [
        {
          name: 'default',
          attachments: {
            body: {
              body: {
                type: 'mesh',
                path: 'body',
                width: 20,
                height: 28,
                uvs: [0, 1, 1, 1, 1, 0, 0, 0],
                vertices: [-10, 0, 10, 0, 10, 28, -10, 28],
                triangles: [0, 1, 2, 0, 2, 3],
                weights: [[['spine_mid', 1]], [['spine_mid', 1]], [['head', 1]], [['head', 1]]],
              },
            },
          },
        },
      ],
    };
    const c = new ClipBuilder(stretched, { name: 'pull', frames: 4, loop: false });
    c.translate('hips', [
      [0, 0, 0],
      [4, 0, 0],
    ]);
    c.rotate('head', [
      [0, 0],
      [4, 0],
    ]);
    c.translate('head', [
      [0, 0, 0],
      [4, 30, 0],
    ]);
    expect(meshQa(stretched, c.build()).some((i) => i.check === 'mesh-strain')).toBe(true);
  });

  it('softenSeams gives the shared edge both bones and closes the seam', () => {
    const soft = softenSeams(rig);
    const mesh = soft.skins[0]!.attachments.body!.body as MeshAttachment;
    // upper quad bottom edge (vertices 4, 5) and lower quad top edge (vertices 2, 3) now share spine_mid + spine_upper
    for (const v of [2, 3, 4, 5])
      expect(mesh.weights![v]!.map(([b]) => b).sort()).toEqual(['spine_mid', 'spine_upper']);
    expect(mesh.weights![0]).toEqual([['spine_mid', 1]]); // the far corners stay rigid
    expect(meshQa(soft, bend(soft, 70)).filter((i) => i.check === 'detach')).toEqual([]);
    expect(rig.skins[0]!.attachments.body!.body).not.toBe(mesh); // input untouched
  });

  it('skinAttachment follows weights', () => {
    const pose = evalPose(rig, bend(rig, 90), 4);
    const rest = evalPose(rig, null, 0, { noIk: true });
    const m = skinAttachment(rig.skins[0]!.attachments.body!.body!, 'hips', pose, rest);
    const r = skinAttachment(rig.skins[0]!.attachments.body!.body!, 'hips', rest, rest);
    expect(m.verts[0]).toEqual(r.verts[0]); // rigid on the lower bone
    expect(Math.hypot(m.verts[6]!.x - r.verts[6]!.x, m.verts[6]!.y - r.verts[6]!.y)).toBeGreaterThan(5);
  });
});

describe('silhouette islands', () => {
  it('counts 8-connected blobs and ignores specks', () => {
    const img = createImage(20, 10);
    const set = (x: number, y: number) => img.data.set([255, 255, 255, 255], (y * 20 + x) * 4);
    for (let y = 1; y < 5; y++) for (let x = 1; x < 6; x++) set(x, y);
    for (let y = 1; y < 5; y++) for (let x = 12; x < 17; x++) set(x, y);
    set(9, 8); // speck
    expect(countIslands(img, 8)).toBe(2);
    expect(countIslands(img, 1)).toBe(3);
    set(6, 5); // diagonal touch joins nothing new; blob stays one
    expect(countIslands(img, 8)).toBe(2);
  });

  it('flags a piece that tears away and fitToSilhouette limits the swing that causes it', () => {
    const rig = buildReferenceHumanoid('E');
    const { atlas } = buildReferenceAtlas(rig);
    const c = new ClipBuilder(rig, { name: 'fling', frames: 4, loop: false });
    c.rotate('head', [
      [0, 0],
      [4, 0],
    ]);
    // lift the whole arm piece away from the body by translating its bone: the arm island separates
    c.translate('upper_arm_R', [
      [0, 0, 0],
      [4, 40, 40],
    ]);
    const clip = c.build();
    expect(checkSilhouette(rig, clip, atlas, { minPixels: 20 }).length).toBe(1);
    const calm = new ClipBuilder(rig, { name: 'calm', frames: 4, loop: false });
    calm.rotate('upper_arm_R', [
      [0, 0],
      [4, 10],
    ]);
    expect(checkSilhouette(rig, calm.build(), atlas, { minPixels: 20 })).toEqual([]);
    const fitted = fitToSilhouette(rig, calm.build(), atlas);
    expect(fitted.ok).toBe(true);
    expect(fitted.gains.every((g) => g === 1)).toBe(true);
  });
});

describe('seam hitch (velocity vectors)', () => {
  it('does not flag a natural direction reversal but flags a velocity jump', () => {
    const rig = buildReferenceHumanoid('E');
    const smooth = new ClipBuilder(rig, { name: 'sway', frames: 20, loop: true });
    smooth.translate(
      'hips',
      Array.from({ length: 21 }, (_, f): [number, number, number] => [
        f,
        3 * Math.sin((2 * Math.PI * f) / 20),
        1.5 * Math.cos((2 * Math.PI * f) / 20) - 1.5,
      ]),
    );
    expect(runQa(rig, smooth.build()).issues.filter((i) => i.check === 'loop-seam')).toEqual([]);
    const hitch = new ClipBuilder(rig, { name: 'hitch', frames: 20, loop: true });
    // keys 0..19 are a steady drift, the closing key snaps back: velocity at the seam jumps
    hitch.translate('hips', [
      [0, 0, 0],
      [10, 6, 0],
      [19, 12, 0],
      [20, 0, 0],
    ]);
    expect(
      runQa(rig, hitch.build()).issues.some((i) => i.check === 'loop-seam' && /velocity jumps/.test(i.message)),
    ).toBe(true);
  });
});
