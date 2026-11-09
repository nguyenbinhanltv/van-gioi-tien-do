'use strict';
/**
 * Owner-provided Gemini exports -> game sprites. Pure functions on png.js Images (RGBA 8 bit); no I/O here.
 *
 * Source art: 1792x2400 / 2048x2048 PNG on a flat magenta (#FF00FF family) background with a small Gemini sparkle
 * mark in the bottom-right corner. Steps (see `processProp` / `processIcon`):
 *   1. removeSparkle  - erase the corner mark (a component fully inside the corner box).
 *   2. keyMagenta     - chroma key WITHOUT global colour matching: only magenta-family pixels connected to the
 *                       background (so pink blossoms inside an outlined crown survive), colour-unmixed so glows and
 *                       anti-aliased outlines lose their pink fringe (min-alpha unmix + neutral despill).
 *   3. bleedColor     - transparent pixels take the colour of the nearest opaque pixel (no pink at bilinear edges).
 *   4. trim / pivot / resize.
 */
const { Image, resizeArea } = require('../lib/png');

const BG_MIN_RB = 225; // strict background: R,B high, G low (corners measure (243-255, 0-59, 241-255))
const BG_MAX_G = 95;
const ALPHA_FLOOR = 0.1; // unmix haze below this alpha is background noise (the background is a slight gradient)

/** Pixel is (near) pure background magenta. */
const isStrictBg = (r, g, b) => r >= BG_MIN_RB && b >= BG_MIN_RB && g <= BG_MAX_G && Math.abs(r - b) <= 40;
/** Magenta family: pinkish-white glow over the background can still be reached from it. */
const isFamily = (r, g, b) => r >= 205 && b >= 185;

/**
 * Per-image background colour: mean of the border pixels that look magenta (looser than isStrictBg: some exports use a
 * darker, less blue magenta such as (216, 36, 196)). Falls back to #FF2AFF-ish when the border has none.
 */
function estimateBackground(img) {
  const { width: W, height: H, data: d } = img;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const take = (x, y) => {
    const i = (y * W + x) * 4;
    if (d[i] >= 190 && d[i + 2] >= 170 && d[i + 1] <= 100 && Math.abs(d[i] - d[i + 2]) <= 50) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  };
  for (let x = 0; x < W; x += 4) {
    take(x, 0);
    take(x, H - 1);
  }
  for (let y = 0; y < H; y += 4) {
    take(0, y);
    take(W - 1, y);
  }
  return n === 0 ? [255, 40, 255] : [r / n, g / n, b / n];
}

/** Background test for one image: the fixed strict magenta, or within 60 of the estimated background colour. */
function bgTest(bg) {
  return (r, g, b) => isStrictBg(r, g, b) || (r - bg[0]) ** 2 + (g - bg[1]) ** 2 + (b - bg[2]) ** 2 <= 3600;
}

/**
 * Erase the Gemini sparkle mark. It is a small light-pink star ~6% in from the bottom-right corner: a connected
 * non-background component that lies entirely inside the corner box (does not touch the box's left / top edge).
 * Content that reaches into the box is connected to the rest of the sprite across the box edge and is kept.
 * @returns {{ pixels: number, components: number }} removed pixel / component count (0 = no mark found)
 */
