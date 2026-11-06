/**
 * Continuous limb meshes ("draw for rig"): ONE mesh per whole arm (shoulder → sleeve → hand base) or whole leg
 * (thigh → shin → foot) instead of rigid islands glued at the joints. The mesh is a strip along the bone chain built from
 * the painted alpha of the part: stations along the chain, a cross-section row per station spanning the painted width,
 * triangles between rows. Weights are two bones per vertex with a smooth ramp around each joint, so the surface bends
 * without a seam. Engine-free; only needs the part's alpha raster and the rig rest pose.
 */
import { applyMat, invertMat, type Vec2 } from './math.js';
import { evalPose } from './pose.js';
import type { Image } from './render/image.js';
import type { MeshAttachment, RigDocument } from './schema.js';

/** Mapping between rig space (px @1x, y up, origin at the feet) and the part image (texture px, y down). */
export interface CanvasView {
  /** Texture px per rig px (2 for the @2x atlas). */
  readonly scale: number;
  /** Rig-space point of the image's top-left corner mapping: texture (0,0) = rig (-pivot[0], pivot[1]). */
  readonly pivot: readonly [number, number];
}

export interface LimbOptions {
  /** Attachment / atlas region name. */
  readonly name: string;
  /** Bone the slot sits on; vertices are stored in its local space. */
  readonly slotBone: string;
  /** Bones root→tip along the part, e.g. `[upper_arm_R, lower_arm_R, hand_R]`. At least one. */
  readonly chain: readonly string[];
  readonly view: CanvasView;
  /** Painted part, full canvas (premultiplied RGBA; only alpha is read). */
  readonly image: Image;
  /** Alpha at or above which a pixel counts as painted. Default 8. */
  readonly alphaThreshold?: number;
  /** Station spacing along the chain (px @1x). Default 4. */
  readonly step?: number;
  /** Half length of the weight ramp at each interior joint (px @1x): one value or one per joint. Default 8. */
  readonly ramp?: number | readonly number[];
  /** Vertices across the section: 2 (edges only) .. 5. Default: from the width, 2..4. */
  readonly cols?: number;
  /** Atlas crop padding around the painted bounding box (texture px). Default 2. */
  readonly pad?: number;
}

export interface LimbMesh {
  readonly attachment: MeshAttachment;
  /** Crop of the part image (texture px) that goes into the atlas under `attachment.path`. */
  readonly crop: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  readonly vertexCount: number;
  /** Arclength (px @1x) of each interior joint on the chain polyline, for QA. */
  readonly jointArc: readonly number[];
}

/** Throws unless `v` is a finite number > 0 (an option that would otherwise loop forever or produce NaN weights). */
function positive(what: string, v: number): number {
  if (!Number.isFinite(v) || v <= 0) throw new RangeError(`${what} must be a finite number > 0 (got ${v})`);
  return v;
}

function checkView(view: CanvasView): void {
  positive('view.scale', view.scale);
  if (!view.pivot.every(Number.isFinite)) throw new RangeError('view.pivot must be finite numbers');
}

const smooth = (t: number) => {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
};

