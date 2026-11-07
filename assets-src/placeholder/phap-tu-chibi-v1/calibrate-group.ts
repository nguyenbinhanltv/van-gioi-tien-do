/** One fixed calibration shared by both clips on the grouped generation sheet. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { measureFigure, median, normalizeSheetDpi, sliceSheet, smoothProjectClipDefaults } from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const sheet = decodePng(readFileSync(resolve(root, 'E/sheets/hit-dash.png')));
const prepared = normalizeSheetDpi(sheet, 4, 16);
const cells = sliceSheet(prepared.image, { cols: 4, rows: 4, frames: 16 });
const referenceCells = [0, 1, 4, 5, 15];
const referenceHeights = referenceCells.map((index) => measureFigure(cells[index]!.image)!.height);
const master = measureFigure(decodePng(readFileSync(resolve(root, 'reference/E.master.png'))))!;
const scale = master.height / median(referenceHeights);
const projectPath = resolve(root, 'E/project.json');
const project = JSON.parse(readFileSync(projectPath, 'utf8'));
const mappings = JSON.parse(readFileSync(resolve(root, 'E/templates/hit-dash/group.clips.json'), 'utf8'));
for (const mapping of mappings) {
  const defaults = smoothProjectClipDefaults(mapping.name);
  const clip = {
    ...defaults,
    ...mapping,
    sheet: 'sheets/hit-dash.png',
    manifest: 'templates/hit-dash/group.template.json',
    calibration: { scale },
  };
  const existing = project.clips.findIndex((entry: { name: string }) => entry.name === mapping.name);
  if (existing < 0) project.clips.push(clip);
  else project.clips[existing] = { ...project.clips[existing], ...clip };
}
writeFileSync(projectPath, JSON.stringify(project, null, 2) + '\n');
writeFileSync(
  resolve(root, 'E/hit-dash.calibration.json'),
  JSON.stringify(
    {
      source: 'sheets/hit-dash.png',
      referenceCells,
      referenceHeights,
      scale,
      note: 'One shared full-sheet scale measured from upright cells after layout reflow; used identically for hit and dash, never a per-frame fit. Whole-sheet DPI preparation is declared separately.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ scale, referenceHeights }));
