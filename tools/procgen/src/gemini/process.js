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

/**
 * The Gemini mark of the part-3 grids that sit ON artwork (the HUD icon backing, an alchemy cell): a translucent white 4-point star
 * (an astroid |x|^(2/3) + |y|^(2/3) <= r^(2/3)) centred ~5.5% in from the bottom-right corner, blended at alpha ~0.55, so it cannot be
 * found as "a component in the corner" (it is connected to the art). Un-blend it: P = (P' - 255 a) / (1 - a) inside the star (+1 px).
 * @returns {{ pixels: number, residual: number }} pixels un-blended and light-grey pixels left inside the star (must be 0)
 */
function unmixStar(img, o = {}) {
  const { width: W, height: H, data: d } = img;
  const cx = (o.cx ?? 0.9453) * W,
    cy = (o.cy ?? 0.9453) * H,
    r = (o.r ?? 0.0245) * W,
    a = o.alpha ?? 0.55;
  const inside = (x, y, rr) => Math.pow(Math.abs(x - cx) / rr, 2 / 3) + Math.pow(Math.abs(y - cy) / rr, 2 / 3) <= 1;
  let pixels = 0;
  let residual = 0;
  const x0 = Math.max(0, Math.floor(cx - r - 3)),
    x1 = Math.min(W - 1, Math.ceil(cx + r + 3)),
    y0 = Math.max(0, Math.floor(cy - r - 3)),
    y1 = Math.min(H - 1, Math.ceil(cy + r + 3));
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y, r + 1.5)) continue;
      const i = (y * W + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = Math.max(0, Math.min(255, Math.round((d[i + c] - 255 * a) / (1 - a))));
      pixels++;
    }
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      if (!inside(x, y, r - 1)) continue;
      const i = (y * W + x) * 4;
      const mn = Math.min(d[i], d[i + 1], d[i + 2]),
        mx = Math.max(d[i], d[i + 1], d[i + 2]);
      if (mn >= 140 && mx - mn <= 30) residual++; // a light grey / white pixel where the backing should be dark
    }
  return { pixels, residual };
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
function keyMagenta(img, bgOverride, keyOpts = {}) {
  const { width: W, height: H, data: d } = img;
  const bg = bgOverride || estimateBackground(img);
  const isBg0 = bgTest(bg);
  // keyOpts.extraBg: further background colours (a grid whose cells have their own darker magenta backing), within 60 like the main one
  const extra = keyOpts.extraBg || [];
  const isBg = extra.length
    ? (r, g, b) => isBg0(r, g, b) || extra.some((e) => (r - e[0]) ** 2 + (g - e[1]) ** 2 + (b - e[2]) ** 2 <= 3600)
    : isBg0;
  // family: still clearly magenta (R about equal to B) even when the background is darkened by a dim glow / smoke; a saturated R
  // (a bright warm glow over the background) may have any B
  // keyOpts.famFrac (manifest "key": { famFrac }) lowers both floors for art with dark translucent smoke over the magenta
  // (it stays purple at 40-55 % of the background level and would otherwise survive as opaque purple wisps)
  const famR = (keyOpts.famFrac ?? 0.62) * bg[0],
    famB = (keyOpts.famFrac !== undefined ? keyOpts.famFrac * 0.97 : 0.6) * bg[2];
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
function cleanSprite(src, keyOpts) {
  const img = new Image(src.width, src.height);
  img.data.set(src.data);
  const bg = estimateBackground(img);
  const sparkle = removeSparkle(img, bgTest(bg));
  const keyed = keyMagenta(img, bg, keyOpts);
  bleedColor(keyed.image);
  return { image: keyed.image, sparkle, key: keyed.stats };
}

/**
 * Prop: trimmed to alpha>=24, scaled to `target` ({ w } or { h } in px @2x). @1x is exactly half.
 * @returns {{ x2: Image, x1: Image, pivot: {x:number,y:number}, sparkle: object }}
 */
function processProp(src, target, opts = {}) {
  const { image, sparkle } = cleanSprite(src, opts.key);
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
 * Icon grid (cols x rows of self-contained tiles on the magenta background): sparkle removal + key, then the cols*rows
 * largest connected opaque components are the tiles, ordered row-major. Each tile is cropped to its box (grown by opts.pad,
 * a fraction of the tile size, so glows survive) and scaled to size2 (@2x) / size2/2 (@1x). opts.fit: 'stretch' (default,
 * square tiles such as the skill and status icons: bbox stretched to the square) or 'contain' (differently shaped tiles such
 * as the realm badges: aspect kept, centred in the square). The rounded corners of a tile become transparent.
 * @returns {{ x2: Image[], x1: Image[], sparkle: object }}
 */
function sliceGrid(src, size2, cols, rows, opts = {}) {
  const { fit = 'stretch', pad = 0, eraseCorner = 0 } = opts;
  const n = cols * rows;
  let star = null;
  if (opts.unmixStar) {
    // the mark sits on the art: un-blend it BEFORE keying (on a copy, the source buffer stays untouched)
    src = new Image(src.width, src.height);
    src.data.set(arguments[0].data);
    star = unmixStar(src, opts.unmixStar === true ? {} : opts.unmixStar);
  }
  const { image, sparkle: found } = cleanSprite(src, opts.key);
  const sparkle = star ? { pixels: star.pixels, components: star.residual === 0 ? 1 : 0 } : found;
  const { width: W, height: H, data: d } = image;
  if (eraseCorner > 0) {
    // the Gemini mark can sit on a tile's glow (not separable by connectivity): erase a box in the bottom-right corner
    for (let y = Math.round(H * (1 - eraseCorner)); y < H; y++)
      for (let x = Math.round(W * (1 - eraseCorner)); x < W; x++) d[(y * W + x) * 4 + 3] = 0;
  }
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
  const tiles = comps.sort((a, b) => b.area - a.area).slice(0, n);
  if (tiles.length < n || tiles[n - 1].area < 0.2 * tiles[0].area)
    throw new Error('icon grid: found ' + tiles.length + ' tiles, need ' + n);
  // rows: sort by the vertical centre, cut into rows of cols; then left to right inside a row
  const cy = (t) => t.y + t.h / 2;
  const byY = tiles.slice().sort((a, b) => cy(a) - cy(b));
  const ordered = [];
  for (let r = 0; r < rows; r++) {
    const row = byY.slice(r * cols, (r + 1) * cols).sort((a, b) => a.x - b.x);
    // a row must really be one row: its tiles' centres lie within half a tile height of each other
    const hs = row.map((t) => t.h);
    if (Math.max(...row.map(cy)) - Math.min(...row.map(cy)) > 0.5 * Math.min(...hs))
      throw new Error('icon grid: row ' + r + ' is not a row of ' + cols + ' tiles');
    ordered.push(...row);
  }
  if (opts.disc) {
    // round badges on a backing disc (the part-3 HUD icons): every disc has the radius of the median tile, anchored at the tile's
    // left / top edge (the Gemini mark can add a wedge to the bottom-right of one disc); anything outside that circle is background
    const rs = ordered.map((t) => Math.min(t.w, t.h) / 2).sort((p, q) => p - q);
    const R = rs[rs.length >> 1];
    for (const t of ordered) {
      const ccx = t.x + R,
        ccy = t.y + R;
      for (let y = t.y; y < t.y + t.h; y++)
        for (let x = t.x; x < t.x + t.w; x++)
          if ((x + 0.5 - ccx) ** 2 + (y + 0.5 - ccy) ** 2 > (R + 0.5) ** 2) d[(y * W + x) * 4 + 3] = 0;
      t.w = Math.round(2 * R);
      t.h = Math.round(2 * R);
    }
    if (opts.unmixStar) {
      // the mark's arms cross the rim of the last disc: un-blending cannot tell backing from outline there, so repaint the star's area
      // from the same radius at another angle (the rim is radially symmetric and the icon never reaches it), and clear outside the disc
      const so = opts.unmixStar === true ? {} : opts.unmixStar;
      const scx = (so.cx ?? 0.9453) * W,
        scy = (so.cy ?? 0.9453) * H,
        sr = (so.r ?? 0.0245) * W + 4;
      const host = ordered.find((t) => scx >= t.x && scx <= t.x + t.w && scy >= t.y && scy <= t.y + t.h);
      if (host) {
        const ccx = host.x + R,
          ccy = host.y + R;
        const copy = Uint8ClampedArray.from(d);
        for (let y = Math.floor(scy - sr); y <= Math.ceil(scy + sr); y++)
          for (let x = Math.floor(scx - sr); x <= Math.ceil(scx + sr); x++) {
            if (x < 0 || y < 0 || x >= W || y >= H) continue;
            if (Math.pow(Math.abs(x - scx) / sr, 2 / 3) + Math.pow(Math.abs(y - scy) / sr, 2 / 3) > 1) continue;
            const rho = Math.hypot(x + 0.5 - ccx, y + 0.5 - ccy);
            const i = (y * W + x) * 4;
            if (rho > R + 0.5) {
              d[i + 3] = 0;
              continue;
            }
            const th = Math.atan2(y + 0.5 - ccy, x + 0.5 - ccx) + Math.PI / 2; // 90 degrees round: the bottom-left rim, free of art
            const sx = Math.round(ccx + rho * Math.cos(th) - 0.5),
              sy = Math.round(ccy + rho * Math.sin(th) - 0.5);
            const j = (sy * W + sx) * 4;
            d[i] = copy[j];
            d[i + 1] = copy[j + 1];
            d[i + 2] = copy[j + 2];
            d[i + 3] = copy[j + 3];
          }
      }
    }
  }
  const x2 = [],
    x1 = [];
  const place = (tile, size) => {
    if (fit === 'stretch') return resizeArea(tile, size, size);
    const k = size / Math.max(tile.width, tile.height);
    const w = Math.max(2, Math.round(tile.width * k)),
      h = Math.max(2, Math.round(tile.height * k));
    const out = new Image(size, size);
    out.blit(resizeArea(tile, w, h), Math.round((size - w) / 2), Math.round((size - h) / 2));
    return out;
  };
  for (const t of ordered) {
    const gx = Math.round(pad * t.w),
      gy = Math.round(pad * t.h);
    const tile = crop(image, t.x - gx, t.y - gy, t.w + 2 * gx, t.h + 2 * gy);
    x2.push(bleedColor(place(tile, size2)));
    x1.push(bleedColor(place(tile, size2 / 2)));
  }
  return { x2, x1, sparkle };
}

/** Skill-icon grid: 4 columns x 2 rows (see sliceGrid). */
function sliceSkillGrid(src, size2 = 128) {
  return sliceGrid(src, size2, 4, 2);
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
  // `opts.height`: scale to this height instead (front-facing characters are sized by how tall they stand);
  // `opts.area`: scale so the sprite covers that many px (a wide crouched pose must not look smaller than the tall one it replaces)
  const k = opts.height
    ? opts.height / bb.h
    : opts.area
      ? Math.sqrt(opts.area / (bb.w * bb.h))
      : box / Math.max(bb.w, bb.h);
  const x1 = bleedColor(resizeArea(trimmed, Math.max(2, Math.round(bb.w * k)), Math.max(2, Math.round(bb.h * k))));
  return { x1, pivot: footPivot(trimmed), sparkle };
}

/** Black-background test of the particle exports: every channel dark. */
const isDark = (r, g, b) => Math.max(r, g, b) <= 24;

/**
 * Particle texture (white / coloured glow on a BLACK background, Gemini mark in the bottom-right corner): the mark is erased,
 * then luminance (max channel) becomes alpha and the colour is un-multiplied (rgb = c / alpha), so additive blending
 * (src * alpha) reproduces the original glow and normal alpha blending shows the same shape. The brightest content is
 * lifted to alpha 1 (99.95th percentile gain, capped at 3x) so dim objects such as the leaf do not come out half transparent.
 * Cropped to the content, centred in a square with a small margin, scaled to size2 (@2x) / size2/2 (@1x).
 * @returns {{ x2: Image, x1: Image, sparkle: object, gain: number }}
 */
function processParticle(src, size2 = 256) {
  const img = new Image(src.width, src.height);
  img.data.set(src.data);
  const sparkle = removeSparkle(img, isDark);
  const { width: W, height: H, data: d } = img;
  const hist = new Uint32Array(256);
  for (let p = 0; p < W * H; p++) hist[Math.max(d[p * 4], d[p * 4 + 1], d[p * 4 + 2])]++;
  let acc = 0,
    top = 255;
  for (let v = 255; v >= 0; v--) {
    acc += hist[v];
    if (acc >= 0.0005 * W * H) {
      top = v;
      break;
    }
  }
  const gain = Math.min(3, 255 / Math.max(top, 85));
  const out = new Image(W, H);
  const o = out.data;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const m = Math.max(d[i], d[i + 1], d[i + 2]);
    // black level: the export background is not exactly 0 (compression noise)
    const a = Math.min(1, Math.max(0, ((m - 6) / 249) * gain));
    if (a <= 0.004) continue;
    const k = 255 / Math.max(m, 1);
    o[i] = Math.min(255, d[i] * k);
    o[i + 1] = Math.min(255, d[i + 1] * k);
    o[i + 2] = Math.min(255, d[i + 2] * k);
    o[i + 3] = Math.round(a * 255);
  }
  const bb = alphaBBox(out, 10);
  if (!bb) throw new Error('empty particle after luminance key');
  const side = Math.round(Math.max(bb.w, bb.h) * 1.08);
  const cx = bb.x + bb.w / 2,
    cy = bb.y + bb.h / 2;
  const sq = crop(out, Math.round(cx - side / 2), Math.round(cy - side / 2), side, side);
  const x2 = bleedColor(resizeArea(sq, size2, size2));
  const x1 = bleedColor(resizeArea(sq, size2 / 2, size2 / 2));
  return { x2, x1, sparkle, gain };
}

/**
 * Heading of a projectile picture: the alpha-weighted principal axis, oriented towards the denser end (a comet / bolt has a bulky
 * head and a thin tail). Returns the angle in radians in image space (y down) of the direction from the tail to the head.
 */
function projectileHeading(img) {
  const { width: W, height: H, data: d } = img;
  let m = 0,
    mx = 0,
    my = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = d[(y * W + x) * 4 + 3];
      if (a < 8) continue;
      m += a;
      mx += a * x;
      my += a * y;
    }
  mx /= m;
  my /= m;
  let sxx = 0,
    syy = 0,
    sxy = 0;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = d[(y * W + x) * 4 + 3];
      if (a < 8) continue;
      sxx += a * (x - mx) ** 2;
      syy += a * (y - my) ** 2;
      sxy += a * (x - mx) * (y - my);
    }
  const axis = 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const ux = Math.cos(axis),
    uy = Math.sin(axis);
  // projections along the axis: the head is the end whose outer quarter holds more mass
  let lo = Infinity,
    hi = -Infinity;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      if (d[(y * W + x) * 4 + 3] >= 8) {
        const t = (x - mx) * ux + (y - my) * uy;
        if (t < lo) lo = t;
        if (t > hi) hi = t;
      }
  let massLo = 0,
    massHi = 0;
  const span = hi - lo;
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const a = d[(y * W + x) * 4 + 3];
      if (a < 8) continue;
      const t = (x - mx) * ux + (y - my) * uy;
      if (t < lo + span * 0.25) massLo += a;
      else if (t > hi - span * 0.25) massHi += a;
    }
  return massHi >= massLo ? axis : axis + Math.PI;
}

