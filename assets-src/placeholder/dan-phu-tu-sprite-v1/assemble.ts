/** Normalize sheet DPI, then use ONE master-locked character scale for every clip. */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
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
  loadBacklog,
  applyBacklog,
  acceptFindings,
  saveBacklog,
  backlogMarkdown,
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
  let grid = raw;
  let cropTop = 0;
  let cropBottom = raw.height;
  if (Math.abs(raw.width / clip.cols - raw.height / rows) > 1) {
    const blankRow = (y: number) => {
      for (let x = 0; x < raw.width; x++) {
        const i = (y * raw.width + x) * 4;
        if (raw.data[i + 3]! > 0 && raw.data[i]! + raw.data[i + 1]! + raw.data[i + 2]! > 24) return false;
      }
      return true;
    };
    while (cropTop < cropBottom && blankRow(cropTop)) cropTop++;
    while (cropBottom > cropTop && blankRow(cropBottom - 1)) cropBottom--;
    const squareHeight = Math.round((raw.width / clip.cols) * rows);
    if (Math.abs(cropBottom - cropTop - squareHeight) <= 3) {
      cropTop = Math.floor((cropTop + cropBottom - squareHeight) / 2);
      cropBottom = cropTop + squareHeight;
    }
    if (Math.abs(raw.width / clip.cols - (cropBottom - cropTop) / rows) > 1)
      throw new Error(
        `${clip.name}: non-square cells: raw ${raw.width}x${raw.height}, cropped rows ${cropTop}..${cropBottom}; cannot distort anatomy`,
      );
    grid = createImage(raw.width, cropBottom - cropTop);
    grid.data.set(raw.data.subarray(cropTop * raw.width * 4, cropBottom * raw.width * 4));
  }
  const normalized = resizeImage(grid, clip.cols * CELL_PX, rows * CELL_PX);
  const sheet = join(work, `${clip.name}.png`);
  writeFileSync(sheet, encodePng(normalized));
  dpi.push({
    clip: clip.name,
    raw: [raw.width, raw.height],
    normalized: [normalized.width, normalized.height],
    cropTop,
    cropBottom,
    dpiScaleX: normalized.width / grid.width,
    dpiScaleY: normalized.height / grid.height,
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
// Absolute paths are confined to this temporary working project, never committed.
writeFileSync(
  join(work, 'project.json'),
  JSON.stringify({ ...input, backlog: resolve(dir, project.backlog ?? 'quality-backlog.json') }, null, 2) + '\n',
);
let result = runProject(input, dir);
if (process.argv.includes('--accept-soft')) {
  const path = resolve(dir, project.backlog ?? 'quality-backlog.json');
  const previous = loadBacklog(path, project.character);
  const judged = applyBacklog(result.contract.qa.findings, project.direction, previous);
  const accepted = acceptFindings(previous, judged, project.direction, {
    note: 'D41 first full-set pass: retain measured foot trajectory or free-pose redraw deviation for later cell-local improvement; no per-frame rescaling.',
    owner: 'support-art',
    added: '2026-11-06',
  });
  saveBacklog(path, accepted);
  writeFileSync(path.replace(/\.json$/, '.md'), backlogMarkdown(accepted));
  result = runProject(input, dir);
}
writeOutputs(result, exportDir);
writeFileSync(
  join(dir, 'dpi-calibration.json'),
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
if (!result.contract.qa.ok) process.exitCode = 1;
