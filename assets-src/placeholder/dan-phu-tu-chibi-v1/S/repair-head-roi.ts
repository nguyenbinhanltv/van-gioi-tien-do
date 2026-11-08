/** Explicitly owner-authorized HEAD ROI only; original body calibration remains unchanged. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  cellRect,
  components,
  keyOut,
  resampleAffine,
  runProject,
  sheetLayout,
  toStraight,
  verifyInheritedRegistration,
  type Project,
} from '@vgtd/sprite';

interface Plan {
  clip: string;
  source: string;
  sourceSha256: string;
  output: string;
  mask: string;
  provenance: string;
  rows: {
    cell: number;
    chin: { x: number; y: number };
    factor: number;
    estimatedSourceSpanPx: number;
    note: string;
    whiskGuardStartY?: number;
    whiskGuardEndY?: number;
  }[];
}

// run-ts bundles into TEMP; do not resolve inputs against bundled import.meta.url.
const base = resolve(process.argv[2] ?? 'assets-src/placeholder/dan-phu-tu-chibi-v1/S');
const planFile = process.argv[3] ?? 'repair/run-head-roi-plan.v2.json';
const outputRoot = process.argv[4] ? resolve(process.argv[4]) : base;
const plan = JSON.parse(readFileSync(resolve(base, planFile), 'utf8')) as Plan;
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')) as Project;
const current = project.clips.find((clip) => clip.name === plan.clip)!;
if (!current) throw new Error('Unknown clip');
const original = { ...current, sheet: plan.source };
delete original.inheritedRegistration;
delete original.headEvidence;
delete original.exceptions;
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const sourceBytes = readFileSync(join(base, plan.source));
if (hash(sourceBytes) !== plan.sourceSha256) throw new Error('Original source SHA mismatch');
const source = decodePng(sourceBytes, { premultiplied: true });
const baseline = runProject({ ...project, clips: [original] }, base);
const records = baseline.contract.clips[0]!.records;
const grid = sheetLayout(original);
const sx = (grid.cols * CELL_PX) / source.width;
const sy = (grid.rows * CELL_PX) / source.height;
if (Math.abs(sx - sy) > 1e-10) throw new Error('Non-square source DPI');
const inset = Math.round(CELL_PX * (project.slice?.inset ?? 0.01));
const after = { ...source, data: new Uint8ClampedArray(source.data) };
const mask = createImage(source.width, source.height);
for (let p = 0; p < mask.data.length; p += 4) mask.data.set([0, 0, 0, 255], p);
const feather = 3;
const proof = [];

for (const row of plan.rows) {
  if (!(row.factor > 0) || Math.abs(row.factor - 1) > 0.050000000001)
    throw new Error('Head ROI factor exceeds owner limit5%');
  const global = original.sheetSelection?.cells[row.cell] ?? row.cell;
  const r = cellRect(source.width, source.height, grid.cols, grid.rows, global);
  const logical = cellRect(grid.cols * CELL_PX, grid.rows * CELL_PX, grid.cols, grid.rows, global);
  const registration = records[row.cell]!;
  // Annotation pixel centres are integer; resampleAffine uses pixel-edge geometry.
  const toSourceX = (x: number) => (logical.x + inset + x + 0.5 - registration.dx) / sx - r.x;
  const toSourceY = (y: number) => (logical.y + inset + y + 0.5 - registration.dy) / sy - r.y;
  const box = { left: 94, top: 0, right: 168, bottom: row.chin.y - 3 };
  const x0 = Math.max(0, Math.floor(toSourceX(box.left)));
  const y0 = Math.max(0, Math.floor(toSourceY(box.top)));
  const x1 = Math.min(r.width, Math.ceil(toSourceX(box.right)));
  const y1 = Math.min(r.height, Math.ceil(toSourceY(box.bottom)));
  const patch = createImage(x1 - x0, y1 - y0);
  for (let y = 0; y < patch.height; y++)
    for (let x = 0; x < patch.width; x++) {
      const p = ((r.y + y0 + y) * source.width + r.x + x0 + x) * 4;
      patch.data.set(source.data.subarray(p, p + 4), (y * patch.width + x) * 4);
    }
  const anchor = { x: toSourceX(row.chin.x) - x0, y: toSourceY(row.chin.y) - y0 };
  const transformed = resampleAffine(
    patch,
    patch.width,
    patch.height,
    {
      scaleX: row.factor,
      scaleY: row.factor,
      dx: anchor.x * (1 - row.factor),
      dy: anchor.y * (1 - row.factor),
    },
    'lanczos3',
  );
  // Do not blend transformed opaque-matte patch borders. Restrict edits to the
  // original/moved HEAD foreground union, including native AA support.
  const keyed = keyOut(toStraight(patch));
  const allComponents = components(keyed);
  const head = allComponents.reduce((a, c) => (a.area > c.area ? a : c));
  const headSupport = createImage(patch.width, patch.height);
  for (const p of head.pixels) headSupport.data.set([255, 255, 255, 255], p * 4);
  const movedSupport = resampleAffine(
    headSupport,
    patch.width,
    patch.height,
    {
      scaleX: row.factor,
      scaleY: row.factor,
      dx: anchor.x * (1 - row.factor),
      dy: anchor.y * (1 - row.factor),
    },
    'lanczos3',
  );
  const permitted = new Uint8Array(patch.width * patch.height);
  for (let y = 0; y < patch.height; y++)
    for (let x = 0; x < patch.width; x++) {
      const p = y * patch.width + x;
      if (!headSupport.data[p * 4 + 3] && !movedSupport.data[p * 4 + 3]) continue;
      for (let dy = -2; dy <= 2; dy++)
        for (let dx = -2; dx <= 2; dx++) {
          const px = x + dx;
          const py = y + dy;
          if (px >= 0 && py >= 0 && px < patch.width && py < patch.height) permitted[py * patch.width + px] = 1;
        }
    }
  let permittedPixels = 0;
  let changedPixels = 0;
  for (let y = 0; y < patch.height; y++)
    for (let x = 0; x < patch.width; x++) {
      if (!permitted[y * patch.width + x]) continue;
      const ax = (r.x + x0 + x + 0.5) * sx - logical.x - inset + registration.dx - 0.5;
      const ay = (r.y + y0 + y + 0.5) * sy - logical.y - inset + registration.dy - 0.5;
      // Keep adjacent viewer-left whisk/loose trailing hair outside the head ROI.
      const guardStart = row.whiskGuardStartY ?? 40;
      const guardEnd = row.whiskGuardEndY ?? 47;
      const left =
        ay <= guardStart
          ? box.left
          : ay >= guardEnd
            ? 106
            : box.left + ((ay - guardStart) * 12) / (guardEnd - guardStart);
      const edge = Math.min(ax - left, box.right - ax, ay - box.top, box.bottom - ay);
      const t = Math.max(0, Math.min(1, edge / feather));
      const blend = t * t * (3 - 2 * t);
      if (blend === 0) continue;
      const p = ((r.y + y0 + y) * source.width + r.x + x0 + x) * 4;
      const q = (y * patch.width + x) * 4;
      mask.data.set([255, 255, 255, 255], p);
      permittedPixels++;
      let changed = false;
      for (let k = 0; k < 4; k++) {
        after.data[p + k] = Math.round(source.data[p + k]! * (1 - blend) + transformed.data[q + k]! * blend);
        changed ||= source.data[p + k] !== after.data[p + k];
      }
      if (changed) changedPixels++;
    }
  proof.push({
    ...row,
    global,
    logicalRoi: box,
    featherLogicalPx: feather,
    lockedBase: `All original pixels at aligned-reference y>=${box.bottom}; chin/neck anchor untouched`,
    whiskGuard: `Left ROI edge94 above${row.whiskGuardStartY ?? 40}, ramps to106 at${row.whiskGuardEndY ?? 47}; source left of edge remains exact`,
    sourcePatch: { x: r.x + x0, y: r.y + y0, width: patch.width, height: patch.height },
    sourceAnchorInPatch: anchor,
    permittedPixels,
    changedPixels,
    registration: { dx: registration.dx, dy: registration.dy },
  });
}

const editedBytes = encodePng(after, { premultiplied: true });
const maskBytes = encodePng(mask, { premultiplied: true });
for (const file of [plan.output, plan.mask, plan.provenance])
  if (existsSync(join(outputRoot, file))) throw new Error(`Never overwrite attempt: ${file}`);
for (const file of [plan.output, plan.mask, plan.provenance])
  mkdirSync(dirname(join(outputRoot, file)), { recursive: true });
writeFileSync(join(outputRoot, plan.output), editedBytes);
writeFileSync(join(outputRoot, plan.mask), maskBytes);
const inherited = {
  kind: 'inherited-registration' as const,
  source: plan.source,
  sourceSha256: hash(sourceBytes),
  mask: plan.mask,
  maskSha256: hash(maskBytes),
  cells: plan.rows.map((row) => row.cell),
};
verifyInheritedRegistration(
  { ...inherited, source: resolve(base, plan.source), mask: resolve(outputRoot, plan.mask) },
  editedBytes,
  original,
  base,
);
const provenance = {
  tool: '@vgtd/sprite resampleAffine; deterministic owner-authorized HEAD ROI only',
  algorithm: 'head-foreground-union-v2; excludes opaque-matte rectangle edges',
  model: 'not applicable; original AI provenance retained',
  utc: new Date().toISOString(),
  authorization:
    'Orchestrator2026-11-08: uniform head ROI <=5%, chin/neck anchored, Lanczos3 feather, exact outside RGBA, D57,4x seam review. No frame/body scale.',
  source: plan.source,
  sourceSha256: hash(sourceBytes),
  edited: plan.output,
  editedSha256: hash(editedBytes),
  mask: plan.mask,
  maskSha256: hash(maskBytes),
  inheritedRegistration: inherited,
  rotation: 0,
  shear: 0,
  bodyCalibrationScale: 1,
  featherFunction: 'smoothstep(clamp(min logical distance to ROI edge /3,0,1)); base band fully locked',
  geometry:
    'Exact whole-grid DPI/inset/registration conversion; +0.5 converts integer-centred annotation coordinates to resampler pixel edges',
  originalInputOnly: true,
  outsideMaskRgbaMismatches: 0,
  rows: proof,
  status:
    'CANDIDATE only; actual maincap run must be remeasured,4x seams reviewed, all gates unchanged. Plan span estimates are NOT gate evidence.',
};
writeFileSync(join(outputRoot, plan.provenance), JSON.stringify(provenance, null, 2) + '\n', 'utf8');
console.log(
  JSON.stringify({ edited: plan.output, mask: plan.mask, cells: inherited.cells, outsideMaskRgbaMismatches: 0 }),
);
