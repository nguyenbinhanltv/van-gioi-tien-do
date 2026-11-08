/** Exact pipeline-aligned source overlays for reviewed skull landmarks; never fits individual frames. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { blit, createImage, decodePng, drawNumber, encodePng, fillRect } from '@vgtd/rig';
import { crop, resizeImage, runProject } from '@vgtd/sprite';
const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const project = JSON.parse(readFileSync(resolve(root, 'NE/project.json'), 'utf8'));
const master = decodePng(readFileSync(resolve(root, 'reference/NE.master.png')));
const result = runProject(project, resolve(root, 'NE'), { includeAlignedFrames: true });
const out = resolve(tmpdir(), 'phap-NE-head-review');
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'qa.json'), JSON.stringify(result.contract.qa, null, 2));
function overlay(image: ReturnType<typeof createImage>, index: number, name = 'master') {
  const tile = crop(image, 64, 0, 176, 176);
  for (let y = 0; y < 176; y += 10) {
    fillRect(tile, 0, y, 176, 1, [90, 110, 130, 140]);
    drawNumber(tile, String(y), 0, y, 1, [230, 230, 230, 255]);
  }
  for (let x = 70; x < 240; x += 10) {
    fillRect(tile, x - 64, 0, 1, 176, [90, 110, 130, 140]);
    drawNumber(tile, String(x), x - 64, 164, 1, [230, 230, 230, 255]);
  }
  const marks =
    name === 'master'
      ? project.masterHead
      : project.clips.find((c: { name: string }) => c.name === name)?.headEvidence?.[index];
  if (marks) {
    const points =
      marks.kind === 'rear-crown-shoulder'
        ? [marks.crown, marks.shoulderTop.left, marks.shoulderTop.right, marks.breadth.left, marks.breadth.right]
        : marks.kind === 'rear-crown-shoulder-single'
          ? [marks.crown, marks.shoulderTop, marks.breadth.left, marks.breadth.right]
          : marks.kind === 'rear-breadth-only'
            ? [marks.crown, marks.breadth.left, marks.breadth.right]
            : [marks.crown, marks.chin];
    points.forEach((p, i) =>
      fillRect(
        tile,
        p.x - 65,
        p.y - 1,
        3,
        3,
        i === 0
          ? [20, 255, 80, 255]
          : i < (marks.kind === 'rear-crown-shoulder-single' ? 2 : 3)
            ? [255, 90, 20, 255]
            : [20, 220, 255, 255],
      ),
    );
  }
  drawNumber(tile, String(index), 150, 150, 2, [255, 200, 60, 255]);
  return tile;
}
// Rear-view review uses visible D50/D53 landmarks, never a fabricated chin.
writeFileSync(resolve(out, 'master.png'), encodePng(resizeImage(overlay(master, 0), 704, 704)));
for (const clip of project.clips.filter((c: { name: string }) =>
  ['idle', 'walk', 'run', 'dash', 'emote', 'meditate'].includes(c.name),
)) {
  const frames = result.alignedClips!.find((c) => c.name === clip.name)!.frames;
  const sheet = createImage(176 * 4, 176 * Math.ceil(frames.length / 4), [25, 28, 34, 255]);
  frames.forEach((image, index) => {
    if (!image) throw Error('Missing ' + clip.name + ' ' + index);
    const aligned = { image };
    writeFileSync(resolve(out, `${clip.name}-${index}.aligned.png`), encodePng(aligned.image));

    writeFileSync(
      resolve(out, `${clip.name}-${index}.png`),
      encodePng(resizeImage(overlay(aligned.image, index, clip.name), 704, 704)),
    );
    blit(sheet, overlay(aligned.image, index, clip.name), (index % 4) * 176, Math.floor(index / 4) * 176);
  });
  writeFileSync(resolve(out, clip.name + '.png'), encodePng(resizeImage(sheet, sheet.width * 2, sheet.height * 2)));
}
console.log(out);
