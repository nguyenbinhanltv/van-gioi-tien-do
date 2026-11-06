/**
 * Assemble a continuous-limb character direction (D39) from separately painted parts: one full-canvas PNG per piece plus
 * `landmarks.json`. Engine-free and file-free (images in, rig + atlas out); `scripts/assemble-continuous.ts` does the I/O.
 *
 * Steps: bones follow the art landmarks (`applyLandmarks`); hanging pieces (ponytail, hair strands, ribbon / sash tails,
 * pendant) get a bone chain laid along the painted shape and are grouped into the detail chains (`DETAIL_GROUPS`);
 * limbs, torso and vest become strip meshes with smooth two-bone weights (`buildLimbMesh`), skirts grid meshes weighted
 * to hips and thighs (`buildSkirtMesh`), everything else rigid quads; hand / eye / mouth variants share one slot as
 * displays; all crops are packed into one atlas page.
 */
import { RIG_LIMITS } from '@vgtd/character';
import { applyLandmarks, type Landmarks } from './landmarks.js';
import { buildLimbMesh, buildSkirtMesh, type CanvasView } from './limb.js';
import { DETAIL_CHAINS, DETAIL_GROUPS } from './detail.js';
import { applyMat, invertMat, type Vec2 } from './math.js';
import { evalPose } from './pose.js';
import { createImage, type Image } from './render/image.js';
import type {
  AtlasData,
  AtlasRegion,
  MeshAttachment,
  RegionAttachment,
  RigBone,
  RigChain,
  RigDocument,
  RigSlot,
} from './schema.js';

/** Binding of one painted part to the rig. */
type Binding =
  | { readonly kind: 'rigid'; readonly bone: string }
  | {
      readonly kind: 'limb';
      readonly chain: readonly string[];
      readonly ramp?: number;
      readonly cols?: number;
      readonly step?: number;
    }
  | { readonly kind: 'skirt' }
  | { readonly kind: 'hanging'; readonly template: string; readonly cols?: number }
  /** Rigid on the last bone of another hanging piece (tassel under the pendant). */
  | { readonly kind: 'tip'; readonly of: string };

export interface PieceSpec {
  /** Part file name without extension; also the attachment name. */
  readonly id: string;
  /** Slot the part is displayed in (variants of one slot are display swaps). */
  readonly slot: string;
  readonly binding: Binding;
  /** Paperdoll tag, only where the draw order agrees with the paperdoll order of the direction. */
  readonly paperdoll?: RigSlot['paperdoll'];
  readonly blend?: RigSlot['blend'];
  /** The slot starts with no attachment shown (trail / glint layers, driven by clip keys). */
  readonly hidden?: boolean;
  /**
   * Part files drawn together (back to front) into this piece at assembly time, to stay inside the slot budget: the
   * sources stay separate files, only the atlas piece is composited. Missing sources are skipped.
   */
  readonly compose?: readonly string[];
}

const SPINE = ['hip', 'spine_mid', 'spine_upper'] as const;
const hand = (side: 'L' | 'R', v: string): PieceSpec => ({
  id: `hand_${side}_${v}`,
  slot: `hand_${side}`,
  binding: { kind: 'rigid', bone: `hand_${side}` },
});

