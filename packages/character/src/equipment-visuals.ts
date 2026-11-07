/** D44/D45 appearance selection only. No ownership, pricing or combat statistics. Browser-safe. */
import { QUALITY_TIERS, type QualityId } from '@vgtd/shared';

export const VISUAL_TIERS = ['T1', 'T2', 'T3', 'T4', 'T5'] as const;
export type VisualTier = (typeof VISUAL_TIERS)[number];
/** Normalized RGBA; canonical UI quality colours are supplied by the content mapping. */
export type VisualTint = readonly [number, number, number, number];
export interface EquipmentVisualMapping {
  readonly format: 'vgtd-equipment-visuals';
  readonly version: 1;
  readonly tiers: Readonly<
    Record<
      VisualTier,
      { readonly body: string; readonly weapon: string; readonly fx: string | null; readonly aura: string | null }
    >
  >;
  readonly costumes: Readonly<Record<string, { readonly body: string }>>;
  readonly weaponSkins: Readonly<Record<string, { readonly weapon: string }>>;
  readonly qualityGlow: Readonly<Record<QualityId, VisualTint>>;
}
export interface EquipmentAppearance {
  readonly tier: VisualTier;
  readonly quality: QualityId;
  readonly costume?: string | null;
  readonly weaponSkin?: string | null;
  readonly hideCostume?: boolean;
}
export interface ResolvedEquipmentVisuals {
  readonly bodySet: string;
  readonly weaponSet: string;
  readonly fxSet: string | null;
  readonly aura: string | null;
  readonly quality: QualityId;
  readonly glowTint: VisualTint;
}

export function assertVisualSetId(id: string): void {
  if (typeof id !== 'string' || !/^[A-Za-z0-9_-]+$/.test(id)) throw new Error(`invalid visual set id '${id}'`);
}
export function validateEquipmentVisualMapping(mapping: EquipmentVisualMapping): void {
  if (mapping.format !== 'vgtd-equipment-visuals' || mapping.version !== 1)
    throw new Error('invalid equipment visual mapping');
  for (const tier of VISUAL_TIERS) {
    const v = mapping.tiers?.[tier];
    if (!v || v.fx === undefined || v.aura === undefined) throw new Error(`missing visual tier '${tier}'`);
    assertVisualSetId(v.body);
    assertVisualSetId(v.weapon);
    if (v.fx !== null) assertVisualSetId(v.fx);
    if (v.aura !== null) assertVisualSetId(v.aura);
  }
  for (const quality of QUALITY_TIERS) {
    const tint = mapping.qualityGlow?.[quality.id];
    if (!Array.isArray(tint) || tint.length !== 4 || tint.some((n) => !Number.isFinite(n) || n < 0 || n > 1))
      throw new Error(`missing/invalid glow tint '${quality.id}'`);
  }
  if (!mapping.costumes || !mapping.weaponSkins) throw new Error('cosmetic mapping records are required');
  for (const [id, costume] of Object.entries(mapping.costumes)) {
    assertVisualSetId(id);
    assertVisualSetId(costume.body);
  }
  for (const [id, skin] of Object.entries(mapping.weaponSkins)) {
    assertVisualSetId(id);
    assertVisualSetId(skin.weapon);
  }
}

/** Hide-costume changes the body only; equipped weapon skins and tier FX remain independent. */
export function resolveEquipmentVisuals(
  mapping: EquipmentVisualMapping,
  appearance: EquipmentAppearance,
): ResolvedEquipmentVisuals {
  validateEquipmentVisualMapping(mapping);
  if (!VISUAL_TIERS.includes(appearance.tier)) throw new Error('unknown visual tier');
  if (!QUALITY_TIERS.some((q) => q.id === appearance.quality)) throw new Error('unknown quality');
  const tier = mapping.tiers[appearance.tier];
  let body = tier.body,
    weapon = tier.weapon;
  if (!appearance.hideCostume && appearance.costume) {
    const costume = Object.prototype.hasOwnProperty.call(mapping.costumes, appearance.costume)
      ? mapping.costumes[appearance.costume]
      : undefined;
    if (!costume) throw new Error(`unknown costume '${appearance.costume}'`);
    body = costume.body;
  }
  if (appearance.weaponSkin) {
    const skin = Object.prototype.hasOwnProperty.call(mapping.weaponSkins, appearance.weaponSkin)
      ? mapping.weaponSkins[appearance.weaponSkin]
      : undefined;
    if (!skin) throw new Error(`unknown weapon skin '${appearance.weaponSkin}'`);
    weapon = skin.weapon;
  }
  return {
    bodySet: body,
    weaponSet: weapon,
    fxSet: tier.fx,
    aura: tier.aura,
    quality: appearance.quality,
    glowTint: [...mapping.qualityGlow[appearance.quality]],
  };
}
