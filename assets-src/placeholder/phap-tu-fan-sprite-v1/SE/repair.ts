/** Reproduce cell-local selections; original generations remain immutable. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellHashes, repairCell } from '@vgtd/sprite';
const base = resolve('assets-src/placeholder/phap-tu-fan-sprite-v1/SE/sheets');
for (const spec of [
  {
    clip: 'run',
    original: 'run.reroll1.generated.png',
    edited: 'run.repair2.generated.png',
    cols: 6,
    cells: [0, 1, 2, 3, 5, 7, 8, 9],
  },
  { clip: 'die', original: 'die.generated.png', edited: 'die.repair1.generated.png', cols: 4, cells: [3] },
]) {
  const original = decodePng(readFileSync(resolve(base, spec.original)));
  const edited = decodePng(readFileSync(resolve(base, spec.edited)));
  const grid = { cols: spec.cols, rows: 2 };
  const before = cellHashes(original, grid);
  let selected = original;
  for (const cell of spec.cells) selected = repairCell(selected, edited, grid, cell).image;
  const after = cellHashes(selected, grid);
  const changed = after.flatMap((h, i) => (h === before[i] ? [] : [i]));
  if (changed.some((i) => !spec.cells.includes(i))) throw new Error('Untargeted cell changed');
  writeFileSync(resolve(base, spec.clip + '.selected.png'), encodePng(selected));
  writeFileSync(
    resolve(base, spec.clip + '.repair.json'),
    JSON.stringify(
      {
        method: '@vgtd/sprite repairCell, no figure scaling',
        original: spec.original,
        edited: spec.edited,
        targets: spec.cells,
        changed,
        before,
        after,
      },
      null,
      2,
    ) + '\n',
  );
}
