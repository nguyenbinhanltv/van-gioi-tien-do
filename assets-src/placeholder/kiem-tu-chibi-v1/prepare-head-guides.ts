/** Authoring-only unscaled master-head stencils; AI output must still be independently measured. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  blendPixel,
  CELL_PX,
  KEY_MAGENTA,
  normalizeSheetDpi,
  sliceSheet,
  solid,
  toPremultiplied,
  toStraight,
} from '@vgtd/sprite';

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-head-guides.ts <asset-root>');
const reference = readFileSync(join(root, 'reference', 'E.master.png'));
const source = readFileSync(join(root, 'E', 'sheets', 'meditate.raw.png'));
const master = toStraight(decodePng(reference));
const prepared = normalizeSheetDpi(decodePng(source), 4, 16);
const cells = sliceSheet(prepared.image, { cols: 4, rows: 4, frames: 16 }, { inset: 0, key: 'auto', spill: {} });
const guide = solid(CELL_PX * 4, CELL_PX * 4, KEY_MAGENTA);
const placements = [];
for (let index = 0; index < cells.length; index++) {
  const ox = (index % 4) * CELL_PX;
  const oy = Math.floor(index / 4) * CELL_PX;
  const body = cells[index]!.image;
  const dx = 18;
  const dy = 44 + Math.round(Math.sin((index * Math.PI * 2) / cells.length));
  for (let y = 116; y < CELL_PX; y++)
    for (let x = 0; x < CELL_PX; x++) {
      const p = (y * CELL_PX + x) * 4;
      if (body.data[p + 3])
        blendPixel(
          guide,
          ox + x,
          oy + y,
          [body.data[p]!, body.data[p + 1]!, body.data[p + 2]!],
          body.data[p + 3]! / 255,
        );
    }
  for (let y = 0; y < 74; y++)
    for (let x = 0; x < CELL_PX; x++) {
      const p = (y * CELL_PX + x) * 4;
      if (master.data[p + 3])
        blendPixel(
          guide,
          ox + x + dx,
          oy + y + dy,
          [master.data[p]!, master.data[p + 1]!, master.data[p + 2]!],
          master.data[p + 3]! / 255,
        );
    }
  placements.push({
    index,
    dx,
    dy,
    headScale: 1,
    note: 'Unscaled canonical head copied as an AI input guide, not an animation drawing or output QA proof.',
  });
}
const base = join(root, 'E', 'templates', 'meditate.head-stencil-guide');
writeFileSync(`${base}.png`, encodePng(toPremultiplied(guide)));
writeFileSync(
  `${base}.json`,
  JSON.stringify(
    {
      masterSha256: createHash('sha256').update(reference).digest('hex'),
      sourceSha256: createHash('sha256').update(source).digest('hex'),
      source: 'E/sheets/meditate.raw.png',
      placements,
    },
    null,
    2,
  ) + '\n',
);
console.log('Wrote meditation head-stencil authoring input; no output head-size pass claimed.');
