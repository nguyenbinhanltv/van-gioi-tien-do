/**
 * DragonBones 5.5 exporter (ske.json + tex.json). Target runtime: Cocos Creator 3.8.8 built-in `dragon-bones`
 * (reads data up to 5.6.300; the native parser's `DATA_VERSION` is 5.5), so we emit `version`/`compatibleVersion`
 * "5.5". The structure follows the engine's `ObjectDataParser` (inspected in `@cocos/dragonbones-js`):
 * bone timelines are `translateFrame` / `rotateFrame` / `scaleFrame`, curves are `curve:[x1,y1,x2,y2]`, slot timelines
 * are `displayFrame` / `colorFrame`, IK timelines are `ik`, events live on the animation-level `frame` list.
 *
 * Coordinate boundary: rig space is y-up / CCW (ADR-021); DragonBones is y-down / CW, so y and rotation flip here.
 */
import { pivotOf } from '@vgtd/character';
import { CLIP_FPS, type Clip, type Curve, type Key } from './clip.js';
import type { Mat, Vec2 } from './math.js';
import { evalPose } from './pose.js';
import type { AtlasData, RigAttachment, RigDocument } from './schema.js';

export const DRAGONBONES_DATA_VERSION = '5.5' as const;
/** Highest DragonBones data version the Cocos 3.8.8 runtime reads (ArmatureDisplay doc comment). */
export const COCOS_MAX_DATA_VERSION = '5.6.300' as const;

type Json = Record<string, unknown>;

export interface DragonBonesExport {
  readonly ske: Json;
  readonly tex: Json;
}

export interface ExportEntry {
  readonly rig: RigDocument;
  readonly clips: readonly Clip[];
}

export interface ExportOptions {
  /** DragonBones data name (shared by ske and tex so the factory links them). */
  readonly name: string;
  /** Armature name per entry. Default: the rig's direction (`S`, `SE`, ...). */
  readonly armatureName?: (rig: RigDocument) => string;
  /** Default fade-in time (s) written on every animation. Default 0.1. */
  readonly fadeInTime?: number;
}

const r4 = (v: number) => Math.round(v * 1e4) / 1e4 + 0; // + 0 turns −0 into 0

/** Rig-space (y up, CCW) → DragonBones transform (y down, CW). */
function dbTransform(x: number, y: number, rotation: number, scaleX = 1, scaleY = 1): Json {
  const t: Json = {};
  if (x) t.x = r4(x);
  if (y) t.y = r4(-y);
  if (rotation) {
    t.skX = r4(-rotation);
    t.skY = r4(-rotation);
  }
  if (scaleX !== 1) t.scX = r4(scaleX);
  if (scaleY !== 1) t.scY = r4(scaleY);
  return t;
}

/** Rig-space (y up) world matrix → DragonBones data-space (y down): F·M·F with F = diag(1, −1). */
function dbMatrix(m: Mat): number[] {
  return [m.a, -m.b, -m.c, m.d, m.tx, -m.ty].map(r4);
}

interface AttachmentContext {
  readonly rig: RigDocument;
  /** Slot-bone world matrix at the rest pose. */
  readonly slotMatrix: Mat;
  readonly boneWorld: ReadonlyMap<string, Mat>;
  /** Packed pixel size per atlas region name (atlas textures may be 2x the logical 1x geometry). */
  readonly regions: ReadonlyMap<string, { width: number; height: number }>;
}

