#!/usr/bin/env node
'use strict';
/**
 * PROGRAMMATIC PAPERDOLL & ITEM ICON – Tu Tiên 2D
 * ----------------------------------------------------------------------------
 * Vẽ 100% bằng toán vector, xuất SVG (engine/Antigravity runtime render trực tiếp,
 * hoặc chuyển PNG bằng tools/svg_to_png.js):
 *
 *   1. Phi kiếm 8 hướng isometric: mô hình 3D tối giản (lưỡi 2 mặt vát, rãnh kiếm,
 *      hộ thủ, chuôi quấn, quả chặn, kiếm tuệ) -> xoay theo hướng -> chiếu dimetric 2:1
 *      -> tô sáng theo pháp tuyến (nguồn sáng NW) -> gradient phát sáng theo phẩm.
 *   2. Icon Đan dược: hình cầu shading cầu, đan văn là các vòng tròn trên mặt cầu được
 *      chiếu trực giao (vẽ nửa trước đậm, nửa sau mờ), hào quang theo cấp.
 *   3. Icon Phù lục: giấy vàng có vân sợi (feTurbulence), chữ triện sinh ngẫu nhiên trên
 *      lưới nét (có seed), viền chu sa, ký hiệu hệ, ấn triện cho phẩm cao.
 *
 * Chạy:  node src/items/generate_items.js --out out/items --seed 7
 * Yêu cầu: Node.js ≥ 18, không cần thư viện ngoài.
 */
const fs = require('fs');
const path = require('path');
const { mulberry32, hashString, clamp, lerp } = require('../lib/rng');

// ----------------------------------------------------------------------------
// Tiện ích chung
// ----------------------------------------------------------------------------
const f2 = (n) => (Math.round(n * 100) / 100).toString();
const pts = (arr) => arr.map((p) => `${f2(p[0])},${f2(p[1])}`).join(' ');
const hex = (c) => '#' + c.map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
const mixC = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const shade = (c, k) => [c[0] * k, c[1] * k, c[2] * k];
const norm3 = (v) => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };
const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];

/** 6 phẩm chất: Trắng, Lục, Lam, Tím, Vàng, Đỏ (khớp tài liệu UI). */
const TIERS = [
  { id: 'white',  glow: [232, 228, 218] },
  { id: 'green',  glow: [95, 191, 106] },
  { id: 'blue',   glow: [74, 144, 217] },
  { id: 'purple', glow: [160, 95, 214] },
  { id: 'gold',   glow: [232, 181, 64] },
  { id: 'red',    glow: [224, 72, 58] },
];

function svgDoc(w, h, body, defs = '') {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">` +
    `<defs>${defs}</defs>${body}</svg>\n`;
}

// ----------------------------------------------------------------------------
// 1. PHI KIẾM 8 HƯỚNG ISOMETRIC
// ----------------------------------------------------------------------------
/**
 * Hệ tọa độ cục bộ của kiếm: x dọc lưỡi (mũi kiếm ở +x), y ngang lưỡi, z hướng lên.
 * Hướng màn hình -> góc xoay quanh trục đứng (yaw) trong mặt đất. Với phép chiếu
 * sx = X − Y, sy = (X + Y)/2 − z·k, vector (1, −1) ra hướng E màn hình, (1, 0) ra SE…
 */
const DIRS = ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'];
const yawOf = (dir) => (-45 + 45 * DIRS.indexOf(dir)) * Math.PI / 180;

const ISO = {
  S: 0.72,                                   // thang ngang (kiếm dài nhất ở hướng E vẫn lọt ô 128)
  get SZ() { return this.S * Math.SQRT2 * Math.cos(Math.PI / 6); }, // thang đứng: camera nghiêng 30°
  VIEW: norm3([Math.cos(Math.PI / 6) / Math.SQRT2, Math.cos(Math.PI / 6) / Math.SQRT2, 0.5]), // hướng về camera
  LIGHT: norm3([-0.75, -0.15, 1.0]),         // nguồn sáng NW, từ trên xuống
};

