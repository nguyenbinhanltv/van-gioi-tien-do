import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementWireId } from '@vgtd/shared';
import {
  MOB_ELEMENT_TINT_STRENGTH,
  RemoteWorld,
  mobElementGlyph,
  mobElementOf,
  mobElementTint,
  mobNameWithElement,
  t,
} from '../src/index.js';

describe('mob element on the client (D120)', () => {
  it('wire code -> element id; none / unknown -> null', () => {
    for (const e of ELEMENTS) expect(mobElementOf(elementWireId(e))).toBe(e);
    expect(mobElementOf(0)).toBeNull();
    expect(mobElementOf(undefined)).toBeNull();
    expect(mobElementOf(9)).toBeNull();
  });
  it('every element has a glyph; the name gets a badge only when there is an element', () => {
    for (const e of ELEMENTS) expect(mobElementGlyph(e)).toBe(t(`element.${e}`));
    expect(mobElementGlyph(null)).toBe('');
    expect(mobNameWithElement('Yêu thú 3', 'kim')).toBe('[KIM] Yêu thú 3');
    expect(mobNameWithElement('Yêu thú 3', null)).toBe('Yêu thú 3');
  });
  it('the tint is white pulled slightly towards the element colour: subtle, never darker than the strength allows', () => {
    expect(mobElementTint(null)).toEqual([255, 255, 255]);
    const hoa = mobElementTint([255, 124, 54]);
    expect(hoa[0]).toBe(255);
    expect(hoa[1]).toBe(Math.round(255 + (124 - 255) * MOB_ELEMENT_TINT_STRENGTH));
    expect(hoa[2]).toBeLessThan(hoa[1]);
    for (const c of hoa) expect(c).toBeGreaterThanOrEqual(255 - 255 * MOB_ELEMENT_TINT_STRENGTH);
  });
  it('the remote entity view carries the element from aoi_enter (0 when the server sent none)', () => {
    const r = new RemoteWorld();
    r.onEnter(
      {
        type: 'aoi_enter',
        entities: [
          { index: 1, entityId: 10, kind: 1, defId: 5, qi: 64, qj: 64, anim: 0, dir: 0, element: 3, hpPct: 100, maxHp: 50 },
          { index: 2, entityId: 11, kind: 1, defId: 5, qi: 96, qj: 64, anim: 0, dir: 0, hpPct: 100, maxHp: 50 },
        ],
      },
      0,
    );
    const v = r.sample(0);
    expect(v.find((x) => x.entityId === 10)!.element).toBe(3);
    expect(v.find((x) => x.entityId === 11)!.element).toBe(0);
  });
});
