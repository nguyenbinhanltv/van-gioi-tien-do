import type { Direction } from '@vgtd/shared';
import {
  ANIMATIONS,
  EVENT_FRAME_INDEX_BASE,
  animationDuration,
  slotForm,
  slotsInDrawOrder,
  type AnimationId,
  type AnimationSpec,
  type SlotId,
  type SpineEventName,
} from '@vgtd/character';
import { BONES, poseAt, type BoneName } from './motion.js';
import { PART_SIZE, PROFILE, SKINS } from './parts.js';

/**
 * Format-neutral rig description (source of truth for the test rig): y UP, rotation in degrees CCW, px @1x,
 * bone transforms relative to the parent, animation values relative to the setup pose. Exporters (DragonBones 5.5 today;
 * Spine 4.2 possible later) convert axes/units. Nothing here is DragonBones- or Spine-specific.
 */
export interface NeutralBone {
  name: BoneName;
  parent?: BoneName;
  x: number;
  y: number;
  rotation: number;
}

export interface NeutralDisplay {
  /** Atlas region (texture) name. */
  texture: string;
  /** Centre of the image in bone space. */
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface NeutralSlot {
  name: SpineSlotId;
  bone: BoneName;
  /** One display per skin variant, index 0 = default skin. */
  displays: NeutralDisplay[];
}

export interface NeutralKey {
  /** Frame index (at `fps`). */
  frame: number;
  rot?: number;
  tx?: number;
  ty?: number;
}

export interface NeutralAnimation {
  id: AnimationId;
  fps: number;
  /** Length in frames (>= 2). */
  frames: number;
  loop: boolean;
  /** Per-bone dense keys, one per frame. */
  bones: Partial<Record<BoneName, NeutralKey[]>>;
  events: { frame: number; name: SpineEventName }[];
}

export interface NeutralRig {
  name: string;
  direction: Direction;
  bones: NeutralBone[];
  /** Back -> front for this direction (paperdoll Draw Order table). */
  slots: NeutralSlot[];
  animations: NeutralAnimation[];
  skins: readonly string[];
  /** Bounding box in y-up pixels. */
  aabb: { x: number; y: number; width: number; height: number };
}

export type SpineSlotId = Exclude<SlotId, 'orbit_back' | 'orbit_front'>;

/** Keys per second: animations are keyed at 30 fps (docs/03 §3). */
export const KEY_FPS = 30;

/** Slot -> bone and attachment offset (image centre, bone space, y up). */
const SLOT_LAYOUT: Record<SpineSlotId, { bone: BoneName; x: number; y: number }> = {
  wing: { bone: 'wing', x: 0, y: 4 },
  cape: { bone: 'cape', x: 0, y: -18 },
  sword_back: { bone: 'sword', x: 4, y: 20 },
  hair_back: { bone: 'head', x: 0, y: 10 },
  body: { bone: 'hip', x: 0, y: 6 },
  outfit_lower: { bone: 'hip', x: 0, y: -6 },
  outfit_upper: { bone: 'torso', x: 0, y: 4 },
  head: { bone: 'head', x: 0, y: 10 },
  hair_front: { bone: 'head', x: 0, y: 19 },
  headwear: { bone: 'head', x: 0, y: 26 },
  arm_L: { bone: 'arm_L', x: 0, y: -12 },
  arm_R: { bone: 'arm_R', x: 0, y: -12 },
  weapon_R: { bone: 'hand_R', x: 0, y: 22 },
};

function boneDefs(dir: Direction): NeutralBone[] {
  const armX = PROFILE[dir] ? 3 : dir === 'S' || dir === 'N' ? 11 : 9;
  const b = (name: BoneName, parent: BoneName | undefined, x = 0, y = 0, rotation = 0): NeutralBone => ({
    name,
    ...(parent ? { parent } : {}),
    x,
    y,
    rotation,
  });
  return [
    b('root', undefined),
    b('hip', 'root', 0, 22),
    b('torso', 'hip', 0, 10),
    b('head', 'torso', 0, 28),
    b('arm_L', 'torso', -armX, 22),
    b('arm_R', 'torso', armX, 22),
    b('hand_R', 'arm_R', 0, -24),
    b('wing', 'torso', 0, 18),
    b('cape', 'torso', 0, 22),
    b('sword', 'torso', 0, 12, 35),
  ];
}

function eventFrame(at: AnimationSpec['events'][number]['at'], frames: number): number {
  const f =
    'frame' in at
      ? at.frame - EVENT_FRAME_INDEX_BASE
      : Math.round(frames * (at.phase === 'windup_end' ? 0.35 : at.phase === 'hit_frame' ? 0.45 : 0.7));
  return Math.min(frames - 1, Math.max(0, Math.round(f)));
}

function buildAnimation(spec: AnimationSpec): NeutralAnimation {
  const frames = Math.max(2, Math.round(animationDuration(spec.id) * KEY_FPS));
  const bones: Partial<Record<BoneName, NeutralKey[]>> = {};
  for (let i = 0; i < frames; i++) {
    // loops: periodic, p runs [0,1) so the next loop starts exactly at the first key; one-shots end on the final pose
    const p = spec.loop ? i / frames : i / (frames - 1);
    const pose = poseAt(spec.id, p);
    for (const name of BONES) {
      const bp = pose[name];
      if (!bp) continue;
      (bones[name] ??= []).push({ frame: i, rot: bp.rot ?? 0, tx: bp.tx ?? 0, ty: bp.ty ?? 0 });
    }
  }
  const events = spec.events
    .map((e) => ({ frame: eventFrame(e.at, frames), name: e.name }))
    .sort((a, b) => a.frame - b.frame || a.name.localeCompare(b.name));
  return { id: spec.id, fps: KEY_FPS, frames, loop: spec.loop, bones, events };
}

/** Texture name for slot `slot` in skin index `skinIndex` (0 = default). */
export function textureName(slot: SpineSlotId, skinIndex: number): string {
  return skinIndex === 0 ? slot : `${slot}_${SKINS[skinIndex]}`;
}

/** The test rig for one real direction (docs/21 §9: one skeleton per drawn direction). */
export function buildNeutralRig(direction: Direction): NeutralRig {
  const order = slotsInDrawOrder(direction).filter((s) => slotForm(s) === 'spine') as SpineSlotId[];
  const slots: NeutralSlot[] = order.map((slot) => {
    const lay = SLOT_LAYOUT[slot];
    const size = PART_SIZE[slot];
    // only outfit_upper / outfit_lower / cape have skin variants (see parts.ts)
    const variants = slot === 'outfit_upper' || slot === 'outfit_lower' || slot === 'cape' ? SKINS.length : 1;
    return {
      name: slot,
      bone: lay.bone,
      displays: Array.from({ length: variants }, (_, k) => ({
        texture: textureName(slot, k),
        x: lay.x,
        y: lay.y,
        width: size.w,
        height: size.h,
      })),
    };
  });
  return {
    name: `rig_${direction}`,
    direction,
    bones: boneDefs(direction),
    slots,
    animations: ANIMATIONS.map(buildAnimation),
    skins: SKINS,
    aabb: { x: -42, y: 0, width: 84, height: 108 },
  };
}
