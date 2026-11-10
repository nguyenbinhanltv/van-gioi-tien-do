/**
 * Mob element (Ngũ hành) on the client (D120), engine-free: the wire code `EnterEntity.element` -> element id, the short glyph shown next to the
 * mob's name, and the subtle tint of its standee. The tint is a plain sprite colour (no extra material, so the draw-call gate is untouched):
 * white pulled a little towards the element colour the renderer passes in.
 */
import { elementOfWireId, type Element } from '@vgtd/shared';
import { t, type StringKey } from '../i18n/strings.js';

/** Glyph key per element (literals so the i18n guard sees every key in use). */
const GLYPH_KEYS: Readonly<Record<Element, StringKey>> = {
  kim: 'element.kim',
  moc: 'element.moc',
  thuy: 'element.thuy',
  hoa: 'element.hoa',
  tho: 'element.tho',
};

/** How far white is pulled towards the element colour (0 = none, 1 = the full colour): subtle on purpose, the art stays readable. */
export const MOB_ELEMENT_TINT_STRENGTH = 0.22;

/** Element of a monster from the wire code (0 / absent / unknown = null). */
export function mobElementOf(wire: number | undefined): Element | null {
  return wire ? elementOfWireId(wire) : null;
}

/** Short glyph of an element ("KIM", "MỘC", ...), '' for none. */
export function mobElementGlyph(el: Element | null): string {
  return el ? t(GLYPH_KEYS[el]) : '';
}

/** `[KIM] Name` for a mob with an element, `Name` without one. */
export function mobNameWithElement(name: string, el: Element | null): string {
  return el ? `${t('element.badge', { glyph: mobElementGlyph(el) })} ${name}` : name;
}

/** Sprite colour (r, g, b 0-255) of a standee of an element whose colour is `rgb`: white mixed towards it by `MOB_ELEMENT_TINT_STRENGTH`. */
export function mobElementTint(rgb: readonly [number, number, number] | null): [number, number, number] {
  if (!rgb) return [255, 255, 255];
  const k = MOB_ELEMENT_TINT_STRENGTH;
  return [0, 1, 2].map((c) => Math.round(255 + (rgb[c]! - 255) * k)) as [number, number, number];
}
