import { describe, expect, it } from 'vitest';
import { BreakthroughOutcome } from '@vgtd/protocol';
import { FIRST_SESSION, MOB_BANDS, fieldBandStart, mobAreaHalfSize, mobZoneMargin } from '@vgtd/shared';
import {
  FIRST_SESSION_STEPS,
  FirstSessionTracker,
  parseFirstSessionSnapshot,
  type FirstSessionInputs,
  type FirstSessionSnapshot,
} from '@vgtd/client-core';

const MAP = 256;
const IDLE: FirstSessionInputs = {
  fromCentre: 0,
  bagOpen: false,
  bagReady: true,
  hasLoot: false,
  pending: 0,
  meditating: false,
  tuViFraction: 0,
};
const at = (over: Partial<FirstSessionInputs>): FirstSessionInputs => ({ ...IDLE, ...over });
const FIELD = (): number => fieldBandStart(MAP) + FIRST_SESSION.fieldMarginTiles;

describe('first-session numbers come from shared (D83 / D84)', () => {
  it('the field band starts at the D83 normal band fraction of the default mob area half-size', () => {
    expect(mobZoneMargin(MAP)).toBe(8);
    expect(mobAreaHalfSize(MAP)).toBe((MAP - 16) / 2);
    expect(fieldBandStart(MAP)).toBeCloseTo(MOB_BANDS.normal.minFrac * mobAreaHalfSize(MAP), 9);
    expect(fieldBandStart(MAP)).toBeGreaterThan(12); // beyond the player spawn square of the dev server (24 tiles wide)
  });
});

