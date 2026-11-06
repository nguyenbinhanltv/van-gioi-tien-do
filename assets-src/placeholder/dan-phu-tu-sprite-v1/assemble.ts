/** Normalize sheet DPI, then use ONE master-locked character scale for every clip. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  median,
  measureFigure,
  resizeImage,
  runProject,
  sliceSheet,
  writeOutputs,
  type Project,
  type ProjectClip,
} from '@vgtd/sprite';

const dir = resolve(process.argv[2]!);
const work = resolve(process.argv[3]!);
const exportDir = resolve(process.argv[4]!);
const available = process.argv.includes('--available');
const project = JSON.parse(readFileSync(join(dir, 'project.json'), 'utf8')) as Project;
mkdirSync(work, { recursive: true });
const clips: ProjectClip[] = [];
const dpi = [];
const uprightHeights: number[] = [];
for (const clip of project.clips) {
  if (!existsSync(join(dir, clip.sheet))) {
    if (available) continue;
    throw new Error(`Missing ${clip.name}`);
  }
  const raw = decodePng(readFileSync(join(dir, clip.sheet)));
  const rows = Math.ceil(clip.frames / clip.cols);
  const normalized = resizeImage(raw, clip.cols * CELL_PX, rows * CELL_PX);
  const sheet = join(work, `${clip.name}.png`);
  writeFileSync(sheet, encodePng(normalized));
  dpi.push({
    clip: clip.name,
    raw: [raw.width, raw.height],
    normalized: [normalized.width, normalized.height],
    dpiScaleX: normalized.width / raw.width,
    dpiScaleY: normalized.height / raw.height,
  });
  if (clip.kind === 'upright') {
    for (const frame of sliceSheet(normalized, { cols: clip.cols, rows, frames: clip.frames })) {
      const m = measureFigure(frame.image);
      if (m) uprightHeights.push(m.height);
    }
  }
  clips.push({ ...clip, sheet, manifest: clip.manifest ? join(dir, clip.manifest) : undefined });
}
const master = resolve(dir, project.master);
const target = measureFigure(decodePng(readFileSync(master)))!.height;
const locked = JSON.parse(readFileSync(resolve(dir, '../character-calibration.json'), 'utf8')) as {
  scale: number;
  referenceHeight: number;
};
const measuredUprightMedian = median(uprightHeights);
const referenceHeight = locked.referenceHeight;
const scale = locked.scale;
const input: Project = { ...project, master, scale, clips };
const result = runProject(input, dir);
writeOutputs(result, exportDir);
writeFileSync(
  join(work, 'dpi-calibration.json'),
  JSON.stringify({ scale, referenceHeight, measuredUprightMedian, masterHeight: target, dpi }, null, 2) + '\n',
);
console.log(
  JSON.stringify(
    {
      scale,
      referenceHeight,
      heights: result.contract.clips.map((c) => ({ name: c.name, heights: c.records.map((r) => r?.post.height) })),
      qa: result.contract.qa,
    },
    null,
    2,
  ),
);
