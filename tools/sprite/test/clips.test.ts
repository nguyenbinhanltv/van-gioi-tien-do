import { describe, expect, it } from 'vitest';
import { ANIMATIONS } from '@vgtd/character';
import { SPRITE_CLIPS, SPRITE_CLIP_NAMES, buildClip, projectClipDefaults, spriteClip } from '../src/index.js';

describe('sprite clip table', () => {
  it('has all 15 Player clips: the 13 table animations plus the two extra attack swings', () => {
    expect(SPRITE_CLIP_NAMES).toEqual([
      'idle',
      'meditate',
      'walk',
      'run',
      'dash',
      'sword_fly',
      'attack',
      'attack_2',
      'attack_3',
      'cast',
      'channel',
      'hit',
      'die',
      'tribulation',
      'emote',
    ]);
    expect(new Set(SPRITE_CLIP_NAMES).size).toBe(15);
    expect(ANIMATIONS).toHaveLength(13);
  });

  it('is derived from the animation table: duration, loop, fps, events', () => {
    for (const c of SPRITE_CLIPS) {
      const a = ANIMATIONS.find((x) => x.id === c.tableId)!;
      expect(c.durationSec).toBeCloseTo(a.frames / a.fps, 10);
      expect(c.loop).toBe(a.loop);
      expect(c.fps).toBe(a.fps);
      expect(c.events).toEqual(a.events);
    }
    expect(spriteClip('run').events.map((e) => e.name)).toEqual(['footstep_L', 'footstep_R']);
    expect(spriteClip('attack_2').tableId).toBe('attack');
    expect(spriteClip('attack_3').durationSec).toBe(spriteClip('attack').durationSec);
  });

  it('agreed sheet layouts and kinds (run / walk 12 in 6 cols, hit 4, die free)', () => {
    expect(spriteClip('run').sheet).toEqual({ frames: 12, cols: 6 });
    expect(spriteClip('walk').sheet).toEqual({ frames: 12, cols: 6 });
    expect(spriteClip('hit').sheet).toEqual({ frames: 4, cols: 4 });
    expect(spriteClip('idle').kind).toBe('upright');
    expect(spriteClip('die').kind).toBe('free');
    expect(spriteClip('die').exceptionHints).toContain('die-collapse');
    expect(() => spriteClip('nope')).toThrow(RangeError);
  });

  it('every clip feeds buildClip: events resolve (phase-anchored ones through the default phases)', () => {
    for (const name of SPRITE_CLIP_NAMES) {
      const d = projectClipDefaults(name);
      const clip = buildClip({
        name: d.name,
        frames: Array.from({ length: d.frames }, (_, i) => `${name}_${i}`),
        durationSec: d.durationSec,
        loop: d.loop,
        tableId: d.tableId,
        ...('phases' in d ? { phases: d.phases } : {}),
      });
      const spec = spriteClip(name);
      expect(clip.events.map((e) => e.name)).toEqual(spec.events.map((e) => e.name));
      expect(clip.frames).toBeGreaterThan(0);
    }
    const hit = buildClip({
      name: 'attack',
      frames: ['a'],
      durationSec: 0.4,
      loop: false,
      tableId: 'attack',
      phases: spriteClip('attack').phases!,
    });
    expect(hit.events.map((e) => e.name)).toEqual(['hit', 'cancel_window']);
  });
});
