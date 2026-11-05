import { describe, expect, it } from 'vitest';
import {
  DROP_TABLE,
  QUALITY_DISTRIBUTION,
  SINK_TARGETS,
  blueprintPityChance,
  depletionFactor,
  directTradeTax,
  durabilityLoss,
  expectedStoneValue,
  listingFee,
  lowRealmFactor,
  marketSaleTax,
  partyFactor,
  repairCost,
  sellerProceeds,
  stoneRealmMultiplier,
  teleportFee,
} from '../src/index.js';

describe('Công thức §6 — drops', () => {
  it('expected Linh thạch per kill: field 1.2, elite 26.5, boss chest 1,610 (hạ phẩm)', () => {
    expect(expectedStoneValue('field')).toBeCloseTo(0.35 * 2 + 0.005 * 100, 10);
    expect(expectedStoneValue('field')).toBeCloseTo(1.2, 10);
    expect(expectedStoneValue('elite')).toBeCloseTo(8.5 + 0.08 * 100 + 0.001 * 10_000, 10);
    expect(expectedStoneValue('elite')).toBeCloseTo(26.5, 10);
    expect(expectedStoneValue('boss')).toBeCloseTo(60 + 3.5 * 100 + 0.12 * 10_000, 10);
    expect(expectedStoneValue('boss')).toBeCloseTo(1610, 10);
  });

  it('expected per hour: field 150/h → 180, elite 20/h → 530', () => {
    expect(150 * expectedStoneValue('field')).toBeCloseTo(180, 10);
    expect(20 * expectedStoneValue('elite')).toBeCloseTo(530, 10);
  });

  it('quality distribution rows sum to 1', () => {
    for (const src of ['field', 'elite', 'boss'] as const) {
      expect(QUALITY_DISTRIBUTION[src].reduce((a, b) => a + b, 0), src).toBeCloseTo(1, 12);
      expect(QUALITY_DISTRIBUTION[src]).toHaveLength(6);
    }
  });

  it('table spot checks', () => {
    expect(DROP_TABLE.boss.breakthrough_pill?.p).toBe(0.06);
    expect(DROP_TABLE.elite.stone_thuong?.p).toBe(0.001);
    expect(DROP_TABLE.field.stone_thuong).toBeUndefined();
    expect(DROP_TABLE.boss.blueprint_gold_red?.p).toBe(0.002);
  });

  it('modifiers: stones ×1.5^(r−1); 1 realm lower ×0.2; ≥2 lower materials only; depletion ×0.5 after 2 h', () => {
    expect(stoneRealmMultiplier(1)).toBe(1);
    expect(stoneRealmMultiplier(3)).toBeCloseTo(2.25, 12);
    expect(lowRealmFactor(0)).toBe(1);
    expect(lowRealmFactor(1)).toBe(0.2);
    expect(lowRealmFactor(2)).toBeNull();
    expect(depletionFactor(2)).toBe(1);
    expect(depletionFactor(2.1)).toBe(0.5);
  });

  it('party: 1/√n each; party of 4 → 0.5 each, total 2× solo', () => {
    expect(partyFactor(1)).toBe(1);
    expect(partyFactor(4)).toBeCloseTo(0.5, 12);
    expect(4 * partyFactor(4)).toBeCloseTo(2, 12);
  });

  it('blueprint pity: p(n) = 0.002·(1 + 0.15n), guaranteed at n = 30', () => {
    expect(blueprintPityChance(0)).toBeCloseTo(0.002, 12);
    expect(blueprintPityChance(10)).toBeCloseTo(0.002 * 2.5, 12);
    expect(blueprintPityChance(29)).toBeCloseTo(0.002 * (1 + 0.15 * 29), 12);
    expect(blueprintPityChance(30)).toBe(1);
    expect(blueprintPityChance(31)).toBe(1);
  });
});

describe('Công thức §7 — anti-inflation sinks', () => {
  it('market tax: clamp(0.05 + 0.5·max(0, CPI − 1.02), 5%, 10%); CPI +8% → 8%', () => {
    expect(marketSaleTax(1.08)).toBeCloseTo(0.08, 12);
    expect(marketSaleTax(1.0)).toBe(0.05);
    expect(marketSaleTax(1.02)).toBe(0.05);
    expect(marketSaleTax(0.9)).toBe(0.05);
    expect(marketSaleTax(1.5)).toBe(0.1);
  });

  it('listing 1% (min 1 hạ phẩm, non-refundable); direct trade 3%; seller proceeds net of τ', () => {
    expect(listingFee(1000)).toBe(10);
    expect(listingFee(10)).toBe(1);
    expect(listingFee(50)).toBe(1);
    expect(directTradeTax(1000)).toBe(30);
    expect(sellerProceeds(1000, marketSaleTax(1.08))).toBeCloseTo(920, 8);
  });

  it('teleport fee 20·1.5^(r−1)·(1+0.5d): Luyện Khí same zone 20; Hóa Thần 2 zones 203; Độ Kiếp 3 zones 1,281', () => {
    expect(teleportFee(1, 0)).toBe(20);
    expect(Math.round(teleportFee(5, 2))).toBe(203);
    expect(Math.round(teleportFee(9, 3))).toBe(1281);
  });

  it('teleport fee as share of 1 h field farming: 11% / 22% / 28%', () => {
    const farmPerHour = (r: number) => 150 * expectedStoneValue('field') * stoneRealmMultiplier(r);
    expect(teleportFee(1, 0) / farmPerHour(1)).toBeCloseTo(0.11, 2);
    expect(teleportFee(5, 2) / farmPerHour(5)).toBeCloseTo(0.22, 2);
    expect(teleportFee(9, 3) / farmPerHour(9)).toBeCloseTo(0.28, 2);
  });

  it('durability: PvE death −8%, PvP −4%, tribulation −15%, Ma đạo ×1.5', () => {
    expect(durabilityLoss('death_pve')).toBe(0.08);
    expect(durabilityLoss('death_pvp')).toBe(0.04);
    expect(durabilityLoss('death_tribulation')).toBe(0.15);
    expect(durabilityLoss('death_pve', true)).toBeCloseTo(0.12, 12);
  });

  it('repair: 0.4% of item value per 1%; 0 → 100% costs 40%', () => {
    expect(repairCost(1000, 1)).toBeCloseTo(4, 12);
    expect(repairCost(1000, 100)).toBeCloseTo(400, 12);
  });

  it('sink targets sum to 100%', () => {
    expect(Object.values(SINK_TARGETS).reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });
});
