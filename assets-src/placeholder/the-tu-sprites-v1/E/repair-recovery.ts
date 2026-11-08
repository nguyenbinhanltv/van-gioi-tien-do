import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { decodePng, encodePng } from '@vgtd/rig';
import { cellHashes, cellRect, repairCell } from '@vgtd/sprite';

const base = dirname(process.argv[1]!);
const raw = join(base, 'raw/attack_3.attempt1.png');
const original = decodePng(readFileSync(raw));
const donor = decodePng(readFileSync(raw));
const grid = { cols: 5, rows: 2 };
const source = cellRect(original.width, original.height, 5, 2, 0);
const target = cellRect(original.width, original.height, 5, 2, 9);
const width = Math.min(source.width, target.width);
const height = Math.min(source.height, target.height);
if (Math.abs(source.width - target.width) > 1 || Math.abs(source.height - target.height) > 1)
  throw new Error('Unexpected cell boundary difference');
for (let y = 0; y < source.height; y++)
  for (let x = 0; x < source.width; x++) {
    if (x < width && y < height) continue;
    const i = ((source.y + y) * original.width + source.x + x) * 4;
    if (original.data[i]! < 220 || original.data[i + 1]! > 30 || original.data[i + 2]! < 220)
      throw new Error(
        `Donor boundary contains non-key pixel at ${x},${y}: ${Array.from(original.data.subarray(i, i + 4))}`,
      );
  }
for (let y = 0; y < target.height; y++)
  for (let x = 0; x < target.width; x++) {
    const i = ((target.y + y) * donor.width + target.x + x) * 4;
    donor.data.set([255, 0, 255, 255], i);
  }
for (let y = 0; y < height; y++) {
  const from = ((source.y + y) * original.width + source.x) * 4;
  const to = ((target.y + y) * donor.width + target.x) * 4;
  donor.data.set(original.data.subarray(from, from + width * 4), to);
}
const result = repairCell(original, donor, grid, 9);
const before = cellHashes(original, grid);
const after = cellHashes(result.image, grid);
if (before.some((h, i) => i !== 9 && h !== after[i])) throw new Error('Unrelated cell changed');
writeFileSync(join(base, 'sheets/attack_3.png'), encodePng(result.image));
writeFileSync(
  join(base, 'raw/attack_3.recovery-repair.json'),
  JSON.stringify(
    {
      method:
        'Cell-local return-to-guard repair: reuse cell0 verbatim as final cell9. No AI call, no frame scaling, no interpolation.',
      reason:
        'Generated final standing recovery was225px (master217 +/-3%); initial standing guard220px is the intended return pose.',
      donorCell0: 0,
      repairedCell0: 9,
      unchangedOtherCells: 9,
      before,
      after,
      boundaryOnly: { source, target, copiedWidth: width, copiedHeight: height, droppedPixelsVerifiedMagenta: true },
    },
    null,
    2,
  ) + '\n',
);
