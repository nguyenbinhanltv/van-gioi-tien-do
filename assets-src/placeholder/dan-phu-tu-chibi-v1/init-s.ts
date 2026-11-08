/** S authoring inputs only. Generated output poses/landmarks are never copied or inferred from these guides. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { decodePng, encodePng, type Image } from '@vgtd/rig';
import {
  SMOOTH_SPRITE_CLIPS,
  smoothProjectClipDefaults,
  smoothPoseTags,
  guidesFromMaster,
  measureFigure,
  buildTemplate,
  buildGroupedTemplate,
  locomotionCells,
  groundSpeedPxS,
  halfStrideFor,
  type ProjectClip,
} from '@vgtd/sprite';

const root = resolve(process.argv[2]!);
const out = join(root, 'S');
if (existsSync(join(out, 'project.json')))
  throw new Error('S is already initialized; do not overwrite authored inputs');
for (const dir of ['templates', 'raw', 'provenance']) mkdirSync(join(out, dir), { recursive: true });
const master = decodePng(readFileSync(join(root, 'reference/S.corrected-master.png')));
const metrics = measureFigure(master);
if (!metrics) throw new Error('Empty S master');
const guides = guidesFromMaster(metrics);
function stamp(name: string, image: Image, frames: number, headOnly: boolean, offsets: readonly number[] = []) {
  const result = { ...image, data: new Uint8ClampedArray(image.data) };
  for (let i = 0; i < frames; i++) {
    const ox = (i % 4) * master.width;
    const oy = Math.floor(i / 4) * master.height + (offsets[i] ?? 0);
    for (let y = headOnly ? 2 : 0; y < (headOnly ? 68 : master.height); y++)
      for (let x = headOnly ? 100 : 0; x < (headOnly ? 156 : master.width); x++) {
        const source = (y * master.width + x) * 4;
        const alpha = master.data[source + 3]! / 255;
        const target = ((oy + y) * result.width + ox + x) * 4;
        for (let k = 0; k < 3; k++)
          result.data[target + k] = Math.round(master.data[source + k]! + result.data[target + k]! * (1 - alpha));
        result.data[target + 3] = 255;
      }
  }
  writeFileSync(join(out, 'templates', name + (headOnly ? '.head-guide.png' : '.master-guide.png')), encodePng(result));
}
function headOffsets(name: string, n: number): number[] {
  if (name === 'run') return [4, 7, 10, 7, 4, 2, 4, 7, 4, 7, 10, 7, 4, 2, 4, 7];
  if (name === 'meditate') return Array(n).fill(62);
  if (name === 'tribulation') return [0, 3, 8, 16, 25, 36, 45, 48, 48, 44, 36, 25, 16, 8, 3, 0];
  if (name === 'die') return [0, 3, 12, 27, 46, 69, 92, 116, 130, 133, 133, 133];
  if (name.startsWith('attack'))
    return smoothPoseTags(name).map((p) =>
      p === 'anticipation' ? 2 : p === 'strike' ? 7 : p.startsWith('impact') ? 12 : 5,
    );
  return Array(n).fill(0);
}
const clips: ProjectClip[] = SMOOTH_SPRITE_CLIPS.map((clip) => {
  const cells = ['walk', 'run'].includes(clip.name)
    ? locomotionCells(clip.sheet.frames, guides, {
        direction: 'S',
        halfStride: halfStrideFor(
          groundSpeedPxS(clip.tableId, 'S')!,
          clip.durationSec,
          clip.name === 'run' ? 0.35 : 0.5,
        ),
        stance: clip.name === 'run' ? 0.35 : 0.5,
        lift: clip.name === 'run' ? 16 : 10,
      })
    : smoothPoseTags(clip.name).map((tag) => ({ leading: null, tag }));
  const t = buildTemplate({ clip: clip.name, frames: clip.sheet.frames, cols: 4, guides, cells });
  writeFileSync(join(out, 'templates', clip.name + '.template.png'), encodePng(t.image));
  writeFileSync(join(out, 'templates', clip.name + '.template.json'), JSON.stringify(t.manifest, null, 2) + '\n');
  stamp(clip.name, t.image, clip.sheet.frames, false);
  stamp(clip.name, t.image, clip.sheet.frames, true, headOffsets(clip.name, clip.sheet.frames));
  return {
    ...smoothProjectClipDefaults(clip.name),
    ...(['walk', 'run', 'dash', 'sword_fly'].includes(clip.name) ? { vertical: 'keep' as const } : {}),
    sheet: 'raw/' + clip.name + '.attempt1.png',
    manifest: 'templates/' + clip.name + '.template.json',
  };
});
const group = buildGroupedTemplate({
  clips: [
    { name: 'hit', frames: 6 },
    { name: 'dash', frames: 10 },
  ],
  guides,
});
writeFileSync(join(out, 'templates/hit-dash.template.png'), encodePng(group.image));
writeFileSync(join(out, 'templates/hit-dash.template.json'), JSON.stringify(group.manifest, null, 2) + '\n');
writeFileSync(join(out, 'templates/hit-dash.clips.json'), JSON.stringify(group.clips, null, 2) + '\n');
stamp('hit-dash', group.image, 16, false);
stamp('hit-dash', group.image, 16, true, [0, 4, 8, 6, 2, 0, 0, 8, 20, 33, 45, 38, 25, 14, 5, 0]);
for (const mapping of group.clips)
  Object.assign(
    clips.find((c) => c.name === mapping.name)!,
    mapping,
    { sheet: 'raw/hit-dash.attempt1.png', manifest: 'templates/hit-dash.template.json' },
  );
const prior = JSON.parse(readFileSync(join(root, 'SE/project.json'), 'utf8'));
const project = {
  character: 'dan-phu-tu-chibi-v1',
  direction: 'S',
  stem: 'danphuchibi',
  timingProfile: 'smooth-v2',
  master: '../reference/S.corrected-master.png',
  backlog: 'quality-backlog.json',
  preparation: prior.preparation,
  resample: 'lanczos3',
  slice: { ...prior.slice, inset: 0.005 },
  clips,
};
writeFileSync(join(out, 'project.json'), JSON.stringify(project, null, 2) + '\n');
writeFileSync(
  join(out, 'quality-backlog.json'),
  JSON.stringify(
    { format: 'vgtd-quality-backlog', version: 1, character: project.character, entries: [], manual: [] },
    null,
    2,
  ) + '\n',
);
writeFileSync(
  join(out, 'templates/authoring-contract.json'),
  JSON.stringify(
    {
      master: project.master,
      masterMetrics: metrics,
      guides,
      scale: 1,
      note: 'INPUT-ONLY unscaled master/head stencils; not output frames or head evidence. Every output pose is an AI drawing/edit. No per-frame fitting or cloned animation frames.',
      clips: clips.map(({ name, frames, durationSec, loop, kind }) => ({ name, frames, durationSec, loop, kind })),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  JSON.stringify({
    master: metrics,
    guides,
    clips: clips.length,
    drawings: clips.reduce((s, c) => s + c.frames, 0),
    direction: 'S',
  }),
);
