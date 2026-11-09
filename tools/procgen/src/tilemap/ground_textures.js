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
  return [a[0] * (1 - k) + b[0] * k, a[1] * (1 - k) + b[1] * k, a[2] * (1 - k) + b[2] * k];
}

module.exports = { MATERIALS, VARIANTS, sampleWrap, loadGround, landColor, liquidColor, smooth };
