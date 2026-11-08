/** Authoring inputs use the public smooth-v2 CLI/defaults; no private copy of clip counts or timing. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  assertDirection,
  buildGroupedTemplate,
  guidesFromMaster,
  measureFigure,
  SMOOTH_SPRITE_CLIPS,
  smoothPoseTags,
  smoothProjectClipDefaults,
  smoothSpriteClip,
} from '@vgtd/sprite';

const root = process.argv[2];
if (!root) throw new Error('usage: prepare-templates.ts <asset-root> [direction]');
const direction = assertDirection(process.argv[3] ?? 'E');
const masterPath = join(root, 'reference', `${direction}.master.png`);
const templates = join(root, direction, 'templates');
mkdirSync(templates, { recursive: true });
for (const clip of SMOOTH_SPRITE_CLIPS) {
  if (clip.name === 'hit' || clip.name === 'dash') continue;
  const args = [
    'tools/rig/scripts/run-ts.mjs',
    'tools/sprite/scripts/template.ts',
    '--profile',
    'smooth-v2',
    '--clip',
    clip.name,
    '--master',
    masterPath,
    '--direction',
    direction,
    '--out',
    templates,
    ...(clip.name === 'run' ? ['--stance', '0.33'] : []),
  ];
  execFileSync(process.execPath, args, { cwd: process.cwd(), stdio: 'pipe' });
}
const masterBytes = readFileSync(masterPath);
const master = decodePng(masterBytes);
const measured = measureFigure(master);
if (!measured) throw new Error('empty locked master');
const grouped = buildGroupedTemplate({
  clips: ['hit', 'dash'].map((name) => ({
    name,
    frames: smoothSpriteClip(name).sheet.frames,
    cells: smoothPoseTags(name).map((tag) => ({ leading: null, tag })),
  })),
  guides: guidesFromMaster(measured),
});
writeFileSync(join(templates, 'hit-dash.template.png'), encodePng(grouped.image));
writeFileSync(join(templates, 'hit-dash.template.json'), JSON.stringify(grouped.manifest, null, 2) + '\n');
writeFileSync(join(templates, 'hit-dash.clips.json'), JSON.stringify(grouped.clips, null, 2) + '\n');
const clips = SMOOTH_SPRITE_CLIPS.map((clip) => {
  const selection = grouped.clips.find((mapping) => mapping.name === clip.name);
  const stem = selection ? 'hit-dash' : clip.name;
  return {
    ...smoothProjectClipDefaults(clip.name),
    ...(selection ?? {}),
    sheet: `sheets/${stem}.raw.png`,
    manifest: `templates/${stem}.template.json`,
    poseTags: smoothPoseTags(clip.name),
    status: 'source drawing pending; no QA or layered runtime claim',
  };
});
writeFileSync(
  join(root, direction, 'motion-inventory.json'),
  JSON.stringify(
    {
      profile: 'smooth-v2',
      direction,
      master: resolve(masterPath),
      masterSha256: createHash('sha256').update(masterBytes).digest('hex'),
      sourceSheetsRequired: SMOOTH_SPRITE_CLIPS.length - grouped.clips.length + 1,
      frameTotal: clips.reduce((sum, clip) => sum + clip.frames, 0),
      clips,
    },
    null,
    2,
  ) + '\n',
);
console.log(`${direction}: prepared ${clips.length} smooth-v2 clips; hit+dash share one 4x4 sheet`);
