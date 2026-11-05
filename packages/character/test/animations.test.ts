import { describe, expect, it } from 'vitest';
import {
  ANIMATIONS,
  ANIMATION_COUNT,
  ANIMATION_IDS,
  SPINE_EVENT_NAMES,
  SPINE_KEY_FPS,
  SPINE_PLAYBACK_FPS,
  animationDuration,
  defaultAsymmetricAnimations,
  frameAt,
  getAnimation,
  type AnimationId,
} from '../src/index.js';

// docs/03 §3 table: id → [loop, frames, fps, duration s as printed]
const SPEC: Record<AnimationId, [boolean, number, number, number]> = {
  idle: [true, 12, 12, 1.0],
  meditate: [true, 8, 8, 1.0],
  walk: [true, 8, 12, 0.67],
  run: [true, 10, 20, 0.5],
  dash: [false, 6, 24, 0.25],
  sword_fly: [true, 8, 12, 0.67],
  attack: [false, 10, 24, 0.42],
  cast: [false, 14, 28, 0.5],
  channel: [true, 8, 20, 0.4],
  hit: [false, 4, 20, 0.2],
  die: [false, 12, 15, 0.8],
  tribulation: [false, 24, 24, 1.0],
  emote: [false, 12, 12, 1.0],
};

describe('animation table', () => {
  it('has the 13 animations', () => {
    expect(ANIMATIONS).toHaveLength(13);
    expect(ANIMATION_COUNT).toBe(13);
    expect(new Set(ANIMATION_IDS).size).toBe(13);
    expect([...ANIMATION_IDS].sort()).toEqual(Object.keys(SPEC).sort());
  });

  it.each(Object.entries(SPEC))('%s matches the spec row', (id, [loop, frames, fps, dur]) => {
    const a = getAnimation(id as AnimationId);
    expect([a.loop, a.frames, a.fps, a.durationSec]).toEqual([loop, frames, fps, dur]);
    expect(Math.round(animationDuration(a.id) * 100) / 100).toBe(dur);
  });

  it('standard Spine events', () => {
    expect([...SPINE_EVENT_NAMES]).toEqual(['hit', 'vfx_spawn', 'sfx', 'footstep_L', 'footstep_R', 'cancel_window']);
  });

  it('events pinned by the spec', () => {
    expect(getAnimation('run').events).toEqual([
      { name: 'footstep_L', at: { frame: 2 } },
      { name: 'footstep_R', at: { frame: 7 } },
    ]);
    expect(getAnimation('attack').events.map((e) => e.name)).toEqual(['hit', 'cancel_window']);
    expect(getAnimation('cast').events).toEqual([{ name: 'vfx_spawn', at: { phase: 'windup_end' } }]);
    for (const a of ANIMATIONS) for (const e of a.events) expect(SPINE_EVENT_NAMES).toContain(e.name);
  });

  it('Spine is keyed at 30 fps and plays at 60 / 30 / 15', () => {
    expect(SPINE_KEY_FPS).toBe(30);
    expect(SPINE_PLAYBACK_FPS).toEqual({ pc: 60, mobileWeb: 30, far: 15 });
  });

  it('frameAt loops looping animations and holds the last frame of one-shots', () => {
    expect(frameAt('idle', 0)).toBe(0);
    expect(frameAt('idle', 1.0)).toBe(0); // wrapped
    expect(frameAt('idle', 0.5)).toBe(6);
    expect(frameAt('die', 5)).toBe(11); // "Giữ frame cuối"
    expect(frameAt('hit', -1)).toBe(0);
  });

  it('asymmetric-by-default animations are the right-hand attack/cast/channel', () => {
    expect(defaultAsymmetricAnimations()).toEqual(['attack', 'cast', 'channel']);
  });
});