/** Pieces of the Kiếm tu E pilot in back-to-front draw order. Missing files are skipped. */
export const E_PIECES: readonly PieceSpec[] = [
  { id: 'shadow', slot: 'shadow', binding: { kind: 'rigid', bone: 'root' } },
  {
    id: 'hair_back',
    slot: 'hair_back',
    binding: { kind: 'rigid', bone: 'head' },
    paperdoll: 'hair_back',
    compose: ['hair_back', 'hair_bun'],
  },
  { id: 'ponytail', slot: 'ponytail', binding: { kind: 'hanging', template: 'ponytail' } },
  { id: 'ribbon_tail_L', slot: 'ribbon_tail_L', binding: { kind: 'hanging', template: 'ribbon_tail_L' } },
  { id: 'ribbon_tail_R', slot: 'ribbon_tail_R', binding: { kind: 'hanging', template: 'ribbon_tail_R' } },
  { id: 'leg_L', slot: 'leg_L', binding: { kind: 'limb', chain: ['thigh_L', 'shin_L', 'foot_L'], step: 7, ramp: 7 } },
  { id: 'robe_back', slot: 'robe_back', binding: { kind: 'skirt' } },
  // hem strips are thin, WIDE bands: a vertical hanging chain gives them a ~2 px lever arm and flips them into X shapes
  // under the feet, so they stay skirt-weighted (hips + thighs) like the robe they belong to
  { id: 'robe_hem_back', slot: 'robe_hem_back', binding: { kind: 'skirt' } },
  { id: 'torso', slot: 'torso', binding: { kind: 'limb', chain: SPINE, ramp: 6, step: 8 }, paperdoll: 'body' },
  {
    id: 'arm_L',
    slot: 'arm_L',
    binding: { kind: 'limb', chain: ['upper_arm_L', 'lower_arm_L', 'hand_L'], step: 6, ramp: 6 },
  },
  {
    id: 'sleeve_trim_L',
    slot: 'sleeve_trim_L',
    binding: { kind: 'hanging', template: 'sleeve_edge_L', cols: 3 },
    compose: ['sleeve_lining_L', 'cuff_L'],
  },
  hand('L', 'relaxed'),
  hand('L', 'grip'),
  hand('L', 'fist'),
  hand('L', 'palm'),
  hand('L', 'seal'),
  { id: 'boot_L', slot: 'boot_L', binding: { kind: 'rigid', bone: 'foot_L' } },
  { id: 'leg_R', slot: 'leg_R', binding: { kind: 'limb', chain: ['thigh_R', 'shin_R', 'foot_R'], step: 7, ramp: 7 } },
  { id: 'boot_R', slot: 'boot_R', binding: { kind: 'rigid', bone: 'foot_R' } },
  { id: 'robe_inner', slot: 'robe_inner', binding: { kind: 'skirt' } },
  { id: 'robe_front', slot: 'robe_front', binding: { kind: 'skirt' } },
  // hem strips are thin, WIDE bands: a vertical hanging chain gives them a ~2 px lever arm and flips them into X shapes
  // under the feet, so they stay skirt-weighted (hips + thighs) like the robe they belong to
  { id: 'robe_hem_front', slot: 'robe_hem_front', binding: { kind: 'skirt' } },
  { id: 'vest', slot: 'vest', binding: { kind: 'limb', chain: SPINE, ramp: 6, step: 8 }, paperdoll: 'outfit_upper' },
  {
    id: 'vest_edges',
    slot: 'vest_edges',
    binding: { kind: 'rigid', bone: 'spine_upper' },
    compose: ['vest_edge_L', 'vest_edge_R'],
  },
  { id: 'scabbard', slot: 'scabbard', binding: { kind: 'rigid', bone: 'scabbard' } },
  { id: 'sash_set', slot: 'sash_set', binding: { kind: 'rigid', bone: 'hip' }, compose: ['sash', 'sash_knot'] },
  { id: 'sash_tail_L', slot: 'sash_tail_L', binding: { kind: 'hanging', template: 'sash_tail_L' } },
  { id: 'sash_tail_R', slot: 'sash_tail_R', binding: { kind: 'hanging', template: 'sash_tail_R' } },
  { id: 'pendant', slot: 'pendant', binding: { kind: 'hanging', template: 'pendant' } },
  { id: 'tassel', slot: 'tassel', binding: { kind: 'tip', of: 'pendant' } },
  {
    id: 'arm_R',
    slot: 'arm_R',
    binding: { kind: 'limb', chain: ['upper_arm_R', 'lower_arm_R', 'hand_R'], step: 6, ramp: 6 },
  },
  {
    id: 'sleeve_trim_R',
    slot: 'sleeve_trim_R',
    binding: { kind: 'hanging', template: 'sleeve_edge_R', cols: 3 },
    compose: ['sleeve_lining_R', 'cuff_R'],
  },
  hand('R', 'grip'),
  hand('R', 'relaxed'),
  hand('R', 'fist'),
  hand('R', 'palm'),
  hand('R', 'seal'),
  {
    id: 'head',
    slot: 'head',
    binding: { kind: 'rigid', bone: 'head' },
    paperdoll: 'head',
    compose: ['head', 'brows'],
  },
  { id: 'eyes_open', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'eyes_half', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'eyes_closed', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_neutral', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_open', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_smile', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'hair_front_1', slot: 'hair_strand_a', binding: { kind: 'hanging', template: 'hair_strand_a' } },
  { id: 'hair_front_2', slot: 'hair_strand_b', binding: { kind: 'hanging', template: 'hair_strand_b' } },
  { id: 'hair_front_3', slot: 'hair_strand_c', binding: { kind: 'hanging', template: 'hair_strand_c' } },
  { id: 'hairpin', slot: 'hairpin', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'weapon_R', slot: 'weapon_R', binding: { kind: 'rigid', bone: 'weapon' }, paperdoll: 'weapon_R' },
  {
    id: 'sword_trail',
    slot: 'sword_trail',
    binding: { kind: 'rigid', bone: 'weapon' },
    blend: 'additive',
    hidden: true,
  },
  {
    id: 'sword_glint',
    slot: 'sword_glint',
    binding: { kind: 'rigid', bone: 'weapon' },
    blend: 'additive',
    hidden: true,
  },
];

export interface WeaponPiece {
  /** Mesh attachment bound to the weapon bone (vertices already in that bone's space). */
  readonly attachment: MeshAttachment;
  /** Pixels of the weapon, cropped from the old atlas page; `attachment.uvs` are relative to this crop. */
  readonly crop: Image;
}

export interface AssembleInput {
  /** Existing rig of the direction: roles, IK, sockets, weapon bone and everything not replaced here. */
  readonly base: RigDocument;
  readonly landmarks: Landmarks;
  readonly view: CanvasView;
  /** Full-canvas premultiplied part images by part id. */
  readonly parts: ReadonlyMap<string, Image>;
  readonly pieces?: readonly PieceSpec[];
  /** Sword art borrowed from the old atlas until the new sword is painted. */
  readonly weapon?: WeaponPiece;
  /** Bones removed from the base rig (old chains, panels, strands). Default: everything the new parts replace. */
  readonly dropBones?: readonly string[];
  readonly atlasName?: string;
  readonly maxAtlas?: number;
}

export interface AssembleResult {
  readonly rig: RigDocument;
  readonly atlas: { readonly data: AtlasData; readonly image: Image };
  readonly used: readonly string[];
  readonly missing: readonly string[];
  readonly skipped: readonly string[];
  readonly stats: {
    readonly bones: number;
    readonly slots: number;
    readonly vertices: number;
    readonly chains: number;
    /** Factor by which the mesh grid/strip steps were coarsened to fit the vertex budget (1 = as designed). */
    readonly meshScale: number;
    /** Atlas pixels with colour above alpha (must be 0 for the premultiplied page). */
    readonly nonPremultiplied: number;
    /** The docs/03 limits of the rig kind (`RIG_LIMITS`), to read the headroom: `vertices` of `limits.meshVertices`. */
    readonly limits: {
      readonly bones: number;
      readonly slots: number;
      readonly meshVertices: number;
      readonly chains: number;
    };
  };
}

/** Atlas contract (docs/art): padding 2 between regions, extrude 1, premultiplied alpha. */
export const ATLAS_PADDING = 2;
export const ATLAS_EXTRUDE = 1;

const ALPHA = 8;

/** Hang length (px @1x) of a thin band that gets a chain bone. */
const MIN_HANG = 6;

/** Mesh vertices kept free below the RIG_LIMITS budget (600 -> 560 target) so a repainted part does not break the rig. */
const MESH_HEADROOM = 40;

/** Old chain / strand / panel bones that the new parts replace (the weapon bone and IK stay). */
const REPLACED_BONES = [
  'hair_back_1',
  'hair_back_2',
  'hair_front_1',
  'hair_front_2',
  'ribbon_1',
  'ribbon_2',
  'sash_L_1',
  'sash_L_2',
  'sash_R_1',
  'sash_R_2',
  'sleeve_tip_L',
  'sleeve_tip_R',
  'robe_front',
  'robe_back',
];

function painted(image: Image, view: CanvasView): Vec2[] {
  const out: Vec2[] = [];
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (image.data[(y * image.width + x) * 4 + 3]! >= ALPHA)
        out.push({ x: (x + 0.5) / view.scale - view.pivot[0], y: view.pivot[1] - (y + 0.5) / view.scale });
  return out;
}

function bboxOf(image: Image, pad = 2) {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < image.height; y++)
    for (let x = 0; x < image.width; x++)
      if (image.data[(y * image.width + x) * 4 + 3]! >= ALPHA) {
        x0 = Math.min(x0, x);
        y0 = Math.min(y0, y);
        x1 = Math.max(x1, x + 1);
        y1 = Math.max(y1, y + 1);
      }
  if (x1 < 0) return null;
  const x = Math.max(0, x0 - pad);
  const y = Math.max(0, y0 - pad);
  return { x, y, width: Math.min(image.width, x1 + pad) - x, height: Math.min(image.height, y1 + pad) - y };
}

