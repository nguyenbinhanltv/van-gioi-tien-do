#!/usr/bin/env node
'use strict';
/**
 * CỔNG KIỂM ĐỊNH TÀI SẢN (xác định, không dùng AI)
 * ----------------------------------------------------------------------------
 * Kiểm tra kích thước, tỷ lệ 2:1, giới hạn atlas 2048, lũy thừa 2, tham chiếu chéo
 * giữa các manifest JSON. Claude Code đọc báo cáo này ở bước qa_validation_gate để
 * viết nhận xét và đề xuất sửa, nhưng quyết định chặn / cho qua nằm ở mã thoát dưới đây.
 *
 *   node pipeline/validate_assets.js --stage raw    --root build/raw   --report reports/qa_raw.json
 *   (thêm --allow-warnings để cảnh báo trả mã 0)
 *   node pipeline/validate_assets.js --stage packed --root build/atlas --report reports/qa_packed.json
 *
 * Mã thoát: 0 đạt · 10 chỉ có cảnh báo · 20 có lỗi (dừng pipeline, không thử lại).
 */
const fs = require('fs');
const path = require('path');
const { readPNGSize } = require('../src/lib/png');

const args = Object.fromEntries(process.argv.slice(2).join(' ').split(/\s*--/).filter(Boolean).map((s) => {
  const [k, ...v] = s.split(/[=\s]+/);
  return [k, v.join(' ')];
}));
const stage = args.stage || 'raw';
const root = args.root || (stage === 'raw' ? 'build/raw' : 'build/atlas');
const MAX = Number(args.max || 2048);

const errors = [], warnings = [], stats = {};
const err = (code, msg) => errors.push({ code, msg });
const warn = (code, msg) => warnings.push({ code, msg });
const isPow2 = (n) => n > 0 && (n & (n - 1)) === 0;
const readJSON = (p) => {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch (e) { err('JSON_INVALID', `${p}: ${e.message}`); return null; }
};
const pngSize = (p) => {
  try { return readPNGSize(fs.readFileSync(p)); } catch (e) { err('PNG_INVALID', `${p}: ${e.message}`); return null; }
};
const checkAtlasImage = (p, label) => {
  const s = pngSize(p);
  if (!s) return null;
  if (s.width > MAX || s.height > MAX) err('ATLAS_TOO_LARGE', `${label}: ${s.width}×${s.height} vượt ${MAX}`);
  if (!isPow2(s.width) || !isPow2(s.height)) warn('ATLAS_NOT_POT', `${label}: ${s.width}×${s.height} không phải lũy thừa 2`);
  return s;
};

function validateTilemap(dir) {
  const ts = readJSON(path.join(dir, 'tileset.json'));
  const map = readJSON(path.join(dir, 'map.json'));
  if (!ts || !map) return;
  if (ts.tileWidth !== 2 * ts.tileHeight) err('TILE_RATIO', `Tile ${ts.tileWidth}×${ts.tileHeight} không đúng tỷ lệ 2:1`);
  if (![64, 128].includes(ts.tileWidth)) warn('TILE_SIZE', `Tile rộng ${ts.tileWidth}px, chuẩn là 64 (@1x) hoặc 128 (@2x)`);
  const img = checkAtlasImage(path.join(dir, ts.image), 'tileset.png');
  if (img && (img.width !== ts.imageWidth || img.height !== ts.imageHeight)) {
    err('MANIFEST_SIZE_MISMATCH', `tileset.json ghi ${ts.imageWidth}×${ts.imageHeight}, ảnh thật ${img.width}×${img.height}`);
  }
  for (const f of ts.tiles) {
    if (f.x < 0 || f.y < 0 || f.x + f.w > ts.imageWidth || f.y + f.h > ts.imageHeight) err('FRAME_OUT_OF_BOUNDS', `tile ${f.name} nằm ngoài ảnh`);
    if (f.w !== ts.tileWidth || f.h !== ts.tileHeight) err('FRAME_SIZE', `tile ${f.name} ${f.w}×${f.h}`);
  }
  for (const L of ts.wang?.layers ?? []) {
    for (let m = 1; m <= 14; m++) if (L.masks[String(m)] === undefined) err('WANG_MISSING', `lớp ${L.name} thiếu mặt nạ ${m}`);
    if (!L.full?.length) err('WANG_MISSING', `lớp ${L.name} thiếu ô thuần`);
  }
  const n = map.width * map.height;
  if (map.projection?.ratio !== '2:1') err('MAP_PROJECTION', 'map.json không khai báo tỷ lệ 2:1');
  if (map.corners.data.length !== (map.width + 1) * (map.height + 1)) err('MAP_CORNERS', 'Số đỉnh lưới không khớp kích thước bản đồ');
  for (const L of map.layers) {
    if (L.data.length !== n) err('MAP_LAYER_SIZE', `Lớp ${L.name}: ${L.data.length} ô, cần ${n}`);
    const bad = L.data.filter((id) => id !== -1 && (id < 0 || id >= ts.tiles.length)).length;
    if (bad) err('MAP_BAD_TILE_ID', `Lớp ${L.name}: ${bad} ô trỏ tới tile không tồn tại`);
  }
  const empty = map.layers.reduce((acc, L) => acc.map((v, k) => v && L.data[k] === -1), new Array(n).fill(true)).filter(Boolean).length;
  if (empty) err('MAP_HOLES', `${empty} ô không có lớp nào (lỗ trên bản đồ)`);
  stats.tilemap = { tiles: ts.tiles.length, map: `${map.width}×${map.height}`, atlas: `${ts.imageWidth}×${ts.imageHeight}` };
}

