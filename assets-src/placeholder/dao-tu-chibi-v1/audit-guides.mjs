/* global console */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng } from '@vgtd/rig';
import { CELL_PX } from '@vgtd/sprite';
const root = resolve('assets-src/placeholder/dao-tu-chibi-v1/E/templates');
const provenance = JSON.parse(readFileSync(resolve(root, 'head-stencils.provenance.json'), 'utf8'));
for (const r of provenance.records) {
  const a = decodePng(readFileSync(resolve(root, r.clip + '.head-stencil.template.png')));
  const b = decodePng(readFileSync(resolve(root, r.clip + '.template.png')));
  const counts = [];
  for (let i = 0; i < 16; i++) {
    const ox = (i % 4) * CELL_PX + r.headRect.x,
      oy = Math.floor(i / 4) * CELL_PX + r.headRect.y;
    let count = 0;
    for (let y = oy; y < oy + r.headRect.height; y++)
      for (let x = ox; x < ox + r.headRect.width; x++) {
        const p = (y * a.width + x) * 4;
        if (a.data[p] !== b.data[p] || a.data[p + 1] !== b.data[p + 1] || a.data[p + 2] !== b.data[p + 2]) count++;
      }
    counts.push(count);
  }
  if (counts.some((n, i) => (i < r.used ? n === 0 : n !== 0))) throw new Error('Stencil coverage mismatch ' + r.clip);
  console.log(r.clip + ': ' + counts.join(','));
}