/** Rotates by `ang` radians (counter-clockwise on screen, y down) around the centre onto an enlarged canvas (bilinear, premultiplied). */
function rotateImage(src, ang) {
  const { width: W, height: H } = src;
  const c = Math.abs(Math.cos(ang)),
    s = Math.abs(Math.sin(ang));
  const nw = Math.ceil(W * c + H * s),
    nh = Math.ceil(W * s + H * c);
  const out = new Image(nw, nh);
  const cos = Math.cos(ang),
    sin = Math.sin(ang);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      const dx = x + 0.5 - nw / 2,
        dy = y + 0.5 - nh / 2;
      // inverse mapping
      const sx = dx * cos - dy * sin + W / 2 - 0.5;
      const sy = dx * sin + dy * cos + H / 2 - 0.5;
      const x0 = Math.floor(sx),
        y0 = Math.floor(sy),
        fx = sx - x0,
        fy = sy - y0;
      let r = 0,
        g = 0,
        b = 0,
        a = 0;
      for (let j = 0; j < 2; j++)
        for (let i = 0; i < 2; i++) {
          const xx = x0 + i,
            yy = y0 + j;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const w = (i ? fx : 1 - fx) * (j ? fy : 1 - fy);
          const k = (yy * W + xx) * 4,
            al = src.data[k + 3] / 255;
          r += src.data[k] * al * w;
          g += src.data[k + 1] * al * w;
          b += src.data[k + 2] * al * w;
          a += al * w;
        }
      if (a > 0.002) out.setPixel(x, y, r / a, g / a, b / a, a * 255);
    }
  return out;
}

