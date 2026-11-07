import { describe, expect, it } from 'vitest';
import { CLIP_FPS } from '@vgtd/rig';
import {
  SMOOTH_SPRITE_CLIPS,
  SPRITE_CLIPS,
  buildClip,
  smoothProjectClipDefaults,
  smoothPoseTags,
  smoothSpriteClip,
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
      expect(Math.abs(clip.frames / CLIP_FPS - c.durationSec)).toBeLessThanOrEqual(0.5 / CLIP_FPS);
      expect(c.events).toEqual(SPRITE_CLIPS.find((l) => l.name === c.name)!.events);
      expect(clip.events.map((e) => e.name)).toEqual(c.events.map((e) => e.name));
      c.events.forEach((event, i) => {
        const anchor = 'frame' in event.at ? event.at.frame : c.phases![event.at.phase]!;
        expect(clip.events[i]!.frame).toBe(Math.round((anchor * clip.frames) / c.tableFrames));
      });
    }
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
