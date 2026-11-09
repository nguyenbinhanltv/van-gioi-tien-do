import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BUDGETS } from '@vgtd/shared';
import { runBudget, renderMarkdown, isPow2, atlasCap, INITIAL_PACKAGE_RESERVED_MB } from '../src/budget/check.mjs';

const require = createRequire(import.meta.url);
const { Image } = require('../src/lib/png.js') as {
  Image: new (w: number, h: number) => { width: number; height: number; data: Uint8ClampedArray; save(p: string): void };
};
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-budget-test-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

interface Spec {
  name: string;
  /** page width/height as written to the PNG and JSON */
  width?: number;
  height?: number;
  frameSize?: number;
  frames?: number;
  padding?: number;
  declaredPadding?: number;
  extrude?: boolean;
  gap?: number;
}

/** Build a tutien-atlas (JSON + PNG) like pack_atlas.js does: one row of solid-colour frames. */
function makeAtlas(dir: string, s: Spec): void {
  const pad = s.padding ?? BUDGETS.ATLAS_PADDING_PX;
  const size = s.frameSize ?? 16;
  const n = s.frames ?? 3;
  const gap = s.gap ?? 2 * pad;
  const W = s.width ?? 128;
  const H = s.height ?? 64;
  const img = new Image(W, H);
  const frames: Record<string, unknown> = {};
  for (let k = 0; k < n; k++) {
    const x0 = pad + k * (size + gap);
    const y0 = pad;
    const ring = s.extrude === false ? 0 : pad;
    for (let y = -ring; y < size + ring; y++) {
      for (let x = -ring; x < size + ring; x++) {
        const px = x0 + x;
        const py = y0 + y;
        if (px < 0 || py < 0 || px >= W || py >= H) continue;
        const i = (py * W + px) * 4;
        img.data.set([40 + k * 30, 90, 160, 255], i);
      }
    }
    frames[`f${k}`] = { page: 0, x: x0, y: y0, w: size, h: size };
  }
  fs.mkdirSync(dir, { recursive: true });
  img.save(path.join(dir, `${s.name}_0.png`));
  fs.writeFileSync(
    path.join(dir, `${s.name}.json`),
    JSON.stringify({
      format: 'tutien-atlas',
      version: 1,
      name: s.name,
      maxSize: 2048,
      padding: s.declaredPadding ?? pad,
      pages: [{ file: `${s.name}_0.png`, width: W, height: H, count: n }],
      frames,
    }),
  );
}

let dir = '';
let n = 0;
beforeEach(() => {
  dir = path.join(TMP, `case${n++}`);
});
const codes = (r: ReturnType<typeof runBudget>) => r.findings.filter((f) => f.level === 'error').map((f) => f.code);

describe('budget gate: helpers use @vgtd/shared numbers', () => {
  it('isPow2', () => {
    expect([1, 2, 64, 2048, 4096].every(isPow2)).toBe(true);
    expect([0, 3, 100, 1000, 2047].some(isPow2)).toBe(false);
  });
  it('atlas caps: 2048 everywhere, 4096 only for PC map atlases', () => {
    expect(atlasCap('atl_map_a', 'pc')).toBe(BUDGETS.ATLAS_MAX_PC);
    expect(atlasCap('atl_map_a', 'web')).toBe(BUDGETS.ATLAS_MAX_WEB_MOBILE);
    expect(atlasCap('atl_icon_64', 'pc')).toBe(BUDGETS.ATLAS_MAX_WEB_MOBILE);
    expect(atlasCap('tileset', 'pc')).toBe(BUDGETS.ATLAS_MAX_WEB_MOBILE);
  });
});

