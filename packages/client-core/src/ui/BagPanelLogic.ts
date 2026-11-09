/**
 * Layout, hit-testing, click-to-swap selection and placeholder item styling of the bag panel (D79). Engine-free so it is unit
 * tested; the Cocos panel (`apps/client-cocos/assets/scripts/BagPanel.ts`) only draws what this decides.
 *
 * Panel-local coordinates: origin at the panel's top-left, x to the right, y DOWN, in design units.
 * No item art exists yet: items get a colour per kind and a short code, the quality shows as a colour bar (D6: Trắng, Lục, Lam,
 * Tím, Vàng, Đỏ). In-game stone currencies only.
 */
import type { BagItemView, BagModel } from '../net/bag.js';
import { t } from '../i18n/strings.js';

export const BAG_GRID = { cols: 8, cell: 44, gap: 4, pad: 10, headerH: 58, footerH: 44 } as const;

/** UI input timing / keys of the bag (not gameplay values): a second tap on the same slot within this long uses the item; H quick-uses a heal pill. */
export const BAG_USE = { doubleTapMs: 350, quickUseCode: 'KeyH', quickUseItem: 'heal_pill' } as const;

/**
 * Double-tap / double-click detector for "use this item" (touch has no right-click). `tap` returns true on the SECOND tap of the same
 * slot within `BAG_USE.doubleTapMs` and then forgets it, so a third tap starts over.
 */
export class UseGesture {
  private slot = -1;
  private atMs = -Infinity;
  tap(slot: number, nowMs: number): boolean {
    if (slot === this.slot && nowMs - this.atMs <= BAG_USE.doubleTapMs) {
      this.slot = -1;
      return true;
    }
    this.slot = slot;
    this.atMs = nowMs;
    return false;
  }
  reset(): void {
    this.slot = -1;
  }
}

export interface BagRect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export type Rgb = readonly [number, number, number];

export function bagRows(slots: number): number {
  return Math.max(1, Math.ceil(slots / BAG_GRID.cols));
}
export function bagPanelSize(slots: number): { w: number; h: number } {
  const g = BAG_GRID;
  const rows = bagRows(slots);
  return {
    w: g.pad * 2 + g.cols * g.cell + (g.cols - 1) * g.gap,
    h: g.headerH + rows * g.cell + (rows - 1) * g.gap + g.footerH + g.pad,
  };
}
export function slotRect(i: number): BagRect {
  const g = BAG_GRID;
  const col = i % g.cols;
  const row = Math.floor(i / g.cols);
  return { x: g.pad + col * (g.cell + g.gap), y: g.headerH + row * (g.cell + g.gap), w: g.cell, h: g.cell };
}
/** The "claim loot" button in the footer. */
export function claimButtonRect(slots: number): BagRect {
  const size = bagPanelSize(slots);
  return { x: BAG_GRID.pad, y: size.h - BAG_GRID.footerH, w: 150, h: 30 };
}
/** HUD bands the bag must never cover (design units): the progression HUD + its toast at the top, the hotbar at the bottom. */
export const BAG_RESERVED = { top: 160, bottom: 90, side: 8 } as const;
/** The panel may grow above 1 on small screens so slots stay tappable, but never past this (PLACEHOLDER, D79). */
export const BAG_MAX_SCALE = 1.6;
/** Wanted slot size on screen in CSS px (touch guideline); reached when the free area allows it. */
export const BAG_TAP_PX = 44;

export interface BagPlacement {
  /** uniform scale of the panel root */
  scale: number;
  /** centre of the panel in canvas space (origin at the canvas centre, y UP, design units) */
  cx: number;
  cy: number;
  /** slot size on screen in CSS px at this scale */
  tapPx: number;
}
/**
 * Where to put the panel and how big: right-middle, in the area left between the reserved HUD bands. `pxPerUnit` is CSS px per
 * design unit (the canvas is FIXED_HEIGHT, so a phone shows few CSS px per unit). The scale is the one that makes a slot
 * `BAG_TAP_PX` wide when possible, limited by the free area and by `BAG_MAX_SCALE`.
 */
