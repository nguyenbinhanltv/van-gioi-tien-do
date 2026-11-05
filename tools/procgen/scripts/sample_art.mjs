#!/usr/bin/env node
// Normalize approved AI reference sheets; no image-generation API is called here.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import {
  TILE_WIDTH, TILE_HEIGHT, CANVAS_BY_FOOTPRINT, PIVOT_BOTTOM_OFFSET_PX,
  DRAWN_DIRECTIONS, MIRRORED_DIRECTIONS, BUDGETS,
} from '../../../packages/shared/dist/index.js';

const require = createRequire(import.meta.url);
const { Image, decodePNG, resizeArea } = require('../src/lib/png.js');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const source = path.join(root, 'assets-src/placeholder/first-sample');
const target = path.join(root, 'apps/client-cocos/assets/bundles/core/_placeholder/first-sample');
const args = process.argv.slice(2);
const files = [];
function save(img, dir, name, kind) {
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, name + '.png');
  img.save(file);
  files.push({ path: path.relative(root, file).replaceAll('\\', '/'), kind, width: img.width, height: img.height });
}
function crop(img, x, y, w, h) {
  const out = new Image(w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) out.setPixel(i, j, ...img.getPixel(x + i, y + j));
  return out;
}
function bounds(img) {
  let left = img.width, top = img.height, right = -1, bottom = -1;
  for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) {
    if (img.getPixel(x, y)[3] < 32) continue;
    left = Math.min(left, x); right = Math.max(right, x);
    top = Math.min(top, y); bottom = Math.max(bottom, y);
  }
  assert(right >= left, 'Empty reference');
  return crop(img, left, top, right - left + 1, bottom - top + 1);
}
function read(file) { return decodePNG(fs.readFileSync(file)); }
function cell(img, n, count) {
  const x = Math.round(n * img.width / count);
  return bounds(crop(img, x, 0, Math.round((n + 1) * img.width / count) - x, img.height));
}
function run(script, options) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/procgen', script), ...options], { stdio: 'inherit' });
  assert.equal(r.status, 0, script + ' failed');
}
const canvas = CANVAS_BY_FOOTPRINT['1x1'];
const pivot = [canvas / 2, canvas - PIVOT_BOTTOM_OFFSET_PX];