function makeProjector(yaw, hover, cx, cy, center) {
  const c = Math.cos(yaw), s = Math.sin(yaw);
  const rot = (p) => [p[0] * c - p[1] * s, p[0] * s + p[1] * c, p[2]];
  const raw = (P) => [(P[0] - P[1]) * ISO.S, (P[0] + P[1]) * ISO.S / 2 - P[2] * ISO.SZ];
  const C = raw(rot(center));
  return {
    rot,
    /** cục bộ -> {screen, depth}; depth lớn = gần camera hơn */
    project(p, extraZ = hover) {
      const P = rot([p[0], p[1], p[2] + extraZ]);
      const r = raw(P);
      return { s: [r[0] - C[0] + cx, r[1] - C[1] + cy], depth: dot3(P, ISO.VIEW) };
    },
  };
}

const lightK = (nWorld) => 0.36 + 0.64 * Math.max(0, dot3(norm3(nWorld), ISO.LIGHT));

/** Hộp chữ nhật cục bộ -> các mặt nhìn thấy (đã khử mặt sau, có độ sáng). */
function boxFaces(prj, x0, x1, y0, y1, z0, z1, color, tag) {
  const V = (x, y, z) => [x, y, z];
  const quads = [
    [V(x0, y0, z1), V(x1, y0, z1), V(x1, y1, z1), V(x0, y1, z1)], // trên
    [V(x0, y0, z0), V(x0, y1, z0), V(x1, y1, z0), V(x1, y0, z0)], // dưới
    [V(x1, y0, z0), V(x1, y1, z0), V(x1, y1, z1), V(x1, y0, z1)], // +x
    [V(x0, y0, z0), V(x0, y0, z1), V(x0, y1, z1), V(x0, y1, z0)], // −x
    [V(x0, y1, z0), V(x0, y1, z1), V(x1, y1, z1), V(x1, y1, z0)], // +y
    [V(x0, y0, z0), V(x1, y0, z0), V(x1, y0, z1), V(x0, y0, z1)], // −y
  ];
  const out = [];
  for (const q of quads) {
    const w = q.map((p) => prj.rot(p));
    const n = cross3(sub3(w[1], w[0]), sub3(w[2], w[0]));
    if (dot3(n, ISO.VIEW) <= 0) continue;
    const pr = q.map((p) => prj.project(p));
    out.push({
      kind: 'poly', tag, points: pr.map((p) => p.s),
      depth: pr.reduce((a, p) => a + p.depth, 0) / pr.length,
      fill: hex(shade(color, lightK(n))),
    });
  }
  return out;
}