function exportAttachment(a: RigAttachment, ctx: AttachmentContext): Json {
  if (a.type === 'region') {
    // A DragonBones image is drawn at its texture's pixel size. When the atlas is packed at 2x (logical geometry 1x),
    // scale by logical size / packed size so the part keeps its rig-space width and height.
    const px = ctx.regions.get(a.path);
    const fx = px && px.width > 0 ? a.width / px.width : 1;
    const fy = px && px.height > 0 ? a.height / px.height : 1;
    const t = dbTransform(a.x, a.y, a.rotation ?? 0, (a.scaleX ?? 1) * fx, (a.scaleY ?? 1) * fy);
    return { type: 'image', name: a.path, transform: t };
  }
  const vertices: number[] = [];
  for (let i = 0; i < a.vertices.length; i += 2) vertices.push(r4(a.vertices[i]!), r4(-a.vertices[i + 1]!));
  const mesh: Json = {
    type: 'mesh',
    name: a.path,
    width: a.width,
    height: a.height,
    vertices,
    uvs: a.uvs.map(r4),
    triangles: [...a.triangles],
  };
  if (a.weights) {
    // DragonBones weighted mesh: vertices stay in slot space; `slotPose` is the slot bone's setup world matrix,
    // `bonePose` lists [boneIndex, a b c d tx ty] for every bone used, `weights` is per vertex [n, boneIndex, w, ...].
    const boneIndex = new Map(ctx.rig.bones.map((b, i) => [b.name, i]));
    const used: string[] = [];
    for (const v of a.weights) for (const [b] of v) if (!used.includes(b)) used.push(b);
    mesh.slotPose = dbMatrix(ctx.slotMatrix);
    mesh.bonePose = used.flatMap((b) => [boneIndex.get(b)!, ...dbMatrix(ctx.boneWorld.get(b)!)]);
    mesh.weights = a.weights.flatMap((v) => [v.length, ...v.flatMap(([b, w]) => [boneIndex.get(b)!, r4(w)])]);
  }
  return mesh;
}

/** Display list per slot (all attachments across skins, in skin order) so `displayIndex` is stable. */
function displayLists(rig: RigDocument): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const s of rig.slots) out.set(s.name, []);
  for (const skin of rig.skins) {
    for (const [slot, atts] of Object.entries(skin.attachments)) {
      const list = out.get(slot)!;
      for (const n of Object.keys(atts)) if (!list.includes(n)) list.push(n);
    }
  }
  return out;
}

interface FrameBase {
  duration: number;
  tweenEasing?: number;
  curve?: number[];
}

function tween(curve: Curve | undefined): Pick<FrameBase, 'tweenEasing' | 'curve'> {
  if (curve === 'stepped') return {};
  if (curve === undefined || curve === 'linear') return { tweenEasing: 0 };
  return { curve: curve.map(r4) };
}

/**
 * Turn a key list into DragonBones frames starting at frame 0. Looping clips drop the closing key at `frames`
 * (its value equals frame 0, which the runtime reaches by wrapping); the last frame then lasts until `frames`.
 */
function toFrames<T>(keys: readonly Key<T>[], clip: Clip, payload: (v: T) => Json): (FrameBase & Json)[] {
  let ks = [...keys];
  if (clip.loop) ks = ks.filter((k) => k.frame < clip.frames);
  if (!ks.length) return [];
  const first = ks[0]!;
  if (first.frame > 0) ks = [{ frame: 0, value: first.value, curve: 'stepped' }, ...ks];
  return ks.map((k, i) => {
    const next = ks[i + 1];
    const end = next ? next.frame : clip.frames;
    const duration = end - k.frame;
    const t = tween(k.curve);
    // a zero-length final key (non-loop key exactly at `frames`) carries no tween
    return { duration, ...(duration > 0 ? t : {}), ...payload(k.value) };
  });
}

