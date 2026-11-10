import { describe, expect, it } from 'vitest';
import { ELEMENTS, elementOfWireId, elementWireId } from '../src/index.js';

describe('element wire code (D120)', () => {
  it('maps the five elements to 1..5 and back; none / unknown to 0 / null', () => {
    ELEMENTS.forEach((e, k) => {
      expect(elementWireId(e)).toBe(k + 1);
      expect(elementOfWireId(k + 1)).toBe(e);
    });
    expect(elementWireId(null)).toBe(0);
    expect(elementWireId(undefined)).toBe(0);
    expect(elementOfWireId(0)).toBeNull();
    expect(elementOfWireId(6)).toBeNull();
    expect(elementOfWireId(-1)).toBeNull();
  });
});
