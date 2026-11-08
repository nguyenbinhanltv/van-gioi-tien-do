/** Direction-specific D46 guides; source head stencils guide generation, never waive measured QA. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blit, decodePng, encodePng } from '@vgtd/rig';
import {
  buildGroupedTemplate,
  buildTemplate,
  CELL_PX,
  crop,
  facingGroundVector,
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
const master = decodePng(readFileSync(resolve(root, 'reference/NE.master.png')));
const guides = guidesFromMaster(measureFigure(master)!);
const axis = facingGroundVector('NE');
const soles = [
  { x: 118, y: 232 },
  { x: 151, y: 229 },
];
const stanceWidth = Math.abs((soles[0]!.x - soles[1]!.x) * -axis.y + (soles[0]!.y - soles[1]!.y) * axis.x);
for (const dir of ['templates', 'raw', 'sheets']) mkdirSync(resolve(root, 'NE', dir), { recursive: true });
const head = crop(master, 108, 15, 61, 60);
const clips = SMOOTH_SPRITE_CLIPS.map((clip) => {
  const gait = clip.name === 'walk' || clip.name === 'run' ? clip.name : null;
  const stance = gait === 'run' ? 0.33 : 0.5;
  const cells = gait
    ? locomotionCells(clip.sheet.frames, guides, {
        direction: 'NE',
        stanceWidth,
        halfStride: halfStrideFor(groundSpeedPxS(gait, 'NE')!, clip.durationSec, stance),
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
  const base = resolve(root, 'NE/templates', clip.name);
  if (!existsSync(base + '.template.png')) writeFileSync(base + '.template.png', encodePng(template.image));
  if (!existsSync(base + '.template.json'))
    writeFileSync(base + '.template.json', JSON.stringify(template.manifest, null, 2) + '\n');
  for (let i = 0; i < clip.sheet.frames; i++) {
    const y = clip.name === 'meditate' ? 110 : clip.name === 'die' ? 15 + Math.round(Math.max(0, i - 3) * 15) : 15;
    blit(template.image, head, (i % clip.sheet.cols) * CELL_PX + 108, Math.floor(i / clip.sheet.cols) * CELL_PX + y);
  }
  writeFileSync(base + '.head-guide.png', encodePng(template.image));
  return {
    ...smoothProjectClipDefaults(clip.name),
    sheet: 'sheets/' + clip.name + '.png',
    manifest: 'templates/' + clip.name + '.template.json',
    poseTags: smoothPoseTags(clip.name),
    ...(gait ? { vertical: 'keep' } : {}),
  };
});
writeFileSync(
  resolve(root, 'NE/generation-plan.json'),
  JSON.stringify(
    {
      direction: 'NE',
      profile: 'smooth-v2',
      master: '../reference/NE.master.png',
      stencil: {
        crop: { x: 108, y: 15, width: 61, height: 60 },
        scale: 1,
        note: 'Unscaled canonical source pixels; guide only, output measurements required.',
      },
      stanceWidth,
      soles,
      clips,
    },
    null,
    2,
  ) + '\n',
);
const group = buildGroupedTemplate({
  clips: [
    { name: 'hit', frames: 6 },
    { name: 'dash', frames: 10 },
  ],
  guides,
  cols: 4,
});
writeFileSync(resolve(root, 'NE/templates/hit-dash.template.png'), encodePng(group.image));
writeFileSync(resolve(root, 'NE/templates/hit-dash.template.json'), JSON.stringify(group.manifest, null, 2) + '\n');
writeFileSync(resolve(root, 'NE/templates/hit-dash.clips.json'), JSON.stringify(group.clips, null, 2) + '\n');
for (let i = 0; i < 16; i++) blit(group.image, head, (i % 4) * CELL_PX + 109, Math.floor(i / 4) * CELL_PX + 15);
writeFileSync(resolve(root, 'NE/templates/hit-dash.head-guide.png'), encodePng(group.image));
