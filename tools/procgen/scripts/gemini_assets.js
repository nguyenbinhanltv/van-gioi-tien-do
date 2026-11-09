#!/usr/bin/env node
'use strict';
/**
 * Owner-provided Gemini exports (assets-src/gemini/{props,items}) -> game sprites + atlases.
 *   node scripts/gemini_assets.js [--src <dir>] [--out <dir>] [--force] [--allow-missing]
 *
 * Output (default out/gemini, git-ignored, regenerated; skipped when the stamp of sources + tool is unchanged;
 * the INTERIM mob standees are packed into the same atlas pages as the props):
 *   props_2x/ props_1x/ icons_2x/ icons_1x/   processed single PNGs (magenta keyed, sparkle removed, trimmed)
 *   status_* realms_* particles_*             PART 2: status icons (4x3 grid), realm badges (3x3), particle textures (luminance -> alpha)
 *   keyart/                                   PART 2: login backdrop + emblem (single textures, not atlased)
 *   atlas/atl_prop_2x_0.png ... + .json       packed with pipeline/pack_atlas.js (padding + extrude), fed to the budget gate
 *   gemini.json                               sidecar: per prop pivot / blocked tiles / biomes / frames; per icon frames
 *
 * Exit codes: 0 ok (or skipped with --allow-missing when sources are absent / Git LFS pointers) · 3 sources missing ·
 * 4 a verification failed (sparkle not found / still present, empty sprite).
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');
const { decodePNG } = require('../src/lib/png');
const G = require('../src/gemini/process');
const { GRID_PATHS, classGrids } = require('../src/gemini/skills');
const Ground = require('../src/gemini/ground');
const skillsJson = require('../../../packages/shared/src/data/skills.json');
const manifest = require('../src/gemini/manifest.json');

const args = process.argv.slice(2);
const opt = (n, d) => {
  const i = args.indexOf('--' + n);
  return i >= 0 ? args[i + 1] : d;
};
const flag = (n) => args.includes('--' + n);
const root = path.resolve(__dirname, '..');
const SRC = path.resolve(opt('src', path.join(root, '../../assets-src/gemini')));
const CONCEPTS = path.resolve(opt('concepts', path.join(root, '../../assets-src/concepts')));
const OUT = path.resolve(opt('out', path.join(root, 'out/gemini')));

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
// a prop's source file is props/<key> unless the manifest names another one (props2 replacements: `src`)
const propSrc = (n) => manifest.props[n].src || `props/${n}`;
const files = [
  ...Object.keys(manifest.props).map((n) => propSrc(n).split('/')),
  ...[manifest.status.file, manifest.realms.file, manifest.keyArt.backdrop.file, manifest.keyArt.emblem.file].map((f) =>
    f.split('/'),
  ),
  ...manifest.particles.names.map((n) => ['particles', n]),
  ...manifest.vfx.classes.map((c) => ['vfx', c]),
  ...manifest.icons.map((n) => ['items', n]),
  ...manifest.itemGrids.map((g) => g.file.split('/')),
  manifest.hud.file.split('/'),
  ...GRID_PATHS.map((n) => ['skills', n]),
  ...Object.keys(manifest.mobs).map((n) => ['mobs', n]),
  ...Object.keys(manifest.npcs)
    .filter((n) => !n.startsWith('_'))
    .map((n) => ['npcs', n]),
  ...Object.keys(manifest.mobsPhase)
    .filter((n) => !n.startsWith('_'))
    .map((n) => ['mobs_phase', n]),
  ...manifest.ground.materials.map((n) => ['ground', n]),
  ...Object.keys(manifest.ui)
    .filter((n) => !n.startsWith('_'))
    .map((n) => ['ui', n]),
];
const srcPath = (dir, name) =>
  dir === 'mobs' || dir === 'mobs_phase' || dir === 'npcs'
    ? path.join(CONCEPTS, dir, `${name}.png`)
    : path.join(SRC, dir, `${name}.png`);

function loadSources() {
  const missing = [];
  const bufs = new Map();
  for (const [dir, name] of files) {
    const f = srcPath(dir, name);
    if (!fs.existsSync(f)) {
      missing.push(`${dir}/${name}.png (missing)`);
      continue;
    }
    const b = fs.readFileSync(f);
    if (!isPng(b)) {
      missing.push(`${dir}/${name}.png (not a PNG: Git LFS pointer? run git lfs pull)`);
      continue;
    }
    bufs.set(`${dir}/${name}`, b);
  }
  return { missing, bufs };
}

function stampOf(bufs) {
  const h = crypto.createHash('sha1');
  for (const k of [...bufs.keys()].sort()) {
    h.update(k);
    h.update(bufs.get(k));
  }
  for (const f of [
    '../src/gemini/process.js',
    '../src/gemini/manifest.json',
    '../src/gemini/skills.js',
    '../src/gemini/ground.js',
    '../../../packages/shared/src/data/skills.json',
    __filename,
    '../pipeline/pack_atlas.js',
    '../src/lib/png.js',
  ]) {
    h.update(fs.readFileSync(path.resolve(__dirname, f)));
  }
  return h.digest('hex');
}

function pack(dir, name) {
  const r = spawnSync(
    process.execPath,
    [
      path.join(root, 'pipeline/pack_atlas.js'),
      '--in',
      path.join(OUT, dir),
      '--out',
      path.join(OUT, 'atlas'),
      '--name',
      name,
      '--padding',
      '2',
      '--extrude',
      '2',
    ],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`pack_atlas failed for ${name}`);
  return JSON.parse(fs.readFileSync(path.join(OUT, 'atlas', `${name}.json`), 'utf8'));
}

function main() {
  const { missing, bufs } = loadSources();
  if (missing.length) {
    const msg = `gemini sources unavailable:\n  ${missing.join('\n  ')}`;
    if (flag('allow-missing')) {
      console.warn(`⚠ ${msg}\n  (skipped: --allow-missing)`);
      return 0;
    }
    console.error(`✖ ${msg}`);
    return 3;
  }
  const stamp = stampOf(bufs);
  const stampFile = path.join(OUT, '.stamp');
  if (
    !flag('force') &&
    fs.existsSync(stampFile) &&
    fs.readFileSync(stampFile, 'utf8') === stamp &&
    fs.existsSync(path.join(OUT, 'gemini.json'))
  ) {
    console.log(`✔ gemini assets up to date (${OUT})`);
    return 0;
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const d of [
    'props_2x',
    'props_1x',
    'icons_2x',
    'icons_1x',
    'skills_2x',
    'skills_1x',
    'mobs_1x',
    'ground',
    'ui_2x',
    'ui_1x',
    'status_2x',
    'status_1x',
    'realms_2x',
    'realms_1x',
    'particles_2x',
    'particles_1x',
    'hud_2x',
    'hud_1x',
    'keyart',
  ])
    fs.mkdirSync(path.join(OUT, d), { recursive: true });

  const problems = [];
  const sidecar = {
    format: 'vgtd-gemini',
    version: 2,
    props: {},
    icons: {},
    skills: {},
    mobs: {},
    npcs: {},
    mobPhases: {},
    ground: {},
    ui: {},
    status: {},
    realms: {},
    particles: {},
    hud: {},
    keyArt: {},
    atlases: {},
  };
  const verify = (key, srcBuf, sparkle, isBg) => {
    if (sparkle.components < 1)
      problems.push(`${key}: no Gemini sparkle found in the corner (unexpected source layout)`);
    else {
      // re-run on a fresh copy of the source with the mark removed: nothing may be found a second time
      const img = decodePNG(srcBuf);
      const test = isBg || G.bgTest(G.estimateBackground(img));
      G.removeSparkle(img, test);
      if (G.removeSparkle(img, test).components !== 0) problems.push(`${key}: sparkle still present after removal`);
    }
  };

  for (const [name, def] of Object.entries(manifest.props)) {
    const buf = bufs.get(propSrc(name));
    const r = G.processProp(decodePNG(buf), def.target, { clear: def.clear, key: def.key });
    verify(propSrc(name), buf, r.sparkle);
    if (def.pivotX !== undefined) r.pivot.x = def.pivotX;
    // x1only (the sect buildings, PART 3 group N): the @1x pixels go into BOTH pages and are drawn 1:1 (w2 / h2 stay the virtual @2x size,
    // so PropArt.sizeOf gives the same design size in every tier): the @2x prop page is 93% full without them, and a second page would
    // break the L3 batch next to the spawn (draw-call gate 65, docs/33)
    (def.x1only ? r.x1 : r.x2).save(path.join(OUT, 'props_2x', `${name}.png`));
    r.x1.save(path.join(OUT, 'props_1x', `${name}.png`));
    sidecar.props[name] = {
      ...(def.x1only ? { x1only: true } : {}),
      w2: r.x2.width,
      h2: r.x2.height,
      pivot: r.pivot,
      block: def.block,
      biomes: def.biomes,
      weight: def.weight,
      spacing: def.spacing || 1,
      ...(def.zones ? { zones: def.zones } : {}),
    };
    console.log(
      `  props/${name}: ${r.x2.width}x${r.x2.height} @2x, pivot ${r.pivot.x},${r.pivot.y}, sparkle ${r.sparkle.pixels}px`,
    );
  }
  for (const name of manifest.icons) {
    const buf = bufs.get(`items/${name}`);
    const r = G.processIcon(decodePNG(buf), manifest.iconSize2x);
    verify(`items/${name}`, buf, r.sparkle);
    r.x2.save(path.join(OUT, 'icons_2x', `${name}.png`));
    r.x1.save(path.join(OUT, 'icons_1x', `${name}.png`));
    sidecar.icons[name] = {};
    console.log(`  items/${name}: ${r.x2.width}px @2x, sparkle ${r.sparkle.pixels}px`);
  }
  // PART 3 group O: item icon grids (manual tiers, alchemy herbs / pills / token): sliced into the same icon atlas, keyed by id
  for (const g of manifest.itemGrids) {
    const buf = bufs.get(g.file);
    const r = G.sliceGrid(decodePNG(buf), manifest.iconSize2x, g.cols, g.rows, {
      fit: 'contain',
      pad: g.pad,
      unmixStar: g.unmixStar,
      key: g.key,
    });
    verify(g.file, buf, r.sparkle);
    if (g.ids.length !== g.cols * g.rows)
      problems.push(`${g.file}: ${g.ids.length} ids for a ${g.cols}x${g.rows} grid`);
    g.ids.forEach((id, k) => {
      if (sidecar.icons[id]) problems.push(`${g.file}: icon id ${id} is used twice`);
      r.x2[k].save(path.join(OUT, 'icons_2x', `${id}.png`));
      r.x1[k].save(path.join(OUT, 'icons_1x', `${id}.png`));
      sidecar.icons[id] = { grid: g.file, index: k };
    });
    console.log(`  ${g.file}: ${g.ids.length} item icons, sparkle ${r.sparkle.pixels}px`);
  }
  // PART 3 group P: HUD / social icons (round, on their own backing disc)
  {
    const h = manifest.hud;
    const buf = bufs.get(h.file);
    const r = G.sliceGrid(decodePNG(buf), h.size2, h.cols, h.rows, { fit: 'contain', unmixStar: true, disc: true });
    verify(h.file, buf, r.sparkle);
    if (h.ids.length !== h.cols * h.rows) problems.push(`hud: ${h.ids.length} ids for a ${h.cols}x${h.rows} grid`);
    h.ids.forEach((id, k) => {
      r.x2[k].save(path.join(OUT, 'hud_2x', `${id}.png`));
      r.x1[k].save(path.join(OUT, 'hud_1x', `${id}.png`));
      sidecar.hud[id] = { index: k };
    });
    console.log(`  ${h.file}: ${h.ids.length} HUD icons, sparkle ${r.sparkle.pixels}px`);
  }
  // skill icons: one grid per class path, 8 tiles row-major = skills.json order; keyed by skill id
  const grids = classGrids(skillsJson);
  for (const cls of GRID_PATHS) {
    const buf = bufs.get(`skills/${cls}`);
    const r = G.sliceSkillGrid(decodePNG(buf), manifest.iconSize2x);
    verify(`skills/${cls}`, buf, r.sparkle);
    grids[cls].forEach((id, k) => {
      r.x2[k].save(path.join(OUT, 'skills_2x', `${id}.png`));
      r.x1[k].save(path.join(OUT, 'skills_1x', `${id}.png`));
      sidecar.skills[id] = { path: cls, index: k };
    });
    console.log(`  skills/${cls}: 8 icons, sparkle ${r.sparkle.pixels}px`);
  }
  // PART 2: status icons (4x3), realm badges (3x3)
  {
    const s = manifest.status;
    const buf = bufs.get(s.file);
    const r = G.sliceGrid(decodePNG(buf), s.size2, s.cols, s.rows);
    verify(s.file, buf, r.sparkle);
    if (s.ids.length !== s.cols * s.rows) problems.push(`status: ${s.ids.length} ids for a ${s.cols}x${s.rows} grid`);
    s.ids.forEach((id, k) => {
      r.x2[k].save(path.join(OUT, 'status_2x', `${id}.png`));
      r.x1[k].save(path.join(OUT, 'status_1x', `${id}.png`));
      sidecar.status[id] = { index: k };
    });
    console.log(`  ${s.file}: ${s.ids.length} status icons, sparkle ${r.sparkle.pixels}px`);
    const q = manifest.realms;
    const qb = bufs.get(q.file);
    const qr = G.sliceGrid(decodePNG(qb), q.size2, q.cols, q.rows, {
      fit: 'contain',
      pad: q.pad,
      eraseCorner: q.eraseCorner,
    });
    verify(q.file, qb, qr.sparkle);
    qr.x2.forEach((im, k) => {
      const key = `realm_${k}`;
      im.save(path.join(OUT, 'realms_2x', `${key}.png`));
      qr.x1[k].save(path.join(OUT, 'realms_1x', `${key}.png`));
      sidecar.realms[key] = { index: k };
    });
    console.log(`  ${q.file}: ${qr.x2.length} realm badges, sparkle ${qr.sparkle.pixels}px`);
  }
  // PART 2: particle textures (black background, luminance -> alpha)
  for (const name of manifest.particles.names) {
    const buf = bufs.get(`particles/${name}`);
    const r = G.processParticle(decodePNG(buf), manifest.particles.size2);
    verify(`particles/${name}`, buf, r.sparkle, G.isDark);
    r.x2.save(path.join(OUT, 'particles_2x', `${name}.png`));
    r.x1.save(path.join(OUT, 'particles_1x', `${name}.png`));
    sidecar.particles[name] = {};
    console.log(`  particles/${name}: ${r.x2.width}px @2x, gain ${r.gain.toFixed(2)}, sparkle ${r.sparkle.pixels}px`);
  }
  // PART 3 group Q: skill VFX sheets (3 panels on black) -> vfx_<class>_<panel>, packed with the particle textures
  const vfxPanels = manifest.vfx.panels;
  for (const cls of manifest.vfx.classes) {
    const buf = bufs.get(`vfx/${cls}`);
    const r = G.processVfxSheet(
      decodePNG(buf),
      vfxPanels.map((p) => p.size2),
      vfxPanels.map((p) => !!p.rotate),
    );
    verify(`vfx/${cls}`, buf, r.sparkle, G.isDark);
    r.panels.forEach((p, k) => {
      const name = `vfx_${cls}_${vfxPanels[k].id}`;
      p.x2.save(path.join(OUT, 'particles_2x', `${name}.png`));
      p.x1.save(path.join(OUT, 'particles_1x', `${name}.png`));
      sidecar.particles[name] = {};
    });
    console.log(
      `  vfx/${cls}: ${r.panels.map((p, k) => `${vfxPanels[k].id} ${p.x2.width}x${p.x2.height}`).join(', ')} @2x, sparkle ${r.sparkle.pixels}px`,
    );
  }
  // PART 2: login backdrop + emblem: single textures next to the atlases (not packed)
  {
    const b = manifest.keyArt.backdrop;
    const bb = bufs.get(b.file);
    const br = G.processBackdrop(decodePNG(bb), b.w, b.h);
    if (br.sparkle.components < 1) problems.push(`${b.file}: no Gemini mark found in the corner`);
    br.image.save(path.join(OUT, 'keyart', 'login_bg.png'));
    sidecar.keyArt.backdrop = { file: 'keyart_login_bg.png', w: b.w, h: b.h };
    const e = manifest.keyArt.emblem;
    const eb = bufs.get(e.file);
    const er = G.processEmblem(decodePNG(eb), e.size2);
    verify(e.file, eb, er.sparkle);
    er.x2.save(path.join(OUT, 'keyart', 'emblem_2x.png'));
    er.x1.save(path.join(OUT, 'keyart', 'emblem_1x.png'));
    sidecar.keyArt.emblem = {
      f2: { file: 'keyart_emblem_2x.png', w: er.x2.width, h: er.x2.height },
      f1: { file: 'keyart_emblem_1x.png', w: er.x1.width, h: er.x1.height },
    };
    console.log(`  key art: backdrop ${b.w}x${b.h}, emblem ${er.x2.width}x${er.x2.height} @2x`);
  }
  // INTERIM mob standees (concept art, faces left): one @1x tier
  for (const [key, def] of Object.entries(manifest.mobs)) {
    const buf = bufs.get(`mobs/${key}`);
    const r = G.processMob(decodePNG(buf), def.box);
    verify(`mobs/${key}`, buf, r.sparkle);
    r.x1.save(path.join(OUT, 'mobs_1x', `${key}.png`));
    sidecar.mobs[key] = { id: def.id, w: r.x1.width, h: r.x1.height, pivot: r.pivot };
    console.log(`  mobs/${key}: ${r.x1.width}x${r.x1.height} px (id ${def.id}), sparkle ${r.sparkle.pixels}px`);
  }
  // INTERIM boss-phase skins (the skin a boss takes at an HP threshold): same pipeline, scaled to the AREA of the base sprite
  for (const [key, def] of Object.entries(manifest.mobsPhase)) {
    if (key.startsWith('_')) continue;
    const base = sidecar.mobs[def.mob];
    if (!base) {
      problems.push(`mobs_phase/${key}: unknown mob ${def.mob}`);
      continue;
    }
    const buf = bufs.get(`mobs_phase/${key}`);
    const r = G.processMob(decodePNG(buf), 0, { area: base.w * base.h });
    verify(`mobs_phase/${key}`, buf, r.sparkle);
    r.x1.save(path.join(OUT, 'mobs_1x', `${key}.png`));
    sidecar.mobPhases[key] = { id: base.id, phase: def.phase, w: r.x1.width, h: r.x1.height, pivot: r.pivot };
    console.log(
      `  mobs_phase/${key}: ${r.x1.width}x${r.x1.height} px (mob ${def.mob} id ${base.id}, phase ${def.phase}), sparkle ${r.sparkle.pixels}px`,
    );
  }
  // 9-slice UI frames: keyed + trimmed, one atlas, slice insets in the sidecar
  for (const [name, def] of Object.entries(manifest.ui)) {
    if (name.startsWith('_')) continue;
    const buf = bufs.get(`ui/${name}`);
    const r = G.processUi(decodePNG(buf), def.w);
    verify(`ui/${name}`, buf, r.sparkle);
    const [l, t, rr, b] = def.inset;
    if (l + rr >= r.x1.width - 2 || t + b >= r.x1.height - 2)
      problems.push(`ui/${name}: insets ${def.inset} leave no stretchable centre in ${r.x1.width}x${r.x1.height}`);
    r.x2.save(path.join(OUT, 'ui_2x', `${name}.png`));
    r.x1.save(path.join(OUT, 'ui_1x', `${name}.png`));
    sidecar.ui[name] = { w: r.x1.width, h: r.x1.height, inset: def.inset };
    console.log(`  ui/${name}: ${r.x1.width}x${r.x1.height} @1x, inset ${def.inset.join(',')}`);
  }
  // ground textures (top-down paintings, not magenta): patch the sparkle, make periodic, cut variants
  const G2 = manifest.ground;
  for (const mat of G2.materials) {
    const img = decodePNG(bufs.get(`ground/${mat}`));
    const mark = Ground.removeGroundMark(img);
    const left = Ground.markContrast(img);
    if (mark === 0) problems.push(`ground/${mat}: no Gemini sparkle found at the expected corner position`);
    else if (left > Math.max(25, mark * 0.5))
      problems.push(
        `ground/${mat}: sparkle still visible after patching (contrast ${left.toFixed(1)} of ${mark.toFixed(1)})`,
      );
    const seams = [];
    for (let k = 0; k < G2.variants; k++) {
      const c = G2.crop;
      const r = Ground.periodicPatch(img, { x: (k % 2) * c, y: Math.floor(k / 2) * c, size: c, out: G2.patch });
      if (r.after.ratio > G2.maxSeamRatio)
        problems.push(
          `ground/${mat} variant ${k}: wrap seam ratio ${r.after.ratio.toFixed(2)} > ${G2.maxSeamRatio} after the fix`,
        );
      r.image.save(path.join(OUT, 'ground', `${mat}_${k}.png`));
      seams.push([Number(r.before.ratio.toFixed(2)), Number(r.after.ratio.toFixed(2))]);
    }
    sidecar.ground[mat] = {
      markContrast: Number(mark.toFixed(1)),
      markContrastAfter: Number(left.toFixed(1)),
      seamBeforeAfter: seams,
    };
    console.log(
      `  ground/${mat}: mark ${mark.toFixed(0)} -> ${left.toFixed(0)}, wrap seam ${seams.map((x) => `${x[0]}->${x[1]}`).join(' ')}`,
    );
  }
  // INTERIM Son Mon NPC standees (front-facing concept art, no flip): sized by height, shared prop atlas page, keyed npc_<name>
  for (const [key, def] of Object.entries(manifest.npcs)) {
    if (key.startsWith('_')) continue;
    const buf = bufs.get(`npcs/${key}`);
    const r = G.processMob(decodePNG(buf), 0, { height: def.h });
    verify(`npcs/${key}`, buf, r.sparkle);
    r.x1.save(path.join(OUT, 'mobs_1x', `${key}.png`));
    sidecar.npcs[key] = { w: r.x1.width, h: r.x1.height, pivot: r.pivot };
    console.log(`  npcs/${key}: ${r.x1.width}x${r.x1.height} px, sparkle ${r.sparkle.pixels}px`);
  }
  if (problems.length) {
    console.error(`✖ verification failed:\n  ${problems.join('\n  ')}`);
    return 4;
  }

  // INTERIM mob standees share the PROP atlas pages (one texture for props + mobs: the Y-sort interleaves them, separate
  // pages would break the batch at every switch). Mobs are @1x pixels in both pages (drawn 1:1).
  for (const key of [...Object.keys(manifest.mobs), ...Object.keys(manifest.npcs).filter((n) => !n.startsWith('_'))])
    for (const d of ['props_2x', 'props_1x'])
      fs.copyFileSync(path.join(OUT, 'mobs_1x', `${key}.png`), path.join(OUT, d, `${key}.png`));
  // boss-phase skins: their OWN @1x page for both tiers (loaded lazily by the client). In the prop pages they overflowed the
  // 2048 page (a second texture breaks the L3 batch) and added ~2 MB to the initial package.
  fs.rmSync(path.join(OUT, 'mobphase_1x'), { recursive: true, force: true });
  fs.mkdirSync(path.join(OUT, 'mobphase_1x'), { recursive: true });
  for (const key of Object.keys(manifest.mobsPhase).filter((n) => !n.startsWith('_')))
    fs.copyFileSync(path.join(OUT, 'mobs_1x', `${key}.png`), path.join(OUT, 'mobphase_1x', `${key}.png`));
  for (const [dir, atlasName, kind] of [
    ['props_2x', 'atl_prop_2x', 'props'],
    ['props_1x', 'atl_prop_1x', 'props'],
    ['icons_2x', 'atl_gicon_2x', 'icons'],
    ['icons_1x', 'atl_gicon_1x', 'icons'],
    ['mobphase_1x', 'atl_mobphase_1x', 'mobPhases'],
    ['ui_2x', 'atl_ui_2x', 'ui'],
    ['ui_1x', 'atl_ui_1x', 'ui'],
    ['skills_2x', 'atl_skill_2x', 'skills'],
    ['skills_1x', 'atl_skill_1x', 'skills'],
    ['status_2x', 'atl_status_2x', 'status'],
    ['status_1x', 'atl_status_1x', 'status'],
    ['realms_2x', 'atl_realm_2x', 'realms'],
    ['realms_1x', 'atl_realm_1x', 'realms'],
    ['hud_2x', 'atl_hud_2x', 'hud'],
    ['hud_1x', 'atl_hud_1x', 'hud'],
    ['particles_2x', 'atl_ptcl_2x', 'particles'],
    ['particles_1x', 'atl_ptcl_1x', 'particles'],
  ]) {
    const a = pack(dir, atlasName);
    const scale = atlasName.endsWith('2x') ? 'f2' : 'f1';
    sidecar.atlases[atlasName] = a.pages.map((p) => ({ file: p.file, width: p.width, height: p.height }));
    for (const [n, f] of Object.entries(a.frames)) {
      const target = sidecar[kind][n] || sidecar.mobs[n] || sidecar.npcs[n];
      target[scale] = { file: a.pages[f.page].file, x: f.x, y: f.y, w: f.w, h: f.h };
    }
  }
  // single textures (not atlased) ride along in atlas/ so every consumer copies one directory
  for (const [from, to] of [
    ['login_bg.png', 'keyart_login_bg.png'],
    ['emblem_2x.png', 'keyart_emblem_2x.png'],
    ['emblem_1x.png', 'keyart_emblem_1x.png'],
  ])
    fs.copyFileSync(path.join(OUT, 'keyart', from), path.join(OUT, 'atlas', to));
  fs.writeFileSync(path.join(OUT, 'gemini.json'), JSON.stringify(sidecar, null, 2));
  fs.writeFileSync(stampFile, stamp);
  console.log(`✔ gemini assets -> ${OUT}`);
  return 0;
}

try {
  process.exit(main());
} catch (e) {
  console.error('✖', e.message);
  process.exit(1);
}
