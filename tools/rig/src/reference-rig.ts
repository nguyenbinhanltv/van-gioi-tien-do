/**
 * Reference humanoid rig: a valid, fully-featured `RigDocument` generated in code. It is the test fixture for the
 * exporter / DSL / QA and the default target when authoring animations before a character's own rig.json exists.
 * It is NOT character art: proportions follow the docs/03 socket table (head_fx y = 92, chest 48, back 64).
 */
import { slotsInDrawOrder, type SlotId } from '@vgtd/character';
import type { Direction } from '@vgtd/shared';
import type { RigBone, RigDocument, RigSlot, RigSkin, RegionAttachment } from './schema.js';
import { RIG_FORMAT, RIG_FORMAT_VERSION } from './schema.js';

/** Which skeleton bone each paperdoll slot rides on, and its attachment box (w × h px, offset from the bone). */
export const SLOT_LAYOUT: Readonly<
  Partial<Record<SlotId, { bone: string; x: number; y: number; w: number; h: number }>>
> = {
  wing: { bone: 'spine_upper', x: -6, y: 4, w: 56, h: 44 },
  cape: { bone: 'spine_upper', x: -8, y: 0, w: 28, h: 44 },
  sword_back: { bone: 'spine_upper', x: 2, y: 0, w: 10, h: 52 },
  hair_back: { bone: 'hair_1', x: 0, y: 0, w: 30, h: 30 },
  body: { bone: 'spine_mid', x: 0, y: 0, w: 22, h: 30 },
  outfit_lower: { bone: 'hips', x: 0, y: 0, w: 26, h: 26 },
  outfit_upper: { bone: 'spine_mid', x: 0, y: 0, w: 26, h: 26 },
  head: { bone: 'head', x: 0, y: 0, w: 26, h: 26 },
  hair_front: { bone: 'head', x: 12, y: 0, w: 28, h: 12 },
  headwear: { bone: 'head', x: 16, y: 0, w: 30, h: 10 },
  arm_L: { bone: 'upper_arm_L', x: 0, y: 0, w: 10, h: 28 },
  arm_R: { bone: 'upper_arm_R', x: 0, y: 0, w: 10, h: 28 },
  weapon_R: { bone: 'hand_R', x: 0, y: 0, w: 10, h: 50 },
};

/** Sideways spread of the legs/arms by view: wide in front/back views, narrow in profile. */
function spread(direction: Direction): number {
  switch (direction) {
    case 'S':
    case 'N':
      return 6;
    case 'E':
    case 'W':
      return 1;
    default:
      return 3;
  }
}

