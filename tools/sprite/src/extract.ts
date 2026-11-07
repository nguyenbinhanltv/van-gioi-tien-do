/** D45 difference-assisted weapon extraction from a reviewed body-only edit and weapon matte. */
import { createImage, type Image } from '@vgtd/rig';
import type { Finding } from './qa.js';

export interface ExtractionPoint {
  readonly x: number;
  readonly y: number;
}
export interface ExtractionRect extends ExtractionPoint {
  readonly width: number;
  readonly height: number;
}
export interface ExtractionAnchor {
  readonly name: string;
  readonly source: ExtractionPoint;
  readonly body: ExtractionPoint;
  readonly weapon?: ExtractionPoint;
}
export interface ExtractionCell {
  readonly order: 'front' | 'back';
  readonly visibility: 'visible' | 'hidden';
  readonly attachment: 'held' | 'ridden' | 'carried' | 'detached';
  readonly requiredAnchors: readonly string[];
  readonly anchors: readonly ExtractionAnchor[];
  /** Allowed hand/skin inpaint regions, not a general body repaint permission. */
  readonly inpaint: readonly ExtractionRect[];
  readonly note: string;
}
export interface ExtractionThresholds {
  readonly differenceThreshold: number;
  readonly maxOutsideChangedPixels: number;
  readonly maxInpaintAreaPixels: number;
  readonly maxReconstructionChangedPixels: number;
  readonly maxMatteError: number;
  readonly minWeaponPixels: number;
  readonly maxAnchorDistancePx: number;
  readonly anchorRadiusPx: number;
}
export interface ExtractionMetrics {
  readonly changedPixels: number;
  readonly outsideChangedPixels: number;
  readonly weaponPixels: number;
  readonly unchangedMattePixels: number;
  readonly inconsistentMattePixels: number;
  readonly reconstructionChangedPixels: number;
  readonly anchors: readonly {
    readonly name: string;
    readonly bodyDistancePx: number;
    readonly gripDistancePx: number | null;
  }[];
}
const difference = (a: Image, b: Image, i: number) =>
  Math.max(
    Math.abs(a.data[i]! - b.data[i]!),
    Math.abs(a.data[i + 1]! - b.data[i + 1]!),
    Math.abs(a.data[i + 2]! - b.data[i + 2]!),
    Math.abs(a.data[i + 3]! - b.data[i + 3]!),
  );
const inRect = (x: number, y: number, r: ExtractionRect) =>
  x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height;
const distance = (a: ExtractionPoint, b: ExtractionPoint) => Math.hypot(a.x - b.x, a.y - b.y);

export function validateExtractionThresholds(t: ExtractionThresholds): void {
  if (
    !t ||
    ![t.differenceThreshold, t.maxMatteError].every((n) => Number.isFinite(n) && n >= 0 && n <= 255) ||
    ![t.maxOutsideChangedPixels, t.maxReconstructionChangedPixels, t.maxInpaintAreaPixels].every(
      (n) => Number.isInteger(n) && n >= 0,
    ) ||
    !Number.isInteger(t.minWeaponPixels) ||
    t.minWeaponPixels < 1 ||
    !Number.isFinite(t.maxAnchorDistancePx) ||
    t.maxAnchorDistancePx < 0 ||
    !Number.isInteger(t.anchorRadiusPx) ||
    t.anchorRadiusPx < 1
  )
    throw new Error('extraction requires explicit finite QA thresholds');
}
function probe(image: Image, p: ExtractionPoint, radius: number): boolean {
  for (let y = Math.max(0, Math.floor(p.y - radius)); y <= Math.min(image.height - 1, Math.ceil(p.y + radius)); y++)
    for (let x = Math.max(0, Math.floor(p.x - radius)); x <= Math.min(image.width - 1, Math.ceil(p.x + radius)); x++)
      if (image.data[(y * image.width + x) * 4 + 3]! >= 128) return true;
  return false;
}
export function compositeLayers(body: Image, weapon: Image, order: 'front' | 'back'): Image {
  if (body.width !== weapon.width || body.height !== weapon.height) throw new Error('layer dimensions differ');
  const top = order === 'front' ? weapon : body,
    back = order === 'front' ? body : weapon,
    out = createImage(body.width, body.height);
  for (let i = 0; i < out.data.length; i += 4) {
    const inverse = 1 - top.data[i + 3]! / 255;
    for (let k = 0; k < 4; k++) out.data[i + k] = Math.round(top.data[i + k]! + back.data[i + k]! * inverse);
  }
  return out;
}

