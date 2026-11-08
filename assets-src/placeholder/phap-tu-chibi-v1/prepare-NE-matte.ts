/** Key/matte preparation and masked AI head repair; never fits or rescales individual frames. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  TORSO_BAND,
  colorDistance,
  measureFigure,
  normalizeSheetDpi,
  paletteFromMaster,
  sheetLayout,
  sliceSheet,
  toPremultiplied,
  type Straight,
} from '@vgtd/sprite';

const root = resolve('assets-src/placeholder/phap-tu-chibi-v1');
const dir = resolve(root, 'NE');
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const outputDir = resolve(opt('out') ?? dir);
const project = JSON.parse(readFileSync(resolve(dir, 'project.json'), 'utf8'));
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
const pixelHash = (data: Uint8ClampedArray) => createHash('sha256').update(data).digest('hex');
const palette = paletteFromMaster(decodePng(readFileSync(resolve(root, 'reference/NE.master.png'))));
const green = (r: number, g: number, b: number) => g > r + 30 && g > b + 30;
if (palette.some(([r, g, b]) => green(r, g, b)))
  throw Error('Approved palette contains green; cleanup is not applicable');
const selections = JSON.parse(readFileSync(resolve(opt('selection') ?? resolve(dir, 'selection.json')), 'utf8'));
mkdirSync(resolve(outputDir, 'prepared'), { recursive: true });
const records = [];
for (const name of new Set<string>(
  project.clips.map((c: { name: string; sheet: string }) =>
    c.name === 'hit' || c.name === 'dash' ? 'hit-dash' : c.name,
  ),
)) {
  const clip = project.clips.find(
    (c: { name: string }) => c.name === name || (name === 'hit-dash' && c.name === 'hit'),
  );
  const grid = sheetLayout(clip);
  const attempt = selections.attempts[name] ?? selections.defaultAttempt;
  const source = `raw/${name}.attempt${attempt}.png`;
  const normalized = normalizeSheetDpi(decodePng(readFileSync(resolve(dir, source))), clip.cols, grid.frames);
  const inset = Math.round(CELL_PX * 0.01);
  const options = { inset: 0.01, spill: { palette } };
  const frames = sliceSheet(normalized.image, grid, options);
  const headConfig =
    name === 'run'
      ? (selections.headEdits?.run ?? { defaultAttempt: 2, defaultMaskPolicy: 'legacy-core-v1', cells: {} })
      : undefined;
  const editCache = new Map<number, ReturnType<typeof sliceSheet>>();
  const editsFor = (attempt: number) => {
    if (!editCache.has(attempt)) {
      const file = resolve(dir, `raw/${name}.attempt${attempt}.png`);
      editCache.set(
        attempt,
        sliceSheet(normalizeSheetDpi(decodePng(readFileSync(file)), clip.cols, grid.frames).image, grid, options),
      );
    }
    return editCache.get(attempt)!;
  };
  const sheet: Straight = {
    width: clip.cols * CELL_PX,
    height: grid.rows * CELL_PX,
    data: new Uint8ClampedArray(clip.cols * CELL_PX * grid.rows * CELL_PX * 4),
  };
  const cells = [];
  for (const [i, frame] of frames.entries()) {
    const original = frame.image;
    const image: Straight = {
      width: original.width,
      height: original.height,
      data: new Uint8ClampedArray(original.data),
    };
    const before = measureFigure(original)!;
    const headEdit = headConfig
      ? (headConfig.cells?.[i] ?? { attempt: headConfig.defaultAttempt, maskPolicy: headConfig.defaultMaskPolicy })
      : undefined;
    const editFile = headEdit ? `raw/${name}.attempt${headEdit.attempt}.png` : undefined;
    const edits = headEdit ? editsFor(headEdit.attempt) : undefined;
    const fullCap = headEdit?.maskPolicy === 'whole-cap-v2';
    const widthOnly = headEdit?.maskPolicy === 'cap-width-v3';
    if (headEdit && !['legacy-core-v1', 'whole-cap-v2', 'cap-width-v3'].includes(headEdit.maskPolicy))
      throw Error('Unknown head mask policy');
    let mask: { left: number; top: number; right: number; bottom: number } | undefined;
    let repaired = 0;
    if (edits) {
      // The full-cap policy includes the actual skull crown, and ends above the garment shoulder corner.
      mask = {
        left: 97,
        right: 190,
        top: fullCap ? Math.max(0, before.top - 1) : before.top + 8,
        bottom:
          fullCap || widthOnly
            ? Math.min(before.top + 60, Math.floor(before.top + TORSO_BAND[0] * before.height) - 4)
            : Math.floor(before.top + TORSO_BAND[0] * before.height) - 4,
      };
      for (let y = mask.top; y < mask.bottom; y++)
        for (let x = mask.left; x < mask.right; x++) {
          const o = (y * image.width + x) * 4;
          const [r, g, b] = original.data.slice(o, o + 3);
          // Original fan, pin, ribbons, earrings and visible skin stay unchanged even inside the head rectangle.
          const warm =
            (r! > 120 && r! > g! * (fullCap ? 2 : 1.8) && r! > b! * (fullCap ? 2 : 1.3)) ||
            (r! > 150 && g! > 100 && b! < g! * 1.05);
          if (warm) continue;
          image.data.set(edits[i]!.image.data.subarray(o, o + 4), o);
          repaired++;
        }
    }
    const afterRepair = measureFigure(image)!;
    if (
      before.bottom !== afterRepair.bottom ||
      (!fullCap && (before.top !== afterRepair.top || before.pelvisX !== afterRepair.pelvisX))
    )
      throw Error(`Head repair changed registration: ${name} ${i}`);
    let outsideMaskAlphaChanges = 0;
    let outsideMaskRgbaChanges = 0;
    for (let y = 0; y < image.height; y++)
      for (let x = 0; x < image.width; x++) {
        if (mask && x >= mask.left && x < mask.right && y >= mask.top && y < mask.bottom) continue;
        const o = (y * image.width + x) * 4;
        if (image.data[o + 3] !== original.data[o + 3]) outsideMaskAlphaChanges++;
        if (image.data.subarray(o, o + 4).some((value, channel) => value !== original.data[o + channel]))
          outsideMaskRgbaChanges++;
      }
    if (outsideMaskAlphaChanges) throw Error('Original body alpha was changed');
    if (outsideMaskRgbaChanges) throw Error('AI head repair changed pixels outside the reviewed mask');
    const alphaBefore = Uint8ClampedArray.from(
      { length: image.width * image.height },
      (_, p) => image.data[p * 4 + 3]!,
    );
    let cleaned = 0;
    for (let o = 0; o < image.data.length; o += 4) {
      const [r, g, b, a] = image.data.slice(o, o + 4);
      if (!a) continue;
      const input = [r!, g!, b!] as const;
      if (!green(...input)) continue;
      const closest = palette.reduce((p, q) => (colorDistance(input, p) <= colorDistance(input, q) ? p : q));
      image.data.set(closest, o);
      cleaned++;
    }
    const alphaAfter = Uint8ClampedArray.from({ length: image.width * image.height }, (_, p) => image.data[p * 4 + 3]!);
    if (pixelHash(alphaBefore) !== pixelHash(alphaAfter)) throw Error('Matte despill changed alpha');
    for (let y = 0; y < image.height; y++) {
      const o =
        ((Math.floor(i / clip.cols) * CELL_PX + inset + y) * sheet.width + (i % clip.cols) * CELL_PX + inset) * 4;
      sheet.data.set(image.data.subarray(y * image.width * 4, (y + 1) * image.width * 4), o);
    }
    cells.push({
      cell: i,
      ...(editFile
        ? { aiHeadEdit: editFile, aiHeadEditSha256: hash(resolve(dir, editFile)), maskPolicy: headEdit.maskPolicy }
        : {}),
      ...(mask ? { mask, repairedPixels: repaired } : {}),
      outsideMaskAlphaChanges,
      outsideMaskRgbaChanges,
      before,
      afterRepair,
      greenSpillPixelsRecoloured: cleaned,
      matteAlphaSha256: pixelHash(alphaAfter),
    });
  }
  const out = `prepared/${name}.png`;
  writeFileSync(resolve(outputDir, out), encodePng(toPremultiplied(sheet)));
  records.push({
    source,
    sourceSha256: hash(resolve(dir, source)),
    headEditSources: [...editCache.keys()].map((attempt) => ({
      file: `raw/${name}.attempt${attempt}.png`,
      sha256: hash(resolve(dir, `raw/${name}.attempt${attempt}.png`)),
    })),
    wholeSheetDpi: normalized.record,
    output: out,
    outputSha256: hash(resolve(outputDir, out)),
    cells,
  });
  for (const c of project.clips)
    if (c.name === name || (name === 'hit-dash' && ['hit', 'dash'].includes(c.name))) c.sheet = out;
}
// Sources are already keyed/defringed. Preserve their straight alpha; no second soft key or repeated colour cleanup.
project.slice = { inset: 0.01, inner: 0, outer: 1, defringe: false };
if (outputDir !== dir) {
  project.master = resolve(dir, project.master);
  project.backlog = resolve(dir, project.backlog);
  project.preparation.calibration = resolve(dir, project.preparation.calibration);
  for (const clip of project.clips) {
    clip.manifest = resolve(dir, clip.manifest);
    clip.sheet = resolve(outputDir, clip.sheet);
    if (clip.inheritedRegistration) {
      clip.inheritedRegistration.source = resolve(dir, clip.inheritedRegistration.source);
      clip.inheritedRegistration.mask = resolve(dir, clip.inheritedRegistration.mask);
    }
  }
}
writeFileSync(resolve(outputDir, 'project.json'), JSON.stringify(project, null, 2) + '\n', 'utf8');
writeFileSync(
  resolve(outputDir, 'source-preparation.json'),
  JSON.stringify(
    {
      method:
        'public square-cell DPI/key/despill/defringe; original body restored outside recorded AI head masks; green chroma mapped to approved palette without changing alpha',
      alphaRepresentation: {
        slicedFrames: 'straight',
        maskAndMatteProcessing: 'straight',
        pngEncoding: 'toPremultiplied exactly once before encodePng',
      },
      noIndividualFrameRescale: true,
      masterSha256: hash(resolve(root, 'reference/NE.master.png')),
      records,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(`Prepared ${records.length} transparent source sheets; original registration and matte alpha verified`);
