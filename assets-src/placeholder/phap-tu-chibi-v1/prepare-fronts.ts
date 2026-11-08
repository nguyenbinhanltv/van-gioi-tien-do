/** Extract the five front edit references without fitting tiers individually. */
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { alignFrame, CELL_PX, crop, guidesFromMaster, measureFigure, sliceSheet } from '@vgtd/sprite';
import { keyExteriorWhite } from './key-exterior.js';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const framing = JSON.parse(readFileSync(resolve(root, 'character-framing.json'), 'utf8'));
const source = decodePng(readFileSync(resolve(root, 'reference/T1-T5-front.raw.png')));
const prepared = JSON.parse(readFileSync(resolve(root, 'reference/master-preparation.json'), 'utf8'));
const master = measureFigure(decodePng(readFileSync(resolve(root, 'reference/S.master.png'))))!;
const guides = guidesFromMaster(master, CELL_PX, CELL_PX / 2 + framing.x);
const edges = [0, 410, 800, 1190, 1600, 2048].map((x) => Math.round((x * source.width) / 2048));
const records = edges.slice(0, -1).map((left, index) => {
  const panel = crop(source, left, 0, edges[index + 1]! - left, prepared.cropBottom);
  const frame = sliceSheet(
    keyExteriorWhite(panel),
    { cols: 1, rows: 1, frames: 1 },
    {
      inset: 0,
      minArea: 100,
    },
  )[0]!;
  const aligned = alignFrame(frame.image, { calibration: prepared.calibration, guides });
  if (!aligned) throw new Error(`Empty tier T${index + 1}`);
  const file = `reference/T${index + 1}.front.master.png`;
  writeFileSync(resolve(root, file), encodePng(aligned.image));
  return { tier: index + 1, file, ...aligned.record };
});
writeFileSync(
  resolve(root, 'reference/front-preparation.json'),
  JSON.stringify(
    {
      source: 'T1-T5-front.raw.png',
      scale: prepared.calibration.scale,
      records,
      note: 'Same source scale as canonical T1 turnaround, no per-tier fit. T4/T5 conceptual FX remain reference-only and need separate runtime layers.',
    },
    null,
    2,
  ) + '\n',
);
