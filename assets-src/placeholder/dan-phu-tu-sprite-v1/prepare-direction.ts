/** Create character-owned inputs through public package APIs. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANIMATIONS } from '@vgtd/character';
import { decodePng, encodePng } from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';
import {
  buildTemplate,
  guidesFromMaster,
  locomotionCells,
  measureFigure,
  groundSpeedPxS,
  halfStrideFor,
  type ProjectClip,
} from '@vgtd/sprite';

const root = process.argv[2]!;
const direction = process.argv[3]! as Direction;
const dir = join(root, direction);
mkdirSync(join(dir, 'templates'), { recursive: true });
mkdirSync(join(dir, 'sheets'), { recursive: true });
const master = decodePng(readFileSync(join(root, 'reference', `${direction}.master.png`)));
const guides = guidesFromMaster(measureFigure(master)!);
const clips: ProjectClip[] = [];
for (const spec of ANIMATIONS) {
  for (const name of spec.id === 'attack' ? ['attack_1', 'attack_2', 'attack_3'] : [spec.id]) {
    const cols =
      spec.frames === 24 ? 6 : spec.frames === 14 ? 5 : spec.frames <= 4 ? spec.frames : spec.frames % 5 === 0 ? 5 : 4;
    const durationSec = spec.frames / spec.fps;
    const gait = spec.id === 'walk' || spec.id === 'run';
    const cells = gait
      ? locomotionCells(spec.frames, guides, {
          halfStride: halfStrideFor(groundSpeedPxS(spec.id, direction)!, durationSec),
          lift: spec.id === 'run' ? 16 : 10,
          first: 'R',
        })
      : undefined;
    const template = buildTemplate({ clip: name, frames: spec.frames, cols, guides, ...(cells ? { cells } : {}) });
    writeFileSync(join(dir, 'templates', `${name}.template.png`), encodePng(template.image));
    writeFileSync(join(dir, 'templates', `${name}.template.json`), JSON.stringify(template.manifest, null, 2) + '\n');
    const exceptionCells =
      spec.id === 'meditate'
        ? Array.from({ length: spec.frames }, (_, i) => i)
        : spec.id === 'dash'
          ? [1, 2, 3, 4]
          : name === 'attack_1'
            ? [3, 4, 5, 6]
            : name === 'attack_2'
              ? [1, 2, 3, 4, 5, 6, 7, 8]
              : name === 'attack_3'
                ? [1, 2, 3, 4, 5, 6, 7]
                : [];
    const exceptions = Object.fromEntries(
      exceptionCells.map((i) => [
        String(i),
        spec.id === 'meditate'
          ? 'seated-meditation: crossed legs reduce pose height; original anatomical scale retained'
          : 'lunge: forward torso inclination and bent knees reduce pose height; no rescaling',
      ]),
    );
    clips.push({
      name,
      sheet: `sheets/${name}.png`,
      cols,
      frames: spec.frames,
      manifest: `templates/${name}.template.json`,
      tableId: spec.id,
      durationSec,
      loop: spec.loop,
      kind: ['idle', 'walk', 'run'].includes(spec.id) ? 'upright' : 'free',
      ...(exceptionCells.length ? { exceptions } : {}),
      ...(spec.id === 'attack' ? { phases: { hit_frame: 5, combo_window: 8 } } : {}),
      ...(spec.id === 'cast' ? { phases: { windup_end: 7 } } : {}),
    });
  }
}
writeFileSync(
  join(dir, 'project.json'),
  JSON.stringify(
    { character: 'dan-phu-tu', direction, stem: 'danphutu', master: `../reference/${direction}.master.png`, clips },
    null,
    2,
  ) + '\n',
);
console.log(`Prepared ${clips.length} clips for ${direction}`);
