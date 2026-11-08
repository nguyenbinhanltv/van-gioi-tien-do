import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { BUDGETS, CHIBI_RUNTIME } from '@vgtd/shared';
import { buildBundle, discoverSources, lanczos3Resize, packPages, planBundle } from '../src/runtime/chibi.mjs';
import { runBudget } from '../src/budget/check.mjs';
import { astcBytes, checkChibi } from '../src/budget/chibi.mjs';

const require = createRequire(import.meta.url);
const { Image, decodePNG } = require('../src/lib/png.js') as {
  Image: new (w: number, h: number) => { width: number; height: number; data: Uint8ClampedArray; toPNG(): Buffer };
  decodePNG: (b: Buffer) => { width: number; height: number; data: Uint8ClampedArray };
};
const SRC = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../apps/client-cocos/assets/resources/dragonbones');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vgtd-chibi-test-'));
afterAll(() => fs.rmSync(TMP, { recursive: true, force: true }));

describe('lanczos3Resize', () => {
  it('keeps a flat premultiplied colour and never lets colour exceed alpha', () => {
    const img = new Image(16, 16);
    for (let i = 0; i < 16 * 16; i++) img.data.set([100, 50, 20, 200], i * 4);
    const o = lanczos3Resize(img, 8, 8);
    for (let i = 0; i < 64; i++) expect([...o.data.slice(i * 4, i * 4 + 4)]).toEqual([100, 50, 20, 200]);
    const edge = new Image(8, 8);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 4; x++) edge.data.set([255, 255, 255, 255], (y * 8 + x) * 4);
    const r = lanczos3Resize(edge, 4, 4);
    for (let i = 0; i < 16; i++) expect(Math.max(r.data[i * 4]!, r.data[i * 4 + 1]!, r.data[i * 4 + 2]!)).toBeLessThanOrEqual(r.data[i * 4 + 3]!);
  });
});

describe('packPages', () => {
  const pad = BUDGETS.ATLAS_PADDING_PX;
  it('uses power-of-two pages within the cap and never overlaps padded frames', () => {
    const rects = Array.from({ length: 60 }, (_, i) => ({ name: `f${i}`, w: 40 + (i % 7) * 9, h: 60 + (i % 5) * 11 }));
    const pages = packPages(rects, 512, pad);
    const seen = new Set<string>();
    for (const p of pages) {
      expect(p.width & (p.width - 1)).toBe(0);
      expect(p.height & (p.height - 1)).toBe(0);
      expect(Math.max(p.width, p.height)).toBeLessThanOrEqual(512);
      for (const s of p.slots) {
        seen.add(s.name);
        const r = rects.find((q) => q.name === s.name)!;
        expect(s.x).toBeGreaterThanOrEqual(pad);
        expect(s.x + r.w + pad).toBeLessThanOrEqual(p.width);
        expect(s.y + r.h + pad).toBeLessThanOrEqual(p.height);
      }
      for (const a of p.slots) for (const b of p.slots) {
        if (a === b) continue;
        const ra = rects.find((q) => q.name === a.name)!;
        const rb = rects.find((q) => q.name === b.name)!;
        const sep = a.x + ra.w + 2 * pad <= b.x || b.x + rb.w + 2 * pad <= a.x || a.y + ra.h + 2 * pad <= b.y || b.y + rb.h + 2 * pad <= a.y;
        expect(sep).toBe(true);
      }
    }
    expect(seen.size).toBe(60);
  });
});