function swordSVG(dir, tierIdx, opts = {}) {
  const tier = TIERS[tierIdx];
  const SIZE = 128, L = 64, W0 = 5.6, T0 = 1.7, HOVER = 9;
  const steel = mixC([176, 186, 202], tier.glow, 0.18);
  const bronze = tierIdx >= 4 ? [214, 170, 72] : [150, 118, 78];
  const cloth = [120, 34, 38];
  const prj = makeProjector(yawOf(dir), HOVER, SIZE / 2, SIZE / 2 + 2, [18, 0, 0]);
  const prims = [];

  // --- Lưỡi kiếm: hai mặt vát gặp nhau ở sống kiếm ---
  const STEPS = 14;
  const wAt = (x) => W0 * (1 - Math.pow(x / L, 2.4));
  const tAt = (x) => T0 * (1 - x / L);
  for (const side of [1, -1]) {
    const edge = [], ridge = [];
    for (let k = 0; k <= STEPS; k++) {
      const x = (L * k) / STEPS;
      edge.push(prj.project([x, side * wAt(x), 0]));
      ridge.push(prj.project([x, 0, tAt(x)]));
    }
    const poly = [...edge, ...ridge.reverse()];
    const nLocal = [0, side * T0, W0];                     // pháp tuyến mặt vát
    const nWorld = prj.rot(nLocal);
    prims.push({
      kind: 'blade', points: poly.map((p) => p.s),
      depth: poly.reduce((a, p) => a + p.depth, 0) / poly.length + 0.01 * side,
      fill: hex(shade(steel, lightK(nWorld))),
    });
  }
  const tip = prj.project([L, 0, 0]).s, base = prj.project([0, 0, T0]).s;

  // --- Rãnh kiếm (fuller) và đường sáng sống kiếm ---
  const fuller = [], spine = [];
  for (let k = 0; k <= 10; k++) {
    const x = 3 + (L * 0.6 * k) / 10;
    fuller.push(prj.project([x, 0.9, tAt(x) * 0.7]).s);
    spine.push(prj.project([x * 1.45, 0, tAt(x * 1.45)]).s);
  }

  // --- Hộ thủ, chuôi, quả chặn ---
  prims.push(...boxFaces(prj, -3.6, 0, -11, 11, -1.6, 2.6, bronze, 'guard'));
  prims.push(...boxFaces(prj, -21, -3.6, -2.2, 2.2, -1.5, 1.5, cloth, 'grip'));
  const pommel = prj.project([-24.5, 0, 0]);
  const curlL = prj.project([-1.8, 12.4, 0.5]), curlR = prj.project([-1.8, -12.4, 0.5]);

  // --- Kiếm tuệ (dây tua) lắc theo hình sin ---
  const tassel = [];
  for (let k = 0; k <= 9; k++) {
    const s = k * 1.5;
    tassel.push(prj.project([-25 - s, 2.6 * Math.sin(s / 5 + (opts.phase || 0)), -s * 0.45]).s);
  }

  // --- Bóng đổ trên mặt đất (z = −hover) ---
  const shadowPoly = [];
  for (let k = 0; k <= STEPS; k++) shadowPoly.push(prj.project([(L * k) / STEPS, wAt((L * k) / STEPS) + 1, 0], 0).s);
  shadowPoly.push(prj.project([-25, 2.5, 0], 0).s, prj.project([-25, -2.5, 0], 0).s);
  for (let k = STEPS; k >= 0; k--) shadowPoly.push(prj.project([(L * k) / STEPS, -wAt((L * k) / STEPS) - 1, 0], 0).s);

  // --- Lắp SVG (vẽ theo độ sâu: xa trước, gần sau) ---
  const id = `sw_${dir}_${tier.id}`;
  const g = tier.glow;
  const defs =
    `<linearGradient id="${id}_glow" gradientUnits="userSpaceOnUse" x1="${f2(base[0])}" y1="${f2(base[1])}" x2="${f2(tip[0])}" y2="${f2(tip[1])}">` +
    `<stop offset="0" stop-color="${hex(g)}" stop-opacity="0"/><stop offset="0.55" stop-color="${hex(g)}" stop-opacity="0.25"/>` +
    `<stop offset="1" stop-color="${hex(mixC(g, [255, 255, 255], 0.5))}" stop-opacity="0.85"/></linearGradient>` +
    `<filter id="${id}_blur" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="${2 + tierIdx * 0.6}"/></filter>` +
    `<filter id="${id}_soft" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="1.6"/></filter>` +
    `<radialGradient id="${id}_pommel" cx="35%" cy="35%" r="70%"><stop offset="0" stop-color="${hex(mixC(bronze, [255, 255, 255], 0.5))}"/>` +
    `<stop offset="1" stop-color="${hex(shade(bronze, 0.55))}"/></radialGradient>`;

  const bladeOutline = pts(prims.filter((p) => p.kind === 'blade').flatMap((p) => p.points));
  let body = '';
  body += `<polygon points="${pts(shadowPoly)}" fill="#000" opacity="0.22" filter="url(#${id}_soft)"/>`;
  if (tierIdx >= 1) body += `<polygon points="${bladeOutline}" fill="${hex(g)}" opacity="${0.35 + tierIdx * 0.08}" filter="url(#${id}_blur)"/>`;
  body += `<polyline points="${pts(tassel)}" fill="none" stroke="${hex(tierIdx >= 4 ? g : [190, 40, 46])}" stroke-width="2.2" stroke-linecap="round"/>`;
  prims.sort((a, b) => a.depth - b.depth);
  for (const p of prims) {
    body += `<polygon points="${pts(p.points)}" fill="${p.fill}" stroke="${hex(shade(steel, 0.35))}" stroke-width="0.5" stroke-linejoin="round"/>`;
    if (p.kind === 'blade') body += `<polygon points="${pts(p.points)}" fill="url(#${id}_glow)"/>`;
  }
  body += `<polyline points="${pts(fuller)}" fill="none" stroke="${hex(shade(steel, 0.45))}" stroke-width="1.1" stroke-linecap="round" opacity="0.8"/>`;
  body += `<polyline points="${pts(spine)}" fill="none" stroke="#ffffff" stroke-width="0.7" stroke-linecap="round" opacity="0.7"/>`;
  for (const c of [curlL, curlR]) body += `<circle cx="${f2(c.s[0])}" cy="${f2(c.s[1])}" r="2.4" fill="${hex(bronze)}" stroke="${hex(shade(bronze, 0.5))}" stroke-width="0.6"/>`;
  body += `<circle cx="${f2(pommel.s[0])}" cy="${f2(pommel.s[1])}" r="3.6" fill="url(#${id}_pommel)"/>`;

  // Điểm đứng của người cưỡi kiếm (pivot cho paperdoll): giữa lưỡi, trên mặt kiếm.
  const stand = prj.project([20, 0, T0]).s;
  return { svg: { defs, body }, pivot: { x: Math.round(stand[0]), y: Math.round(stand[1]) } };
}

