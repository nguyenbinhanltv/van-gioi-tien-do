import { describe, expect, it } from 'vitest';
import type { InvStateMsg } from '@vgtd/protocol';
import {
  BAG_GRID,
  BAG_USE,
  BagModel,
  BagSelection,
  UseGesture,
  QUALITY_RGB,
  bagPanelSize,
  claimButtonRect,
  durabilityPercent,
  insidePanel,
  itemStyle,
  slotAtPoint,
  slotRect,
  walletText,
} from '@vgtd/client-core';

const slots40 = (over: Record<number, InvStateMsg['slots'][number]> = {}): InvStateMsg['slots'] =>
  Array.from({ length: 40 }, (_, i) => over[i] ?? null);
const state = (over: Record<number, InvStateMsg['slots'][number]>, pending = 0): InvStateMsg => ({
  type: 'inv_state',
  wallet: [7, 2, 1],
  slots: slots40(over),
  pending: pending ? [{ defId: 6, quality: 0, qty: pending }] : [],
});
const center = (i: number): [number, number] => {
  const r = slotRect(i);
  return [r.x + r.w / 2, r.y + r.h / 2];
};
let n = 0;
const ids = (): string => (++n).toString(16).padStart(32, '0');

describe('bag panel geometry', () => {
  it('lays 40 slots out as 8 columns x 5 rows without overlap, inside the panel', () => {
    const { w, h } = bagPanelSize(40);
    const rects = Array.from({ length: 40 }, (_, i) => slotRect(i));
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(w);
      expect(r.y + r.h).toBeLessThanOrEqual(h);
    }
    for (let i = 0; i < 40; i++)
      for (let j = i + 1; j < 40; j++) {
        const a = rects[i]!;
        const b = rects[j]!;
        expect(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y, `${i} vs ${j}`).toBe(true);
      }
    expect(slotRect(8).y).toBeGreaterThan(slotRect(0).y); // row 2
    expect(slotRect(1).x - slotRect(0).x).toBe(BAG_GRID.cell + BAG_GRID.gap);
    const claim = claimButtonRect(40);
    expect(claim.y).toBeGreaterThan(rects[39]!.y + rects[39]!.h); // below the grid
    expect(claim.x + claim.w).toBeLessThanOrEqual(w);
  });

  it('slotAtPoint finds the slot, and misses gaps, header and footer', () => {
    for (const i of [0, 7, 8, 39]) expect(slotAtPoint(...center(i), 40)).toBe(i);
    const a = slotRect(0);
    expect(slotAtPoint(a.x + a.w + 1, a.y + 2, 40)).toBeNull(); // the gap
    expect(slotAtPoint(a.x + 2, 5, 40)).toBeNull(); // header
    expect(slotAtPoint(a.x + 2, bagPanelSize(40).h - 3, 40)).toBeNull(); // footer
    expect(slotAtPoint(...center(30), 20)).toBeNull(); // a smaller bag has no slot 30
    expect(insidePanel(1, 1, 40)).toBe(true);
    expect(insidePanel(-1, 5, 40)).toBe(false);
    expect(insidePanel(bagPanelSize(40).w + 1, 5, 40)).toBe(false);
  });
});

