import { describe, expect, it } from 'vitest';
import { DEFAULT_CLASS, PATHS, classWireId, parseClass, pathOfClassWireId } from '../src/index.js';

describe('class wire ids (D82)', () => {
  it('are the 1-based position in PATHS and round-trip', () => {
    expect(PATHS.map(classWireId)).toEqual([1, 2, 3, 4, 5, 6]);
    for (const p of PATHS) expect(pathOfClassWireId(classWireId(p))).toBe(p);
    expect(classWireId('kiem')).toBe(1);
    expect(classWireId('dao')).toBe(6);
  });
  it('0 and out-of-range ids are not classes', () => {
    for (const id of [0, -1, 7, 255, 1.5, NaN]) expect(pathOfClassWireId(id)).toBeNull();
  });
  it('parseClass accepts a path id or a wire id and nothing else', () => {
    expect(parseClass('phap')).toBe('phap');
    expect(parseClass(3)).toBe('the');
    for (const bad of [
      '',
      'KIEM',
      'kiem-tu',
      'the-tu',
      null,
      undefined,
      {},
      [],
      true,
      0,
      99,
      '__proto__',
      'constructor',
    ])
      expect(parseClass(bad)).toBeNull();
  });
  it('the default class is a real class', () => {
    expect(PATHS).toContain(DEFAULT_CLASS);
  });
});
