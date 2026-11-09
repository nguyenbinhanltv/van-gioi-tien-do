import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js');
const G = require('../src/gemini/process.js');

const here = path.dirname(fileURLToPath(import.meta.url));
const px = (img, x, y) => {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2], img.data[i + 3]];
};

/** 4-point mark like the Gemini sparkle, centred at (cx, cy). */
function mark(img, cx, cy, r, col) {
  for (let y = cy - r; y <= cy + r; y++)
    for (let x = cx - r; x <= cx + r; x++)
      if (Math.abs(x - cx) + Math.abs(y - cy) < r - (Math.abs(x - cx) * Math.abs(y - cy)) / (r + 5)) img.setPixel(x, y, ...col, 255);
}

describe('PART 2: generic grids (status icons 4 x 3, realm badges 3 x 3)', () => {
  /** cols x rows flat-colour tiles on magenta; tile k colour (30 + 20k, 120, 220 - 15k); odd tiles are narrower when `wide`. */
  function gridOf(cols, rows, { wide = false } = {}) {
    const img = new Image(cols * 130 + 40, rows * 130 + 40);
    for (let y = 0; y < img.height; y++) for (let x = 0; x < img.width; x++) img.setPixel(x, y, 250, 40, 248, 255);
    for (let k = 0; k < cols * rows; k++) {
      const x0 = 20 + (k % cols) * 130,
        y0 = 20 + Math.floor(k / cols) * 130;
      const w = wide && k % 2 ? 80 : 100;
      for (let y = y0; y < y0 + 100; y++) for (let x = x0; x < x0 + w; x++) img.setPixel(x, y, 30 + 20 * k, 120, 220 - 15 * k, 255);
    }
    mark(img, img.width - 30, img.height - 30, 20, [255, 160, 255]);
    return img;
  }

  it('slices cols x rows tiles row-major', () => {
    for (const [cols, rows] of [
      [4, 3],
      [3, 3],
    ]) {
      const r = G.sliceGrid(gridOf(cols, rows), 64, cols, rows);
      expect(r.x2).toHaveLength(cols * rows);
      r.x2.forEach((im, k) => {
        expect([im.width, im.height]).toEqual([64, 64]);
        expect(r.x1[k].width).toBe(32);
        expect(px(im, 32, 32).slice(0, 3), 'tile ' + k).toEqual([30 + 20 * k, 120, 220 - 15 * k]);
      });
    }
  });

  it('contain keeps the aspect of narrower tiles (transparent side margins), stretch fills the square', () => {
    const img = gridOf(3, 3, { wide: true });
    const contain = G.sliceGrid(img, 64, 3, 3, { fit: 'contain' });
    expect(px(contain.x2[1], 1, 32)[3]).toBe(0);
    expect(px(contain.x2[1], 32, 32)[3]).toBe(255);
    const stretch = G.sliceGrid(img, 64, 3, 3);
    expect(px(stretch.x2[1], 1, 32)[3]).toBe(255);
  });

  it('rejects a grid with a missing tile', () => {
    const img = gridOf(4, 3);
    for (let y = 20; y < 120; y++) for (let x = 20; x < 120; x++) img.setPixel(x, y, 250, 40, 248, 255);
    expect(() => G.sliceGrid(img, 64, 4, 3)).toThrow(/12/);
  });

  it('eraseCorner clears a box in the bottom-right corner before the tiles are found', () => {
    const img = gridOf(3, 3);
    // a pale blob glued to the last tile: without eraseCorner it would be part of the tile, with it the tile box is unchanged
    for (let y = 20 + 2 * 130 + 100; y < 20 + 2 * 130 + 100 + 12; y++) for (let x = 20 + 2 * 130 + 80; x < 20 + 2 * 130 + 92; x++) img.setPixel(x, y, 30 + 20 * 8, 120, 220 - 15 * 8, 255);
    const r = G.sliceGrid(img, 64, 3, 3, { eraseCorner: 0.12 });
    expect(r.x2).toHaveLength(9);
    expect(px(r.x2[8], 32, 32).slice(0, 3)).toEqual([30 + 20 * 8, 120, 220 - 15 * 8]);
  });
});

