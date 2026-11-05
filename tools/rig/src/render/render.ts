/**
 * Pose → picture. Renders the textured character (region + weighted-mesh attachments, skins, slot order, tint and
 * additive blend) with optional debug overlays (bones, IK targets, planted feet, ground line), plus contact sheets.
 * Rig space is y-up with the root at the pivot; the picture puts the pivot at (W/2, H − PIVOT_BOTTOM_OFFSET).
 */
import { pivotOf } from '@vgtd/character';
import { applyMat, invertMat, mulMat, type Mat, type Vec2 } from '../math.js';
import { evalPose, type Pose } from '../pose.js';
import type { Clip } from '../clip.js';
import type { AtlasData, RigAttachment, RigDocument } from '../schema.js';
import { createImage, type Image } from './image.js';
import {
  blit,
  cross,
  disc,
  drawNumber,
  fillRect,
  line,
  texturedTriangle,
  type Rgba,
  type TextureRegion,
} from './raster.js';

/** A loaded atlas page: decoded texture + region table (pixels). */
export interface LoadedAtlas {
  readonly image: Image;
  readonly regions: ReadonlyMap<string, TextureRegion>;
}

export function loadedAtlas(data: AtlasData, image: Image): LoadedAtlas {
  return {
    image,
    regions: new Map(data.regions.map((r) => [r.name, { image, x: r.x, y: r.y, width: r.width, height: r.height }])),
  };
}

export interface RenderOptions {
  /** Pixels per rig px. Default 2. */
  readonly scale?: number;
  readonly skin?: string;
  readonly background?: Rgba;
  /** Draw the textured parts. Default true. */
  readonly parts?: boolean;
  /** Draw bones / IK targets / ground line. Default false. */
  readonly overlay?: boolean;
  /** Mirror horizontally (SW/W/NW reuse SE/E/NE with scaleX = −1). */
  readonly mirror?: boolean;
  /** Planted flags per ankle bone for the frame (draws a marker under planted feet). */
  readonly planted?: Readonly<Record<string, boolean>>;
}

function transformPoint(m: Mat, p: Vec2): Vec2 {
  return applyMat(m, p);
}

interface Mesh {
  readonly verts: Vec2[];
  readonly uvs: Vec2[];
  readonly tris: readonly number[];
}

function attachmentMesh(a: RigAttachment, slotBone: string, pose: Pose, rest: Pose): Mesh {
  const slotPose = pose.byName.get(slotBone)!.world;
  if (a.type === 'region') {
    const hw = (a.width / 2) * (a.scaleX ?? 1);
    const hh = (a.height / 2) * (a.scaleY ?? 1);
    const r = ((a.rotation ?? 0) * Math.PI) / 180;
    const cos = Math.cos(r);
    const sin = Math.sin(r);
    const corner = (x: number, y: number): Vec2 =>
      transformPoint(slotPose, { x: a.x + x * cos - y * sin, y: a.y + x * sin + y * cos });
    return {
      verts: [corner(-hw, hh), corner(hw, hh), corner(hw, -hh), corner(-hw, -hh)],
      uvs: [
        { x: 0, y: 0 },
        { x: 1, y: 0 },
        { x: 1, y: 1 },
        { x: 0, y: 1 },
      ],
      tris: [0, 1, 2, 0, 2, 3],
    };
  }
  const verts: Vec2[] = [];
  const uvs: Vec2[] = [];
  const restSlot = rest.byName.get(slotBone)!.world;
  for (let i = 0; i < a.vertices.length / 2; i++) {
    const local = { x: a.vertices[i * 2]!, y: a.vertices[i * 2 + 1]! };
    uvs.push({ x: a.uvs[i * 2]!, y: a.uvs[i * 2 + 1]! });
    const w = a.weights?.[i];
    if (!w) {
      verts.push(transformPoint(slotPose, local));
      continue;
    }
    const world0 = transformPoint(restSlot, local);
    let x = 0;
    let y = 0;
    for (const [bone, weight] of w) {
      const rb = rest.byName.get(bone)!.world;
      const pb = pose.byName.get(bone)!.world;
      const p = transformPoint(mulMat(pb, invertMat(rb)), world0);
      x += p.x * weight;
      y += p.y * weight;
    }
    verts.push({ x, y });
  }
  return { verts, uvs, tris: a.triangles };
}

