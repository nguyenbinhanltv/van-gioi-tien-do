#!/usr/bin/env node
'use strict';
/**
 * PROCEDURAL ISOMETRIC TILEMAP GENERATOR – Tu Tiên 2D
 * ----------------------------------------------------------------------------
 * Sinh toàn bộ bằng code, không dùng ảnh nguồn:
 *   1. Địa hình: Simplex noise + fBm sinh chất liệu tại từng ĐỈNH lưới (corner).
 *   2. Tile hình thoi 2:1 (mặc định 128 × 64 px) vẽ từng pixel bằng texture toán học
 *      lặp chu kỳ, nên mọi tile ghép liền mép.
 *   3. Nối viền Wang theo góc (corner Wang, 16 mặt nạ) cho 3 chất liệu xếp lớp:
 *        Hồ Nước Linh Tuyền (nền)  <  Đất  <  Cỏ Tiên
 *      Mỗi lớp trên là một tile có alpha phủ lên lớp dưới (cách xếp lớp Ground_Liquid /
 *      Ground_Transition trong tài liệu Tilemap).
 *   4. Xuất: tileset.png (sprite sheet lũy thừa 2, padding + extrude), tileset.json,
 *      map.json (tọa độ lát gạch từng lớp) và map_preview.png.
 *
 * Chạy:  node src/tilemap/generate_tilemap.js --seed 20261031 --width 32 --height 32 --out out/tilemap
 * Yêu cầu: Node.js ≥ 18, không cần thư viện ngoài.
 */
const fs = require('fs');
const path = require('path');
const { Image } = require('../lib/png');
const { makeSimplex2D, fbm, periodicFbm, periodicNoise, hash2i } = require('../lib/noise');
const { clamp, lerp, smoothstep } = require('../lib/rng');
const G = require('./ground_textures');
const Z = require('./zones');

// ----------------------------------------------------------------------------
// Cấu hình
// ----------------------------------------------------------------------------
const DEFAULTS = {
  seed: 20261031,
  width: 32,            // số ô theo trục i
  height: 32,           // số ô theo trục j
  out: 'out/tilemap',
  tileW: 128,           // tỷ lệ 2:1 bắt buộc: tileH = tileW / 2
  noiseScale: 0.085,    // tần số noise trên mỗi đỉnh lưới
  waterLevel: 0.43,     // dưới ngưỡng này là Hồ Linh Tuyền
  grassLevel: 0.50,     // độ ẩm trên ngưỡng này là Cỏ Tiên
  previewScale: 0.5,    // thu nhỏ ảnh xem trước cho nhẹ
  waterFrames: 4,       // số frame động của nước
  variants: 4,          // số biến thể ô thuần
  atlasWidth: 1024,
  padding: 2,
  ground: '',           // thư mục patch tuần hoàn (npm run gen:gemini): có thì lấy màu từ ảnh thay vì texture toán học
  zones: 0,             // 1 = bản đồ 4 vùng docs/10 §4 (D95): cần --ground; gộp tileset bổ sung vào tileset chính
  ext: 0,               // 1 = sinh thêm tileset_ext (bờ đá, vỏ nham thạch, đầm lầy) cạnh tileset chính
};

const MAT = { WATER: 0, DIRT: 1, GRASS: 2 };
const MAT_NAMES = ['water', 'dirt', 'grass'];
const CORNER_BITS = { N: 1, E: 2, S: 4, W: 8 };

// Lớp phủ: ngưỡng lệch nhau để luôn lộ một dải đất giữa nước và cỏ.
const OVERLAYS = [
  { name: 'dirt', material: 'dirt', over: 'water', minMat: MAT.DIRT, threshold: 0.40, seed: 1301, rimDark: 0.30, foam: true },
  { name: 'grass', material: 'grass', over: 'dirt', minMat: MAT.GRASS, threshold: 0.58, seed: 2903, rimDark: 0.20, foam: false },
];

