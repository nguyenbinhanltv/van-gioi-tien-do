import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const { readPNGSize } = require('../src/lib/png');
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const ROOT = path.join(__dirname, '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-procgen-test-'));

function gen(name, args) {
  const out = path.join(TMP, name);
  const r = spawnSync(process.execPath, [path.join(ROOT, 'src/tilemap/generate_tilemap.js'), '--out', out, ...args], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`generate_tilemap failed: ${r.stderr}`);
  return {
    dir: out,
    ts: JSON.parse(fs.readFileSync(path.join(out, 'tileset.json'), 'utf8')),
    map: JSON.parse(fs.readFileSync(path.join(out, 'map.json'), 'utf8')),
    pngPath: path.join(out, 'tileset.png'),
  };
}
const sha = (p) => crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const R = {};
beforeAll(() => {
  R.x2 = gen('x2', ['--seed', '123', '--width', '24', '--height', '24']); // mặc định: 128 × 64 (@2x)
  R.x1 = gen('x1', ['--seed', '123', '--width', '24', '--height', '24', '--tileW', '64']); // 64 × 32 (@1x)
  R.again = gen('again', ['--seed', '123', '--width', '24', '--height', '24']);
  R.other = gen('other', ['--seed', '124', '--width', '24', '--height', '24']);
  R.big = gen('big', ['--seed', '20261031', '--width', '64', '--height', '64']);
}, 60000);
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('tilemap: kích thước tile (tài liệu chuẩn mục 3)', () => {
  it('@2x mặc định là 128 × 64, tỷ lệ 2:1', () => {
    expect([R.x2.ts.tileWidth, R.x2.ts.tileHeight]).toEqual([128, 64]);
    expect(R.x2.map.projection.ratio).toBe('2:1');
    expect(R.x2.map.projection.tileWidth).toBe(128);
  });
  it('@1x với --tileW 64 là 64 × 32, tỷ lệ 2:1', () => {
    expect([R.x1.ts.tileWidth, R.x1.ts.tileHeight]).toEqual([64, 32]);
    expect(R.x1.map.projection.tileHeight).toBe(32);
  });
  it('mọi frame đúng kích thước tile, nằm trong ảnh, ảnh khớp manifest và lũy thừa 2', () => {
    for (const r of [R.x1, R.x2]) {
      const { ts } = r;
      const img = readPNGSize(fs.readFileSync(r.pngPath));
      expect([img.width, img.height]).toEqual([ts.imageWidth, ts.imageHeight]);
      expect(Math.log2(img.width) % 1).toBe(0);
      expect(Math.log2(img.height) % 1).toBe(0);
      expect(img.width).toBeLessThanOrEqual(2048);
      for (const f of ts.tiles) {
        expect([f.w, f.h]).toEqual([ts.tileWidth, ts.tileHeight]);
        expect(f.x + f.w).toBeLessThanOrEqual(ts.imageWidth);
        expect(f.y + f.h).toBeLessThanOrEqual(ts.imageHeight);
      }
    }
  });
});

describe('tilemap: hình dạng JSON', () => {
  it('map.json có đủ lớp, mỗi lớp width × height ô và đỉnh lưới (w+1)(h+1)', () => {
    const { map, ts } = R.x2;
    expect(map.format).toBe('tutien-isomap');
    expect(map.layers.map((l) => l.name)).toEqual(['liquid', 'dirt', 'grass']);
    for (const l of map.layers) {
      expect(l.data).toHaveLength(map.width * map.height);
      for (const id of l.data) expect(id === -1 || (id >= 0 && id < ts.tiles.length)).toBe(true);
    }
    expect(map.corners.data).toHaveLength((map.width + 1) * (map.height + 1));
  });
  it('không có ô trống: mỗi ô có ít nhất một lớp', () => {
    const { map } = R.x2;
    for (let k = 0; k < map.width * map.height; k++) {
      expect(map.layers.some((l) => l.data[k] !== -1)).toBe(true);
    }
  });
});

