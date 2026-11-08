/** Compare optional asymmetric despill on actual selected sources; this is not semantic colour detection. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { normalizeSheetDpi, paletteFromMaster, sheetLayout, sliceSheet, type Project } from '@vgtd/sprite';

const root = dirname(resolve(process.argv[1]!));
const base = resolve(root, process.argv[2] ?? 'E');
const projectBytes = readFileSync(resolve(base, 'project.json'));
const project = JSON.parse(projectBytes.toString('utf8')) as Project;
const palette = paletteFromMaster(decodePng(readFileSync(resolve(base, project.master))), project.palette);
const spill = project.slice?.spill;
if (!spill?.asymmetric) throw new Error('Project has no optional asymmetric despill to compare');
const seen = new Set<string>();
const records = [];
for (const clip of project.clips) {
  if (seen.has(clip.sheet)) continue;
  seen.add(clip.sheet);
  const bytes = readFileSync(resolve(base, clip.sheet));
  const raw = decodePng(bytes);
  const grid = sheetLayout(clip);
  const native = project.preparation
    ? normalizeSheetDpi(raw, grid.cols, grid.frames, { resample: 'lanczos3', defer: true }).image
    : raw;
  const common = { ...project.slice, spill: { palette, ...spill } };
  const before = sliceSheet(native, grid, { ...common, spill: { ...common.spill, asymmetric: undefined } });
  const after = sliceSheet(native, grid, common);
  let alphaChanged = 0,
    colourChanged = 0,
    dominantRedPixels = 0,
    dominantRedChanged = 0;
  before.forEach((frame, i) => {
    const a = frame.image.data,
      b = after[i]!.image.data;
    for (let p = 0; p < a.length; p += 4) {
      if (a[p + 3] !== b[p + 3]) alphaChanged++;
      const changed = a[p] !== b[p] || a[p + 1] !== b[p + 1] || a[p + 2] !== b[p + 2];
      if (changed) colourChanged++;
      // Diagnostic mask for this class's saturated red pennon/sash, not a general pink/red classifier.
      if (a[p + 3]! >= 128 && a[p]! > 80 && a[p]! > a[p + 1]! * 1.5 && a[p]! > a[p + 2]! * 1.5) {
        dominantRedPixels++;
        if (changed) dominantRedChanged++;
      }
    }
  });
  if (alphaChanged) throw new Error('Optional despill unexpectedly changed alpha: ' + clip.sheet);
  records.push({
    sheet: clip.sheet,
    sha256: createHash('sha256').update(bytes).digest('hex'),
    alphaChanged,
    colourChanged,
    dominantRedPixels,
    dominantRedChanged,
  });
}
const result = {
  method: 'Public native-DPI sliceSheet before/after optional asymmetric despill; palette protection retained.',
  caveat:
    'Dominant-red mask is only a diagnostic for this class. Legitimate pink/red and ringing still need visual review.',
  projectSha256: createHash('sha256').update(projectBytes).digest('hex'),
  spill,
  records,
};
const out = process.argv.indexOf('--out');
if (out >= 0) writeFileSync(resolve(process.argv[out + 1]!), JSON.stringify(result, null, 2) + '\n');
console.log(
  JSON.stringify(
    {
      sheets: records.length,
      alphaChanged: records.reduce((n, r) => n + r.alphaChanged, 0),
      dominantRedPixels: records.reduce((n, r) => n + r.dominantRedPixels, 0),
      dominantRedChanged: records.reduce((n, r) => n + r.dominantRedChanged, 0),
      colourChanged: records.reduce((n, r) => n + r.colourChanged, 0),
    },
    null,
    2,
  ),
);