describe('PART 2: particle textures (black background, luminance -> alpha)', () => {
  function particle() {
    const img = new Image(400, 400);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) img.setPixel(x, y, 2, 2, 3, 255);
    for (let y = 0; y < 400; y++)
      for (let x = 0; x < 400; x++) {
        const d = Math.hypot(x - 140, y - 140);
        if (d < 60) img.setPixel(x, y, Math.round(255 * (1 - d / 80)), Math.round(150 * (1 - d / 80)), 20, 255);
      }
    mark(img, 370, 370, 14, [120, 120, 120]);
    return img;
  }

  it('erases the mark, makes alpha the luminance and keeps the colour', () => {
    const r = G.processParticle(particle(), 128);
    expect(r.sparkle.components).toBe(1);
    expect([r.x2.width, r.x2.height]).toEqual([128, 128]);
    expect(r.x1.width).toBe(64);
    const centre = px(r.x2, 64, 64);
    expect(centre[3]).toBeGreaterThan(200);
    expect(centre[0]).toBeGreaterThan(centre[2]);
    expect(px(r.x2, 64, 2)[3]).toBe(0);
    expect(px(r.x2, 126, 126)[3]).toBe(0);
  });

  it('lifts a dim object to alpha 1 with the gain instead of leaving it half transparent', () => {
    const img = new Image(400, 400);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) img.setPixel(x, y, 1, 1, 1, 255);
    for (let y = 100; y < 200; y++) for (let x = 100; x < 200; x++) img.setPixel(x, y, 40, 120, 40, 255);
    mark(img, 370, 370, 14, [120, 120, 120]);
    const r = G.processParticle(img, 128);
    expect(r.gain).toBeGreaterThan(1.5);
    expect(px(r.x2, 64, 64)[3]).toBeGreaterThan(240);
  });

  it('rejects an empty export', () => {
    const img = new Image(400, 400);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 400; x++) img.setPixel(x, y, 0, 0, 0, 255);
    expect(() => G.processParticle(img, 128)).toThrow(/empty/);
  });
});

describe('PART 2: login backdrop and emblem', () => {
  function backdrop() {
    const img = new Image(1600, 900);
    for (let y = 0; y < 900; y++) for (let x = 0; x < 1600; x++) img.setPixel(x, y, 70 + (x >> 5), 80, 100 + (y >> 5), 255);
    mark(img, 1550, 850, 32, [165, 165, 165]);
    return img;
  }

  it('removes the grey mark from an opaque picture, scales it and leaves no light blob', () => {
    const src = backdrop();
    expect(G.removeBackdropMark(src).components).toBe(1);
    expect(G.removeBackdropMark(src).components).toBe(0);
    const r = G.processBackdrop(backdrop(), 400, 225);
    expect([r.image.width, r.image.height]).toEqual([400, 225]);
    expect(px(r.image, 200, 100)[3]).toBe(255);
    const at = px(r.image, 387, 212)[0];
    const near = px(r.image, 360, 212)[0];
    expect(Math.abs(at - near)).toBeLessThan(25);
  });

  it('reports no mark on a plain picture', () => {
    const img = new Image(1600, 900);
    for (let y = 0; y < 900; y++) for (let x = 0; x < 1600; x++) img.setPixel(x, y, 40, 60, 90, 255);
    expect(G.removeBackdropMark(img).components).toBe(0);
  });

  it('keys an emblem on magenta (hole included) and fits the longest side', () => {
    const img = new Image(400, 480);
    for (let y = 0; y < 480; y++) for (let x = 0; x < 400; x++) img.setPixel(x, y, 250, 40, 248, 255);
    for (let y = 100; y < 380; y++) for (let x = 100; x < 330; x++) img.setPixel(x, y, 60, 140, 70, 255);
    for (let y = 200; y < 260; y++) for (let x = 180; x < 240; x++) img.setPixel(x, y, 250, 40, 248, 255); // enclosed hole
    mark(img, 370, 450, 20, [255, 160, 255]);
    const r = G.processEmblem(img, 256);
    expect(Math.max(r.x2.width, r.x2.height)).toBe(256);
    expect(Math.max(r.x1.width, r.x1.height)).toBe(128);
    expect(r.sparkle.components).toBe(1);
    expect(px(r.x2, Math.round(r.x2.width * 0.5), Math.round(r.x2.height * 0.42))[3]).toBe(0); // the hole is transparent
  });
});

describe('PART 2: manifest', () => {
  const manifest = JSON.parse(fs.readFileSync(path.resolve(here, '../src/gemini/manifest.json'), 'utf8'));
  const root = path.resolve(here, '../../../assets-src/gemini');

  it('every prop source exists; the two replacements keep their key and point at the v2 files', () => {
    for (const [k, d] of Object.entries(manifest.props)) {
      const f = path.join(root, (d.src || 'props/' + k) + '.png');
      expect(fs.existsSync(f), f).toBe(true);
    }
    expect(manifest.props.tree_pine_02.src).toBe('props2/tree_pine_02_v2');
    expect(manifest.props.rock_large_spirit.src).toBe('props2/rock_large_spirit_v2');
    expect(manifest.props.tree_pine_02_v2).toBeUndefined();
  });

  it('status ids fill the 4 x 3 grid exactly and are unique; realm badges are the 3 x 3 nine', () => {
    const s = manifest.status;
    expect(s.ids).toHaveLength(s.cols * s.rows);
    expect(new Set(s.ids).size).toBe(s.ids.length);
    expect(manifest.realms.cols * manifest.realms.rows).toBe(9);
  });

  it('zone dressing exists for the three non-intro zones', () => {
    const zones = new Set(Object.values(manifest.props).flatMap((d) => d.zones ?? []));
    expect([...zones].sort()).toEqual(['co_thu_trung_tam', 'dam_lay_doc', 'doc_hoa_dam']);
  });

  it('the 10 particle exports exist', () => {
    expect(manifest.particles.names).toHaveLength(10);
    for (const n of manifest.particles.names) expect(fs.existsSync(path.join(root, 'particles', n + '.png')), n).toBe(true);
  });
});