export function bagPanelPlacement(canvasW: number, canvasH: number, slots: number, pxPerUnit = 1): BagPlacement {
  const size = bagPanelSize(slots);
  const r = BAG_RESERVED;
  const freeW = Math.max(1, canvasW - r.side * 2);
  const freeH = Math.max(1, canvasH - r.top - r.bottom);
  const fit = Math.min(freeW / size.w, freeH / size.h);
  const want = BAG_TAP_PX / (BAG_GRID.cell * Math.max(pxPerUnit, 0.01));
  const scale = Math.max(0.1, Math.min(fit, BAG_MAX_SCALE, Math.max(1, want)));
  return {
    scale,
    cx: canvasW / 2 - r.side - (size.w * scale) / 2,
    cy: canvasH / 2 - r.top - (size.h * scale) / 2,
    tapPx: BAG_GRID.cell * scale * pxPerUnit,
  };
}
const inside = (r: BagRect, x: number, y: number): boolean => x >= r.x && x < r.x + r.w && y >= r.y && y < r.y + r.h;
/** Slot under a panel-local point, or null (gaps and the header / footer are not slots). */
export function slotAtPoint(x: number, y: number, slots: number): number | null {
  for (let i = 0; i < slots; i++) if (inside(slotRect(i), x, y)) return i;
  return null;
}
export function insidePanel(x: number, y: number, slots: number): boolean {
  const s = bagPanelSize(slots);
  return x >= 0 && y >= 0 && x < s.w && y < s.h;
}

export type BagClick =
  | { type: 'none' }
  | { type: 'select'; slot: number }
  | { type: 'deselect' }
  | { type: 'move'; from: number; to: number }
  | { type: 'claim' };

/** Click-to-swap: click an item to select it, click another slot to move / swap / merge, click it again to cancel. */
export class BagSelection {
  selected: number | null = null;

  /** Panel-local click. The caller sends `move` / `claim` through the net client and ignores `none`. */
  click(x: number, y: number, bag: BagModel): BagClick {
    if (bag.pending.length > 0 && inside(claimButtonRect(bag.slotCount), x, y)) {
      this.selected = null;
      return { type: 'claim' };
    }
    const slot = slotAtPoint(x, y, bag.slotCount);
    if (slot === null) {
      this.selected = null;
      return { type: 'none' };
    }
    if (this.selected === null) {
      if (!bag.hasItem(slot)) return { type: 'none' };
      this.selected = slot;
      return { type: 'select', slot };
    }
    const from = this.selected;
    this.selected = null;
    if (from === slot) return { type: 'deselect' };
    return bag.canMove(from, slot) ? { type: 'move', from, to: slot } : { type: 'none' };
  }

  /** The item in the selected slot is gone (a new state arrived): drop the selection. */
  validate(bag: BagModel): void {
    if (this.selected !== null && !bag.hasItem(this.selected)) this.selected = null;
  }
}

/** Quality bar colours, index 0..5 = Trắng, Lục, Lam, Tím, Vàng, Đỏ (D6). */
export const QUALITY_RGB: readonly Rgb[] = [
  [235, 235, 235],
  [90, 200, 90],
  [70, 130, 230],
  [170, 90, 220],
  [235, 200, 60],
  [225, 70, 60],
];

export interface ItemStyle {
  /** short text drawn on the tile (placeholder for an icon) */
  code: string;
  color: Rgb;
  quality: Rgb;
}
const KEY_STYLE: Record<string, { code: string; color: Rgb }> = {
  heal_pill: { code: 'HP', color: [190, 70, 70] },
  breakthrough_pill: { code: 'BT', color: [200, 160, 50] },
  blueprint_white_green: { code: 'B1', color: [90, 130, 170] },
  blueprint_blue_purple: { code: 'B2', color: [90, 100, 190] },
  blueprint_gold_red: { code: 'B3', color: [160, 90, 170] },
  craft_material: { code: 'MA', color: [120, 120, 110] },
  ho_mach_pill: { code: 'HM', color: [90, 170, 150] }, // support pills (D108)
  dinh_tam_pill: { code: 'DT', color: [150, 120, 200] },
};
/** Placeholder look of an item; an id this client does not know (a newer server) shows as `??` instead of failing. */
export function itemStyle(item: BagItemView): ItemStyle {
  const s = (item.key && KEY_STYLE[item.key]) || { code: '??', color: [90, 90, 90] as Rgb };
  return { code: s.code, color: s.color, quality: QUALITY_RGB[Math.min(5, Math.max(0, item.quality))]! };
}

/** Wallet line, hạ / trung / thượng phẩm. */
export function walletText(bag: BagModel): string {
  const w = bag.wallet;
  return t('bag.wallet', { low: w.LT_HA, mid: w.LT_TRUNG, high: w.LT_THUONG });
}
/** Durability as a percent 0..100 (null for stacks). */
export function durabilityPercent(item: BagItemView): number | null {
  return item.durability === null ? null : Math.round(item.durability / 100);
}
