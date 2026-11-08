/** Fixed-scale master-cap stencils are AI input guides, never QA evidence or final sprite pixels. */
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createImage, decodePng, encodePng } from '@vgtd/rig';
import { CELL_PX, crop, resizeImage } from '@vgtd/sprite';

const dir = resolve('assets-src/placeholder/phap-tu-chibi-v1/NE/templates');
const opt = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i < 0 ? undefined : process.argv[i + 1];
};
const planPath = resolve(opt('plan') ?? resolve(dir, 'run.edit-head-stencil.json'));
const plan = JSON.parse(readFileSync(planPath, 'utf8'));
const sourcePath = resolve(dir, plan.source),
  masterPath = resolve(dir, plan.master);
const source = decodePng(readFileSync(sourcePath)),
  master = decodePng(readFileSync(masterPath));
const cropBox = plan.masterCrop;
const stencil = resizeImage(
  crop(master, cropBox.x, cropBox.y, cropBox.width, cropBox.height),
  Math.round(cropBox.width / plan.fixedGlobalScale),
  Math.round(cropBox.height / plan.fixedGlobalScale),
);
const sheet = createImage(source.width, source.height, [255, 0, 255, 255]);
for (let p = 0; p < source.width * source.height; p++) {
  const o = p * 4,
    a = source.data[o + 3]! / 255;
  for (let c = 0; c < 3; c++) sheet.data[o + c] = source.data[o + c]! + sheet.data[o + c]! * (1 - a);
}
for (const cell of plan.cells) {
  const ox = (cell.cell % 4) * CELL_PX,
    oy = Math.floor(cell.cell / 4) * CELL_PX;
  const sourceCrownX = (cell.targetAlignedCrown.x - cell.registration.dx) / plan.fixedGlobalScale + plan.inset;
  const sourceCrownY = (cell.targetAlignedCrown.y - cell.registration.dy) / plan.fixedGlobalScale + plan.inset;
  const oldCrownY = (cell.previousAlignedCrownY - cell.registration.dy) / plan.fixedGlobalScale + plan.inset;
  // Clear only the input guide's skull core; streaming secondary hair remains as motion context.
  for (
    let y = Math.floor(Math.min(oldCrownY, sourceCrownY) - 3);
    y < Math.ceil(Math.max(oldCrownY, sourceCrownY) + 40 / plan.fixedGlobalScale);
    y++
  )
    for (
      let x = Math.floor(sourceCrownX - 36 / plan.fixedGlobalScale);
      x < Math.ceil(sourceCrownX + 34 / plan.fixedGlobalScale);
      x++
    ) {
      if (x < 0 || x >= CELL_PX || y < 0 || y >= CELL_PX) throw Error('Guide skull mask outside cell');
      const o = ((oy + y) * sheet.width + ox + x) * 4;
      sheet.data.set([255, 0, 255, 255], o);
    }
  const x0 = Math.round(sourceCrownX - (plan.masterCrown.x - cropBox.x) / plan.fixedGlobalScale);
  const y0 = Math.round(sourceCrownY - (plan.masterCrown.y - cropBox.y) / plan.fixedGlobalScale);
  for (let y = 0; y < stencil.height; y++)
    for (let x = 0; x < stencil.width; x++) {
      const p = (y * stencil.width + x) * 4,
        a = stencil.data[p + 3]! / 255;
      const o = ((oy + y0 + y) * sheet.width + ox + x0 + x) * 4;
      for (let c = 0; c < 3; c++) sheet.data[o + c] = stencil.data[p + c]! + sheet.data[o + c]! * (1 - a);
    }
}
const out = resolve(opt('out') ?? resolve(dir, 'run.edit-head-stencil.png'));
writeFileSync(out, encodePng(sheet));
const hash = (file: string) => createHash('sha256').update(readFileSync(file)).digest('hex');
writeFileSync(
  out.replace(/\.png$/, '.provenance.json'),
  JSON.stringify(
    {
      purpose: plan.purpose,
      tool: '@vgtd/rig + @vgtd/sprite deterministic guide compositor',
      model: 'not applicable',
      utc: new Date().toISOString(),
      command: [
        'node tools/rig/scripts/run-ts.mjs assets-src/placeholder/phap-tu-chibi-v1/prepare-NE-head-edit.ts',
        ...process.argv.slice(2),
      ].join(' '),
      sourceSha256: hash(sourcePath),
      masterSha256: hash(masterPath),
      planSha256: hash(planPath),
      outputSha256: hash(out),
      fixedStencilScale: 1 / plan.fixedGlobalScale,
      noIndividualFrameRescale: true,
    },
    null,
    2,
  ) + '\n',
  'utf8',
);
console.log(out);
