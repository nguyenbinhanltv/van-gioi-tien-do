import { describe, expect, it } from 'vitest';
import { createImage, type Image } from '@vgtd/rig';
import {
  extractWeaponLayer,
  qualityGlowLayer,
  validateBacklog,
  emptyBacklog,
  type ExtractionCell,
  type ExtractionThresholds,
} from '../src/index.js';
const thresholds: ExtractionThresholds = {
  differenceThreshold: 1,
  maxOutsideChangedPixels: 0,
  maxInpaintAreaPixels: 16,
  maxReconstructionChangedPixels: 0,
  maxMatteError: 1,
  minWeaponPixels: 1,
  maxAnchorDistancePx: 12,
  anchorRadiusPx: 2,
};
const evidence = (point = { x: 30, y: 30 }): ExtractionCell => ({
  order: 'front',
  visibility: 'visible',
  attachment: 'held',
  requiredAnchors: ['hand_R'],
  anchors: [{ name: 'hand_R', source: point, body: point, weapon: { x: point.x + 1, y: point.y } }],
  inpaint: [],
  note: 'Reviewed synthetic hand/contact and weapon order',
});
function rect(image: Image, x0: number, y0: number, x1: number, y1: number, rgba: number[]) {
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) image.data.set(rgba, (y * image.width + x) * 4);
}
function cellFixture() {
  const body = createImage(64, 64);
  rect(body, 12, 12, 44, 52, [40, 80, 120, 255]);
  const full = structuredClone(body),
    matte = createImage(64, 64),
    expected = createImage(64, 64);
  // Independently calculated: red160-alpha over opaque(40,80,120) -> (175,30,45,255).
  rect(full, 30, 20, 38, 40, [175, 30, 45, 255]);
  rect(matte, 30, 20, 38, 40, [160, 160, 160, 255]);
  rect(expected, 30, 20, 38, 40, [160, 0, 0, 160]);
  return { body, full, matte, expected };
}
describe('difference-assisted weapon extraction', () => {
  it('recovers a semi-transparent foreground over opaque body using the reviewed matte', () => {
    const { full, body, matte, expected } = cellFixture();
    const result = extractWeaponLayer(full, body, matte, evidence(), thresholds, { clip: 'attack', frame: 0 });
    expect(result.findings).toEqual([]);
    expect(result.weapon).toEqual(expected);
    expect(result.recomposed).toEqual(full);
    expect(result.metrics.weaponPixels).toBe(160);
  });
  it('rejects wrong order, matte, outside repaint and shifted hand contacts as hard gates', () => {
    const { full, body, matte } = cellFixture();
    const wrongOrder = extractWeaponLayer(full, body, matte, { ...evidence(), order: 'back' }, thresholds, {
      clip: 'attack',
      frame: 0,
    });
    expect(wrongOrder.findings.some((f) => f.metric === 'reconstruction_changed_pixels')).toBe(true);
    const badMatte = structuredClone(matte);
    rect(badMatte, 30, 20, 38, 40, [32, 32, 32, 255]);
    expect(
      extractWeaponLayer(full, body, badMatte, evidence(), thresholds, { clip: 'attack', frame: 0 }).findings.some(
        (f) => f.metric === 'inconsistent_matte_pixels',
      ),
    ).toBe(true);
    const repaint = structuredClone(body);
    rect(repaint, 15, 15, 16, 16, [0, 0, 0, 255]);
    const result = extractWeaponLayer(
      full,
      repaint,
      matte,
      { ...evidence(), anchors: [{ ...evidence().anchors[0]!, body: { x: 15, y: 30 } }] },
      thresholds,
      { clip: 'attack', frame: 0 },
    );
    expect(result.findings.some((f) => f.metric === 'outside_changed_pixels')).toBe(true);
    expect(result.findings.some((f) => f.gate === 'handAlignment')).toBe(true);
    for (const f of result.findings)
      expect(() =>
        validateBacklog({
          ...emptyBacklog('test'),
          entries: [
            {
              clip: f.clip,
              dir: 'E',
              cell: 0,
              gate: f.gate,
              metric: f.metric!,
              value: f.value!,
              limit: f.limit!,
              note: 'cannot waive',
              status: 'open',
            },
          ],
        }),
      ).toThrow(/hard/);
  });
  it('bounds inpaint near reviewed anchors and reports deliberately detached contacts as unmeasured', () => {
    const { full, body, matte } = cellFixture();
    expect(() =>
      extractWeaponLayer(
        full,
        body,
        matte,
        { ...evidence(), inpaint: [{ x: 0, y: 0, width: 4, height: 4 }] },
        thresholds,
        { clip: 'attack', frame: 0 },
      ),
    ).toThrow(/reviewed contact anchors/);
    const inpaint = structuredClone(body);
    rect(inpaint, 29, 30, 30, 31, [50, 80, 120, 255]);
    expect(
      extractWeaponLayer(
        full,
        inpaint,
        matte,
        { ...evidence(), inpaint: [{ x: 28, y: 29, width: 3, height: 3 }] },
        thresholds,
        { clip: 'attack', frame: 0 },
      ).findings,
    ).toEqual([]);
    expect(
      extractWeaponLayer(full, full, matte, evidence(), thresholds, { clip: 'attack', frame: 0 }).findings.some(
        (f) => f.metric === 'visible_weapon_pixels',
      ),
    ).toBe(true);
    const detached = extractWeaponLayer(
      full,
      body,
      matte,
      {
        ...evidence(),
        attachment: 'detached',
        requiredAnchors: [],
        anchors: [],
        note: 'Reviewed thrown weapon; no hand contact',
      },
      thresholds,
      { clip: 'attack', frame: 0 },
    );
    expect(detached.findings).toEqual([
      expect.objectContaining({ gate: 'handAlignment', severity: 'info', measurement: 'unmeasured' }),
    ]);
    const glow = qualityGlowLayer(detached.weapon, 2);
    expect(glow.data[(30 * 64 + 29) * 4 + 3]).toBeGreaterThan(0);
    expect(glow.data[(30 * 64 + 33) * 4 + 3]).toBe(0);
    for (let i = 0; i < glow.data.length; i += 4)
      expect([...glow.data.subarray(i, i + 4)]).toEqual([
        glow.data[i + 3],
        glow.data[i + 3],
        glow.data[i + 3],
        glow.data[i + 3],
      ]);
  });
});