if (args[0] === 'import') {
  assert.equal(args.length, 6, 'import <character-sheet> <tile-sheet> <pill> <talisman> <sword>');
  const character = read(args[1]);
  for (const [n, direction] of DRAWN_DIRECTIONS.entries()) {
    const figure = cell(character, n, DRAWN_DIRECTIONS.length);
    const height = 208; // Art target: 104px silhouette, inside docs/18 96–110px range.
    const resized = resizeArea(figure, Math.round(figure.width * height / figure.height), height);
    const image = new Image(canvas * 2, canvas * 2);
    image.blit(resized, Math.round((image.width - resized.width) / 2), pivot[1] * 2 - height);
    for (let frame = 0; frame < 8; frame++) {
      const idle = new Image(image.width, image.height);
      const breath = (1 - Math.cos(frame * Math.PI / 4));
      for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
        // Tiny vertical breathing deformation fades to zero at the planted feet.
        const offset = Math.round(breath * Math.max(0, (pivot[1] * 2 - y) / height));
        const sy = Math.min(image.height - 1, y + offset);
        idle.setPixel(x, y, ...image.getPixel(x, sy));
      }
      const name = `spr_kiemtu_idle_${direction}_${String(frame).padStart(2, '0')}`;
      save(idle, path.join(source, 'character'), name, 'character');
      save(resizeArea(idle, canvas, canvas), path.join(target, 'character'), name, 'character');
    }
  }
  const tileSheet = read(args[2]);
  const colors = [[108, 128, 78], [132, 143, 151], [70, 112, 129]];
  const tileNames = ['grass', 'rock', 'water', 'grass_rock_NW'];
  for (let n = 0; n < tileNames.length; n++) {
    const texture = cell(tileSheet, n, tileNames.length);
    for (const scale of [2, 1]) {
      const w = TILE_WIDTH * scale, h = TILE_HEIGHT * scale;
      const img = new Image(w, h);
      for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const u = (x + 0.5) / w, v = (y + 0.5) / h;
        const distance = 1 - Math.abs(u * 2 - 1) - Math.abs(v * 2 - 1);
        if (distance < 0) continue;
        // Sample inside the reference diamond, fade texture to a shared edge color.
        const sample = texture.getPixel(Math.floor(texture.width * (0.3 + u * 0.4)), Math.floor(texture.height * (0.3 + v * 0.4)));
        const mix = n === 3 ? Math.min(1, Math.max(0, ((u + v) / 2 - 0.25) * 2)) : 0;
        const base = n === 3 ? colors[0].map((c, k) => c * (1 - mix) + colors[1][k] * mix) : colors[n];
        const blend = Math.min(1, distance / 0.35) * 0.45;
        img.setPixel(x, y, ...base.map((c, k) => c * (1 - blend) + sample[k] * blend), 255);
      }
      save(img, path.join(scale === 2 ? source : target, 'tiles'), 'tset_sample_' + tileNames[n], 'tile');
    }
  }
  for (const [n, name] of ['pill_trucco', 'talisman_sample', 'equip_sword'].entries()) {
    const object = bounds(read(args[n + 3]));
    const image = new Image(256, 256);
    const factor = 204 / Math.max(object.width, object.height);
    const resized = resizeArea(object, Math.round(object.width * factor), Math.round(object.height * factor));
    image.blit(resized, Math.round((256 - resized.width) / 2), Math.round((256 - resized.height) / 2));
    save(image, path.join(source, 'icons'), `icon_${name}_256`, 'icon');
    for (const size of [48, 64, 128]) {
      const icon = resizeArea(image, size, size);
      // Placeholder-only small-size contrast pass; artist hand-polish is still required.
      if (size === 48) for (let i = 0; i < icon.data.length; i += 4) {
        for (let k = 0; k < 3; k++) icon.data[i + k] = (icon.data[i + k] - 128) * 1.15 + 128;
      }
      save(icon, path.join(target, 'icons', String(size)), `icon_${name}_${size}`, 'icon');
    }
  }
  fs.writeFileSync(path.join(source, 'manifest.json'), JSON.stringify({ placeholder: true, release: false, pivot, mirrors: MIRRORED_DIRECTIONS, animation: 'idle', framesPerDirection: 8, fps: 8, note: 'AI reference with procedural breathing; not a Spine rig.', files }, null, 2) + '\n');
}

