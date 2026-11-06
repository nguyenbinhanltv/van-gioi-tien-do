/** Create character-owned inputs through public package APIs. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';
import {
  buildTemplate,
  guidesFromMaster,
  locomotionCells,
  measureFigure,
  groundSpeedPxS,
  halfStrideFor,
  SPRITE_CLIPS,
  projectClipDefaults,
  type ProjectClip,
} from '@vgtd/sprite';

const root = process.argv[2]!;
const direction = process.argv[3]! as Direction;
const dir = join(root, direction);
const overridePath = join(dir, 'clip-overrides.json');
const overrides: Record<string, Pick<ProjectClip, 'exceptions' | 'vertical'>> = existsSync(overridePath)
  ? JSON.parse(readFileSync(overridePath, 'utf8'))
  : {};
mkdirSync(join(dir, 'templates'), { recursive: true });
mkdirSync(join(dir, 'sheets'), { recursive: true });
const master = decodePng(readFileSync(join(root, 'reference', `${direction}.master.png`)));
const guides = guidesFromMaster(measureFigure(master)!);
const clips: ProjectClip[] = [];
for (const clipSpec of SPRITE_CLIPS) {
  const spec = { id: clipSpec.tableId, frames: clipSpec.tableFrames };
  const name = clipSpec.name;
  const sourceName = name === 'attack' ? 'attack_1' : name;
  const cols =
    spec.frames === 24
      ? 6
      : spec.frames === 14
        ? 5
        : spec.frames <= 4
          ? direction === 'E'
            ? spec.frames
            : 2
          : spec.frames % 5 === 0
            ? 5
            : 4;
  const durationSec = clipSpec.durationSec;
  const gait = spec.id === 'walk' || spec.id === 'run';
  const cells = gait
    ? locomotionCells(spec.frames, guides, {
        halfStride: halfStrideFor(groundSpeedPxS(spec.id, direction)!, durationSec),
        lift: spec.id === 'run' ? 16 : 10,
        first: 'R',
        direction,
      })
    : undefined;
  const template = buildTemplate({ clip: name, frames: spec.frames, cols, guides, ...(cells ? { cells } : {}) });
  writeFileSync(join(dir, 'templates', `${sourceName}.template.png`), encodePng(template.image));
  writeFileSync(
    join(dir, 'templates', `${sourceName}.template.json`),
    JSON.stringify(template.manifest, null, 2) + '\n',
  );
  const exceptionCells =
    spec.id === 'meditate'
      ? Array.from({ length: spec.frames }, (_, i) => i)
      : spec.id === 'dash'
        ? [1, 2, 3, 4]
        : name === 'attack'
          ? [3, 4, 5, 6]
          : name === 'attack_2'
            ? [1, 2, 3, 4, 5, 6, 7, 8]
            : name === 'attack_3'
              ? [1, 2, 3, 4, 5, 6, 7]
              : spec.id === 'die'
                ? Array.from({ length: spec.frames - 2 }, (_, i) => i + 2)
                : spec.id === 'emote'
                  ? [6, 7, 8, 9]
                  : [];
  const exceptions = Object.fromEntries(
    exceptionCells.map((i) => [
      String(i),
      spec.id === 'meditate'
        ? 'seated-meditation: crossed legs reduce pose height; original anatomical scale retained'
        : spec.id === 'die'
          ? 'die-collapse: knees buckle then body falls sideways; no anatomical resizing'
          : spec.id === 'emote'
            ? 'bow: neck and torso incline in a respectful greeting; no anatomical resizing'
            : 'lunge: forward torso inclination and bent knees reduce pose height; no rescaling',
    ]),
  );
  const selectedExceptions = overrides[name]?.exceptions ?? exceptions;
  clips.push({
    ...projectClipDefaults(name),
    sheet: `sheets/${sourceName}.png`,
    cols,
    frames: spec.frames,
    manifest: `templates/${sourceName}.template.json`,
    ...(Object.keys(selectedExceptions).length ? { exceptions: selectedExceptions } : {}),
    ...(overrides[name]?.vertical ? { vertical: overrides[name].vertical } : {}),
  });
}
writeFileSync(
  join(dir, 'project.json'),
  JSON.stringify(
    {
      character: 'dan-phu-tu',
      direction,
      stem: 'danphutu',
      master: `../reference/${direction}.master.png`,
      backlog: '../quality-backlog.json',
      clips,
    },
    null,
    2,
  ) + '\n',
);
console.log(`Prepared ${clips.length} clips for ${direction}`);
