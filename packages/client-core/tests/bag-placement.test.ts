import { describe, expect, it } from 'vitest';
import { BAG_MAX_SCALE, BAG_RESERVED, bagPanelPlacement, bagPanelSize } from '@vgtd/client-core';

const SLOTS = 40;
// [css width, css height]; the canvas is FIXED_HEIGHT 720 design units, so ui width = 720 * w / h and px per unit = h / 720
const VIEWPORTS: [string, number, number][] = [
  ['desktop 1280x720', 1280, 720],
  ['desktop 1920x1080', 1920, 1080],
  ['phone portrait 360x640', 360, 640],
  ['phone portrait 390x844', 390, 844],
  ['phone landscape 844x390', 844, 390],
  ['tablet 768x1024', 768, 1024],
];

describe('bagPanelPlacement', () => {
  for (const [name, w, h] of VIEWPORTS) {
    it(`${name}: inside the free area, right of centre, never over the HUD bands, scale <= cap`, () => {
      const cw = (720 * w) / h;
      const ch = 720;
      const p = bagPanelPlacement(cw, ch, SLOTS, h / 720);
      const size = bagPanelSize(SLOTS);
      const pw = size.w * p.scale;
      const ph = size.h * p.scale;
      expect(p.scale).toBeGreaterThan(0);
      expect(p.scale).toBeLessThanOrEqual(BAG_MAX_SCALE);
      // canvas space: origin at the centre, y up
      expect(p.cx + pw / 2).toBeLessThanOrEqual(cw / 2 - BAG_RESERVED.side + 1e-6); // inside the right edge
      expect(p.cx - pw / 2).toBeGreaterThanOrEqual(-cw / 2 + 1e-6); // inside the left edge
      expect(p.cy + ph / 2).toBeLessThanOrEqual(ch / 2 - BAG_RESERVED.top + 1e-6); // below the top HUD
      expect(p.cy - ph / 2).toBeGreaterThanOrEqual(-ch / 2 + BAG_RESERVED.bottom - 1e-6); // above the hotbar
    });
  }

  it('slots are tappable (>= 44 px) where the area allows, and never fall below 30 px on the matrix', () => {
    for (const [name, w, h] of VIEWPORTS) {
      const p = bagPanelPlacement((720 * w) / h, 720, SLOTS, h / 720);
      expect(p.tapPx, name).toBeGreaterThanOrEqual(30);
    }
    const desktop = bagPanelPlacement(1280, 720, SLOTS, 1);
    expect(desktop.scale).toBe(1); // no needless growth when 44 design units already are 44 px
    expect(desktop.tapPx).toBeGreaterThanOrEqual(44);
    const tablet = bagPanelPlacement((720 * 768) / 1024, 720, SLOTS, 1024 / 720);
    expect(tablet.tapPx).toBeGreaterThanOrEqual(44);
  });

  it('a degenerate canvas still gives a finite, positive scale', () => {
    const p = bagPanelPlacement(10, 10, SLOTS, 1);
    expect(Number.isFinite(p.scale) && p.scale > 0).toBe(true);
  });
});
