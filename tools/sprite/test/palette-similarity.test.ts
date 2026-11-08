import { describe, expect, it } from 'vitest';
import { createImage } from '@vgtd/rig';
import { srgbLabD65, labPaletteDistance } from '../src/index.js';
describe('D55 opaque Lab palette distributions', () => {
  it('rechecks a reused image after its pixels change', () => {
    const a = createImage(8, 8),
      b = createImage(8, 8),
      box = { left: 0, top: 0, right: 8, bottom: 8 };
    for (let i = 0; i < a.data.length; i += 4) {
      a.data.set([200, 150, 100, 255], i);
      b.data.set([200, 150, 100, 255], i);
    }
    expect(labPaletteDistance(a, b, box, box).distance).toBe(0);
    for (let i = 0; i < b.data.length; i += 4) b.data.set([0, 255, 0, 255], i);
    expect(labPaletteDistance(a, b, box, box).distance).toBeGreaterThan(50);
  });
  it('uses D65 Lab reference colours', () => {
    expect(srgbLabD65(255, 255, 255)[0]).toBeCloseTo(100, 3);
    expect(srgbLabD65(0, 0, 0)).toEqual([0, 0, 0]);
    const red = srgbLabD65(255, 0, 0);
    expect(red[0]).toBeCloseTo(53.2408, 3);
    expect(red[1]).toBeCloseTo(80.0925, 3);
    expect(red[2]).toBeCloseTo(67.2032, 3);
  });
  it('ignores transparent RGB and spatial rearrangement, while exposing hue drift', () => {
    const a = createImage(8, 8),
      b = createImage(8, 8),
      c = createImage(8, 8);
    for (let i = 0; i < 16; i++) {
      const color = i % 2 ? [220, 170, 110, 255] : [30, 35, 40, 255];
      a.data.set(color, i * 4);
      b.data.set(color, (63 - i) * 4);
      c.data.set([0, 255, 0, 255], i * 4);
    }
    // Transparent hidden RGB must never enter the palette distribution.
    b.data.set([255, 0, 255, 0], 20 * 4);
    const box = { left: 0, top: 0, right: 8, bottom: 8 };
    expect(labPaletteDistance(a, b, box, box).distance).toBeCloseTo(0, 10);
    expect(labPaletteDistance(a, c, box, box).chroma).toBeGreaterThan(50);
    expect(labPaletteDistance(a, b, box, box).opaqueFrame).toBe(16);
    expect(() => labPaletteDistance(a, createImage(8, 8), box, box)).toThrow(/opaque/);
  });
});
