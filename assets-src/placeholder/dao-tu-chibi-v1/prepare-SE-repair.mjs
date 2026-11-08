/* global console */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { decodePng, encodePng } from '@vgtd/rig';
import { repairCell, cellHashes } from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/dao-tu-chibi-v1/SE');
const original = decodePng(readFileSync(resolve(root, 'raw/attack_2.png')));
const candidate = decodePng(readFileSync(resolve(root, 'raw/attack_2.clearance-candidate.png')));
if (original.width !== candidate.width || original.height !== candidate.height)
  throw new Error('Repair must preserve the original canvas; resizing is forbidden.');
const grid = { cols: 4, rows: 4 };
let selected = original;
for (const cell of [3, 4]) selected = repairCell(selected, candidate, grid, cell).image;
const before = cellHashes(original, grid);
const after = cellHashes(selected, grid);
const changed = before.flatMap((h, i) => (h === after[i] ? [] : [i]));
if (JSON.stringify(changed) !== '[3,4]') throw new Error('Unexpected repair cells');
const bytes = encodePng(selected);
writeFileSync(resolve(root, 'raw/attack_2.clearance-repaired.png'), bytes);
writeFileSync(
  resolve(root, 'repair-proof.json'),
  JSON.stringify(
    {
      original: 'raw/attack_2.png',
      candidate: 'raw/attack_2.clearance-candidate.png',
      selected: 'raw/attack_2.clearance-repaired.png',
      grid,
      changed,
      before,
      after,
      unchangedCells: 14,
      resized: false,
      selectedSha256: createHash('sha256').update(bytes).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log('SE arc repair: only cells 3/4 changed, no resize.');
