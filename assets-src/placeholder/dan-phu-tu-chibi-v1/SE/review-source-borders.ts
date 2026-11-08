/** Audit the full keyed source BEFORE cell cropping or fragment cleanup. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { cellRect, keyOut, normalizeSheetDpi, sheetLayout, toStraight, type Project } from '@vgtd/sprite';

const base = resolve('assets-src/placeholder/dan-phu-tu-chibi-v1/SE');
const project = JSON.parse(readFileSync(base + '/project.json', 'utf8')) as Project;
const seen = new Set<string>();
const sheets = project.clips.flatMap((clip) => {
  if (seen.has(clip.sheet)) return [];
  seen.add(clip.sheet);
  const raw = readFileSync(resolve(base, clip.sheet));
  const grid = sheetLayout(clip);
  const resample = project.resample ?? 'bilinear';
  const deferred = resample !== 'bilinear';
  const prepared = normalizeSheetDpi(
    decodePng(raw),
    grid.cols,
    grid.frames,
    deferred ? { resample, defer: true } : {},
  ).image;
  const full = keyOut(toStraight(prepared), project.slice);
  const cells = Array.from({ length: grid.frames }, (_, index) => {
    const rect = cellRect(full.width, full.height, grid.cols, grid.rows, index);
    let margin32 = Math.min(rect.width, rect.height),
      margin128 = margin32;
    const edgeSamples: { x: number; y: number; alpha: number }[] = [];
    for (let y = 0; y < rect.height; y++)
      for (let x = 0; x < rect.width; x++) {
        const alpha = full.data[((rect.y + y) * full.width + rect.x + x) * 4 + 3]!;
        const margin = Math.min(x, y, rect.width - 1 - x, rect.height - 1 - y);
        if (alpha >= 32) margin32 = Math.min(margin32, margin);
        if (alpha >= 128) margin128 = Math.min(margin128, margin);
        if (margin === 0 && alpha >= 32) edgeSamples.push({ x, y, alpha });
      }
    return { index, margin32, margin128, edgeSamples };
  });
  return [
    {
      sheet: clip.sheet,
      sha256: createHash('sha256').update(raw).digest('hex'),
      resample,
      pixelUnits: deferred ? 'native input raster' : 'normalized input raster',
      cells,
    },
  ];
});
const contacts = sheets.flatMap((s) =>
  s.cells.filter((c) => c.edgeSamples.length).map((c) => ({ sheet: s.sheet, ...c })),
);
writeFileSync(
  base + '/source-border-review.json',
  JSON.stringify(
    {
      method:
        'Public DPI preparation with native deferral for single-pass resampling, then project chroma key before crop/inset/fragment removal. Opaque128 and component32 support are recorded in input raster units. No pixel, pose or scale is changed.',
      contacts,
      sheets,
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    sheets: sheets.length,
    cells: sheets.reduce((n, s) => n + s.cells.length, 0),
    contacts: contacts.length,
  }),
);
if (contacts.length) process.exitCode = 1;
