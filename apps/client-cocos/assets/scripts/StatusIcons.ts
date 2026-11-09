import type { SpriteFrame } from 'cc';

/**
 * Status icon hook (D94): `getStatusIcon('root')` -> SpriteFrame or null. Ids are the `StatusRowItem.id` of client-core: 'root' | 'slow' |
 * 'poison' | 'shield'. Returns null until the owner's Gemini status icons exist (same fallback pattern as `getSkillIcon`): the HUD then
 * draws the text glyph. When the art lands, only this function changes (look the frame up in the atlas by id).
 */
export function getStatusIcon(_id: string): SpriteFrame | null {
  return null;
}
