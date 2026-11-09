#!/usr/bin/env node
'use strict';
/**
 * Owner-provided Gemini exports (assets-src/gemini/{props,items}) -> game sprites + atlases.
 *   node scripts/gemini_assets.js [--src <dir>] [--out <dir>] [--force] [--allow-missing]
 *
 * Output (default out/gemini, git-ignored, regenerated; skipped when the stamp of sources + tool is unchanged;
 * the INTERIM mob standees are packed into the same atlas pages as the props):
 *   props_2x/ props_1x/ icons_2x/ icons_1x/   processed single PNGs (magenta keyed, sparkle removed, trimmed)
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
const skillsJson = require('../../../packages/shared/src/data/skills.json');
const manifest = require('../src/gemini/manifest.json');

const args = process.argv.slice(2);
const opt = (n, d) => { const i = args.indexOf('--' + n); return i >= 0 ? args[i + 1] : d; };
const flag = (n) => args.includes('--' + n);
const root = path.resolve(__dirname, '..');
const SRC = path.resolve(opt('src', path.join(root, '../../assets-src/gemini')));
const CONCEPTS = path.resolve(opt('concepts', path.join(root, '../../assets-src/concepts')));
const OUT = path.resolve(opt('out', path.join(root, 'out/gemini')));

const isPng = (buf) => buf.length > 8 && buf.readUInt32BE(0) === 0x89504e47;
const files = [
  ...Object.keys(manifest.props).map((n) => ['props', n]),
  ...manifest.icons.map((n) => ['items', n]),
  ...GRID_PATHS.map((n) => ['skills', n]),
  ...Object.keys(manifest.mobs).map((n) => ['mobs', n]),
  ...Object.keys(manifest.mobsPhase)
    .filter((n) => !n.startsWith('_'))
    .map((n) => ['mobs_phase', n]),
];
const srcPath = (dir, name) =>
  dir === 'mobs' || dir === 'mobs_phase' ? path.join(CONCEPTS, dir, `${name}.png`) : path.join(SRC, dir, `${name}.png`);

function loadSources() {
  const missing = [];
  const bufs = new Map();
  for (const [dir, name] of files) {
    const f = srcPath(dir, name);
    if (!fs.existsSync(f)) { missing.push(`${dir}/${name}.png (missing)`); continue; }
    const b = fs.readFileSync(f);
    if (!isPng(b)) { missing.push(`${dir}/${name}.png (not a PNG: Git LFS pointer? run git lfs pull)`); continue; }
    bufs.set(`${dir}/${name}`, b);
  }
  return { missing, bufs };
}

function stampOf(bufs) {
  const h = crypto.createHash('sha1');
  for (const k of [...bufs.keys()].sort()) { h.update(k); h.update(bufs.get(k)); }
  for (const f of ['../src/gemini/process.js', '../src/gemini/manifest.json', '../src/gemini/skills.js', '../../../packages/shared/src/data/skills.json', __filename, '../pipeline/pack_atlas.js', '../src/lib/png.js']) {
    h.update(fs.readFileSync(path.resolve(__dirname, f)));
  }
  return h.digest('hex');
}

function pack(dir, name) {
  const r = spawnSync(
    process.execPath,
    [path.join(root, 'pipeline/pack_atlas.js'), '--in', path.join(OUT, dir), '--out', path.join(OUT, 'atlas'), '--name', name, '--padding', '2', '--extrude', '2'],
    { stdio: 'inherit' },
  );
  if (r.status !== 0) throw new Error(`pack_atlas failed for ${name}`);
  return JSON.parse(fs.readFileSync(path.join(OUT, 'atlas', `${name}.json`), 'utf8'));
}

function main() {
  const { missing, bufs } = loadSources();
  if (missing.length) {
    const msg = `gemini sources unavailable:\n  ${missing.join('\n  ')}`;
    if (flag('allow-missing')) { console.warn(`⚠ ${msg}\n  (skipped: --allow-missing)`); return 0; }
    console.error(`✖ ${msg}`);
    return 3;
  }
  const stamp = stampOf(bufs);
  const stampFile = path.join(OUT, '.stamp');
  if (!flag('force') && fs.existsSync(stampFile) && fs.readFileSync(stampFile, 'utf8') === stamp && fs.existsSync(path.join(OUT, 'gemini.json'))) {
    console.log(`✔ gemini assets up to date (${OUT})`);
    return 0;
  }
  fs.rmSync(OUT, { recursive: true, force: true });
  for (const d of ['props_2x', 'props_1x', 'icons_2x', 'icons_1x', 'skills_2x', 'skills_1x', 'mobs_1x']) fs.mkdirSync(path.join(OUT, d), { recursive: true });

  const problems = [];
  const sidecar = { format: 'vgtd-gemini', version: 1, props: {}, icons: {}, skills: {}, mobs: {}, mobPhases: {}, atlases: {} };
  const verify = (key, srcBuf, sparkle) => {
    if (sparkle.components < 1) problems.push(`${key}: no Gemini sparkle found in the corner (unexpected source layout)`);
    else {
      // re-run on a fresh copy of the source with the mark removed: nothing may be found a second time
      const img = decodePNG(srcBuf);
      G.removeSparkle(img);
      if (G.removeSparkle(img).components !== 0) problems.push(`${key}: sparkle still present after removal`);
    }
  };

  for (const [name, def] of Object.entries(manifest.props)) {
    const buf = bufs.get(`props/${name}`);
    const r = G.processProp(decodePNG(buf), def.target, { clear: def.clear });
    verify(`props/${name}`, buf, r.sparkle);
    if (def.pivotX !== undefined) r.pivot.x = def.pivotX;
    r.x2.save(path.join(OUT, 'props_2x', `${name}.png`));
    r.x1.save(path.join(OUT, 'props_1x', `${name}.png`));
    sidecar.props[name] = {
      w2: r.x2.width, h2: r.x2.height, pivot: r.pivot, block: def.block, biomes: def.biomes, weight: def.weight, spacing: def.spacing || 1,
    };
    console.log(`  props/${name}: ${r.x2.width}x${r.x2.height} @2x, pivot ${r.pivot.x},${r.pivot.y}, sparkle ${r.sparkle.pixels}px`);
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
    console.log(`  mobs_phase/${key}: ${r.x1.width}x${r.x1.height} px (mob ${def.mob} id ${base.id}, phase ${def.phase}), sparkle ${r.sparkle.pixels}px`);
  }
  if (problems.length) {
    console.error(`✖ verification failed:\n  ${problems.join('\n  ')}`);
    return 4;
  }

  // INTERIM mob standees share the PROP atlas pages (one texture for props + mobs: the Y-sort interleaves them, separate
  // pages would break the batch at every switch). Mobs are @1x pixels in both pages (drawn 1:1).
  for (const key of [...Object.keys(manifest.mobs), ...Object.keys(manifest.mobsPhase).filter((n) => !n.startsWith('_'))])
    for (const d of ['props_2x', 'props_1x']) fs.copyFileSync(path.join(OUT, 'mobs_1x', `${key}.png`), path.join(OUT, d, `${key}.png`));
  for (const [dir, atlasName, kind] of [
    ['props_2x', 'atl_prop_2x', 'props'], ['props_1x', 'atl_prop_1x', 'props'],
    ['icons_2x', 'atl_gicon_2x', 'icons'], ['icons_1x', 'atl_gicon_1x', 'icons'],
    ['skills_2x', 'atl_skill_2x', 'skills'], ['skills_1x', 'atl_skill_1x', 'skills'],
  ]) {
    const a = pack(dir, atlasName);
    const scale = atlasName.endsWith('2x') ? 'f2' : 'f1';
    sidecar.atlases[atlasName] = a.pages.map((p) => ({ file: p.file, width: p.width, height: p.height }));
    for (const [n, f] of Object.entries(a.frames)) {
      const target = sidecar[kind][n] || sidecar.mobs[n] || sidecar.mobPhases[n];
      target[scale] = { file: a.pages[f.page].file, x: f.x, y: f.y, w: f.w, h: f.h };
    }
  }
  fs.writeFileSync(path.join(OUT, 'gemini.json'), JSON.stringify(sidecar, null, 2));
  fs.writeFileSync(stampFile, stamp);
  console.log(`✔ gemini assets -> ${OUT}`);
  return 0;
}

try { process.exit(main()); } catch (e) { console.error('✖', e.message); process.exit(1); }
