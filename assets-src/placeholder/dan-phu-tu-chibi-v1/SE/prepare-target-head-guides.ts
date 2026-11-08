/** Canonical-head INPUT guides for localized repairs; no output sprite is transformed. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, resizeImage, runProject, sheetLayout, type Project } from '@vgtd/sprite';
const base = resolve('assets-src/placeholder/dan-phu-tu-chibi-v1/SE');
const project = JSON.parse(readFileSync(base + '/project.json', 'utf8')) as Project;
const masterBytes = readFileSync(resolve(base, project.master)),
  master = decodePng(masterBytes);
const jobs = [
  { name: 'run', file: 'run.cell4-head-guide', anchors: [{ index: 4, x: 160, y: 78.5 }] },
  {
    name: 'dash',
    file: 'dash.cells1-2-7-head-guide',
    anchors: [
      { index: 1, x: 134, y: 93 },
      { index: 2, x: 140, y: 100 },
      { index: 7, x: 135, y: 94 },
    ],
  },
];
const hash = (b: Buffer) => createHash('sha256').update(b).digest('hex');
for (const job of jobs) {
  const clip = project.clips.find((c) => c.name === job.name)!;
  const records = runProject({ ...project, clips: [clip] }, base).contract.clips[0]!.records;
  const grid = sheetLayout(clip),
    rawBytes = readFileSync(resolve(base, clip.sheet)),
    raw = decodePng(rawBytes);
  const image = createImage(grid.cols * CELL_PX, grid.rows * CELL_PX);
  for (let i = 0; i < image.data.length; i += 4) image.data.set([255, 0, 255, 255], i);
  const placements = job.anchors.map((anchor) => {
    const record = records[anchor.index]!,
      cell = clip.sheetSelection?.cells[anchor.index] ?? anchor.index;
    const dx = Math.round(anchor.x - record.dx - 126),
      dy = Math.round(anchor.y - record.dy - 68);
    const ox = (cell % grid.cols) * CELL_PX,
      oy = Math.floor(cell / grid.cols) * CELL_PX;
    for (let sy = 1; sy < 71; sy++)
      for (let sx = 88; sx < 148; sx++) {
        if (sy > 51 && sx < 108) continue;
        const from = (sy * master.width + sx) * 4,
          alpha = master.data[from + 3]! / 255;
        const to = ((oy + sy + dy) * image.width + ox + sx + dx) * 4;
        for (let c = 0; c < 3; c++)
          image.data[to + c] = Math.round(master.data[from + c]! + image.data[to + c]! * (1 - alpha));
        image.data[to + 3] = 255;
      }
    return {
      localIndex: anchor.index,
      sourceCell: cell,
      alignedNeckIntent: anchor,
      sourceTranslation: { dx, dy },
      scale: 1,
    };
  });
  writeFileSync(base + '/templates/' + job.file + '.png', encodePng(image));
  writeFileSync(base + '/templates/' + job.file + '.raw-dpi.png', encodePng(resizeImage(image, raw.width, raw.height)));
  writeFileSync(
    base + '/templates/' + job.file + '.json',
    JSON.stringify(
      {
        note: 'Manual visible-neck authoring intentions, not QA evidence. Unscaled master head copied to INPUT; whole-guide DPI match only. Final repair remains an AI edit; body/root/pose must be preserved.',
        masterSha256: hash(masterBytes),
        source: clip.sheet,
        sourceSha256: hash(rawBytes),
        placements,
      },
      null,
      2,
    ) + '\n',
  );
}
