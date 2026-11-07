/** Place landmarked master inputs with one anatomical scale; never fit an individual image. */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, crop, measureFigure, placeScaled, sliceSheet, toPremultiplied, toStraight } from '@vgtd/sprite';

interface Landmarks {
  crown: number;
  eyes: number | null;
  chin: number | null;
  sole: number;
  pelvisX: number;
  shoulders: readonly [number, number] | null;
}
interface Input {
  id: string;
  source: string;
  output: string;
  landmarks: Landmarks;
  panel?: { column: number; columns: number };
}
interface Config {
  status: string;
  targetHeight: number;
  ground: number;
  reference: string;
  inputs: Input[];
}
const root = process.argv[2]!;
const configPath = process.argv[3]!;
const config = JSON.parse(readFileSync(join(root, configPath), 'utf8').replace(/^\uFEFF/, '')) as Config;
const reference = config.inputs.find((input) => input.id === config.reference);
if (!reference) throw new Error('Missing reference');
const referenceHeight = reference.landmarks.sole - reference.landmarks.crown;
if (!(referenceHeight > 0)) throw new Error('Invalid anatomical reference height');
const scale = config.targetHeight / referenceHeight;
const records = config.inputs.map((input) => {
  const source = decodePng(readFileSync(join(root, input.source)));
  const panel = input.panel;
  const left = panel ? Math.round((source.width * panel.column) / panel.columns) : 0;
  const right = panel ? Math.round((source.width * (panel.column + 1)) / panel.columns) : source.width;
  const raw = panel ? toPremultiplied(crop(toStraight(source), left, 0, right - left, source.height)) : source;
  // These are borderless masters; preserve raw landmark coordinates rather than the sheet slicer's default inset.
  const keyed = sliceSheet(raw, { cols: 1, rows: 1, frames: 1 }, { inset: 0 })[0]!.image;
  const sourceBounds = measureFigure(keyed);
  if (!sourceBounds) throw new Error('Empty source');
  if (process.argv.includes('--inspect'))
    return { id: input.id, sourceBounds, panel: { left, right, height: raw.height } };
  const lm = input.landmarks;
  const image = placeScaled(toPremultiplied(keyed), scale, lm.pelvisX, lm.sole, CELL_PX / 2, config.ground, CELL_PX);
  writeFileSync(join(root, input.output), encodePng(image));
  const y = (source: number) => config.ground + (source - lm.sole) * scale;
  const h = lm.sole - lm.crown;
  return {
    id: input.id,
    source: input.source,
    output: input.output,
    rawDimensions: [raw.width, raw.height],
    sourceDimensions: [source.width, source.height],
    panel: { left, right, height: raw.height },
    scale,
    sourceLandmarks: lm,
    placedLandmarks: {
      crown: y(lm.crown),
      sole: y(lm.sole),
      eyes: lm.eyes === null ? null : y(lm.eyes),
      chin: lm.chin === null ? null : y(lm.chin),
      anatomicalHeight: h * scale,
      headFraction: lm.chin === null ? null : (lm.chin - lm.crown) / h,
      eyeFraction: lm.eyes === null ? null : (lm.eyes - lm.crown) / h,
      shoulderFraction: lm.shoulders === null ? null : (lm.shoulders[1] - lm.shoulders[0]) / h,
    },
    sourceBounds,
    placedBounds: measureFigure(image),
  };
});
if (!process.argv.includes('--inspect'))
  writeFileSync(
    join(root, configPath.replace('.json', '.placement.json')),
    JSON.stringify(
      {
        status: config.status,
        calibration: {
          scale,
          targetAnatomicalHeight: config.targetHeight,
          referenceHeight,
          reference: config.reference,
        },
        records,
        note: 'Artist-selected anatomical landmarks; alpha bounds are separate. One scale across all inputs; translations only. No production animation QA claimed.',
      },
      null,
      2,
    ) + '\n',
  );
console.log(JSON.stringify(records, null, 2));
