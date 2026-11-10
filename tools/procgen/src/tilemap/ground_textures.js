'use strict';
/**
 * Periodic ground patches (written by `npm run gen:gemini`: out/gemini/ground/<material>_<k>.png) as colour sources for
 * generate_tilemap.js. A patch is N x N and wraps in both axes, so sampling it with the tile's (u, v) diamond coordinates gives tiles
 * whose edges match their neighbours exactly (period = one tile). Variants (k > 0) differ only in the tile interior.
 */
const fs = require('fs');
const path = require('path');
const { decodePNG } = require('../lib/png');

const MATERIALS = ['water', 'dirt', 'grass', 'stone', 'swamp', 'lava'];
const VARIANTS = 4;

/** Bilinear sample of a wrapping patch at (u, v) (any real numbers; period 1). Returns [r, g, b]. */
function sampleWrap(patch, u, v) {
  const { width: W, height: H, data: d } = patch;
  const fu = (((u % 1) + 1) % 1) * W - 0.5,
    fv = (((v % 1) + 1) % 1) * H - 0.5;
  const x0 = Math.floor(fu),
    y0 = Math.floor(fv);
  const tx = fu - x0,
    ty = fv - y0;
  const px = (x, y) => ((((y % H) + H) % H) * W + (((x % W) + W) % W)) * 4;
  const a = px(x0, y0),
    b = px(x0 + 1, y0),
    c = px(x0, y0 + 1),
    e = px(x0 + 1, y0 + 1);
  const out = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    out[k] = (d[a + k] * (1 - tx) + d[b + k] * tx) * (1 - ty) + (d[c + k] * (1 - tx) + d[e + k] * tx) * ty;
  }
  return out;
}

/** Load every available `<material>_<k>.png` in `dir`; returns null when the directory has none. */
function loadGround(dir) {
  if (!dir || !fs.existsSync(dir)) return null;
  const patches = {};
  for (const m of MATERIALS) {
    const list = [];
    for (let k = 0; k < VARIANTS; k++) {
      const f = path.join(dir, `${m}_${k}.png`);
      if (fs.existsSync(f)) list.push(decodePNG(fs.readFileSync(f)));
    }
    if (list.length) patches[m] = list;
  }
  return Object.keys(patches).length ? patches : null;
}

const smooth = (a, b, x) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

/**
 * Colour of a land material at tile coords (u, v): variant 0 is the base patch; other variants cross-fade to their own patch
 * with the interior weight (0 on every tile edge), so neighbouring tiles of different variants still join.
 */
function landColor(patches, name, u, v, variant, interiorWeight) {
  const list = patches[name];
  const base = sampleWrap(list[0], u, v);
  if (variant <= 0 || list.length < 2) return base;
  const alt = sampleWrap(list[variant % list.length], u, v);
  const w = Math.min(1, interiorWeight * 1.6) * 0.85;
  return [base[0] + (alt[0] - base[0]) * w, base[1] + (alt[1] - base[1]) * w, base[2] + (alt[2] - base[2]) * w];
}

/**
 * Colour of a liquid (water / lava) at (u, v) for animation frame `frame` of `frames`: the patch drifts diagonally by one full
 * period over the loop (so the last frame flows into the first), a second copy drifts the other way and lightens it a little.
 */
function liquidColor(patches, name, u, v, frame, frames) {
  const list = patches[name];
  const t = frame / frames;
  const a = sampleWrap(list[0], u + t, v + t);
  const b = sampleWrap(list[list.length > 1 ? 1 : 0], u + 0.37 - t, v + 0.61 + t);
  const k = 0.28;
  const c = [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k];
  return name === 'water' ? gradeWater(list[0], c) : c;
}

// Art bible palette (docs/ASSET-LICENSES.md swatches): deep blue #294451, mountain blue #5E8798, jade #78B79A.
const WATER_RAMP = [
  [0, [41, 68, 81]],
  [0.55, [94, 135, 152]],
  [1, [120, 183, 154]],
];
/** Share of the owner's painted water kept next to the palette-mapped colour (1 = untouched, pale cyan). */
const WATER_KEEP = 0.3;
const lumaOf = (c) => 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
const lumaStats = new WeakMap();
function statsOf(patch) {
  let s = lumaStats.get(patch);
  if (!s) {
    const d = patch.data;
    let sum = 0, sum2 = 0, n = 0;
    for (let i = 0; i < d.length; i += 4) {
      const l = lumaOf([d[i], d[i + 1], d[i + 2]]);
      sum += l;
      sum2 += l * l;
      n++;
    }
    const mean = sum / n;
    s = { mean, std: Math.sqrt(Math.max(1e-6, sum2 / n - mean * mean)) };
    lumaStats.set(patch, s);
  }
  return s;
}
/**
 * The painted water is a pale cyan that reads washed out next to the saturated land. Keep ITS ripples (luma relative to the
 * patch mean) but map them onto the art-bible deep-blue -> mountain-blue -> jade ramp, blended back with a little of the original.
 */
function gradeWater(patch, c) {
  const { mean, std } = statsOf(patch);
  const x = Math.min(1, Math.max(0, 0.5 + (lumaOf(c) - mean) / (4 * std)));
  let lo = WATER_RAMP[0], hi = WATER_RAMP[WATER_RAMP.length - 1];
  for (let i = 1; i < WATER_RAMP.length; i++)
    if (x <= WATER_RAMP[i][0]) {
      lo = WATER_RAMP[i - 1];
      hi = WATER_RAMP[i];
      break;
    }
  const f = (x - lo[0]) / (hi[0] - lo[0] || 1);
  return [0, 1, 2].map((k) => (lo[1][k] + (hi[1][k] - lo[1][k]) * f) * (1 - WATER_KEEP) + c[k] * WATER_KEEP);
}

module.exports = { MATERIALS, VARIANTS, sampleWrap, loadGround, landColor, liquidColor, smooth };