function buildSwords(outDir, tierIdx) {
  const cells = [];
  const frames = {};
  DIRS.forEach((dir, k) => {
    const { svg, pivot } = swordSVG(dir, tierIdx);
    fs.writeFileSync(path.join(outDir, `flying_sword_${dir}_${TIERS[tierIdx].id}.svg`), svgDoc(128, 128, svg.body, svg.defs));
    cells.push(`<g transform="translate(${k * 128},0)">${svg.body}</g>`);
    frames[dir] = { x: k * 128, y: 0, w: 128, h: 128, pivot, mirrorOf: null };
  });
  const defs = DIRS.map((d) => swordSVG(d, tierIdx).svg.defs).join('');
  fs.writeFileSync(path.join(outDir, `flying_sword_sheet_${TIERS[tierIdx].id}.svg`), svgDoc(1024, 128, cells.join(''), defs));
  return frames;
}

// ----------------------------------------------------------------------------
// 2. ICON ĐAN DƯỢC
// ----------------------------------------------------------------------------
const PILLS = {
  truc_co:      { name: 'Trúc Cơ Đan',        tier: 2, base: [86, 178, 120], core: [196, 255, 214], rings: 1, extra: 'lotus' },
  tay_tuy:      { name: 'Tẩy Tủy Đan',        tier: 3, base: [226, 220, 204], core: [255, 255, 250], rings: 2, extra: 'smoke' },
  cuu_chuyen:   { name: 'Cửu Chuyển Kim Đan', tier: 5, base: [232, 168, 52], core: [255, 120, 60], rings: 9, extra: 'rays' },
};

/** Vòng tròn trên mặt cầu đơn vị: pháp tuyến n, khoảng lệch c (0 = đường tròn lớn). Trả về các đoạn trước / sau. */
function sphereRing(n, c, segments = 96) {
  const a = norm3(Math.abs(n[2]) < 0.9 ? cross3(n, [0, 0, 1]) : cross3(n, [1, 0, 0]));
  const b = cross3(n, a);
  const r = Math.sqrt(Math.max(0, 1 - c * c));
  const front = [], back = [];
  let cur = null, curFront = null;
  for (let k = 0; k <= segments; k++) {
    const t = (k / segments) * Math.PI * 2;
    const p = [0, 1, 2].map((i) => c * n[i] + r * (Math.cos(t) * a[i] + Math.sin(t) * b[i]));
    const isFront = p[2] >= 0;
    if (isFront !== curFront) {
      if (cur && cur.length > 1) (curFront ? front : back).push(cur);
      cur = cur && cur.length ? [cur[cur.length - 1]] : [];
      curFront = isFront;
    }
    cur.push(p);
  }
  if (cur && cur.length > 1) (curFront ? front : back).push(cur);
  return { front, back };
}