function removeSparkle(img, isBg = isStrictBg) {
  const { width: W, height: H, data: d } = img;
  const S = Math.round(0.15 * Math.min(W, H));
  const x0 = W - S,
    y0 = H - S;
  const at = (x, y) => (y * W + x) * 4;
  const nonBg = (x, y) => !isBg(d[at(x, y)], d[at(x, y) + 1], d[at(x, y) + 2]);
  let sr = 0,
    sg = 0,
    sb = 0,
    sn = 0;
  for (let y = y0; y < H; y++)
    for (let x = x0; x < W; x++) {
      const i = at(x, y);
      if (isBg(d[i], d[i + 1], d[i + 2])) {
        sr += d[i];
        sg += d[i + 1];
        sb += d[i + 2];
        sn++;
      }
    }
  if (sn === 0) return { pixels: 0, components: 0 };
  const fill = [Math.round(sr / sn), Math.round(sg / sn), Math.round(sb / sn)];
  const seen = new Uint8Array(S * S);
  const erase = new Uint8Array(S * S);
  let components = 0;
  for (let sy = 0; sy < S; sy++)
    for (let sx = 0; sx < S; sx++) {
      if (seen[sy * S + sx] || !nonBg(x0 + sx, y0 + sy)) continue;
      const stack = [[sx, sy]];
      const comp = [];
      let touches = false;
      seen[sy * S + sx] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push(cy * S + cx);
        if (cx === 0 || cy === 0) touches = true;
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= S || ny >= S || seen[ny * S + nx] || !nonBg(x0 + nx, y0 + ny)) continue;
          seen[ny * S + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (!touches && comp.length >= 100) {
        components++;
        for (const k of comp) erase[k] = 1;
      }
    }
  if (components === 0) return { pixels: 0, components: 0 };
  let pixels = 0;
  // grow by 4 px to take the anti-aliased halo too
  for (let sy = 0; sy < S; sy++)
    for (let sx = 0; sx < S; sx++) {
      let hit = false;
      for (let dy = -4; dy <= 4 && !hit; dy++)
        for (let dx = -4; dx <= 4; dx++) {
          const nx = sx + dx,
            ny = sy + dy;
          if (nx >= 0 && ny >= 0 && nx < S && ny < S && erase[ny * S + nx]) {
            hit = true;
            break;
          }
        }
      if (!hit) continue;
      const i = at(x0 + sx, y0 + sy);
      d[i] = fill[0];
      d[i + 1] = fill[1];
      d[i + 2] = fill[2];
      d[i + 3] = 255;
      pixels++;
    }
  return { pixels, components };
}

/** Mean colour of the strict-background pixels on the image border. */
function backgroundColor(img) {
  const { width: W, height: H, data: d } = img;
  let r = 0,
    g = 0,
    b = 0,
    n = 0;
  const take = (x, y) => {
    const i = (y * W + x) * 4;
    if (isStrictBg(d[i], d[i + 1], d[i + 2])) {
      r += d[i];
      g += d[i + 1];
      b += d[i + 2];
      n++;
    }
  };
  for (let x = 0; x < W; x += 4) {
    take(x, 0);
    take(x, H - 1);
  }
  for (let y = 0; y < H; y += 4) {
    take(0, y);
    take(W - 1, y);
  }
  if (n === 0) return [255, 40, 255];
  return [r / n, g / n, b / n];
}

/**
 * Chroma key + despill. Returns a new RGBA image; `img` is not modified.
 * @returns {{ image: Image, stats: { region: number, band: number, bg: number[] } }}
 */
