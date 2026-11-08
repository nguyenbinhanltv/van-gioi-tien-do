/** Rebuild retained AI region selections into a fresh working directory; never repaint or overwrite source art. */
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import {
  CELL_PX,
  normalizeSheetDpi,
  paletteFromMaster,
  resampleAffine,
  sliceSheet,
  toPremultiplied,
} from '@vgtd/sprite';

type Rect = { left: number; top: number; right: number; bottom: number };
interface Recipe {
  name: string;
  mode: 'native' | 'cell' | 'mask';
  source: string;
  sourceSha256: string;
  edit: string;
  editSha256: string;
  proof: string;
  output: string;
  expectedSha256: string;
  mask?: string;
  maskSha256?: string;
}
const root = resolve(process.argv[2] ?? '');
const out = resolve(process.argv[3] ?? '');
if (!process.argv[2] || !process.argv[3] || out.startsWith(root))
  throw new Error('usage: reproduce-region-edits.ts <E-source-directory> <fresh-temp-output-directory>');
mkdirSync(out, { recursive: true });
const hash = (b: Uint8Array) => createHash('sha256').update(b).digest('hex');
const input = (file: string, expected?: string) => {
  const bytes = readFileSync(join(root, file));
  if (expected && hash(bytes) !== expected) throw new Error(`Input SHA256 changed: ${file}`);
  return bytes;
};
const recipes = JSON.parse(readFileSync(join(root, 'repair-recipes.json'), 'utf8')).recipes as Recipe[];
const palette = paletteFromMaster(decodePng(readFileSync(join(root, '../reference/E.master.png'))));
const reports = [];
for (const recipe of recipes) {
  const sourceBytes = input(recipe.source, recipe.sourceSha256);
  const source = decodePng(sourceBytes);
  const edited = decodePng(input(recipe.edit, recipe.editSha256));
  const proof = JSON.parse(readFileSync(join(root, recipe.proof), 'utf8'));
  const image = createImage(source.width, source.height);
  image.data.set(source.data);
  const selected = new Uint8Array(source.width * source.height);
  const copyRect = (rect: Rect, edit: typeof edited, ox = 0, oy = 0) => {
    for (let y = rect.top; y < rect.bottom; y++)
      for (let x = rect.left; x < rect.right; x++) {
        const a = (y * edit.width + x) * 4;
        const b = ((oy + y) * image.width + ox + x) * 4;
        image.data.set(edit.data.subarray(a, a + 4), b);
        selected[b / 4] = 1;
      }
  };
  if (recipe.mode === 'native') {
    if (source.width !== edited.width || source.height !== edited.height) throw new Error('Native DPI changed');
    for (const region of proof.regions as { native: Rect }[]) copyRect(region.native, edited);
  } else {
    const grid = recipe.mode === 'mask' ? normalizeSheetDpi(edited, 4, 16, { resample: 'lanczos3' }).image : edited;
    const cells = sliceSheet(
      grid,
      { cols: 4, rows: 4, frames: 16 },
      {
        inset: 0,
        key: 'auto',
        spill: { palette, asymmetric: { maxImbalance: 80, edgeRadius: 2 } },
      },
    );
    const mask = recipe.mask ? decodePng(input(recipe.mask, recipe.maskSha256)) : null;
    for (let i = 0; i < 16; i++) {
      const cell = toPremultiplied(cells[i]!.image);
      const normalized =
        recipe.mode === 'mask'
          ? cell
          : resampleAffine(
              cell,
              CELL_PX,
              CELL_PX,
              {
                scaleX: CELL_PX / cell.width,
                scaleY: CELL_PX / cell.height,
                dx: 0,
                dy: 0,
              },
              'lanczos3',
            );
      const ox = (i % 4) * CELL_PX,
        oy = Math.floor(i / 4) * CELL_PX;
      if (mask) {
        for (let y = 0; y < CELL_PX; y++)
          for (let x = 0; x < CELL_PX; x++) {
            const b = ((oy + y) * image.width + ox + x) * 4;
            if (mask.data[b] !== 255) continue;
            const a = (y * CELL_PX + x) * 4;
            image.data.set(normalized.data.subarray(a, a + 4), b);
            selected[b / 4] = 1;
          }
      } else {
        const region = (proof.records as { cell: number; region: Rect | null }[]).find((r) => r.cell === i)?.region;
        if (region) copyRect(region, normalized, ox, oy);
      }
    }
  }
  const bytes = encodePng(image);
  if (hash(bytes) !== recipe.expectedSha256) throw new Error(`Derivative output changed: ${recipe.name}`);
  const before = decodePng(sourceBytes, { premultiplied: true });
  const after = decodePng(bytes, { premultiplied: true });
  let outsideRGBAChanges = 0;
  for (let p = 0; p < selected.length; p++)
    if (!selected[p]) {
      const a = p * 4;
      if (before.data.subarray(a, a + 4).some((v, c) => v !== after.data[a + c])) outsideRGBAChanges++;
    }
  if (outsideRGBAChanges) throw new Error(`Outside-region RGBA changed: ${recipe.name}`);
  writeFileSync(join(out, basename(recipe.output)), bytes);
  reports.push({ name: recipe.name, sha256: hash(bytes), outsideRGBAChanges });
}
writeFileSync(join(out, 'verification.json'), JSON.stringify({ recipes: reports }, null, 2) + '\n', 'utf8');
console.log(`Verified ${reports.length} derivative hashes and zero outside-region RGBA changes.`);
