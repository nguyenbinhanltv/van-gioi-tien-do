/**
 * Where the chat box sits on a touch screen (D87 review): the shared layout reserves the bottom-left corner for the floating joystick
 * (`joystick-zone`), so the touch chat strip follows the shared `chat-ticker` rect and is nudged up if that rect still touches the joystick
 * zone. Pure (no DOM): the Cocos ChatBox feeds it the viewport; tests prove the strip never intersects `joystick-zone`.
 */
import { AnchorLayout, DEFAULT_PROFILES, type AnchorLayoutOptions, type Insets } from './AnchorLayout.js';
import type { Rect } from '../input/types.js';

export interface TouchChatPlacement {
  /** the folded strip (CSS px, top-left origin); when opened the box grows UP from this rect's bottom edge */
  strip: Rect;
  /** the joystick zone of the same layout (the strip never intersects it) */
  joystick: Rect | null;
  /** logic-px to CSS-px scale of the layout */
  scale: number;
}

const intersects = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

export function touchChatPlacement(
  vw: number,
  vh: number,
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 },
): TouchChatPlacement {
  const opts: Required<AnchorLayoutOptions> = {
    refLandscape: [1280, 720],
    refPortrait: [720, 1280],
    userScale: 1,
    touchMargin: 16,
  };
  const res = AnchorLayout.compute(vw, vh, insets, 'touch', DEFAULT_PROFILES, opts);
  const joystick = res.rects.get('joystick-zone') ?? null;
  const ticker = res.rects.get('chat-ticker') ?? { x: res.safe.x, y: res.safe.y, w: 0, h: 0 };
  let strip: Rect = { ...ticker };
  if (joystick && intersects(strip, joystick)) strip = { ...strip, y: Math.max(res.safe.y, joystick.y - strip.h) };
  return { strip, joystick, scale: res.scale };
}

/** Logic-px height of one party-frame row (the frames show the OTHER members: at most PARTY.MAX_SIZE - 1 rows). */
export const PARTY_ROW_HEIGHT = 36;

export interface PartyFramesPlacement {
  /** top-left of the stack, CSS px */
  x: number;
  y: number;
  /** width of one row, CSS px */
  w: number;
  /** height of one row, CSS px */
  rowH: number;
  scale: number;
}

/**
 * Where the party frames (D93) stack: directly under the shared `player-frame` of the current profile (top-left, clear of the touch
 * joystick at the bottom-left and of the chat strip in the left-middle). `touch` picks the touch profile.
 */
export function partyFramesPlacement(
  vw: number,
  vh: number,
  touch: boolean,
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 },
): PartyFramesPlacement {
  const opts: Required<AnchorLayoutOptions> = {
    refLandscape: [1280, 720],
    refPortrait: [720, 1280],
    userScale: 1,
    touchMargin: 16,
  };
  const res = AnchorLayout.compute(vw, vh, insets, touch ? 'touch' : 'pointer', DEFAULT_PROFILES, opts);
  const pf = res.rects.get('player-frame') ?? { x: res.safe.x, y: res.safe.y, w: 0, h: 0 };
  const gap = Math.round(8 * res.scale);
  return { x: pf.x, y: pf.y + pf.h + gap, w: pf.w, rowH: Math.round(PARTY_ROW_HEIGHT * res.scale), scale: res.scale };
}

export interface TutorialHintPlacement {
  /** the card, CSS px */
  x: number;
  y: number;
  w: number;
  h: number;
  scale: number;
}

/** Where the tutorial hint card (D105) sits: the shared `tutorial-hint` widget of the current profile (top centre, under the target frame). */
export function tutorialHintPlacement(
  vw: number,
  vh: number,
  touch: boolean,
  insets: Insets = { top: 0, right: 0, bottom: 0, left: 0 },
): TutorialHintPlacement {
  const opts: Required<AnchorLayoutOptions> = {
    refLandscape: [1280, 720],
    refPortrait: [720, 1280],
    userScale: 1,
    touchMargin: 16,
  };
  const res = AnchorLayout.compute(vw, vh, insets, touch ? 'touch' : 'pointer', DEFAULT_PROFILES, opts);
  const r = res.rects.get('tutorial-hint') ?? { x: res.safe.x, y: res.safe.y, w: 0, h: 0 };
  return { ...r, scale: res.scale };
}
