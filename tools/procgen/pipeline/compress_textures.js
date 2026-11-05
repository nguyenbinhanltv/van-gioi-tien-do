#!/usr/bin/env node
'use strict';
/**
 * BƯỚC 4b (bản Node) – nén atlas theo nền tảng, tương đương compress_textures.sh
 *   node pipeline/compress_textures.js <web|android|ios|pc> <thư mục atlas> <thư mục ra> [--strict]
 * Web: KTX2 (basisu) + WebP (cwebp) · Android/iOS: ASTC (astcenc) · PC: sao chép PNG.
 * Thiếu công cụ nén -> IN THÔNG BÁO, ghi compress_manifest.json {skipped:true} và thoát 0 (hoặc 3 với --strict).
 * Mã thoát: 0 đạt/bỏ qua · 20 vượt ngân sách · 3 thiếu công cụ (--strict) · 1 lỗi khác.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const [PLATFORM, IN, OUT] = argv.filter((a) => !a.startsWith('--'));
if (!PLATFORM || !IN || !OUT) {
  console.error('Cách dùng: compress_textures.js <web|android|ios|pc> <atlas_dir> <out_dir> [--strict]');
  process.exit(1);
}
const ASTCENC = process.env.ASTCENC || 'astcenc-avx2';
const BUDGET_KB = Number(process.env.WEB_CORE_BUDGET_KB || 6144);

const has = (cmd) => spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' }).status === 0;
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')}\n${r.stderr || r.stdout}`);
};
const classOf = (f) => (/^(tileset|atl_tile_)/.test(f) ? 'tile' : /^atl_vfx_/.test(f) ? 'vfx' : 'hq');
const INSTALL = {
  basisu: 'basisu (github.com/BinomialLLC/basis_universal)',
  cwebp: 'cwebp (libwebp)',
  [ASTCENC]: 'astcenc (github.com/ARM-software/astc-encoder)',
};

const need = { web: ['basisu', 'cwebp'], android: [ASTCENC], ios: [ASTCENC], pc: [] }[PLATFORM];
if (!need) { console.error('✖ nền tảng không hợp lệ: ' + PLATFORM); process.exit(1); }
const missing = need.filter((c) => !has(c));

fs.mkdirSync(OUT, { recursive: true });
const pngs = fs.readdirSync(IN).filter((f) => f.endsWith('.png'));

if (missing.length) {
  console.log(`⚠ BỎ QUA nén ${PLATFORM}: thiếu công cụ ${missing.map((m) => INSTALL[m] || m).join(', ')}. Xem README (mục "Cài công cụ").`);
  fs.writeFileSync(path.join(OUT, 'compress_manifest.json'), JSON.stringify({ platform: PLATFORM, skipped: true, missing, files: [] }, null, 2));
  process.exit(strict ? 3 : 0);
}

try {
  for (const f of pngs) {
    const base = f.replace(/\.png$/, '');
    const src = path.join(IN, f);
    const c = classOf(f);
    if (PLATFORM === 'pc') {
      fs.copyFileSync(src, path.join(OUT, f));
    } else if (PLATFORM === 'web') {
      const webp = path.join(OUT, base + '.webp');
      if (c === 'hq') {
        run('basisu', ['-ktx2', '-uastc', '-output_path', OUT, src]);
        run('cwebp', ['-quiet', '-lossless', src, '-o', webp]);
      } else {
        run('basisu', ['-ktx2', '-q', '192', '-output_path', OUT, src]);
        run('cwebp', ['-quiet', '-q', '85', src, '-o', webp]);
      }
    } else {
      const bs = c === 'tile' ? '6x6' : c === 'vfx' ? '8x8' : '4x4';
      run(ASTCENC, ['-cl', src, path.join(OUT, base + '.astc'), bs, '-medium', '-silent']);
    }
  }
} catch (e) {
  console.error('✖ nén lỗi: ' + e.message);
  process.exit(1);
}

for (const j of fs.readdirSync(IN).filter((f) => f.endsWith('.json'))) fs.copyFileSync(path.join(IN, j), path.join(OUT, j));
const files = fs.readdirSync(OUT).filter((f) => f !== 'compress_manifest.json').map((f) => ({ file: f, bytes: fs.statSync(path.join(OUT, f)).size }));
const totalKB = Math.ceil(files.reduce((s, f) => s + f.bytes, 0) / 1024);
fs.writeFileSync(path.join(OUT, 'compress_manifest.json'), JSON.stringify({ platform: PLATFORM, skipped: false, totalKB, files }, null, 2));
console.log(`✔ ${PLATFORM}: ${totalKB} KB trong ${OUT}`);
if (PLATFORM === 'web' && totalKB > BUDGET_KB) {
  console.error(`✖ vượt ngân sách atlas Core Web: ${totalKB} KB > ${BUDGET_KB} KB`);
  process.exit(20);
}
