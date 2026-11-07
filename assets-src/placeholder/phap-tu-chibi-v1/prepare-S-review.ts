/** Exact pipeline-aligned source overlays for reviewed skull landmarks; never fits individual frames. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { blit, createImage, decodePng, drawNumber, encodePng, fillRect } from '@vgtd/rig';
import {
  authoredOriginPoint,
  alignFrame,
  CELL_PX,
  components,
  crop,
  guidesFromMaster,
  measureFigure,
  normalizeSheetDpi,
  resizeImage,
  selectSheetCells,
  sheetLayout,
  sliceSheet,
} from '@vgtd/sprite';
const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const project = JSON.parse(readFileSync(resolve(root, 'S/project.json'), 'utf8'));
const master = decodePng(readFileSync(resolve(root, 'reference/S.master.png')));
const m = measureFigure(master)!;
const guides = guidesFromMaster(m);
const globalScale = JSON.parse(readFileSync(resolve(root, 'character-calibration.json'), 'utf8')).scale;
const out = resolve(tmpdir(), 'phap-S-head-review');
mkdirSync(out, { recursive: true });
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
    for (const key of ['crown', 'chin'] as const) {
      const p = marks[key];
      fillRect(tile, p.x - 65, p.y - 1, 3, 3, key === 'crown' ? [20, 255, 80, 255] : [255, 90, 20, 255]);
    }
  }
  drawNumber(tile, String(index), 150, 150, 2, [255, 200, 60, 255]);
  return tile;
}
function candidateChin(image: ReturnType<typeof createImage>, name: string, index: number) {
  const mask = createImage(CELL_PX, CELL_PX);
  for (let y = 8; y < 200; y++)
    for (let x = 100; x < 220; x++) {
      const o = (y * CELL_PX + x) * 4;
      const [r, g, b, a] = image.data.slice(o, o + 4);
      if (a! > 220 && r! > 100 && g! / r! > 0.55 && b! / r! > 0.52 && g! > b! + 2) mask.data[o + 3] = 255;
    }
  const c = components(mask).sort((a, b) => b.area - a.area)[0];
  if (!c) return;
  const bottom = c.pixels.filter((p) => Math.floor(p / CELL_PX) === c.y1);
  console.log(
    JSON.stringify({
      name,
      index,
      face: { x0: c.x0, y0: c.y0, x1: c.x1, y1: c.y1, area: c.area },
      chin: { x: bottom.reduce((s, p) => s + (p % CELL_PX), 0) / bottom.length, y: c.y1 + 1 },
      note: 'Detector candidate only; manual skull/face review required.',
    }),
  );
}
candidateChin(master, 'master', 0);
writeFileSync(resolve(out, 'master.png'), encodePng(resizeImage(overlay(master, 0), 704, 704)));
for (const clip of project.clips.filter((c: { name: string }) =>
  ['walk', 'run', 'dash', 'emote', 'meditate'].includes(c.name),
)) {
  const grid = sheetLayout(clip);
  const normalized = normalizeSheetDpi(
    decodePng(readFileSync(resolve(root, 'S', clip.sheet))),
    clip.cols,
    grid.frames,
  ).image;
  const frames = selectSheetCells(sliceSheet(normalized, grid, project.slice), clip.sheetSelection);
  const scale = clip.calibration?.scale ?? globalScale;
  const sheet = createImage(176 * 4, 176 * Math.ceil(frames.length / 4), [25, 28, 34, 255]);
  frames.forEach((frame, index) => {
    const inset = Math.round(CELL_PX * (project.slice?.inset ?? 0.01));
    const origin = clip.authoredOrigins?.[index];
    const point = origin
      ? authoredOriginPoint(
          origin,
          CELL_PX,
          CELL_PX,
          inset,
          clip.vertical === 'keep' ? guides.ground - inset : measureFigure(frame.image)!.bottom,
        )
      : undefined;
    const aligned = alignFrame(frame.image, {
      calibration: { scale, targetHeight: m.height, referenceHeight: m.height / scale, referenceFrames: 0 },
      guides,
      vertical: clip.vertical ?? 'sole',
      groundY: guides.ground - Math.round(CELL_PX * (project.slice?.inset ?? 0.01)),
      ...(point ? { referenceOrigin: point } : {}),
    });
    if (!aligned) throw Error('Missing ' + clip.name + ' ' + index);
    candidateChin(aligned.image, clip.name, index);
    writeFileSync(
      resolve(out, `${clip.name}-${index}.png`),
      encodePng(resizeImage(overlay(aligned.image, index, clip.name), 704, 704)),
    );
    blit(sheet, overlay(aligned.image, index, clip.name), (index % 4) * 176, Math.floor(index / 4) * 176);
  });
  writeFileSync(resolve(out, clip.name + '.png'), encodePng(resizeImage(sheet, sheet.width * 2, sheet.height * 2)));
}
console.log(out);
