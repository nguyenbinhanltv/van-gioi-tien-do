/** Unscaled canonical-head INPUT stencils; never used as final animation pixels or QA evidence. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { runProject, resizeImage, smoothProjectClipDefaults, type Project } from '@vgtd/sprite';

const base = resolve('assets-src/placeholder/dan-phu-tu-chibi-v1/SE');
const project = JSON.parse(readFileSync(base + '/project.json', 'utf8')) as Project;
const source = {
  ...smoothProjectClipDefaults('run'),
  sheet: 'raw/run.attempt1.png',
  manifest: 'templates/run.template.json',
  vertical: 'keep' as const,
};
const result = runProject({ ...project, clips: [source] }, base);
const records = result.contract.clips[0]!.records;
const masterBytes = readFileSync(resolve(base, project.master));
const master = decodePng(masterBytes);
const hash = (bytes: Buffer) => createHash('sha256').update(bytes).digest('hex');
const anchors = [
  [155, 88],
  [163, 96],
  [155, 90],
  [160, 83],
  [158, 96],
  [156, 84],
  [161, 91],
  [168, 90],
  [162, 93],
  [160, 101],
  [161, 95],
  [170, 85],
  [161, 88],
  [159, 91],
  [161, 99],
  [159, 93],
];
const image = createImage(1024, 1024);
for (let i = 0; i < image.data.length; i += 4) image.data.set([255, 0, 255, 255], i);
const placements = anchors.map(([x, y], index) => {
  const record = records[index]!;
  const dx = Math.round(x! - record.dx - 126);
  const dy = Math.round(y! - record.dy - 68);
  const ox = (index % 4) * 256,
    oy = Math.floor(index / 4) * 256;
  for (let sy = 1; sy < 71; sy++)
    for (let sx = 88; sx < 148; sx++) {
      if (sy > 51 && sx < 108) continue; // Exclude the held whisk from the head-only stencil.
      const from = (sy * master.width + sx) * 4,
        alpha = master.data[from + 3]! / 255;
      const to = ((oy + sy + dy) * image.width + ox + sx + dx) * 4;
      for (let c = 0; c < 3; c++)
        image.data[to + c] = Math.round(master.data[from + c]! + image.data[to + c]! * (1 - alpha));
      image.data[to + 3] = 255;
    }
  return { index, alignedNeckIntent: { x, y }, normalizedSourceTranslation: { dx, dy }, scale: 1, angle: 0 };
});
writeFileSync(base + '/templates/run.canonical-head-guide.png', encodePng(image));
const raw = decodePng(readFileSync(base + '/' + source.sheet));
writeFileSync(
  base + '/templates/run.canonical-head-guide.raw-dpi.png',
  encodePng(resizeImage(image, raw.width, raw.height)),
);
// Whole input-sheet DPI matching only; no final drawing or individual frame is rescaled.
writeFileSync(
  base + '/templates/run.canonical-head-guide.json',
  JSON.stringify(
    {
      note: 'Manual visible-neck authoring intentions, not output landmarks or head-size certification. Canonical master head is copied unscaled into INPUT only; output remains an AI repaint. Source body/root/flight must remain unchanged.',
      master: project.master,
      masterSha256: hash(masterBytes),
      source: source.sheet,
      sourceSha256: hash(readFileSync(base + '/' + source.sheet)),
      placements,
    },
    null,
    2,
  ) + '\n',
);
