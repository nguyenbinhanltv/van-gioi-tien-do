/**
 * Exporter: aligned, packed frames -> ONE DragonBones armature per direction (D41): a single `root` bone at the pivot, a
 * single `body` slot, one display (region) per frame, swapped by a stepped `displayFrame` timeline at 30 fps. Events
 * (footstep / hit / cancel_window ...) come from the animation table and ride the same clock as the display swaps, so the
 * viewer, `DragonBonesActor` and the capture tool work unchanged.
 */
import { ANIMATIONS, type AnimationId, type SpineEventName } from '@vgtd/character';
import { pivotOf } from '@vgtd/character';
import {
  CLIP_FPS,
  RIG_FORMAT,
  RIG_FORMAT_VERSION,
  exportDragonBones,
  validateRig,
  type AtlasData,
  type Clip,
  type ClipEvent,
  type DragonBonesExport,
  type RigDocument,
} from '@vgtd/rig';
import type { Direction } from '@vgtd/shared';
import { TEXTURE_SCALE } from './gait.js';
import type { PackResult } from './pack.js';
import { CELL_PX } from './types.js';

export interface ClipInput {
  /** Animation name in the armature (`run`, `attack`, ...). */
  readonly name: string;
  /** Region names of the frames in playback order. */
  readonly frames: readonly string[];
  /** Duration in seconds (the animation table: frames / fps). */
  readonly durationSec: number;
  readonly loop: boolean;
  /** Table animation id for the events; omit for clips without table events. */
  readonly tableId?: AnimationId;
  /** Frame (0-based, in TABLE frames) of the named phases of the table, e.g. { hit_frame: 4, combo_window: 6 }. */
  readonly phases?: Readonly<Record<string, number>>;
  /** Extra events at CLIP 30 fps frames. */
  readonly events?: readonly ClipEvent[];
}

/** Events of a table animation mapped onto a clip of `clipFrames` 30 fps frames (table frame -> proportional clip frame). */
export function eventsFromTable(
  id: AnimationId,
  clipFrames: number,
  phases: Readonly<Record<string, number>> = {},
): ClipEvent[] {
  const spec = ANIMATIONS.find((a) => a.id === id);
  if (!spec) throw new RangeError(`unknown animation id '${id}'`);
  const out: ClipEvent[] = [];
  for (const e of spec.events) {
    const tableFrame = 'frame' in e.at ? e.at.frame : phases[e.at.phase];
    if (tableFrame === undefined)
      throw new RangeError(
        `animation '${id}' event '${e.name}' needs the phase '${'phase' in e.at ? e.at.phase : ''}'`,
      );
    const frame = Math.min(clipFrames - 1, Math.max(0, Math.round((tableFrame * clipFrames) / spec.frames)));
    out.push({ frame, name: e.name as SpineEventName });
  }
  return out;
}

/** The slot `attachment` keys of a clip: frame i of N is shown from clip frame round(i * frames / N). */
export function buildClip(input: ClipInput): Clip {
  const n = input.frames.length;
  if (!n) throw new RangeError(`clip '${input.name}' has no frames`);
  const frames = Math.max(1, Math.round(input.durationSec * CLIP_FPS));
  const keys: { frame: number; value: string; curve: 'stepped' }[] = [];
  input.frames.forEach((name, i) => {
    const frame = Math.round((i * frames) / n);
    const last = keys[keys.length - 1];
    if (last && last.frame >= frame) return; // more sheet frames than 30 fps ticks: the first one wins that tick
    keys.push({ frame, value: name, curve: 'stepped' });
  });
  const events = [
    ...(input.tableId ? eventsFromTable(input.tableId, frames, input.phases) : []),
    ...(input.events ?? []),
  ].sort((a, b) => a.frame - b.frame);
  return {
    name: input.name,
    frames,
    loop: input.loop,
    bones: [],
    slots: [{ slot: 'body', attachment: keys }],
    ik: [],
    events,
    ...(input.phases ? { phases: input.phases } : {}),
  };
}

export interface BuildArmatureInput {
  readonly id: string;
  readonly direction: Direction;
  readonly clips: readonly ClipInput[];
  readonly pack: PackResult;
  /** Armature / data name, e.g. `kiemtu_E`. */
  readonly name: string;
}

export interface BuiltArmature {
  readonly rig: RigDocument;
  readonly clips: readonly Clip[];
  readonly atlas: AtlasData;
  readonly export: DragonBonesExport;
}

/** Build the single-armature display-swap rig, its clips and the DragonBones export. One atlas page only (for now). */
export function buildArmature(input: BuildArmatureInput): BuiltArmature {
  if (input.pack.pages.length !== 1)
    throw new RangeError(
      `${input.pack.pages.length} atlas pages: the DragonBones export carries one page per direction (reduce frames or sizes)`,
    );
  const atlas = input.pack.pages[0]!.data;
  const pivot = pivotOf(CELL_PX / TEXTURE_SCALE, CELL_PX / TEXTURE_SCALE);
  const rootX = pivot.x * TEXTURE_SCALE;
  const rootY = pivot.y * TEXTURE_SCALE;
  const attachments: Record<string, RigDocument['skins'][number]['attachments'][string][string]> = {};
  for (const [name, t] of input.pack.trims) {
    attachments[name] = {
      type: 'region',
      path: name,
      // offset of the trim centre from the root, rig space (1x px, y up)
      x: (t.x + t.width / 2 - rootX) / TEXTURE_SCALE,
      y: (rootY - (t.y + t.height / 2)) / TEXTURE_SCALE,
      width: t.width / TEXTURE_SCALE,
      height: t.height / TEXTURE_SCALE,
    };
  }
  const first = input.clips[0]?.frames[0];
  if (!first) throw new RangeError('no clip frames to export');
  const rig: RigDocument = {
    format: RIG_FORMAT,
    version: RIG_FORMAT_VERSION,
    id: input.id,
    kind: 'player',
    direction: input.direction,
    canvas: { width: CELL_PX / TEXTURE_SCALE, height: CELL_PX / TEXTURE_SCALE },
    bones: [{ name: 'root', parent: null, length: 0, x: 0, y: 0, rotation: 0 }],
    roles: { root: 'root' },
    slots: [{ name: 'body', bone: 'root', attachment: first }],
    skins: [{ name: 'default', attachments: { body: attachments } }],
  };
  const clips = input.clips.map(buildClip);
  const errors = validateRig(rig).filter((i) => i.severity === 'error');
  if (errors.length) throw new Error(`sprite rig invalid: ${errors.map((e) => `${e.path}: ${e.message}`).join('; ')}`);
  const exported = exportDragonBones([{ rig, clips }], atlas, { name: input.name, armatureName: () => input.name });
  return { rig, clips, atlas, export: exported };
}
