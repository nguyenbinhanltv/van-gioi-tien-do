import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Image, decodePNG } = require('../src/lib/png.js');
const Ground = require('../src/gemini/ground.js');
const Tex = require('../src/tilemap/ground_textures.js');
const Gen = require('../src/tilemap/generate_tilemap.js');
const Process = require('../src/gemini/process.js');

/** Smooth random-ish texture that does NOT wrap (a ramp + hash noise): the worst case for the seam score. */
function ramp(n, seed = 1) {
  const img = new Image(n, n);
  let s = seed;
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  for (let y = 0; y < n; y++)
    for (let x = 0; x < n; x++) {
      const base = 60 + (x / n) * 120 + (y / n) * 50;
      const v = base + rnd() * 30;
      img.setPixel(x, y, v, v * 0.9, 40 + (y / n) * 150 + rnd() * 20, 255);
    }
  return img;
}

describe('seamScore / makeSeamless', () => {
  it('a ramp with noise has a visible wrap seam, and the two-pass blend removes it', () => {
    const img = ramp(256);
    const before = Ground.seamScore(img);
    expect(before.ratio).toBeGreaterThan(3);
    const fixed = Ground.makeSeamless(img);
    const after = Ground.seamScore(fixed);
    expect(after.x).toBeLessThan(1.5);
    expect(after.y).toBeLessThan(1.5);
  });

  it('a texture that already wraps is not made worse', () => {
    const n = 128;
    const img = new Image(n, n);
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        const v = 128 + 60 * Math.sin((x / n) * Math.PI * 4) * Math.cos((y / n) * Math.PI * 6);
        img.setPixel(x, y, v, v, v, 255);
      }
    expect(Ground.seamScore(img).ratio).toBeLessThan(2);
    expect(Ground.seamScore(Ground.makeSeamless(img)).ratio).toBeLessThan(2);
  });

  it('periodicPatch crops, wraps and resizes', () => {
    const p = Ground.periodicPatch(ramp(256), { x: 0, y: 0, size: 128, out: 32 });
    expect([p.image.width, p.image.height]).toEqual([32, 32]);
    expect(p.before.ratio).toBeGreaterThan(p.after.ratio);
  });
});

describe('removeGroundMark', () => {
  /** 512 px flat-ish noise texture with a washed-out star + dark outline where the Gemini mark sits (114 px from the right / bottom). */
  function flatNoise(n, seed) {
    const img = new Image(n, n);
    let s = seed;
    for (let y = 0; y < n; y++)
      for (let x = 0; x < n; x++) {
        s = (s * 1664525 + 1013904223) >>> 0;
        const v = 110 + (s / 4294967296) * 40;
        img.setPixel(x, y, v, v * 0.9, 70 + (s % 20), 255);
      }
    return img;
  }
  function withStar() {
    const img = flatNoise(512, 7);
    const cx = 512 - 114, cy = 512 - 114;
    for (let y = cy - 60; y <= cy + 60; y++)
      for (let x = cx - 60; x <= cx + 60; x++) {
        const d = Math.abs(x - cx) + Math.abs(y - cy);
        if (d < 56) img.setPixel(x, y, 235, 235, 235, 255);
        else if (d < 62) img.setPixel(x, y, 20, 20, 20, 255);
      }
    return img;
  }
  it('finds the mark, patches it, and the contrast there drops', () => {
    const img = withStar();
    const before = Ground.markContrast(img);
    expect(before).toBeGreaterThan(30);
    expect(Ground.removeGroundMark(img)).toBeGreaterThan(30);
    expect(Ground.markContrast(img)).toBeLessThan(Math.max(25, before * 0.5));
  });
  it('returns 0 and leaves the image alone when there is no mark', () => {
    const img = flatNoise(512, 3);
    const copy = Uint8ClampedArray.from(img.data);
    expect(Ground.removeGroundMark(img)).toBe(0);
    expect(Array.from(img.data)).toEqual(Array.from(copy));
  });
});

