/**
 * The clip table of the sprite pipeline: all 15 Player clips (the 13 animations of `docs/03` / `ANIMATIONS` plus the two extra
 * combo swings `attack_2` / `attack_3`, which reuse the `attack` spec). One source for the art workers, the template
 * generator and the exporter, derived from `ANIMATIONS` so durations / loops / events can never drift from the table.
 *
 *   import { SPRITE_CLIPS, spriteClip, SPRITE_CLIP_NAMES } from '@vgtd/sprite';
 */
import { ANIMATIONS, type AnimationId, type AnimationEventSpec } from '@vgtd/character';

/** `upright`: every frame holds the master height (+-3 %); `free`: bending / airborne / seated poses declare exceptions. */
export type ClipKind = 'upright' | 'free';

export interface SpriteClipSpec {
  /** Armature animation name (`run`, `attack_2`, ...). */
  readonly name: string;
  /** Animation table entry the timing / events come from. */
  readonly tableId: AnimationId;
  readonly loop: boolean;
  /** Frames and fps of the table (sprite-sheet reference); the exported clip lasts `durationSec`. */
  readonly tableFrames: number;
  readonly fps: number;
  readonly durationSec: number;
  /** The animation is asymmetric: drawn in all 8 directions (F-01 / ADR-020 default), not mirrored. */
  readonly asymmetric: boolean;
  readonly kind: ClipKind;
  /** Recommended sheet layout (cells). More cells than the table frames is fine: they are spread over `durationSec`. */
  readonly sheet: { readonly frames: number; readonly cols: number };
  /** Events of the table; frame anchors are TABLE frames, phases need `phases`. */
  readonly events: readonly AnimationEventSpec[];
  /** Default phase frames (TABLE frames) the phase-anchored events need; `undefined` when the clip has none. */
  readonly phases?: Readonly<Record<string, number>>;
  /** Pose exceptions the clip typically needs (declare them per frame in the project `exceptions`, never silently). */
  readonly exceptionHints: readonly string[];
}

/** Sheet layout and kind per clip (agreed with the art workers: run / walk 12 cells in 6 x 2, the others 4 or 8). */
const LAYOUT: Readonly<Record<string, { frames: number; kind: ClipKind; hints?: readonly string[] }>> = {
  idle: { frames: 8, kind: 'upright' },
  meditate: { frames: 8, kind: 'free', hints: ['seated'] },
  walk: { frames: 12, kind: 'upright' },
  run: { frames: 12, kind: 'upright' },
  dash: { frames: 6, kind: 'free', hints: ['lunge'] },
  sword_fly: { frames: 8, kind: 'free', hints: ['airborne', 'sword-ride'] },
  attack: { frames: 8, kind: 'free', hints: ['raised-sword', 'lunge'] },
  attack_2: { frames: 8, kind: 'free', hints: ['raised-sword', 'lunge'] },
  attack_3: { frames: 8, kind: 'free', hints: ['raised-sword', 'lunge'] },
  cast: { frames: 8, kind: 'free', hints: ['raised-arms'] },
  channel: { frames: 8, kind: 'free', hints: ['raised-arms'] },
  hit: { frames: 4, kind: 'free', hints: ['recoil'] },
  die: { frames: 8, kind: 'free', hints: ['die-collapse'] },
  tribulation: { frames: 12, kind: 'free', hints: ['kneel', 'raised-arms'] },
  emote: { frames: 8, kind: 'upright' },
};

/**
 * Default phase frames in TABLE frames (of 10 at 24 fps) of the three combo swings: the Kiếm tu rig timing (hit 6 / 5 / 6 of
 * 13 ticks) converted to table frames. Defaults only, to be adjusted to the drawn sheet; cần game designer duyệt khi cân bằng.
 */
const ATTACK_PHASES: Readonly<Record<string, Readonly<Record<string, number>>>> = {
  attack: { windup_end: 3, hit_frame: 5, combo_window: 7 },
  attack_2: { windup_end: 2, hit_frame: 4, combo_window: 7 },
  attack_3: { windup_end: 3, hit_frame: 5, combo_window: 7 },
};

/** Default phase of `cast` (the table event `vfx_spawn` is anchored on the end of the windup). */
const CAST_PHASES: Readonly<Record<string, number>> = { windup_end: 6 };

function build(): SpriteClipSpec[] {
  const out: SpriteClipSpec[] = [];
  for (const a of ANIMATIONS) {
    const names = a.id === 'attack' ? ['attack', 'attack_2', 'attack_3'] : [a.id];
    for (const name of names) {
      const layout = LAYOUT[name];
      if (!layout) throw new Error(`sprite clip table: no layout for '${name}'`);
      const phases = ATTACK_PHASES[name] ?? (a.id === 'cast' ? CAST_PHASES : undefined);
      out.push({
        name,
        tableId: a.id,
        loop: a.loop,
        tableFrames: a.frames,
        fps: a.fps,
        durationSec: a.frames / a.fps,
        asymmetric: a.asymmetric,
        kind: layout.kind,
        sheet: { frames: layout.frames, cols: layout.frames >= 12 ? 6 : layout.frames <= 4 ? layout.frames : 4 },
        events: a.events,
        ...(phases ? { phases } : {}),
        exceptionHints: layout.hints ?? [],
      });
    }
  }
  return out;
}

/** All 15 Player clips in table order (the three attack swings follow `die`-independent order: attack, attack_2, attack_3). */
export const SPRITE_CLIPS: readonly SpriteClipSpec[] = build();

export const SPRITE_CLIP_NAMES: readonly string[] = SPRITE_CLIPS.map((c) => c.name);

/** The spec of one clip; throws for an unknown name. */
export function spriteClip(name: string): SpriteClipSpec {
  const c = SPRITE_CLIPS.find((x) => x.name === name);
  if (!c) throw new RangeError(`unknown sprite clip '${name}' (${SPRITE_CLIP_NAMES.join(', ')})`);
  return c;
}

/**
 * The fields of a project clip that come from the table (`name`, `cols`, `frames`, `durationSec`, `loop`, `tableId`, `kind`,
 * `phases`): spread it into a project and add `sheet`, `manifest`, `exceptions`, `calibration`...
 */
export function projectClipDefaults(name: string) {
  const c = spriteClip(name);
  return {
    name: c.name,
    cols: c.sheet.cols,
    frames: c.sheet.frames,
    durationSec: c.durationSec,
    loop: c.loop,
    tableId: c.tableId,
    kind: c.kind,
    ...(c.phases ? { phases: c.phases } : {}),
  };
}