/**
 * Cut positions between `n` side-by-side panels: for each boundary near k * W / n the column (within +-14 % of W / n) with the
 * least alpha mass, so a panel's glow is not sliced where the neighbouring art is faint.
 */
function panelCuts(img, n) {
  const { width: W, height: H, data: d } = img;
  const col = new Float64Array(W);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) col[x] += d[(y * W + x) * 4 + 3];
  const cuts = [0];
  for (let k = 1; k < n; k++) {
    const mid = Math.round((k * W) / n),
      win = Math.round((0.14 * W) / n);
    let best = mid,
      bv = Infinity;
    for (let x = mid - win; x <= mid + win; x++) {
      // a 9 px smoothed column sum so one thin streak does not decide
      let v = 0;
      for (let q = -4; q <= 4; q++) v += col[Math.min(W - 1, Math.max(0, x + q))];
      if (v < bv) {
        bv = v;
        best = x;
      }
    }
    cuts.push(best);
  }
  cuts.push(W);
  return cuts;
}

/**
 * Keeps the main artwork of a cut panel: alpha pixels are grouped into blobs (dilated 3 cells on a 1/4 grid so a glow and its sparks
 * stay one blob); blobs holding at least 12 % of the biggest blob's mass are kept, the rest (pieces of the neighbouring panel's art
 * that cross the cut) are erased.
 */
