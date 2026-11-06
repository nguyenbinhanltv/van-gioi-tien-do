/**
 * Character registry: the 4 Đạo Lộ (docs/11 §2) as data. Everything class-specific lives here (weapon rules, extra
 * secondary-motion chains, joint caps, file locations, viewer naming); the pipeline code reads it and has no per-class
 * branches. Add a character = add an entry (and its art/rig data), not code.
 */
import type { SlotId } from '@vgtd/character';
import type { ChainKind } from './schema.js';

export const CHARACTER_IDS = ['kiem-tu', 'the-tu', 'phap-tu', 'dan-phu-tu'] as const;
export type CharacterId = (typeof CHARACTER_IDS)[number];

export type WeaponKind = 'sword' | 'gauntlets' | 'staff' | 'fan' | 'whisk' | 'brush';

export interface WeaponRule {
  /** What the class holds / wears (a class may switch between kinds: Pháp tu staff or fan). */
  readonly kinds: readonly WeaponKind[];
  /**
   * Paperdoll slot carrying the weapon art. `null` = worn on the arm slots (gauntlets): no `weapon_R` piece exists
   * and none may be visible.
   */
  readonly slot: Extract<SlotId, 'weapon_R'> | null;
  readonly hands: 'right' | 'both';
  /** SW/W/NW reuse SE/E/NE mirrored; the weapon slot gets a hand-drawn mirrored variant (docs/03 §2). */
  readonly mirroredVariant: boolean;
  /** The class has a sheathed weapon slot (`sword_back`) that is hidden while the weapon is in hand. */
  readonly backSlot: boolean;
}

export interface OrbitRule {
  /** Sprite nodes orbiting the body (not skeleton slots, docs/03 §2). */
  readonly kind: 'flying_sword' | 'talisman' | 'none';
  readonly count: number;
}

/** A secondary-motion chain added to the template skeleton. */
export interface ChainTemplate {
  readonly name: string;
  readonly kind: ChainKind;
  /** Role bone the chain hangs from. */
  readonly parent: 'head' | 'hips' | 'spine_upper' | 'lower_arm_L' | 'lower_arm_R' | 'hand_R' | 'shin_L' | 'shin_R';
  readonly segments: number;
  /** Segment length in px. */
  readonly length: number;
  /** Rest placement of the first segment relative to the parent bone (px along/across its axes). */
  readonly at: { readonly x: number; readonly y: number; readonly rotation: number };
  readonly stiffness: number;
  readonly damping: number;
  readonly gravity?: number;
}

/**
 * Design limits (deg) per joint, documentation of intent. The parts spec does not use them: it uses the angles
 * measured from the class's actual animation set (`measuredJointCaps`).
 */
export interface JointCaps {
  readonly shoulder: number;
  readonly elbow: number;
  readonly wrist: number;
  readonly hip: number;
  readonly knee: number;
  readonly ankle: number;
  readonly neck: number;
  readonly waist: number;
}

export interface CharacterClass {
  readonly id: CharacterId;
  /** Vietnamese name. */
  readonly name: string;
  readonly role: string;
  /** File stem of the viewer package: `<stem>_<DIR>_ske.json` (docs/32 §3). */
  readonly stem: string;
  readonly weapon: WeaponRule;
  readonly orbit: OrbitRule;
  /** Paperdoll slots the art must provide / may provide (a missing required one fails the parts check). */
  readonly slots: { readonly required: readonly SlotId[]; readonly optional: readonly SlotId[] };
  readonly chains: readonly ChainTemplate[];
  readonly caps: JointCaps;
}

const BASE_REQUIRED: readonly SlotId[] = [
  'body',
  'outfit_lower',
  'outfit_upper',
  'head',
  'hair_front',
  'hair_back',
  'arm_L',
  'arm_R',
];

const HAIR_AND_SASH: readonly ChainTemplate[] = [
  {
    name: 'hair',
    kind: 'hair',
    parent: 'head',
    segments: 3,
    length: 8,
    at: { x: 16, y: -8, rotation: 90 },
    stiffness: 0.35,
    damping: 0.35,
    gravity: 120,
  },
  {
    name: 'sash',
    kind: 'sash',
    parent: 'hips',
    segments: 3,
    length: 8,
    at: { x: -4, y: 0, rotation: -180 },
    stiffness: 0.25,
    damping: 0.3,
    gravity: 200,
  },
];

