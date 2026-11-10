import { describe, expect, it } from 'vitest';
import { PARTY } from '@vgtd/shared';
import { partyFramesPlacement, touchChatPlacement } from '../src/index.js';

const hit = (a: { x: number; y: number; w: number; h: number }, b: typeof a) =>
  a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe('touch chat placement (D87 review: never over the joystick zone)', () => {
  const viewports: Array<[string, number, number]> = [
    ['landscape 1280x720', 1280, 720],
    ['landscape 844x390 phone', 844, 390],
    ['landscape 2400x1080', 2400, 1080],
    ['portrait 720x1280', 720, 1280],
    ['portrait 390x844 phone', 390, 844],
  ];
  for (const [name, w, h] of viewports) {
    it(`${name}: strip is inside the viewport and does not intersect joystick-zone`, () => {
      const p = touchChatPlacement(w, h, { top: 0, right: 0, bottom: 0, left: 0 });
      expect(p.joystick).not.toBeNull();
      expect(hit(p.strip, p.joystick!)).toBe(false);
      expect(p.strip.x).toBeGreaterThanOrEqual(0);
      expect(p.strip.y).toBeGreaterThanOrEqual(0);
      expect(p.strip.x + p.strip.w).toBeLessThanOrEqual(w);
      expect(p.strip.y + p.strip.h).toBeLessThanOrEqual(h);
    });
  }
  it('the opened box (grows up from the strip bottom, 200 logic px) also stays clear of the joystick zone', () => {
    const p = touchChatPlacement(1280, 720);
    const open = { ...p.strip, y: p.strip.y + p.strip.h - 200 * p.scale, h: 200 * p.scale };
    expect(hit(open, p.joystick!)).toBe(false);
  });
});

describe('party frames placement (D93)', () => {
  const viewports: Array<[string, number, number, boolean]> = [
    ['touch landscape 1280x720', 1280, 720, true],
    ['touch landscape 844x390 phone', 844, 390, true],
    ['touch portrait 390x844 phone', 390, 844, true],
    ['touch portrait 720x1280', 720, 1280, true],
    ['pointer landscape 1280x720', 1280, 720, false],
  ];
  for (const [name, w, h, touch] of viewports) {
    it(`${name}: the stack of ${PARTY.MAX_SIZE - 1} rows is on screen and clear of the joystick zone and the folded chat strip`, () => {
      const p = partyFramesPlacement(w, h, touch);
      const stack = { x: p.x, y: p.y, w: p.w, h: p.rowH * (PARTY.MAX_SIZE - 1) };
      expect(stack.x + stack.w).toBeLessThanOrEqual(w);
      expect(stack.y + stack.h).toBeLessThanOrEqual(h);
      if (touch) {
        const c = touchChatPlacement(w, h);
        expect(hit(stack, c.joystick!)).toBe(false);
        expect(hit(stack, c.strip)).toBe(false);
      }
    });
  }
});
