import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js');
const G = require('../src/gemini/process.js');
const { classGrids, GRID_PATHS } = require('../src/gemini/skills.js');
const { decodePNG } = require('../src/lib/png.js');

const W = 400;
const H = 480;

/** Synthetic Gemini-style export: magenta gradient background, an outlined green crown with a pink blossom and an
 * enclosed background hole (like the opening of a gate), a golden glow, and the sparkle mark bottom-right. */
function fixture({ sparkle = true } = {}) {
  const img = new Image(W, H);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++)
      img.setPixel(x, y, (245 + (x * 10) / W) | 0, (35 + (y * 25) / H) | 0, (244 + (x * 11) / W) | 0, 255);
  const disc = (cx, cy, r, col) => {
    for (let y = cy - r; y <= cy + r; y++)
      for (let x = cx - r; x <= cx + r; x++)
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) img.setPixel(x, y, ...col, 255);
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
    const cx = W - 30,
      cy = H - 30;
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

describe('skill-icon grids', () => {
  /** 4 x 2 tiles on the magenta background, tile k has a flat colour (40 + 25k, 90, 200 - 20k); sparkle bottom-right. */
  function grid() {
    const img = new Image(480, 360);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 480; x++) img.setPixel(x, y, 250, 40, 248, 255);
    for (let k = 0; k < 8; k++) {
      const x0 = 20 + (k % 4) * 110,
        y0 = 20 + Math.floor(k / 4) * 130;
      for (let y = y0; y < y0 + 100; y++)
        for (let x = x0; x < x0 + 100; x++) img.setPixel(x, y, 40 + 25 * k, 90, 200 - 20 * k, 255);
    }
    const cx = 450,
      cy = 330;
    for (let y = cy - 20; y <= cy + 20; y++)
      for (let x = cx - 20; x <= cx + 20; x++)
        if (Math.abs(x - cx) + Math.abs(y - cy) < 20 - (Math.abs(x - cx) * Math.abs(y - cy)) / 25)
          img.setPixel(x, y, 255, 160, 255, 255);
    return img;
  }
  it('slices 8 tiles row-major (left to right, top to bottom) and removes the mark', () => {
    const r = G.sliceSkillGrid(grid(), 128);
    expect(r.sparkle.components).toBe(1);
    expect(r.x2).toHaveLength(8);
    r.x2.forEach((im, k) => {
      expect([im.width, im.height]).toEqual([128, 128]);
      expect(r.x1[k].width).toBe(64);
      expect(px(im, 64, 64).slice(0, 3)).toEqual([40 + 25 * k, 90, 200 - 20 * k]);
    });
  });
  it('rejects a grid without 8 tiles', () => {
    const img = grid();
    for (let y = 20; y < 120; y++) for (let x = 20; x < 120; x++) img.setPixel(x, y, 250, 40, 248, 255);
    expect(() => G.sliceSkillGrid(img, 128)).toThrow(/8/);
  });
  it('maps every skill id of skills.json to its class grid, 8 per class, in file order', () => {
    const skills = JSON.parse(
      fs.readFileSync(
        path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../packages/shared/src/data/skills.json'),
        'utf8',
      ),
    );
    const g = classGrids(skills);
    expect(Object.keys(g).sort()).toEqual([...GRID_PATHS].sort());
    expect(Object.values(g).flat()).toHaveLength(48);
    expect(g.kiem).toEqual([
      'kiem_khi_tram',
      'lien_hoan_kiem',
      'phi_kiem_thuat',
      'kim_quang_quet',
      'thiem_kiem_bo',
      'kiem_tam',
      'ngu_kiem_tran',
      'van_kiem_quy_tong',
    ]);
    expect(() => classGrids({ skills: skills.skills.slice(1) })).toThrow(/kiem/);
  });
  const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../assets-src/gemini/skills');
  const real = GRID_PATHS.every(
    (p) =>
      fs.existsSync(path.join(src, `${p}.png`)) &&
      fs.readFileSync(path.join(src, `${p}.png`)).readUInt32BE(0) === 0x89504e47,
  );
  it.skipIf(!real)('the owner-provided grids all slice into 8 square icons with keyed rounded corners', () => {
    for (const p of GRID_PATHS) {
      const r = G.sliceSkillGrid(decodePNG(fs.readFileSync(path.join(src, `${p}.png`))), 128);
      expect(r.sparkle.components, p).toBe(1);
      expect(r.x2).toHaveLength(8);
      for (const im of r.x2) {
        expect(px(im, 0, 0)[3]).toBeLessThan(255); // rounded corner partly keyed out
        expect(px(im, 64, 64)[3]).toBe(255);
      }
    }
  });
});

describe('keyMagenta never eats neutral / pale bodies that touch the background', () => {
  /** Body of one flat colour directly against the magenta background (no dark outline), like a pale stone or mist. */
  function bodyOn(col) {
    const img = new Image(200, 200);
    for (let y = 0; y < 200; y++) for (let x = 0; x < 200; x++) img.setPixel(x, y, 250, 40, 248, 255);
    for (let y = 50; y < 150; y++) for (let x = 50; x < 150; x++) img.setPixel(x, y, ...col, 255);
    return img;
  }
  for (const col of [
    [180, 180, 180],
    [210, 210, 210],
    [255, 255, 255],
    [230, 225, 215],
    [200, 190, 200],
    [160, 160, 170],
  ]) {
    it(`keeps a ${col} body fully opaque and unchanged, edges included`, () => {
      const { image } = G.keyMagenta(bodyOn(col));
      for (const [x, y] of [
        [50, 50],
        [100, 50],
        [149, 100],
        [100, 149],
        [100, 100],
        [51, 51],
      ])
        expect(px(image, x, y), `pixel ${x},${y}`).toEqual([...col, 255]);
    });
  }
  it('still keys real magenta haze next to the body (the body does not stop the key)', () => {
    const { image } = G.keyMagenta(bodyOn([180, 180, 180]));
    expect(px(image, 10, 10)[3]).toBe(0);
  });
});

describe('processMob with a height target (NPC standees)', () => {
  it('scales a front-facing character to a standing height, keeping the aspect', () => {
    const img = new Image(400, 500);
    for (let y = 0; y < 500; y++) for (let x = 0; x < 400; x++) img.setPixel(x, y, 250, 40, 248, 255);
    for (let y = 60; y < 360; y++) for (let x = 150; x < 270; x++) img.setPixel(x, y, 60, 90, 160, 255); // 120 x 300
    const r = G.processMob(img, 0, { height: 100 });
    expect(r.x1.height).toBe(100);
    expect(Math.abs(r.x1.width - 40)).toBeLessThanOrEqual(1);
    expect(r.pivot.y).toBeCloseTo(0.95);
  });
});

