/** Retain AI raw edits, but composite only the explicitly requested cells. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellHashes, repairCell } from '@vgtd/sprite';

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-padding-repairs.ts <direction-root>');
const grid = { cols: 4, rows: 4 };
const hash = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
for (const clip of ['attack', 'attack_3']) {
  const input = readFileSync(join(root, 'sheets', `${clip}.raw.png`));
  const edit = readFileSync(join(root, 'sheets', `${clip}.repair-attempt-02.raw.png`));
  const original = decodePng(input);
  const edited = decodePng(edit);
  let image = original;
  for (const cell of [7, 8]) image = repairCell(image, edited, grid, cell).image;
  const before = cellHashes(original, grid);
  const after = cellHashes(image, grid);
  const changed = after.flatMap((value, index) => (value === before[index] ? [] : [index]));
  if (JSON.stringify(changed) !== '[7,8]') throw new Error(`Unexpected changed cells: ${changed}`);
  const output = encodePng(image);
  writeFileSync(join(root, 'sheets', `${clip}.repaired.png`), output);
  writeFileSync(
    join(root, `${clip}.repair-proof.json`),
    JSON.stringify(
      {
        inputSha256: hash(input),
        editSha256: hash(edit),
        outputSha256: hash(output),
        originalDimensions: [original.width, original.height],
        editDimensions: [edited.width, edited.height],
        changed,
        unchangedCellsByteIdentical: true,
        before,
        after,
        status:
          'Selected-cell derivative only; visual padding, face and head-size checks still required before acceptance.',
      },
      null,
      2,
    ) + '\n',
  );
  console.log(`${clip}: only cells ${changed} changed`);
}
