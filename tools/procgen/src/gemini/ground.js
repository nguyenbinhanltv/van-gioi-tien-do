'use strict';
/**
 * Owner-provided Gemini ground textures (top-down "seamless" paintings, 2048 x 2048, NOT on magenta) -> periodic patches that the
 * tile generator samples through the iso diamond (tools/procgen src/tilemap/generate_tilemap.js `--ground`).
 *
 *   removeGroundMark  - the Gemini sparkle sits bottom-right on each image: patch it with a feathered copy of other texture.
 *   seamScore         - how visible the wrap seam is: mean colour step across the wrap edge / mean step between neighbours.
 *   makeSeamless      - two-pass shifted cross-fade (X then Y): the result wraps exactly (score ~1), with a soft blend band.
 *   periodicPatch     - crop -> seamless -> resize: one periodic N x N patch.
 */
const { Image, resizeArea } = require('../lib/png');

const lum = (d, i) => d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11;

function colStep(img, x0, x1) {
  const { width: W, height: H, data: d } = img;
  let s = 0;
  for (let y = 0; y < H; y++) {
    const a = (y * W + x0) * 4,
      b = (y * W + x1) * 4;
    s += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
  }
  return s / (H * 3);
}
function rowStep(img, y0, y1) {
  const { width: W, data: d } = img;
  let s = 0;
  for (let x = 0; x < W; x++) {
    const a = (y0 * W + x) * 4,
      b = (y1 * W + x) * 4;
    s += Math.abs(d[a] - d[b]) + Math.abs(d[a + 1] - d[b + 1]) + Math.abs(d[a + 2] - d[b + 2]);
  }
  return s / (W * 3);
}

/**
 * Wrap-seam visibility. ratio = (step across the wrap edge) / (mean step between interior neighbours): ~1 for a texture that
 * truly wraps, several for one that does not. Returns { x, y, ratio } (ratio = the worse axis).
 */
function seamScore(img) {
  const { width: W, height: H } = img;
  let bx = 0,
    by = 0,
    n = 0;
  for (const f of [0.15, 0.35, 0.55, 0.75]) {
    const cx = Math.min(W - 2, Math.floor(W * f)),
      cy = Math.min(H - 2, Math.floor(H * f));
    bx += colStep(img, cx, cx + 1);
    by += rowStep(img, cy, cy + 1);
    n++;
  }
  bx = Math.max(bx / n, 0.5);
  by = Math.max(by / n, 0.5);
  const x = colStep(img, W - 1, 0) / bx;
  const y = rowStep(img, H - 1, 0) / by;
  return { x, y, ratio: Math.max(x, y) };
}

const smooth = (t) => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * (3 - 2 * c);
};

/** One axis: out = w * O + (1 - w) * roll(O, half), w = 1 at the centre -> 0 at the edges (smooth over `band` of the half size). */
function blendAxis(img, axis, band) {
  const { width: W, height: H, data: d } = img;
  const out = new Image(W, H);
  const len = axis === 'x' ? W : H;
  const half = len >> 1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const t = axis === 'x' ? x : y;
      // distance from the nearest edge, in 0..half
      const e = Math.min(t, len - 1 - t);
      const w = smooth(e / (half * band));
      const sx = axis === 'x' ? (x + half) % W : x;
      const sy = axis === 'y' ? (y + half) % H : y;
      const i = (y * W + x) * 4,
        j = (sy * W + sx) * 4;
      for (let c = 0; c < 3; c++) out.data[i + c] = d[i + c] * w + d[j + c] * (1 - w);
      out.data[i + 3] = 255;
    }
  return out;
}

/** Make a texture wrap in both axes: X pass then Y pass (each pass keeps the other axis untouched). `band` = blend width. */
function makeSeamless(img, band = 0.9) {
  return blendAxis(blendAxis(img, 'x', band), 'y', band);
}

function crop(img, x, y, w, h) {
  const out = new Image(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const s = ((y + j) * img.width + (x + i)) * 4,
        t = (j * w + i) * 4;
      out.data[t] = img.data[s];
      out.data[t + 1] = img.data[s + 1];
      out.data[t + 2] = img.data[s + 2];
      out.data[t + 3] = 255;
    }
  return out;
}

/** Centre of the Gemini sparkle on a 2048 export, from the right / bottom edge (identical on every export seen). */
const MARK_INSET = 114;

/**
 * Contrast of the sparkle: |mean luminance of the centre disc - mean luminance of the surrounding ring|. The mark is a washed-out
 * star with a dark outline over the texture, so this is large when it is there (45-104 on the six exports) and small on plain
 * texture. Used both to detect the mark and to verify it is gone.
 */
function markContrast(img) {
  const { width: W, height: H, data: d } = img;
  const cx = W - MARK_INSET,
    cy = H - MARK_INSET;
  let a = 0,
    na = 0,
    b = 0,
    nb = 0;
  for (let y = cy - 100; y <= cy + 100; y += 2)
    for (let x = cx - 100; x <= cx + 100; x += 2) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dist = Math.hypot(x - cx, y - cy);
      const l = lum(d, (y * W + x) * 4);
      if (dist < 22) {
        a += l;
        na++;
      } else if (dist > 85 && dist < 100) {
        b += l;
        nb++;
      }
    }
  return na && nb ? Math.abs(a / na - b / nb) : 0;
}

/**
 * Patch the sparkle with a feathered copy of other texture (the image is meant to wrap, so content from half a period away
 * fits). Returns the contrast found before patching (0 = nothing there: the caller treats that as an unexpected layout).
 */
function removeGroundMark(img) {
  const { width: W, height: H, data: d } = img;
  const before = markContrast(img);
  if (before < 30) return 0;
  const cx = W - MARK_INSET,
    cy = H - MARK_INSET;
  const R = 80,
    F = 24; // patch radius (the star is ~56 px + outline) and feather
  const src = Uint8ClampedArray.from(d);
  for (let y = cy - R; y <= cy + R; y++)
    for (let x = cx - R; x <= cx + R; x++) {
      if (x < 0 || y < 0 || x >= W || y >= H) continue;
      const dist = Math.hypot(x - cx, y - cy);
      if (dist > R) continue;
      const w = 1 - smooth((dist - (R - F)) / F); // 1 inside, feathered to 0 at the rim
      const sx = (x + (W >> 1)) % W,
        sy = (y + (H >> 1)) % H; // half a period away
      const i = (y * W + x) * 4,
        j = (sy * W + sx) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = src[i + c] * (1 - w) + src[j + c] * w;
    }
  return before;
}

/** Crop (x, y, size) -> seamless -> resize to out x out. Returns { image, before, after } seam scores of the crop. */
function periodicPatch(img, { x, y, size, out }) {
  const c = crop(img, x, y, size, size);
  const before = seamScore(c);
  const s = makeSeamless(c);
  const after = seamScore(s);
  return { image: resizeArea(s, out, out), before, after };
}

module.exports = { seamScore, makeSeamless, removeGroundMark, markContrast, periodicPatch, crop, lum };