function keepMainBlobs(img) {
  const { width: W, height: H, data: d } = img;
  const S = 4,
    gw = Math.ceil(W / S),
    gh = Math.ceil(H / S);
  const mass = new Float64Array(gw * gh);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) mass[Math.floor(y / S) * gw + Math.floor(x / S)] += d[(y * W + x) * 4 + 3];
  const solid = new Uint8Array(gw * gh);
  for (let i = 0; i < solid.length; i++) solid[i] = mass[i] > 40 * S ? 1 : 0;
  const R = 3;
  const grown = new Uint8Array(gw * gh);
  for (let y = 0; y < gh; y++)
    for (let x = 0; x < gw; x++)
      if (solid[y * gw + x])
        for (let j = -R; j <= R; j++)
          for (let i = -R; i <= R; i++) {
            const xx = x + i,
              yy = y + j;
            if (xx >= 0 && yy >= 0 && xx < gw && yy < gh) grown[yy * gw + xx] = 1;
          }
  const label = new Int32Array(gw * gh).fill(-1);
  const sums = [];
  const stack = [];
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || label[start] >= 0) continue;
    const id = sums.length;
    let total = 0;
    stack.push(start);
    label[start] = id;
    while (stack.length) {
      const c = stack.pop();
      total += mass[c];
      const cx = c % gw,
        cy = (c / gw) | 0;
      for (const [ox, oy] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]) {
        const nx = cx + ox,
          ny = cy + oy;
        if (nx < 0 || ny < 0 || nx >= gw || ny >= gh) continue;
        const ni = ny * gw + nx;
        if (grown[ni] && label[ni] < 0) {
          label[ni] = id;
          stack.push(ni);
        }
      }
    }
    sums.push(total);
  }
  const big = Math.max(...sums);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const l = label[Math.floor(y / S) * gw + Math.floor(x / S)];
      if (l < 0 || sums[l] < 0.12 * big) d[(y * W + x) * 4 + 3] = 0;
    }
  return img;
}

