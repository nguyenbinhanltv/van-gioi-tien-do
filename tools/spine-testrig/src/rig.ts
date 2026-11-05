import type { Direction } from '@vgtd/shared';
import {
  ANIMATIONS,
  EVENT_FRAME_INDEX_BASE,
  SPINE_EVENT_NAMES,
  animationDuration,
  slotForm,
  slotsInDrawOrder,
  type AnimationId,
  type AnimationSpec,
  type SlotId,
} from '@vgtd/character';
import { packAtlas, type Atlas } from './atlas.js';
import { BONES, poseAt, type BoneName } from './motion.js';
import { PART_SIZE, PROFILE, SKINS, buildParts } from './parts.js';
import { encodePng } from './png.js';

/** Spine version written to the JSON; the Cocos runtime is 4.2 (D25). */
export const SPINE_VERSION = '4.2.33';
/** Spine animations are keyed at 30 fps (docs/03 §3). */
export const KEY_FPS = 30;

type SpineSlotId = Exclude<SlotId, 'orbit_back' | 'orbit_front'>;

interface BoneDef {
  name: BoneName;
  parent?: BoneName;
  x?: number;
  y?: number;
  rotation?: number;
}

/** Slot -> bone and attachment offset (region centre, bone space, y up). */
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

function boneDefs(dir: Direction): BoneDef[] {
  const armX = PROFILE[dir] ? 3 : dir === 'S' || dir === 'N' ? 11 : 9;
  return [
    { name: 'root' },
    { name: 'hip', parent: 'root', y: 22 },
    { name: 'torso', parent: 'hip', y: 10 },
    { name: 'head', parent: 'torso', y: 28 },
    { name: 'arm_L', parent: 'torso', x: -armX, y: 22 },
    { name: 'arm_R', parent: 'torso', x: armX, y: 22 },
    { name: 'hand_R', parent: 'arm_R', y: -24 },
    { name: 'wing', parent: 'torso', y: 18 },
    { name: 'cape', parent: 'torso', y: 22 },
    { name: 'sword', parent: 'torso', y: 12, rotation: 35 },
  ];
}

const round = (n: number) => Math.round(n * 1000) / 1000;

function eventTime(spec: AnimationSpec, at: AnimationSpec['events'][number]['at']): number {
  const dur = animationDuration(spec.id);
  if ('frame' in at) return round(Math.min(dur, Math.max(0, (at.frame - EVENT_FRAME_INDEX_BASE) / spec.fps))); // docs/29 A.0 #6a, docs/31 F-05
  return round(dur * (at.phase === 'windup_end' ? 0.35 : at.phase === 'hit_frame' ? 0.45 : 0.7));
}

function animationJson(spec: AnimationSpec) {
  const dur = animationDuration(spec.id);
  const n = Math.max(2, Math.round(dur * KEY_FPS));
  const rotate = new Map<BoneName, { time: number; value: number }[]>();
  const translate = new Map<BoneName, { time: number; x: number; y: number }[]>();
  for (let i = 0; i <= n; i++) {
    const time = round(Math.min(dur, i / KEY_FPS));
    // loops: key the final frame at p = 1 (== p = 0); one-shots: p runs 0..1 over the exact duration
    const p = Math.min(1, time / dur);
    const pose = poseAt(spec.id as AnimationId, p);
    for (const b of BONES) {
      const bp = pose[b];
      if (!bp) continue;
      if (bp.rot !== undefined) (rotate.get(b) ?? rotate.set(b, []).get(b)!).push({ time, value: round(bp.rot) });
      if (bp.tx !== undefined || bp.ty !== undefined) {
        (translate.get(b) ?? translate.set(b, []).get(b)!).push({ time, x: round(bp.tx ?? 0), y: round(bp.ty ?? 0) });
      }
    }
  }
  const bones: Record<string, { rotate?: unknown; translate?: unknown }> = {};
  for (const [b, v] of rotate) (bones[b] ??= {}).rotate = v;
  for (const [b, v] of translate) (bones[b] ??= {}).translate = v;
  const events = spec.events
    .map((e) => ({ time: eventTime(spec, e.at), name: e.name }))
    .sort((a, b) => a.time - b.time || a.name.localeCompare(b.name));
  return { bones, ...(events.length ? { events } : {}) };
}

export interface GeneratedRig {
  readonly direction: Direction;
  /** Base file name without extension, e.g. `rig_S`. */
  readonly name: string;
  readonly json: string;
  readonly atlas: string;
  readonly png: Uint8Array;
  readonly atlasInfo: Atlas;
}

/** One skeleton + atlas for one real direction (docs/21 §9: one skeleton per drawn direction). */
export function generateRig(direction: Direction): GeneratedRig {
  const name = `rig_${direction}`;
  const parts = buildParts(direction);
  const atlas = packAtlas(`${name}.png`, parts);
  // setup draw order = this direction's paperdoll table (back -> front), Spine slots only
  const slotOrder = slotsInDrawOrder(direction).filter((s) => slotForm(s) === 'spine') as SpineSlotId[];

  const skins = SKINS.map((skin) => {
    const attachments: Record<string, Record<string, unknown>> = {};
    for (const slot of slotOrder) {
      const part = parts.find((p) => p.slot === slot && p.skin === skin);
      if (!part) continue;
      const lay = SLOT_LAYOUT[slot];
      const size = PART_SIZE[slot];
      attachments[slot] = {
        [slot]: { name: slot, path: part.name, x: lay.x, y: lay.y, width: size.w, height: size.h },
      };
    }
    return { name: skin, attachments };
  });

  const eventDefs = Object.fromEntries(SPINE_EVENT_NAMES.map((e) => [e, {}]));
  const json = {
    skeleton: { spine: SPINE_VERSION, x: -42, y: 0, width: 84, height: 108, images: '', audio: '' },
    bones: boneDefs(direction).map((b) => ({
      name: b.name,
      ...(b.parent ? { parent: b.parent } : {}),
      ...(b.x ? { x: b.x } : {}),
      ...(b.y ? { y: b.y } : {}),
      ...(b.rotation ? { rotation: b.rotation } : {}),
    })),
    slots: slotOrder.map((slot) => ({ name: slot, bone: SLOT_LAYOUT[slot].bone, attachment: slot })),
    skins,
    events: eventDefs,
    animations: Object.fromEntries(ANIMATIONS.map((a) => [a.id, animationJson(a)])),
  };
  return {
    direction,
    name,
    json: JSON.stringify(json) + '\n',
    atlas: atlas.text,
    png: encodePng(atlas.page),
    atlasInfo: atlas,
  };
}
