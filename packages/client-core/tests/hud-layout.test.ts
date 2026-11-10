import { describe, expect, test } from 'vitest';
import {
  computeHudLayout,
  hudProfile,
  hudWidgetsFor,
  HUD_MARGIN,
  MENU_BUTTONS,
  type HudProfile,
  type HudWidgetId,
} from '../src/ui/HudLayout.js';

/** canvas sizes (design units, height 720): 16:9, 4:3, 21:9 desktop; 16:9 / 19.5:9 / 16:10 landscape phones; 9:16 / 9:19.5 portrait phones */
const CASES: Array<[HudProfile, number]> = [
  ['desktop', 480],
  ['desktop', 640],
  ['desktop', 800],
  ['desktop', 960],
  ['desktop', 1280],
  ['desktop', 1680],
  ['desktop', 2400],
  ['mobile-landscape', 1000],
  ['mobile-landscape', 1152],
  ['mobile-landscape', 1280],
  ['mobile-landscape', 1560],
  ['mobile-portrait', 405],
  ['mobile-portrait', 332],
];

const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('HUD layout', () => {
  for (const [profile, w] of CASES) {
    test(`${profile} ${w}x720: no widget overlaps another and all stay on screen`, () => {
      const h = 720;
      const lay = computeHudLayout(w, h, profile);
      const ids = hudWidgetsFor(profile);
      for (const id of ids) {
        const a = lay.rects[id];
        expect(a.x, `${id} left`).toBeGreaterThanOrEqual(HUD_MARGIN - 1);
        expect(a.y, `${id} top`).toBeGreaterThanOrEqual(HUD_MARGIN - 1);
        expect(a.x + a.w, `${id} right`).toBeLessThanOrEqual(w - HUD_MARGIN + 1);
        expect(a.y + a.h, `${id} bottom`).toBeLessThanOrEqual(h);
      }
      for (let i = 0; i < ids.length; i++)
        for (let j = i + 1; j < ids.length; j++) {
          const a = ids[i] as HudWidgetId;
          const b = ids[j] as HudWidgetId;
          expect(hit(lay.rects[a], lay.rects[b]), `${a} vs ${b}`).toBe(false);
        }
    });
  }

  test('the menu bar holds all nine entries', () => {
    for (const [profile, w] of CASES) {
      const m = computeHudLayout(w, 720, profile).menu;
      expect(m.cols * m.rows).toBeGreaterThanOrEqual(MENU_BUTTONS);
    }
  });

  test('anchors: minimap top-right with the tracker under it, skill bar bottom centre, chat bottom-left', () => {
    const lay = computeHudLayout(1280, 720, 'desktop');
    const { minimap, 'quest-tracker': q, 'skill-bar': s, chat, 'player-frame': p } = lay.rects;
    expect(minimap.x + minimap.w).toBe(1280 - HUD_MARGIN);
    expect(q.y).toBeGreaterThanOrEqual(minimap.y + minimap.h);
    expect(s.x + s.w / 2).toBe(640);
    expect(chat.x).toBe(HUD_MARGIN);
    expect(p.x).toBe(HUD_MARGIN);
  });

  test('device insets (notch) push every widget inwards', () => {
    const lay = computeHudLayout(1280, 720, 'mobile-landscape', { top: 0, right: 40, bottom: 20, left: 40 });
    expect(lay.rects['player-frame'].x).toBe(HUD_MARGIN + 40);
    expect(lay.rects.minimap.x + lay.rects.minimap.w).toBe(1280 - HUD_MARGIN - 40);
  });

  test('profile follows touch and orientation', () => {
    expect(hudProfile(1280, 720, false)).toBe('desktop');
    expect(hudProfile(1280, 720, true)).toBe('mobile-landscape');
    expect(hudProfile(405, 720, true)).toBe('mobile-portrait');
  });
});