// Họ ghép viền bổ sung (chỉ có khi có ảnh nền): bờ đá cạnh nước, vỏ đá nguội trên nham thạch (viền sáng đỏ), bờ đầm lầy.
const EXT_LAYERS = [
  { name: 'stone_bank', material: 'stone', over: 'water', threshold: 0.45, seed: 3301, rimDark: 0.28, foam: true },
  { name: 'lava_crust', material: 'stone', over: 'lava', threshold: 0.5, seed: 3907, rimDark: 0.35, foam: true, foamColor: [255, 118, 40] },
  { name: 'swamp_bank', material: 'swamp', over: 'water', threshold: 0.45, seed: 4421, rimDark: 0.3, foam: false },
];

/** Patch ảnh nền đang dùng (null = texture toán học như trước). */
let GROUND = null;

function parseArgs(argv) {
  const o = { ...DEFAULTS };
  for (let i = 0; i < argv.length; i++) {
    const m = argv[i].match(/^--([a-zA-Z]+)(?:=(.*))?$/);
    if (!m) continue;
    const key = m[1];
    const val = m[2] !== undefined ? m[2] : argv[++i];
    if (!(key in o)) throw new Error(`Tham số không hợp lệ: --${key}`);
    o[key] = typeof DEFAULTS[key] === 'number' ? Number(val) : val;
  }
  if (o.tileW % 2 !== 0) throw new Error('tileW phải là số chẵn (tỷ lệ 2:1)');
  o.tileH = o.tileW / 2;
  return o;
}

// ----------------------------------------------------------------------------
// 1. Địa hình: chất liệu tại từng đỉnh lưới (W + 1) × (H + 1)
// ----------------------------------------------------------------------------
/** Noise fields at a corner: `{ h, m }` (height, moisture) in 0..1. Shared by the base map and the zone map. */
function makeFields(o) {
  const heightNoise = makeSimplex2D(o.seed);
  const moistNoise = makeSimplex2D((o.seed ^ 0x9e3779b9) >>> 0);
  // Xoay miền lấy mẫu một góc lẻ và dịch theo seed: tránh vệt thẳng theo đường chéo của lưới
  // simplex trùng với trục i = j (trên màn hình isometric sẽ thành một đường dọc rất lộ).
  const ang = 0.61, ca = Math.cos(ang), sa = Math.sin(ang);
  const offX = (o.seed % 997) * 0.37, offY = (o.seed % 991) * 0.53;
  const sample = (i, j, k) => [(i * ca - j * sa) * k + offX, (i * sa + j * ca) * k + offY];
  return (i, j) => {
    const [hx, hy] = sample(i, j, o.noiseScale);
    const [mx, my] = sample(i, j, o.noiseScale * 1.4);
    return {
      h: (fbm(heightNoise, hx, hy, 5) + 1) / 2,
      m: (fbm(moistNoise, mx + 37.1, my - 11.7, 4) + 1) / 2,
    };
  };
}

function generateCorners(o) {
  const W1 = o.width + 1, H1 = o.height + 1;
  const fields = makeFields(o);
  const corners = new Uint8Array(W1 * H1);
  for (let j = 0; j < H1; j++) {
    for (let i = 0; i < W1; i++) {
      const { h, m } = fields(i, j);
      corners[j * W1 + i] = h < o.waterLevel ? MAT.WATER : m > o.grassLevel ? MAT.GRASS : MAT.DIRT;
    }
  }

  // Dọn đốm lẻ: đỉnh không có láng giềng 4 hướng nào cùng chất liệu thì lấy chất liệu phổ biến nhất.
  for (let pass = 0; pass < 2; pass++) {
    const copy = corners.slice();
    for (let j = 0; j < H1; j++) {
      for (let i = 0; i < W1; i++) {
        const me = copy[j * W1 + i];
        const counts = [0, 0, 0];
        let same = 0;
        for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const ni = i + di, nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= W1 || nj >= H1) continue;
          const nm = copy[nj * W1 + ni];
          counts[nm]++;
          if (nm === me) same++;
        }
        if (same === 0) corners[j * W1 + i] = counts.indexOf(Math.max(...counts));
      }
    }
  }
  return { W1, H1, data: corners };
}

// ----------------------------------------------------------------------------
// 2. Vẽ tile hình thoi bằng toán
// ----------------------------------------------------------------------------
const mix3 = (a, b, t) => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const scale3 = (c, k) => [c[0] * k, c[1] * k, c[2] * k];