describe('ground tiles from patches', () => {
  let dir, out;
  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-ground-'));
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-ground-out-'));
    fs.mkdirSync(path.join(dir, 'g'));
    Tex.MATERIALS.forEach((m, mi) => {
      for (let k = 0; k < Tex.VARIANTS; k++) {
        const patch = Ground.makeSeamless(ramp(64, 10 * mi + k + 1));
        fs.writeFileSync(path.join(dir, 'g', `${m}_${k}.png`), patch.toPNG());
      }
    });
  });
  afterAll(() => {
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(out, { recursive: true, force: true });
  });

  it('sampleWrap has period 1 in both axes', () => {
    const patch = decodePNG(fs.readFileSync(path.join(dir, 'g', 'dirt_0.png')));
    for (const [u, v] of [[0.13, 0.77], [0.5, 0.5], [0.99, 0.01]]) {
      const a = Tex.sampleWrap(patch, u, v);
      for (const [du, dv] of [[1, 0], [0, 1], [-2, 3]]) {
        const b = Tex.sampleWrap(patch, u + du, v + dv);
        for (let k = 0; k < 3; k++) expect(Math.abs(a[k] - b[k])).toBeLessThan(1e-6);
      }
    }
  });

  it('loadGround reads every material; a missing or empty directory gives null', () => {
    const g = Tex.loadGround(path.join(dir, 'g'));
    expect(Object.keys(g).sort()).toEqual([...Tex.MATERIALS].sort());
    expect(g.grass).toHaveLength(Tex.VARIANTS);
    expect(Tex.loadGround(path.join(dir, 'nope'))).toBeNull();
    expect(Tex.loadGround('')).toBeNull();
  });

  it('variants differ only inside the tile: the edge of the diamond is identical for variant 0 and 2', () => {
    Gen.setGround(Tex.loadGround(path.join(dir, 'g')));
    try {
      const o = Gen.parseArgs([]);
      const L = { name: 'dirt', material: 'dirt', over: 'water', threshold: 0.4, seed: 1301, rimDark: 0, foam: false };
      const a = Gen.renderTile(o, { kind: 'overlay', layer: L, mask: 15, variant: 0 });
      const b = Gen.renderTile(o, { kind: 'overlay', layer: L, mask: 15, variant: 2 });
      const { tileW: TW, tileH: TH } = o;
      let edge = 0, maxDiff = 0, inner = 0, innerDiff = 0;
      for (let y = 0; y < TH; y++)
        for (let x = 0; x < TW; x++) {
          const r = Math.abs(x + 0.5 - TW / 2) / (TW / 2) + Math.abs(y + 0.5 - TH / 2) / (TH / 2);
          const pa = a.getPixel(x, y), pb = b.getPixel(x, y);
          if (r > 0.94 && r < 0.97) {
            edge++;
            maxDiff = Math.max(maxDiff, Math.abs(pa[0] - pb[0]), Math.abs(pa[1] - pb[1]), Math.abs(pa[2] - pb[2]));
          } else if (r < 0.5) {
            inner++;
            innerDiff += Math.abs(pa[0] - pb[0]) + Math.abs(pa[1] - pb[1]) + Math.abs(pa[2] - pb[2]);
          }
        }
      expect(edge).toBeGreaterThan(50);
      expect(maxDiff).toBeLessThan(14); // the edge band is (almost) identical, so neighbours of different variants join
      expect(innerDiff / inner).toBeGreaterThan(8); // while the interior really differs
    } finally {
      Gen.setGround(null);
    }
  });

  it('the CLI writes the usual tileset from patches, plus the extra stone / lava / swamp families with 16 Wang masks each', () => {
    const { spawnSync } = require('node:child_process');
    const r = spawnSync(
      process.execPath,
      [path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../src/tilemap/generate_tilemap.js'), '--out', out, '--ground', path.join(dir, 'g'), '--ext', '1', '--width', '12', '--height', '12', '--previewScale', '0.05'],
      { encoding: 'utf8' },
    );
    expect(r.status, r.stderr).toBe(0);
    const ts = JSON.parse(fs.readFileSync(path.join(out, 'tileset.json'), 'utf8'));
    expect(ts.tiles).toHaveLength(40); // 4 water + 2 layers x (4 full + 14 masks): same set as the procedural tileset
    expect(ts.tiles.map((t) => t.name)).toContain('grass_m07');
    const ext = JSON.parse(fs.readFileSync(path.join(out, 'tileset_ext.json'), 'utf8'));
    expect(ext.tiles).toHaveLength(4 + 3 * 18);
    expect(ext.wang.layers.map((l) => l.name)).toEqual(['stone_bank', 'lava_crust', 'swamp_bank']);
    for (const l of ext.wang.layers) {
      expect(Object.keys(l.masks)).toHaveLength(14);
      expect(l.full).toHaveLength(4);
    }
    expect(ext.animations.lava.frames).toHaveLength(4);
    const png = decodePNG(fs.readFileSync(path.join(out, 'tileset.png')));
    expect((png.width & (png.width - 1)) | (png.height & (png.height - 1))).toBe(0); // power of two
  });

  it('without --ground the generator stays procedural; --ext without ground only warns', () => {
    const { spawnSync } = require('node:child_process');
    const o2 = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-ground-proc-'));
    const r = spawnSync(
      process.execPath,
      [path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../src/tilemap/generate_tilemap.js'), '--out', o2, '--ext', '1', '--width', '8', '--height', '8', '--previewScale', '0.05'],
      { encoding: 'utf8' },
    );
    try {
      expect(r.status, r.stderr).toBe(0);
      expect(fs.existsSync(path.join(o2, 'tileset_ext.json'))).toBe(false);
      expect(r.stdout).toContain('texture toán học');
    } finally {
      fs.rmSync(o2, { recursive: true, force: true });
    }
  });
});

