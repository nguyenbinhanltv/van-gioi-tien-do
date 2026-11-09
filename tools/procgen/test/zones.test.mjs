import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js');
const Z = require('../src/tilemap/zones.js');
const Gen = require('../src/tilemap/generate_tilemap.js');
const layout = require('../../../packages/shared/src/data/world_layout.json');

const GEN = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '../src/tilemap/generate_tilemap.js');

/** Corner levels of an `n` map in zone mode with the real noise fields (no tile rendering: fast). */
function zoneCorners(n, seed = 20261031) {
  const o = { ...Gen.parseArgs([]), width: n, height: n, seed };
  return { o, zc: Z.generateZoneCorners(o, Gen.makeFields(o)) };
}
const at = (zc, i, j) => zc.level[j * zc.W1 + i];

describe('zone layout (D95)', () => {
  it('has the four docs/10 §4 zones on the four quadrants, rectangles inside the map with the mob-zone margin', () => {
    expect(Z.ZONE_IDS).toEqual(['bia_rung', 'dam_lay_doc', 'co_thu_trung_tam', 'doc_hoa_dam']);
    const n = 256;
    const m = Z.mobZoneMargin(n);
    expect(m).toBe(8);
    expect(Z.zoneRects(n)).toEqual([
      { id: 'bia_rung', i0: 8, j0: 8, i1: 120, j1: 120 },
      { id: 'dam_lay_doc', i0: 136, j0: 8, i1: 248, j1: 120 },
      { id: 'co_thu_trung_tam', i0: 8, j0: 136, i1: 120, j1: 248 },
      { id: 'doc_hoa_dam', i0: 136, j0: 136, i1: 248, j1: 248 },
    ]);
    expect(Z.zoneIndexAt(10, 10, n)).toBe(0);
    expect(Z.zoneIndexAt(200, 10, n)).toBe(1);
    expect(Z.zoneIndexAt(10, 200, n)).toBe(2);
    expect(Z.zoneIndexAt(200, 200, n)).toBe(3);
  });

  it('the plaza (spawn square + D83 safe radius) is larger than the normal-band start', () => {
    const n = 256;
    const R = Z.mobAreaHalfSize(n);
    const bandStart = layout.mobBands.normal.minFrac * R;
    expect(Z.plazaRadius(n)).toBeCloseTo(bandStart + layout.plazaMarginTiles, 9);
    expect(Z.plazaRadius(n)).toBeGreaterThan(12); // the dev server spawn square is 24 tiles wide
  });
});

describe('generateZoneCorners', () => {
  const n = 256;
  const { zc } = zoneCorners(n);
  const half = n / 2;

  it('is deterministic for a seed and differs for another seed', () => {
    const a = zoneCorners(n, 7).zc;
    const b = zoneCorners(n, 7).zc;
    const c = zoneCorners(n, 8).zc;
    expect(Buffer.from(a.level).equals(Buffer.from(b.level))).toBe(true);
    expect(Buffer.from(a.level).equals(Buffer.from(c.level))).toBe(false);
  });

  it('the plaza around the map centre and the zone borders are dirt only', () => {
    const plaza = Z.plazaRadius(n);
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        const cheb = Math.max(Math.abs(i - half), Math.abs(j - half));
        const dBorder = Math.min(Math.abs(i - half), Math.abs(j - half));
        if (cheb <= plaza || dBorder < layout.zoneBorderCorners) expect(at(zc, i, j)).toBe(Z.LEVEL.DIRT);
      }
  });

  it('two zones only ever touch through dirt: adjacent corners of different zones are both dirt', () => {
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const z = zc.zone[j * zc.W1 + i];
        for (const [di, dj] of [[1, 0], [0, 1], [1, 1], [1, -1]]) {
          const ni = i + di, nj = j + dj;
          if (nj < 0 || ni > n || nj > n) continue;
          if (zc.zone[nj * zc.W1 + ni] !== z) {
            expect(at(zc, i, j)).toBe(Z.LEVEL.DIRT);
            expect(at(zc, ni, nj)).toBe(Z.LEVEL.DIRT);
          }
        }
      }
  });

  it('lava (liquid in the lava zone) never touches dirt: a stone-crust ring separates them', () => {
    const lavaZone = Z.ZONE.doc_hoa_dam;
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        if (zc.zone[j * zc.W1 + i] !== lavaZone || at(zc, i, j) !== Z.LEVEL.LIQUID) continue;
        for (let dj = -1; dj <= 1; dj++)
          for (let di = -1; di <= 1; di++) {
            const ni = i + di, nj = j + dj;
            if (ni < 0 || nj < 0 || ni > n || nj > n) continue;
            expect(at(zc, ni, nj)).not.toBe(Z.LEVEL.DIRT);
          }
      }
  });

  it('every zone has its own look: water + ground + dirt (bia_rung, dam_lay_doc), a stone ring and a grass clearing (co_thu), lava + crust (doc_hoa)', () => {
    const count = (zone, level) => {
      let k = 0;
      for (let j = 0; j <= n; j++) for (let i = 0; i <= n; i++) if (zc.zone[j * zc.W1 + i] === zone && at(zc, i, j) === level) k++;
      return k;
    };
    for (const z of [Z.ZONE.bia_rung, Z.ZONE.dam_lay_doc]) {
      expect(count(z, Z.LEVEL.LIQUID)).toBeGreaterThan(500);
      expect(count(z, Z.LEVEL.DIRT)).toBeGreaterThan(500);
      expect(count(z, Z.LEVEL.GROUND)).toBeGreaterThan(500);
    }
    expect(count(Z.ZONE.co_thu_trung_tam, Z.LEVEL.STONE)).toBeGreaterThan(500); // the ring
    expect(count(Z.ZONE.doc_hoa_dam, Z.LEVEL.LIQUID)).toBeGreaterThan(1000); // lava
    expect(count(Z.ZONE.doc_hoa_dam, Z.LEVEL.GROUND)).toBeGreaterThan(1000); // crust
    expect(count(Z.ZONE.bia_rung, Z.LEVEL.STONE) + count(Z.ZONE.dam_lay_doc, Z.LEVEL.STONE) + count(Z.ZONE.doc_hoa_dam, Z.LEVEL.STONE)).toBe(0);
    // the giant-tree clearing: grass only, at the centre of the zone
    const r = Z.zoneRects(n)[Z.ZONE.co_thu_trung_tam];
    const ci = (r.i0 + r.i1) / 2, cj = (r.j0 + r.j1) / 2;
    const clear = layout.clearingFrac * Z.mobAreaHalfSize(n);
    for (let j = 0; j <= n; j++)
      for (let i = 0; i <= n; i++) {
        if (Math.hypot(i - ci, j - cj) < clear - 1 && zc.zone[j * zc.W1 + i] === Z.ZONE.co_thu_trung_tam) expect(at(zc, i, j)).toBe(Z.LEVEL.GROUND);
      }
  });
});

