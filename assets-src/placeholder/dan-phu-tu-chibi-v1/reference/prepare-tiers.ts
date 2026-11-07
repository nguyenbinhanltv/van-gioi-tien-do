/** Front tier edits share one calibration; identity diagnostics never resize the regions. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { alignFrame, guidesFromMaster, measureFigure, sliceSheet, CELL_PX } from '@vgtd/sprite';

const root = process.argv[2]!;
const files = ['front.attempt2', 'tier2', 'tier3', 'tier4', 'tier5'];
const raws = files.map((name) => decodePng(readFileSync(join(root, 'raw', name + '.png'))));
const base = raws[0]!;
const keyed = raws.map((raw) => sliceSheet(raw, { cols: 1, rows: 1, frames: 1 })[0]!.image);
const reference = measureFigure(keyed[0]!)!;
const calibration = {
  scale: 208 / reference.height,
  targetHeight: 208,
  referenceHeight: reference.height,
  referenceFrames: 1,
};
const guides = guidesFromMaster({ ...reference, height: 208 }, CELL_PX, CELL_PX / 2);
// Regions are artist-selected normalized rectangles in the common raw canvas.
const regions = {
  face: [0.43, 0.22, 0.59, 0.35],
  whisk: [0.1, 0.28, 0.35, 0.59],
  rightHand: [0.32, 0.46, 0.38, 0.51],
} as const;
const records = raws.map((raw, index) => {
  if (raw.width !== base.width || raw.height !== base.height)
    throw new Error('Tier canvas changed; do not independently fit');
  const diagnostics = Object.entries(regions).map(([name, rect]) => {
    const bounds = [
      Math.round(rect[0] * base.width),
      Math.round(rect[1] * base.height),
      Math.round(rect[2] * base.width),
      Math.round(rect[3] * base.height),
    ];
    let error = 0;
    let count = 0;
    let changed = 0;
    for (let y = bounds[1]!; y < bounds[3]!; y++)
      for (let x = bounds[0]!; x < bounds[2]!; x++) {
        const offset = (y * base.width + x) * 4;
        let pixelError = 0;
        for (let c = 0; c < 3; c++) pixelError += Math.abs(raw.data[offset + c]! - base.data[offset + c]!);
        error += pixelError;
        count += 3;
        if (pixelError > 30) changed++;
      }
    return { name, bounds, meanAbsoluteRgbError: error / count, changedPixelFractionOver30Sum: changed / (count / 3) };
  });
  const aligned = alignFrame(keyed[index]!, { calibration, guides });
  const output = 'T' + (index + 1) + '.front.png';
  writeFileSync(join(root, output), encodePng(aligned.image));
  return {
    tier: index + 1,
    raw: 'raw/' + files[index] + '.png',
    output,
    dimensions: [raw.width, raw.height],
    source: measureFigure(keyed[index]!),
    alignment: aligned.record,
    diagnostics,
  };
});
writeFileSync(
  join(root, 'tier-calibration.json'),
  JSON.stringify(
    {
      calibration,
      guides,
      records,
      note: 'Diagnostics only; no production pose-lock gate is claimed. All raw coordinates unchanged.',
    },
    null,
    2,
  ) + '\n',
);
const provenance = JSON.parse(readFileSync(join(root, 'provenance.json'), 'utf8').replace(/^\uFEFF/, ''));
for (const generation of provenance.generations) {
  const bytes = readFileSync(join(root, generation.raw));
  generation.sha256 = createHash('sha256').update(bytes).digest('hex');
}
writeFileSync(join(root, 'provenance.json'), JSON.stringify(provenance, null, 2) + '\n');
console.log(
  JSON.stringify(
    records.map(({ tier, source, diagnostics }) => ({ tier, height: source!.height, diagnostics })),
    null,
    2,
  ),
);