describe('tilemap: Wang theo góc (16 mặt nạ)', () => {
  it('mỗi lớp phủ có đủ mặt nạ 1..14 trỏ tới tile khác nhau, cộng 4 biến thể ô thuần (mặt nạ 0 = trống, 15 = ô thuần)', () => {
    expect(R.x2.ts.wang.type).toBe('corner');
    for (const L of R.x2.ts.wang.layers) {
      const ids = [];
      for (let m = 1; m <= 14; m++) {
        expect(L.masks[String(m)], `${L.name} mask ${m}`).toBeTypeOf('number');
        ids.push(L.masks[String(m)]);
      }
      expect(new Set(ids).size).toBe(14);
      expect(L.full).toHaveLength(4);
    }
  });
  it('tile đặt trên bản đồ khớp mặt nạ tính từ 4 góc (N·1 + E·2 + S·4 + W·8)', () => {
    const { map, ts } = R.big;
    const W1 = map.width + 1;
    const c = (i, j) => map.corners.data[j * W1 + i];
    const minMat = { dirt: 1, grass: 2 };
    let checked = 0;
    for (let j = 0; j < map.height; j++) {
      for (let i = 0; i < map.width; i++) {
        for (const L of ts.wang.layers) {
          const t = minMat[L.name];
          const mask = (c(i, j) >= t ? 1 : 0) | (c(i + 1, j) >= t ? 2 : 0) | (c(i + 1, j + 1) >= t ? 4 : 0) | (c(i, j + 1) >= t ? 8 : 0);
          const id = map.layers.find((l) => l.name === L.name).data[j * map.width + i];
          if (mask === 0) expect(id).toBe(-1);
          else if (mask === 15) expect(L.full).toContain(id);
          else expect(id).toBe(L.masks[String(mask)]);
          checked++;
        }
      }
    }
    expect(checked).toBe(64 * 64 * 2);
  });
  it('bản đồ 64 × 64 dùng nhiều mặt nạ chuyển tiếp khác nhau (không chỉ ô thuần)', () => {
    const { map, ts } = R.big;
    for (const L of ts.wang.layers) {
      const data = new Set(map.layers.find((l) => l.name === L.name).data);
      const used = Object.values(L.masks).filter((id) => data.has(id)).length;
      expect(used, `lớp ${L.name}`).toBeGreaterThanOrEqual(8);
    }
  });
});

describe('tilemap: xác định theo seed', () => {
  it('cùng seed -> map.json, tileset.json và tileset.png giống hệt từng byte', () => {
    expect(JSON.stringify(R.again.map)).toBe(JSON.stringify(R.x2.map));
    expect(JSON.stringify(R.again.ts)).toBe(JSON.stringify(R.x2.ts));
    expect(sha(R.again.pngPath)).toBe(sha(R.x2.pngPath));
  });
  it('khác seed -> địa hình khác', () => {
    expect(R.other.map.seed).toBe(124);
    expect(R.other.map.corners.data).not.toEqual(R.x2.map.corners.data);
  });
});

describe('items: phi kiếm / icon', () => {
  let swords, icons;
  beforeAll(() => {
    const out = path.join(TMP, 'items');
    const run = () => spawnSync(process.execPath, [path.join(ROOT, 'src/items/generate_items.js'), '--seed', '7', '--out', out], { encoding: 'utf8' });
    const r = run();
    if (r.status !== 0) throw new Error(r.stderr);
    swords = path.join(out, 'swords');
    icons = path.join(out, 'icons');
    R.itemsOut = out;
    R.itemsHash = fs.readdirSync(icons).sort().map((f) => sha(path.join(icons, f)));
  });
  it('phi kiếm đủ 8 hướng × 2 phẩm (SVG) và pivot nằm trong ô', () => {
    const meta = JSON.parse(fs.readFileSync(path.join(swords, 'flying_sword_frames.json'), 'utf8'));
    expect([...meta.directions].sort()).toEqual(['E', 'N', 'NE', 'NW', 'S', 'SE', 'SW', 'W']);
    for (const [tier, frames] of Object.entries(meta.tiers)) {
      for (const d of meta.directions) {
        const f = frames[d];
        expect(f.pivot.x).toBeGreaterThanOrEqual(0);
        expect(f.pivot.x).toBeLessThan(f.w);
        expect(f.pivot.y).toBeLessThan(f.h);
        expect(fs.existsSync(path.join(swords, `flying_sword_${d}_${tier}.svg`))).toBe(true);
      }
    }
  });
  it('3 đan dược + 6 phù lục, SVG hợp lệ 256 × 256', () => {
    const files = fs.readdirSync(icons);
    expect(files.filter((f) => /^pill_.*\.svg$/.test(f))).toHaveLength(3);
    expect(files.filter((f) => /^talisman_.*\.svg$/.test(f) && !f.includes('sheet'))).toHaveLength(6);
    const svg = fs.readFileSync(path.join(icons, 'pill_cuu_chuyen.svg'), 'utf8');
    expect(svg).toMatch(/^<svg[^>]*width="256"[^>]*height="256"/);
  });
  it('cùng seed -> icon giống hệt', () => {
    const out2 = path.join(TMP, 'items2');
    const r = spawnSync(process.execPath, [path.join(ROOT, 'src/items/generate_items.js'), '--seed', '7', '--out', out2], { encoding: 'utf8' });
    expect(r.status).toBe(0);
    const dir = path.join(out2, 'icons');
    expect(fs.readdirSync(dir).sort().map((f) => sha(path.join(dir, f)))).toEqual(R.itemsHash);
  });
});
