#!/usr/bin/env node
'use strict';
/**
 * BƯỚC 2 (bản Node, chạy được trên Windows) – tương đương render_layers.sh:
 * biên dịch shader (glslangValidator) + SVG -> PNG (@resvg/resvg-js) + ảnh chụp shader (cần Xvfb + gl).
 *   node pipeline/render_layers.js <raw_dir>        (mặc định: out)
 * Công cụ thiếu thì bước tương ứng bị BỎ QUA với thông báo rõ ràng (không thất bại), trừ khi --strict.
 * Mã thoát: 0 đạt (kể cả có bước bỏ qua) · 20 shader biên dịch lỗi · 3 thiếu công cụ (chỉ khi --strict) · 1 lỗi khác.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const argv = process.argv.slice(2);
const strict = argv.includes('--strict');
const RAW = argv.find((a) => !a.startsWith('--')) || 'out';
const OUT = path.join(RAW, 'render');
const ROOT = path.join(__dirname, '..');
fs.mkdirSync(path.join(OUT, 'logs'), { recursive: true });

const has = (cmd) => {
  const r = spawnSync(process.platform === 'win32' ? 'where' : 'which', [cmd], { stdio: 'ignore' });
  return r.status === 0;
};
const skipped = [];
let failed = false;

// 1. Biên dịch shader GLSL ES 1.0
const shaders = [];
if (!has('glslangValidator')) {
  skipped.push('glslangValidator');
  console.log('⚠ BỎ QUA biên dịch shader: thiếu glslangValidator (xem README, mục "Cài công cụ").');
} else {
  const dir = path.join(ROOT, 'shaders');
  for (const f of fs.readdirSync(dir).filter((n) => /\.(frag|vert)$/.test(n)).sort()) {
    const stage = f.split('.').pop();
    const tmp = path.join(os.tmpdir(), `vgtd_${process.pid}_${f}`);
    fs.writeFileSync(tmp, '#version 100\n' + fs.readFileSync(path.join(dir, f), 'utf8'));
    const r = spawnSync('glslangValidator', ['-S', stage, tmp], { encoding: 'utf8' });
    fs.rmSync(tmp, { force: true });
    const log = (r.stdout || '') + (r.stderr || '');
    fs.writeFileSync(path.join(OUT, 'logs', f + '.log'), log);
    const ok = r.status === 0;
    if (!ok) failed = true;
    shaders.push({ file: `shaders/${f}`, status: ok ? 'ok' : 'error', log: log.slice(0, 400).replace(/\s+/g, ' ') });
  }
}

// 2. SVG -> PNG
let resvgOk = true;
try { require.resolve('@resvg/resvg-js'); } catch { resvgOk = false; }
if (!resvgOk) {
  skipped.push('@resvg/resvg-js');
  console.log('⚠ BỎ QUA SVG→PNG: thiếu @resvg/resvg-js (chạy `npm i` trong tools/procgen).');
} else {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'tools', 'svg_to_png.js'), path.join(RAW, 'items')], { encoding: 'utf8' });
  fs.writeFileSync(path.join(OUT, 'logs', 'svg_to_png.log'), (r.stdout || '') + (r.stderr || ''));
  if (r.status !== 0) { console.error('✖ render SVG lỗi, xem ' + path.join(OUT, 'logs', 'svg_to_png.log')); process.exit(1); }
}

// 3. Ảnh chụp shader: cần Xvfb (Linux) + gói gl; ở Windows bỏ qua
const snapshots = [];
if (process.platform === 'linux' && has('xvfb-run')) {
  const r = spawnSync('xvfb-run', ['-a', '-s', '-screen 0 1280x720x24', process.execPath, path.join(ROOT, 'tools', 'shader_snapshot.js'), OUT], { encoding: 'utf8' });
  fs.writeFileSync(path.join(OUT, 'logs', 'snapshot.log'), (r.stdout || '') + (r.stderr || ''));
  if (r.status === 0) snapshots.push(...fs.readdirSync(OUT).filter((n) => n.endsWith('.png')));
} else {
  skipped.push('xvfb-run (ảnh chụp shader)');
  console.log('⚠ BỎ QUA ảnh chụp shader: cần Linux + xvfb-run + gói gl.');
}

// 4. Manifest cho cổng QA (chỉ ghi mục shaders khi đã thật sự biên dịch)
fs.writeFileSync(path.join(OUT, 'render_manifest.json'), JSON.stringify({ shaders, snapshots, skipped, at: new Date().toISOString() }, null, 2));

if (failed) { console.error(`✖ có shader biên dịch lỗi (xem ${path.join(OUT, 'logs')})`); process.exit(20); }
if (strict && skipped.length) { console.error('✖ --strict: thiếu công cụ: ' + skipped.join(', ')); process.exit(3); }
console.log(`✔ render xong${skipped.length ? ` (bỏ qua: ${skipped.join(', ')})` : ''}`);