function keyMagenta(img, bgOverride) {
  const { width: W, height: H, data: d } = img;
  const bg = bgOverride || estimateBackground(img);
  const isBg = bgTest(bg);
  // family: still clearly magenta (R about equal to B) even when the background is darkened by a dim glow / smoke; a saturated R
  // (a bright warm glow over the background) may have any B
  const famR = 0.62 * bg[0],
    famB = 0.6 * bg[2];
  // ...and it must actually LOOK magenta: red and blue clearly above green, with the margin scaled to this background. Neutral
  // greys, pale stone, mist or white touching the background never qualify (their min(R, B) - G is about 0).
  const famMagenta = 0.15 * (Math.min(bg[0], bg[2]) - bg[1]);
  const N = W * H;
  // 0 = solid, 1 = strict bg, 2 = glow region (family pixels connected to bg), 3 = band (3 px around the region)
  const cls = new Uint8Array(N);
  const queue = new Int32Array(N);
  let qh = 0,
    qt = 0;
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    if (isBg(d[i], d[i + 1], d[i + 2])) {
      cls[p] = 1;
      queue[qt++] = p;
    }
  }
  const nbrs = (p, fn) => {
    const x = p % W,
      y = (p / W) | 0;
    if (x > 0) fn(p - 1);
    if (x < W - 1) fn(p + 1);
    if (y > 0) fn(p - W);
    if (y < H - 1) fn(p + W);
  };
  while (qh < qt) {
    const p = queue[qh++];
    nbrs(p, (q) => {
      if (cls[q]) return;
      const i = q * 4;
      if (
        d[i] >= famR &&
        d[i + 2] >= famB &&
        Math.min(d[i], d[i + 2]) - d[i + 1] >= famMagenta &&
        (Math.abs(d[i] - d[i + 2]) <= 45 || d[i] >= 235)
      ) {
        cls[q] = 2;
        queue[qt++] = q;
      }
    });
  }
  // band: solid pixels within 3 px of bg/region (anti-aliased outline edges blended with the background)
  let frontier = [];
  for (let p = 0; p < N; p++) if (cls[p] === 1 || cls[p] === 2) frontier.push(p);
  for (let step = 0; step < 3; step++) {
    const next = [];
    for (const p of frontier)
      nbrs(p, (q) => {
        if (cls[q] === 0) {
          cls[q] = 3;
          next.push(q);
        }
      });
    frontier = next;
  }
  const out = new Image(W, H);
  const o = out.data;
  let region = 0,
    band = 0;
  for (let p = 0; p < N; p++) {
    const i = p * 4;
    const c = cls[p];
    if (c === 1) continue; // transparent (rgb filled by bleedColor)
    let r = d[i],
      g = d[i + 1],
      b = d[i + 2],
      a = 1;
    // band pixels (solid, near the background) are only touched when they carry magenta: a grey / pale edge is not a blend
    const magenta = Math.min(r, b) - g >= famMagenta;
    if (c === 2 || (c === 3 && magenta)) {
      // minimum alpha that explains the pixel as foreground over the background colour (all channels in 0..255)
      a = Math.min(1, Math.max(0, (g - bg[1]) / (255 - bg[1]), 1 - r / bg[0], 1 - b / bg[2]));
      if (c === 3 && a > 0.85)
        a = 1; // dark outline pixel: keep opaque, untouched
      else {
        a = a <= ALPHA_FLOOR ? 0 : Math.min(1, (a - ALPHA_FLOOR) / (1 - ALPHA_FLOOR));
        if (a > 0) {
          // un-blend: F = (P - (1 - a) * bg) / a
          const aa = Math.max(a, 0.02);
          r = (r - (1 - aa) * bg[0]) / aa;
          g = (g - (1 - aa) * bg[1]) / aa;
          b = (b - (1 - aa) * bg[2]) / aa;
          r = Math.min(255, Math.max(0, r));
          g = Math.min(255, Math.max(0, g));
          b = Math.min(255, Math.max(0, b));
          // R carries no information when it sits at the background's R (~251): keep warm / white light, never green
          if (c === 2 && r >= 240 && g > r * 0.88) g = r * 0.88; // warm gold / white, never green
          if (c === 2 && a < 0.98) {
            // neutral despill: magenta excess over green is removed from red and blue
            const spill = Math.min(r, b) - g;
            if (spill > 0) {
              r -= spill;
              b -= spill;
            }
          }
        }
      }
      if (c === 2) region++;
      else band++;
    }
    if (a <= 0) continue;
    o[i] = r;
    o[i + 1] = g;
    o[i + 2] = b;
    o[i + 3] = Math.round(a * 255);
  }
  return { image: out, stats: { region, band, bg } };
}

/** Give fully transparent pixels the colour of the nearest opaque pixel (up to `passes` px away). */
function bleedColor(img, passes = 4) {
  const { width: W, height: H, data: d } = img;
  let known = new Uint8Array(W * H);
  for (let p = 0; p < W * H; p++) if (d[p * 4 + 3] > 0) known[p] = 1;
  for (let k = 0; k < passes; k++) {
    const nk = known.slice();
    for (let y = 0; y < H; y++)
      for (let x = 0; x < W; x++) {
        const p = y * W + x;
        if (known[p]) continue;
        let r = 0,
          g = 0,
          b = 0,
          n = 0;
        for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
          if (q >= 0 && known[q]) {
            r += d[q * 4];
            g += d[q * 4 + 1];
            b += d[q * 4 + 2];
            n++;
          }
        }
        if (n) {
          d[p * 4] = r / n;
          d[p * 4 + 1] = g / n;
          d[p * 4 + 2] = b / n;
          nk[p] = 1;
        }
      }
    known = nk;
  }
  return img;
}

/** Bounding box of pixels with alpha >= thr, or null. */
function alphaBBox(img, thr = 24) {
  const { width: W, height: H, data: d } = img;
  let x0 = W,
    y0 = H,
    x1 = -1,
    y1 = -1;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3] >= thr) {
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
  return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
}

function crop(img, x, y, w, h) {
  const out = new Image(w, h);
  for (let j = 0; j < h; j++)
    for (let i = 0; i < w; i++) {
      const sx = x + i,
        sy = y + j;
      if (sx < 0 || sy < 0 || sx >= img.width || sy >= img.height) continue;
      const s = (sy * img.width + sx) * 4,
        t = (j * w + i) * 4;
      out.data[t] = img.data[s];
      out.data[t + 1] = img.data[s + 1];
      out.data[t + 2] = img.data[s + 2];
      out.data[t + 3] = img.data[s + 3];
    }
  return out;
}