const PALETTE = {
  waterDeep: [16, 62, 92], waterLight: [52, 160, 176], spirit: [176, 255, 236], foam: [214, 246, 240],
  dirtDark: [86, 62, 42], dirtLight: [146, 112, 76], pebble: [178, 160, 128],
  grassDark: [52, 112, 58], grassLight: [118, 186, 92], blade: [160, 214, 112], flower: [150, 240, 255],
};

/** Tọa độ pixel (tâm pixel) -> tọa độ cục bộ (u, v) của ô: đỉnh N=(0,0), E=(1,0), S=(1,1), W=(0,1). */
function pixelToUV(px, py, TW, TH) {
  const dx = (px - TW / 2) / (TW / 2);
  const dy = py / (TH / 2);
  return [(dy + dx) / 2, (dy - dx) / 2];
}

/** Trọng số bên trong ô: bằng 0 trên mọi cạnh -> chi tiết riêng của biến thể không làm lệch mép. */
const interiorWeight = (u, v) => Math.max(0, Math.sin(Math.PI * clamp(u, 0, 1)) * Math.sin(Math.PI * clamp(v, 0, 1)));

function waterColor(u, v, frame, frames) {
  if (GROUND && GROUND.water) return G.liquidColor(GROUND, 'water', u, v, frame, frames);
  const t = frame / frames; // dịch pha theo frame; f(u + t) vẫn lặp chu kỳ 1 nên vòng lặp liền mạch
  const n1 = periodicFbm(u + t, v, 4, 11, 3);
  const n2 = periodicFbm(u, v - t, 4, 23, 3);
  let c = mix3(PALETTE.waterDeep, PALETTE.waterLight, smoothstep(0.25, 0.85, n1 * 0.6 + n2 * 0.4));
  const caustic = Math.pow(clamp(1 - Math.abs(n1 - n2) * 3.0, 0, 1), 8);
  c = mix3(c, PALETTE.spirit, caustic * 0.55);
  const sparkle = periodicNoise(u + t * 0.5, v + t * 0.5, 32, 77);
  if (sparkle > 0.9) c = mix3(c, PALETTE.spirit, (sparkle - 0.9) * 6);
  return c;
}

function dirtColor(u, v, variant) {
  const w = interiorWeight(u, v);
  const base = periodicFbm(u, v, 4, 31, 4);
  const vn = periodicFbm(u, v, 8, 500 + variant * 97, 3);
  let c = mix3(PALETTE.dirtDark, PALETTE.dirtLight, clamp(base + w * (vn - 0.5) * 0.7, 0, 1));
  const pebble = periodicNoise(u, v, 24, 41);
  if (pebble > 0.82) c = mix3(c, PALETTE.pebble, (pebble - 0.82) * 4);
  const vPebble = periodicNoise(u, v, 20, 900 + variant);
  if (vPebble > 0.86 && w > 0.2) c = mix3(c, scale3(PALETTE.dirtDark, 0.7), (vPebble - 0.86) * 5 * w);
  return c;
}

function grassColor(u, v, variant) {
  const w = interiorWeight(u, v);
  const base = periodicFbm(u, v, 4, 51, 4);
  const vn = periodicFbm(u, v, 8, 1200 + variant * 131, 3);
  let c = mix3(PALETTE.grassDark, PALETTE.grassLight, clamp(base + w * (vn - 0.5) * 0.6, 0, 1));
  const blade = periodicNoise(u, v, 48, 61);
  if (blade > 0.7) c = mix3(c, PALETTE.blade, (blade - 0.7) * 2.2);
  // Hoa linh thảo phát sáng: chỉ ở phần giữa ô và khác nhau theo biến thể.
  const flower = periodicNoise(u, v, 16, 700 + variant * 53);
  if (variant > 0 && flower > 0.88 && w > 0.35) c = mix3(c, PALETTE.flower, (flower - 0.88) * 8 * w);
  return c;
}

const materialColor = (name, u, v, variant) => {
  if (GROUND && GROUND[name]) return G.landColor(GROUND, name, u, v, variant, interiorWeight(u, v));
  return name === 'dirt' ? dirtColor(u, v, variant) : grassColor(u, v, variant);
};