describe('FirstSessionTracker', () => {
  it('starts on step 1 and each step needs its own condition, in order', () => {
    const t = new FirstSessionTracker({ mapTiles: MAP });
    t.update(at({ bagOpen: true, hasLoot: true, meditating: true })); // later conditions must not skip step 1
    expect(t.current).toBe(0);
    t.update(at({ fromCentre: FIELD() - 1 }));
    expect(t.current).toBe(0);
    expect(t.view().steps[0]!.hint).toMatch(/ô/);
    t.update(at({ fromCentre: FIELD() }));
    expect(t.current).toBe(1);
    for (let k = 0; k < FIRST_SESSION.killTarget; k++) {
      expect(t.current).toBe(1);
      t.onKill();
    }
    expect(t.current).toBe(2);
    expect(t.kills).toBe(FIRST_SESSION.killTarget);
    t.update(at({ fromCentre: FIELD(), bagOpen: true, hasLoot: true }));
    expect(t.current).toBe(3);
    t.update(at({ meditating: true }));
    expect(t.current).toBe(4);
    t.onBreakthroughResult(BreakthroughOutcome.Failure);
    expect(t.finished).toBe(true);
    expect(t.view().done).toBe(true);
    expect(t.view().steps.map((s) => s.state)).toEqual(Array(FIRST_SESSION_STEPS.length).fill('done'));
  });

  it('kills count from the start (even before the field step) and are capped at the target', () => {
    const t = new FirstSessionTracker({ mapTiles: MAP });
    for (let k = 0; k < 10; k++) t.onKill();
    expect(t.kills).toBe(FIRST_SESSION.killTarget);
    expect(t.current).toBe(0); // still waiting for the field
    t.update(at({ fromCentre: FIELD() + 5 }));
    expect(t.current).toBe(2); // field done and kills already there: straight to the bag step
    expect(t.view().steps[1]!.text).toContain(`${FIRST_SESSION.killTarget}/${FIRST_SESSION.killTarget}`);
  });

  it('progress is sticky: walking back, closing the bag or stopping meditation never un-completes a step', () => {
    const t = new FirstSessionTracker({ mapTiles: MAP });
    t.update(at({ fromCentre: FIELD() + 3 }));
    for (let k = 0; k < FIRST_SESSION.killTarget; k++) t.onKill();
    t.update(at({ bagOpen: true, hasLoot: true }));
    t.update(at({ meditating: true }));
    t.update(IDLE);
    expect(t.current).toBe(4);
  });

  it('the bag step needs the bag open, loaded, holding loot and nothing left to claim (it tells you what is missing)', () => {
    const t = new FirstSessionTracker({ mapTiles: MAP });
    t.update(at({ fromCentre: FIELD() + 3 }));
    for (let k = 0; k < FIRST_SESSION.killTarget; k++) t.onKill();
    expect(t.current).toBe(2);
    t.update(at({ bagOpen: false, hasLoot: true }));
    expect(t.view().steps[2]!.hint).toBe('nhấn B');
    t.update(at({ bagOpen: true, bagReady: false, hasLoot: true }));
    expect(t.current).toBe(2); // the first inv_state has not arrived
    t.update(at({ bagOpen: true, hasLoot: false }));
    expect(t.view().steps[2]!.hint).toMatch(/hạ thêm/);
    t.update(at({ bagOpen: true, hasLoot: true, pending: 2 }));
    expect(t.current).toBe(2);
    expect(t.view().steps[2]!.hint).toMatch(/Nhận hàng chờ/);
    t.update(at({ bagOpen: true, hasLoot: true, pending: 0 }));
    expect(t.current).toBe(3);
  });

  it('the breakthrough step counts a rolled attempt (success or failure) but not a refusal, and shows tu vi progress', () => {
    const t = new FirstSessionTracker({ mapTiles: MAP });
    t.update(at({ fromCentre: FIELD() + 3 }));
    for (let k = 0; k < FIRST_SESSION.killTarget; k++) t.onKill();
    t.update(at({ bagOpen: true, hasLoot: true }));
    t.update(at({ meditating: true, tuViFraction: 0.42 }));
    expect(t.current).toBe(4);
    expect(t.view().steps[4]!.hint).toContain('42%');
    t.onBreakthroughResult(BreakthroughOutcome.Rejected); // not enough tu vi
    expect(t.finished).toBe(false);
    t.update(at({ meditating: true, tuViFraction: 1 }));
    expect(t.view().steps[4]!.hint).toContain('nhấn N');
    t.onBreakthroughResult(BreakthroughOutcome.Success);
    expect(t.finished).toBe(true);
  });

  it('reports every change through onChange, and a snapshot restores the same progress (consistent prefix only)', () => {
    const seen: FirstSessionSnapshot[] = [];
    const t = new FirstSessionTracker({ mapTiles: MAP, onChange: (s) => seen.push(s) });
    t.update(at({ fromCentre: FIELD() })); // field done
    t.onKill();
    expect(seen.length).toBe(2);
    t.update(at({ fromCentre: FIELD() })); // nothing new: no callback
    expect(seen.length).toBe(2);
    const snap = t.snapshot();
    expect(snap).toEqual({ done: ['field'], kills: 1 });
    const r = new FirstSessionTracker({ mapTiles: MAP, restore: snap });
    expect(r.current).toBe(1);
    expect(r.kills).toBe(1);
    // a corrupt / out-of-order snapshot only restores the valid prefix
    const bad = new FirstSessionTracker({ mapTiles: MAP, restore: { done: ['bag', 'meditate'], kills: 99 } });
    expect(bad.current).toBe(0);
    expect(bad.kills).toBe(FIRST_SESSION.killTarget); // kills are clamped to the target
  });

  it('parseFirstSessionSnapshot is defensive', () => {
    expect(parseFirstSessionSnapshot(null)).toBeNull();
    expect(parseFirstSessionSnapshot('not json')).toBeNull();
    expect(parseFirstSessionSnapshot('{"done":"x"}')).toBeNull();
    expect(parseFirstSessionSnapshot('{"done":["field","nope"],"kills":2.9}')).toEqual({ done: ['field'], kills: 2 });
    expect(parseFirstSessionSnapshot('{"done":[],"kills":"a"}')).toEqual({ done: [], kills: 0 });
  });
});
