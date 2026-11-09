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