function exportAnimation(rig: RigDocument, clip: Clip, fadeIn: number, lists: Map<string, string[]>): Json {
  const bone: Json[] = [];
  for (const t of clip.bones) {
    const b: Json = { name: t.bone };
    if (t.translate?.length) {
      b.translateFrame = toFrames<Vec2>(t.translate, clip, (v) => ({ x: r4(v.x), y: r4(-v.y) }));
    }
    if (t.rotate?.length) b.rotateFrame = toFrames<number>(t.rotate, clip, (v) => ({ rotate: r4(-v) }));
    if (t.scale?.length) b.scaleFrame = toFrames<Vec2>(t.scale, clip, (v) => ({ x: r4(v.x), y: r4(v.y) }));
    if (Object.keys(b).length > 1) bone.push(b);
  }
  const slot: Json[] = [];
  for (const t of clip.slots) {
    const s: Json = { name: t.slot };
    const list = lists.get(t.slot) ?? [];
    if (t.attachment?.length) {
      s.displayFrame = toFrames<string | null>(t.attachment, clip, (v) => ({
        value: v === null ? -1 : list.indexOf(v),
      })).map((f) => ({ duration: f.duration, value: f.value }));
    }
    if (t.color?.length) {
      s.colorFrame = toFrames(t.color, clip, (c) => ({
        value: { aM: r4(c[3] * 100), rM: r4(c[0] * 100), gM: r4(c[1] * 100), bM: r4(c[2] * 100) },
      }));
    }
    if (Object.keys(s).length > 1) slot.push(s);
  }
  const ik: Json[] = [];
  for (const t of clip.ik) {
    if (!t.mix?.length) continue;
    const def = rig.ik?.find((k) => k.name === t.ik);
    ik.push({
      name: t.ik,
      frame: toFrames<number>(t.mix, clip, (v) => ({ weight: r4(v), bendPositive: dbBend(def?.bendPositive ?? true) })),
    });
  }
  // events: action frames covering [0, frames]
  const events = [...clip.events].sort((a, b) => a.frame - b.frame);
  const frame: Json[] = [];
  if (events.length) {
    let cursor = 0;
    const byFrame = new Map<number, string[]>();
    for (const e of events) byFrame.set(e.frame, [...(byFrame.get(e.frame) ?? []), e.name]);
    for (const f of [...byFrame.keys()].sort((a, b) => a - b)) {
      if (f > cursor) frame.push({ duration: f - cursor });
      frame.push({ duration: 1, events: byFrame.get(f)!.map((name) => ({ name })) });
      cursor = f + 1;
    }
    if (cursor < clip.frames) frame.push({ duration: clip.frames - cursor });
  }
  return {
    name: clip.name,
    duration: clip.frames,
    playTimes: clip.loop ? 0 : 1,
    fadeInTime: fadeIn,
    ...(bone.length ? { bone } : {}),
    ...(slot.length ? { slot } : {}),
    ...(ik.length ? { ik } : {}),
    ...(frame.length ? { frame } : {}),
  };
}

/**
 * Bend side mapping rig → DragonBones. Verified against the engine's IK solver (test/dragonbones.engine.test.ts):
 * the runtime works in y-up armature space (`DragonBones.yDown = false`) like our rig space, so it is the identity.
 */
export function dbBend(bendPositive: boolean): boolean {
  return bendPositive;
}

