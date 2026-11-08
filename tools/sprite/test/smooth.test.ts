import { describe, expect, it } from 'vitest';
import { createImage } from '@vgtd/rig';
import {
  SMOOTH_SPRITE_CLIPS,
  SPRITE_CLIPS,
  buildClip,
  smoothProjectClipDefaults,
  smoothPoseTags,
  smoothSpriteClip,
  buildArmature,
  packFrames,
  spriteFrameRate,
} from '../src/index.js';

describe('D46 smooth clip profile', () => {
  it('provides the requested counts in at most 4x4 without changing legacy defaults', () => {
    expect(SMOOTH_SPRITE_CLIPS.map((c) => c.sheet.frames)).toEqual([
      16, 16, 16, 16, 10, 12, 14, 14, 14, 16, 12, 6, 12, 16, 12,
    ]);
    expect(SPRITE_CLIPS.find((c) => c.name === 'run')!.sheet).toEqual({ frames: 12, cols: 6 });
    for (const c of SMOOTH_SPRITE_CLIPS) {
      expect(c.sheet.cols).toBe(4);
      expect(Math.ceil(c.sheet.frames / c.sheet.cols)).toBeLessThanOrEqual(4);
      expect(c.sheet.frames / c.durationSec).toBe(24);
    }
    expect(() => smoothSpriteClip('attack_1')).toThrow(RangeError);
  });

  it('exports every drawn frame and preserves legacy event phases on the new duration', () => {
    for (const c of SMOOTH_SPRITE_CLIPS) {
      const defaults = smoothProjectClipDefaults(c.name);
      const names = Array.from({ length: defaults.frames }, (_, i) => `${c.name}_${i}`);
      const clip = buildClip({ ...defaults, frames: names });
      expect(clip.slots[0]!.attachment!.map((k) => k.value)).toEqual(names);
      expect(clip.slots[0]!.attachment!.every((k) => k.frame < clip.frames)).toBe(true);
      expect(clip.frames).toBe(names.length);
      expect(clip.frames / 24).toBe(c.durationSec);
      expect(clip.loop).toBe(c.loop);
      expect(clip.slots[0]!.attachment!.map((k) => k.frame)).toEqual(names.map((_, i) => i));
      expect(c.events).toEqual(SPRITE_CLIPS.find((l) => l.name === c.name)!.events);
      expect(clip.events.map((e) => e.name)).toEqual(c.events.map((e) => e.name));
      c.events.forEach((event, i) => {
        const anchor = 'frame' in event.at ? event.at.frame : c.phases![event.at.phase]!;
        expect(clip.events[i]!.frame).toBe(Math.round((anchor * clip.frames) / c.tableFrames));
      });
    }
  });

  it('writes a 24 Hz armature with uniform one-tick drawings, table events and loop flags', () => {
    const image = createImage(1, 1);
    image.data.fill(255);
    const clips = SMOOTH_SPRITE_CLIPS.map((c) => ({
      ...smoothProjectClipDefaults(c.name),
      frames: Array.from({ length: c.sheet.frames }, (_, i) => `${c.name}_${i}`),
    }));
    const pack = packFrames(
      clips.flatMap((c) => c.frames.map((name) => ({ name, image }))),
      () => 'test.png',
    );
    const built = buildArmature({ id: 'test', direction: 'E', name: 'test_E', pack, clips });
    const ske = built.export.ske as {
      frameRate: number;
      armature: {
        frameRate: number;
        animation: { duration: number; playTimes: number; slot: { displayFrame: { duration: number }[] }[] }[];
      }[];
    };
    expect(ske.frameRate).toBe(24);
    expect(ske.armature[0]!.frameRate).toBe(24);
    ske.armature[0]!.animation.forEach((a, i) => {
      const c = clips[i]!;
      expect(a.duration).toBe(c.frames.length);
      expect(a.playTimes).toBe(c.loop ? 0 : 1);
      expect(a.slot[0]!.displayFrame.map((f) => f.duration)).toEqual(c.frames.map(() => 1));
    });
    expect(() => spriteFrameRate([clips[0]!, {}])).toThrow('mixed');
    expect(spriteFrameRate([{}])).toBe(30);
    expect(() => buildClip({ ...clips[0]!, durationSec: 1 })).toThrow('one tick');
    expect(() => buildClip({ ...clips[0]!, frames: ['missing-drawings'] })).toThrow('one tick');
  });

  it('marks anticipation, distinct impact/hold drawings and follow-through for every swing', () => {
    for (const name of ['attack', 'attack_2', 'attack_3']) {
      const tags = smoothPoseTags(name);
      expect(tags).toHaveLength(14);
      expect(tags[0]).toBe('anticipation');
      expect(tags[tags.indexOf('impact') + 1]).toBe('impact_hold');
      expect(tags.at(-1)).toBe('follow_through');
    }
  });
});
