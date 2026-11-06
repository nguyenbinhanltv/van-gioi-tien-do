import { describe, expect, it } from 'vitest';
import realTrims from './the-tu-E-trims.json';
import { createImage } from '@vgtd/rig';
import { packFrames, PACK_PADDING, PACK_EXTRUDE } from '../src/pack.js';

const slot = PACK_PADDING + PACK_EXTRUDE;
function frame(name: string, width: number, height: number) {
  const image = createImage(width + 4, height + 4);
  for (let y = 2; y < height + 2; y++)
    for (let x = 2; x < width + 2; x++) image.data.set([40, 20, 10, 128], (y * image.width + x) * 4);
  return { name, image };
}

describe('MaxRects atlas packing', () => {
  it('fills the space below a short neighbour that shelves waste, without rotation', () => {
    // Reserved rectangles: 34x64 + two 30x32 = one 64 square; shelves need two pages.
    const inputs = [
      frame('a', 34 - 2 * slot, 64 - 2 * slot),
      frame('b', 30 - 2 * slot, 32 - 2 * slot),
      frame('c', 30 - 2 * slot, 32 - 2 * slot),
    ];
    const result = packFrames(inputs, () => 'tex.png', 64);
    expect(result.pages).toHaveLength(1);
    expect(packFrames([...inputs].reverse(), () => 'tex.png', 64)).toEqual(result);
    const page = result.pages[0]!;
    for (const region of page.data.regions) {
      const source = inputs.find((f) => f.name === region.name)!;
      expect(region.width).toBe(source.image.width - 4);
      expect(region.height).toBe(source.image.height - 4);
      expect(result.trims.get(region.name)).toMatchObject({ x: 2, y: 2 });
      for (let y = -PACK_EXTRUDE; y < region.height + PACK_EXTRUDE; y++)
        for (let x = -PACK_EXTRUDE; x < region.width + PACK_EXTRUDE; x++) {
          const offset = ((region.y + y) * page.image.width + region.x + x) * 4;
          expect(Array.from(page.image.data.slice(offset, offset + 4))).toEqual([40, 20, 10, 128]);
        }
    }
  });

  it('keeps every padded rectangle disjoint across multiple pages', () => {
    const inputs = Array.from({ length: 30 }, (_, i) => frame(`f${i}`, 10 + (i % 17), 10 + (i % 23)));
    const result = packFrames(inputs, (p) => `tex${p}.png`, 64);
    expect(result.pageOf.size).toBe(inputs.length);
    for (const page of result.pages) {
      for (const [i, a] of page.data.regions.entries()) {
        expect(a.x - slot).toBeGreaterThanOrEqual(0);
        expect(a.y - slot).toBeGreaterThanOrEqual(0);
        expect(a.x + a.width + slot).toBeLessThanOrEqual(64);
        expect(a.y + a.height + slot).toBeLessThanOrEqual(64);
        for (const b of page.data.regions.slice(i + 1))
          expect(
            a.x + a.width + 2 * slot <= b.x ||
              b.x + b.width + 2 * slot <= a.x ||
              a.y + a.height + 2 * slot <= b.y ||
              b.y + b.height + 2 * slot <= a.y,
          ).toBe(true);
      }
    }
  });

  it('fits the real 15-clip / 156-frame The tu E trims on one 2048 page', () => {
    // Worker 18 audit, 2026-11-07. Dimensions only; no generated art dependency.
    const inputs = Object.entries(realTrims).flatMap(([clip, sizes]) =>
      sizes.map(([w, h], i) => frame(`${clip}_${String(i + 1).padStart(2, '0')}`, w!, h!)),
    );
    const result = packFrames(inputs, () => 'tex.png');
    expect(inputs).toHaveLength(156);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]!.data).toMatchObject({ width: 2048, height: 2048 });
    expect(result.pages[0]!.data.regions).toHaveLength(156);
  });

  it('rejects invalid budgets, duplicate names and oversized frames rather than shrinking them', () => {
    expect(() => packFrames([], () => '', 100)).toThrow(/power of two/);
    expect(() => packFrames([frame('a', 60, 60)], () => '', 64)).toThrow(/does not fit/);
    expect(() => packFrames([frame('a', 2, 2), frame('a', 2, 2)], () => '', 64)).toThrow(/unique/);
    expect(packFrames([], () => '').pages).toEqual([]);
  });
});