function pillSVG(key, seed) {
  const P = PILLS[key];
  const rand = mulberry32(hashString(`pill-${key}-${seed}`));
  const tier = TIERS[P.tier];
  const cx = 128, cy = 132, R = 62;
  const id = `pill_${key}`;
  const toScr = (p) => [cx + p[0] * R, cy - p[1] * R];

  let defs =
    `<radialGradient id="${id}_halo" cx="50%" cy="50%" r="50%"><stop offset="0.35" stop-color="${hex(tier.glow)}" stop-opacity="${0.25 + P.tier * 0.08}"/>` +
    `<stop offset="1" stop-color="${hex(tier.glow)}" stop-opacity="0"/></radialGradient>` +
    `<radialGradient id="${id}_ball" cx="38%" cy="34%" r="72%"><stop offset="0" stop-color="${hex(P.core)}"/>` +
    `<stop offset="0.45" stop-color="${hex(P.base)}"/><stop offset="1" stop-color="${hex(shade(P.base, 0.42))}"/></radialGradient>` +
    `<filter id="${id}_blur" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="3"/></filter>`;

  let body = `<circle cx="${cx}" cy="${cy}" r="118" fill="url(#${id}_halo)"/>`;

  if (P.extra === 'rays') {
    // 4 tia lớn + 4 tia nhỏ, hình thoi thon
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4 + Math.PI / 8, len = k % 2 ? 78 : 112, wid = k % 2 ? 6 : 11;
      const tipP = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
      const l = [cx + Math.cos(a + Math.PI / 2) * wid, cy + Math.sin(a + Math.PI / 2) * wid];
      const r = [cx + Math.cos(a - Math.PI / 2) * wid, cy + Math.sin(a - Math.PI / 2) * wid];
      body += `<polygon points="${pts([l, tipP, r])}" fill="${hex(mixC(tier.glow, [255, 255, 255], 0.3))}" opacity="0.55"/>`;
    }
  }
  if (P.extra === 'lotus') {
    body += `<ellipse cx="${cx}" cy="${cy + 58}" rx="84" ry="24" fill="#3f8f5a"/>` +
      `<ellipse cx="${cx}" cy="${cy + 54}" rx="78" ry="20" fill="#5fb06e"/>`;
    for (let k = 0; k < 9; k++) {
      const a = Math.PI + (k / 8) * Math.PI;
      body += `<line x1="${cx}" y1="${cy + 54}" x2="${f2(cx + Math.cos(a) * 74)}" y2="${f2(cy + 54 - Math.sin(a) * -18)}" stroke="#3c7f50" stroke-width="1.4"/>`;
    }
  }

  body += `<ellipse cx="${cx}" cy="${cy + R + 4}" rx="${R * 0.8}" ry="${R * 0.18}" fill="#000" opacity="0.25" filter="url(#${id}_blur)"/>`;
  body += `<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${id}_ball)"/>`;

  // --- Đan văn: P.rings vòng, pháp tuyến rải đều quanh trục nghiêng (xoay quanh cầu) ---
  const ringColor = P.tier >= 4 ? [255, 236, 170] : mixC(P.base, [255, 255, 255], 0.65);
  // Ít vòng: các đường tròn lớn cắt chéo nhau. Nhiều vòng (Cửu Chuyển): 9 vĩ tuyến song song quanh
  // một trục nghiêng, như 9 tầng đan văn "chuyển" quanh viên đan.
  const axis = norm3([Math.sin(0.55) * Math.cos(0.4 + rand() * 0.3), Math.cos(0.55), Math.sin(0.55) * Math.sin(0.4)]);
  for (let k = 0; k < P.rings; k++) {
    let n, c;
    if (P.rings >= 5) {
      n = axis;
      c = -0.8 + (1.6 * k) / (P.rings - 1);
    } else {
      const phi = (k / P.rings) * Math.PI + 0.5 + rand() * 0.2;
      const theta = 1.05 + 0.25 * k;
      n = norm3([Math.sin(theta) * Math.cos(phi), Math.cos(theta), Math.sin(theta) * Math.sin(phi)]);
      c = 0;
    }
    const { front, back } = sphereRing(n, c);
    const width = P.rings >= 5 ? 1.5 : 2.4;
    for (const seg of back) body += `<polyline points="${pts(seg.map(toScr))}" fill="none" stroke="${hex(ringColor)}" stroke-width="${width}" opacity="0.18"/>`;
    for (const seg of front) body += `<polyline points="${pts(seg.map(toScr))}" fill="none" stroke="${hex(ringColor)}" stroke-width="${width}" stroke-linecap="round" opacity="0.9"/>`;
  }

  // Phản quang
  body += `<ellipse cx="${cx - R * 0.34}" cy="${cy - R * 0.4}" rx="${R * 0.22}" ry="${R * 0.13}" transform="rotate(-35 ${cx - R * 0.34} ${cy - R * 0.4})" fill="#fff" opacity="0.75"/>`;

  if (P.extra === 'smoke') {
    for (let k = 0; k < 2; k++) {
      const x0 = cx - 18 + k * 30;
      body += `<path d="M${x0} ${cy - R + 6} C ${x0 - 20} ${cy - R - 20}, ${x0 + 22} ${cy - R - 32}, ${x0 + 4} ${cy - R - 54}" fill="none" stroke="#ffffff" stroke-width="7" stroke-linecap="round" opacity="0.45" filter="url(#${id}_blur)"/>`;
    }
  }
  if (P.extra === 'rays') {
    for (let k = 0; k < 6; k++) {
      const a = rand() * Math.PI * 2, d = R + 14 + rand() * 30, x = cx + Math.cos(a) * d, y = cy + Math.sin(a) * d, s = 3 + rand() * 4;
      body += `<polygon points="${pts([[x, y - s * 2], [x + s * 0.5, y], [x, y + s * 2], [x - s * 0.5, y]])}" fill="#fff8d8"/>` +
        `<polygon points="${pts([[x - s * 2, y], [x, y - s * 0.5], [x + s * 2, y], [x, y + s * 0.5]])}" fill="#fff8d8"/>`;
    }
  }
  return { defs, body };
}

