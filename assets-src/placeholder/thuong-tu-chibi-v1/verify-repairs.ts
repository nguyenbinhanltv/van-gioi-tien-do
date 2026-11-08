/** Replays retained public repair operations and verifies their file/cell proofs. */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { cellHashes, repairCell } from '@vgtd/sprite';

interface FileProof {
  path: string;
  sha256: string;
}
interface Proof {
  files: FileProof[];
  cell?: number;
  cells?: number[];
  changed: number[];
  sources?: { file: string; cells: number[] }[];
}
const root = dirname(resolve(process.argv[1]!));
const base = resolve(root, process.argv[2] ?? 'E');
const pathOf = (path: string) => (existsSync(resolve(base, path)) ? resolve(base, path) : resolve(path));
let checked = 0;
for (const file of readdirSync(base)
  .filter((name) => name.endsWith('.proof.json'))
  .sort()) {
  const data = JSON.parse(readFileSync(resolve(base, file), 'utf8')) as Proof & { records?: Proof[] };
  for (const proof of data.records ?? [data]) {
    for (const entry of proof.files) {
      const hash = createHash('sha256')
        .update(readFileSync(pathOf(entry.path)))
        .digest('hex');
      if (hash !== entry.sha256) throw new Error(`${file}: file hash mismatch ${entry.path}`);
    }
    const original = decodePng(readFileSync(pathOf(proof.files[0]!.path)));
    const selected = decodePng(readFileSync(pathOf(proof.files.at(-1)!.path)));
    const allowed = proof.cells ?? (proof.cell === undefined ? proof.changed : [proof.cell]);
    const steps = proof.sources ?? [{ file: proof.files[1]!.path, cells: allowed }];
    let replay = original;
    for (const step of steps) {
      const edited = decodePng(readFileSync(pathOf(step.file)));
      for (const cell of step.cells) replay = repairCell(replay, edited, { cols: 4, rows: 4 }, cell).image;
    }
    const before = cellHashes(original, { cols: 4, rows: 4 });
    const actual = cellHashes(selected, { cols: 4, rows: 4 });
    const expected = cellHashes(replay, { cols: 4, rows: 4 });
    const changed = actual.flatMap((hash, i) => (hash !== before[i] ? [i] : []));
    if (actual.some((hash, i) => hash !== expected[i]) || changed.some((i) => !allowed.includes(i)))
      throw new Error(`${file}: replay or unrelated cell mismatch`);
    if (JSON.stringify(changed) !== JSON.stringify(proof.changed)) throw new Error(`${file}: changed list mismatch`);
    checked++;
    console.log(`${file}: changed ${changed.join(',')}; ${16 - changed.length} unchanged`);
  }
}
if (!checked) throw new Error('No repair proofs found');
console.log(`Verified ${checked} public repair records.`);