/**
 * PART 3 group Q: a skill VFX sheet (black background, N panels side by side: projectile / impact burst / ground ring, Gemini mark
 * bottom-right). Same luminance -> alpha key as the particles (colour kept at full brightness, alpha = max channel, so on a dark
 * ground it reproduces the picture and over bright ground it reads as a soft translucent shape; the art keeps its own colours).
 * Each panel is cut out (equal-width columns), trimmed, and scaled so its longest side is `sizes[k]` px @2x (@1x half). Panels
 * flagged in `rotate` (the projectile) are turned so they point to +x (the tail on the left), which is what `face` in the VFX presets
 * expects.
 * @returns {{ panels: Array<{ x2: Image, x1: Image }>, sparkle: object }}
 */
function processVfxSheet(src, sizes, rotate = []) {
  const img = new Image(src.width, src.height);
  img.data.set(src.data);
  const sparkle = removeSparkle(img, isDark);
  const { width: W, height: H, data: d } = img;
  const keyed = new Image(W, H);
  const o = keyed.data;
  for (let p = 0; p < W * H; p++) {
    const i = p * 4;
    const m = Math.max(d[i], d[i + 1], d[i + 2]);
    const a = Math.min(1, Math.max(0, (m - 6) / 249));
    if (a <= 0.004) continue;
    const k = 255 / Math.max(m, 1);
    o[i] = Math.min(255, d[i] * k);
    o[i + 1] = Math.min(255, d[i + 1] * k);
    o[i + 2] = Math.min(255, d[i + 2] * k);
    o[i + 3] = Math.round(a * 255);
  }
  const n = sizes.length;
  const panels = [];
  const cuts = panelCuts(keyed, n);
  for (let k = 0; k < n; k++) {
    let panel = keepMainBlobs(crop(keyed, cuts[k], 0, cuts[k + 1] - cuts[k], H));
    if (rotate[k]) {
      const first = alphaBBox(panel, 10);
      if (!first) throw new Error(`empty VFX panel ${k}`);
      panel = crop(panel, first.x, first.y, first.w, first.h);
      panel = rotateImage(panel, projectileHeading(panel)); // the content turns by -heading: heading -> +x
    }
    const bb = alphaBBox(panel, 10);
    if (!bb) throw new Error(`empty VFX panel ${k}`);
    const trimmed = crop(panel, bb.x, bb.y, bb.w, bb.h);
    const long = Math.max(trimmed.width, trimmed.height);
    const sc = sizes[k] / long;
    const w2 = Math.max(1, Math.round(trimmed.width * sc)),
      h2 = Math.max(1, Math.round(trimmed.height * sc));
    panels.push({
      x2: bleedColor(resizeArea(trimmed, w2, h2)),
      x1: bleedColor(resizeArea(trimmed, Math.max(1, Math.round(w2 / 2)), Math.max(1, Math.round(h2 / 2)))),
    });
  }
  return { panels, sparkle };
}

