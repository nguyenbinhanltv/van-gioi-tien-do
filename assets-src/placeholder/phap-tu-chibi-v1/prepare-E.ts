/** Build generation inputs from the public D46 profile and locked Pháp tu master. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  buildTemplate,
  CELL_PX,
  groundSpeedPxS,
  guidesFromMaster,
  halfStrideFor,
  locomotionCells,
  measureFigure,
  SMOOTH_SPRITE_CLIPS,
  smoothPoseTags,
  smoothProjectClipDefaults,
} from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const generationMaster = existsSync(resolve(root, 'reference/E.master.generation-v1.png'))
  ? 'reference/E.master.generation-v1.png'
  : 'reference/E.master.png';
const master = decodePng(readFileSync(resolve(root, generationMaster)));
const metrics = measureFigure(master);
if (!metrics) throw new Error('Empty E master');
const guides = guidesFromMaster(metrics, CELL_PX);
for (const folder of ['E/templates', 'E/sheets', 'E/raw']) mkdirSync(resolve(root, folder), { recursive: true });
const plans = SMOOTH_SPRITE_CLIPS.map((clip) => {
  const gait = clip.name === 'walk' || clip.name === 'run' ? clip.name : null;
  const stance = gait === 'run' ? 0.33 : 0.5;
  const cells = gait
    ? locomotionCells(clip.sheet.frames, guides, {
        direction: 'E',
        halfStride: halfStrideFor(groundSpeedPxS(gait, 'E')!, clip.durationSec, stance),
        lift: gait === 'run' ? 16 : 10,
        first: 'R',
        stance,
      })
    : undefined;
  const template = buildTemplate({
    clip: clip.name,
    frames: clip.sheet.frames,
    cols: clip.sheet.cols,
    guides,
    ...(cells ? { cells } : {}),
  });
  writeFileSync(resolve(root, `E/templates/${clip.name}.template.png`), encodePng(template.image));
  writeFileSync(
    resolve(root, `E/templates/${clip.name}.template.json`),
    JSON.stringify(template.manifest, null, 2) + '\n',
  );
  return {
    ...smoothProjectClipDefaults(clip.name),
    sheet: `sheets/${clip.name}.png`,
    manifest: `templates/${clip.name}.template.json`,
    poseTags: smoothPoseTags(clip.name),
    exceptionHints: clip.exceptionHints,
  };
});
writeFileSync(
  resolve(root, 'E/generation-plan.json'),
  JSON.stringify({ profile: 'smooth-v2', direction: 'E', guides, clips: plans }, null, 2) + '\n',
);
if (!existsSync(resolve(root, 'character-calibration.json')))
  writeFileSync(
    resolve(root, 'character-calibration.json'),
    JSON.stringify(
      {
        character: 'phap-tu-chibi-v1',
        scale: 1,
        anatomicalHeight2x: 216,
        note: 'Whole-sheet declared DPI normalization to logical cells; no per-frame rescale. Character calibration locked to template master scale.',
      },
      null,
      2,
    ) + '\n',
  );
console.log(
  JSON.stringify(
    { profile: 'smooth-v2', clips: plans.length, frames: plans.reduce((sum, c) => sum + c.frames, 0), guides },
    null,
    2,
  ),
);