function exportArmature(entry: ExportEntry, opts: ExportOptions, atlas: AtlasData): Json {
  const { rig, clips } = entry;
  const lists = displayLists(rig);
  const rest = evalPose(rig, null, 0, { noIk: true });
  const boneWorld = new Map(rest.bones.map((b) => [b.name, b.world]));
  const regions = new Map(atlas.regions.map((r) => [r.name, { width: r.width, height: r.height }]));
  const name = opts.armatureName ? opts.armatureName(rig) : rig.direction;
  const bone = rig.bones.map((b) => {
    const o: Json = { name: b.name, length: b.length };
    if (b.parent !== null) o.parent = b.parent;
    if (b.inheritRotation === false) o.inheritRotation = false;
    o.transform = dbTransform(b.x, b.y, b.rotation, b.scaleX, b.scaleY);
    return o;
  });
  const slot = rig.slots.map((s) => {
    const list = lists.get(s.name)!;
    const o: Json = {
      name: s.name,
      parent: s.bone,
      displayIndex: s.attachment ? list.indexOf(s.attachment) : -1,
    };
    if (s.blend === 'additive') o.blendMode = 'add';
    if (s.color) {
      o.color = {
        aM: r4(s.color[3] * 100),
        rM: r4(s.color[0] * 100),
        gM: r4(s.color[1] * 100),
        bM: r4(s.color[2] * 100),
      };
    }
    return o;
  });
  const skin = rig.skins.map((sk) => ({
    name: sk.name === 'default' ? '' : sk.name,
    slot: rig.slots
      .filter((s) => sk.attachments[s.name])
      .map((s) => {
        const atts = sk.attachments[s.name]!;
        const list = lists.get(s.name)!;
        // DragonBones display lists are positional: fill gaps (attachments missing in this skin) with null displays.
        const ctx = { rig, slotMatrix: boneWorld.get(s.bone)!, boneWorld, regions };
        const display = list.map((n) => (atts[n] ? exportAttachment(atts[n]!, ctx) : null));
        return { name: s.name, display };
      }),
  }));
  const ik = (rig.ik ?? []).map((k) => {
    const o: Json = {
      name: k.name,
      bone: k.bones[k.bones.length - 1],
      target: k.target,
      bendPositive: dbBend(k.bendPositive),
      weight: k.mix ?? 1,
    };
    if (k.bones.length === 2) o.chain = 1;
    return o;
  });
  const { width, height } = rig.canvas;
  const pivot = pivotOf(width, height); // (W/2, H − PIVOT_BOTTOM_OFFSET_PX) from @vgtd/character / @vgtd/shared
  return {
    type: 'Armature',
    frameRate: CLIP_FPS,
    name,
    aabb: { x: -pivot.x, y: -pivot.y, width, height },
    bone,
    slot,
    skin,
    ...(ik.length ? { ik } : {}),
    animation: clips.map((c) => exportAnimation(rig, c, opts.fadeInTime ?? 0.1, lists)),
  };
}

export function exportTextureAtlas(atlas: AtlasData, name: string): Json {
  return {
    name,
    imagePath: atlas.imagePath,
    width: atlas.width,
    height: atlas.height,
    // Extension read by our tools/viewer: Cocos imports the PNG itself, the engine parser ignores unknown keys.
    premultipliedAlpha: atlas.premultipliedAlpha,
    SubTexture: atlas.regions.map((r) => ({
      name: r.name,
      x: r.x,
      y: r.y,
      width: r.width,
      height: r.height,
      ...(r.rotated ? { rotated: true } : {}),
    })),
  };
}

/** Export one or more per-direction rigs + their clips and one packed atlas page to DragonBones 5.5 JSON. */
export function exportDragonBones(
  entries: readonly ExportEntry[],
  atlas: AtlasData,
  opts: ExportOptions,
): DragonBonesExport {
  if (!entries.length) throw new RangeError('nothing to export');
  const have = new Set(atlas.regions.map((r) => r.name));
  for (const { rig } of entries) {
    for (const sk of rig.skins) {
      for (const atts of Object.values(sk.attachments)) {
        for (const a of Object.values(atts)) {
          if (!have.has(a.path)) throw new Error(`attachment path '${a.path}' has no atlas region`);
        }
      }
    }
  }
  const armature = entries.map((e) => exportArmature(e, opts, atlas));
  const names = armature.map((a) => a.name as string);
  if (new Set(names).size !== names.length) throw new Error(`duplicate armature names: ${names.join(', ')}`);
  return {
    ske: {
      name: opts.name,
      version: DRAGONBONES_DATA_VERSION,
      compatibleVersion: DRAGONBONES_DATA_VERSION,
      frameRate: CLIP_FPS,
      armature,
    },
    tex: exportTextureAtlas(atlas, opts.name),
  };
}

/** Compare dotted versions; true if a <= b. */
export function versionAtMost(a: string, b: string): boolean {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x !== y) return x < y;
  }
  return true;
}