describe('budget gate: atlas pages', () => {
  it('passes a well-formed atlas (padding 2 + extrude)', () => {
    makeAtlas(dir, { name: 'atl_ok' });
    const r = runBudget({ atlasDir: dir });
    expect(codes(r)).toEqual([]);
    expect(r.ok).toBe(true);
    expect(r.rows).toHaveLength(1);
  });
  it('fails a page that is not a power of two', () => {
    makeAtlas(dir, { name: 'atl_npot', width: 100, height: 64 });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('ATLAS_NOT_POT');
  });
  it('fails a page larger than 2048 on Web, passes a 4096 PC map atlas only on PC', () => {
    makeAtlas(dir, { name: 'atl_big', width: 4096, height: 64, frames: 1 });
    expect(codes(runBudget({ atlasDir: dir, platform: 'web' }))).toContain('ATLAS_TOO_LARGE');
    expect(codes(runBudget({ atlasDir: dir, platform: 'pc' }))).toContain('ATLAS_TOO_LARGE'); // not a map atlas
    const d2 = path.join(TMP, `pcmap${n}`);
    makeAtlas(d2, { name: 'atl_map_forest', width: 4096, height: 64, frames: 1 });
    expect(codes(runBudget({ atlasDir: d2, platform: 'pc' }))).toEqual([]);
    expect(codes(runBudget({ atlasDir: d2, platform: 'mobile' }))).toContain('ATLAS_TOO_LARGE');
  });
});

describe('budget gate: padding and extrude', () => {
  it('fails when the JSON declares padding below 2 px', () => {
    makeAtlas(dir, { name: 'atl_pad', declaredPadding: 1 });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('PADDING_MISSING');
  });
  it('fails when frames are packed closer than the padding allows', () => {
    makeAtlas(dir, { name: 'atl_tight', gap: 1 });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('PADDING_MISSING');
  });
  it('fails when a frame touches the page edge (no padding around it)', () => {
    makeAtlas(dir, { name: 'atl_edge', padding: 0, declaredPadding: 2, gap: 4 });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('PADDING_MISSING');
  });
  it('fails when edge pixels are not extruded into the padding ring', () => {
    makeAtlas(dir, { name: 'atl_noext', extrude: false });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('EXTRUDE_MISSING');
  });
  it('--no-pixels equivalent (checkPixels:false) skips only the pixel check', () => {
    makeAtlas(dir, { name: 'atl_noext2', extrude: false });
    expect(codes(runBudget({ atlasDir: dir, checkPixels: false }))).not.toContain('EXTRUDE_MISSING');
  });
});

describe('budget gate: icons and tiles', () => {
  it.each([48, 64, 128])('accepts atl_icon_%i with %ix%i frames', (s) => {
    makeAtlas(dir, { name: `atl_icon_${s}`, frameSize: s, width: 512, height: 256, frames: 2 });
    expect(codes(runBudget({ atlasDir: dir }))).toEqual([]);
  });
  it('rejects an icon atlas with a size outside 48/64/128', () => {
    makeAtlas(dir, { name: 'atl_icon_50', frameSize: 50, width: 256, height: 64 });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('ICON_SIZE');
  });
  it('rejects icon frames that do not match the atlas size', () => {
    makeAtlas(dir, { name: 'atl_icon_64', frameSize: 48, width: 256, height: 64 });
    expect(codes(runBudget({ atlasDir: dir }))).toContain('ICON_SIZE');
  });
  it('real generated tileset (128x64 and 64x32) passes; a 100x50 tile size fails', () => {
    for (const [tw, ok] of [[128, true], [64, true]] as const) {
      const out = path.join(TMP, `tm${tw}`);
      const r = spawnSync(process.execPath, [path.join(ROOT, 'src/tilemap/generate_tilemap.js'), '--seed', '5', '--width', '16', '--height', '16', '--tileW', String(tw), '--out', out], { encoding: 'utf8' });
      expect(r.status).toBe(0);
      expect(runBudget({ atlasDir: out }).ok).toBe(ok);
    }
    const bad = path.join(TMP, 'tm-bad');
    spawnSync(process.execPath, [path.join(ROOT, 'src/tilemap/generate_tilemap.js'), '--seed', '5', '--width', '8', '--height', '8', '--out', bad]);
    const f = path.join(bad, 'tileset.json');
    const j = JSON.parse(fs.readFileSync(f, 'utf8'));
    j.tileWidth = 100;
    j.tileHeight = 50;
    fs.writeFileSync(f, JSON.stringify(j));
    expect(codes(runBudget({ atlasDir: bad }))).toContain('TILE_SIZE');
  });
});