// ------------------------------------------------------------------ PART 3 (groups N, O, P)
describe('part 3: sect props, item grids, HUD icons', () => {
  const part3 = ['sect_main_hall', 'sect_gate', 'sect_scripture_pavilion', 'sect_alchemy_furnace', 'sect_forge_anvil', 'sect_training_dummy', 'sect_contribution_board', 'sect_lantern_post', 'sect_banner'];
  const manifestP3 = JSON.parse(fs.readFileSync(path.resolve(here, '../src/gemini/manifest.json'), 'utf8'));

  it('the nine sect props are registered from the sect inbox, placed by the layout only (no biome, weight 0) and kept @1x in both pages', () => {
    for (const n of part3) {
      const d = manifestP3.props[n];
      expect(d, n).toBeDefined();
      expect(d.src).toBe(`sect/${n}`);
      expect(d.biomes).toEqual([]);
      expect(d.weight).toBe(0);
      expect(d.x1only).toBe(true);
    }
  });

  it('every grid fills its cells with unique ids; the HUD grid is 4 x 4 with a 96 px @2x size', () => {
    for (const g of manifestP3.itemGrids) expect(g.ids).toHaveLength(g.cols * g.rows);
    expect(manifestP3.hud.cols * manifestP3.hud.rows).toBe(manifestP3.hud.ids.length);
    expect(manifestP3.hud.size2).toBe(96);
    const all = [...manifestP3.icons, ...manifestP3.itemGrids.flatMap((g) => g.ids)];
    expect(new Set(all).size).toBe(all.length);
  });

  it('unmixStar removes a translucent white 4-point star blended over the art and reports no light grey left behind', () => {
    const W = 400;
    const img = new Image(W, W);
    img.fill(35, 60, 55, 255); // dark teal backing everywhere
    const cx = 0.9453 * W;
    const r = 0.0245 * W;
    const a = 0.55;
    // paint the star as the Gemini mark does: P' = P (1 - a) + 255 a
    for (let y = 0; y < W; y++)
      for (let x = 0; x < W; x++)
        if (Math.pow(Math.abs(x - cx) / r, 2 / 3) + Math.pow(Math.abs(y - cx) / r, 2 / 3) <= 1) {
          const i = (y * W + x) * 4;
          for (let c = 0; c < 3; c++) img.data[i + c] = Math.round(img.data[i + c] * (1 - a) + 255 * a);
        }
    const centre = (cx | 0) * 4 + (cx | 0) * W * 4;
    expect(img.data[centre]).toBeGreaterThan(120); // the star is there
    const res = G.unmixStar(img);
    expect(res.pixels).toBeGreaterThan(30);
    expect(res.residual).toBe(0);
    for (let c = 0; c < 3; c++) expect(Math.abs(img.data[centre + c] - [35, 60, 55][c])).toBeLessThan(8);
  });

  it('extraBg keys a second background colour (a grid cell with its own darker magenta backing) without touching the art', () => {
    const img = new Image(40, 40);
    img.fill(253, 3, 250, 255); // gutter magenta
    for (let y = 8; y < 32; y++) for (let x = 8; x < 32; x++) img.setPixel(x, y, 193, 30, 181, 255); // the cell backing
    for (let y = 16; y < 24; y++) for (let x = 16; x < 24; x++) img.setPixel(x, y, 220, 170, 40, 255); // the icon
    const keyed = G.keyMagenta(img, undefined, { extraBg: [[193, 30, 181]] }).image;
    expect(keyed.data[(10 * 40 + 10) * 4 + 3]).toBe(0); // backing gone
    expect(keyed.data[(1 * 40 + 1) * 4 + 3]).toBe(0); // gutter gone
    expect(keyed.data[(20 * 40 + 20) * 4 + 3]).toBe(255); // gold icon kept
    const plain = G.keyMagenta(img).image;
    expect(plain.data[(10 * 40 + 10) * 4 + 3]).toBeGreaterThan(0); // without extraBg the cell backing would survive
  });
});
