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