/**
 * Erase the grey Gemini mark from an OPAQUE picture (login backdrop): the mark is the largest connected blob of neutral
 * mid-grey pixels in the bottom-right corner box; it is grown by a few px and filled by diffusion from its border.
 * @returns {{ pixels: number, components: number }}
 */
function removeBackdropMark(img) {
  const { width: W, height: H, data: d } = img;
  const S = Math.round(0.12 * Math.min(W, H));
  const x0 = W - S,
    y0 = H - S;
  const grey = (x, y) => {
    const i = ((y0 + y) * W + x0 + x) * 4;
    const mn = Math.min(d[i], d[i + 1], d[i + 2]),
      mx = Math.max(d[i], d[i + 1], d[i + 2]);
    return mx - mn <= 22 && mn >= 105 && mn <= 225;
  };
  const seen = new Uint8Array(S * S);
  let best = null;
  for (let sy = 0; sy < S; sy++)
    for (let sx = 0; sx < S; sx++) {
      if (seen[sy * S + sx] || !grey(sx, sy)) continue;
      const stack = [[sx, sy]];
      const comp = [];
      seen[sy * S + sx] = 1;
      while (stack.length) {
        const [cx, cy] = stack.pop();
        comp.push(cy * S + cx);
        for (const [nx, ny] of [
          [cx + 1, cy],
          [cx - 1, cy],
          [cx, cy + 1],
          [cx, cy - 1],
        ]) {
          if (nx < 0 || ny < 0 || nx >= S || ny >= S || seen[ny * S + nx] || !grey(nx, ny)) continue;
          seen[ny * S + nx] = 1;
          stack.push([nx, ny]);
        }
      }
      if (!best || comp.length > best.length) best = comp;
    }
  if (!best || best.length < 600) return { pixels: 0, components: 0 };
  const mask = new Uint8Array(S * S);
  for (const k of best) mask[k] = 1;
  const grown = new Uint8Array(S * S);
  const R = 13;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!mask[y * S + x]) continue;
      for (let dy = -R; dy <= R; dy++)
        for (let dx = -R; dx <= R; dx++) {
          const nx = x + dx,
            ny = y + dy;
          if (nx >= 0 && ny >= 0 && nx < S && ny < S) grown[ny * S + nx] = 1;
        }
    }
  // diffusion fill (Gauss-Seidel): masked pixels converge to the harmonic interpolation of the border
  const px = new Float32Array(S * S * 3);
  const idx = (x, y) => y * S + x;
  let count = 0;
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      const i = ((y0 + y) * W + x0 + x) * 4;
      for (let c = 0; c < 3; c++) px[idx(x, y) * 3 + c] = d[i + c];
      if (grown[idx(x, y)]) count++;
    }
  // start from the mean colour of the unmasked ring around the mark (Gauss-Seidel alone converges far too slowly from the
  // light mark colour), then relax
  {
    const mean = [0, 0, 0];
    let nb = 0;
    for (let y = 1; y < S - 1; y++)
      for (let x = 1; x < S - 1; x++) {
        if (grown[idx(x, y)]) continue;
        let near = false;
        for (let dy = -3; dy <= 3 && !near; dy++)
          for (let dx = -3; dx <= 3; dx++) {
            const nx = x + dx,
              ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < S && ny < S && grown[idx(nx, ny)]) {
              near = true;
              break;
            }
          }
        if (!near) continue;
        for (let c = 0; c < 3; c++) mean[c] += px[idx(x, y) * 3 + c];
        nb++;
      }
    if (nb) for (let k = 0; k < S * S; k++) if (grown[k]) for (let c = 0; c < 3; c++) px[k * 3 + c] = mean[c] / nb;
  }
  for (let it = 0; it < 600; it++)
    for (let y = 1; y < S - 1; y++)
      for (let x = 1; x < S - 1; x++) {
        if (!grown[idx(x, y)]) continue;
        for (let c = 0; c < 3; c++)
          px[idx(x, y) * 3 + c] =
            (px[idx(x - 1, y) * 3 + c] +
              px[idx(x + 1, y) * 3 + c] +
              px[idx(x, y - 1) * 3 + c] +
              px[idx(x, y + 1) * 3 + c]) /
            4;
      }
  for (let y = 0; y < S; y++)
    for (let x = 0; x < S; x++) {
      if (!grown[idx(x, y)]) continue;
      const i = ((y0 + y) * W + x0 + x) * 4;
      for (let c = 0; c < 3; c++) d[i + c] = Math.round(px[idx(x, y) * 3 + c]);
    }
  return { pixels: count, components: 1 };
}

