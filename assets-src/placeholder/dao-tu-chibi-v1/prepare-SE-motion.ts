/** Generate SE smooth-v2 guides using public tooling and the locked anatomical master. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { blit, decodePng, encodePng } from '@vgtd/rig';
import {
  buildGroupedTemplate,
  buildTemplate,
  facingGroundVector,
  CELL_PX,
  crop,
  groundSpeedPxS,
  guidesFromMaster,
  halfStrideFor,
  locomotionCells,
  measureFigure,
  SMOOTH_SPRITE_CLIPS,
  smoothPoseTags,
  smoothProjectClipDefaults,
  toPremultiplied,
  toStraight,
  type CellSpec,
} from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/dao-tu-chibi-v1');
const calibration = JSON.parse(readFileSync(resolve(root, 'character-calibration.json'), 'utf8'));
const masterPath = resolve(root, 'reference/SE.master.png');
const masterBytes = readFileSync(masterPath);
const master = decodePng(masterBytes);
const measured = measureFigure(master)!;
const guides = guidesFromMaster({ ...measured, height: calibration.targetHeight }, CELL_PX, CELL_PX / 2);
const out = resolve(root, 'SE/templates');
mkdirSync(out, { recursive: true });
mkdirSync(resolve(root, 'SE/raw'), { recursive: true });
const headRect = { x: 103, y: 8, width: 49, height: 59 };
const sourceSoles = { near: { x: 104, y: 232 }, far: { x: 154, y: 222 } };
const groundAxis = facingGroundVector('SE');
const stanceWidth = Math.abs(
  (sourceSoles.far.x - sourceSoles.near.x) * -groundAxis.y + (sourceSoles.far.y - sourceSoles.near.y) * groundAxis.x,
);
const head = toPremultiplied(crop(toStraight(master), headRect.x, headRect.y, headRect.width, headRect.height));
const sha = (bytes: Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const records = [];
function save(name: string, template: ReturnType<typeof buildTemplate>, used: number) {
  const bytes = encodePng(template.image);
  writeFileSync(resolve(out, name + '.template.png'), bytes);
  writeFileSync(resolve(out, name + '.template.json'), JSON.stringify(template.manifest, null, 2) + '\n');
  const stencil = decodePng(bytes);
  const headGuideOffsetY = name === 'meditate' ? Math.round(calibration.targetHeight / 3) : 0;
  for (let i = 0; i < used; i++)
    blit(stencil, head, (i % 4) * CELL_PX + headRect.x, Math.floor(i / 4) * CELL_PX + headRect.y + headGuideOffsetY);
  const stencilBytes = encodePng(stencil);
  writeFileSync(resolve(out, name + '.head-stencil.template.png'), stencilBytes);
  records.push({
    clip: name,
    masterSha256: sha(masterBytes),
    templateSha256: sha(bytes),
    headStencilSha256: sha(stencilBytes),
    headRect,
    headGuideOffsetY,
    guides: template.manifest.guides,
    used,
    note: 'Exact unscaled master head crop/blit, a size/identity guide only. Dynamic poses may translate/rotate the head; actual output landmarks remain mandatory.',
  });
}
const clips = [];
for (const spec of SMOOTH_SPRITE_CLIPS) {
  if (spec.name === 'hit' || spec.name === 'dash') continue;
  let cells: CellSpec[] = smoothPoseTags(spec.name).map((tag) => ({ leading: null, tag }));
  // The projected foot plane is the measured sole midpoint, not the lowest sole.
  // Keep the common lattice registration root and head/pelvis guides unchanged.
  const clipGuides =
    spec.name === 'walk' || spec.name === 'run'
      ? { ...guides, ground: (sourceSoles.near.y + sourceSoles.far.y) / 2 }
      : spec.name === 'meditate'
        ? {
            ...guides,
            head: guides.head + Math.round(calibration.targetHeight / 3),
            pelvis: guides.pelvis + Math.round(calibration.targetHeight / 3),
          }
        : guides;
  if (spec.name === 'walk' || spec.name === 'run') {
    const speed = groundSpeedPxS(spec.name, 'SE')!;
    const stance = spec.name === 'run' ? 0.33 : 0.5;
    cells = locomotionCells(spec.sheet.frames, clipGuides, {
      direction: 'SE',
      stanceWidth,
      halfStride: halfStrideFor(speed, spec.durationSec, stance),
      stance,
      lift: spec.name === 'run' ? 16 : 10,
      first: 'R',
    });
  }
  const used = spec.sheet.frames;
  while (cells.length < 16) cells.push({ leading: null, tag: 'unused' });
  save(spec.name, buildTemplate({ clip: spec.name, frames: 16, cols: 4, guides: clipGuides, cells }), used);
  clips.push({
    ...smoothProjectClipDefaults(spec.name),
    sheet: 'raw/' + spec.name + '.png',
    manifest: 'templates/' + spec.name + '.template.json',
    sheetSelection: { rows: 4, cells: Array.from({ length: used }, (_, i) => i) },
  });
}
const group = buildGroupedTemplate({
  cols: 4,
  guides,
  clips: ['hit', 'dash'].map((name) => {
    const spec = SMOOTH_SPRITE_CLIPS.find((c) => c.name === name)!;
    return { name, frames: spec.sheet.frames, cells: smoothPoseTags(name).map((tag) => ({ leading: null, tag })) };
  }),
});
save('hit-dash', group, 16);
for (const entry of group.clips)
  clips.push({
    ...smoothProjectClipDefaults(entry.name),
    ...entry,
    sheet: 'raw/hit-dash.png',
    manifest: 'templates/hit-dash.template.json',
  });
writeFileSync(resolve(root, 'SE/clip-defaults.json'), JSON.stringify(clips, null, 2) + '\n');
writeFileSync(
  resolve(out, 'head-stencils.provenance.json'),
  JSON.stringify(
    {
      operation:
        'Public buildTemplate/buildGroupedTemplate/locomotionCells; exact master head crop/blit with @vgtd/rig.blit',
      anatomicalGuides: guides,
      sourceCalibration: '../character-calibration.json',
      records,
    },
    null,
    2,
  ) + '\n',
);
if (!existsSync(resolve(root, 'motion-calibration.json')))
  writeFileSync(
    resolve(root, 'motion-calibration.json'),
    JSON.stringify(
      {
        character: 'dao-tu-chibi-v1',
        scale: 1,
        note: 'Locked normalized-grid scale after whole-sheet square-cell DPI preparation. No individual frame fitting.',
      },
      null,
      2,
    ) + '\n',
  );
console.log(
  JSON.stringify({
    guides,
    sheets: records.length,
    clips: clips.length,
    frames: clips.reduce((n, c) => n + c.frames, 0),
  }),
);
