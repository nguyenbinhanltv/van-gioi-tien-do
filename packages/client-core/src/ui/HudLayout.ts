/**
 * HUD layout contract (P0 polish): ONE place that says where every always-on HUD widget sits, for desktop and for mobile landscape /
 * portrait, so the realm panel, minimap, quest tracker, menu bar, player frame and the rest never overlap.
 *
 * Pure and engine-free. Everything is in design units (the Cocos canvas is FIXED_HEIGHT: height = `DESIGN_HEIGHT`, width follows the window
 * aspect; one design unit = viewportHeight / DESIGN_HEIGHT CSS px). Rects are top-left origin, y down. The Cocos widgets convert with
 * `designToCss`; DOM widgets multiply by the same factor.
 *
 * Safe areas: every widget keeps `HUD_MARGIN` from the canvas edge; the caller adds the device insets (notch) through `insets`.
 *
 * Anchors:
 *   top-left      player frame, then the cultivation (tu vi) panel, then the party frames
 *   top-centre    target frame, the tutorial hint card under it
 *   top-right     minimap, the quest tracker under it
 *   bottom-centre skill bar (hotbar, desktop only: touch has the wheel)
 *   bottom-left   chat
 *   bottom-right  menu bar (desktop); top, left of the minimap (mobile landscape); under the quest tracker (portrait)
 */
import type { Rect } from '../input/types.js';

export type HudProfile = 'desktop' | 'mobile-landscape' | 'mobile-portrait';

export type HudWidgetId =
  | 'player-frame'
  | 'cultivation'
  | 'party-frames'
  | 'target-frame'
  | 'hint-card'
  | 'minimap'
  | 'quest-tracker'
  | 'skill-bar'
  | 'chat'
  | 'menu-bar';

export interface HudInsets {
  top: number;
  right: number;
  bottom: number;
  left: number;
}

export interface HudLayoutResult {
  profile: HudProfile;
  /** a pointer window below `NARROW_BELOW` units wide: stacked layout, chat is a strip above the hotbar */
  narrow: boolean;
  canvas: { w: number; h: number };
  rects: Record<HudWidgetId, Rect>;
  /** menu bar geometry: button side, gap, columns and rows (the rect above is the bounding box) */
  menu: { button: number; gap: number; cols: number; rows: number };
}

export const HUD_MARGIN = 12;
/** the nine entries of the menu bar (see `MENU_ENTRIES` in the Cocos client for what each opens) */
export const MENU_BUTTONS = 9;
/** hotbar width in design units (8 slots of 56 + 7 gaps of 6): the skill bar is centred and exactly this wide */
export const SKILL_BAR_W = 490;
export const SKILL_BAR_H = 56;
/** the cultivation panel's native size (ProgressionHud PANEL_W x PANEL_H): shown scaled to its rect's width */
export const CULTIVATION_NATIVE = { w: 300, h: 104 };

const GAP = 8;
/** pointer windows narrower than this (design units, height 720) get the stacked layout */
export const NARROW_BELOW = 900;

const intersects = (a: Rect, b: Rect): boolean =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** Pick the profile from the window: touch devices get the mobile ones, the orientation follows the aspect. */
export function hudProfile(canvasW: number, canvasH: number, touch: boolean): HudProfile {
  if (!touch) return 'desktop';
  return canvasW < canvasH ? 'mobile-portrait' : 'mobile-landscape';
}

/** Design units -> CSS px for a window of this height. */
export function designToCss(designH: number, viewportH: number): number {
  return viewportH / designH;
}

function menuBox(button: number, gap: number, cols: number): { w: number; h: number; rows: number } {
  const rows = Math.ceil(MENU_BUTTONS / cols);
  return { w: cols * button + (cols - 1) * gap, h: rows * button + (rows - 1) * gap, rows };
}