describe('processUi (9-slice frames)', () => {
  it('keys the magenta background, trims, and scales to the design width (@2x twice that)', () => {
    const img = new Image(600, 400);
    for (let y = 0; y < 400; y++) for (let x = 0; x < 600; x++) img.setPixel(x, y, 250, 40, 248, 255);
    for (let y = 80; y < 240; y++) for (let x = 60; x < 460; x++) img.setPixel(x, y, 150, 40, 40, 255);
    // sparkle inside the corner box (15% of 400 = 60 px)
    for (let y = 340; y <= 380; y++)
      for (let x = 540; x <= 580; x++) if (Math.abs(x - 560) + Math.abs(y - 360) < 20) img.setPixel(x, y, 255, 160, 255, 255);
    const r = Process.processUi(img, 100);
    expect(r.sparkle.components).toBe(1);
    expect([r.x1.width, r.x1.height]).toEqual([100, 40]);
    expect([r.x2.width, r.x2.height]).toEqual([200, 80]);
    expect(r.x1.getPixel(50, 20).slice(0, 4)).toEqual([150, 40, 40, 255]);
  });
});

describe('tile edge hairlines and water palette', () => {
  it('bleedColors spreads the edge colour into the transparent texels (alpha stays 0), so bilinear filtering cannot darken the edge', () => {
    const img = new Image(8, 1);
    for (let x = 0; x < 8; x++) img.setPixel(x, 0, 0, 0, 0, 0);
    img.setPixel(3, 0, 200, 120, 40, 255);
    const out = Gen.bleedColors(img, 2);
    expect(out.getPixel(3, 0)).toEqual([200, 120, 40, 255]);
    for (const x of [1, 2, 4, 5]) {
      const [r, g, b, a] = out.getPixel(x, 0);
      expect([r, g, b, a]).toEqual([200, 120, 40, 0]);
    }
    expect(out.getPixel(7, 0)).toEqual([0, 0, 0, 0]); // out of reach stays empty
  });
  it('the diamond is grown enough that a neighbour covers the texels filtered at its edge', () => {
    const tile = Gen.renderTile(
      { tileW: 128, tileH: 64, waterFrames: 4, variants: 1, padding: 2 },
      { kind: 'water', frame: 0 },
    );
    // pixel just outside the exact diamond (|dx|/64 + |dy|/32 = 1.03) is already opaque
    expect(tile.getPixel(64 + 66, 32)[3]).toBe(255);
  });
  it('liquidColor grades water onto the art-bible ramp (deep blue .. jade) and leaves lava alone', () => {
    const patch = new Image(16, 16);
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) patch.setPixel(x, y, 150 + x * 3, 210 + y, 230, 255);
    const patches = { water: [patch], lava: [patch] };
    const lava = Tex.liquidColor(patches, 'lava', 0.3, 0.6, 0, 4);
    const water = Tex.liquidColor(patches, 'water', 0.3, 0.6, 0, 4);
    expect(water[0]).toBeLessThan(lava[0]); // less pale: red channel drops towards #294451 / #5E8798
    for (const c of water) expect(c).toBeGreaterThanOrEqual(0);
    expect(water[2]).toBeGreaterThan(water[0]); // still blue-dominant
  });
});