/**
 * Ground contact point of a prop, as fractions of the (trimmed) image. x = centre of the opaque pixels in the lowest
 * 8% of rows; y = a little above the lowest opaque row (the soft contact shadow reaches below the true foot).
 */
function footPivot(img) {
  const { width: W, height: H, data: d } = img;
  const band = Math.max(2, Math.round(H * 0.08));
  let sx = 0,
    n = 0;
  for (let y = H - band; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3] >= 128) {
        sx += x;
        n++;
      }
  const px = n ? sx / n / W : 0.5;
  return { x: Math.round(px * 1000) / 1000, y: 0.95 };
}

/** Fade alpha to 0 over `fade` px at the image border (hides the hard crop of a glow in an icon). */
function edgeFade(img, fade) {
  const { width: W, height: H, data: d } = img;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const e = Math.min(x, y, W - 1 - x, H - 1 - y);
      if (e >= fade) continue;
      const t = (e + 0.5) / fade;
      d[(y * W + x) * 4 + 3] = Math.round(d[(y * W + x) * 4 + 3] * t * t * (3 - 2 * t));
    }
  return img;
}

/** Common first stage: sparkle removal + key + colour bleed (keeps the full canvas). */
function cleanSprite(src) {
  const img = new Image(src.width, src.height);
  img.data.set(src.data);
  const bg = estimateBackground(img);
  const sparkle = removeSparkle(img, bgTest(bg));
  const keyed = keyMagenta(img, bg);
  bleedColor(keyed.image);
  return { image: keyed.image, sparkle, key: keyed.stats };
}

/**
 * Prop: trimmed to alpha>=24, scaled to `target` ({ w } or { h } in px @2x). @1x is exactly half.
 * @returns {{ x2: Image, x1: Image, pivot: {x:number,y:number}, sparkle: object }}
 */
function processProp(src, target, opts = {}) {
  const { image, sparkle } = cleanSprite(src);
  let bb = alphaBBox(image);
  if (!bb) throw new Error('empty sprite after keying');
  if (opts.clear && opts.clear.length) {
    // erase artifacts of the source art: rects as fractions of the first-pass content box, then re-trim
    for (const r of opts.clear) {
      const rx = bb.x + Math.round(r.x * bb.w),
        ry = bb.y + Math.round(r.y * bb.h);
      const rw = Math.round(r.w * bb.w),
        rh = Math.round(r.h * bb.h);
      for (let y = ry; y < ry + rh; y++)
        for (let x = rx; x < rx + rw; x++)
          if (x >= 0 && y >= 0 && x < image.width && y < image.height) image.data[(y * image.width + x) * 4 + 3] = 0;
    }
    bb = alphaBBox(image);
  }
  const trimmed = crop(image, bb.x, bb.y, bb.w, bb.h);
  const k = target.w ? target.w / bb.w : target.h / bb.h;
  const w2 = Math.max(2, 2 * Math.round((bb.w * k) / 2));
  const h2 = Math.max(2, 2 * Math.round((bb.h * k) / 2));
  const x2 = bleedColor(resizeArea(trimmed, w2, h2));
  const x1 = bleedColor(resizeArea(trimmed, w2 / 2, h2 / 2));
  return { x2, x1, pivot: footPivot(trimmed), sparkle, trimmed: { w: bb.w, h: bb.h } };
}

/**
 * Icon: square crop around the opaque core (alpha>=200) + margin so glows do not shrink the item, edge-faded,
 * scaled to size2 (@2x, 128) and size2/2 (@1x, 64).
 */
function processIcon(src, size2 = 128) {
  const { image, sparkle } = cleanSprite(src);
  const core = alphaBBox(image, 200);
  if (!core) throw new Error('empty sprite after keying');
  const side = Math.round(Math.max(core.w, core.h) * 1.28);
  const cx = core.x + core.w / 2,
    cy = core.y + core.h / 2;
  const sq = crop(image, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side);
  edgeFade(sq, Math.round(side * 0.05));
  const x2 = bleedColor(resizeArea(sq, size2, size2));
  const x1 = bleedColor(resizeArea(sq, size2 / 2, size2 / 2));
  return { x2, x1, sparkle };
}

/**
 * Skill-icon grid (4 columns x 2 rows of self-contained rounded tiles on the magenta background): sparkle removal + key,
 * then the 8 tiles are the 8 largest connected opaque components, ordered row-major. Each tile is trimmed to its box and
 * scaled to size2 (@2x, 128) / size2/2 (@1x, 64). The rounded corners of a tile become transparent.
 * @returns {{ x2: Image[], x1: Image[], sparkle: object }}
 */
