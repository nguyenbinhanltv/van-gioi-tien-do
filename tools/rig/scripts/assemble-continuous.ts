/**
 * `npm run rig:assemble -w @vgtd/rig -- --parts <dir> [--dir E] [--out <dir>] [--allow-errors]`
 *
 * Assemble a continuous-limb direction (D39) from painted parts and export it for the viewer:
 *   <parts>/<dir>/<piece>.png   full-canvas 256x256 RGBA parts (see docs/art/rig-continuous-parts.md)
 *   <parts>/<dir>/landmarks.json
 * Writes <out>/kiemtu_<dir>_{ske,tex}.json + kiemtu_<dir>_tex.png (default out: a temp dir; pass `--out apps/client-cocos/assets/resources/dragonbones/kiem-tu-continuous` to view it with `npm run capture`, and do not commit that folder before the pilot is accepted) and
 * prints the assembly report (used / missing / skipped parts, bone, slot, vertex and chain counts, QA errors per clip).
 * --stem <name>  file stem (default kiemtu), to put several variants in one viewer folder.
 * --gait robe|free  gait of run / walk / dash (default robe: half stride = two step pairs per clip at the real ground speed,
 * shallow knee, low foot lift, for a long robe; free = the original gait). The cadence is baked into the clip: the authored
 * speed is the real speed, nothing depends on a runtime timeScale.
 * The old Kiếm tu rig supplies roles, IK, sockets and (until the new sword is painted) the sword art.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Direction } from '@vgtd/shared';
import {
  ATLAS_EXTRUDE,
  GAIT_PROFILES,
  type GaitName,
  ATLAS_PADDING,
  assembleContinuous,
  authorBlinkCycle,
  authorKiemTuSet,
  buildCharacterPackage,
  createImage,
  decodePng,
  encodePng,
  nonPremultipliedPixels,
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
const stem = opt('stem', 'kiemtu');
// robe: half stride, two step pairs inside the table-length clip at the real ground speed (cadence baked in, no
// runtime timeScale); `free` is the original gait
const gaitName = opt('gait', 'robe') as GaitName;
if (!(gaitName in GAIT_PROFILES))
  throw new Error(`unknown --gait '${gaitName}' (${Object.keys(GAIT_PROFILES).join(', ')})`);
const outArg = opt('out', '');
const out = outArg ? resolve(process.env.INIT_CWD ?? process.cwd(), outArg) : join(tmpdir(), 'vgtd-assemble', dir);
// relative paths are relative to where `npm run` was started, not to tools/rig (npm changes the cwd)
const partsDir = resolve(process.env.INIT_CWD ?? process.cwd(), partsRoot, dir);
const view = { scale: 2, pivot: [64, 116] as const };

const data = loadCharacterData(repoRoot, 'kiem-tu');
const old = data.byDirection.get(dir)!;
const landmarks = JSON.parse(readFileSync(join(partsDir, 'landmarks.json'), 'utf8')) as Landmarks;
// source parts are STRAIGHT-alpha PNGs: decodePng multiplies them (the old atlas below is already premultiplied)
const parts = new Map<string, ReturnType<typeof decodePng>>();
for (const f of readdirSync(partsDir)) {
  if (!f.endsWith('.png')) continue;
  const img = decodePng(readFileSync(join(partsDir, f)));
  if (img.width !== 256 || img.height !== 256)
    throw new Error(`${f}: expected a 256x256 canvas, got ${img.width}x${img.height}`);
  parts.set(f.replace(/\.png$/, ''), img);
}

// sword borrowed from the old atlas: crop its quad and re-express the uvs against the crop
const oldImg = decodePng(readFileSync(old.texturePath), { premultiplied: old.atlas.premultipliedAlpha });
const weaponRaw = old.rig.skins[0]!.attachments.weapon_R?.weapon_R;
const weaponAtt: MeshAttachment | undefined = weaponRaw?.type === 'mesh' ? weaponRaw : undefined;
const weapon = (() => {
  if (!weaponAtt) return undefined;
  const page = old.atlas.regions.find((r) => r.name === weaponAtt.path);
  if (!page) throw new Error(`weapon_R refers to atlas region '${weaponAtt.path}' which the old atlas does not have`);
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
  atlasName: `${stem}_${dir}`,
});
console.log(`parts: ${res.used.length} used, ${res.missing.length} missing, ${res.skipped.length} skipped`);
if (res.missing.length) console.log(`  missing: ${res.missing.join(', ')}`);
for (const s of res.skipped) console.log(`  skipped: ${s}`);
const st = res.stats;
console.log(
  `rig: ${st.bones}/${st.limits.bones} bones, ${st.slots}/${st.limits.slots} slots, ${st.vertices}/${st.limits.meshVertices} mesh vertices (mesh scale ${st.meshScale}), ${st.chains}/${st.limits.chains} chains; atlas ${res.atlas.data.width}x${res.atlas.data.height}`,
);
const perPiece = Object.entries(res.rig.skins[0]!.attachments)
  .flatMap(([, m]) => Object.entries(m).map(([n, a]) => [n, a.type === 'mesh' ? a.vertices.length / 2 : 4] as const))
  .sort((a, b) => b[1] - a[1]);
console.log(`vertices per piece: ${perPiece.map(([n, v]) => `${n} ${v}`).join(', ')}`);
console.log(`atlas premultiplied check: ${st.nonPremultiplied} pixels with colour above alpha`);
const issues = validateRig(res.rig).filter((i) => i.severity === 'error');
for (const i of issues.slice(0, 20)) console.log(`  rig error ${i.path}: ${i.message}`);
if (st.nonPremultiplied > 0)
  issues.push({
    path: '/atlas',
    message: `${st.nonPremultiplied} atlas pixels have colour above alpha (wrong premultiply)`,
    severity: 'error',
  } as (typeof issues)[number]);
if (issues.length) {
  console.log('\nrig is invalid: nothing exported');
  process.exit(1);
}

const blink = authorBlinkCycle(res.rig);
const clips = [...authorKiemTuSet(res.rig, { detail: true, gait: GAIT_PROFILES[gaitName] }), ...(blink ? [blink] : [])];
const name = `${stem}_${dir}`;
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
// the tex file says premultipliedAlpha: true, so the PNG must hold the premultiplied colour (encodePng un-premultiplies
// by default); verify the bytes that were written, not the in-memory image
const atlasPng = encodePng(res.atlas.image, { premultiplied: true });
const written = decodePng(atlasPng, { premultiplied: true });
const badPixels = nonPremultipliedPixels(written);
const same = written.data.every((v, i) => v === res.atlas.image.data[i]);
if (badPixels > 0 || !same)
  throw new Error(`atlas PNG does not round-trip as premultiplied (${badPixels} pixels with colour above alpha)`);
writeFileSync(join(out, `${name}_tex.png`), atlasPng);
console.log(
  `atlas PNG check (encoded bytes, read back as premultiplied): ${badPixels} pixels with colour above alpha, identical to the packed page`,
);
// the assembled rig and atlas description, so `rig:measure --assembled` / `rig:gate --assembled` check THIS data
writeFileSync(join(out, `${name}.rig.json`), JSON.stringify(res.rig));
writeFileSync(join(out, `${name}.atlas.json`), JSON.stringify(res.atlas.data));
writeFileSync(
  join(out, `${name}.assembly.json`),
  JSON.stringify(
    {
      direction: dir,
      packing: {
        padding: ATLAS_PADDING,
        extrude: ATLAS_EXTRUDE,
        premultipliedAlpha: true,
        page: [res.atlas.data.width, res.atlas.data.height],
      },
      gait: gaitName,
      // runtime rule for locomotion clips: timeScale = movement speed (px/s) / authoredSpeedPxS
      clips: clips.map((c) => ({
        name: c.name,
        frames: c.frames,
        loop: c.loop,
        seconds: Math.round((c.frames / 30) * 1000) / 1000,
        authoredSpeedPxS: c.motion?.speed ?? null,
      })),
      nonPremultipliedPixels: st.nonPremultiplied,
      stats: st,
      used: res.used,
      missing: res.missing,
      skipped: res.skipped,
    },
    null,
    2,
  ),
);
console.log(`exported ${existsSync(out) ? out : ''}: ${clips.length} clips, ${bad.length} clips with QA errors`);
