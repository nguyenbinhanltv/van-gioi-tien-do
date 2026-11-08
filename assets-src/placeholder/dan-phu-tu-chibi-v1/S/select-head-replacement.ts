/** Owner-authorized original-source AI head replacement; no body/frame transform. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, cellRect, runProject, sheetLayout, verifyInheritedRegistration, type Project } from '@vgtd/sprite';

const base = resolve(process.argv[2] ?? 'assets-src/placeholder/dan-phu-tu-chibi-v1/S');
const outputRoot = process.argv[3] ? resolve(process.argv[3]) : base;
const source = 'raw/hit-dash.attempt1.png';
const candidate = 'raw/dash-headreplacement1.attempt1.png';
const output = 'raw/hit-dash.head-replacement1.png';
const maskPath = 'repair/dash.head-replacement1.mask.png';
if (existsSync(resolve(outputRoot, output))) throw new Error('Refusing to overwrite attempt');
const hash = (v: Uint8Array) => createHash('sha256').update(v).digest('hex');
const src = decodePng(readFileSync(resolve(base, source)), { premultiplied: true });
const edit = decodePng(readFileSync(resolve(base, candidate)), { premultiplied: true });
if (src.width !== edit.width || src.height !== edit.height) throw new Error('AI canvas changed');
const project = JSON.parse(readFileSync(resolve(base, 'project.json'), 'utf8')) as Project;
const dash = project.clips.find((c) => c.name === 'dash')!;
const original = { ...dash, sheet: source };
delete original.inheritedRegistration;
delete original.headEvidence;
delete original.exceptions;
const baseline = runProject({ ...project, clips: [original] }, base);
const records = baseline.contract.clips[0]!.records;
const grid = sheetLayout(original);
const sx = (grid.cols * CELL_PX) / src.width,
  sy = (grid.rows * CELL_PX) / src.height;
const inset = Math.round(CELL_PX * (project.slice?.inset ?? 0.01));
// Retain accepted independent original-source repairs0/9; replace2/4 FROM ORIGINAL.
const retained = decodePng(readFileSync(resolve(base, 'raw/hit-dash.head-roi.v2.png')), { premultiplied: true });
const retainedMask = decodePng(readFileSync(resolve(base, 'repair/dash.head-roi.v2.mask.png')), {
  premultiplied: true,
});
const out = { ...src, data: new Uint8ClampedArray(src.data) };
const mask = createImage(src.width, src.height);
for (let p = 0; p < mask.data.length; p += 4) mask.data.set([0, 0, 0, 255], p);
for (const local of [0, 9]) {
  const global = original.sheetSelection?.cells[local] ?? local;
  const r = cellRect(src.width, src.height, grid.cols, grid.rows, global);
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++) {
      const p = (y * src.width + x) * 4;
      out.data.set(retained.data.subarray(p, p + 4), p);
      mask.data.set(retainedMask.data.subarray(p, p + 4), p);
    }
}
const regions = [];
for (const row of [
  { cell: 2, chin: { x: 133.5, y: 87.5 } },
  { cell: 4, chin: { x: 135.5, y: 89.5 } },
]) {
  const global = original.sheetSelection?.cells[row.cell] ?? row.cell;
  const r = cellRect(src.width, src.height, grid.cols, grid.rows, global);
  const logical = cellRect(grid.cols * CELL_PX, grid.rows * CELL_PX, grid.cols, grid.rows, global);
  const rec = records[row.cell]!;
  let changedBytes = 0,
    editablePixels = 0;
  for (let y = r.y; y < r.y + r.height; y++)
    for (let x = r.x; x < r.x + r.width; x++) {
      const ax = (x + 0.5) * sx - logical.x - inset + rec.dx - 0.5;
      const ay = (y + 0.5) * sy - logical.y - inset + rec.dy - 0.5;
      // Above the whisk use full head width; below it keep the viewer-left whisk/hand locked.
      const t = Math.max(0, Math.min(1, (ay - (row.chin.y - 29.5)) / 7));
      const left = 94 + 12 * t,
        right = 170;
      const bottom = row.chin.y + 0.5;
      const distance = Math.min(ax - left, right - ax, ay + 1, bottom - ay);
      if (distance <= 0) continue;
      // Only feather at ROI boundary. No rotation/shear/rescale of the AI candidate.
      const f = Math.min(1, distance / 2),
        alpha = f * f * (3 - 2 * f);
      const p = (y * src.width + x) * 4;
      mask.data.set([255, 255, 255, 255], p);
      editablePixels++;
      for (let k = 0; k < 4; k++) {
        const v = Math.round(src.data[p + k]! * (1 - alpha) + edit.data[p + k]! * alpha);
        if (src.data[p + k] !== v) changedBytes++;
        out.data[p + k] = v;
      }
    }
  regions.push({ ...row, global, changedBytes, editablePixels, featherLogicalPx: 2, lockedBelow: row.chin.y + 0.5 });
}
for (const file of [output, maskPath, 'provenance/dash.head-replacement1.selection.json'])
  mkdirSync(dirname(resolve(outputRoot, file)), { recursive: true });
writeFileSync(resolve(outputRoot, output), encodePng(out));
writeFileSync(resolve(outputRoot, maskPath), encodePng(mask));
const inheritedRegistration = {
  kind: 'inherited-registration' as const,
  source,
  sourceSha256: hash(readFileSync(resolve(base, source))),
  mask: maskPath,
  maskSha256: hash(readFileSync(resolve(outputRoot, maskPath))),
  cells: [0, 2, 4, 9],
};
verifyInheritedRegistration(
  { ...inheritedRegistration, mask: resolve(outputRoot, maskPath) },
  readFileSync(resolve(outputRoot, output)),
  dash,
  base,
);
writeFileSync(
  resolve(outputRoot, 'provenance/dash.head-replacement1.selection.json'),
  JSON.stringify(
    {
      utc: new Date().toISOString(),
      source,
      sourceSha256: inheritedRegistration.sourceSha256,
      candidate,
      candidateSha256: hash(readFileSync(resolve(base, candidate))),
      output,
      outputSha256: hash(readFileSync(resolve(outputRoot, output))),
      mask: maskPath,
      maskSha256: inheritedRegistration.maskSha256,
      method:
        'One original-source AI master-locked head replacement for2/4. Feathered head/hair selection; outside-mask source RGBA exact, no geometric transform. Independently retained accepted original-source <=5% repairs0/9; no chained repair.',
      regions,
      inheritedRegistration,
      status: 'Candidate only; native anatomy and seams pending',
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(JSON.stringify({ output, regions, outsideMask: 'exact' }));