/** A rigid part: a region attachment (not counted as mesh vertices) covering the painted bounding box, on `bone`. */
function rigidRegion(
  rig: RigDocument,
  name: string,
  bone: string,
  image: Image,
  view: CanvasView,
): { attachment: RegionAttachment; crop: { x: number; y: number; width: number; height: number } } | null {
  const crop = bboxOf(image);
  if (!crop) return null;
  const b = evalPose(rig, null, 0, { noIk: true }).byName.get(bone);
  if (!b) throw new RangeError(`unknown bone '${bone}' for part '${name}'`);
  const centre = {
    x: (crop.x + crop.width / 2) / view.scale - view.pivot[0],
    y: view.pivot[1] - (crop.y + crop.height / 2) / view.scale,
  };
  const local = applyMat(invertMat(b.world), centre);
  return {
    attachment: {
      type: 'region',
      path: name,
      x: Math.round(local.x * 1e3) / 1e3,
      y: Math.round(local.y * 1e3) / 1e3,
      rotation: Math.round(-b.rotation * 1e3) / 1e3,
      width: crop.width / view.scale,
      height: crop.height / view.scale,
    },
    crop,
  };
}

/** Composite premultiplied images back to front. */
function over(layers: readonly Image[]): Image {
  const out = createImage(layers[0]!.width, layers[0]!.height);
  for (const l of layers)
    for (let i = 0; i < out.width * out.height; i++) {
      const a = l.data[i * 4 + 3]!;
      for (let k = 0; k < 4; k++) out.data[i * 4 + k] = l.data[i * 4 + k]! + (out.data[i * 4 + k]! * (255 - a)) / 255;
    }
  return out;
}

