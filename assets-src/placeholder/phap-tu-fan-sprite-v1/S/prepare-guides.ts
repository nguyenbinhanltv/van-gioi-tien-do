/** Reproduce S project and measured generation guides before any sheet generation. */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  SPRITE_CLIPS,
  projectClipDefaults,
  measureFigure,
  guidesFromMaster,
  facingGroundVector,
  buildTemplate,
  locomotionCells,
  halfStrideFor,
  groundSpeedPxS,
} from '@vgtd/sprite';
const base = resolve('assets-src/placeholder/phap-tu-fan-sprite-v1/S');
mkdirSync(join(base, 'templates'), { recursive: true });
mkdirSync(join(base, 'sheets'), { recursive: true });
const master = decodePng(readFileSync(join(base, '../reference/S.master.png')));
const boxes = { R: { x0: 96, x1: 121, y0: 209, y1: 232 }, L: { x0: 134, x1: 158, y0: 209, y1: 232 } };
function sole(box: typeof boxes.R) {
  let bottom = -1;
  for (let y = box.y0; y <= box.y1; y++)
    for (let x = box.x0; x <= box.x1; x++)
      if (master.data[(y * master.width + x) * 4 + 3]! >= 128) bottom = Math.max(bottom, y);
  let sx = 0,
    sy = 0,
    n = 0;
  for (let y = bottom - 1; y <= bottom; y++)
    for (let x = box.x0; x <= box.x1; x++)
      if (master.data[(y * master.width + x) * 4 + 3]! >= 128) {
        sx += x;
        sy += y;
        n++;
      }
  if (!n) throw new Error('Empty boot ROI');
  return { x: sx / n, y: sy / n };
}
const R = sole(boxes.R),
  L = sole(boxes.L),
  axis = facingGroundVector('S');
const stanceWidth = Math.abs((L.x - R.x) * -axis.y + (L.y - R.y) * axis.x);
writeFileSync(
  join(base, 'gait-template-measurements.json'),
  JSON.stringify(
    {
      source: '../reference/S.master.png',
      method:
        'Alpha>=128 bottom two-row centroid in manually identified boot ROIs; projected perpendicular to public facingGroundVector',
      boxes,
      R,
      L,
      axis,
      stanceWidth,
      runStance: 1 / 3,
      walkStance: 0.5,
    },
    null,
    2,
  ) + '\n',
);
const guides = guidesFromMaster(measureFigure(master)!);
const clips = SPRITE_CLIPS.map((spec) => {
  const defaults = projectClipDefaults(spec.name);
  const gait = spec.name === 'run' || spec.name === 'walk' ? spec.name : null;
  const stance = gait === 'run' ? 1 / 3 : 0.5;
  const cells = gait
    ? locomotionCells(defaults.frames, guides, {
        direction: 'S',
        stanceWidth,
        halfStride: halfStrideFor(groundSpeedPxS(gait, 'S')!, defaults.durationSec, stance),
        lift: gait === 'run' ? 16 : 10,
        first: 'R',
        stance,
      })
    : undefined;
  const template = buildTemplate({
    clip: spec.name,
    frames: defaults.frames,
    cols: defaults.cols,
    guides,
    ...(cells ? { cells } : {}),
  });
  writeFileSync(join(base, 'templates', spec.name + '.template.png'), encodePng(template.image));
  writeFileSync(
    join(base, 'templates', spec.name + '.template.json'),
    JSON.stringify(template.manifest, null, 2) + '\n',
  );
  const exceptions =
    spec.name === 'meditate'
      ? Object.fromEntries(Array.from({ length: 8 }, (_, i) => [i, 'seated']))
      : spec.name === 'die'
        ? Object.fromEntries([4, 5, 6, 7].map((i) => [i, 'die-collapse']))
        : undefined;
  return {
    ...defaults,
    sheet: 'sheets/' + spec.name + '.generated.png',
    manifest: 'templates/' + spec.name + '.template.json',
    ...(gait ? { vertical: 'keep' } : {}),
    ...(exceptions ? { exceptions } : {}),
  };
});
writeFileSync(
  join(base, 'project.json'),
  JSON.stringify(
    {
      character: 'phap-tu',
      direction: 'S',
      stem: 'phaptu',
      master: '../reference/S.master.png',
      backlog: 'quality-backlog.json',
      slice: { spill: {} },
      preparation: { kind: 'square-cell-dpi-v1', calibration: '../calibration.json' },
      clips,
    },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(base, 'batch.json'),
  JSON.stringify({ character: 'phap-tu', projects: ['project.json'] }, null, 2) + '\n',
);