export function buildReferenceHumanoid(direction: Direction = 'E', id = 'reference-humanoid'): RigDocument {
  const sp = spread(direction);
  const bones: RigBone[] = [
    { name: 'root', parent: null, length: 0, x: 0, y: 0, rotation: 0 },
    { name: 'hips', parent: 'root', length: 10, x: 0, y: 36, rotation: 90 },
    { name: 'spine_mid', parent: 'hips', length: 14, x: 10, y: 0, rotation: 0 },
    { name: 'spine_upper', parent: 'spine_mid', length: 14, x: 14, y: 0, rotation: 0 },
    { name: 'head', parent: 'spine_upper', length: 20, x: 14, y: 0, rotation: 0 },
    // arms (hang down: world −90° = local −180° under the +90° spine)
    { name: 'upper_arm_L', parent: 'spine_upper', length: 14, x: 12, y: sp, rotation: -180 },
    { name: 'lower_arm_L', parent: 'upper_arm_L', length: 13, x: 14, y: 0, rotation: 0 },
    { name: 'hand_L', parent: 'lower_arm_L', length: 6, x: 13, y: 0, rotation: 0 },
    { name: 'upper_arm_R', parent: 'spine_upper', length: 14, x: 12, y: -sp, rotation: -180 },
    { name: 'lower_arm_R', parent: 'upper_arm_R', length: 13, x: 14, y: 0, rotation: 0 },
    { name: 'hand_R', parent: 'lower_arm_R', length: 6, x: 13, y: 0, rotation: 0 },
    // legs
    { name: 'thigh_L', parent: 'hips', length: 17, x: -2, y: sp, rotation: -180 },
    { name: 'shin_L', parent: 'thigh_L', length: 17, x: 17, y: 0, rotation: 0 },
    { name: 'foot_L', parent: 'shin_L', length: 9, x: 17, y: 0, rotation: 90 },
    { name: 'thigh_R', parent: 'hips', length: 17, x: -2, y: -sp, rotation: -180 },
    { name: 'shin_R', parent: 'thigh_R', length: 17, x: 17, y: 0, rotation: 0 },
    { name: 'foot_R', parent: 'shin_R', length: 9, x: 17, y: 0, rotation: 90 },
    // IK targets in pivot space (children of root); a bone's local +y maps to world −x under the +90° spine
    { name: 'ik_foot_L', parent: 'root', length: 0, x: -sp, y: 0, rotation: 0 },
    { name: 'ik_foot_R', parent: 'root', length: 0, x: sp, y: 0, rotation: 0 },
    { name: 'ik_hand_L', parent: 'root', length: 0, x: -sp, y: 45, rotation: 0 },
    { name: 'ik_hand_R', parent: 'root', length: 0, x: sp, y: 45, rotation: 0 },
    // secondary-motion chains
    { name: 'hair_1', parent: 'head', length: 8, x: 16, y: -8, rotation: 90 },
    { name: 'hair_2', parent: 'hair_1', length: 8, x: 8, y: 0, rotation: 0 },
    { name: 'hair_3', parent: 'hair_2', length: 8, x: 8, y: 0, rotation: 0 },
    { name: 'sash_1', parent: 'hips', length: 8, x: -4, y: 0, rotation: -180 },
    { name: 'sash_2', parent: 'sash_1', length: 8, x: 8, y: 0, rotation: 0 },
    { name: 'sash_3', parent: 'sash_2', length: 8, x: 8, y: 0, rotation: 0 },
  ];

  const order = slotsInDrawOrder(direction).filter((s) => SLOT_LAYOUT[s]);
  const slots: RigSlot[] = order.map((s) => ({
    name: s,
    bone: SLOT_LAYOUT[s]!.bone,
    paperdoll: s,
    blend: s === 'wing' ? 'additive' : 'normal',
    // the sword is drawn (in hand): the back sword stays hidden, like the real rig
    attachment: s === 'sword_back' ? null : s,
  }));
  const attachments: Record<string, Record<string, RegionAttachment>> = {};
  for (const s of order) {
    const l = SLOT_LAYOUT[s]!;
    attachments[s] = { [s]: { type: 'region', path: s, x: l.x, y: l.y, width: l.w, height: l.h } };
  }
  const skins: RigSkin[] = [{ name: 'default', attachments }];

  return {
    format: RIG_FORMAT,
    version: RIG_FORMAT_VERSION,
    id,
    kind: 'player',
    direction,
    canvas: { width: 128, height: 128 },
    bones,
    ik: [
      { name: 'ik_leg_L', bones: ['thigh_L', 'shin_L'], target: 'ik_foot_L', bendPositive: true },
      { name: 'ik_leg_R', bones: ['thigh_R', 'shin_R'], target: 'ik_foot_R', bendPositive: true },
      { name: 'ik_arm_L', bones: ['upper_arm_L', 'lower_arm_L'], target: 'ik_hand_L', bendPositive: false, mix: 0 },
      { name: 'ik_arm_R', bones: ['upper_arm_R', 'lower_arm_R'], target: 'ik_hand_R', bendPositive: false, mix: 0 },
    ],
    chains: [
      {
        name: 'hair',
        kind: 'hair',
        bones: ['hair_1', 'hair_2', 'hair_3'],
        stiffness: 0.35,
        damping: 0.35,
        gravity: 120,
      },
      {
        name: 'sash',
        kind: 'sash',
        bones: ['sash_1', 'sash_2', 'sash_3'],
        stiffness: 0.25,
        damping: 0.3,
        gravity: 200,
      },
    ],
    roles: {
      root: 'root',
      hips: 'hips',
      spine_mid: 'spine_mid',
      spine_upper: 'spine_upper',
      head: 'head',
      upper_arm_L: 'upper_arm_L',
      lower_arm_L: 'lower_arm_L',
      hand_L: 'hand_L',
      upper_arm_R: 'upper_arm_R',
      lower_arm_R: 'lower_arm_R',
      hand_R: 'hand_R',
      thigh_L: 'thigh_L',
      shin_L: 'shin_L',
      foot_L: 'foot_L',
      thigh_R: 'thigh_R',
      shin_R: 'shin_R',
      foot_R: 'foot_R',
      ik_foot_L: 'ik_foot_L',
      ik_foot_R: 'ik_foot_R',
      ik_hand_L: 'ik_hand_L',
      ik_hand_R: 'ik_hand_R',
    },
    sockets: [
      { name: 'hand_R', bone: 'hand_R', x: 0, y: 0 },
      { name: 'hand_L', bone: 'hand_L', x: 0, y: 0 },
      { name: 'back', bone: 'spine_upper', x: 4, y: 0, rotation: 45 },
      { name: 'chest', bone: 'spine_mid', x: 2, y: 0 },
      { name: 'head_fx', bone: 'head', x: 18, y: 0 },
    ],
    slots,
    skins,
  };
}