function cropImage(image: Image, c: { x: number; y: number; width: number; height: number }): Image {
  const out = createImage(c.width, c.height);
  for (let y = 0; y < c.height; y++)
    for (let x = 0; x < c.width; x++) {
      const s = ((c.y + y) * image.width + c.x + x) * 4;
      const d = (y * c.width + x) * 4;
      for (let k = 0; k < 4; k++) out.data[d + k] = image.data[s + k]!;
    }
  return out;
}

/** Shelf packer: tallest first, rows left to right. Returns null when the crops do not fit `size` × `size`. */
function pack(items: readonly { id: string; w: number; h: number }[], size: number, pad: number) {
  const order = [...items].sort((a, b) => b.h - a.h || a.id.localeCompare(b.id));
  const pos = new Map<string, { x: number; y: number }>();
  let x = pad;
  let y = pad;
  let rowH = 0;
  for (const it of order) {
    if (x + it.w + pad > size) {
      x = pad;
      y += rowH + pad;
      rowH = 0;
    }
    if (y + it.h + pad > size || it.w + 2 * pad > size) return null;
    pos.set(it.id, { x, y });
    x += it.w + pad;
    rowH = Math.max(rowH, it.h);
  }
  return pos;
}

/** Lay a bone chain of `segments` equal bones along the painted shape from its top end to its bottom end. */
function hangingBones(
  base: RigDocument,
  name: string,
  parent: string,
  segments: number,
  pts: readonly Vec2[],
): { bones: RigBone[]; ids: string[] } | null {
  if (!pts.length) return null;
  const maxY = Math.max(...pts.map((p) => p.y));
  const minY = Math.min(...pts.map((p) => p.y));
  const mean = (sel: Vec2[]): Vec2 => ({
    x: sel.reduce((a, p) => a + p.x, 0) / sel.length,
    y: sel.reduce((a, p) => a + p.y, 0) / sel.length,
  });
  // a thin band (cuff, hem strip) has no length of its own: hang it straight down from its top edge by MIN_HANG px
  const thin = maxY - minY < 2 * 3 + 2;
  const root = mean(pts.filter((p) => p.y >= maxY - (thin ? 1 : 3)));
  const end = thin
    ? { x: root.x, y: root.y - Math.max(MIN_HANG, maxY - minY) }
    : mean(pts.filter((p) => p.y <= minY + 3));
  const len = Math.hypot(end.x - root.x, end.y - root.y);
  if (len < 2) return null;
  const angle = Math.atan2(end.y - root.y, end.x - root.x);
  const deg = (angle * 180) / Math.PI;
  const rest = evalPose(base, null, 0, { noIk: true });
  const pw = rest.byName.get(parent);
  if (!pw) return null;
  const local = applyMat(invertMat(pw.world), root);
  const seg = len / segments;
  const ids = Array.from({ length: segments }, (_, i) => `${name}_${i + 1}`);
  const bones = ids.map((id, i): RigBone =>
    i === 0
      ? { name: id, parent, length: seg, x: local.x, y: local.y, rotation: deg - pw.rotation }
      : { name: id, parent: ids[i - 1]!, length: seg, x: seg, y: 0, rotation: 0 },
  );
  return { bones, ids };
}

