/** Run from the repository root with tools/rig/scripts/run-ts.mjs. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  buildTemplate,
  groundSpeedPxS,
  guidesFromMaster,
  halfStrideFor,
  locomotionCells,
  measureFigure,
  resizeImage,
  type Project,
} from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/phap-tu-fan-sprite-v1');
const batch = JSON.parse(readFileSync(join(root, 'batch.json'), 'utf8')) as { projects: string[] };
for (const relative of batch.projects) {
  const projectPath = join(root, relative);
  const base = dirname(projectPath);
  const project = JSON.parse(readFileSync(projectPath, 'utf8')) as Project;
  const master = decodePng(readFileSync(resolve(base, project.master)));
  const metrics = measureFigure(master);
  if (!metrics) throw new Error('empty master');
  const guides = guidesFromMaster(metrics);
  mkdirSync(join(base, 'templates'), { recursive: true });
  for (const clip of project.clips) {
    const stem = join(base, 'templates', clip.name + '.template');
    const gait = clip.name === 'walk' || clip.name === 'run' ? clip.name : null;
    // Existing generation guides are provenance. Non-E gait guides need measured stance width from the CLI.
    const needsTemplate = !existsSync(stem + '.png') || !existsSync(stem + '.json');
    if (needsTemplate && gait && project.direction !== 'E')
      throw new Error(
        `${project.direction}/${clip.name}: create measured directional guides with sprite:template first`,
      );
    const cells = gait
      ? locomotionCells(clip.frames, guides, {
          direction: project.direction,
          halfStride: halfStrideFor(groundSpeedPxS(gait, project.direction)!, clip.durationSec),
          lift: gait === 'run' ? 16 : 10,
          first: 'R',
        })
      : undefined;
    const template = buildTemplate({
      clip: clip.name,
      frames: clip.frames,
      cols: clip.cols,
      guides,
      ...(cells ? { cells } : {}),
    });
    if (needsTemplate) {
      writeFileSync(stem + '.png', encodePng(template.image));
      writeFileSync(stem + '.json', JSON.stringify(template.manifest, null, 2) + '\n');
    }

    // Declared raw-sheet preparation belongs to the shared build/batch pipeline.
    if (project.preparation) continue;

    const target = resolve(base, clip.sheet);
    const source = target.replace(/\.png$/, '.generated.png');
    if (!existsSync(source) || existsSync(target.replace(/\.png$/, '.repair.json'))) continue;
    const raw = decodePng(readFileSync(source));
    const width = clip.cols * CELL_PX;
    const height = Math.ceil(clip.frames / clip.cols) * CELL_PX;
    const aspectError = Math.abs(raw.width / raw.height / (width / height) - 1);
    if (aspectError > 0.01) throw new Error(`${clip.name}: generated sheet does not match the square-cell grid`);
    const scale = Math.min(width / raw.width, height / raw.height);
    const resized = resizeImage(raw, Math.round(raw.width * scale), Math.round(raw.height * scale));
    const output = createImage(width, height);
    for (let y = 0; y < Math.min(height, resized.height); y++)
      for (let x = 0; x < Math.min(width, resized.width); x++) {
        const pixel = (y * resized.width + x) * 4;
        output.data.set(resized.data.subarray(pixel, pixel + 4), (y * width + x) * 4);
      }
    writeFileSync(target, encodePng(output));
    writeFileSync(
      target.replace(/\.png$/, '.normalization.json'),
      JSON.stringify(
        {
          method: 'whole-sheet uniform DPI conversion before one character calibration; no individual frame scaling',
          source: clip.sheet.replace(/\.png$/, '.generated.png'),
          output: clip.sheet,
          sourceSize: [raw.width, raw.height],
          scale,
          resized: [resized.width, resized.height],
          canvas: [width, height],
        },
        null,
        2,
      ) + '\n',
    );
    console.log(
      `${project.direction}/${clip.name}: ${raw.width}x${raw.height} -> ${width}x${height}, uniform ${scale}`,
    );
  }
}
