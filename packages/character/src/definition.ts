/**
 * Definition-file types: what a character (player / npc / pet) or monster (mob / elite / boss) data file contains.
 * JSON Schema in schema.ts; semantic validators in validators.ts.
 */
import type { Direction } from '@vgtd/shared';
import type { AnimationId } from './animations.js';
import type { EntityKind, FootprintClass } from './direction.js';
import type { SocketId } from './footprint.js';
import type { MutationVariantSpec, PartBreakSpec, PhaseSpec, BossPartSpec, RigLimits } from './boss.js';
import type { PackedAttachment, SlotId } from './paperdoll.js';

export const DEFINITION_SCHEMA_VERSION = 1;

export type CharacterKind = 'player' | 'npc' | 'pet';
export type MonsterKind = 'mob' | 'elite' | 'boss';
export type RenderTech = 'spine' | 'prerender3d' | 'spritesheet' | 'spine_pieced';

/** Same shape as `RigLimits`; counted values of the authored rig. */
export type RigStats = RigLimits;

export interface AnimationDef {
  /** One of the 13 standard ids for characters; free snake_case id for monsters (idle, run, attack, …). */
  readonly id: string;
  readonly loop: boolean;
  readonly frames: number;
  readonly fps: number;
  /** Per-animation flag: drawn in all 8 directions (asymmetric silhouette) instead of 5 + mirror. */
  readonly drawnInEight: boolean;
}

export interface CharacterCollision {
  readonly multiPart: false;
  readonly colliderRadius: number;
  readonly hurtboxRadius: number;
  readonly pickBox: { readonly width: number; readonly height: number };
}

export interface CharacterDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly kind: CharacterKind;
  readonly footprint: Exclude<FootprintClass, '4x4' | '8x8'>;
  /** Canvas side @1x. */
  readonly canvas: number;
  readonly render: 'spine';
  readonly rig: RigStats;
  readonly animations: readonly AnimationDef[];
  readonly collision: CharacterCollision;
  /** Optional per-species / per-rig socket overrides (pivot space, y up). */
  readonly sockets?: Partial<Record<SocketId, { readonly x: number; readonly y: number }>>;
  readonly paperdoll?: {
    /** Slots the default outfit fills. */
    readonly equipped: readonly SlotId[];
    /** Packed regions of the repacked texture, to verify the 2-draw-call rule. */
    readonly attachments?: readonly PackedAttachment[];
  };
}

export type MonsterCollision = CharacterCollision | { readonly multiPart: true };

export interface MonsterDefinition {
  readonly schemaVersion: 1;
  readonly id: string;
  readonly name: string;
  readonly kind: MonsterKind;
  readonly footprint: FootprintClass;
  /** Canvas side @1x; null for the pieced 8 × 8 boss. */
  readonly canvas: number | null;
  readonly render: RenderTech;
  readonly directions: {
    readonly scheme: 'five_mirror' | 'parts_1_3';
    /** Pieced boss only: the 1–3 drawn directions. */
    readonly drawn?: readonly Direction[];
  };
  readonly rig?: RigStats;
  readonly animations: readonly AnimationDef[];
  readonly collision: MonsterCollision;
  readonly hpBar: 'overhead' | 'hud';
  /** 8 × 8 pieced boss: separate skeletons (body, heads, tail). */
  readonly parts?: readonly BossPartSpec[];
  readonly partBreak?: readonly PartBreakSpec[];
  readonly phases?: readonly PhaseSpec[];
  readonly variants?: readonly MutationVariantSpec[];
}

export type { AnimationId, EntityKind };
