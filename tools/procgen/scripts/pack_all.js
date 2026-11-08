#!/usr/bin/env node
'use strict';
/**
 * Đóng gói atlas icon (48/64/128), phi kiếm theo phẩm và sao chép tileset – tương đương vòng lặp trong local_smoke.sh.
 *   node scripts/pack_all.js <raw_dir> <atlas_dir>      (mặc định: out build/atlas)
 * Cần PNG đã render (npm run render, cần @resvg/resvg-js). Thiếu PNG -> thoát 3.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const [RAW = 'out', ATLAS = 'build/atlas'] = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const pack = path.join(__dirname, '..', 'pipeline', 'pack_atlas.js');
const run = (args) => {
  const r = spawnSync(process.execPath, [pack, ...args], { stdio: 'inherit' });
  if (r.status !== 0) {
    console.error('✖ pack_atlas thất bại: ' + args.join(' '));
    process.exit(r.status || 1);
  }
};

const icons = path.join(RAW, 'items', 'icons');
const swords = path.join(RAW, 'items', 'swords');
const iconFilter = '^(pill|talisman)_.*\\.png$';
const iconPngs = fs.existsSync(icons) ? fs.readdirSync(icons).filter((f) => new RegExp(iconFilter).test(f)) : [];
if (!iconPngs.length) {
  console.error('✖ chưa có PNG icon trong ' + icons + ' – chạy `npm run render` (cần @resvg/resvg-js) trước.');
  process.exit(3);
}

fs.rmSync(ATLAS, { recursive: true, force: true });
fs.mkdirSync(ATLAS, { recursive: true });
for (const s of [48, 64, 128]) {
  run(['--in', icons, '--out', ATLAS, '--name', `atl_icon_${s}`, '--size', String(s), '--filter', iconFilter]);
}
const tiers = fs.readdirSync(swords).map((f) => f.match(/^flying_sword_sheet_(.*)\.svg$/)).filter(Boolean).map((m) => m[1]);
for (const t of tiers) {
  run(['--in', swords, '--out', ATLAS, '--name', `atl_sword_${t}`, '--filter', `^flying_sword_[A-Z]+_${t}\\.png$`]);
}
for (const f of ['tileset.png', 'tileset.json', 'map.json']) {
  fs.copyFileSync(path.join(RAW, 'tilemap', f), path.join(ATLAS, f));
}
// Owner-provided Gemini props / item icons (npm run gen:gemini already packed them): include them in the atlas dir so
// the budget gate checks power-of-two pages, padding / extrude and the size caps.
const gem = path.join(RAW, 'gemini', 'atlas');
if (fs.existsSync(gem)) {
  for (const f of fs.readdirSync(gem)) fs.copyFileSync(path.join(gem, f), path.join(ATLAS, f));
}
console.log(`✔ đóng gói xong -> ${ATLAS}`);
