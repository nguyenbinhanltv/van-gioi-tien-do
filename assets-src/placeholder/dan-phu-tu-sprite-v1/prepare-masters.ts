/** Reproduce masters from the generated turnaround; one scale, translations only. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { alignFrame, guidesFromMaster, measureFigure, sliceSheet, CELL_PX } from '@vgtd/sprite';

const root = process.argv[2]!;
const reference = join(root, 'reference');
const sheet = decodePng(readFileSync(join(reference, 'turnaround.png')));
const frames = sliceSheet(sheet, { cols: 5, rows: 1, frames: 5 });
const first = measureFigure(frames[0]!.image)!;
const targetHeight = 208;
const calibration = {
  scale: targetHeight / first.height,
  targetHeight,
  referenceHeight: first.height,
  referenceFrames: 1,
};
const guides = guidesFromMaster({ ...first, top: 24, bottom: 232, height: targetHeight, pelvisX: CELL_PX / 2 });
const directions = ['E', 'SE', 'S', 'NE', 'N'];
const records = frames.map((frame, i) => {
  const aligned = alignFrame(frame.image, { calibration, guides });
  writeFileSync(join(reference, `${directions[i]}.master.png`), encodePng(aligned.image));
  return { direction: directions[i], ...aligned.record };
});
writeFileSync(
  join(reference, 'master-calibration.json'),
  JSON.stringify({ calibration, guides, records }, null, 2) + '\n',
);
console.log(JSON.stringify({ calibration, records }, null, 2));