/** Build the continuous mesh for one part. Throws when the part is empty or the chain is unusable. */
export function buildLimbMesh(rig: RigDocument, opts: LimbOptions): LimbMesh {
  const { image, view } = opts;
  const thr = opts.alphaThreshold ?? 8;
  const step = positive('step', opts.step ?? 4);
  const pad = opts.pad ?? 2;
  checkView(view);
  if (opts.cols !== undefined && !(Number.isInteger(opts.cols) && opts.cols >= 2 && opts.cols <= 5))
    throw new RangeError(`cols must be an integer in 2..5 (got ${opts.cols})`);
  for (const r of typeof opts.ramp === 'number' ? [opts.ramp] : (opts.ramp ?? [])) positive('ramp', r);
  if (!opts.chain.length) throw new RangeError('limb chain needs at least one bone');
  const rest = evalPose(rig, null, 0, { noIk: true });
  const bonePose = (n: string) => {
    const b = rest.byName.get(n);
    if (!b) throw new RangeError(`unknown bone '${n}'`);
    return b;
  };

  // chain polyline: bone origins, then the last bone's tip; extended linearly beyond both ends when sampling
  const pts: Vec2[] = opts.chain.map((n) => bonePose(n).pos);
  pts.push(bonePose(opts.chain[opts.chain.length - 1]!).tip);
  // a zero-length last bone (hand, foot tip of a one-point bone) continues the axis of the bone before it
  const n = pts.length;
  if (n >= 3 && Math.hypot(pts[n - 1]!.x - pts[n - 2]!.x, pts[n - 1]!.y - pts[n - 2]!.y) < 1e-6) {
    const a = pts[n - 3]!;
    const b = pts[n - 2]!;
    const l = Math.hypot(b.x - a.x, b.y - a.y);
    if (l > 1e-6) pts[n - 1] = { x: b.x + ((b.x - a.x) / l) * 6, y: b.y + ((b.y - a.y) / l) * 6 };
  }
  const segLen: number[] = [];
  const arcAt: number[] = [0];
  for (let i = 0; i + 1 < pts.length; i++) {
    const d = Math.hypot(pts[i + 1]!.x - pts[i]!.x, pts[i + 1]!.y - pts[i]!.y);
    if (d < 1e-6) throw new RangeError(`bone '${opts.chain[i]}' has zero length: cannot define the chain axis`);
    segLen.push(d);
    arcAt.push(arcAt[i]! + d);
  }
  const jointArc = arcAt.slice(1, opts.chain.length); // origin of chain[1..]
  const frameAt = (s: number) => {
    let i = 0;
    while (i < segLen.length - 1 && s > arcAt[i + 1]!) i++;
    const a = pts[i]!;
    const b = pts[i + 1]!;
    const tx = (b.x - a.x) / segLen[i]!;
    const ty = (b.y - a.y) / segLen[i]!;
    const u = s - arcAt[i]!;
    return { c: { x: a.x + tx * u, y: a.y + ty * u }, t: { x: tx, y: ty } };
  };

  // painted pixels in rig space and their arclength
  const toRig = (px: number, py: number): Vec2 => ({
    x: px / view.scale - view.pivot[0],
    y: view.pivot[1] - py / view.scale,
  });
  const painted: { p: Vec2; s: number }[] = [];
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3]! < thr) continue;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
      const p = toRig(x + 0.5, y + 0.5);
      // nearest segment, unclamped on the first/last so the ends extend along the axis
      let bestS = 0;
      let bestD = Infinity;
      for (let i = 0; i < segLen.length; i++) {
        const a = pts[i]!;
        const tx = (pts[i + 1]!.x - a.x) / segLen[i]!;
        const ty = (pts[i + 1]!.y - a.y) / segLen[i]!;
        let u = (p.x - a.x) * tx + (p.y - a.y) * ty;
        if (i > 0) u = Math.max(0, u);
        if (i < segLen.length - 1) u = Math.min(segLen[i]!, u);
        const d = Math.hypot(p.x - a.x - tx * u, p.y - a.y - ty * u);
        if (d < bestD) {
          bestD = d;
          bestS = arcAt[i]! + u;
        }
      }
      painted.push({ p, s: bestS });
    }
  }
  if (!painted.length) throw new RangeError(`part '${opts.name}' has no painted pixels (alpha >= ${thr})`);

  const sMin = Math.min(...painted.map((q) => q.s));
  const sMax = Math.max(...painted.map((q) => q.s));
  const ramps = jointArc.map((_, j) => (typeof opts.ramp === 'number' ? opts.ramp : (opts.ramp?.[j] ?? 8)));
  // two ramps never overlap (at most two bones per vertex): the ramps on both ends of a bone share its length
  for (let j = 0; j + 1 < ramps.length; j++) {
    const room = segLen[j + 1]!;
    if (ramps[j]! + ramps[j + 1]! > room) {
      const f = room / (ramps[j]! + ramps[j + 1]!);
      ramps[j] = ramps[j]! * f;
      ramps[j + 1] = ramps[j + 1]! * f;
    }
  }

  // stations: regular, plus denser inside each joint ramp
  const sset = new Set<number>([sMin, sMax]);
  const key = (s: number) => Math.round(s * 100) / 100;
  for (let s = sMin; s < sMax; s += step) sset.add(key(s));
  jointArc.forEach((sj, j) => {
    const r = ramps[j]!;
    for (let s = sj - r; s <= sj + r + 1e-9; s += step / 2) if (s > sMin && s < sMax) sset.add(key(s));
  });
  const stations = [...sset].sort((a, b) => a - b);

  // cross-section rows
  const slab = step / 2 + 0.01;
  interface Row {
    readonly s: number;
    readonly pts: Vec2[];
  }
  const rows: (Row | null)[] = [];
  let widest = 0;
  const extents = stations.map((s) => {
    const { c, t } = frameAt(s);
    const n = { x: -t.y, y: t.x };
    let lo = Infinity;
    let hi = -Infinity;
    for (const q of painted) {
      if (Math.abs(q.s - s) > slab) continue;
      const d = (q.p.x - c.x) * n.x + (q.p.y - c.y) * n.y;
      lo = Math.min(lo, d);
      hi = Math.max(hi, d);
    }
    if (hi < lo) return null;
    widest = Math.max(widest, hi - lo);
    return { c, n, lo: lo - 0.5 / view.scale, hi: hi + 0.5 / view.scale };
  });
  const cols = Math.max(2, Math.min(5, opts.cols ?? Math.min(4, Math.max(2, Math.ceil(widest / 9) + 1))));
  stations.forEach((s, k) => {
    const e = extents[k];
    if (!e) return void rows.push(null);
    rows.push({
      s,
      pts: Array.from({ length: cols }, (_, i) => {
        const d = e.lo + ((e.hi - e.lo) * i) / (cols - 1);
        return { x: e.c.x + e.n.x * d, y: e.c.y + e.n.y * d };
      }),
    });
  });

  // vertices, uvs, triangles
  const crop = {
    x: Math.max(0, x0 - pad),
    y: Math.max(0, y0 - pad),
    width: 0,
    height: 0,
  };
  crop.width = Math.min(image.width, x1 + pad) - crop.x;
  crop.height = Math.min(image.height, y1 + pad) - crop.y;
  const slabInv = invertMat(bonePose(opts.slotBone).world);
  const vertices: number[] = [];
  const uvs: number[] = [];
  const weights: [string, number][][] = [];
  const triangles: number[] = [];
  const rowStart: number[] = [];
  for (const row of rows) {
    if (!row) {
      rowStart.push(-1);
      continue;
    }
    rowStart.push(weights.length);
    // weights from the station arclength: bone i carries h_i − h_{i+1}, h_j = smoothstep over joint j's ramp
    const h = [1, ...jointArc.map((sj, j) => smooth((row.s - (sj - ramps[j]!)) / (2 * ramps[j]!))), 0];
    const w: [string, number][] = [];
    for (let i = 0; i < opts.chain.length; i++) {
      const v = h[i]! - h[i + 1]!;
      if (v > 1e-4) w.push([opts.chain[i]!, v]);
    }
    const sum = w.reduce((a, b) => a + b[1], 0);
    const norm = w.map(([b, v]): [string, number] => [b, Math.round((v / sum) * 1e4) / 1e4]);
    for (const p of row.pts) {
      const local = applyMat(slabInv, p);
      vertices.push(Math.round(local.x * 1e3) / 1e3, Math.round(local.y * 1e3) / 1e3);
      const tx = (view.pivot[0] + p.x) * view.scale;
      const ty = (view.pivot[1] - p.y) * view.scale;
      uvs.push(
        Math.round(((tx - crop.x) / crop.width) * 1e5) / 1e5,
        Math.round(((ty - crop.y) / crop.height) * 1e5) / 1e5,
      );
      weights.push(norm);
    }
  }
  for (let r = 0; r + 1 < rows.length; r++) {
    const a = rowStart[r]!;
    const b = rowStart[r + 1]!;
    if (a < 0 || b < 0) continue;
    for (let i = 0; i + 1 < cols; i++) {
      triangles.push(a + i, a + i + 1, b + i, a + i + 1, b + i + 1, b + i);
    }
  }
  return {
    attachment: {
      type: 'mesh',
      path: opts.name,
      width: crop.width / view.scale,
      height: crop.height / view.scale,
      uvs,
      vertices,
      triangles,
      weights,
    },
    crop,
    vertexCount: weights.length,
    jointArc,
  };
}

