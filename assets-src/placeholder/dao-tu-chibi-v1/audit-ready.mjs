/* global process, console */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { blit, createImage, encodePng, line, drawNumber, cross } from '@vgtd/rig';
import {
  runProject,
  CELL_PX,
  crop,
  toStraight,
  toPremultiplied,
  resizeImage,
  loadBacklog,
  saveBacklog,
  acceptFindings,
  backlogMarkdown,
} from '@vgtd/sprite';

const direction = process.argv[2] ?? 'E';
const out = resolve(process.argv[3]);
const base = resolve('assets-src/placeholder/dao-tu-chibi-v1', direction);
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8'));
project.clips = project.clips.filter((c) => existsSync(join(base, c.sheet)));
if (!project.clips.length) throw new Error('No generated sheets');
const result = runProject(project, base, { includeAlignedFrames: true });
const acceptIndex = process.argv.indexOf('--accept-note');
if (acceptIndex >= 0) {
  const path = join(base, project.backlog);
  const backlog = acceptFindings(loadBacklog(path, project.character), result.contract.qa, direction, {
    note: process.argv[acceptIndex + 1],
    owner: 'worker33',
    added: new Date().toISOString(),
  });
  saveBacklog(path, backlog);
  writeFileSync(join(base, 'quality-backlog.md'), backlogMarkdown(backlog));
}
mkdirSync(out, { recursive: true });
writeFileSync(join(out, 'contract.json'), JSON.stringify(result.contract, null, 2) + '\n');
for (const clip of result.alignedClips) {
  const sheet = createImage(CELL_PX * 4, CELL_PX * 4, [235, 238, 237, 255]);
  clip.frames.forEach((frame, i) => {
    if (frame) blit(sheet, frame, (i % 4) * CELL_PX, Math.floor(i / 4) * CELL_PX);
  });
  writeFileSync(join(out, clip.name + '.aligned.png'), encodePng(sheet));
  // Enlarged diagnostic only. Never used as a source frame or export input.
  const heads = createImage(240 * 4, 240 * 4, [235, 238, 237, 255]);
  clip.frames.forEach((frame, i) => {
    if (frame) {
      const patch = toPremultiplied(crop(toStraight(frame), 95, 0, 80, 80));
      blit(heads, resizeImage(patch, 240, 240), (i % 4) * 240, Math.floor(i / 4) * 240);
    }
  });
  writeFileSync(join(out, clip.name + '.heads-diagnostic.png'), encodePng(heads));
  if (['idle', 'walk', 'run', 'dash', 'emote'].includes(clip.name)) {
    for (let i = 0; i < clip.frames.length; i++) {
      const ox = (i % 4) * CELL_PX,
        oy = Math.floor(i / 4) * CELL_PX;
      for (let p = 16; p < CELL_PX; p += 16) {
        line(sheet, ox + p, oy, ox + p, oy + CELL_PX, [60, 120, 140, 65]);
        line(sheet, ox, oy + p, ox + CELL_PX, oy + p, [60, 120, 140, 65]);
        drawNumber(sheet, String(p), ox + p, oy + 1, 1, [10, 70, 100, 255]);
        drawNumber(sheet, String(p), ox + 1, oy + p, 1, [10, 70, 100, 255]);
      }
      drawNumber(sheet, String(i), ox + 4, oy + 4, 2, [160, 30, 30, 255]);
      const evidence = project.clips.find((c) => c.name === clip.name).headEvidence?.[i];
      if (evidence) {
        for (const point of [evidence.crown, evidence.chin, evidence.skullBase])
          if (point) cross(sheet, ox + point.x, oy + point.y, 3, [230, 30, 30, 255]);
        if (evidence.breadth)
          for (const point of [evidence.breadth.left, evidence.breadth.right])
            cross(sheet, ox + point.x, oy + point.y, 2, [0, 130, 60, 255]);
      }
    }
    writeFileSync(join(out, clip.name + '.landmarks-diagnostic.png'), encodePng(sheet));
  }
}
console.log(
  JSON.stringify(
    {
      clips: project.clips.map((c) => c.name),
      counts: result.contract.qa.counts,
      judged: result.contract.qa.judged.filter((j) => j.verdict !== 'info'),
    },
    null,
    2,
  ),
);
if (!result.contract.qa.ok) process.exitCode = 1;
