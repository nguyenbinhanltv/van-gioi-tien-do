/**
 * Format-neutral rig schema (D36). One `RigDocument` = one skeleton for one *drawn* direction (docs/21 §9: one
 * skeleton per drawn direction; SW/W/NW reuse SE/E/NE with scaleX = −1, resolved through `@vgtd/character`).
 * Rig space is pivot space: origin at the feet, x right, **y up**, degrees CCW (ADR-021). Exporters convert.
 *
 * The rig is the source of truth in the repo; DragonBones JSON (and, after MVP, Spine) is generated from it.
 */
import type { Direction } from '@vgtd/shared';
import type { EntityKind, SlotId } from '@vgtd/character';

export const RIG_FORMAT = 'vgtd-rig' as const;
export const RIG_FORMAT_VERSION = 1 as const;

/** Semantic bone roles: animations are authored against roles so one clip set drives any humanoid rig. */
export const BONE_ROLES = [
  'root',
  'hips',
  'spine_mid',
  'spine_upper',
  'head',
  'upper_arm_L',
  'lower_arm_L',
  'hand_L',
  'upper_arm_R',
  'lower_arm_R',
  'hand_R',
  'thigh_L',
  'shin_L',
  'foot_L',
  'thigh_R',
  'shin_R',
  'foot_R',
  /** IK target bones (children of root, positioned in pivot space). */
  'ik_foot_L',
  'ik_foot_R',
  'ik_hand_L',
  'ik_hand_R',
] as const;
export type BoneRole = (typeof BONE_ROLES)[number];

export interface RigBone {
  readonly name: string;
  /** null only for the single root bone. Parents must be listed before children. */
  readonly parent: string | null;
  /** Visual / IK length along the bone's local +x axis. */
  readonly length: number;
  /** Rest (setup) transform relative to the parent. */
  readonly x: number;
  readonly y: number;
  readonly rotation: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  /** Default true. false = bone ignores parent rotation (rare; kept for props). */
  readonly inheritRotation?: boolean;
}

/** 1- or 2-bone IK. `bones` lists root→tip; `target` is a bone name (e.g. `ik_foot_L`). */
export interface RigIk {
  readonly name: string;
  readonly bones: readonly string[];
  readonly target: string;
  /** Knee/elbow bend direction. */
  readonly bendPositive: boolean;
  /** Default mix 1. */
  readonly mix?: number;
}

export type ChainKind = 'hair' | 'ribbon' | 'sash' | 'sleeve' | 'cape' | 'tail' | 'other';

/**
 * Secondary-motion group: a bone chain (root→tip) simulated by a spring model and baked to keys at 30 fps.
 * Replaces Spine "physics constraints" (not available in DragonBones; docs/art/dragonbones.md §2).
 */
export interface RigChain {
  readonly name: string;
  readonly kind: ChainKind;
  readonly bones: readonly string[];
  /** 0..1 spring pull toward the rest pose per step (higher = stiffer). */
  readonly stiffness: number;
  /** 0..1 velocity loss per step. */
  readonly damping: number;
  /** Downward pull (deg/s² of extra droop, scaled per bone); default 0. */
  readonly gravity?: number;
  /** How strongly parent motion drags the chain, 0..1; default 1. */
  readonly inertia?: number;
}

export interface RigSocket {
  readonly name: string;
  readonly bone: string;
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
}

export type BlendMode = 'normal' | 'additive';

export interface RigSlot {
  readonly name: string;
  readonly bone: string;
  /** Paperdoll layer this slot implements (docs/03 §2). Custom slots (props, VFX anchors) omit it. */
  readonly paperdoll?: SlotId;
  readonly blend?: BlendMode;
  /** Initially visible attachment name (null/absent = none). */
  readonly attachment?: string | null;
  /** RGBA multiplier 0..1. */
  readonly color?: readonly [number, number, number, number];
}

export interface RegionAttachment {
  readonly type: 'region';
  /** Atlas region name. */
  readonly path: string;
  /** Offset/rotation relative to the slot bone (rig space, y up). */
  readonly x: number;
  readonly y: number;
  readonly rotation?: number;
  readonly scaleX?: number;
  readonly scaleY?: number;
  readonly width: number;
  readonly height: number;
}

export interface MeshAttachment {
  readonly type: 'mesh';
  readonly path: string;
  readonly width: number;
  readonly height: number;
  /** UV pairs, 0..1 across the atlas region (v down, as in the image). */
  readonly uvs: readonly number[];
  /** Vertex positions in slot-bone space (x, y pairs; y up). */
  readonly vertices: readonly number[];
  readonly triangles: readonly number[];
  /** Optional weights: per vertex a list of [boneName, weight]; weights sum to 1. Unweighted if absent. */
  readonly weights?: readonly (readonly (readonly [string, number])[])[];
}

export type RigAttachment = RegionAttachment | MeshAttachment;

export interface RigSkin {
  readonly name: string;
  /** slot name → attachment name → attachment */
  readonly attachments: Readonly<Record<string, Readonly<Record<string, RigAttachment>>>>;
}

export interface RigCanvas {
  readonly width: number;
  readonly height: number;
}

export interface RigDocument {
  readonly format: typeof RIG_FORMAT;
  readonly version: typeof RIG_FORMAT_VERSION;
  readonly id: string;
  readonly kind: EntityKind;
  /** The drawn direction this skeleton is for (S, SE, E, NE or N; others only for animations drawn in 8). */
  readonly direction: Direction;
  /** Canvas @1x; the root bone sits at the pivot, `pivotOf(width, height)` from @vgtd/character (docs/03 §5). */
  readonly canvas: RigCanvas;
  readonly bones: readonly RigBone[];
  readonly ik?: readonly RigIk[];
  readonly chains?: readonly RigChain[];
  /** role → bone name. Required roles depend on what animations use; see `requireRoles`. */
  readonly roles: Readonly<Partial<Record<BoneRole, string>>>;
  readonly sockets?: readonly RigSocket[];
  /** Listed in draw order, back → front (DragonBones slot order). */
  readonly slots: readonly RigSlot[];
  readonly skins: readonly RigSkin[];
}

/** Packed atlas input (from the project packer). Region names must equal attachment `path`s. */
export interface AtlasRegion {
  readonly name: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly rotated?: boolean;
}

export interface AtlasData {
  /** Texture file name, e.g. `kiemtu_S.png`. */
  readonly imagePath: string;
  readonly width: number;
  readonly height: number;
  /** Atlas page is premultiplied-alpha (docs/02 §3: all atlases premultiplied). Exported as `premultipliedAlpha`. */
  readonly premultipliedAlpha: boolean;
  readonly regions: readonly AtlasRegion[];
}

/** A set of per-direction rigs for one character (drawn directions only; mirrors come from @vgtd/character). */
export interface RigSet {
  readonly id: string;
  readonly rigs: Readonly<Partial<Record<Direction, RigDocument>>>;
}
