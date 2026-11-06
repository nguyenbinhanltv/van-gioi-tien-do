/** Reproduce only declared cell edits, preserving all original generations. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellHashes, repairCell } from '@vgtd/sprite';
const base = resolve('assets-src/placeholder/phap-tu-fan-sprite-v1/S/sheets');
for (const [clip, cells] of [
  ['walk', [3, 4, 7, 8, 9]],
  ['run', [2, 7, 8]],
] as const) {
  const original = decodePng(readFileSync(resolve(base, clip + '.generated.png')));
  const edited = decodePng(readFileSync(resolve(base, clip + '.repair1.generated.png')));
  const grid = { cols: 6, rows: 2 };
  const before = cellHashes(original, grid);
  let selected = original;
  for (const cell of cells) selected = repairCell(selected, edited, grid, cell).image;
  const after = cellHashes(selected, grid),
    changed = after.flatMap((h, i) => (h === before[i] ? [] : [i]));
  if (changed.some((i) => !(cells as readonly number[]).includes(i))) throw new Error('Untargeted cell changed');
  writeFileSync(resolve(base, clip + '.selected.png'), encodePng(selected));
  writeFileSync(
    resolve(base, clip + '.repair.json'),
    JSON.stringify(
      {
        method: '@vgtd/sprite repairCell, whole-sheet DPI registration of edit only; no figure scaling',
        original: clip + '.generated.png',
        edited: clip + '.repair1.generated.png',
        originalSize: [original.width, original.height],
        editedSize: [edited.width, edited.height],
        targets: cells,
        changed,
        before,
        after,
      },
      null,
      2,
    ) + '\n',
  );
}