describe('chibi plan on the committed exports', () => {
  const sources = discoverSources(SRC);
  it('finds every merged chibi direction', () => expect(sources.length).toBeGreaterThanOrEqual(10));
  it('keeps every source frame exactly once per tier and ships locomotion frames in the loco group', () => {
    for (const s of sources) {
      const plan = planBundle(s);
      const srcCount = [`_tex.json`, `_page1_tex.json`]
        .map((suffix) => path.join(s.folder, `${s.stem}_${s.dir}${suffix}`))
        .filter((f) => fs.existsSync(f))
        .reduce((n, f) => n + (JSON.parse(fs.readFileSync(f, 'utf8')) as { SubTexture: unknown[] }).SubTexture.length, 0);
      for (const t of plan.tiers) {
        const names = t.pages.flatMap((p) => p.frames.map((f) => f.name));
        expect(names.length).toBe(srcCount);
        expect(new Set(names).size).toBe(srcCount);
        const loco = t.pages.filter((p) => p.group === 'loco').flatMap((p) => p.frames.map((f) => f.name));
        for (const c of CHIBI_RUNTIME.LOCOMOTION_CLIPS) expect(loco.some((n) => n.startsWith(`${c}_`))).toBe(true);
        if (t.tier === 'full') for (const p of t.pages) for (const f of p.frames) expect([f.kx, f.ky]).toEqual([1, 1]);
      }
    }
  });
  it('passes the committed budgets', () => {
    const r = checkChibi(SRC);
    expect(r.findings.filter((f) => f.level === 'error')).toEqual([]);
    expect(r.rows.length).toBe(sources.length * 2);
  });
  it('ASTC sizes are fixed-rate', () => {
    expect(astcBytes(2048, 2048, 4)).toBe(4 * 1024 * 1024);
    expect(astcBytes(1024, 1024, 6)).toBe(Math.ceil(1024 / 6) ** 2 * 16);
  });
});

describe('runBudget with chibi', () => {
  it('adds the player loco group to the estimate and fails when the chibi dir is empty', () => {
    const ok = runBudget({ atlasDir: TMP, chibiDir: SRC, checkPixels: false });
    expect(ok.chibi?.initialPlayerMB.full).toBeGreaterThan(0);
    const empty = runBudget({ atlasDir: TMP, chibiDir: path.join(TMP, 'none-here'), checkPixels: false });
    expect(empty.findings.some((f) => f.code === 'NO_CHIBI' || f.code === 'NO_ATLAS')).toBe(true);
  });
});

describe('buildBundle', () => {
  it('full tier is pixel-identical per frame; 1x halves pages and compensates the display scale', () => {
    const s = discoverSources(SRC).find((x) => x.classId === 'the-tu' && x.dir === 'S')!;
    const plan = planBundle(s);
    buildBundle(s, plan, TMP);
    const out = path.join(TMP, plan.bundle);
    const srcPng = decodePNG(fs.readFileSync(path.join(s.folder, `${s.stem}_S_tex.png`)));
    const full = plan.tiers.find((t) => t.tier === 'full')!;
    const fr = full.pages[0]!.frames[0]!;
    const page = decodePNG(fs.readFileSync(path.join(out, 'full', `${full.pages[0]!.name}.png`)));
    for (const [dx, dy] of [[0, 0], [fr.dst.w - 1, fr.dst.h - 1], [Math.floor(fr.dst.w / 2), Math.floor(fr.dst.h / 2)]] as const) {
      const a = ((fr.dst.y + dy) * page.width + fr.dst.x + dx) * 4;
      const b = ((fr.src.y + dy) * srcPng.width + fr.src.x + dx) * 4;
      if (fr.src.page === 0) expect([...page.data.slice(a, a + 4)]).toEqual([...srcPng.data.slice(b, b + 4)]);
    }
    const half = plan.tiers.find((t) => t.tier === '1x')!;
    const ske = JSON.parse(fs.readFileSync(path.join(out, '1x', `${s.stem}_S_ske.json`), 'utf8')) as {
      armature: Array<{ skin: Array<{ slot: Array<{ display: Array<{ name: string; transform: { scX: number } }> }> }> }>;
    };
    const d = ske.armature[0]!.skin[0]!.slot[0]!.display[0]!;
    const hf = half.pages.flatMap((p) => p.frames).find((f) => f.name === d.name)!;
    // on-screen width = packed width * scale must equal source width * 0.5 (the original display scale)
    expect(hf.dst.w * d.transform.scX).toBeCloseTo(hf.src.w * 0.5, 3);
  });
});
