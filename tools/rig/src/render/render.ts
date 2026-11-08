/**
 * Pose → picture. Renders the textured character (region + weighted-mesh attachments, skins, slot order, tint and
 * additive blend) with optional debug overlays (bones, IK targets, planted feet, ground line), plus contact sheets.
 * Rig space is y-up with the root at the pivot; the picture puts the pivot at (W/2, H − PIVOT_BOTTOM_OFFSET).
 */
import { pivotOf } from '@vgtd/character';
import { skinAttachment } from '../skinning.js';
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
  /** Draw the ground line and pivot cross. Default true. */
  readonly ground?: boolean;
  /** Slots to leave out (debugging: isolate a piece). */
  readonly hideSlots?: readonly string[];
  /** Planted flags per ankle bone for the frame (draws a marker under planted feet). */
  readonly planted?: Readonly<Record<string, boolean>>;
}

export function renderPose(rig: RigDocument, pose: Pose, atlas: LoadedAtlas | null, opts: RenderOptions = {}): Image {
  const scale = opts.scale ?? 2;
  const W = Math.round(rig.canvas.width * scale);
  const H = Math.round(rig.canvas.height * scale);
  const pivot = pivotOf(rig.canvas.width, rig.canvas.height);
  // pivot is (W/2, H−12) in image coordinates: the root (0,0) sits there; y up in rig space = up the picture.
  const sy = (y: number) => (pivot.y - y) * scale;
  const sx = (x: number) => (pivot.x + x) * scale;

  const out = createImage(W, H, opts.background ?? REVIEW_BACKGROUND);
  // ground line + pivot
  if (opts.ground !== false) {
    line(out, 0, sy(0), W, sy(0), [60, 64, 72, 255], 1.5);
    cross(out, sx(0), sy(0), 4, [60, 64, 72, 255]);
  }

  if (opts.parts !== false && atlas) {
    const rest = evalPose(rig, null, 0, { noIk: true });
    const skinNames = [opts.skin ?? 'default'];
    for (const slot of rig.slots) {
      if (opts.hideSlots?.includes(slot.name)) continue;
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
      const mesh = skinAttachment(att, slot.bone, pose, rest);
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

/** Mid-grey review background: dark enough for light robes, light enough for the dark hair and boots. */
export const REVIEW_BACKGROUND: Rgba = [118, 122, 130, 255];

export interface ClipRenderOptions extends RenderOptions {
  /** Render every n-th frame. Default 1. */
  readonly step?: number;
  /** Faint ghosts of the frames `±onion` frames away (previous tinted blue, next red). 0 = off. Default 0. */
  readonly onion?: number;
}

function tinted(img: Image, rgb: readonly [number, number, number], alpha: number): Image {
  const out = createImage(img.width, img.height);
  for (let i = 0; i < img.data.length; i += 4) {
    const a = img.data[i + 3]! / 255;
    if (a === 0) continue;
    const k = alpha * a;
    out.data[i] = (img.data[i]! * 0.55 + rgb[0] * a * 0.45) * alpha;
    out.data[i + 1] = (img.data[i + 1]! * 0.55 + rgb[1] * a * 0.45) * alpha;
    out.data[i + 2] = (img.data[i + 2]! * 0.55 + rgb[2] * a * 0.45) * alpha;
    out.data[i + 3] = 255 * k;
  }
  return out;
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
    const base = renderPose(rig, pose, atlas, { ...opts, planted });
    if (!opts.onion || !atlas) {
      frames.push(base);
      continue;
    }
    // onion skin: ghosts under the current frame (previous = blue, next = red), wrapping for loops
    const wrap = (g: number) =>
      clip.loop ? ((g % clip.frames) + clip.frames) % clip.frames : Math.min(clip.frames, Math.max(0, g));
    const ghostOpts = { ...opts, background: [0, 0, 0, 0] as Rgba, ground: false, overlay: false };
    const frame = renderPose(rig, evalPose(rig, clip, f), atlas, { ...opts, parts: false, planted }); // bg + ground (+ overlay)
    for (const [df, rgb] of [
      [-opts.onion, [90, 150, 255]],
      [opts.onion, [255, 110, 100]],
    ] as const) {
      const ghost = renderPose(rig, evalPose(rig, clip, wrap(f + df)), atlas, ghostOpts);
      blit(frame, tinted(ghost, rgb, 0.4), 0, 0);
    }
    const current = renderPose(rig, pose, atlas, { ...ghostOpts, overlay: opts.overlay });
    blit(frame, current, 0, 0);
    frames.push(frame);
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