/** Nội suy song tuyến tính giá trị 4 góc theo (u, v). */
function cornerField(mask, u, v) {
  const N = mask & CORNER_BITS.N ? 1 : 0, E = mask & CORNER_BITS.E ? 1 : 0;
  const S = mask & CORNER_BITS.S ? 1 : 0, Wc = mask & CORNER_BITS.W ? 1 : 0;
  const cu = clamp(u, 0, 1), cv = clamp(v, 0, 1);
  return N * (1 - cu) * (1 - cv) + E * cu * (1 - cv) + S * cu * cv + Wc * (1 - cu) * cv;
}

/**
 * Vẽ một tile. kind: 'water' | 'overlay'. Hình thoi được nới 0,8 px để hai ô kề nhau chồng
 * lên nhau một chút, tránh khe sáng khi ghép.
 */
function renderTile(o, spec) {
  const { tileW: TW, tileH: TH } = o;
  const img = new Image(TW, TH);
  const EXPAND = 0.8;
  for (let y = 0; y < TH; y++) {
    for (let x = 0; x < TW; x++) {
      const px = x + 0.5, py = y + 0.5;
      const inside = Math.abs(px - TW / 2) / (TW / 2 + EXPAND) + Math.abs(py - TH / 2) / (TH / 2 + EXPAND / 2) <= 1;
      if (!inside) continue;
      const [u, v] = pixelToUV(px, py, TW, TH);

      if (spec.kind === 'water') {
        const c = spec.liquid === 'lava' && GROUND && GROUND.lava ? G.liquidColor(GROUND, 'lava', u, v, spec.frame, o.waterFrames) : waterColor(u, v, spec.frame, o.waterFrames);
        img.setPixel(x, y, c[0], c[1], c[2], 255);
        continue;
      }

      const L = spec.layer;
      const w = interiorWeight(u, v);
      const pert = (periodicFbm(u, v, 4, L.seed, 3) - 0.5) * 0.55 * w;
      const val = cornerField(spec.mask, u, v) + pert;
      const e = 0.025;
      const cov = smoothstep(L.threshold - e, L.threshold + e, val);
      const rim = 1 - smoothstep(0, 0.09, val - L.threshold); // dải sát mép bên trong
      const foam = L.foam ? smoothstep(L.threshold - 0.11, L.threshold - 0.015, val) * (1 - cov) : 0;
      if (cov <= 0.001 && foam <= 0.001) continue;

      const m = scale3(materialColor(L.material || L.name, u, v, spec.variant), 1 - L.rimDark * rim * cov);
      const aM = cov, aF = foam * 0.55;
      const a = aM + aF * (1 - aM);
      const foamRgb = L.foamColor || PALETTE.foam;
      const rgb = [0, 1, 2].map((k) => (m[k] * aM + foamRgb[k] * aF * (1 - aM)) / a);
      img.setPixel(x, y, rgb[0], rgb[1], rgb[2], Math.round(a * 255));
    }
  }
  return img;
}

// ----------------------------------------------------------------------------
// 3. Danh sách tile + đóng gói sprite sheet
// ----------------------------------------------------------------------------
function buildTileList(o) {
  const list = [];
  for (let f = 0; f < o.waterFrames; f++) list.push({ name: `water_${f}`, kind: 'water', frame: f });
  for (const L of OVERLAYS) {
    for (let v = 0; v < o.variants; v++) list.push({ name: `${L.name}_full_${v}`, kind: 'overlay', layer: L, mask: 15, variant: v });
    for (let m = 1; m <= 14; m++) {
      list.push({ name: `${L.name}_m${String(m).padStart(2, '0')}`, kind: 'overlay', layer: L, mask: m, variant: 0 });
    }
  }
  return list;
}

const nextPow2 = (n) => 2 ** Math.ceil(Math.log2(n));

/** Ghi tile vào ô atlas, kéo dài (extrude) pixel biên ra vùng padding để chống rò màu khi lọc texture. */
function blitExtruded(sheet, tile, x0, y0, pad) {
  for (let y = -pad; y < tile.height + pad; y++) {
    for (let x = -pad; x < tile.width + pad; x++) {
      const sx = clamp(x, 0, tile.width - 1), sy = clamp(y, 0, tile.height - 1);
      const [r, g, b, a] = tile.getPixel(sx, sy);
      if (a === 0) continue;
      sheet.setPixel(x0 + x, y0 + y, r, g, b, a);
    }
  }
}

