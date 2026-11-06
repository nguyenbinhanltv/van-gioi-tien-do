/**
 * `npm run rig:assemble -w @vgtd/rig -- --parts <dir> [--dir E] [--out <dir>] [--allow-errors]`
 *
 * Assemble a continuous-limb direction (D39) from painted parts and export it for the viewer:
 *   <parts>/<dir>/<piece>.png   full-canvas 256x256 RGBA parts (see docs/art/rig-continuous-parts.md)
 *   <parts>/<dir>/landmarks.json
 * Writes <out>/kiemtu_<dir>_{ske,tex}.json + kiemtu_<dir>_tex.png (default out: the kiem-tu-continuous viewer folder) and
 * prints the assembly report (used / missing / skipped parts, bone, slot, vertex and chain counts, QA errors per clip).
 * The old Kiếm tu rig supplies roles, IK, sockets and (until the new sword is painted) the sword art.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import type { Direction } from '@vgtd/shared';
import {
  assembleContinuous,
  authorKiemTuSet,
  buildCharacterPackage,
  createImage,
  decodePng,
  encodePng,
  formatQaReports,
  loadCharacterData,
  validateRig,
  type Landmarks,
  type MeshAttachment,
} from '../src/index.js';

const repoRoot = resolve(dirname(process.argv[1]!), '../../..');
const args = process.argv.slice(2);
const opt = (name: string, def = '') => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] && !args[i + 1]!.startsWith('--') ? args[i + 1]! : def;
};
const partsRoot = opt('parts');
if (!partsRoot) throw new Error('usage: --parts <dir> [--dir E] [--out <dir>] [--allow-errors]');
const dir = opt('dir', 'E') as Direction;
const out = resolve(repoRoot, opt('out', 'apps/client-cocos/assets/resources/dragonbones/kiem-tu-continuous'));
const partsDir = resolve(partsRoot, dir);
const view = { scale: 2, pivot: [64, 116] as const };

const data = loadCharacterData(repoRoot, 'kiem-tu');
const old = data.byDirection.get(dir)!;
const landmarks = JSON.parse(readFileSync(join(partsDir, 'landmarks.json'), 'utf8')) as Landmarks;
const parts = new Map<string, ReturnType<typeof decodePng>>();
for (const f of readdirSync(partsDir)) {
  if (!f.endsWith('.png')) continue;
  const img = decodePng(readFileSync(join(partsDir, f)), { premultiplied: true });
  if (img.width !== 256 || img.height !== 256)
    throw new Error(`${f}: expected a 256x256 canvas, got ${img.width}x${img.height}`);
  parts.set(f.replace(/\.png$/, ''), img);
}

// sword borrowed from the old atlas: crop its quad and re-express the uvs against the crop
const oldImg = decodePng(readFileSync(old.texturePath), { premultiplied: old.atlas.premultipliedAlpha });
const weaponAtt = old.rig.skins[0]!.attachments.weapon_R?.weapon_R as MeshAttachment | undefined;
const weapon = (() => {
  if (!weaponAtt) return undefined;
  const page = old.atlas.regions[0]!;
  const us = weaponAtt.uvs.filter((_, i) => i % 2 === 0);
  const vs = weaponAtt.uvs.filter((_, i) => i % 2 === 1);
  const x0 = Math.max(0, Math.floor(page.x + Math.min(...us) * page.width) - 2);
  const y0 = Math.max(0, Math.floor(page.y + Math.min(...vs) * page.height) - 2);
  const x1 = Math.min(oldImg.width, Math.ceil(page.x + Math.max(...us) * page.width) + 2);
  const y1 = Math.min(oldImg.height, Math.ceil(page.y + Math.max(...vs) * page.height) + 2);
  const crop = createImage(x1 - x0, y1 - y0);
  for (let y = 0; y < crop.height; y++)
    for (let x = 0; x < crop.width; x++)
      for (let k = 0; k < 4; k++)
        crop.data[(y * crop.width + x) * 4 + k] = oldImg.data[((y0 + y) * oldImg.width + x0 + x) * 4 + k]!;
  const uvs = weaponAtt.uvs.map((v, i) =>
    i % 2 === 0 ? (page.x + v * page.width - x0) / crop.width : (page.y + v * page.height - y0) / crop.height,
  );
  return { attachment: { ...weaponAtt, uvs }, crop };
})();

const res = assembleContinuous({
  base: old.rig,
  landmarks,
  view,
  parts,
  ...(weapon ? { weapon } : {}),
  atlasName: `kiemtu_${dir}`,
});
console.log(`parts: ${res.used.length} used, ${res.missing.length} missing, ${res.skipped.length} skipped`);
if (res.missing.length) console.log(`  missing: ${res.missing.join(', ')}`);
for (const s of res.skipped) console.log(`  skipped: ${s}`);
console.log(`rig: ${JSON.stringify(res.stats)}  atlas ${res.atlas.data.width}x${res.atlas.data.height}`);
const perPiece = Object.entries(res.rig.skins[0]!.attachments)
  .flatMap(([, m]) => Object.entries(m).map(([n, a]) => [n, a.type === 'mesh' ? a.vertices.length / 2 : 4] as const))
  .sort((a, b) => b[1] - a[1]);
console.log(`vertices per piece: ${perPiece.map(([n, v]) => `${n} ${v}`).join(', ')}`);
const issues = validateRig(res.rig).filter((i) => i.severity === 'error');
for (const i of issues.slice(0, 20)) console.log(`  rig error ${i.path}: ${i.message}`);

const clips = authorKiemTuSet(res.rig, { detail: true });
const name = `kiemtu_${dir}`;
let pkg;
try {
  pkg = buildCharacterPackage([{ rig: res.rig, clips }], res.atlas.data, {
    name,
    armatureName: () => name,
    qa: { weapon: 'one' },
    allowErrors: args.includes('--allow-errors'),
  });
} catch (e) {
  console.log(
    String((e as Error).message)
      .split('\n')
      .slice(0, 40)
      .join('\n'),
  );
  console.log('\nexport blocked by QA errors (use --allow-errors to export anyway)');
  process.exit(1);
}
const bad = pkg.reports.filter((r) => r.errors > 0);
if (bad.length) console.log(formatQaReports(bad).split('\n').slice(0, 40).join('\n'));
mkdirSync(out, { recursive: true });
writeFileSync(join(out, `${name}_ske.json`), JSON.stringify(pkg.export.ske));
writeFileSync(join(out, `${name}_tex.json`), JSON.stringify(pkg.export.tex));
writeFileSync(join(out, `${name}_tex.png`), encodePng(res.atlas.image));
console.log(`exported ${existsSync(out) ? out : ''}: ${clips.length} clips, ${bad.length} clips with QA errors`);