export const CLASSES: Readonly<Record<CharacterId, CharacterClass>> = {
  'kiem-tu': {
    id: 'kiem-tu',
    name: 'Kiếm tu',
    role: 'DPS cận / trung, cơ động',
    stem: 'kiemtu',
    weapon: { kinds: ['sword'], slot: 'weapon_R', hands: 'right', mirroredVariant: true, backSlot: true },
    orbit: { kind: 'flying_sword', count: 1 },
    slots: { required: [...BASE_REQUIRED, 'weapon_R'], optional: ['headwear', 'cape', 'wing', 'sword_back'] },
    chains: HAIR_AND_SASH,
    caps: { shoulder: 150, elbow: 140, wrist: 60, hip: 90, knee: 110, ankle: 40, neck: 40, waist: 35 },
  },
  'the-tu': {
    id: 'the-tu',
    name: 'Thể tu',
    role: 'Tank / cận chiến, kháng kiếp',
    stem: 'thetu',
    // Quyền sáo (gauntlets) are part of the arm pieces: no separate weapon piece, none may be visible
    weapon: { kinds: ['gauntlets'], slot: null, hands: 'both', mirroredVariant: false, backSlot: false },
    orbit: { kind: 'none', count: 0 },
    slots: { required: BASE_REQUIRED, optional: ['headwear', 'cape'] },
    chains: [HAIR_AND_SASH[0]!],
    caps: { shoulder: 120, elbow: 150, wrist: 60, hip: 70, knee: 100, ankle: 40, neck: 30, waist: 40 },
  },
  'phap-tu': {
    id: 'phap-tu',
    name: 'Pháp tu',
    role: 'DPS tầm xa, AOE, khống chế',
    stem: 'phaptu',
    // pháp trượng (two-hand when channelling) or quạt (one hand): the same weapon slot, kind chosen by the art
    weapon: { kinds: ['staff', 'fan'], slot: 'weapon_R', hands: 'right', mirroredVariant: true, backSlot: false },
    orbit: { kind: 'none', count: 0 },
    slots: { required: [...BASE_REQUIRED, 'weapon_R'], optional: ['headwear', 'cape', 'wing'] },
    chains: [
      ...HAIR_AND_SASH,
      {
        name: 'sleeve_R',
        kind: 'sleeve',
        parent: 'lower_arm_R',
        segments: 1,
        length: 12,
        at: { x: 13, y: 0, rotation: 0 },
        stiffness: 0.5,
        damping: 0.4,
      },
      {
        name: 'sleeve_L',
        kind: 'sleeve',
        parent: 'lower_arm_L',
        segments: 1,
        length: 12,
        at: { x: 13, y: 0, rotation: 0 },
        stiffness: 0.5,
        damping: 0.4,
      },
    ],
    caps: { shoulder: 130, elbow: 140, wrist: 60, hip: 70, knee: 100, ankle: 40, neck: 35, waist: 35 },
  },
  'dan-phu-tu': {
    id: 'dan-phu-tu',
    name: 'Đan/Phù tu',
    role: 'Hỗ trợ: hồi máu, khiên, khống chế, buff',
    stem: 'danphutu',
    // phất trần (whisk) or bút phù (brush) in the right hand; phù lục (talismans) orbit as sprite nodes
    weapon: { kinds: ['whisk', 'brush'], slot: 'weapon_R', hands: 'right', mirroredVariant: true, backSlot: false },
    orbit: { kind: 'talisman', count: 4 },
    slots: { required: [...BASE_REQUIRED, 'weapon_R'], optional: ['headwear', 'cape'] },
    chains: [
      ...HAIR_AND_SASH,
      {
        name: 'whisk_tail',
        kind: 'tail',
        parent: 'hand_R',
        segments: 3,
        length: 7,
        at: { x: 0, y: 0, rotation: 0 },
        stiffness: 0.3,
        damping: 0.35,
        gravity: 90,
      },
    ],
    caps: { shoulder: 120, elbow: 140, wrist: 70, hip: 70, knee: 100, ankle: 40, neck: 35, waist: 35 },
  },
};

export function getClass(id: CharacterId): CharacterClass {
  const c = CLASSES[id];
  if (!c) throw new RangeError(`unknown character '${id}'`);
  return c;
}

/** Repo-relative locations of one character's data and viewer package (the same convention for every class). */
export function characterPaths(id: CharacterId) {
  return {
    /** Manifest listing rig + per-direction atlas files (`tools/rig/data/<id>.assets.json`). */
    manifest: `tools/rig/data/${id}.assets.json`,
    rig: `tools/rig/data/${id}.rig.json`,
    /** Where `npm run export:character` writes the viewer package; docs/32 §3: `#viewer&src=dragonbones/<id>&stem=<stem>`. */
    viewerDir: `apps/client-cocos/assets/resources/dragonbones/${id}`,
  } as const;
}