function packAtlas(o, tiles) {
  const cellW = o.tileW + o.padding * 2, cellH = o.tileH + o.padding * 2;
  const cols = Math.floor(o.atlasWidth / cellW);
  const rows = Math.ceil(tiles.length / cols);
  const sheet = new Image(o.atlasWidth, nextPow2(rows * cellH));
  const frames = tiles.map((t, idx) => {
    const x = (idx % cols) * cellW + o.padding;
    const y = Math.floor(idx / cols) * cellH + o.padding;
    blitExtruded(sheet, t.image, x, y, o.padding);
    return { id: idx, name: t.name, x, y, w: o.tileW, h: o.tileH };
  });
  return { sheet, frames };
}

// ----------------------------------------------------------------------------
// 4. Ghép bản đồ: chọn tile cho từng ô theo mặt nạ 4 góc
// ----------------------------------------------------------------------------
function pickVariant(i, j, seed, variants) {
  const r = hash2i(i, j, seed);
  if (r < 0.7) return 0;                       // trọng số 70 / 10 / 10 / 10
  return 1 + Math.min(variants - 2, Math.floor((r - 0.7) / (0.3 / (variants - 1))));
}

function buildMap(o, corners, idByName) {
  const N = o.width * o.height;
  const layers = { liquid: new Array(N).fill(-1), dirt: new Array(N).fill(-1), grass: new Array(N).fill(-1) };
  const stats = { water: 0, dirt: 0, grass: 0 };
  const cAt = (i, j) => corners.data[j * corners.W1 + i];

  for (let j = 0; j < o.height; j++) {
    for (let i = 0; i < o.width; i++) {
      const k = j * o.width + i;
      const cs = { N: cAt(i, j), E: cAt(i + 1, j), S: cAt(i + 1, j + 1), W: cAt(i, j + 1) };
      const maskFor = (minMat) =>
        (cs.N >= minMat ? CORNER_BITS.N : 0) | (cs.E >= minMat ? CORNER_BITS.E : 0) |
        (cs.S >= minMat ? CORNER_BITS.S : 0) | (cs.W >= minMat ? CORNER_BITS.W : 0);

      const dirtMask = maskFor(MAT.DIRT);
      if (dirtMask !== 15) layers.liquid[k] = idByName['water_0']; // chỉ vẽ nước khi ô thật sự có nước
      for (const L of OVERLAYS) {
        const m = maskFor(L.minMat);
        if (m === 0) continue;
        const name = m === 15
          ? `${L.name}_full_${pickVariant(i, j, o.seed + L.seed, o.variants)}`
          : `${L.name}_m${String(m).padStart(2, '0')}`;
        layers[L.name][k] = idByName[name];
      }
      const center = Math.max(cs.N, cs.E, cs.S, cs.W);
      stats[MAT_NAMES[center]]++;
    }
  }
  return { layers, stats };
}

/** Layer seeds of the tile variants (base + ext layers), so a layer picks the same variants in every map it appears in. */
const LAYER_SEEDS = Object.fromEntries([...OVERLAYS, ...EXT_LAYERS].map((L) => [L.name, L.seed]));

/**
 * Zone map (D95): each cell takes the tile stack of ITS zone (`zones.js` STACKS) from the corner levels. Same Wang rule as `buildMap`.
 * Returns `{ layers, stats, rows }`; `rows` is the walkability grid (`.` land, `#` water / lava only), the rule the client uses too:
 * a cell is walkable when any layer above the liquid is drawn in it.
 */