export function computeHudLayout(
  canvasW: number,
  canvasH: number,
  profile: HudProfile,
  insets: HudInsets = { top: 0, right: 0, bottom: 0, left: 0 },
): HudLayoutResult {
  const L = HUD_MARGIN + insets.left;
  const T = HUD_MARGIN + insets.top;
  const R = canvasW - HUD_MARGIN - insets.right;
  const B = canvasH - HUD_MARGIN - insets.bottom;
  const r = (x: number, y: number, w: number, h: number): Rect => ({
    x: Math.round(x),
    y: Math.round(y),
    w: Math.round(w),
    h: Math.round(h),
  });
  const bottomOf = (q: Rect): number => q.y + q.h;
  const rightOf = (q: Rect): number => q.x + q.w;

  const desktop = profile === 'desktop';
  const portrait = profile === 'mobile-portrait';
  // a pointer window narrower than ~900 units (half a 1080p screen, a docked browser) cannot hold the three-column desktop layout:
  // it uses the same top-to-bottom stack as the portrait phone, keeping the desktop-sized buttons and the hotbar
  const narrow = desktop && canvasW < NARROW_BELOW;
  const stack = portrait || narrow;

  // top-left column: player frame, cultivation panel, party frames
  const leftW = desktop && !narrow ? 280 : stack ? Math.min(200, R - L - 100 - GAP) : 232;
  const player = r(L, T, leftW, desktop ? 86 : 82);
  const cultW = desktop && !narrow ? CULTIVATION_NATIVE.w : leftW;
  const cultivation = r(
    L,
    bottomOf(player) + GAP,
    cultW,
    (CULTIVATION_NATIVE.h * cultW) / CULTIVATION_NATIVE.w,
  );
  // the cultivation toast hangs ~28 units under its panel: the party frames start below that
  let party = r(L, bottomOf(cultivation) + 36, desktop ? 220 : 180, 150);

  const mmSize = desktop && !narrow ? 176 : stack ? 100 : 130;
  const minimap = r(R - mmSize, T, mmSize, mmSize);

  const targetW = Math.min(desktop && !narrow ? 300 : stack ? 240 : 280, R - L);
  let target = r((canvasW - targetW) / 2, T, targetW, 52);

  const skillW = Math.min(SKILL_BAR_W, R - L); // the combat HUD scales its hotbar down the same way on narrow canvases
  const skill = r((canvasW - skillW) / 2, B - SKILL_BAR_H + 2, skillW, SKILL_BAR_H);
  // the chat leaves the hotbar its room on narrow desktop windows; on touch it is only the folded 2-line strip (ChatPlacement
  // owns the exact spot next to the joystick zone)
  const chatH = desktop && !narrow ? 200 : 56;
  const chat = narrow
    ? r(L, skill.y - GAP - chatH, Math.min(360, R - L), chatH) // narrow: a strip right above the hotbar
    : r(L, B - chatH, Math.max(180, Math.min(360, skill.x - L - GAP)), chatH);

  // menu bar: buttons big enough to tap on touch (design units are scaled by the window height, ~0.5 on a phone in landscape)
  const button = desktop ? 36 : portrait ? 48 : 64;
  const mgap = desktop ? 4 : 3;
  const fits = (q: Rect, others: Rect[]): boolean => q.x >= L && rightOf(q) <= R && !others.some((o) => intersects(q, o));
  const pickMenu = (colsTry: number[], at: (w: number, h: number) => Rect, others: Rect[]): { menu: Rect; cols: number } => {
    let last = { menu: at(0, 0), cols: colsTry[0]! };
    for (const cols of colsTry) {
      const box = menuBox(button, mgap, cols);
      last = { menu: at(box.w, box.h), cols };
      if (fits(last.menu, others)) break;
    }
    return last;
  };

  let tracker: Rect;
  let menuPick: { menu: Rect; cols: number };
  if (desktop && !narrow) {
    tracker = r(R - 240, bottomOf(minimap) + GAP, 240, 96);
    menuPick = pickMenu([9, 5], (w, h) => r(R - w, B - h, w, h), [skill, chat, tracker, minimap]);
  } else if (stack) {
    // portrait / narrow desktop: the tracker and the menu stack full-width under the two top columns, then the target frame
    tracker = r(L, Math.max(bottomOf(cultivation), bottomOf(minimap)) + GAP, R - L, 64);
    menuPick = pickMenu([9, 5, 3], (w, h) => r(R - w, bottomOf(tracker) + GAP, w, h), [tracker]);
    target = r((canvasW - targetW) / 2, bottomOf(menuPick.menu) + GAP, targetW, 52);
  } else {
    // landscape phone: the menu sits on the top row left of the minimap; the tracker goes under whichever is lower
    menuPick = pickMenu([9, 5, 4, 3], (w, h) => r(minimap.x - GAP - w, T, w, h), [target, minimap, player, cultivation]);
    const trackerX = R - 200;
    const trackerY = Math.max(
      bottomOf(minimap),
      rightOf(menuPick.menu) > trackerX ? bottomOf(menuPick.menu) : 0,
    );
    tracker = r(trackerX, trackerY + GAP, 200, 72);
  }
  const menu = menuPick.menu;
  const box = menuBox(button, mgap, menuPick.cols);

  // tutorial hint card (D105): centred under the target frame, as wide as the space between the side columns allows
  let hint: Rect;
  if (stack) {
    hint = r(L, bottomOf(target) + GAP, R - L, 84);
    party = r(L, bottomOf(hint) + GAP, 180, 120);
  } else {
    const leftClear = Math.max(rightOf(player), rightOf(cultivation)) + GAP;
    const rightClear = Math.min(minimap.x, tracker.x) - GAP;
    const half = Math.min(canvasW / 2 - leftClear, rightClear - canvasW / 2);
    const hintW = Math.max(160, Math.min(440, 2 * half));
    const y = Math.max(bottomOf(target), desktop ? 0 : bottomOf(menu)) + GAP;
    hint = r((canvasW - hintW) / 2, y, hintW, 76);
  }

  return {
    profile,
    narrow,
    canvas: { w: canvasW, h: canvasH },
    rects: {
      'player-frame': player,
      cultivation,
      'party-frames': party,
      'target-frame': target,
      'hint-card': hint,
      minimap,
      'quest-tracker': tracker,
      'skill-bar': skill,
      chat,
      'menu-bar': menu,
    },
    menu: { button, gap: mgap, cols: menuPick.cols, rows: box.rows },
  };
}

/** Widgets that exist for this profile (the hotbar is replaced by the skill wheel on touch; the party frames sit below the panels). */
export function hudWidgetsFor(profile: HudProfile): HudWidgetId[] {
  const all: HudWidgetId[] = [
    'player-frame',
    'cultivation',
    'party-frames',
    'target-frame',
    'hint-card',
    'minimap',
    'quest-tracker',
    'chat',
    'menu-bar',
  ];
  return profile === 'desktop' ? [...all, 'skill-bar'] : all; // narrow desktop windows have the hotbar too
}
