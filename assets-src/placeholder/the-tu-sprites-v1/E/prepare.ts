import console from 'node:console';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import process from 'node:process';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  buildTemplate,
  guidesFromMaster,
  groundSpeedPxS,
  halfStrideFor,
  locomotionCells,
  measureFigure,
  resizeImage,
  CELL_PX,
  SPRITE_CLIPS,
  projectClipDefaults,
  type Project,
  type ProjectClip,
} from '@vgtd/sprite';

const base = dirname(process.argv[1]!);
const master = '../../the-tu-continuous-v1/reference/E.master4x.png';
const image = resizeImage(decodePng(readFileSync(join(base, master))), CELL_PX, CELL_PX);
const metrics = measureFigure(image)!;
const guides = guidesFromMaster(metrics);
const prior = existsSync(join(base, 'project.json'))
  ? (JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')) as Project)
  : undefined;
const clips: ProjectClip[] = [];
mkdirSync(join(base, 'templates'), { recursive: true });
mkdirSync(join(base, 'sheets'), { recursive: true });
for (const spec of SPRITE_CLIPS) {
  const defaults = projectClipDefaults(spec.name);
  const previous = prior?.clips.find((c) => c.name === spec.name);
  const name = spec.name;
  const frames = previous?.frames ?? defaults.frames;
  const cols = previous?.cols ?? defaults.cols;
  const speed = groundSpeedPxS(spec.tableId, 'E');
  const cells =
    speed === null
      ? undefined
      : locomotionCells(frames, guides, {
          halfStride: halfStrideFor(speed, spec.durationSec),
          lift: spec.tableId === 'run' ? 16 : 10,
          first: 'R',
        });
  if (!existsSync(join(base, `templates/${name}.template.json`))) {
    const template = buildTemplate({ clip: name, frames, cols, guides, ...(cells ? { cells } : {}) });
    writeFileSync(join(base, `templates/${name}.template.png`), encodePng(template.image));
    writeFileSync(join(base, `templates/${name}.template.json`), JSON.stringify(template.manifest, null, 2) + '\n');
  }
  clips.push({
    ...defaults,
    sheet: `sheets/${name}.png`,
    manifest: `templates/${name}.template.json`,
    ...previous,
    frames,
    cols,
    durationSec: defaults.durationSec,
    loop: defaults.loop,
    tableId: defaults.tableId,
    kind: defaults.kind,
  });
}
const project: Project = {
  ...prior,
  character: 'the-tu',
  direction: 'E',
  stem: 'thetu',
  master,
  palette: { lock: true },
  slice: { spill: {} },
  clips,
};
writeFileSync(join(base, 'project.json'), JSON.stringify(project, null, 2) + '\n');
console.log(JSON.stringify({ metrics, guides, clips: clips.map((c) => [c.name, c.frames, c.cols]) }, null, 2));