function validateSwords(dir) {
  const meta = readJSON(path.join(dir, 'flying_sword_frames.json'));
  if (!meta) return;
  const want = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
  if (JSON.stringify([...meta.directions].sort()) !== JSON.stringify([...want].sort())) err('SWORD_DIRS', 'Phi kiếm phải có đủ 8 hướng');
  for (const [tier, frames] of Object.entries(meta.tiers)) {
    for (const d of want) {
      const f = frames[d];
      if (!f) { err('SWORD_DIR_MISSING', `${tier}: thiếu hướng ${d}`); continue; }
      if (f.pivot.x < 0 || f.pivot.y < 0 || f.pivot.x >= f.w || f.pivot.y >= f.h) err('SWORD_PIVOT', `${tier}/${d}: pivot nằm ngoài ô`);
      const png = path.join(dir, `flying_sword_${d}_${tier}.png`);
      if (fs.existsSync(png)) {
        const s = pngSize(png);
        if (s && (s.width !== f.w || s.height !== f.h)) err('SWORD_SIZE', `${path.basename(png)} ${s.width}×${s.height}, cần ${f.w}×${f.h}`);
      } else warn('SWORD_NOT_RENDERED', `${path.basename(png)} chưa được render`);
    }
  }
  stats.swords = Object.keys(meta.tiers);
}

function validateIcons(dir) {
  const allowed = new Set([48, 64, 128, 256]);
  const pngs = fs.readdirSync(dir).filter((f) => f.endsWith('.png') && !f.includes('sheet'));
  if (!pngs.length) warn('ICONS_NOT_RENDERED', 'Chưa có icon PNG nào');
  for (const f of pngs) {
    const s = pngSize(path.join(dir, f));
    if (!s) continue;
    if (s.width !== s.height || !allowed.has(s.width)) err('ICON_SIZE', `${f}: ${s.width}×${s.height} (cho phép 48/64/128/256 vuông)`);
  }
  stats.icons = pngs.length;
}

function validateShaders(dir) {
  const m = readJSON(path.join(dir, 'render_manifest.json'));
  if (!m) return;
  for (const s of m.shaders ?? []) if (s.status !== 'ok') err('SHADER_COMPILE', `${s.file}: ${s.log || 'biên dịch lỗi'}`);
  for (const s of m.snapshots ?? []) {
    const p = path.join(dir, s);
    if (!fs.existsSync(p)) err('SNAPSHOT_MISSING', s);
  }
  if (!(m.shaders ?? []).length) warn('SHADERS_NOT_COMPILED', 'Shader chưa được biên dịch (thiếu glslangValidator?)');
  if (!m.snapshots?.length) warn('NO_SNAPSHOT', 'Không có ảnh chụp shader (thiếu Xvfb / gói gl?)');
  stats.shaders = (m.shaders ?? []).length;
}

function validatePacked(dir) {
  const manifests = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
  if (!manifests.length) err('NO_ATLAS', `Không có atlas trong ${dir}`);
  for (const f of manifests) {
    const a = readJSON(path.join(dir, f));
    if (!a || a.format !== 'tutien-atlas') continue;
    for (const p of a.pages) {
      const s = checkAtlasImage(path.join(dir, p.file), p.file);
      if (s && (s.width !== p.width || s.height !== p.height)) err('MANIFEST_SIZE_MISMATCH', `${p.file}`);
    }
    for (const [name, fr] of Object.entries(a.frames)) {
      const page = a.pages[fr.page];
      if (!page || fr.x + fr.w > page.width || fr.y + fr.h > page.height) err('FRAME_OUT_OF_BOUNDS', `${f}: ${name}`);
    }
  }
  stats.atlases = manifests.length;
}

if (stage === 'raw') {
  const has = (p) => fs.existsSync(path.join(root, p));
  has('tilemap') ? validateTilemap(path.join(root, 'tilemap')) : err('MISSING_DIR', 'build/raw/tilemap');
  has('items/swords') ? validateSwords(path.join(root, 'items/swords')) : err('MISSING_DIR', 'items/swords');
  has('items/icons') ? validateIcons(path.join(root, 'items/icons')) : err('MISSING_DIR', 'items/icons');
  if (has('render')) validateShaders(path.join(root, 'render'));
  else warn('NO_RENDER_MANIFEST', 'Chưa có build/raw/render/render_manifest.json');
} else {
  validatePacked(root);
}

const report = { stage, root, verdict: errors.length ? 'fail' : warnings.length ? 'warn' : 'pass', errors, warnings, stats, at: new Date().toISOString() };
if (args.report) {
  fs.mkdirSync(path.dirname(args.report), { recursive: true });
  fs.writeFileSync(args.report, JSON.stringify(report, null, 2));
}
console.log(`${report.verdict.toUpperCase()}: ${errors.length} lỗi, ${warnings.length} cảnh báo`);
errors.forEach((e) => console.log(`  ✖ [${e.code}] ${e.msg}`));
warnings.forEach((w) => console.log(`  ⚠ [${w.code}] ${w.msg}`));
// --allow-warnings: cảnh báo không làm npm script thất bại (mặc định vẫn trả 10 như bản gốc)
process.exit(errors.length ? 20 : warnings.length && args['allow-warnings'] === undefined ? 10 : 0);
