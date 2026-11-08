import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js');
const G = require('../src/gemini/process.js');

const W = 400;
const H = 480;

/** Synthetic Gemini-style export: magenta gradient background, an outlined green crown with a pink blossom and an
 * enclosed background hole (like the opening of a gate), a golden glow, and the sparkle mark bottom-right. */
function fixture({ sparkle = true } = {}) {
  const img = new Image(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) img.setPixel(x, y, 245 + ((x * 10) / W) | 0, 35 + ((y * 25) / H) | 0, 244 + ((x * 11) / W) | 0, 255);
  const disc = (cx, cy, r, col) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.setPixel(x, y, ...col, 255);
  };
  // golden glow around the body: R stays saturated, G rises towards the centre (what a glow over magenta looks like)
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const d = Math.hypot(x - 200, y - 200);
      if (d < 150 && d >= 100) {
        const t = 1 - (d - 100) / 50;
        img.setPixel(x, y, 252, 40 + Math.round(150 * t), 245 - Math.round(60 * t), 255);
      }
    }
  disc(200, 200, 100, [30, 20, 25]); // dark outline
  disc(200, 200, 96, [60, 140, 70]); // green body
  disc(170, 170, 14, [245, 170, 195]); // pink blossom fully enclosed by the outline
  // enclosed background hole (not connected to the border)
  for (let y = 215; y < 245; y++) for (let x = 190; x < 215; x++) img.setPixel(x, y, 250, 38, 247, 255);
  if (sparkle) {
    // light-pink 4-point star inside the corner box (15% of the short side = 60 px here)
    const cx = W - 30, cy = H - 30;
    for (let y = cy - 20; y <= cy + 20; y++)
      for (let x = cx - 20; x <= cx + 20; x++) {
        const k = (Math.abs(x - cx) * Math.abs(y - cy)) / 20;
        if (Math.abs(x - cx) + Math.abs(y - cy) < 20 - k * 0.8) img.setPixel(x, y, 255, 160, 255, 255);
      }
  }
  return img;
}

const px = (img, x, y) => [...img.data.slice((y * img.width + x) * 4, (y * img.width + x) * 4 + 4)];

describe('removeSparkle', () => {
  it('finds and erases the corner mark exactly once', () => {
    const img = fixture();
    const first = G.removeSparkle(img);
    expect(first.components).toBe(1);
    expect(first.pixels).toBeGreaterThan(500);
    expect(G.removeSparkle(img).components).toBe(0);
    expect(G.isStrictBg(...px(img, W - 30, H - 30).slice(0, 3))).toBe(true);
  });
  it('reports nothing for an image without the mark and leaves content alone', () => {
    const img = fixture({ sparkle: false });
    const before = Uint8ClampedArray.from(img.data);
    expect(G.removeSparkle(img)).toEqual({ pixels: 0, components: 0 });
    expect(Array.from(img.data)).toEqual(Array.from(before));
  });
  it('keeps content that reaches into the corner box (connected across the box edge)', () => {
    const img = fixture({ sparkle: false });
    // a bar running from the centre body into the corner box
    for (let y = 300; y < 320; y++) for (let x = 200; x < W - 10; x++) img.setPixel(x, y, 60, 140, 70, 255);
    const bar = px(img, W - 20, 310);
    G.removeSparkle(img);
    expect(px(img, W - 20, 310)).toEqual(bar);
  });
});

describe('keyMagenta', () => {
  const { image, stats } = G.keyMagenta(fixture({ sparkle: false }));
  it('removes the background everywhere, including the enclosed hole', () => {
    expect(px(image, 5, 5)[3]).toBe(0);
    expect(px(image, W - 5, 5)[3]).toBe(0);
    expect(px(image, 200, 230)[3]).toBe(0); // hole inside the body
    expect(stats.bg[0]).toBeGreaterThan(240);
  });
  it('keeps the body and the pink blossom opaque and unchanged (no global colour key)', () => {
    expect(px(image, 220, 160)).toEqual([60, 140, 70, 255]);
    expect(px(image, 170, 170)).toEqual([245, 170, 195, 255]);
    expect(px(image, 200 - 99, 200)[3]).toBe(255); // outline
  });
  it('turns the glow into soft warm alpha without magenta spill', () => {
    const glow = [];
    for (let r = 102; r < 150; r += 3) glow.push(px(image, 200 + r, 200));
    expect(glow.some((p) => p[3] > 0 && p[3] < 255)).toBe(true);
    for (const [r, g, b, a] of glow) {
      if (a === 0) continue;
      expect(Math.min(r, b) - g, `spill in ${[r, g, b, a]}`).toBeLessThan(40);
    }
  });
  it('leaves no magenta fringe next to transparency', () => {
    const { width: w, height: h, data: d } = image;
    let bad = 0;
    for (let y = 1; y < h - 1; y++)
      for (let x = 1; x < w - 1; x++) {
        const i = (y * w + x) * 4;
        if (d[i + 3] === 0 || d[i + 3] === 255) continue;
        // semi-transparent edge pixels: magenta-ness min(R,B) - G
        if (Math.min(d[i], d[i + 2]) - d[i + 1] > 60) bad++;
      }
    expect(bad).toBe(0);
  });
});

describe('processProp / processIcon', () => {
  it('trims to the content, scales @2x to the target and @1x to exactly half, pivot at the foot', () => {
    const r = G.processProp(fixture(), { h: 120 });
    expect(r.sparkle.components).toBe(1);
    expect(r.x2.height).toBe(120);
    expect(r.x1.height).toBe(60);
    expect(r.x1.width * 2).toBe(r.x2.width);
    expect(r.pivot.y).toBeCloseTo(0.95);
    expect(r.pivot.x).toBeGreaterThan(0.4);
    expect(r.pivot.x).toBeLessThan(0.6);
    // the trimmed canvas touches all four sides
    const bb = G.alphaBBox(r.x2);
    expect(bb.x).toBeLessThanOrEqual(1);
    expect(bb.y).toBeLessThanOrEqual(1);
  });
  it('transparent pixels carry the colour of their neighbours (no pink at bilinear edges)', () => {
    const r = G.processProp(fixture(), { h: 120 });
    const { data: d } = r.x2;
    for (let i = 0; i < d.length; i += 4) {
      if (d[i + 3] !== 0) continue;
      expect(Math.min(d[i], d[i + 2]) - d[i + 1], 'transparent pixel is magenta').toBeLessThan(60);
    }
  });
  it('erases `clear` rects given as fractions of the content box, then re-trims', () => {
    const plain = G.processProp(fixture(), { w: 200 });
    const cleared = G.processProp(fixture(), { w: 200 }, { clear: [{ x: 0, y: 0, w: 1, h: 0.3 }] });
    expect(cleared.trimmed.h).toBeLessThan(plain.trimmed.h);
  });
  it('makes a square icon at 128 / 64 px', () => {
    const r = G.processIcon(fixture(), 128);
    expect([r.x2.width, r.x2.height]).toEqual([128, 128]);
    expect([r.x1.width, r.x1.height]).toEqual([64, 64]);
    expect(r.sparkle.components).toBe(1);
    // the edge is faded to transparent so a cropped glow has no hard line
    expect(px(r.x2, 0, 64)[3]).toBeLessThanOrEqual(8);
  });
});
