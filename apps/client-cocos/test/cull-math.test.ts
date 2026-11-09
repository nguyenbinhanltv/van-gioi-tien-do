import { describe, it, expect } from 'vitest';
import { CHIBI_REACH, CULL_HYSTERESIS, CULL_MARGIN, insideView, shouldCull } from '../assets/scripts/CullMath';

const view = { x: 1000, y: 500, width: 853, height: 480 }; // a 1.5x view in 1x world px

describe('insideView', () => {
  it('counts the view itself and the margin around it, nothing beyond', () => {
    expect(insideView({ x: 1400, y: 700 }, view, 0)).toBe(true);
    expect(insideView({ x: 999, y: 700 }, view, 0)).toBe(false);
    expect(insideView({ x: 999, y: 700 }, view, 10)).toBe(true);
    expect(insideView({ x: 1000 + 853 + 11, y: 700 }, view, 10)).toBe(false);
    expect(insideView({ x: 1400, y: 500 + 480 + 541 }, view, CULL_MARGIN)).toBe(false);
  });
});

describe('shouldCull (margin + hysteresis)', () => {
  const edge = { x: view.x - CULL_MARGIN - 1, y: 700 }; // 1 px outside the margin
  const deep = { x: view.x - CULL_MARGIN - CULL_HYSTERESIS - 5, y: 700 };

  it('never culls a node on screen or within its reach (a boss stands up to ~512 px above its foot, so it passes its own reach)', () => {
    expect(shouldCull({ x: 1400, y: 700 }, view, false)).toBe(false);
    expect(shouldCull({ x: view.x - CULL_MARGIN, y: 700 }, view, false)).toBe(false);
    // a boss whose foot is 500 px below the bottom edge still has its head on screen: with reach 600 it must stay visible
    expect(shouldCull({ x: 1400, y: view.y + view.height + 500 }, view, false, 600)).toBe(false);
  });

  it('a visible node outside the margin stays visible until it is beyond margin + hysteresis (no flicker on the edge)', () => {
    expect(shouldCull(edge, view, false)).toBe(false);
    expect(shouldCull(deep, view, false)).toBe(true);
  });

  it('a parked node comes back as soon as it is within the margin, not before', () => {
    expect(shouldCull(edge, view, true)).toBe(true);
    expect(shouldCull({ x: view.x - CULL_MARGIN + 1, y: 700 }, view, true)).toBe(false);
  });

  it('the walk across the edge toggles at most once in each direction', () => {
    // a mob walks from far left, across the view, to far right and back
    const xs = [...Array(300).keys()].map((i) => view.x - 900 + i * 6);
    let culled = shouldCull({ x: xs[0]!, y: 700 }, view, false); // where it starts is not a flip
    let flips = 0;
    for (const path of [xs, [...xs].reverse()]) {
      for (const x of path) {
        const now = shouldCull({ x, y: 700 }, view, culled);
        if (now !== culled) flips++;
        culled = now;
      }
    }
    // enters (1), leaves on the right (2), comes back from the right (3), leaves on the left (4)
    expect(flips).toBeLessThanOrEqual(4);
  });
});

describe('per-node reach', () => {
  it('a chibi (reach 120) is parked long before a boss (reach 600) at the same spot', () => {
    const far = { x: view.x - 500, y: 700 };
    expect(CHIBI_REACH).toBeLessThan(CULL_MARGIN);
    expect(shouldCull(far, view, true, CHIBI_REACH)).toBe(true); // parked chibi stays parked
    expect(shouldCull(far, view, true, 600)).toBe(false); // a boss at 500 px left still reaches into the view
  });
});
