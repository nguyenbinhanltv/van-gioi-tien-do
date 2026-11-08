/** Reproduce the T1 turnaround masters: whole-panel selection, keying, one scale, translations only. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { alignFrame, guidesFromMaster, measureFigure, sliceSheet, CELL_PX } from '@vgtd/sprite';

const root = process.argv[2]!;
const first = decodePng(readFileSync(join(root, 'raw/turnaround.attempt1.png')));
const correction = decodePng(readFileSync(join(root, 'raw/turnaround.attempt2.png')));
if (first.width !== correction.width || first.height !== correction.height)
  throw new Error('Correction geometry differs');
const selected = createImage(first.width, first.height);
selected.data.set(first.data);
const x0 = Math.round((first.width * 3) / 5);
const x1 = Math.round((first.width * 4) / 5);
for (let y = 0; y < first.height; y++) {
  const start = (y * first.width + x0) * 4;
  const end = (y * first.width + x1) * 4;
  selected.data.set(correction.data.subarray(start, end), start);
}
writeFileSync(join(root, 'turnaround.png'), encodePng(selected));
const directions = ['E', 'SE', 'S', 'NE', 'N'];
const frames = directions.map((direction, i) => {
  const left = Math.round((first.width * i) / 5);
  const right = Math.round((first.width * (i + 1)) / 5);
  const panel = createImage(right - left, first.height);
  for (let y = 0; y < first.height; y++) {
    const start = (y * first.width + left) * 4;
    panel.data.set(selected.data.subarray(start, start + panel.width * 4), y * panel.width * 4);
  }
  const keyed = sliceSheet(panel, { cols: 1, rows: 1, frames: 1 })[0]!.image;
  const metrics = measureFigure(keyed);
  if (!metrics) throw new Error('Empty panel');
  return { direction, keyed, metrics, panel: { left, right, height: first.height } };
});
const targetHeight = 208; // Texture-space authoring size; one global calibration, never per-frame fitting.
const calibration = {
  scale: targetHeight / frames[0]!.metrics.height,
  targetHeight,
  referenceHeight: frames[0]!.metrics.height,
  referenceFrames: 1,
};
const guides = guidesFromMaster({ ...frames[0]!.metrics, height: targetHeight }, CELL_PX, CELL_PX / 2);
const records = frames.map(({ direction, keyed, metrics, panel }) => {
  const aligned = alignFrame(keyed, { calibration, guides });
  writeFileSync(join(root, direction + '.master.png'), encodePng(aligned.image));
  return { direction, panel, source: metrics, ...aligned.record };
});
writeFileSync(
  join(root, 'master-calibration.json'),
  JSON.stringify(
    {
      calibration,
      guides,
      records,
      selection: {
        base: 'raw/turnaround.attempt1.png',
        correction: 'raw/turnaround.attempt2.png',
        panel: 'NE',
        x0,
        x1,
        otherPanels: 'byte-identical RGBA copied from base; no resampling before global calibration',
      },
    },
    null,
    2,
  ) + '\n',
);
console.log(JSON.stringify({ calibration, guides, records }, null, 2));
