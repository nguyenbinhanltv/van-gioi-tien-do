/* global console */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { cellHashes } from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/dao-tu-chibi-v1/E');
const cases = [
  { original: 'raw/attack_2.png', selected: 'raw/attack_2.repaired.png', changed: [2, 3] },
  { original: 'raw/hit-dash.png', selected: 'raw/hit-dash.repaired.png', changed: [11], unselected: true },
  { original: 'raw/hit-dash.png', selected: 'raw/hit-dash.boot-repaired.png', changed: [11] },
];
const sha = (bytes) => createHash('sha256').update(bytes).digest('hex');
const proof = cases.map((entry) => {
  const original = readFileSync(resolve(root, entry.original));
  const selected = readFileSync(resolve(root, entry.selected));
  const grid = { cols: 4, rows: 4 };
  const before = cellHashes(decodePng(original), grid);
  const after = cellHashes(decodePng(selected), grid);
  const changed = before.flatMap((hash, i) => (hash !== after[i] ? [i] : []));
  if (JSON.stringify(changed) !== JSON.stringify(entry.changed))
    throw new Error('Unexpected cell changes in ' + entry.selected);
  return {
    ...entry,
    grid,
    originalSha256: sha(original),
    selectedSha256: sha(selected),
    cellHashAlgorithm: 'SHA-1 via public cellHashes',
    before,
    after,
    unchangedCells: before.length - changed.length,
    verified: true,
  };
});
writeFileSync(resolve(root, 'repair-proof.json'), JSON.stringify(proof, null, 2) + '\n');
console.log('Verified repair cells: sweep 2/3 only; dash 11 only; all unrelated cells identical.');
