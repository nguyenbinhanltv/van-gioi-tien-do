/**
 * Tutorial / FTUE steps (D105, docs/16): the ordered list of things a new player does between login and the first breakthrough,
 * tracked by the SERVER (apps/server/src/tutorial) from events it already owns, persisted per account, shown by the client as
 * non-blocking contextual hints. No quest system exists yet, so a step is "the server saw this happen", never "a quest said so".
 * Extends the client-side D84 first-session loop (`FIRST_SESSION`): same numbers, now authoritative and persisted.
 * All values are PLACEHOLDERS, cần game designer duyệt.
 *
 * The step ORDER is wire-stable: a step's index is its bit in `tutorial_state.done`; new steps are appended, never reordered.
 */
import { FIRST_SESSION } from './first-session.js';

export const TUTORIAL_STEPS = [
  // required: the way from login to the first breakthrough
  'move',
  'field',
  'skill',
  'kills',
  'loot',
  'meditate',
  'breakthrough',
  // optional tips (do not block completion): systems the doc wants introduced early
  'item',
  'chat',
  'party',
] as const;
export type TutorialStepId = (typeof TUTORIAL_STEPS)[number];

/** How many leading steps are required for completion (the rest are tips). */
export const TUTORIAL_REQUIRED_COUNT = 7;

export const TUTORIAL = {
  /** `move` is reached after walking this far (tiles, Chebyshev) from where the session started */
  moveTiles: 3,
  /** `kills` needs this many kills credited to the player (same number as the D84 loop) */
  killTarget: FIRST_SESSION.killTarget,
} as const;

/** `tutorial_state.flags` bits */
export const TUTORIAL_FLAG_SKIPPED = 1;
export const TUTORIAL_FLAG_COMPLETE = 2;

export const tutorialBit = (id: TutorialStepId): number => 1 << TUTORIAL_STEPS.indexOf(id);
/** bitmask with every required step set */
export const TUTORIAL_REQUIRED_MASK = (1 << TUTORIAL_REQUIRED_COUNT) - 1;
/** bitmask with every step set (what a valid `done` may contain) */
export const TUTORIAL_ALL_MASK = (1 << TUTORIAL_STEPS.length) - 1;