/** Number of atlas pixels whose colour exceeds their alpha: 0 for a valid premultiplied page (catches a wrong decode flag). */
export function nonPremultipliedPixels(image: Image): number {
  let n = 0;
  for (let i = 0; i < image.width * image.height; i++) {
    const a = image.data[i * 4 + 3]!;
    if (image.data[i * 4]! > a + 1 || image.data[i * 4 + 1]! > a + 1 || image.data[i * 4 + 2]! > a + 1) n++;
  }
  return n;
}

export function assembleContinuous(input: AssembleInput): AssembleResult {
  const { view } = input;
  const pieces = input.pieces ?? E_PIECES;
  const maxAtlas = input.maxAtlas ?? 2048;
  const limits = RIG_LIMITS[input.base.kind === 'boss' ? 'boss' : input.base.kind === 'pet' ? 'pet' : 'player'];
  const drop = new Set(input.dropBones ?? REPLACED_BONES);
  const missing: string[] = [];
  const skipped: string[] = [];

  // 1. bones: base minus replaced ones, following the landmarks
  const kept: RigBone[] = input.base.bones.filter((b) => !drop.has(b.name));
  const withLandmarks = applyLandmarks({ ...input.base, bones: kept, chains: [] }, input.landmarks, view);
  let bones: RigBone[] = [...withLandmarks.bones];
  const chains: RigChain[] = [];
  const templates = new Map(DETAIL_CHAINS.map((t) => [t.name, t]));
  const groupOf = new Map(DETAIL_GROUPS.flatMap((g) => g.members.map((m) => [m, g] as const)));
  const hangingIds = new Map<string, string[]>();

  // composed pieces (several part files drawn into one piece) come first: chains and meshes use the composites
  const images = new Map(input.parts);
  for (const spec of pieces) {
    if (!spec.compose) continue;
    const srcs = spec.compose.map((id) => input.parts.get(id)).filter((i): i is Image => !!i);
    if (!srcs.length) continue;
    images.set(spec.id, over(srcs));
  }
  // 2. hanging chains laid along the art
  for (const p of pieces) {
    if (p.binding.kind !== 'hanging') continue;
    const img = images.get(p.id);
    const t = templates.get(p.binding.template);
    if (!img || !t) continue;
    const parent = withLandmarks.roles[t.parent as keyof typeof withLandmarks.roles] ?? t.parent;
    const made = hangingBones(withLandmarks, t.name, parent, t.segments, painted(img, view));
    if (!made) {
      skipped.push(`${p.id}: no usable shape for a chain`);
      continue;
    }
    bones = [...bones, ...made.bones];
    hangingIds.set(t.name, made.ids);
    const g = groupOf.get(t.name)!;
    const existing = chains.findIndex((c) => c.name === g.name);
    if (existing >= 0) chains[existing] = { ...chains[existing]!, bones: [...chains[existing]!.bones, ...made.ids] };
    else
      chains.push({
        name: g.name,
        kind: g.kind,
        bones: made.ids,
        stiffness: g.stiffness,
        damping: g.damping,
        ...(g.gravity ? { gravity: g.gravity } : {}),
        maxAngle: g.maxAngle,
      });
  }
  const skeleton: RigDocument = { ...withLandmarks, bones, chains };

  // 3. meshes
  interface Made {
    readonly attachment: MeshAttachment | RegionAttachment;
    readonly crop: { x: number; y: number; width: number; height: number };
  }
  interface Built {
    readonly spec: PieceSpec;
    readonly mesh: Made;
    readonly slotBone: string;
  }
  const buildAll = (scale: number) => {
    const built: Built[] = [];
    const missingNow: string[] = [];
    const skippedNow: string[] = [];
    for (const spec of pieces) {
      const img = images.get(spec.id);
      if (!img) {
        missingNow.push(spec.id);
        continue;
      }
      const b = spec.binding;
      let mesh: Made | null = null;
      let slotBone = '';
      try {
        if (b.kind === 'rigid') {
          slotBone = b.bone;
          mesh = rigidRegion(skeleton, spec.id, b.bone, img, view);
        } else if (b.kind === 'limb') {
          slotBone = b.chain[0]!;
          mesh = buildLimbMesh(skeleton, {
            name: spec.id,
            slotBone,
            chain: b.chain,
            view,
            image: img,
            cols: b.cols ?? 3,
            step: (b.step ?? 5) * scale,
            ...(b.ramp ? { ramp: b.ramp } : {}),
          });
        } else if (b.kind === 'skirt') {
          const r = skeleton.roles;
          slotBone = r.hips!;
          mesh = buildSkirtMesh(skeleton, {
            name: spec.id,
            slotBone,
            hips: r.hips!,
            thighs: [r.thigh_L!, r.thigh_R!],
            view,
            image: img,
            cell: 10 * scale,
          });
        } else if (b.kind === 'hanging') {
          const ids = hangingIds.get(b.template);
          if (!ids) {
            skippedNow.push(`${spec.id}: chain not created`);
            continue;
          }
          slotBone = ids[0]!;
          mesh = buildLimbMesh(skeleton, {
            name: spec.id,
            slotBone,
            chain: ids,
            view,
            image: img,
            ramp: 2.5,
            step: 4 * scale,
            cols: b.cols ?? 2,
          });
        } else {
          const ids = hangingIds.get(b.of);
          if (!ids) {
            skippedNow.push(`${spec.id}: needs the '${b.of}' chain`);
            continue;
          }
          slotBone = ids[ids.length - 1]!;
          mesh = rigidRegion(skeleton, spec.id, slotBone, img, view);
        }
      } catch (e) {
        skippedNow.push(`${spec.id}: ${(e as Error).message}`);
        continue;
      }
      if (!mesh) {
        skippedNow.push(`${spec.id}: empty image`);
        continue;
      }
      built.push({ spec, mesh, slotBone });
    }
    return { built, missingNow, skippedNow };
  };
  // the grid / strip steps coarsen together until the meshes fit the vertex budget (a little headroom kept)
  const meshVerts = (bs: readonly Built[]) =>
    bs.reduce((n, x) => n + (x.mesh.attachment.type === 'mesh' ? x.mesh.attachment.vertices.length / 2 : 0), 0) +
    (input.weapon ? 4 : 0);
  let meshScale = 1;
  let result = buildAll(meshScale);
  while (meshVerts(result.built) > limits.meshVertices - MESH_HEADROOM && meshScale < 2.5) {
    meshScale = Math.round((meshScale + 0.1) * 100) / 100;
    result = buildAll(meshScale);
  }
  const built = result.built;
  missing.push(...result.missingNow);
  skipped.push(...result.skippedNow);

  // 4. weapon borrowed from the old atlas
  const crops = new Map<string, Image>();
  for (const bt of built) crops.set(bt.spec.id, cropImage(images.get(bt.spec.id)!, bt.mesh.crop));
  const borrowWeapon = input.weapon && !built.some((b) => b.spec.id === 'weapon_R') ? input.weapon : undefined;
  if (borrowWeapon) crops.set('weapon_R', borrowWeapon.crop);

  // 5. atlas
  const items = [...crops].map(([id, im]) => ({ id, w: im.width, h: im.height }));
  const pad = ATLAS_PADDING;
  let size = 256;
  let pos: ReturnType<typeof pack> = null;
  while (size <= maxAtlas && !(pos = pack(items, size, pad))) size *= 2;
  if (!pos) throw new RangeError(`parts do not fit a ${maxAtlas}x${maxAtlas} atlas page`);
  const image = createImage(size, size);
  const regions: AtlasRegion[] = [];
  for (const [id, im] of crops) {
    const at = pos.get(id)!;
    for (let y = 0; y < im.height; y++)
      for (let x = 0; x < im.width; x++) {
        const s = (y * im.width + x) * 4;
        const d = ((at.y + y) * size + at.x + x) * 4;
        for (let k = 0; k < 4; k++) image.data[d + k] = im.data[s + k]!;
      }
    // extrude 1: repeat the edge pixels one pixel outward (no bleeding from neighbours under bilinear filtering)
    for (let y = -1; y <= im.height; y++)
      for (let x = -1; x <= im.width; x++) {
        if (x >= 0 && y >= 0 && x < im.width && y < im.height) continue;
        const sx = Math.min(im.width - 1, Math.max(0, x));
        const sy = Math.min(im.height - 1, Math.max(0, y));
        const s = (sy * im.width + sx) * 4;
        const d = ((at.y + y) * size + at.x + x) * 4;
        for (let k = 0; k < 4; k++) image.data[d + k] = im.data[s + k]!;
      }
    regions.push({ name: id, x: at.x, y: at.y, width: im.width, height: im.height });
  }

  // 6. slots + skin (a slot's first attachment is its default; the weapon slot keeps its paperdoll tag)
  const slots: RigSlot[] = [];
  const attachments: Record<string, Record<string, MeshAttachment | RegionAttachment>> = {};
  for (const { spec, mesh, slotBone } of built) {
    let slot = slots.find((s) => s.name === spec.slot);
    if (!slot) {
      slot = {
        name: spec.slot,
        bone: slotBone,
        attachment: spec.hidden ? null : spec.id,
        ...(spec.paperdoll ? { paperdoll: spec.paperdoll } : {}),
        ...(spec.blend ? { blend: spec.blend } : {}),
      };
      slots.push(slot);
    }
    (attachments[spec.slot] ??= {})[spec.id] = mesh.attachment;
  }
  if (borrowWeapon) {
    slots.push({ name: 'weapon_R', bone: 'weapon', paperdoll: 'weapon_R', attachment: 'weapon_R' });
    attachments.weapon_R = { weapon_R: { ...borrowWeapon.attachment, path: 'weapon_R' } };
  }
  const rig: RigDocument = {
    ...skeleton,
    slots,
    skins: [{ name: 'default', attachments }],
  };
  const vertices = Object.values(attachments).reduce(
    (n, m) => n + Object.values(m).reduce((k, a) => k + (a.type === 'mesh' ? a.vertices.length / 2 : 0), 0),
    0,
  );
  return {
    rig,
    atlas: {
      data: {
        imagePath: `${input.atlasName ?? 'kiemtu_E'}_tex.png`,
        width: size,
        height: size,
        premultipliedAlpha: true,
        regions,
      },
      image,
    },
    used: built.map((b) => b.spec.id),
    missing,
    skipped,
    stats: {
      bones: bones.length,
      slots: slots.length,
      vertices,
      chains: chains.length,
      meshScale,
      nonPremultiplied: nonPremultipliedPixels(image),
      limits: {
        bones: limits.bones,
        slots: limits.slots,
        meshVertices: limits.meshVertices,
        chains: limits.physicsConstraints,
      },
    },
  };
}