describe('generate_tilemap --zones (end to end on a small map with synthetic ground patches)', () => {
  let dir;
  let ground;
  const N = 64;
  /** Runs the generator; returns stdout + stderr (the fallback warning goes to stderr). Throws when it fails. */
  const run = (out, extra = []) => {
    const r = spawnSync(process.execPath, [GEN, '--width', String(N), '--height', String(N), '--out', out, '--previewScale', '0', ...extra], {
      encoding: 'utf8',
    });
    if (r.status !== 0) throw new Error(`generator failed: ${r.stderr}`);
    return r.stdout + r.stderr;
  };
  const read = (out, f) => JSON.parse(fs.readFileSync(path.join(out, f), 'utf8'));

  beforeAll(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-zones-'));
    ground = path.join(dir, 'ground');
    fs.mkdirSync(ground);
    const colors = { water: [40, 120, 170], dirt: [130, 95, 60], grass: [70, 150, 70], stone: [130, 130, 125], swamp: [70, 90, 40], lava: [200, 70, 20] };
    for (const [m, c] of Object.entries(colors))
      for (let v = 0; v < 4; v++) {
        const img = new Image(32, 32);
        for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) img.setPixel(x, y, c[0] + ((x * 7 + y * 3 + v) % 11), c[1], c[2], 255);
        img.save(path.join(ground, `${m}_${v}.png`));
      }
  });
  afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('writes one merged tileset (base + ext tiles, lava animation), the zone layers, the zones and a walkability file', () => {
    const out = path.join(dir, 'a');
    run(out, ['--ground', ground, '--zones', '1']);
    const ts = read(out, 'tileset.json');
    const map = read(out, 'map.json');
    expect(ts.tiles.length).toBe(98); // 40 base + 58 ext
    expect(ts.imageHeight).toBe(1024);
    expect(Object.keys(ts.animations)).toEqual(['water', 'lava']);
    expect(ts.animations.lava.frames).toHaveLength(4);
    expect(ts.drawOrder).toEqual(Z.LAYER_ORDER);
    expect(map.layers.map((l) => l.name)).toEqual(Z.LAYER_ORDER);
    expect(map.zones).toEqual(Z.zoneRects(N));
    expect(map.landmarks).toEqual(Z.landmarks(N));
    expect(map.landmarks[0]).toMatchObject({ id: 'co_thu_clearing' });
    const ids = new Set(ts.tiles.map((t) => t.id));
    for (const l of map.layers) for (const id of l.data) if (id !== -1) expect(ids.has(id)).toBe(true);
  });

  it('zone layers appear only in their own zone and lava / water-only cells are the blocked ones in terrain.json', () => {
    const out = path.join(dir, 'b');
    run(out, ['--ground', ground, '--zones', '1']);
    const map = read(out, 'map.json');
    const ts = read(out, 'tileset.json');
    const terrain = read(out, 'terrain.json');
    const layer = (name) => map.layers.find((l) => l.name === name).data;
    const zoneOfCell = (k) => Z.ZONE_IDS[Z.zoneIndexAt((k % N) + 0.5, Math.floor(k / N) + 0.5, N)];
    const where = { swamp_bank: 'dam_lay_doc', stone_bank: 'co_thu_trung_tam', lava_crust: 'doc_hoa_dam', grass: null };
    for (const [name, zone] of Object.entries(where)) {
      const d = layer(name);
      for (let k = 0; k < d.length; k++) if (d[k] >= 0 && zone) expect(zoneOfCell(k)).toBe(zone);
    }
    // grass only in the zones that have it
    const grass = layer('grass');
    for (let k = 0; k < grass.length; k++) if (grass[k] >= 0) expect(['bia_rung', 'co_thu_trung_tam']).toContain(zoneOfCell(k));
    // lava liquid only in the lava zone
    const lavaIds = new Set(ts.animations.lava.frames);
    const liquid = layer('liquid');
    for (let k = 0; k < liquid.length; k++) if (lavaIds.has(liquid[k])) expect(zoneOfCell(k)).toBe('doc_hoa_dam');
    // walkability: '.' iff some layer above the liquid is drawn
    const land = map.layers.filter((l) => l.name !== 'liquid').map((l) => l.data);
    expect(terrain).toMatchObject({ format: 'tutien-terrain', version: 1, width: N, height: N });
    for (let k = 0; k < N * N; k++) {
      const walk = land.some((d) => d[k] >= 0);
      expect(terrain.rows[Math.floor(k / N)][k % N]).toBe(walk ? '.' : '#');
    }
    // a lava-only cell is blocked (the map has some at this seed in the lava zone)
    let lavaOnly = 0;
    for (let k = 0; k < N * N; k++) if (lavaIds.has(liquid[k]) && !land.some((d) => d[k] >= 0)) lavaOnly++;
    expect(lavaOnly).toBeGreaterThan(0);
  });

  it('a full (opaque) tile hides everything under it, so the layers below it are not emitted (fewer sprites on the client)', () => {
    const out = path.join(dir, 'f');
    run(out, ['--ground', ground, '--zones', '1']);
    const map = read(out, 'map.json');
    const ts = read(out, 'tileset.json');
    const full = new Set(ts.tiles.filter((t) => /_full_\d+$/.test(t.name)).map((t) => t.id));
    const idx = Object.fromEntries(map.layers.map((l, n) => [l.name, n]));
    let checked = 0;
    for (let k = 0; k < N * N; k++) {
      // from the top layer down: once a full tile is met, no lower layer of the cell may hold a tile
      let seenFull = false;
      for (let n = Z.LAYER_ORDER.length - 1; n >= 0; n--) {
        const id = map.layers[idx[Z.LAYER_ORDER[n]]].data[k];
        if (seenFull) expect(id).toBe(-1);
        else if (id >= 0 && full.has(id)) {
          seenFull = true;
          checked++;
        }
      }
    }
    expect(checked).toBeGreaterThan(100);
  });

  it('the spawn plaza at the map centre is walkable', () => {
    const out = path.join(dir, 'c');
    run(out, ['--ground', ground, '--zones', '1']);
    const terrain = read(out, 'terrain.json');
    const c = N / 2;
    const r = Math.floor(layout.mobBands.normal.minFrac * Z.mobAreaHalfSize(N));
    for (let j = c - r; j < c + r; j++) for (let i = c - r; i < c + r; i++) expect(terrain.rows[j][i]).toBe('.');
  });

  it('is deterministic (same files twice) and --zones without ground falls back to the unchanged base map', () => {
    const a = path.join(dir, 'd1');
    const b = path.join(dir, 'd2');
    run(a, ['--ground', ground, '--zones', '1']);
    run(b, ['--ground', ground, '--zones', '1']);
    for (const f of ['map.json', 'tileset.json', 'terrain.json', 'tileset.png'])
      expect(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f)))).toBe(true);
    const base = path.join(dir, 'e1');
    const fallback = path.join(dir, 'e2');
    run(base);
    const log = run(fallback, ['--zones', '1']);
    expect(log).toContain('--zones');
    for (const f of ['map.json', 'tileset.json', 'tileset.png']) expect(fs.readFileSync(path.join(base, f)).equals(fs.readFileSync(path.join(fallback, f)))).toBe(true);
  });
});
