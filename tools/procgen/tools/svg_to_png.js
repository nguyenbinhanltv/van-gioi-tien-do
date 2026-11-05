#!/usr/bin/env node
'use strict';
/**
 * Chuyển SVG -> PNG cho pipeline atlas (tùy chọn).
 * Cần: npm i -D @resvg/resvg-js   (gói có sẵn bản build cho Windows / macOS / Linux, không cần biên dịch)
 *
 *   node tools/svg_to_png.js out/items/icons/pills_sheet.svg            -> cùng tên .png
 *   node tools/svg_to_png.js out/items --scale 0.5                       -> cả thư mục, ra bản @1x từ master
 */
const fs = require('fs');
const path = require('path');

let Resvg;
try {
  ({ Resvg } = require('@resvg/resvg-js'));
} catch {
  console.error('Thiếu @resvg/resvg-js. Chạy: npm i -D @resvg/resvg-js');
  process.exit(1);
}

const args = process.argv.slice(2);
const scaleIdx = args.indexOf('--scale');
const scale = scaleIdx >= 0 ? Number(args[scaleIdx + 1]) : 1;
const target = args.find((a, i) => !a.startsWith('--') && (scaleIdx < 0 || i !== scaleIdx + 1));
if (!target) {
  console.error('Cách dùng: node tools/svg_to_png.js <file.svg | thư mục> [--scale 0.5]');
  process.exit(1);
}

function convert(file) {
  const svg = fs.readFileSync(file, 'utf8');
  const width = Number((svg.match(/width="(\d+)"/) || [])[1] || 256);
  const r = new Resvg(svg, { fitTo: { mode: 'width', value: Math.round(width * scale) }, background: 'rgba(0,0,0,0)' });
  const out = file.replace(/\.svg$/, scale === 1 ? '.png' : `@${scale}x.png`);
  fs.writeFileSync(out, r.render().asPng());
  console.log('✔', out);
}

function walk(p) {
  const st = fs.statSync(p);
  if (st.isDirectory()) fs.readdirSync(p).forEach((f) => walk(path.join(p, f)));
  else if (p.endsWith('.svg')) convert(p);
}

walk(target);
