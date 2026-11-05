#!/usr/bin/env node
'use strict';
/**
 * ĐÓNG GÓI TEXTURE ATLAS (không phụ thuộc thư viện ngoài)
 * ----------------------------------------------------------------------------
 * Gom các PNG trong một thư mục thành các trang atlas lũy thừa 2, tối đa --max (mặc định 2048),
 * padding + extrude để chống rò màu, xuất <name>_<page>.png + <name>.json.
 * Tùy chọn --size N: thu nhỏ mọi ảnh về N × N trước khi đóng gói (icon 48 / 64 / 128 từ bản gốc 256).
 *
 *   node pipeline/pack_atlas.js --in build/raw/icons --out build/atlas --name atl_icon_64 --size 64
 *   node pipeline/pack_atlas.js --in build/raw/swords --out build/atlas --name atl_sword --filter "_gold.png$"
 *
 * Mã thoát: 0 thành công · 20 có ảnh lớn hơn trang tối đa (lỗi dữ liệu, không thử lại) · 1 lỗi khác.
 */
const fs = require('fs');
const path = require('path');
const { Image, decodePNG, resizeArea } = require('../src/lib/png');

function parseArgs(argv) {
  const o = { in: null, out: 'build/atlas', name: 'atlas', max: 2048, padding: 2, size: 0, filter: '\\.png$' };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-z]+)(?:=(.*))?$/);
    if (!m) continue;
    const v = m[2] !== undefined ? m[2] : argv[++i];
    o[m[1]] = ['max', 'padding', 'size', 'extrude'].includes(m[1]) ? Number(v) : v;
  }
  if (!o.in) throw new Error('Thiếu --in <thư mục PNG>');
  return o;
}

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(Math.max(1, n)));

/** Xếp kệ (shelf) theo chiều cao giảm dần; trả về danh sách trang với vị trí từng ảnh. */
function shelfPack(items, max, pad) {
  const sorted = [...items].sort((a, b) => b.h - a.h || b.w - a.w);
  // Chiều rộng kệ: lũy thừa 2 gần căn bậc hai tổng diện tích -> trang gần vuông, không quá max
  const area = items.reduce((s, it) => s + (it.w + pad * 2) * (it.h + pad * 2), 0);
  const widest = Math.max(...items.map((it) => it.w + pad * 2));
  const shelfW = Math.min(max, Math.max(nextPow2(widest), nextPow2(Math.ceil(Math.sqrt(area)))));
  const pages = [];
  let page = null;
  const newPage = () => { page = { placed: [], shelfY: 0, shelfH: 0, x: 0, usedW: 0, usedH: 0 }; pages.push(page); };
  newPage();
  for (const it of sorted) {
    const w = it.w + pad * 2, h = it.h + pad * 2;
    if (w > max || h > max) {
      const e = new Error(`Ảnh ${it.name} (${it.w}×${it.h}) lớn hơn trang tối đa ${max}`);
      e.exitCode = 20;
      throw e;
    }
    if (page.x + w > shelfW) { page.shelfY += page.shelfH; page.x = 0; page.shelfH = 0; }
    if (page.shelfY + h > max) newPage();
    page.placed.push({ ...it, x: page.x + pad, y: page.shelfY + pad });
    page.x += w;
    page.shelfH = Math.max(page.shelfH, h);
    page.usedW = Math.max(page.usedW, page.x);
    page.usedH = Math.max(page.usedH, page.shelfY + page.shelfH);
  }
  return pages;
}

function blitExtrude(dst, src, x0, y0, pad) {
  for (let y = -pad; y < src.height + pad; y++) {
    for (let x = -pad; x < src.width + pad; x++) {
      const sx = Math.min(src.width - 1, Math.max(0, x)), sy = Math.min(src.height - 1, Math.max(0, y));
      const i = (sy * src.width + sx) * 4;
      if (src.data[i + 3] === 0) continue;
      dst.setPixel(x0 + x, y0 + y, src.data[i], src.data[i + 1], src.data[i + 2], src.data[i + 3]);
    }
  }
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const re = new RegExp(o.filter);
  const files = fs.readdirSync(o.in).filter((f) => re.test(f) && f.endsWith('.png')).sort();
  if (files.length === 0) throw new Error(`Không có PNG khớp "${o.filter}" trong ${o.in}`);

  const items = files.map((f) => {
    let img = decodePNG(fs.readFileSync(path.join(o.in, f)));
    if (o.size > 0 && (img.width !== o.size || img.height !== o.size)) img = resizeArea(img, o.size, o.size);
    return { name: f.replace(/\.png$/, ''), img, w: img.width, h: img.height };
  });

  // An explicit extrusion reserves its own pixels in addition to clear padding.
  // Omitted --extrude preserves the legacy padding-as-extrusion behavior.
  const extrude = o.extrude ?? o.padding;
  const gutter = o.extrude === undefined ? o.padding : o.padding + extrude;
  if (!Number.isInteger(extrude) || extrude < 0) throw new Error('Invalid extrusion');
  const pages = shelfPack(items, o.max, gutter);
  fs.mkdirSync(o.out, { recursive: true });
  const frames = {};
  const meta = [];
  pages.forEach((p, k) => {
    const W = nextPow2(p.usedW), H = nextPow2(p.usedH);
    const sheet = new Image(W, H);
    for (const it of p.placed) {
      blitExtrude(sheet, it.img, it.x, it.y, extrude);
      frames[it.name] = { page: k, x: it.x, y: it.y, w: it.w, h: it.h };
    }
    const file = `${o.name}_${k}.png`;
    sheet.save(path.join(o.out, file));
    meta.push({ file, width: W, height: H, count: p.placed.length });
  });
  const json = { format: 'tutien-atlas', version: 1, name: o.name, maxSize: o.max, padding: o.padding, pages: meta, frames };
  if (o.extrude !== undefined) json.extrude = extrude;
  fs.writeFileSync(path.join(o.out, `${o.name}.json`), JSON.stringify(json, null, 2));
  console.log(`✔ ${o.name}: ${items.length} ảnh → ${meta.map((m) => `${m.file} ${m.width}×${m.height}`).join(', ')}`);
}

if (require.main === module) {
  try { main(); } catch (e) { console.error('✖', e.message); process.exit(e.exitCode || 1); }
}
module.exports = { shelfPack };