if (['import', 'validate', 'pack', 'contact'].includes(args[0])) {
  const manifest = JSON.parse(fs.readFileSync(path.join(source, 'manifest.json')));
  assert.equal(manifest.files.length, 100, 'Incomplete sample batch');
  assert.equal(new Set(manifest.files.map(a => a.path)).size, 100, 'Duplicate asset');
  assert.equal(manifest.framesPerDirection, 8);
  assert.deepEqual(manifest.mirrors, MIRRORED_DIRECTIONS);
  for (const asset of manifest.files) {
    const img = read(path.join(root, asset.path));
    assert.deepEqual([img.width, img.height], [asset.width, asset.height]);
    assert(img.data.some((v, i) => i % 4 === 3 && v === 0), asset.path + ': no transparency');
    assert(img.data.some((v, i) => i % 4 === 3 && v > 0), asset.path + ': empty');
    const scale = asset.path.startsWith('assets-src/') ? 2 : 1;
    if (asset.kind === 'tile') assert.deepEqual([img.width, img.height], [TILE_WIDTH * scale, TILE_HEIGHT * scale]);
    if (asset.kind === 'character') assert.deepEqual([img.width, img.height], [canvas * scale, canvas * scale]);
    if (asset.kind === 'icon') {
      const size = Number(asset.path.match(/_(\d+)\.png$/)[1]);
      assert([48, 64, 128, 256].includes(size));
      assert.deepEqual([img.width, img.height], [size, size]);
    }
  }
  assert.deepEqual(manifest.pivot, pivot);
  console.log(`PASS: ${manifest.files.length} images, dimensions, transparency, tile ratio and pivot`);
  if (args[0] === 'pack') {
    const out = path.join(root, 'tools/procgen/build/sample-art');
    for (const [name, dir] of [['character', 'character'], ['tiles', 'tiles'], ...[48, 64, 128].map(s => ['icons_' + s, 'icons/' + s])]) {
      run('pipeline/pack_atlas.js', ['--in', path.join(target, dir), '--out', out, '--name', 'atl_sample_' + name, '--max', String(BUDGETS.ATLAS_MAX_WEB_MOBILE), '--padding', String(BUDGETS.ATLAS_PADDING_PX), '--extrude', '1']);
    }
    run('pipeline/validate_assets.js', ['--stage', 'packed', '--root', out, '--report', path.join(out, 'qa.json')]);
  }
  if (args[0] === 'contact') {
    const { Resvg } = require('@resvg/resvg-js');
    let svg = '<svg xmlns="http://www.w3.org/2000/svg" width="1100" height="700"><rect width="1100" height="700" fill="#202b32"/><g fill="#eee" font-family="sans-serif"><text x="30" y="36" font-size="24">FIRST SAMPLE / AI PLACEHOLDERS / NOT FOR RELEASE</text><text x="30" y="65">8-frame breathing idle • NW lighting • no baked shadow • no rarity rims</text>';
    function add(file, x, y, w, h, label) {
      svg += `<image href="data:image/png;base64,${fs.readFileSync(file).toString('base64')}" x="${x}" y="${y}" width="${w}" height="${h}"/><text x="${x}" y="${y + h + 20}">${label}</text>`;
    }
    DRAWN_DIRECTIONS.forEach((d, n) => add(path.join(target, 'character', `spr_kiemtu_idle_${d}_00.png`), 30 + n * 210, 90, 192, 192, d + ' / 128x128'));
    for (const [n, name] of ['pill_trucco', 'talisman_sample', 'equip_sword'].entries()) add(path.join(target, 'icons/48', `icon_${name}_48.png`), 30 + n * 150, 355, 96, 96, name + ' / 48');
    svg += '<defs><filter id="gray"><feColorMatrix type="saturate" values="0"/></filter></defs><text x="600" y="355">Native 48px / color and grayscale</text>';
    for (const [n, name] of ['pill_trucco', 'talisman_sample', 'equip_sword'].entries()) {
      const file = path.join(target, 'icons/48', `icon_${name}_48.png`);
      add(file, 600 + n * 130, 380, 48, 48, '');
      svg += '<g filter="url(#gray)">';
      add(file, 600 + n * 130, 450, 48, 48, '');
      svg += '</g>';
    }
    const tileNames = ['grass', 'rock', 'water', 'grass_rock_NW'];
    tileNames.forEach((name, n) => {
      const tile = path.join(target, 'tiles', 'tset_sample_' + name + '.png');
      for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
        const selected = n === 3 && i !== 1 ? path.join(target, 'tiles', 'tset_sample_' + (i === 0 ? 'grass' : 'rock') + '.png') : tile;
        add(selected, 80 + n * 260 + (i - j) * TILE_WIDTH / 2, 520 + (i + j) * TILE_HEIGHT / 2, TILE_WIDTH, TILE_HEIGHT, '');
      }
      svg += `<text x="${30 + n * 260}" y="660">${name} / 64x32 repeated</text>`;
    });
    svg += '</g></svg>';
    fs.writeFileSync(args[1], new Resvg(svg).render().asPng());
    console.log(args[1]);
  }
} else throw new Error('Expected import, validate, pack or contact');
