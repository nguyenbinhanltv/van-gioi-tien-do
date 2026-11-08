/** Working QA overlays: output-cell pixel guides for manual crown/chin annotation. */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { blit, createImage, decodePng, drawNumber, encodePng, fillRect } from '@vgtd/rig';
import {
  alignFrame,
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
const project = JSON.parse(readFileSync(resolve(root, 'E/project.json'), 'utf8'));
const master = decodePng(readFileSync(resolve(root, 'reference/E.master.png')));
const metrics = measureFigure(master)!;
const guides = guidesFromMaster(metrics);
const globalScale = JSON.parse(readFileSync(resolve(root, 'character-calibration.json'), 'utf8')).scale;
const out = resolve(tmpdir(), 'vgtd-phap-head-review');
const annotations = JSON.parse(readFileSync(resolve(root, 'E/head-landmarks.review.json'), 'utf8'));
mkdirSync(out, { recursive: true });
writeFileSync(resolve(out, 'master-full.png'), encodePng(resizeImage(master, 1024, 1024)));
console.log(
  JSON.stringify({
    masterFaceSamples: [
      [140, 40],
      [148, 40],
      [144, 50],
      [150, 55],
      [146, 60],
      [144, 63],
    ].map(([x, y]) => ({
      x,
      y,
      rgba: [...master.data.slice((y! * master.width + x!) * 4, (y! * master.width + x!) * 4 + 4)],
    })),
  }),
);
function overlay(image: ReturnType<typeof createImage>, index: number, name = 'master') {
  const mask = createImage(image.width, image.height);
  for (let y = 8; y < 146; y++)
    for (let x = 100; x < 224; x++) {
      const offset = (y * image.width + x) * 4;
      const [r, g, b, a] = image.data.slice(offset, offset + 4);
      if (a! > 220 && r! > 100 && g! / r! > 0.55 && b! / r! > 0.52 && g! > b! + 2) mask.data[offset + 3] = 255;
    }
  const face = components(mask).sort((a, b) => b.area - a.area)[0];
  if (face) {
    const bottom = face.pixels.filter((pixel) => Math.floor(pixel / image.width) === face.y1);
    const chinCandidate = {
      x: bottom.reduce((sum, pixel) => sum + (pixel % image.width), 0) / bottom.length,
      y: face.y1 + 1,
    };
    console.log(
      JSON.stringify({
        faceDiagnostic: name,
        index,
        bounds: [face.x0, face.y0, face.x1, face.y1],
        area: face.area,
        chinCandidate,
      }),
    );
  }
  const tile = createImage(144, 160, [28, 32, 38, 255]);
  blit(tile, crop(image, 80, 0, 144, 160), 0, 0);
  for (let y = 8; y < 160; y += 8) {
    fillRect(tile, 0, y, 144, 1, [0, 70, 80, 80]);
    drawNumber(tile, String(y), 1, y + 1, 1, [160, 220, 220, 255]);
  }
  for (let x = 96; x < 224; x += 16) {
    fillRect(tile, x - 80, 0, 1, 160, [0, 70, 80, 80]);
    drawNumber(tile, String(x), x - 80, 1, 1, [160, 220, 220, 255]);
  }
  drawNumber(tile, String(index), 128, 152, 1, [255, 200, 100, 255]);
  const marks = name === 'master' ? annotations.master : annotations.clips[name]?.[index];
  if (marks) {
    for (const [key, color] of [
      ['crown', [20, 255, 80, 255]],
      ['chin', [255, 90, 20, 255]],
    ] as const) {
      const point = marks[key];
      fillRect(tile, point.x - 81, point.y - 1, 3, 3, color);
    }
    const sample = (point: { x: number; y: number }) => {
      const offset = (Math.round(point.y) * image.width + Math.round(point.x)) * 4;
      return [...image.data.slice(offset, offset + 4)];
    };
    console.log(
      JSON.stringify({
        name,
        index,
        distance: Math.hypot(marks.chin.x - marks.crown.x, marks.chin.y - marks.crown.y),
        crown: sample(marks.crown),
        chin: sample(marks.chin),
      }),
    );
  }
  return tile;
}
writeFileSync(resolve(out, 'master.png'), encodePng(resizeImage(overlay(master, 0), 576, 640)));
for (const name of ['run', 'dash']) {
  const clip = project.clips.find((entry: { name: string }) => entry.name === name);
  const grid = sheetLayout(clip);
  const raw = decodePng(readFileSync(resolve(root, 'E', clip.sheet)));
  const normalized = normalizeSheetDpi(raw, clip.cols, grid.frames).image;
  const frames = selectSheetCells(sliceSheet(normalized, grid, project.slice), clip.sheetSelection);
  const manifest = JSON.parse(readFileSync(resolve(root, 'E', clip.manifest), 'utf8'));
  const scale = clip.calibration?.scale ?? globalScale;
  const sheet = createImage(144 * 4, 160 * Math.ceil(frames.length / 4), [28, 32, 38, 255]);
  frames.forEach((frame, index) => {
    const aligned = alignFrame(frame.image, {
      calibration: { scale, targetHeight: metrics.height, referenceHeight: metrics.height / scale, referenceFrames: 0 },
      guides,
      vertical: clip.vertical ?? 'sole',
      groundY: manifest.guides.ground,
    });
    if (!aligned) throw new Error(`Missing ${name} ${index}`);
    if (index === 0)
      writeFileSync(
        resolve(out, `${name}-0.png`),
        encodePng(resizeImage(overlay(aligned.image, index, name), 864, 960)),
      );
    blit(sheet, overlay(aligned.image, index, name), (index % 4) * 144, Math.floor(index / 4) * 160);
  });
  writeFileSync(resolve(out, `${name}.png`), encodePng(resizeImage(sheet, sheet.width * 3, sheet.height * 3)));
}
console.log(out);
