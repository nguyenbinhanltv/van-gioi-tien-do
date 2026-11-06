/**
 * `npm run rig:assemble -w @vgtd/rig -- --parts <dir> [--dir E] [--out <dir>] [--allow-errors]`
 *
 * Assemble a continuous-limb direction (D39) from painted parts and export it for the viewer:
 *   <parts>/<dir>/<piece>.png   full-canvas 256x256 RGBA parts (see docs/art/rig-continuous-parts.md)
 *   <parts>/<dir>/landmarks.json
 * Writes <out>/<stem>_<dir>_{ske,tex}.json + <stem>_<dir>_tex.png (default out: a temp dir; pass `--out apps/client-cocos/assets/resources/dragonbones/kiem-tu-continuous` to view it with `npm run capture`, and do not commit that folder before the pilot is accepted) and
 * prints the assembly report (used / missing / skipped parts, bone, slot, vertex and chain counts, QA errors per clip).
 * --keyposes <dir> [--iou 0.85] [--rms 2]  fit run/walk/... clips to reference key poses (<dir>/<DIR>/<clip>_<NN>_<label>.png +
 * .landmarks.json), print fit error + silhouette IoU per key and write keypose_<clip>_compare.png sheets.
 * --class <id>  kiem-tu (default) | the-tu: the class assembly profile (`class-profile.ts`: its parts, bones to drop, detail rules,
 * clips; Thể tu has no sword, its gauntlets are displays on the hand slots, stem `thetu`).
 * --stem <name>  file stem (default kiemtu), to put several variants in one viewer folder.
 * --gait robe|free  gait of run / walk / dash (default robe: half stride = two step pairs per clip at the real ground speed,
 * shallow knee, low foot lift, for a long robe; free = the original gait). The cadence is baked into the clip: the authored
 * speed is the real speed, nothing depends on a runtime timeScale.
 * The old Kiếm tu rig supplies roles, IK, sockets and (until the new sword is painted) the sword art.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { Direction } from '@vgtd/shared';
import {
  ATLAS_EXTRUDE,
  GAIT_PROFILES,
  type GaitName,
  ATLAS_PADDING,
  KEYPOSE_LABELS,
  finishedLandmarkRms,
  applyDetail,
  assembleContinuous,
  authorKeyPoseClip,
  bakeSecondaryMotion,
  blit,
  clipSpec,
  evalPose,
  fitPose,
  keyPoseFrames,
  loadedAtlas,
  renderPose,
  maskIoU,
  renderSilhouette,
  silhouetteIoUDetail,
  type Image,
  type KeyPoseLandmarks,
  CHARACTER_IDS,
  authorClassSet,
  getAssemblyProfile,
  type CharacterId,
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
const character = opt('class', 'kiem-tu') as CharacterId;
if (!(CHARACTER_IDS as readonly string[]).includes(character))
  throw new Error(`unknown --class '${character}' (${CHARACTER_IDS.join(', ')})`);
const profile = character === 'kiem-tu' ? undefined : getAssemblyProfile(character);
const stem = opt('stem', profile?.stem ?? 'kiemtu');
// robe: half stride, two step pairs inside the table-length clip at the real ground speed (cadence baked in, no
// runtime timeScale); `free` is the original gait
// default: the class gait of its profile (Thể tu: heavy stomp), robe for Kiếm tu
const gaitName = (opt('gait', '') || (profile ? 'class' : 'robe')) as GaitName | 'class';
if (gaitName !== 'class' && !(gaitName in GAIT_PROFILES))
  throw new Error(`unknown --gait '${gaitName}' (${Object.keys(GAIT_PROFILES).join(', ')})`);
const gait = gaitName === 'class' ? profile!.gait : GAIT_PROFILES[gaitName];
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
const weaponRaw = profile && !profile.borrowsSword ? undefined : old.rig.skins[0]!.attachments.weapon_R?.weapon_R;
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
  base: profile ? { ...old.rig, id: profile.id } : old.rig,
  landmarks,
  view,
  parts,
  ...(weapon ? { weapon } : {}),
  ...(profile
    ? {
        pieces: profile.pieces,
        dropBones: profile.dropBones,
        snapIk: true,
        ...(profile.chains ? { extraChains: profile.chains } : {}),
        ...(profile.ikBend ? { ikBend: profile.ikBend } : {}),
      }
    : {}),
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
let clips = [
  ...(profile
    ? authorClassSet(character, res.rig, { detail: true, gait })
    : authorKiemTuSet(res.rig, { detail: true, gait })),
  ...(blink ? [blink] : []),
];

// --keyposes <dir>: replace the clips that have a full set of reference key poses (<dir>/<DIR>/<clip>_<NN>_<label>.png +
// .landmarks.json) with clips fitted to them; report the silhouette IoU of every key against its reference image
const keyDir = opt('keyposes', '');
const iouMin = Number(opt('iou', '0.85'));
const rmsMax = Number(opt('rms', '2'));
let iouFailures = 0;
if (keyDir) {
  const kdir = resolve(process.env.INIT_CWD ?? process.cwd(), keyDir, dir);
  const atlas = loadedAtlas(res.atlas.data, res.atlas.image);
  const sheets: string[] = [];
  const oldClips = new Map(clips.map((c) => [c.name, c]));
  for (const [clipName, labels] of Object.entries(KEYPOSE_LABELS)) {
    const stems = labels.map((l, i) => `${clipName}_${String(i + 1).padStart(2, '0')}_${l}`);
    if (!stems.every((x) => existsSync(join(kdir, `${x}.landmarks.json`)))) continue;
    const spec = clipSpec(clipName as never);
    const lms = stems.map(
      (x) => JSON.parse(readFileSync(join(kdir, `${x}.landmarks.json`), 'utf8')) as KeyPoseLandmarks,
    );
    const fitsRaw = lms.map((lm) => fitPose(res.rig, lm, view));
    // phases / events from the animation-table gait (free), whatever --gait says: the key poses carry their own stride
    // (a class takes the phases of its own strikes: its clip table, not the Kiếm tu one)
    const tableOpts = { only: [clipName as never], secondary: false, gait: GAIT_PROFILES.free };
    const table = (profile ? authorClassSet(character, res.rig, tableOpts) : authorKiemTuSet(res.rig, tableOpts))[0];
    const outFits: { fits?: typeof fitsRaw; impliedSpeedPxS?: number | null; tableSpeedPxS?: number | null } = {};
    const base = authorKeyPoseClip(
      res.rig,
      clipName,
      fitsRaw,
      spec.frames,
      spec.loop,
      table?.phases,
      table?.events,
      outFits,
    );
    const fits = outFits.fits ?? fitsRaw;
    // the class's detail rules (Thể tu gauntlet / face swaps), not the Kiếm tu defaults
    const finished = applyDetail(
      res.rig,
      bakeSecondaryMotion(res.rig, { ...base, phases: table?.phases ?? {} }),
      profile?.detail,
    );
    const at = keyPoseFrames(clipName, spec.frames, table?.phases, table?.events);
    if (outFits.tableSpeedPxS) {
      const implied = outFits.impliedSpeedPxS ?? 0;
      console.log(
        `  ground speed: the drawings imply ${implied.toFixed(0)} px/s, the table moves the character at ${outFits.tableSpeedPxS.toFixed(0)} px/s: contacts locked to the table speed (key poses shifted along the facing)${implied && Math.abs(implied / outFits.tableSpeedPxS - 1) > 0.5 ? '  WARNING: the drawn stride differs from the table speed by more than 50 %' : ''}`,
      );
    }
    console.log(`
key poses ${clipName}: ${labels.length} keys, frames ${at.join(',')}`);
    const row: { ref: Image; old: Image; now: Image; diff: Image }[] = [];
    stems.forEach((x, i) => {
      const refPath = join(kdir, `${x}.png`);
      const ref = existsSync(refPath) ? decodePng(readFileSync(refPath)) : null;
      const fit = fits[i]!;
      // the whole-body move of the fit (pelvis lowering + contact lock): the reference is translated by it before comparing
      const total = { x: fit.shift.x + fit.lockShift.x, y: fit.shift.y + fit.lockShift.y };
      // bands (image rows @2x): head + arms down to the chest, torso to the hips, skirt and legs
      const detail = ref
        ? silhouetteIoUDetail(res.rig, finished, at[i]!, atlas, ref, {
            shift: total,
            bands: [
              [0, 100],
              [100, 150],
              [150, 256],
            ],
          })
        : { iou: NaN, bands: [] as number[] };
      const iou = detail.iou;
      // diagnostic: the best whole-body translation of the reference (|dx|, |dy| <= 12 px @2x) and the IoU it would give; a
      // large gain means a registration offset (annotation), a small one means real shape differences (hair, cloth)
      let best = { iou: iou, dx: 0, dy: 0 };
      if (ref) {
        const sil = renderSilhouette(res.rig, finished, at[i]!, atlas, 256);
        for (let ddx = -12; ddx <= 12; ddx += 2)
          for (let ddy = -12; ddy <= 12; ddy += 2) {
            const v = maskIoU(sil, ref, 128, Math.round(total.x * 2) + ddx, Math.round(-total.y * 2) + ddy);
            if (v > best.iou) best = { iou: v, dx: ddx, dy: ddy };
          }
      }
      // landmark RMS of the FINISHED clip (after the contact lock, the interpolation between keys, the secondary bake and the
      // detail layer), not just of the fit: at the exact key time (a fraction of a frame) and at the frame that is actually
      // exported (whole frames only). Reference landmarks move with the fit shift (the feet only along the facing).
      const finishedRms = (frame: number) => finishedLandmarkRms(res.rig, lms[i]!, view, finished, frame, fit);
      const rmsExact = finishedRms(at[i]!);
      const rmsExported = finishedRms(Math.round(at[i]!));
      const bad = (ref && iou < iouMin) || rmsExported > rmsMax;
      if (bad) iouFailures++;
      const worst = Object.entries(fit.error)
        .sort((p, q) => q[1] - p[1])
        .slice(0, 3)
        .map(([k, v]) => `${k} ${v.toFixed(1)}`)
        .join(', ');
      console.log(
        `  ${x}: fit RMS ${fit.rms.toFixed(2)} px, FINISHED clip RMS ${rmsExact.toFixed(2)} at the key time / ${rmsExported.toFixed(2)} at the exported frame ${Math.round(at[i]!)} (max ${fit.maxError.toFixed(1)}: ${worst}), IoU ${ref ? iou.toFixed(3) : 'n/a'}${ref ? ` [head ${detail.bands[0]!.toFixed(2)} | torso ${detail.bands[1]!.toFixed(2)} | skirt+legs ${detail.bands[2]!.toFixed(2)}]` : ''}${ref ? `, best shift (${best.dx},${best.dy}) px -> IoU ${best.iou.toFixed(3)}` : ''}${bad ? `  FAIL (IoU >= ${iouMin}, RMS <= ${rmsMax})` : ''}${fit.shift.y ? `, pelvis lowered ${(-fit.shift.y).toFixed(1)} px` : ''}${fit.lengthMismatch.length ? ', length mismatch ' + fit.lengthMismatch.join('/') : ''}`,
      );
      const render = (c: (typeof clips)[number] | undefined, f: number) =>
        renderPose(res.rig, evalPose(res.rig, c ?? null, c ? Math.min(f, c.frames) : 0), atlas, {
          background: [118, 122, 130, 255],
          ground: true,
        });
      // overlay: both = grey, reference only = red, rig only = blue (the reference moved by the fit shift)
      const diff = createImage(256, 256, [30, 30, 36, 255]);
      if (ref) {
        const sil = renderSilhouette(res.rig, finished, at[i]!, atlas, 256);
        const dx = Math.round(total.x * 2);
        const dy = Math.round(-total.y * 2);
        for (let y = 0; y < 256; y++)
          for (let x = 0; x < 256; x++) {
            const a = sil.data[(y * 256 + x) * 4 + 3]! >= 128;
            const sx = x - dx;
            const sy = y - dy;
            const b = sx >= 0 && sy >= 0 && sx < 256 && sy < 256 && ref.data[(sy * 256 + sx) * 4 + 3]! >= 128;
            const o = (y * 256 + x) * 4;
            const c = a && b ? [170, 170, 170] : b ? [230, 70, 70] : a ? [70, 110, 235] : null;
            if (c) {
              diff.data[o] = c[0]!;
              diff.data[o + 1] = c[1]!;
              diff.data[o + 2] = c[2]!;
            }
          }
      }
      row.push({
        ref: ref ?? createImage(256, 256),
        old: render(oldClips.get(clipName), at[i]!),
        now: render(finished, at[i]!),
        diff,
      });
    });
    // reference | old rig | key-pose rig, one column per key
    const sheet = createImage(256 * row.length, 256 * 4, [118, 122, 130, 255]);
    row.forEach((r, i) => {
      blit(sheet, r.ref, i * 256, 0);
      blit(sheet, r.old, i * 256, 256);
      blit(sheet, r.now, i * 256, 512);
      blit(sheet, r.diff, i * 256, 768);
    });
    mkdirSync(out, { recursive: true });
    const file = join(out, `keypose_${clipName}_compare.png`);
    writeFileSync(file, encodePng(sheet));
    sheets.push(file);
    clips = clips.map((c) => (c.name === clipName ? finished : c));
  }
  console.log(
    sheets.length
      ? `
comparison sheets (rows: reference / old rig / key-pose rig / overlay: grey both, red reference only, blue rig only): ${sheets.join(', ')}`
      : `
no complete key-pose set found in ${kdir}`,
  );
}
if (iouFailures && !args.includes('--allow-errors')) {
  console.log(`
${iouFailures} key pose(s) below IoU ${iouMin}: nothing exported (use --allow-errors to export anyway)`);
  process.exit(1);
}
const name = `${stem}_${dir}`;
let pkg;
try {
  pkg = buildCharacterPackage([{ rig: res.rig, clips }], res.atlas.data, {
    name,
    armatureName: () => name,
    qa: { weapon: profile?.qaWeapon ?? 'one' },
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
// the clips exactly as exported (key-pose clips included): `rig:measure --assembled` audits THESE, not a re-authored gait
// the hash of the rig tells `rig:measure` whether the clips still belong to the rig.json next to them
const rigHash = createHash('sha1').update(JSON.stringify(res.rig)).digest('hex').slice(0, 16);
writeFileSync(join(out, `${name}.clips.json`), JSON.stringify({ rigHash, clips }));
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