export interface SkirtOptions {
  readonly name: string;
  /** Slot bone (normally the hips). */
  readonly slotBone: string;
  /** The bones the skirt hangs from: waist bone and both thighs (rig roles hips / thigh_L / thigh_R). */
  readonly hips: string;
  readonly thighs: readonly [string, string];
  readonly view: CanvasView;
  readonly image: Image;
  readonly alphaThreshold?: number;
  /** Grid cell (px @1x). Default 5. */
  readonly cell?: number;
  readonly pad?: number;
}

/**
 * Skirt / robe panel mesh: a regular grid over the painted area. Weights: the hip bone at and above the hip joint,
 * ramping down to the thighs (shared by inverse distance to each thigh bone) by the knee. No islands, no seam.
 */
export function buildSkirtMesh(rig: RigDocument, opts: SkirtOptions): LimbMesh {
  const { image, view } = opts;
  const thr = opts.alphaThreshold ?? 8;
  const cell = positive('cell', opts.cell ?? 5);
  const pad = opts.pad ?? 2;
  checkView(view);
  const rest = evalPose(rig, null, 0, { noIk: true });
  const pose = (n: string) => {
    const b = rest.byName.get(n);
    if (!b) throw new RangeError(`unknown bone '${n}'`);
    return b;
  };
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  const painted = new Uint8Array(image.width * image.height);
  for (let y = 0; y < image.height; y++) {
    for (let x = 0; x < image.width; x++) {
      if (image.data[(y * image.width + x) * 4 + 3]! < thr) continue;
      painted[y * image.width + x] = 1;
      x0 = Math.min(x0, x);
      y0 = Math.min(y0, y);
      x1 = Math.max(x1, x + 1);
      y1 = Math.max(y1, y + 1);
    }
  }
  if (x1 < 0) throw new RangeError(`part '${opts.name}' has no painted pixels (alpha >= ${thr})`);
  const crop = {
    x: Math.max(0, x0 - pad),
    y: Math.max(0, y0 - pad),
    width: Math.min(image.width, x1 + pad) - Math.max(0, x0 - pad),
    height: Math.min(image.height, y1 + pad) - Math.max(0, y0 - pad),
  };
  const toRig = (px: number, py: number): Vec2 => ({
    x: px / view.scale - view.pivot[0],
    y: view.pivot[1] - py / view.scale,
  });
  const cellTex = cell * view.scale;
  const nx = Math.max(1, Math.ceil((x1 - x0) / cellTex));
  const ny = Math.max(1, Math.ceil((y1 - y0) / cellTex));
  const covered = (cx: number, cy: number) => {
    const ax = Math.floor(x0 + (cx * (x1 - x0)) / nx);
    const bx = Math.max(ax + 1, Math.ceil(x0 + ((cx + 1) * (x1 - x0)) / nx));
    const ay = Math.floor(y0 + (cy * (y1 - y0)) / ny);
    const by = Math.max(ay + 1, Math.ceil(y0 + ((cy + 1) * (y1 - y0)) / ny));
    for (let y = ay; y < Math.min(by, image.height); y++)
      for (let x = ax; x < Math.min(bx, image.width); x++) if (painted[y * image.width + x]) return true;
    return false;
  };
  const hipPos = pose(opts.hips).pos;
  const kneeY = Math.min(...opts.thighs.map((t) => pose(t).tip.y));
  const hipY = hipPos.y;
  const segD = (p: Vec2, bone: string) => {
    const b = pose(bone);
    const dx = b.tip.x - b.pos.x;
    const dy = b.tip.y - b.pos.y;
    const l2 = dx * dx + dy * dy || 1;
    const u = Math.max(0, Math.min(1, ((p.x - b.pos.x) * dx + (p.y - b.pos.y) * dy) / l2));
    return Math.hypot(p.x - b.pos.x - dx * u, p.y - b.pos.y - dy * u);
  };
  const slotInv = invertMat(pose(opts.slotBone).world);
  const vertices: number[] = [];
  const uvs: number[] = [];
  const weights: [string, number][][] = [];
  const triangles: number[] = [];
  const index = new Map<number, number>();
  const vertexAt = (i: number, j: number): number => {
    const k = j * (nx + 1) + i;
    const hit = index.get(k);
    if (hit !== undefined) return hit;
    const tx = x0 + (i * (x1 - x0)) / nx;
    const ty = y0 + (j * (y1 - y0)) / ny;
    const p = toRig(tx, ty);
    const local = applyMat(slotInv, p);
    vertices.push(Math.round(local.x * 1e3) / 1e3, Math.round(local.y * 1e3) / 1e3);
    uvs.push(
      Math.round(((tx - crop.x) / crop.width) * 1e5) / 1e5,
      Math.round(((ty - crop.y) / crop.height) * 1e5) / 1e5,
    );
    const t = smooth((hipY - p.y) / Math.max(1e-3, hipY - kneeY));
    const inv = opts.thighs.map((b) => 1 / (1 + segD(p, b) ** 2));
    const invSum = inv[0]! + inv[1]!;
    const w: [string, number][] = [[opts.hips, 1 - t]];
    opts.thighs.forEach((b, n) => w.push([b, (t * inv[n]!) / invSum]));
    const kept = w.filter(([, v]) => v > 1e-3);
    const sum = kept.reduce((a, b) => a + b[1], 0);
    weights.push(kept.map(([b, v]): [string, number] => [b, Math.round((v / sum) * 1e4) / 1e4]));
    index.set(k, weights.length - 1);
    return weights.length - 1;
  };
  for (let j = 0; j < ny; j++) {
    for (let i = 0; i < nx; i++) {
      if (!covered(i, j)) continue;
      const a = vertexAt(i, j);
      const b = vertexAt(i + 1, j);
      const c = vertexAt(i, j + 1);
      const d = vertexAt(i + 1, j + 1);
      triangles.push(a, b, c, b, d, c);
    }
  }
  return {
    attachment: {
      type: 'mesh',
      path: opts.name,
      width: crop.width / view.scale,
      height: crop.height / view.scale,
      uvs,
      vertices,
      triangles,
      weights,
    },
    crop,
    vertexCount: weights.length,
    jointArc: [],
  };
}