function buildZoneMap(o, zc, idByName) {
  const n = o.width;
  const N = n * n;
  const layers = Object.fromEntries(Z.LAYER_ORDER.map((name) => [name, new Array(N).fill(-1)]));
  const stats = Object.fromEntries(Z.ZONE_IDS.map((id) => [id, { liquid: 0, dirt: 0, ground: 0, stone: 0 }]));
  const levelNames = ['liquid', 'dirt', 'ground', 'stone'];
  const lv = (i, j) => zc.level[j * zc.W1 + i];
  const rows = [];
  for (let j = 0; j < n; j++) {
    let row = '';
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const cs = { N: lv(i, j), E: lv(i + 1, j), S: lv(i + 1, j + 1), W: lv(i, j + 1) };
      const maskFor = (min) =>
        (cs.N >= min ? CORNER_BITS.N : 0) | (cs.E >= min ? CORNER_BITS.E : 0) |
        (cs.S >= min ? CORNER_BITS.S : 0) | (cs.W >= min ? CORNER_BITS.W : 0);
      const zi = Z.zoneIndexAt(i + 0.5, j + 0.5, n);
      const zoneId = Z.ZONE_IDS[zi];
      const stack = Z.STACKS[zoneId];
      if (maskFor(1) !== 15) layers.liquid[k] = idByName[stack.liquid === 'lava' ? 'lava_0' : 'water_0'];
      let land = false;
      let topFull = -1; // index in `stack.layers` of the highest FULL (opaque, mask 15) tile of this cell
      stack.layers.forEach((L, n) => {
        const m = maskFor(L.min);
        if (m === 0 || (L.fullOnly && m !== 15)) return;
        const name = m === 15
          ? `${L.name}_full_${pickVariant(i, j, o.seed + LAYER_SEEDS[L.name], o.variants)}`
          : `${L.name}_m${String(m).padStart(2, '0')}`;
        layers[L.name][k] = idByName[name];
        land = true;
        if (m === 15) topFull = n;
      });
      // a full tile is opaque over its whole diamond: everything under it in this cell is invisible, so it is not emitted (fewer
      // sprites per chunk -> fewer nodes and draw calls on the client)
      if (topFull >= 0) {
        layers.liquid[k] = -1;
        for (let n = 0; n < topFull; n++) layers[stack.layers[n].name][k] = -1;
      }
      row += land ? '.' : '#';
      stats[zoneId][levelNames[Math.max(cs.N, cs.E, cs.S, cs.W)]]++;
    }
    rows.push(row);
  }
  return { layers, stats, rows };
}

/** Walkability rows of a base map: a cell is walkable when its dirt or grass layer is drawn (water-only cells are blocked). */
function walkRows(o, layers) {
  const rows = [];
  for (let j = 0; j < o.height; j++) {
    let row = '';
    for (let i = 0; i < o.width; i++) {
      const k = j * o.width + i;
      row += layers.dirt[k] >= 0 || layers.grass[k] >= 0 ? '.' : '#';
    }
    rows.push(row);
  }
  return rows;
}

function renderPreview(o, tiles, layers, order = ['liquid', 'dirt', 'grass']) {
  const { tileW: TW, tileH: TH } = o;
  const full = new Image((o.width + o.height) * (TW / 2), (o.width + o.height) * (TH / 2));
  full.fill(14, 18, 30, 255);
  const offX = o.height * (TW / 2);
  // Vẽ theo đường chéo i + j tăng dần (sau ra trước), mỗi ô vẽ đủ các lớp.
  for (let s = 0; s <= o.width + o.height - 2; s++) {
    for (let i = Math.max(0, s - o.height + 1); i <= Math.min(o.width - 1, s); i++) {
      const j = s - i, k = j * o.width + i;
      const x = (i - j) * (TW / 2) - TW / 2 + offX, y = (i + j) * (TH / 2);
      for (const name of order) {
        const id = layers[name][k];
        if (id >= 0) full.drawImage(tiles[id].image, x, y);
      }
    }
  }
  if (o.previewScale >= 1) return full;
  // Thu nhỏ bằng lọc hộp.
  const f = Math.round(1 / o.previewScale);
  const out = new Image(Math.floor(full.width / f), Math.floor(full.height / f));
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const acc = [0, 0, 0, 0];
      for (let yy = 0; yy < f; yy++) for (let xx = 0; xx < f; xx++) {
        const p = full.getPixel(x * f + xx, y * f + yy);
        for (let c = 0; c < 4; c++) acc[c] += p[c];
      }
      out.setPixel(x, y, acc[0] / (f * f), acc[1] / (f * f), acc[2] / (f * f), acc[3] / (f * f));
    }
  }
  return out;
}