// ----------------------------------------------------------------------------
// 3. ICON PHÙ LỤC – chữ triện sinh ngẫu nhiên
// ----------------------------------------------------------------------------
/** Sinh một chữ triện giả trên lưới 4 × 4 điểm, trả về danh sách đoạn thẳng (theo ô lưới). */
function sealGlyph(rand) {
  const segs = new Set();
  const add = (a, b) => {
    const k = a[0] < b[0] || (a[0] === b[0] && a[1] <= b[1]) ? `${a}|${b}` : `${b}|${a}`;
    segs.add(k);
  };
  const H = (r, c0, c1) => { for (let c = c0; c < c1; c++) add([c, r], [c + 1, r]); };
  const V = (c, r0, r1) => { for (let r = r0; r < r1; r++) add([c, r], [c, r + 1]); };
  const ri = (a, b) => a + Math.floor(rand() * (b - a + 1));

  H(ri(0, 1), 0, 3);                                   // nét ngang chủ đạo
  const n = ri(3, 5);
  for (let k = 0; k < n; k++) {
    const t = rand();
    if (t < 0.32) { const c0 = ri(0, 2); H(ri(0, 3), c0, ri(c0 + 1, 3)); }
    else if (t < 0.62) { const r0 = ri(0, 2); V(ri(0, 3), r0, ri(r0 + 1, 3)); }
    else if (t < 0.82) { const c0 = ri(0, 1), r0 = ri(0, 1), c1 = ri(c0 + 1, 3), r1 = ri(r0 + 1, 3); H(r0, c0, c1); H(r1, c0, c1); V(c0, r0, r1); V(c1, r0, r1); }
    else { const c = ri(1, 2), r0 = ri(0, 1); V(c, r0, 3); H(3, c, ri(c + 1, 3)); }   // móc chữ L
  }
  if (rand() < 0.5) {                                  // đối xứng trái – phải
    for (const k of [...segs]) {
      const [a, b] = k.split('|').map((s) => s.split(',').map(Number));
      add([3 - a[0], a[1]], [3 - b[0], b[1]]);
    }
  }
  return [...segs].map((k) => k.split('|').map((s) => s.split(',').map(Number)));
}

const ELEMENT_MARKS = {
  loi: (x, y) => `M${x - 8} ${y - 8} L${x + 2} ${y - 1} L${x - 3} ${y + 1} L${x + 8} ${y + 9}`,                 // tia sét
  hoa: (x, y) => `M${x} ${y - 10} C ${x + 9} ${y - 2}, ${x + 7} ${y + 8}, ${x} ${y + 9} C ${x - 7} ${y + 8}, ${x - 9} ${y - 2}, ${x} ${y - 10} Z`,
  thuy: (x, y) => `M${x - 9} ${y - 3} q 4.5 -5 9 0 t 9 0 M${x - 9} ${y + 4} q 4.5 -5 9 0 t 9 0`,
  kim: (x, y) => `M${x} ${y - 9} L${x + 8} ${y} L${x} ${y + 9} L${x - 8} ${y} Z`,
  moc: (x, y) => `M${x} ${y + 9} L${x} ${y - 9} M${x} ${y - 2} L${x - 7} ${y - 8} M${x} ${y + 2} L${x + 7} ${y - 4}`,
  tho: (x, y) => `M${x - 9} ${y + 6} L${x + 9} ${y + 6} M${x - 6} ${y} L${x + 6} ${y} M${x} ${y - 9} L${x} ${y + 6}`,
};

