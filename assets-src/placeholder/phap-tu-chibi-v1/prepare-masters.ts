/** Reproducible source slicing: one shared scale, translation only per view. */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { alignFrame, CELL_PX, crop, guidesFromMaster, measureFigure, sliceSheet } from '@vgtd/sprite';
import { keyExteriorWhite } from './key-exterior.js';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const framing = JSON.parse(readFileSync(resolve(root, 'character-framing.json'), 'utf8'));
const input = readFileSync(resolve(root, 'reference/T1-turnaround.raw.png'));
const source = decodePng(input);
// Label-free crop measured in the actual 2172×724 source, not its chat preview.
const cropBottom = Math.round(source.height * (620 / 683));
const panelEdges = [0, 410, 800, 1190, 1600, 2048].map((x) => Math.round((x * source.width) / 2048));
const sliced = panelEdges.slice(0, -1).map((left, index) => {
  const panel = crop(source, left, 0, panelEdges[index + 1]! - left, cropBottom);
  return sliceSheet(
    keyExteriorWhite(panel),
    { cols: 1, rows: 1, frames: 1 },
    {
      inset: 0,
      minArea: 100,
    },
  )[0]!;
});
const measurements = sliced.map((frame) => measureFigure(frame.image)!);
const anatomy = JSON.parse(readFileSync(resolve(root, 'reference/anatomy-landmarks.json'), 'utf8'));
const targetHeight = anatomy.targetAnatomicalHeight2x;
const scale = targetHeight / anatomy.anatomicalHeight;
const calibration = {
  scale,
  targetHeight,
  referenceHeight: anatomy.anatomicalHeight,
  referenceFrames: 1,
};
const guides = guidesFromMaster({ ...measurements[0]!, height: targetHeight }, CELL_PX, CELL_PX / 2 + framing.x);
const records = sliced.map((frame, index) => {
  const direction = ['E', 'SE', 'S', 'NE', 'N'][index]!;
  const aligned = alignFrame(frame.image, { calibration, guides });
  if (!aligned) throw new Error(`Empty master: ${direction}`);
  const file = `reference/${direction}.master.png`;
  writeFileSync(resolve(root, file), encodePng(aligned.image));
  return { direction, file, ...aligned.record };
});
writeFileSync(
  resolve(root, 'reference/master-preparation.json'),
  JSON.stringify(
    {
      source: 'T1-turnaround.raw.png',
      sourceSha256: createHash('sha256').update(input).digest('hex'),
      cropBottom,
      panelEdges,
      calibration,
      guides,
      records,
      anatomySource: 'anatomy-landmarks.json',
      note: 'Shared source scale across all directions from anatomical crown-to-sole height, excluding ornaments. No per-view or per-frame height normalization. Alpha bounds are separate diagnostics; anatomy landmarks retain manual uncertainty.',
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ calibration, records }, null, 2));