/** Danh sách tile của tileset bổ sung: nham thạch (4 khung động) + mỗi họ ghép viền 4 ô thuần + 14 mặt nạ. */
function buildExtTileList(o) {
  const list = [];
  for (let f = 0; f < o.waterFrames; f++) list.push({ name: `lava_${f}`, kind: 'water', liquid: 'lava', frame: f });
  for (const L of EXT_LAYERS) {
    for (let v = 0; v < o.variants; v++) list.push({ name: `${L.name}_full_${v}`, kind: 'overlay', layer: L, mask: 15, variant: v });
    for (let m = 1; m <= 14; m++) list.push({ name: `${L.name}_m${String(m).padStart(2, '0')}`, kind: 'overlay', layer: L, mask: m, variant: 0 });
  }
  return list;
}

function writeExtTileset(o) {
  const tiles = buildExtTileList(o).map((t) => ({ ...t, image: renderTile(o, t) }));
  const { sheet, frames } = packAtlas(o, tiles);
  const idByName = Object.fromEntries(frames.map((f) => [f.name, f.id]));
  sheet.save(path.join(o.out, 'tileset_ext.png'));
  const tileset = {
    format: 'tutien-tileset', version: 1,
    image: 'tileset_ext.png', imageWidth: sheet.width, imageHeight: sheet.height,
    tileWidth: o.tileW, tileHeight: o.tileH, padding: o.padding,
    tiles: frames,
    animations: { lava: { frames: frames.filter((f) => /^lava_\d+$/.test(f.name)).map((f) => f.id), fps: 4 } },
    wang: {
      type: 'corner', cornerBits: CORNER_BITS,
      note: 'index = N*1 + E*2 + S*4 + W*8; bit = 1 khi góc mang chất liệu của lớp phủ. Họ bổ sung: bờ đá / vỏ nham thạch / bờ đầm lầy (docs/04).',
      layers: EXT_LAYERS.map((L) => ({
        name: L.name, material: L.material, over: L.over, threshold: L.threshold,
        masks: Object.fromEntries(Array.from({ length: 14 }, (_, m) => [String(m + 1), idByName[`${L.name}_m${String(m + 1).padStart(2, '0')}`]])),
        full: Array.from({ length: o.variants }, (_, v) => idByName[`${L.name}_full_${v}`]),
        fullWeights: [0.7, ...Array(o.variants - 1).fill(0.3 / (o.variants - 1))],
      })),
    },
  };
  fs.writeFileSync(path.join(o.out, 'tileset_ext.json'), JSON.stringify(tileset, null, 2));
  return { count: tiles.length, width: sheet.width, height: sheet.height };
}

