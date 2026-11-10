import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  FIRST_WORLD_FRAME_FALLBACK_MS,
  afterFirstWorldFrame,
  armFirstWorldFrameFallback,
  firstWorldFrameReached,
  markFirstWorldFrame,
  resetMilestonesForTest,
} from '../assets/scripts/Milestones';

describe('load milestones (initial package cut)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetMilestonesForTest();
  });
  afterEach(() => vi.useRealTimers());

  it('deferred work waits for the milestone, runs once, in registration order', () => {
    const ran: string[] = [];
    afterFirstWorldFrame(() => ran.push('a'));
    afterFirstWorldFrame(() => ran.push('b'));
    expect(ran).toEqual([]);
    markFirstWorldFrame();
    markFirstWorldFrame(); // idempotent
    expect(ran).toEqual(['a', 'b']);
    afterFirstWorldFrame(() => ran.push('c')); // after the fact: at once
    expect(ran).toEqual(['a', 'b', 'c']);
  });

  it('without chibi art the bounded fallback still releases the deferred work (particle textures are not stranded)', () => {
    let particles = 0;
    afterFirstWorldFrame(() => particles++); // what LevelUpFx / SkillVfx register for preloadParticles()
    armFirstWorldFrameFallback(FIRST_WORLD_FRAME_FALLBACK_MS); // armed by Bootstrap when the world is built; the body never arrives
    vi.advanceTimersByTime(FIRST_WORLD_FRAME_FALLBACK_MS - 1);
    expect(particles).toBe(0);
    expect(firstWorldFrameReached()).toBe(false);
    vi.advanceTimersByTime(1);
    expect(particles).toBe(1);
    expect(firstWorldFrameReached()).toBe(true);
  });

  it('a body that arrives first makes the late fallback a no-op', () => {
    let n = 0;
    afterFirstWorldFrame(() => n++);
    armFirstWorldFrameFallback(FIRST_WORLD_FRAME_FALLBACK_MS);
    markFirstWorldFrame();
    vi.advanceTimersByTime(FIRST_WORLD_FRAME_FALLBACK_MS * 2);
    expect(n).toBe(1);
  });
});