function talismanSVG(seed, tierIdx, element) {
  const rand = mulberry32(hashString(`talisman-${seed}-${element}`));
  const tier = TIERS[tierIdx];
  const id = `tal_${seed}_${element}`;
  const ink = '#b3121b';
  const X0 = 78, Y0 = 22, PW = 100, PH = 206;
  const defs =
    `<linearGradient id="${id}_paper" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#efcb5c"/><stop offset="1" stop-color="#d7a43a"/></linearGradient>` +
    `<clipPath id="${id}_clip"><rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" rx="3"/></clipPath>` +
    `<filter id="${id}_fiber" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9 0.08" numOctaves="2" seed="${seed}"/>` +
    `<feColorMatrix values="0 0 0 0 0.45  0 0 0 0 0.3  0 0 0 0 0.05  0 0 0 0.5 0"/></filter>` +
    `<filter id="${id}_brush" x="-10%" y="-10%" width="120%" height="120%"><feTurbulence type="fractalNoise" baseFrequency="0.6" numOctaves="2" seed="${seed + 3}" result="n"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="n" scale="2.6"/></filter>` +
    `<filter id="${id}_glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3"/></filter>`;

  let paper = `<rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" rx="3" fill="url(#${id}_paper)"/>` +
    `<rect x="${X0}" y="${Y0}" width="${PW}" height="${PH}" clip-path="url(#${id}_clip)" filter="url(#${id}_fiber)" opacity="0.35"/>` +
    `<rect x="${X0 + 6}" y="${Y0 + 6}" width="${PW - 12}" height="${PH - 12}" fill="none" stroke="${ink}" stroke-width="2.2"/>` +
    `<rect x="${X0 + 10}" y="${Y0 + 10}" width="${PW - 20}" height="${PH - 20}" fill="none" stroke="${ink}" stroke-width="0.9"/>`;

  // Ký hiệu hệ trong vòng tròn ở đầu bùa
  const ex = X0 + PW / 2, ey = Y0 + 30;
  let script = `<circle cx="${ex}" cy="${ey}" r="13" fill="none" stroke="${ink}" stroke-width="2"/>` +
    `<path d="${ELEMENT_MARKS[element](ex, ey)}" fill="${element === 'hoa' || element === 'kim' ? ink : 'none'}" stroke="${ink}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/>`;

  // 3 chữ triện xếp dọc
  const gw = 54, gh = 40, gx = X0 + (PW - gw) / 2;
  for (let k = 0; k < 3; k++) {
    const gy = Y0 + 54 + k * 46;
    const segs = sealGlyph(rand);
    const d = segs.map(([a, b]) => `M${f2(gx + (a[0] * gw) / 3)} ${f2(gy + (a[1] * gh) / 3)} L${f2(gx + (b[0] * gw) / 3)} ${f2(gy + (b[1] * gh) / 3)}`).join(' ');
    const sw = 4.6 + rand() * 1.2;
    script += `<path d="${d}" fill="none" stroke="${ink}" stroke-width="${f2(sw)}" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<path d="${d}" fill="none" stroke="#7a0a10" stroke-width="${f2(sw * 0.35)}" stroke-linecap="round" opacity="0.5" transform="translate(0.8,0.6)"/>`;
  }
  // Nét "sắc lệnh" kéo dài xuống, cuộn xoắn ở đuôi
  const sx = X0 + PW / 2, sy = Y0 + 186;
  script += `<path d="M${sx} ${Y0 + 182} L${sx} ${sy + 6} c 0 8, 10 8, 10 0 s -6 -8, -12 -2" fill="none" stroke="${ink}" stroke-width="3" stroke-linecap="round"/>`;

  let body = '';
  if (tierIdx >= 4) body += `<rect x="${X0 - 4}" y="${Y0 - 4}" width="${PW + 8}" height="${PH + 8}" rx="6" fill="${hex(tier.glow)}" opacity="0.55" filter="url(#${id}_glow)"/>`;
  body += paper;
  if (tierIdx >= 3) body += `<g filter="url(#${id}_glow)" opacity="0.6">${script.replace(new RegExp(ink, 'g'), '#ff3b3b')}</g>`;
  body += `<g filter="url(#${id}_brush)">${script}</g>`;
  if (tierIdx >= 4) {
    // Ấn triện vuông ở góc dưới trái, nét trắng sinh ngẫu nhiên
    const s = 22, ax = X0 + 12, ay = Y0 + PH - 40;
    const seal = sealGlyph(rand).map(([a, b]) => `M${f2(ax + 3 + (a[0] * (s - 6)) / 3)} ${f2(ay + 3 + (a[1] * (s - 6)) / 3)} L${f2(ax + 3 + (b[0] * (s - 6)) / 3)} ${f2(ay + 3 + (b[1] * (s - 6)) / 3)}`).join(' ');
    body += `<rect x="${ax}" y="${ay}" width="${s}" height="${s}" rx="2" fill="${ink}"/><path d="${seal}" stroke="#f6e7c8" stroke-width="1.6" stroke-linecap="square" fill="none"/>`;
  }
  // Đuôi lụa
  body += `<path d="M${X0 + PW / 2} ${Y0 + PH} c -6 10, 8 16, 2 26" fill="none" stroke="${ink}" stroke-width="3.2" stroke-linecap="round"/>`;
  return { defs, body: `<g transform="rotate(-15 128 128)">${body}</g>` };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function parseArgs(argv) {
  const o = { out: 'out/items', seed: 7, swordTier: 4 };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-zA-Z]+)(?:=(.*))?$/);
    if (!m) continue;
    const v = m[2] !== undefined ? m[2] : argv[++i];
    o[m[1]] = m[1] === 'out' ? v : Number(v);
  }
  return o;
}

