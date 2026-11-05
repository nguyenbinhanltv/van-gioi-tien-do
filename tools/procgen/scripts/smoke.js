#!/usr/bin/env node
'use strict';
/**
 * Bản Node (chạy trên Windows/macOS/Linux, không cần bash) của pipeline/local_smoke.sh:
 * phần XÁC ĐỊNH của pipeline, không gọi AI, không deploy.
 *   node scripts/smoke.js [web|android|ios|pc]     (mặc định pc)   · SEED=... để đổi seed
 * Thiếu công cụ tùy chọn (glslangValidator, resvg, basisu, astcenc) -> bước đó bỏ qua kèm thông báo.
 * Thiếu resvg thì không có PNG icon/kiếm -> bước đóng gói atlas bị bỏ qua (smoke vẫn thoát 0 nhưng báo rõ).
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
process.chdir(ROOT);
const PLATFORM = process.argv[2] || 'pc';
const SEED = process.env.SEED || '20261031';
const RAW = 'build/raw';
const ATLAS = 'build/atlas';

const node = (args, allowed = [0]) => {
  const r = spawnSync(process.execPath, args, { stdio: 'inherit' });
  if (!allowed.includes(r.status)) {
    console.error(`✖ lệnh thất bại (mã ${r.status}): node ${args.join(' ')}`);
    process.exit(r.status || 1);
  }
  return r.status;
};

fs.rmSync('build', { recursive: true, force: true });
fs.rmSync('reports', { recursive: true, force: true });
fs.mkdirSync('reports', { recursive: true });

console.log('▶ 1/4 generate_raw_assets');
node(['src/tilemap/generate_tilemap.js', '--seed', SEED, '--out', `${RAW}/tilemap`]);
node(['src/items/generate_items.js', '--seed', '7', '--out', `${RAW}/items`]);

console.log('▶ 2/4 render_paperdoll_layers');
node(['pipeline/render_layers.js', RAW]);

console.log('▶ 3/4 qa_validation_gate (phần xác định)');
const rc = node(['pipeline/validate_assets.js', '--stage', 'raw', '--root', RAW, '--report', 'reports/qa_raw.json'], [0, 10, 20]);
if (rc === 20) { console.error('✖ QA chặn'); process.exit(20); }

console.log(`▶ 4/4 package_and_compress (${PLATFORM})`);
const hasPng = fs.existsSync(`${RAW}/items/icons`) && fs.readdirSync(`${RAW}/items/icons`).some((f) => f.endsWith('.png'));
if (!hasPng) {
  console.log('⚠ BỎ QUA đóng gói + nén: chưa có PNG icon/phi kiếm (cần @resvg/resvg-js để render SVG → PNG).');
  console.log('✔ Smoke xong MỘT PHẦN (bước 1–3). Chạy `npm i` trong tools/procgen rồi thử lại để chạy đủ.');
  process.exit(0);
}
node(['scripts/pack_all.js', RAW, ATLAS]);
node(['pipeline/validate_assets.js', '--stage', 'packed', '--root', ATLAS, '--report', 'reports/qa_packed.json'], [0, 10]);
node(['pipeline/compress_textures.js', PLATFORM, ATLAS, `build/dist/${PLATFORM}`]);
console.log(`✔ Chạy thử xong: build/dist/${PLATFORM}`);
