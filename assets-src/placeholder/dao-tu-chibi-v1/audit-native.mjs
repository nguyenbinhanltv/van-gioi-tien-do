/* global process, console */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import {
  CELL_PX,
  normalizeSheetDpi,
  sheetLayout,
  crop,
  toStraight,
  keyOut,
  defringe,
  removeFragments,
  measureFigure,
} from '@vgtd/sprite';

const base = resolve('assets-src/placeholder/dao-tu-chibi-v1', process.argv[2]);
const project = JSON.parse(readFileSync(resolve(base, 'project.json'), 'utf8'));
const rows = [];
for (const clip of project.clips) {
  const layout = sheetLayout(clip);
  const raw = decodePng(readFileSync(resolve(base, clip.sheet)));
  const normalized = normalizeSheetDpi(raw, layout.cols, layout.frames);
  const cells = clip.sheetSelection?.cells ?? Array.from({ length: clip.frames }, (_, i) => i);
  for (const [frame, sourceCell] of cells.entries()) {
    const cell = crop(
      toStraight(normalized.image),
      (sourceCell % layout.cols) * CELL_PX,
      Math.floor(sourceCell / layout.cols) * CELL_PX,
      CELL_PX,
      CELL_PX,
    );
    // No slicer inset: inspect every source pixel before any border is removed.
    const bounds = measureFigure(removeFragments(defringe(keyOut(cell))).image);
    if (!bounds) throw new Error(`Empty ${clip.name}/${frame}`);
    const minMarginPx = Math.min(bounds.left, bounds.top, CELL_PX - bounds.right, CELL_PX - bounds.bottom);
    rows.push({ clip: clip.name, frame, sourceCell, sheet: clip.sheet, bounds, minMarginPx });
  }
}
const unsafe = rows.filter((row) => row.minMarginPx < 3);
const result = {
  direction: project.direction,
  frames: rows.length,
  sourceInset: 0,
  note: 'Whole-sheet square-cell DPI normalization only; no individual frame fit. Native alpha checked before the slicer inset.',
  minimumRequiredMarginPx: 3,
  unsafe,
  rows,
};
writeFileSync(resolve(base, 'native-source-bounds.json'), JSON.stringify(result, null, 2) + '\n');
console.log(`${project.direction}: ${rows.length} native source cells, ${unsafe.length} unsafe margins.`);
if (unsafe.length) process.exitCode = 1;