/** Matte is grayscale coverage (black/transparent=0), not an automatically inferred segmentation. */
export function extractWeaponLayer(
  full: Image,
  body: Image,
  matte: Image,
  e: ExtractionCell,
  t: ExtractionThresholds,
  context: { clip: string; frame: number },
) {
  validateExtractionThresholds(t);
  if ([body, matte].some((image) => image.width !== full.width || image.height !== full.height))
    throw new Error('extraction cells must have identical dimensions');
  const point = (p: ExtractionPoint | undefined) =>
    p && Number.isFinite(p.x) && Number.isFinite(p.y) && p.x >= 0 && p.y >= 0 && p.x < full.width && p.y < full.height;
  if (
    !['front', 'back'].includes(e.order) ||
    !['visible', 'hidden'].includes(e.visibility) ||
    !['held', 'ridden', 'carried', 'detached'].includes(e.attachment) ||
    !e.note?.trim() ||
    !Array.isArray(e.inpaint) ||
    !Array.isArray(e.anchors) ||
    !Array.isArray(e.requiredAnchors)
  )
    throw new Error('each extraction cell needs explicit order, visibility, attachment and reviewed evidence');
  if (
    e.inpaint.some(
      (r) =>
        !point(r) ||
        ![r.x, r.y, r.width, r.height].every(Number.isInteger) ||
        !Number.isFinite(r.width) ||
        !Number.isFinite(r.height) ||
        r.width <= 0 ||
        r.height <= 0 ||
        r.x + r.width > full.width ||
        r.y + r.height > full.height,
    )
  )
    throw new Error('inpaint region outside source cell');
  if (
    e.inpaint.reduce((sum, r) => sum + r.width * r.height, 0) > t.maxInpaintAreaPixels ||
    e.inpaint.some((r) => !e.anchors.some((a) => point(a.body) && inRect(a.body.x, a.body.y, r)))
  )
    throw new Error('inpaint must stay within the declared area budget around reviewed contact anchors');
  if (
    new Set(e.anchors.map((a) => a.name)).size !== e.anchors.length ||
    new Set(e.requiredAnchors).size !== e.requiredAnchors.length ||
    e.requiredAnchors.some((name) => !e.anchors.some((a) => a.name === name))
  )
    throw new Error('required extraction anchors missing or repeated');
  if (e.attachment === 'detached' ? e.anchors.length > 0 || e.requiredAnchors.length > 0 : !e.requiredAnchors.length)
    throw new Error('attached weapons need declared contact anchors; detached cells must be explicitly unmeasured');
  if (e.attachment === 'held' && !e.requiredAnchors.some((name) => /^hand_[LR]$/.test(name)))
    throw new Error('held weapons require hand anchors');
  if (e.attachment === 'ridden' && !e.requiredAnchors.some((name) => /^foot_[LR]$/.test(name)))
    throw new Error('ridden weapons require foot anchors');
  const findings: Finding[] = [];
  const fail = (
    gate: 'weaponExtraction' | 'handAlignment',
    metric: string,
    value: number,
    limit: number,
    message: string,
  ) => findings.push({ gate, severity: 'fail', ...context, metric, value, limit, message });
  const weapon = createImage(full.width, full.height);
  if (!body.data.some((value, i) => i % 4 === 3 && value > 0))
    fail('weaponExtraction', 'missing_body_pixels', 1, 0, 'body-only edit is empty');
  let changedPixels = 0,
    outsideChangedPixels = 0,
    weaponPixels = 0,
    unchangedMattePixels = 0,
    inconsistentMattePixels = 0;
  for (let y = 0; y < full.height; y++)
    for (let x = 0; x < full.width; x++) {
      const i = (y * full.width + x) * 4;
      if (matte.data[i] !== matte.data[i + 1] || matte.data[i] !== matte.data[i + 2])
        throw new Error('weapon matte must be grayscale');
      const coverage = matte.data[i]! / 255,
        changed = difference(full, body, i) > t.differenceThreshold;
      if (!changed) {
        if (coverage > 0) unchangedMattePixels++;
        continue;
      }
      changedPixels++;
      if (!coverage) {
        if (!e.inpaint.some((r) => inRect(x, y, r))) outsideChangedPixels++;
        continue;
      }
      const ba = body.data[i + 3]! / 255,
        fa = full.data[i + 3]! / 255;
      const alpha = ba < 1 ? Math.max(0, Math.min(1, (fa - ba) / (1 - ba))) : coverage;
      let inconsistent = Math.abs((alpha + ba * (1 - alpha) - fa) * 255) > t.maxMatteError;
      for (let k = 0; k < 3; k++) {
        const value = full.data[i + k]! - body.data[i + k]! * (1 - alpha),
          clamped = Math.max(0, Math.min(255 * alpha, value));
        if (Math.abs(value - clamped) > t.maxMatteError) inconsistent = true;
        weapon.data[i + k] = Math.round(clamped);
      }
      weapon.data[i + 3] = Math.round(alpha * 255);
      if (inconsistent) inconsistentMattePixels++;
      if (weapon.data[i + 3]! > 0) weaponPixels++;
    }
  const recomposed = compositeLayers(body, weapon, e.order);
  let reconstructionChangedPixels = 0;
  for (let y = 0; y < full.height; y++)
    for (let x = 0; x < full.width; x++)
      if (
        !e.inpaint.some((r) => inRect(x, y, r)) &&
        difference(full, recomposed, (y * full.width + x) * 4) > t.differenceThreshold
      )
        reconstructionChangedPixels++;
  if (outsideChangedPixels > t.maxOutsideChangedPixels)
    fail(
      'weaponExtraction',
      'outside_changed_pixels',
      outsideChangedPixels,
      t.maxOutsideChangedPixels,
      'body-removal edit repainted outside weapon matte/inpaint regions',
    );
  if (inconsistentMattePixels)
    fail(
      'weaponExtraction',
      'inconsistent_matte_pixels',
      inconsistentMattePixels,
      0,
      'matte is inconsistent with source/body premultiplied colours or opacity',
    );
  if (reconstructionChangedPixels > t.maxReconstructionChangedPixels)
    fail(
      'weaponExtraction',
      'reconstruction_changed_pixels',
      reconstructionChangedPixels,
      t.maxReconstructionChangedPixels,
      'body/weapon recomposition differs from source; check matte and front/back order',
    );
  if (e.visibility === 'visible' && weaponPixels < t.minWeaponPixels)
    fail(
      'weaponExtraction',
      'visible_weapon_pixels',
      weaponPixels,
      t.minWeaponPixels,
      'weapon-removal edit yielded too few weapon pixels',
    );
  if (e.visibility === 'hidden' && weaponPixels)
    fail(
      'weaponExtraction',
      'hidden_weapon_pixels',
      weaponPixels,
      0,
      'hidden weapon declaration has visible extracted pixels',
    );
  const anchors = e.anchors.map((a) => {
    if (!a.name?.trim() || !point(a.source) || !point(a.body) || (a.weapon !== undefined && !point(a.weapon)))
      throw new Error('invalid extraction contact landmarks');
    const bodyDistancePx = distance(a.source, a.body),
      gripDistancePx = a.weapon ? distance(a.body, a.weapon) : null;
    if (bodyDistancePx > t.maxAnchorDistancePx)
      fail(
        'handAlignment',
        'body_anchor_distance_px',
        bodyDistancePx,
        t.maxAnchorDistancePx,
        `${a.name}: hand/contact moved in body-removal edit`,
      );
    if (!probe(full, a.source, t.anchorRadiusPx) || !probe(body, a.body, t.anchorRadiusPx))
      fail(
        'handAlignment',
        'missing_body_anchor',
        1,
        0,
        `${a.name}: source/body lacks opaque pixels near the reviewed contact`,
      );
    if (e.visibility === 'visible') {
      if (!a.weapon)
        fail(
          'handAlignment',
          'missing_weapon_grip',
          1,
          0,
          `${a.name}: visible weapon needs a reviewed grip/contact point`,
        );
      else {
        if (gripDistancePx! > t.maxAnchorDistancePx)
          fail(
            'handAlignment',
            'weapon_grip_distance_px',
            gripDistancePx!,
            t.maxAnchorDistancePx,
            `${a.name}: weapon grip is detached from the body contact`,
          );
        if (!probe(weapon, a.weapon, t.anchorRadiusPx))
          fail(
            'handAlignment',
            'missing_weapon_grip_pixels',
            1,
            0,
            `${a.name}: extracted weapon lacks opaque pixels near the grip`,
          );
      }
    }
    return { name: a.name, bodyDistancePx, gripDistancePx };
  });
  if (e.attachment === 'detached')
    findings.push({
      gate: 'handAlignment',
      severity: 'info',
      ...context,
      measurement: 'unmeasured',
      message: `detached weapon, contact unmeasured: ${e.note}`,
    });
  const metrics: ExtractionMetrics = {
    changedPixels,
    outsideChangedPixels,
    weaponPixels,
    unchangedMattePixels,
    inconsistentMattePixels,
    reconstructionChangedPixels,
    anchors,
  };
  return { body, weapon, recomposed, metrics, findings };
}

