import { describe, expect, it } from 'vitest';
import type { MoveInput } from '@vgtd/sim';
import { StatusSystem } from '../src/index.js';

const mv = (entityId: number, mag = 15): MoveInput => ({
  kind: 'move',
  entityId,
  seq: 1,
  dtMs: 50,
  dir: 10,
  mag,
  flags: 0,
});
const at = (...ids: number[]) => ids.map((id) => ({ id, i: 10, j: 10 }));

describe('StatusSystem (D91)', () => {
  it('root zeroes the move magnitude until it expires; slow scales it; the stronger slow and the longer duration win', () => {
    const s = new StatusSystem();
    s.rootPlayer(1, 1000, 1500);
    expect(s.adjustMove(mv(1), 1200).mag).toBe(0);
    expect(s.adjustMove(mv(1), 2499).mag).toBe(0);
    expect(s.adjustMove(mv(1), 2500).mag).toBe(15);
    expect(s.adjustMove(mv(2), 1200).mag).toBe(15); // others are unaffected
    s.slowPlayer(2, 0, 2000, 0.5);
    expect(s.adjustMove(mv(2), 100).mag).toBe(7);
    s.slowPlayer(2, 500, 1000, 0.8); // weaker and shorter: does not replace
    expect(s.slowFactor(2, 600)).toBe(0.5);
    s.slowPlayer(2, 500, 4000, 0.25);
    expect(s.slowFactor(2, 600)).toBe(0.25);
    expect(s.slowFactor(2, 4600)).toBe(1);
  });

  it('poison ticks every tickMs for its duration, once per tick even when the clock jumps, and not on the dead', () => {
    const s = new StatusSystem();
    s.poisonPlayer(1, 0, 3000, 1000, 7, 99);
    expect(s.tick(500, at(1))).toEqual([]);
    expect(s.tick(1000, at(1))).toEqual([{ targetId: 1, amount: 7, sourceId: 99 }]);
    expect(s.tick(3000, at(1))).toHaveLength(2); // the 2 s and 3 s ticks together
    expect(s.tick(4000, at(1))).toEqual([]); // over
    expect(s.isPoisoned(1, 4000)).toBe(false);
    s.poisonPlayer(2, 5000, 5000, 1000, 5, 99);
    expect(s.tick(6000, [])).toEqual([]); // not among the living: dropped
    expect(s.tick(7000, at(2))).toEqual([]);
  });

  it('a pool hurts only the living players inside its radius, on every tick, until it ends', () => {
    const s = new StatusSystem();
    s.addPool({ i: 10, j: 10, radius: 3, ms: 2000, tickMs: 1000, amount: 4, sourceId: 5 }, 0);
    const players = [
      { id: 1, i: 11, j: 10 }, // inside
      { id: 2, i: 20, j: 10 }, // outside
      { id: 3, i: 10, j: 12.5 }, // inside
    ];
    expect(s.tick(1000, players).map((h) => h.targetId)).toEqual([1, 3]);
    expect(s.tick(2000, players).map((h) => h.targetId)).toEqual([1, 3]);
    expect(s.poolCount).toBe(0);
    expect(s.tick(3000, players)).toEqual([]);
  });

  it('clear forgets a player; the digest is stable and reflects state', () => {
    const a = new StatusSystem();
    const b = new StatusSystem();
    for (const s of [a, b]) {
      s.rootPlayer(1, 0, 1000);
      s.poisonPlayer(2, 0, 3000, 1000, 3, 9);
      s.addPool({ i: 1, j: 1, radius: 2, ms: 3000, tickMs: 1000, amount: 2, sourceId: 9 }, 0);
    }
    expect(a.digest()).toBe(b.digest());
    a.clear(1);
    expect(a.digest()).not.toBe(b.digest());
    expect(a.isRooted(1, 10)).toBe(false);
  });
});
