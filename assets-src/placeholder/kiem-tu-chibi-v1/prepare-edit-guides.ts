/** Master-populated authoring guides only: repeated reference cells are never counted as animation drawings. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  blendPixel,
  CELL_PX,
  fillEllipse,
  GUIDE_COLORS,
  SMOOTH_SPRITE_CLIPS,
  toPremultiplied,
  toStraight,
  type TemplateManifest,
} from '@vgtd/sprite';

const root = process.argv[2];
const direction = process.argv[3] ?? 'E';
if (!root) throw new Error('usage: prepare-edit-guides.ts <asset-root> [direction]');
const master = toStraight(decodePng(readFileSync(join(root, 'reference', `${direction}.master.png`))));
const names = [
  ...SMOOTH_SPRITE_CLIPS.filter((clip) => !['hit', 'dash'].includes(clip.name)).map((clip) => clip.name),
  'hit-dash',
];
for (const name of names) {
  const base = join(root, direction, 'templates', name);
  const manifest = JSON.parse(readFileSync(`${base}.template.json`, 'utf8')) as TemplateManifest;
  const guide = toStraight(decodePng(readFileSync(`${base}.template.png`)));
  for (let index = 0; index < manifest.frames; index++) {
    const ox = (index % manifest.grid.cols) * CELL_PX;
    const oy = Math.floor(index / manifest.grid.cols) * CELL_PX;
    for (let y = 0; y < CELL_PX; y++)
      for (let x = 0; x < CELL_PX; x++) {
        const offset = (y * CELL_PX + x) * 4;
        const alpha = master.data[offset + 3]! / 255;
        if (alpha)
          blendPixel(
            guide,
            ox + x,
            oy + y,
            [master.data[offset]!, master.data[offset + 1]!, master.data[offset + 2]!],
            alpha,
          );
      }
    const cell = manifest.cells[index]!;
    for (const [foot, color] of [
      [cell.farFoot, GUIDE_COLORS.farFoot],
      [cell.nearFoot, GUIDE_COLORS.nearFoot],
    ] as const)
      if (foot) fillEllipse(guide, ox + foot.x, oy + foot.y, foot.planted ? 11 : 8, foot.planted ? 4 : 3, color, 0.9);
  }
  writeFileSync(`${base}.master-edit-guide.png`, encodePng(toPremultiplied(guide)));
}
console.log('Wrote authoring-only master-populated guides; no animation frames generated.');