/**
 * Login backdrop: opaque picture, mark removed, area-scaled to w x h (design px; the 16:9 source is 2752 x 1536).
 * @returns {{ image: Image, sparkle: object }}
 */
function processBackdrop(src, w, h) {
  const img = new Image(src.width, src.height);
  img.data.set(src.data);
  const sparkle = removeBackdropMark(img);
  for (let p = 3; p < img.data.length; p += 4) img.data[p] = 255;
  return { image: resizeArea(img, w, h), sparkle };
}

/**
 * Emblem on magenta: sparkle removal + key (enclosed background such as the hole of the disc is keyed too), trimmed to the
 * content and scaled so the longest side is size2 (@2x) / size2/2 (@1x).
 */
function processEmblem(src, size2 = 512) {
  const { image, sparkle } = cleanSprite(src);
  const bb = alphaBBox(image);
  if (!bb) throw new Error('empty sprite after keying');
  const trimmed = crop(image, bb.x, bb.y, bb.w, bb.h);
  const fit = (s) => {
    const k = s / Math.max(bb.w, bb.h);
    return bleedColor(resizeArea(trimmed, Math.max(2, Math.round(bb.w * k)), Math.max(2, Math.round(bb.h * k))));
  };
  return { x2: fit(size2), x1: fit(size2 / 2), sparkle };
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
  isDark,
  processParticle,
  processVfxSheet,
  panelCuts,
  keepMainBlobs,
  projectileHeading,
  rotateImage,
  processBackdrop,
  removeBackdropMark,
  processEmblem,
  sliceGrid,
  sliceSkillGrid,
  isStrictBg,
  isFamily,
  removeSparkle,
  unmixStar,
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