export function renderPose(rig: RigDocument, pose: Pose, atlas: LoadedAtlas | null, opts: RenderOptions = {}): Image {
  const scale = opts.scale ?? 2;
  const W = Math.round(rig.canvas.width * scale);
  const H = Math.round(rig.canvas.height * scale);
  const pivot = pivotOf(rig.canvas.width, rig.canvas.height);
  // pivot is (W/2, H−12) in image coordinates: the root (0,0) sits there; y up in rig space = up the picture.
  const sy = (y: number) => (pivot.y - y) * scale;
  const sx = (x: number) => (pivot.x + x) * scale;

  const out = createImage(W, H, opts.background ?? [38, 40, 48, 255]);
  // ground line + pivot
  line(out, 0, sy(0), W, sy(0), [90, 96, 110, 255]);
  cross(out, sx(0), sy(0), 4, [140, 150, 170, 255]);

  if (opts.parts !== false && atlas) {
    const rest = evalPose(rig, null, 0, { noIk: true });
    const skinNames = [opts.skin ?? 'default'];
    for (const slot of rig.slots) {
      const name = pose.attachments.get(slot.name);
      if (!name) continue;
      let att: RigAttachment | undefined;
      for (const sk of skinNames) att = att ?? rig.skins.find((s) => s.name === sk)?.attachments[slot.name]?.[name];
      att =
        att ??
        rig.skins.flatMap((s) => (s.attachments[slot.name]?.[name] ? [s.attachments[slot.name]![name]!] : []))[0];
      if (!att) continue;
      const region = atlas.regions.get(att.path);
      if (!region) continue;
      const mesh = attachmentMesh(att, slot.bone, pose, rest);
      const c = slot.color ?? [1, 1, 1, 1];
      const tint: Rgba = [c[0] * 255, c[1] * 255, c[2] * 255, c[3] * 255];
      for (let t = 0; t < mesh.tris.length; t += 3) {
        const v = (k: number) => ({
          x: sx(mesh.verts[mesh.tris[t + k]!]!.x),
          y: sy(mesh.verts[mesh.tris[t + k]!]!.y),
          u: mesh.uvs[mesh.tris[t + k]!]!.x,
          v: mesh.uvs[mesh.tris[t + k]!]!.y,
        });
        texturedTriangle(out, region, v(0), v(1), v(2), tint, slot.blend === 'additive');
      }
    }
  }

  if (opts.overlay) {
    for (const b of pose.bones) {
      const rb = rig.bones.find((x) => x.name === b.name)!;
      if (b.name.startsWith('ik_') || rb.parent === null) continue;
      line(out, sx(b.pos.x), sy(b.pos.y), sx(b.tip.x), sy(b.tip.y), [255, 190, 60, 220], 1.5);
      disc(out, sx(b.pos.x), sy(b.pos.y), 1.6, [255, 255, 255, 230]);
    }
    for (const ik of rig.ik ?? []) {
      const t = pose.byName.get(ik.target)!;
      cross(out, sx(t.pos.x), sy(t.pos.y), 3, [90, 220, 255, 255]);
    }
    for (const [bone, on] of Object.entries(opts.planted ?? {})) {
      if (!on) continue;
      const p = pose.byName.get(bone)!;
      disc(out, sx(p.pos.x), sy(0), 2.5, [255, 90, 90, 255]);
    }
  }
  if (opts.mirror) {
    const m = createImage(W, H, [0, 0, 0, 0]);
    blit(m, out, 0, 0, true);
    return m;
  }
  return out;
}

export interface ClipRenderOptions extends RenderOptions {
  /** Render every n-th frame. Default 1. */
  readonly step?: number;
}

/** Render frames 0..N−1 for looping clips (frame N == 0) and 0..N for the rest. */
export function renderClip(
  rig: RigDocument,
  clip: Clip,
  atlas: LoadedAtlas | null,
  opts: ClipRenderOptions = {},
): Image[] {
  const frames: Image[] = [];
  const last = clip.loop ? clip.frames - 1 : clip.frames;
  for (let f = 0; f <= last; f += opts.step ?? 1) {
    const pose = evalPose(rig, clip, f);
    const planted: Record<string, boolean> = {};
    for (const [bone, flags] of Object.entries(clip.motion?.planted ?? {})) planted[bone] = !!flags[f];
    frames.push(renderPose(rig, pose, atlas, { ...opts, planted }));
  }
  return frames;
}

/** Grid of frames with frame numbers (index of each shown frame, scaled by `step`). */
export function contactSheet(
  frames: readonly Image[],
  opts: { columns?: number; step?: number; gap?: number } = {},
): Image {
  const first = frames[0];
  if (!first) throw new RangeError('no frames');
  const cols = opts.columns ?? Math.min(frames.length, 8);
  const rows = Math.ceil(frames.length / cols);
  const gap = opts.gap ?? 2;
  const sheet = createImage(cols * (first.width + gap) + gap, rows * (first.height + gap) + gap, [18, 19, 24, 255]);
  frames.forEach((f, i) => {
    const x = gap + (i % cols) * (first.width + gap);
    const y = gap + Math.floor(i / cols) * (first.height + gap);
    blit(sheet, f, x, y);
    fillRect(sheet, x + 2, y + 2, String(i * (opts.step ?? 1)).length * 8 + 2, 12, [0, 0, 0, 150]);
    drawNumber(sheet, String(i * (opts.step ?? 1)), x + 3, y + 4, 2, [255, 255, 255, 255]);
  });
  return sheet;
}
