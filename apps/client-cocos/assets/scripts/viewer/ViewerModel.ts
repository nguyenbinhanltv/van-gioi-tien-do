import { character, shared } from '../vendor/vgtd.mjs';

export type Direction = shared.Direction;
export type AnimationId = character.AnimationId;
export type SlotId = character.SlotId;
export type SkinName = 'default' | 'red';

/** Everything the control panel edits. Plain data: the scene reads it every frame. */
export interface ViewerSettings {
  direction: Direction;
  /** Animation of actor A (and of B unless compare is on). */
  animation: AnimationId;
  /** Animation of actor B in compare mode. */
  animationB: AnimationId;
  compare: boolean;
  paused: boolean;
  /** Loop one-shot animations while viewing (events fire each pass). */
  repeatOneShots: boolean;
  /** Skeleton.timeScale. */
  timeScale: number;
  /** AnimationState mix duration (s) used when switching animations. */
  mixDuration: number;
  profile: character.PlaybackProfile;
  skin: SkinName;
  /** Slots that have an attachment (paperdoll "equipped" set). */
  equipped: Set<SlotId>;
  /** Paperdoll conflict flags (docs/03 paperdoll rules). */
  flags: { mounted: boolean; swordInHand: boolean; swordFlying: boolean; hoodedHeadwear: boolean; longRobe: boolean };
  /** Override the per-animation "drawn in 8" default (D14); null = default for the Player kind. */
  drawnInEight: boolean | null;
  /** Normalised scrub position 0..1 requested by the slider (only applied while paused). */
  scrub: number | null;
}

export function defaultSettings(): ViewerSettings {
  return {
    direction: 'S',
    animation: 'idle',
    animationB: 'walk',
    compare: false,
    paused: false,
    repeatOneShots: true,
    timeScale: 1,
    mixDuration: 0.12,
    profile: 'pc',
    skin: 'default',
    equipped: new Set(character.SPINE_SLOT_IDS),
    flags: { mounted: false, swordInHand: false, swordFlying: false, hoodedHeadwear: false, longRobe: false },
    drawnInEight: null,
    scrub: null,
  };
}

/** The Spine slot ids shown as toggles (13); the 2 orbit sprite nodes live outside the skeleton. */
export const SPINE_SLOTS: readonly SlotId[] = character.SPINE_SLOT_IDS;

export function viewStateFor(s: ViewerSettings, which: 'A' | 'B'): character.CharacterViewState {
  return character.getCharacterViewState({
    kind: 'player',
    direction: s.direction,
    equipped: s.equipped,
    animation: which === 'A' || !s.compare ? s.animation : s.animationB,
    ...(s.drawnInEight === null ? {} : { drawnInEight: s.drawnInEight }),
    paperdoll: {
      mounted: s.flags.mounted,
      swordInHand: s.flags.swordInHand,
      swordFlying: s.flags.swordFlying,
      hoodedHeadwear: s.flags.hoodedHeadwear,
      longRobe: s.flags.longRobe,
    },
    profile: s.profile,
  });
}

/** Slots whose attachment must be hidden (not equipped, or hidden by a conflict rule). */
export function hiddenSpineSlots(view: character.CharacterViewState): Set<SlotId> {
  const visible = new Set(view.visibleSlots.map((r) => r.slot));
  return new Set(SPINE_SLOTS.filter((sl) => !visible.has(sl)));
}

/**
 * Compare the draw order the paperdoll table prescribes for the requested direction with the setup order of the
 * rig that is actually played (mirrored directions reuse another direction's rig). Returns slots whose position differs.
 */
export function drawOrderDelta(view: character.CharacterViewState, rigSlotOrder: readonly string[]): string[] {
  const want = view.slotOrder;
  const out: string[] = [];
  for (let i = 0; i < want.length; i++) if (rigSlotOrder[i] !== want[i]) out.push(want[i]!);
  return out;
}

export const ALL_DIRECTIONS: readonly Direction[] = shared.DIRECTIONS;
export const ANIMATION_IDS: readonly AnimationId[] = character.ANIMATIONS.map((a) => a.id);
