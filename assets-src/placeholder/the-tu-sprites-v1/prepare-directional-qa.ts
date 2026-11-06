import console from 'node:console';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  buildTemplate,
  facingGroundVector,
  groundSpeedPxS,
  guidesFromMaster,
  halfStrideFor,
  locomotionCells,
  measureFigure,
  nearestSole2D,
  resizeImage,
  soleRuns,
  type Project,
} from '@vgtd/sprite';

const direction = process.argv[2];
if (!['SE', 'S', 'NE', 'N'].includes(direction ?? '')) throw new Error('Expected SE, S, NE or N');
const base = join(dirname(process.argv[1]!), direction!);
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')) as Project;
if (project.direction !== direction) throw new Error('Project direction differs from the requested direction');
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const jsonHash = (file: string) =>
  createHash('sha256')
    .update(JSON.stringify(JSON.parse(readFileSync(file, 'utf8'))))
    .digest('hex');
const master = resizeImage(decodePng(readFileSync(join(base, project.master))), CELL_PX, CELL_PX);
const metrics = measureFigure(master);
if (!metrics) throw new Error('Master is empty');
const guides = guidesFromMaster(metrics);
const axis = facingGroundVector(project.direction);
const bandRows = 20;
const runs = soleRuns(master, metrics.bottom, 0, master.width - 1, bandRows);
if (runs.length !== 2) throw new Error(`Expected two separate master boots, found ${runs.length}`);
const soles = runs.map((run) => nearestSole2D(master, { x: run.x, y: metrics.bottom }, bandRows));
if (!soles[0] || !soles[1]) throw new Error('Could not measure both master sole bottoms');
const stanceWidth =
  Math.round(Math.abs((soles[1].x - soles[0].x) * -axis.y + (soles[1].y - soles[0].y) * axis.x) * 100) / 100;
interface GenerationInput {
  readonly path: string;
  readonly sha256: string;
  readonly activeManifest?: string;
  readonly semanticSha256?: string;
}
const originalGenerationTemplates: GenerationInput[] = project.clips
  .filter((clip) => ['walk', 'run'].includes(clip.name))
  .flatMap((clip) =>
    ['json', 'png'].map((ext) => {
      const file = `templates/${clip.name}.template.${ext}`;
      if (ext === 'png') return { path: file, sha256: hash(join(base, file)) };
      const archive = `raw/generation-guides/${clip.name}.template.json.txt`;
      mkdirSync(join(base, 'raw/generation-guides'), { recursive: true });
      if (!existsSync(join(base, archive))) writeFileSync(join(base, archive), readFileSync(join(base, file)));
      const semanticSha256 = jsonHash(join(base, file));
      if (semanticSha256 !== jsonHash(join(base, archive))) throw new Error('Original manifest values changed');
      return { path: archive, sha256: hash(join(base, archive)), activeManifest: file, semanticSha256 };
    }),
  );
const selectedSheets = project.clips.map((clip) => ({ path: clip.sheet, sha256: hash(join(base, clip.sheet)) }));
const record = {
  format: 'vgtd-the-tu-directional-qa',
  version: 2,
  direction,
  method:
    'Master-only sole measurement; full transverse stance is the sole separation projected onto the perpendicular of the public facing vector. No frame fitting.',
  master: { path: project.master, sha256: hash(join(base, project.master)), bandRows, soles, axis, stanceWidth },
  originalGenerationTemplates,
  selectedSheets,
  alignment: 'walk/run vertical:keep; preserve each source cell ground reference',
  dpi: 'Existing fixed per-sheet referenceHeight values retain the frozen character-wide normalized reference. No square-cell normalization of non-square hit inputs.',
};
const recordPath = join(base, 'qa-migration.json');
if (existsSync(recordPath)) {
  const previous = JSON.parse(readFileSync(recordPath, 'utf8')) as typeof record;
  if (previous.master.sha256 !== record.master.sha256 || previous.master.stanceWidth !== stanceWidth)
    throw new Error('Master stance changed; review the migration instead of silently recalibrating');
  for (const file of previous.originalGenerationTemplates) {
    const archived = originalGenerationTemplates.find(
      (entry) => entry.activeManifest === file.path && entry.sha256 === file.sha256,
    );
    if (hash(join(base, file.path)) !== file.sha256 && !archived)
      throw new Error('Original generation template changed');
    if (file.activeManifest && jsonHash(join(base, file.activeManifest)) !== file.semanticSha256)
      throw new Error('Original manifest values changed');
  }
}
mkdirSync(join(base, 'qa-templates'), { recursive: true });
const clips = project.clips.map((clip) => {
  if (!['walk', 'run'].includes(clip.name)) return clip;
  const speed = groundSpeedPxS(clip.tableId, project.direction);
  if (speed === null) throw new Error('Locomotion clip needs a table ground speed');
  if (clip.footSlideUnmeasuredReason)
    throw new Error('Remove the explicit opt-out only after reviewing this migration');
  const cells = locomotionCells(clip.frames, guides, {
    direction: project.direction,
    stanceWidth,
    halfStride: halfStrideFor(speed, clip.durationSec),
    lift: clip.name === 'run' ? 16 : 10,
    first: 'R',
  });
  const template = buildTemplate({ clip: clip.name, frames: clip.frames, cols: clip.cols, guides, cells });
  const stem = `qa-templates/${clip.name}.template`;
  writeFileSync(join(base, `${stem}.png`), encodePng(template.image));
  writeFileSync(join(base, `${stem}.json`), JSON.stringify(template.manifest, null, 2) + '\n', 'utf8');
  return { ...clip, manifest: `${stem}.json`, vertical: 'keep' as const };
});
for (const file of [...originalGenerationTemplates, ...selectedSheets])
  if (hash(join(base, file.path)) !== file.sha256) throw new Error('Generation input or selected art changed');
writeFileSync(join(base, 'project.json'), JSON.stringify({ ...project, clips }, null, 2) + '\n', 'utf8');
writeFileSync(recordPath, JSON.stringify(record, null, 2) + '\n', 'utf8');
console.log(`${direction}: stance ${stanceWidth}px; original templates/art unchanged; directional QA guides written`);