/** Neutral white halo; six quality colours remain a runtime tint, never six redrawn sheets. */
export function qualityGlowLayer(weapon: Image, radius: number): Image {
  if (!Number.isInteger(radius) || radius < 1 || radius > Math.min(weapon.width, weapon.height) / 2)
    throw new Error('glow radius must be a positive integer fitting the cell');
  const out = createImage(weapon.width, weapon.height),
    alpha = new Uint8ClampedArray(weapon.width * weapon.height);
  for (let y = 0; y < weapon.height; y++)
    for (let x = 0; x < weapon.width; x++) {
      const a = weapon.data[(y * weapon.width + x) * 4 + 3]!;
      if (!a) continue;
      for (let dy = -radius; dy <= radius; dy++)
        for (let dx = -radius; dx <= radius; dx++) {
          const xx = x + dx,
            yy = y + dy,
            d = Math.hypot(dx, dy);
          if (xx < 0 || yy < 0 || xx >= weapon.width || yy >= weapon.height || d > radius) continue;
          const i = yy * weapon.width + xx;
          alpha[i] = Math.max(alpha[i]!, Math.round(a * (1 - d / (radius + 1))));
        }
    }
  for (let i = 0; i < alpha.length; i++) {
    const a = Math.max(0, alpha[i]! - weapon.data[i * 4 + 3]!);
    out.data.set([a, a, a, a], i * 4);
  }
  return out;
}
