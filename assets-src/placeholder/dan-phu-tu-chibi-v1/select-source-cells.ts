/** Select complete AI-drawn native cells without resizing or repainting. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellRect, cellHashes } from '@vgtd/sprite';
const [basePath, editPath, outPath, colsArg, rowsArg, cellsArg] = process.argv.slice(2);
if (!basePath || !editPath || !outPath || !colsArg || !rowsArg || !cellsArg)
  throw new Error('base edit out cols rows cells');
const originalBytes = readFileSync(basePath),
  editBytes = readFileSync(editPath);
const original = decodePng(originalBytes),
  edited = decodePng(editBytes);
if (original.width !== edited.width || original.height !== edited.height)
  throw new Error('No implicit resizing: source dimensions differ');
const grid = { cols: Number(colsArg), rows: Number(rowsArg) };
const selectedCells = cellsArg.split(',').map(Number);
if (selectedCells.some((i) => !Number.isInteger(i) || i < 0 || i >= grid.cols * grid.rows))
  throw new Error('Invalid cell');
const selected = { ...original, data: new Uint8ClampedArray(original.data) };
for (const cell of selectedCells) {
  const r = cellRect(original.width, original.height, grid.cols, grid.rows, cell);
  for (let y = r.y; y < r.y + r.height; y++) {
    const start = (y * original.width + r.x) * 4;
    selected.data.set(edited.data.subarray(start, start + r.width * 4), start);
  }
}
const before = cellHashes(original, grid),
  edit = cellHashes(edited, grid),
  after = cellHashes(selected, grid);
const proof = after.map((hash, cell) => {
  const source = selectedCells.includes(cell) ? 'edit' : 'base';
  const expected = source === 'edit' ? edit[cell] : before[cell];
  if (hash !== expected) throw new Error('Native cell selection mismatch');
  return { cell, source, expected, selected: hash };
});
writeFileSync(outPath, encodePng(selected));
const sha256 = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
writeFileSync(
  outPath + '.selection.json',
  JSON.stringify(
    {
      method: 'Native whole-cell RGBA selection; dimensions must match; no resizing, fitting or repainting.',
      basePath,
      editPath,
      originalSha256: sha256(originalBytes),
      editSha256: sha256(editBytes),
      grid,
      selectedCells,
      proof,
    },
    null,
    2,
  ) + '\n',
);
console.log('Selected ' + selectedCells.length + ' native cells; all ' + proof.length + ' cell hashes verified.');