describe('budget gate: initial package estimate', () => {
  it('passes under the 25 MB budget and reports the reserved engine/audio share', () => {
    makeAtlas(dir, { name: 'atl_small' });
    const r = runBudget({ atlasDir: dir });
    expect(r.estimate.limitMb).toBe(BUDGETS.INITIAL_DOWNLOAD_MB_WEB);
    expect(r.estimate.reservedMb).toBe(INITIAL_PACKAGE_RESERVED_MB);
    expect(r.estimate.totalMb).toBeLessThan(25);
    expect(r.estimate.basis).toBe('png-upper-bound');
    expect(r.findings.some((f) => f.code === 'NOT_COMPRESSED')).toBe(true); // warn, not error
    expect(r.ok).toBe(true);
  });
  it('keeps lazily loaded atlas pages (atl_mobphase) out of the initial package but reports them', () => {
    makeAtlas(dir, { name: 'atl_small' });
    const before = runBudget({ atlasDir: dir });
    makeAtlas(dir, { name: 'atl_mobphase_1x' });
    const after = runBudget({ atlasDir: dir });
    expect(after.estimate.assetBytes).toBe(before.estimate.assetBytes);
    expect(after.estimate.lazyBytes).toBeGreaterThan(0);
    expect(after.rows.some((r) => r.name === 'atl_mobphase_1x')).toBe(true); // still checked
  });
  it('fails on Web when the estimate exceeds 25 MB, but not on PC', () => {
    makeAtlas(dir, { name: 'atl_small' });
    expect(codes(runBudget({ atlasDir: dir, reservedMb: 25 }))).toContain('INITIAL_PACKAGE_OVER');
    expect(codes(runBudget({ atlasDir: dir, reservedMb: 25, platform: 'pc' }))).not.toContain('INITIAL_PACKAGE_OVER');
  });
  it('uses compressed files from --dist when present', () => {
    makeAtlas(dir, { name: 'atl_small' });
    const dist = path.join(TMP, `dist${n}`);
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'atl_small_0.ktx2'), Buffer.alloc(2048));
    const r = runBudget({ atlasDir: dir, distDir: dist });
    expect(r.estimate.basis).toBe('compressed');
    expect(r.estimate.assetBytes).toBe(2048);
    expect(r.findings.some((f) => f.code === 'NOT_COMPRESSED')).toBe(false);
  });
  it('a dist dir with only the skipped-compression manifest falls back to PNG (graceful skip)', () => {
    makeAtlas(dir, { name: 'atl_small' });
    const dist = path.join(TMP, `distskip${n}`);
    fs.mkdirSync(dist);
    fs.writeFileSync(path.join(dist, 'compress_manifest.json'), JSON.stringify({ skipped: true }));
    expect(runBudget({ atlasDir: dir, distDir: dist }).estimate.basis).toBe('png-upper-bound');
  });
});

describe('budget gate: failures and report', () => {
  it('fails when there is no atlas at all', () => {
    fs.mkdirSync(dir);
    expect(codes(runBudget({ atlasDir: dir }))).toContain('NO_ATLAS');
    expect(codes(runBudget({ atlasDir: path.join(dir, 'missing') }))).toContain('NO_ATLAS');
  });
  it('renders a Markdown job summary with PASS/FAIL and findings', () => {
    makeAtlas(dir, { name: 'atl_npot', width: 100, height: 64 });
    const md = renderMarkdown(runBudget({ atlasDir: dir }));
    expect(md).toContain('FAIL');
    expect(md).toContain('ATLAS_NOT_POT');
    expect(md).toContain('| atl_npot |');
  });
  it('CLI exits 20 on a violation, 0 on pass, and appends to the summary file', () => {
    const good = path.join(TMP, `cligood${n}`);
    makeAtlas(good, { name: 'atl_ok' });
    const bad = path.join(TMP, `clibad${n}`);
    makeAtlas(bad, { name: 'atl_bad', declaredPadding: 0 });
    const summary = path.join(TMP, 'summary.md');
    const run = (atlas: string) =>
      spawnSync(process.execPath, ['--import', 'tsx', path.join(ROOT, 'pipeline/budget_gate.mts'), '--atlas', atlas, '--summary', summary], { cwd: ROOT, encoding: 'utf8' });
    expect(run(good).status).toBe(0);
    expect(run(bad).status).toBe(20);
    const text = fs.readFileSync(summary, 'utf8');
    expect(text).toContain('PASS');
    expect(text).toContain('FAIL');
  }, 60000);
});
