/** Reproduce keyed masters with one anatomical calibration; never fit each direction to its own height. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pivotOf } from '@vgtd/character';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, measureFigure, placeScaled, resizeImage, sliceSheet, toPremultiplied } from '@vgtd/sprite';

interface SourceView {
  source: string;
  sourceSize: [number, number];
  landmarks: {
    crown: [number, number];
    eyeLineY?: number;
    chin?: [number, number];
    shoulderLeft?: [number, number];
    shoulderRight?: [number, number];
    pelvis: [number, number];
    soleY: number;
  };
  targetAnatomicalHeight2x: number;
}

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-masters.ts <asset-root>');
const reference = join(root, 'reference');
const specification = JSON.parse(readFileSync(join(reference, 'master-source.json'), 'utf8')) as {
  directions: Record<string, SourceView>;
};
const canonical = specification.directions.S!;
const referenceHeight =
  ((canonical.landmarks.soleY - canonical.landmarks.crown[1]) * CELL_PX) / canonical.sourceSize[1];
const scale = canonical.targetAnatomicalHeight2x / referenceHeight;
const pivot = pivotOf(CELL_PX / 2, CELL_PX / 2);
const ground = pivot.y * 2;
const preview = createImage(CELL_PX * Object.keys(specification.directions).length, CELL_PX);
let previewIndex = 0;
const records = Object.entries(specification.directions).map(([direction, view]) => {
  const bytes = readFileSync(join(reference, view.source));
  const raw = decodePng(bytes);
  if (raw.width !== view.sourceSize[0] || raw.height !== view.sourceSize[1] || raw.width !== raw.height)
    throw new Error(`${direction}: source size changed or non-square DPI`);
  const [frame] = sliceSheet(raw, { cols: 1, rows: 1, frames: 1 }, { inset: 0, key: 'auto', spill: {} });
  if (!frame) throw new Error(`${direction}: missing source`);
  const native = toPremultiplied(frame.image);
  const normalized = resizeImage(native, CELL_PX, CELL_PX);
  const dpi = CELL_PX / raw.height;
  const sourceAxis = view.landmarks.pelvis[0] * dpi;
  const sourceGround = view.landmarks.soleY * dpi;
  const image = placeScaled(normalized, scale, sourceAxis, sourceGround, CELL_PX / 2, ground, CELL_PX);
  const output = encodePng(image);
  const nativeOutput = encodePng(native);
  writeFileSync(join(reference, `${direction}.master-native.png`), nativeOutput);
  writeFileSync(join(reference, `${direction}.master.png`), output);
  for (let y = 0; y < CELL_PX; y++)
    preview.data.set(
      image.data.subarray(y * CELL_PX * 4, (y + 1) * CELL_PX * 4),
      (y * preview.width + previewIndex * CELL_PX) * 4,
    );
  previewIndex++;
  const h = view.landmarks.soleY - view.landmarks.crown[1];
  const head = view.landmarks.chin ? (view.landmarks.chin[1] - view.landmarks.crown[1]) / h : null;
  const eye = view.landmarks.eyeLineY ? (view.landmarks.eyeLineY - view.landmarks.crown[1]) / h : null;
  const shoulder =
    view.landmarks.shoulderLeft && view.landmarks.shoulderRight
      ? (view.landmarks.shoulderRight[0] - view.landmarks.shoulderLeft[0]) / h
      : null;
  return {
    direction,
    rawSha256: createHash('sha256').update(bytes).digest('hex'),
    keyedNativeSha256: createHash('sha256').update(nativeOutput).digest('hex'),
    outputSha256: createHash('sha256').update(output).digest('hex'),
    rawDimensions: [raw.width, raw.height],
    dpiScale: dpi,
    characterScale: scale,
    rawAnatomicalHeight: h,
    anatomicalHeight: h * dpi * scale,
    anatomicalCrownY: ground - h * dpi * scale,
    headFraction: head,
    eyeLineFraction: eye,
    frontalShoulderFraction: shoulder,
    measurementMethod: 'Manual native anatomical landmarks; fractions calculated, not auto-detected.',
    alphaBoundsNative: measureFigure(native),
    alphaBoundsNormalized: measureFigure(image),
    removedFragments: frame.removedFragments,
    operation:
      'Public sprite key/defringe/despill/fragment cleanup; square whole-image DPI prep; one S-derived character scale; direction translations only.',
  };
});
writeFileSync(
  join(reference, 'master-calibration.json'),
  JSON.stringify({ version: 1, referenceDirection: 'S', scale, referenceHeight, ground, records }, null, 2) + '\n',
);
console.log(JSON.stringify({ scale, ground, records }, null, 2));
writeFileSync(join(reference, 'turnaround.preview.png'), encodePng(preview));
