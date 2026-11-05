/**
 * Viewer API for the Cocos client (docs/21 §9): everything a Spine 4.2 paperdoll viewer needs for one frame of
 * state — draw order of the skeleton's slots for a direction, mirror flag / scaleX, the animation entry
 * (fps / loop / events), and sockets in the skeleton's local space (pivot space, y UP — ADR-021, never flipped here).
 * Pure data in / pure data out; the adapter only applies the result to `sp.Skeleton`.
 */
import type { Direction, Vec2 } from '@vgtd/shared';
import {
  ANIMATIONS,
  SPINE_PLAYBACK_FPS,
  defaultAsymmetricAnimations,
  getAnimation,
  type AnimationEventSpec,
  type AnimationId,
} from './animations.js';
import { resolveDirection, type EntityKind, type FootprintClass } from './direction.js';
import {
  getSocket,
  headTopY,
  overheadAnchors,
  socketLocalPosition,
  type HeadTopContext,
  type SocketAxis,
  type SocketId,
} from './footprint.js';
import {
  DRAW_ORDER,
  SLOT_IDS,
  resolvePaperdoll,
  slotForm,
  slotsInDrawOrder,
  type HideReason,
  type PaperdollOptions,
  type ResolvedSlot,
  type SlotId,
} from './paperdoll.js';

export type PlaybackProfile = keyof typeof SPINE_PLAYBACK_FPS;

export interface CharacterViewInput {
  readonly kind: EntityKind;
  readonly direction: Direction;
  /** Slots that currently have an attachment in the combined skin. */
  readonly equipped: Iterable<SlotId>;
  readonly animation: AnimationId;
  /**
   * Is this animation drawn in all 8 directions (D14, per animation)? Default: the kind's default list
   * (docs/31 F-01 / ADR-020) for Player, none for other kinds. Data files override with `drawnInEight`.
   */
  readonly drawnInEight?: boolean;
  /** Paperdoll conflict flags (mounted, sword in hand, hood …). `mirrored` is derived, do not pass it. */
  readonly paperdoll?: Omit<PaperdollOptions, 'mirrored'>;
  readonly footprint?: FootprintClass;
  readonly headTop?: HeadTopContext;
  /** Per-species socket positions (mount_seat) and rig overrides, pivot space, y up. */
  readonly socketsOverride?: Partial<Record<SocketId, Vec2>>;
  readonly profile?: PlaybackProfile;
  /** docs/31 F-02: keep y up (default). */
  readonly socketAxis?: SocketAxis;
}

export interface AnimationView {
  readonly id: AnimationId;
  readonly loop: boolean;
  readonly frames: number;
  /** Sprite Sheet fps from the table. */
  readonly fps: number;
  readonly durationSec: number;
  readonly events: readonly AnimationEventSpec[];
  /** Spine playback rate for the chosen profile (60 PC / 30 mobile-web / 15 far). */
  readonly playbackFps: number;
}

export interface CharacterViewState {
  /** Requested facing. */
  readonly direction: Direction;
  /** Which direction's rig/art the skeleton plays (one of the drawn directions, or the true one if drawn in 8). */
  readonly skeletonDirection: Direction;
  readonly mirrored: boolean;
  /** Apply to the skeleton's parent node `scale.x`. */
  readonly scaleX: 1 | -1;
  /**
   * All 13 Spine slots, back → front, for this (real) direction — assign to `skeleton.drawOrder`.
   * Unequipped / hidden slots keep their place; hide them via `visibleSlots`.
   */
  readonly slotOrder: readonly SlotId[];
  /** Spine slots to show (equipped, not hidden by conflict rules), back → front. */
  readonly visibleSlots: readonly ResolvedSlot[];
  readonly hidden: readonly { slot: SlotId; reason: HideReason }[];
  /** Orbit sprite nodes: their Draw Order values (always 1 and 15) — they sit outside the skeleton. */
  readonly orbit: { readonly back: number; readonly front: number };
  readonly animation: AnimationView;
  /** Sockets in skeleton-local space (y up, mirrored x already negated). mount_seat is null unless overridden. */
  readonly sockets: Readonly<Record<SocketId, Vec2 | null>>;
  /** head_top and the overhead UI anchors in the same space. */
  readonly headTop: number;
  readonly overhead: Readonly<Record<'hp_bar' | 'name_title' | 'realm_icon', Vec2>>;
}

/** The 13 Spine slot ids (no orbit sprite nodes). */
export const SPINE_SLOT_IDS: readonly SlotId[] = SLOT_IDS.filter((s) => slotForm(s) === 'spine');

export function getAnimationView(id: AnimationId, profile: PlaybackProfile = 'mobileWeb'): AnimationView {
  const a = getAnimation(id);
  return {
    id: a.id,
    loop: a.loop,
    frames: a.frames,
    fps: a.fps,
    durationSec: a.durationSec,
    events: a.events,
    playbackFps: SPINE_PLAYBACK_FPS[profile],
  };
}

/** Whole animation table as plain objects (viewer animation picker). */
export function getAnimationTable(profile: PlaybackProfile = 'mobileWeb'): AnimationView[] {
  return ANIMATIONS.map((a) => getAnimationView(a.id, profile));
}

const SOCKET_IDS_ALL: readonly SocketId[] = [
  'origin',
  'hand_R',
  'hand_L',
  'back',
  'chest',
  'head_fx',
  'head_top',
  'orbit_center',
  'mount_seat',
  'fly_feet',
];

/** One call per frame (or per change of direction / equipment / animation). */
export function getCharacterViewState(input: CharacterViewInput): CharacterViewState {
  const drawnInEight =
    input.drawnInEight ?? (input.kind === 'player' && defaultAsymmetricAnimations('player').includes(input.animation));
  const dir = resolveDirection(input.kind, input.direction, { footprint: input.footprint, drawnInEight });
  const pd = resolvePaperdoll(input.direction, input.equipped, { ...input.paperdoll, mirrored: dir.mirrored });

  const sockets = Object.fromEntries(
    SOCKET_IDS_ALL.map((id) => {
      const override = input.socketsOverride?.[id];
      const hasPos = override !== undefined || getSocket(id).pos !== null;
      return [id, hasPos ? socketLocalPosition(id, dir.mirrored, override, input.socketAxis) : null];
    }),
  ) as Record<SocketId, Vec2 | null>;

  const top = input.socketsOverride?.head_top?.y ?? headTopY(input.headTop);
  return {
    direction: input.direction,
    skeletonDirection: dir.drawn,
    mirrored: dir.mirrored,
    scaleX: dir.scaleX,
    slotOrder: slotsInDrawOrder(input.direction).filter((s) => slotForm(s) === 'spine'),
    visibleSlots: pd.ordered.filter((r) => r.form === 'spine'),
    hidden: pd.hidden,
    orbit: { back: DRAW_ORDER.orbit_back[input.direction], front: DRAW_ORDER.orbit_front[input.direction] },
    animation: getAnimationView(input.animation, input.profile),
    sockets: { ...sockets, head_top: { x: 0, y: top } }, // head_top follows hat / mount / flight extras
    headTop: top,
    overhead: overheadAnchors(top),
  };
}
