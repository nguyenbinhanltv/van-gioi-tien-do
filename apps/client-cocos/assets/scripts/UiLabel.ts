import { Label } from 'cc';

/**
 * Draw-call budget (P1: <= 80, real measurements in docs/33): every Label with the default cache mode owns a private texture, so a HUD of
 * N labels is N draw calls. Setting a cache mode puts the glyphs in the engine's shared dynamic atlas, where neighbouring labels batch.
 *  - `static`  (BITMAP): whole strings are cached and the space of a replaced string is NEVER reclaimed. Only for text drawn from a small
 *                        fixed set (captions, key hints, class / skill initials, 'Dung / Stop' style button states).
 *  - `dynamic` (CHAR):   glyph by glyph (bounded: a few hundred glyphs): ANY text with numbers or names that change while playing (hp / mp,
 *                        damage numbers, cooldowns, counters, distances, stack sizes, toasts) so the shared
 *                        atlas does not fill with one-off strings.
 * Measured on 14 mobs + 20 NPC + combat HUD: all labels BITMAP = -21 draw calls (106 -> 86), CHAR only = -8.
 */
export function sharedAtlas(l: Label, kind: 'static' | 'dynamic' = 'static'): Label {
  l.cacheMode = kind === 'static' ? Label.CacheMode.BITMAP : Label.CacheMode.CHAR;
  return l;
}

/**
 * Font size every dynamic (CHAR cache) label is rasterised at. The engine keeps ONE letter atlas per font description (family + size),
 * so labels of different sizes are different textures and can never share a draw call: a HUD with 12, 14, 16, 18, 22 and 32 px
 * dynamic labels paid one draw call per size as soon as they were all on screen (cooldown digits, damage numbers, toast...). All
 * dynamic labels now use this one size and the node scale gives the visual size.
 */
export const DYN_FONT_PX = 24;

/**
 * A dynamic label (text that changes while playing: hp / mp, cooldowns, damage numbers, counters, toasts): CHAR cache mode on the
 * shared letter atlas at `DYN_FONT_PX`; the size it was created with (`l.fontSize`) becomes the node scale. Resize later with
 * `setDynamicSize` (a scale change: no relayout), never by assigning `fontSize`.
 */
export function dynamicLabel(l: Label): Label {
  if (l.cacheMode === Label.CacheMode.CHAR && l.fontSize === DYN_FONT_PX) return l; // already converted (idempotent)
  const px = l.fontSize;
  l.cacheMode = Label.CacheMode.CHAR;
  l.fontSize = DYN_FONT_PX;
  l.lineHeight = DYN_FONT_PX + 2;
  setDynamicSize(l, px);
  return l;
}

/** Visual size (px) of a dynamic label: node scale only. */
export function setDynamicSize(l: Label, px: number): void {
  const k = px / DYN_FONT_PX;
  l.node.setScale(k, k, 1);
}