function main() {
  const o = parseArgs(process.argv.slice(2));
  const dirs = { swords: path.join(o.out, 'swords'), icons: path.join(o.out, 'icons') };
  Object.values(dirs).forEach((d) => fs.mkdirSync(d, { recursive: true }));

  // Phi kiếm: 8 hướng × (phẩm Lam và phẩm cấu hình) + sheet + JSON pivot cho paperdoll
  const swordMeta = {};
  for (const t of [...new Set([2, o.swordTier])]) swordMeta[TIERS[t].id] = buildSwords(dirs.swords, t);
  fs.writeFileSync(path.join(dirs.swords, 'flying_sword_frames.json'), JSON.stringify({
    cell: { w: 128, h: 128 }, directions: DIRS, note: 'pivot = điểm đứng của người cưỡi kiếm (paperdoll gắn root vào đây)',
    tiers: swordMeta,
  }, null, 2));

  // Đan dược
  const pillCells = [];
  const pillDefs = [];
  Object.keys(PILLS).forEach((key, k) => {
    const s = pillSVG(key, o.seed);
    fs.writeFileSync(path.join(dirs.icons, `pill_${key}.svg`), svgDoc(256, 256, s.body, s.defs));
    pillCells.push(`<g transform="translate(${k * 256},0)">${s.body}</g>`);
    pillDefs.push(s.defs);
  });
  fs.writeFileSync(path.join(dirs.icons, 'pills_sheet.svg'), svgDoc(256 * pillCells.length, 256, pillCells.join(''), pillDefs.join('')));

  // Phù lục: 6 lá, mỗi lá một seed / phẩm / hệ khác nhau
  const talCells = [], talDefs = [];
  const els = ['loi', 'hoa', 'thuy', 'kim', 'moc', 'tho'];
  els.forEach((el, k) => {
    const s = talismanSVG(o.seed * 100 + k, k, el);
    fs.writeFileSync(path.join(dirs.icons, `talisman_${el}_${TIERS[k].id}.svg`), svgDoc(256, 256, s.body, s.defs));
    talCells.push(`<g transform="translate(${k * 256},0)">${s.body}</g>`);
    talDefs.push(s.defs);
  });
  fs.writeFileSync(path.join(dirs.icons, 'talismans_sheet.svg'), svgDoc(256 * talCells.length, 256, talCells.join(''), talDefs.join('')));

  console.log(`✔ Phi kiếm 8 hướng → ${dirs.swords}`);
  console.log(`✔ Icon đan dược (${Object.keys(PILLS).length}) và phù lục (${els.length}) → ${dirs.icons}`);
}

if (require.main === module) main();
module.exports = { swordSVG, pillSVG, talismanSVG, sealGlyph, TIERS, DIRS };