// ----------------------------------------------------------------------------
// Main
// ----------------------------------------------------------------------------
function main() {
  const o = parseArgs(process.argv.slice(2));
  fs.mkdirSync(o.out, { recursive: true });
  const t0 = Date.now();
  GROUND = o.ground ? G.loadGround(o.ground) : null;
  if (o.ground && !GROUND) console.warn(`⚠ không có patch ảnh nền trong ${o.ground}: dùng texture toán học`);

  const useZones = !!o.zones && !!GROUND && !!(GROUND.lava && GROUND.swamp && GROUND.stone);
  if (o.zones && !useZones) console.warn('⚠ --zones cần --ground có đủ ảnh stone / swamp / lava: dùng bản đồ 3 chất liệu như cũ');
  const zoneCorners = useZones ? Z.generateZoneCorners(o, makeFields(o)) : null;
  const corners = zoneCorners ? { W1: zoneCorners.W1, H1: zoneCorners.H1, data: zoneCorners.level } : generateCorners(o);
  const tileDefs = buildTileList(o).concat(useZones ? buildExtTileList(o) : []);
  const tiles = tileDefs.map((t) => ({ ...t, image: renderTile(o, t) }));
  const { sheet, frames } = packAtlas(o, tiles);
  const idByName = Object.fromEntries(frames.map((f) => [f.name, f.id]));
  const built = useZones ? buildZoneMap(o, zoneCorners, idByName) : buildMap(o, corners, idByName);
  const { layers, stats } = built;
  const layerOrder = useZones ? Z.LAYER_ORDER : ['liquid', 'dirt', 'grass'];

  sheet.save(path.join(o.out, 'tileset.png'));

  const tileset = {
    format: 'tutien-tileset', version: 1,
    image: 'tileset.png', imageWidth: sheet.width, imageHeight: sheet.height,
    tileWidth: o.tileW, tileHeight: o.tileH, padding: o.padding,
    tiles: frames,
    animations: {
      water: { frames: frames.filter((f) => f.name.startsWith('water_')).map((f) => f.id), fps: 6 },
      ...(useZones ? { lava: { frames: frames.filter((f) => /^lava_\d+$/.test(f.name)).map((f) => f.id), fps: 4 } } : {}),
    },
    wang: {
      type: 'corner', cornerBits: CORNER_BITS,
      note: 'index = N*1 + E*2 + S*4 + W*8; bit = 1 khi góc mang chất liệu của lớp phủ (hoặc cao hơn)',
      layers: (useZones ? OVERLAYS.concat(EXT_LAYERS) : OVERLAYS).map((L) => ({
        name: L.name, over: L.over, threshold: L.threshold,
        masks: Object.fromEntries(Array.from({ length: 14 }, (_, m) => [String(m + 1), idByName[`${L.name}_m${String(m + 1).padStart(2, '0')}`]])),
        full: Array.from({ length: o.variants }, (_, v) => idByName[`${L.name}_full_${v}`]),
        fullWeights: [0.7, ...Array(o.variants - 1).fill(0.3 / (o.variants - 1))],
      })),
    },
    drawOrder: layerOrder,
  };
  fs.writeFileSync(path.join(o.out, 'tileset.json'), JSON.stringify(tileset, null, 2));

  const map = {
    format: 'tutien-isomap', version: 1, seed: o.seed,
    width: o.width, height: o.height,
    projection: {
      type: 'isometric', ratio: '2:1', tileWidth: o.tileW, tileHeight: o.tileH,
      toScreen: `x = (i - j) * ${o.tileW / 2}, y = (i + j) * ${o.tileH / 2}  (đỉnh trên của ô)`,
      drawOrder: 'tăng dần theo i + j; trong mỗi ô vẽ liquid -> dirt -> grass',
    },
    tileset: 'tileset.json',
    materials: useZones ? ['liquid', 'dirt', 'ground', 'stone'] : MAT_NAMES,
    corners: { width: corners.W1, height: corners.H1, data: Array.from(corners.data) },
    layers: layerOrder.map((name) => ({
      name, encoding: 'row-major, index = j * width + i, -1 = trống', data: layers[name],
    })),
    ...(useZones ? { zones: Z.zoneRects(o.width), landmarks: Z.landmarks(o.width) } : {}),
    stats,
  };
  fs.writeFileSync(path.join(o.out, 'map.json'), JSON.stringify(map));

  if (o.previewScale > 0) renderPreview(o, tiles, layers, layerOrder).save(path.join(o.out, 'map_preview.png')); // --previewScale 0 = no preview (the preview of a 256 map renders a 2 GB image first)
  // walkability for the game server (`MAP_FILE`): `.` land, `#` water / lava only; written for every map so one rule holds
  const rows = built.rows ?? walkRows(o, layers);
  fs.writeFileSync(path.join(o.out, 'terrain.json'), JSON.stringify({ format: 'tutien-terrain', version: 1, seed: o.seed, width: o.width, height: o.height, rows }));

  console.log(`✔ ${tiles.length} tile → ${path.join(o.out, 'tileset.png')} (${sheet.width}×${sheet.height})`);
  console.log(`✔ Bản đồ ${o.width}×${o.height} → map.json  |  ô chủ đạo: ${JSON.stringify(stats)}`);
  if (o.ext) {
    if (!GROUND) console.warn('⚠ --ext cần --ground (ảnh nền cho đá / nham thạch / đầm lầy): bỏ qua tileset bổ sung');
    else {
      const e = writeExtTileset(o);
      console.log(`✔ tileset bổ sung ${e.count} tile → ${path.join(o.out, 'tileset_ext.png')} (${e.width}×${e.height})`);
    }
  }
  console.log(`✔ Nguồn màu: ${GROUND ? 'ảnh Gemini (' + Object.keys(GROUND).join(', ') + ')' : 'texture toán học'}`);
  console.log(`✔ Xong sau ${((Date.now() - t0) / 1000).toFixed(1)} s`);
}

if (require.main === module) main();
module.exports = { generateCorners, makeFields, buildZoneMap, walkRows, renderTile, buildTileList, buildExtTileList, packAtlas, buildMap, parseArgs, setGround: (g) => { GROUND = g; } };
