/** Explicit partial QA during generation; missing sheets never imply a full-direction pass. */
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  measureFigure,
  nativeCellTransform,
  normalizeSheetDpi,
  runProject,
  selectSheetCells,
  sheetLayout,
  sliceSheet,
  writeOutputs,
  type Project,
} from '@vgtd/sprite';
const base = resolve(process.argv[2]!);
const out = resolve(process.argv[3]!);
const project = JSON.parse(readFileSync(join(base, 'project.json'), 'utf8')) as Project;
const present = project.clips.filter((clip) => existsSync(resolve(base, clip.sheet)));
const missing = project.clips.filter((clip) => !present.includes(clip)).map((clip) => clip.name);
if (missing.length && !process.argv.includes('--partial')) throw new Error('Missing sheets: ' + missing.join(', '));
if (!present.length) throw new Error('No generated sheets');
console.log((missing.length ? 'PARTIAL' : 'FULL') + ' QA: ' + present.length + '/' + project.clips.length + ' clips');
const result = runProject({ ...project, clips: present }, base);
const canvasClipping = result.contract.clips.flatMap((clip) =>
  clip.records.flatMap((record, frame) => {
    if (!record || record.pre.height - record.post.height <= 1.25) return [];
    return [
      {
        clip: clip.name,
        frame,
        preHeight: record.pre.height,
        postHeight: record.post.height,
        lostHeight: record.pre.height - record.post.height,
        note: 'Canvas placement lost more than rounding tolerance; reject export even if post-crop height passes.',
      },
    ];
  }),
);
const projectedCanvasLoss = present.flatMap((clip) => {
  const contract = result.contract.clips.find((entry) => entry.name === clip.name)!;
  const grid = sheetLayout(clip);
  const raw = decodePng(readFileSync(resolve(base, clip.sheet)));
  const resample = project.resample ?? 'bilinear';
  const deferred = !!project.preparation && resample !== 'bilinear';
  const prepared = project.preparation
    ? normalizeSheetDpi(raw, grid.cols, grid.frames, deferred ? { resample, defer: true } : {})
    : undefined;
  const sheet = decodePng(encodePng(prepared?.image ?? raw));
  const frames = selectSheetCells(sliceSheet(sheet, grid, project.slice), clip.sheetSelection);
  return frames.flatMap((frame, index) => {
    const native = measureFigure(frame.image);
    const record = contract.records[index];
    if (!native || !record) return [];
    const transform = deferred
      ? nativeCellTransform(
          sheet.width,
          sheet.height,
          prepared!.record.normalized[0],
          prepared!.record.normalized[1],
          grid.cols,
          grid.rows,
          clip.sheetSelection?.cells[index] ?? index,
          project.slice?.inset ?? 0.01,
        )
      : undefined;
    const source = transform
      ? {
          ...native,
          left: native.left * transform.scaleX + transform.dx,
          right: native.right * transform.scaleX + transform.dx,
          top: native.top * transform.scaleY + transform.dy,
          bottom: native.bottom * transform.scaleY + transform.dy,
          width: native.width * transform.scaleX,
          height: native.height * transform.scaleY,
          pelvisX: native.pelvisX * transform.scaleX + transform.dx,
        }
      : native;
    const scale = contract.calibration.scale;
    if (Math.abs(source.height * scale - record.pre.height) > 1.25)
      throw new Error('Source geometry diagnostic differs from pipeline: ' + clip.name + ' #' + index);
    const bounds = {
      left: source.left * scale + record.dx,
      right: source.right * scale + record.dx,
      top: source.top * scale + record.dy,
      bottom: source.bottom * scale + record.dy,
    };
    if (bounds.left >= 0 && bounds.top >= 0 && bounds.right <= CELL_PX && bounds.bottom <= CELL_PX) return [];
    return [{ clip: clip.name, frame: index, source, scale, dx: record.dx, dy: record.dy, projected: bounds }];
  });
});
writeOutputs(result, out);
mkdirSync(out, { recursive: true });
writeFileSync(
  join(out, 'qa-selection.json'),
  JSON.stringify(
    { partial: missing.length > 0, selected: present.map((c) => c.name), missing, canvasClipping, projectedCanvasLoss },
    null,
    2,
  ) + '\n',
);
for (const clip of result.contract.clips) {
  const heights = clip.records.filter((r) => r !== null).map((r) => r.post.height);
  console.log(
    clip.name + ': ' + heights.length + ' frames, heights ' + Math.min(...heights) + '..' + Math.max(...heights),
  );
}
for (const judged of result.contract.qa.judged) console.log(judged.verdict + ' ' + JSON.stringify(judged.finding));
console.log(JSON.stringify(result.contract.qa.counts));
for (const clipped of canvasClipping) console.log('EXPORT CLIPPING: ' + JSON.stringify(clipped));
for (const loss of projectedCanvasLoss) console.log('PROJECTED CANVAS LOSS: ' + JSON.stringify(loss));
if (!result.contract.qa.ok || canvasClipping.length || projectedCanvasLoss.length) process.exitCode = 1;