function sliceSkillGrid(src, size2 = 128) {
  const { image, sparkle } = cleanSprite(src);
  const { width: W, height: H, data: d } = image;
  const label = new Int32Array(W * H);
  const comps = [];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (label[p0] || d[p0 * 4 + 3] < 128) continue;
    const id = comps.length + 1;
    const stack = [p0];
    label[p0] = id;
    let x0 = W,
      y0 = H,
      x1 = -1,
      y1 = -1,
      area = 0;
    while (stack.length) {
      const p = stack.pop();
      const x = p % W,
        y = (p / W) | 0;
      area++;
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const q of [x > 0 ? p - 1 : -1, x < W - 1 ? p + 1 : -1, y > 0 ? p - W : -1, y < H - 1 ? p + W : -1]) {
        if (q >= 0 && !label[q] && d[q * 4 + 3] >= 128) {
          label[q] = id;
          stack.push(q);
        }
      }
    }
    comps.push({ x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, area });
  }
  const tiles = comps.sort((a, b) => b.area - a.area).slice(0, 8);
  if (tiles.length < 8 || tiles[7].area < 0.2 * tiles[0].area)
    throw new Error(`skill grid: found ${tiles.length} tiles, need 8`);
  // rows: split by the vertical centre; then left to right
  const cy = (t) => t.y + t.h / 2;
  const mid = (Math.min(...tiles.map(cy)) + Math.max(...tiles.map(cy))) / 2;
  const top = tiles.filter((t) => cy(t) < mid).sort((a, b) => a.x - b.x);
  const bottom = tiles.filter((t) => cy(t) >= mid).sort((a, b) => a.x - b.x);
  if (top.length !== 4 || bottom.length !== 4)
    throw new Error(`skill grid: rows have ${top.length} + ${bottom.length} tiles, need 4 + 4`);
  const x2 = [],
    x1 = [];
  for (const t of [...top, ...bottom]) {
    const tile = crop(image, t.x, t.y, t.w, t.h);
    x2.push(bleedColor(resizeArea(tile, size2, size2)));
    x1.push(bleedColor(resizeArea(tile, size2 / 2, size2 / 2)));
  }
  return { x2, x1, sparkle };
}

/**
 * INTERIM mob standee: concept art keyed + trimmed, scaled so its longest side is `box` px (design px @1x; mobs ship one
 * @1x tier). Source faces LEFT. Returns the sprite, its foot pivot and the sparkle stats.
 */
function processMob(src, box, opts = {}) {
  const { image, sparkle } = cleanSprite(src);
  const bb = alphaBBox(image);
  if (!bb) throw new Error('empty sprite after keying');
  const trimmed = crop(image, bb.x, bb.y, bb.w, bb.h);
  // `opts.height`: scale to this height instead (front-facing characters are sized by how tall they stand)
  const k = opts.height ? opts.height / bb.h : box / Math.max(bb.w, bb.h);
  const x1 = bleedColor(resizeArea(trimmed, Math.max(2, Math.round(bb.w * k)), Math.max(2, Math.round(bb.h * k))));
  return { x1, pivot: footPivot(trimmed), sparkle };
}

/**
 * 9-slice UI frame: keyed + trimmed, scaled to `w` design px (@1x) wide (@2x = twice that), no pivot. The slice insets are
 * chosen by the caller from the manifest (fractions of the @1x size) and written next to the frame.
 * @returns {{ x2: Image, x1: Image, sparkle: object }}
 */
function processUi(src, w) {
  const { image, sparkle } = cleanSprite(src);
  const bb = alphaBBox(image);
  if (!bb) throw new Error('empty sprite after keying');
  const trimmed = crop(image, bb.x, bb.y, bb.w, bb.h);
  const h = Math.max(2, Math.round((bb.h * w) / bb.w));
  const x2 = bleedColor(resizeArea(trimmed, w * 2, h * 2));
  const x1 = bleedColor(resizeArea(trimmed, w, h));
  return { x2, x1, sparkle };
}

module.exports = {
  processUi,
  processMob,
  sliceSkillGrid,
  isStrictBg,
  isFamily,
  removeSparkle,
  backgroundColor,
  estimateBackground,
  bgTest,
  keyMagenta,
  bleedColor,
  alphaBBox,
  crop,
  footPivot,
  edgeFade,
  cleanSprite,
  processProp,
  processIcon,
};