describe('BagSelection (click to swap)', () => {
  const bag = new BagModel();
  bag.applyState(
    state({
      0: { kind: 'stack', defId: 1, quality: 2, qty: 5 },
      3: { kind: 'instance', defId: 5, quality: 5, durability: 8000, bound: false },
    }),
  );

  it('select an item, click an empty slot -> move; clicking the same slot cancels; empty first click does nothing', () => {
    const s = new BagSelection();
    expect(s.click(...center(9), bag)).toEqual({ type: 'none' }); // nothing in slot 9
    expect(s.click(...center(0), bag)).toEqual({ type: 'select', slot: 0 });
    expect(s.selected).toBe(0);
    expect(s.click(...center(9), bag)).toEqual({ type: 'move', from: 0, to: 9 });
    expect(s.selected).toBeNull();
    expect(s.click(...center(3), bag)).toEqual({ type: 'select', slot: 3 });
    expect(s.click(...center(3), bag)).toEqual({ type: 'deselect' });
    expect(s.selected).toBeNull();
  });

  it('two occupied slots swap; a click outside any slot clears the selection', () => {
    const s = new BagSelection();
    s.click(...center(0), bag);
    expect(s.click(...center(3), bag)).toEqual({ type: 'move', from: 0, to: 3 });
    s.click(...center(0), bag);
    expect(s.click(2, 2, bag)).toEqual({ type: 'none' }); // header
    expect(s.selected).toBeNull();
  });

  it('the claim button only exists while loot is pending; clicking it clears the selection', () => {
    const s = new BagSelection();
    const r = claimButtonRect(40);
    const pt: [number, number] = [r.x + 5, r.y + 5];
    expect(s.click(...pt, bag)).toEqual({ type: 'none' }); // no pending loot: no button
    const withLoot = new BagModel();
    withLoot.applyState(state({ 0: { kind: 'stack', defId: 1, quality: 0, qty: 1 } }, 30));
    s.click(...center(0), withLoot);
    expect(s.selected).toBe(0);
    expect(s.click(...pt, withLoot)).toEqual({ type: 'claim' });
    expect(s.selected).toBeNull();
  });

  it('validate drops a selection whose item has gone; moveCmd of a click result builds the wire command', () => {
    const s = new BagSelection();
    const b = new BagModel();
    b.applyState(state({ 0: { kind: 'stack', defId: 1, quality: 0, qty: 1 } }));
    s.click(...center(0), b);
    b.applyState(state({})); // the server emptied it
    s.validate(b);
    expect(s.selected).toBeNull();
    b.applyState(state({ 0: { kind: 'stack', defId: 1, quality: 0, qty: 1 } }));
    const click = s.click(...center(0), b);
    expect(click.type).toBe('select');
    const mv = s.click(...center(2), b);
    expect(mv).toEqual({ type: 'move', from: 0, to: 2 });
    expect(b.moveCmd(0, 2, ids)).toMatchObject({ op: 1, from: 0, to: 2 });
  });
});

describe('item styling and texts', () => {
  const b = new BagModel();
  b.applyState(
    state({
      0: { kind: 'stack', defId: 1, quality: 2, qty: 5 },
      1: { kind: 'instance', defId: 5, quality: 5, durability: 8000, bound: false },
      2: { kind: 'stack', defId: 4000, quality: 9 as never, qty: 1 }, // unknown id
    }),
  );
  it('known items get a code, a colour and the quality colour; unknown ids degrade to ??', () => {
    expect(itemStyle(b.itemAt(0)!)).toMatchObject({ code: 'HP', quality: QUALITY_RGB[2] });
    expect(itemStyle(b.itemAt(1)!)).toMatchObject({ code: 'B3', quality: QUALITY_RGB[5] });
    expect(itemStyle(b.itemAt(2)!)).toMatchObject({ code: '??', quality: QUALITY_RGB[5] }); // quality clamped
    expect(QUALITY_RGB).toHaveLength(6);
  });
  it('wallet text and durability percent', () => {
    expect(walletText(b)).toBe('Hạ 7   Trung 2   Thượng 1');
    expect(durabilityPercent(b.itemAt(1)!)).toBe(80);
    expect(durabilityPercent(b.itemAt(0)!)).toBeNull();
  });
});

describe('UseGesture (double-tap / double-click uses an item, D90)', () => {
  it('fires on the second tap of the same slot inside the window, then starts over', () => {
    const g = new UseGesture();
    expect(g.tap(3, 1000)).toBe(false);
    expect(g.tap(3, 1000 + BAG_USE.doubleTapMs)).toBe(true);
    expect(g.tap(3, 1000 + BAG_USE.doubleTapMs + 10)).toBe(false); // a third tap is a new first tap
    expect(g.tap(3, 1000 + BAG_USE.doubleTapMs + 20)).toBe(true);
  });
  it('does not fire for another slot, a late second tap, or after reset', () => {
    const g = new UseGesture();
    g.tap(3, 0);
    expect(g.tap(4, 100)).toBe(false);
    expect(g.tap(4, 100 + BAG_USE.doubleTapMs + 1)).toBe(false);
    g.tap(5, 5000);
    g.reset();
    expect(g.tap(5, 5100)).toBe(false);
  });
});

