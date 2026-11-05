import { describe, expect, it } from 'vitest';
import { DIRECTIONS, type Direction } from '@vgtd/shared';
import {
  ASYMMETRIC_CANDIDATE_SLOTS,
  DRAW_ORDER,
  MAX_DRAW_CALLS_PER_CHARACTER,
  PAPERDOLL_LAYER_COUNT,
  PAPERDOLL_SLOTS,
  SLOT_IDS,
  SPINE_SLOT_COUNT,
  SPRITE_NODE_SLOT_COUNT,
  checkRepack,
  checkRepackAllDirections,
  drawOrderFor,
  orbitLayerFor,
  resolvePaperdoll,
  slotsInDrawOrder,
  type PackedAttachment,
  type SlotId,
} from '../src/index.js';

/** The table of docs/03 §2, copied verbatim (columns S SE E NE N NW W SW). */
const SPEC_TABLE = `
orbit_back   | 1  | 1  | 1  | 1  | 1  | 1  | 1  | 1
wing         | 2  | 2  | 2  | 14 | 14 | 14 | 2  | 2
cape         | 3  | 3  | 3  | 13 | 13 | 13 | 3  | 3
sword_back   | 4  | 4  | 4  | 12 | 12 | 12 | 4  | 4
hair_back    | 5  | 6  | 6  | 8  | 10 | 9  | 7  | 7
body         | 6  | 7  | 7  | 3  | 5  | 4  | 8  | 8
outfit_lower | 7  | 8  | 8  | 4  | 6  | 5  | 9  | 9
outfit_upper | 8  | 9  | 9  | 5  | 7  | 6  | 10 | 10
head         | 9  | 10 | 10 | 6  | 8  | 7  | 11 | 11
hair_front   | 10 | 11 | 11 | 7  | 9  | 8  | 12 | 12
headwear     | 11 | 12 | 12 | 9  | 11 | 10 | 13 | 13
arm_L        | 12 | 5  | 5  | 2  | 3  | 11 | 14 | 14
arm_R        | 13 | 13 | 13 | 10 | 4  | 3  | 6  | 6
weapon_R     | 14 | 14 | 14 | 11 | 2  | 2  | 5  | 5
orbit_front  | 15 | 15 | 15 | 15 | 15 | 15 | 15 | 15
`;
const specRows = SPEC_TABLE.trim()
  .split('\n')
  .map((l) => l.split('|').map((c) => c.trim()));

const SPINE_SLOTS = SLOT_IDS.filter((s) => s !== 'orbit_back' && s !== 'orbit_front');

describe('15 layers', () => {
  it('13 Spine slots + 2 sprite-node orbit layers', () => {
    expect(PAPERDOLL_SLOTS).toHaveLength(PAPERDOLL_LAYER_COUNT);
    expect(PAPERDOLL_SLOTS.filter((s) => s.form === 'spine')).toHaveLength(SPINE_SLOT_COUNT);
    expect(PAPERDOLL_SLOTS.filter((s) => s.form === 'sprite_node').map((s) => s.id)).toEqual([
      'orbit_back',
      'orbit_front',
    ]);
    expect(SPRITE_NODE_SLOT_COUNT).toBe(2);
  });
});

describe('Draw Order table', () => {
  it('reproduces every cell of the spec table', () => {
    expect(specRows).toHaveLength(15);
    for (const [slot, ...vals] of specRows) {
      DIRECTIONS.forEach((d, i) => {
        expect(DRAW_ORDER[slot as SlotId][d], `${slot} @ ${d}`).toBe(Number(vals[i]));
      });
    }
  });

  it('each direction is a permutation of 1..15', () => {
    for (const d of DIRECTIONS) {
      const orders = SLOT_IDS.map((s) => DRAW_ORDER[s][d]).sort((a, b) => a - b);
      expect(orders).toEqual(Array.from({ length: 15 }, (_, i) => i + 1));
    }
  });

  it('orbit_back is always first and orbit_front always last', () => {
    for (const d of DIRECTIONS) {
      expect(slotsInDrawOrder(d)[0]).toBe('orbit_back');
      expect(slotsInDrawOrder(d)[14]).toBe('orbit_front');
    }
  });

  it('weapon_R is in front of body at S, SE, E, NE and behind it at N, NW, W, SW', () => {
    const front: Direction[] = ['S', 'SE', 'E', 'NE'];
    for (const d of DIRECTIONS) {
      const o = drawOrderFor(d);
      expect(o.weapon_R > o.body, d).toBe(front.includes(d));
    }
  });

  it('W is not E mirrored: its preset differs from E', () => {
    expect(drawOrderFor('W')).not.toEqual(drawOrderFor('E'));
    expect(drawOrderFor('SW')).toEqual(drawOrderFor('W'));
  });

  it('back-facing directions (NE, N, NW) move wing, cape, sword_back to the top (12–14)', () => {
    for (const d of ['NE', 'N', 'NW'] as const) {
      expect(DRAW_ORDER.wing[d]).toBe(14);
      expect(DRAW_ORDER.cape[d]).toBe(13);
      expect(DRAW_ORDER.sword_back[d]).toBe(12);
    }
    for (const d of ['S', 'SE', 'E', 'W', 'SW'] as const) {
      expect([DRAW_ORDER.wing[d], DRAW_ORDER.cape[d], DRAW_ORDER.sword_back[d]]).toEqual([2, 3, 4]);
    }
  });
});

describe('resolvePaperdoll', () => {
  it('full outfit at S gives the S draw order (Spine slots only)', () => {
    const r = resolvePaperdoll('S', SPINE_SLOTS);
    expect(r.ordered.map((x) => x.slot)).toEqual([
      'wing',
      'cape',
      'sword_back',
      'hair_back',
      'body',
      'outfit_lower',
      'outfit_upper',
      'head',
      'hair_front',
      'headwear',
      'arm_L',
      'arm_R',
      'weapon_R',
    ]);
    expect(r.ordered.map((x) => x.order)).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
  });

  it('body is always present', () => {
    expect(resolvePaperdoll('N', []).ordered.map((x) => x.slot)).toEqual(['body']);
  });

  it('N: weapon_R and arms draw behind the body', () => {
    const r = resolvePaperdoll('N', ['arm_L', 'arm_R', 'weapon_R', 'head']).ordered.map((x) => x.slot);
    expect(r).toEqual(['weapon_R', 'arm_L', 'arm_R', 'body', 'head']);
  });

  it('mirrored W keeps the W preset but flags weapon_R as flipped variant', () => {
    const r = resolvePaperdoll('W', ['weapon_R', 'outfit_upper'], { mirrored: true });
    expect(r.ordered.map((x) => x.slot)).toEqual(['weapon_R', 'body', 'outfit_upper']);
    expect(r.ordered.find((x) => x.slot === 'weapon_R')!.variants).toContain('mirrored');
    expect(r.ordered.find((x) => x.slot === 'outfit_upper')!.variants).toEqual([]);
    const r2 = resolvePaperdoll('W', ['weapon_R', 'outfit_upper'], {
      mirrored: true,
      asymmetricSlots: ['outfit_upper'],
    });
    expect(r2.ordered.find((x) => x.slot === 'outfit_upper')!.variants).toEqual(['mirrored']);
    const r3 = resolvePaperdoll('E', ['weapon_R'], { mirrored: false });
    expect(r3.ordered.find((x) => x.slot === 'weapon_R')!.variants).toEqual([]);
    expect(ASYMMETRIC_CANDIDATE_SLOTS).toContain('hair_front');
  });

  it('conflict rules', () => {
    expect(resolvePaperdoll('S', ['wing'], { mounted: true }).hidden).toEqual([{ slot: 'wing', reason: 'mounted' }]);
    expect(resolvePaperdoll('S', ['sword_back'], { swordInHand: true }).hidden[0]?.reason).toBe('sword_in_hand');
    expect(resolvePaperdoll('S', ['sword_back'], { swordFlying: true }).hidden[0]?.reason).toBe('sword_flying');
    const hood = resolvePaperdoll('S', ['headwear', 'hair_front', 'hair_back'], { hoodedHeadwear: true });
    expect(hood.ordered.map((x) => x.slot)).not.toContain('hair_front');
    expect(hood.hidden).toEqual([{ slot: 'hair_front', reason: 'hood' }]);
    // headwear selects the under-hat hair variant
    const hat = resolvePaperdoll('S', ['headwear', 'hair_front', 'hair_back']);
    expect(hat.ordered.find((x) => x.slot === 'hair_back')!.variants).toContain('under_hat');
    expect(hat.ordered.find((x) => x.slot === 'hair_front')!.variants).toContain('under_hat');
    // a long robe occupies both outfit slots
    const robe = resolvePaperdoll('S', ['outfit_upper'], { longRobe: true });
    expect(robe.ordered.map((x) => x.slot)).toEqual(expect.arrayContaining(['outfit_upper', 'outfit_lower']));
  });

  it('orbit layer follows the orbit position: above → back, below → front', () => {
    expect(orbitLayerFor(-9)).toBe('orbit_back');
    expect(orbitLayerFor(9)).toBe('orbit_front');
  });
});

describe('repack: ≤ 2 draw calls per character', () => {
  const full: PackedAttachment[] = SPINE_SLOTS.map((slot) => ({ slot, width: 300, height: 100 }));

  it('rule constant is 2', () => {
    expect(MAX_DRAW_CALLS_PER_CHARACTER).toBe(2);
  });

  it('a full outfit incl. additive wing is 2 calls in every direction and fits one 1024 texture', () => {
    for (const d of DIRECTIONS) {
      const r = checkRepack(full, d);
      expect(r.drawCalls, d).toBe(2);
      expect(r.ok).toBe(true);
    }
    const all = checkRepackAllDirections(full);
    expect(all.ok).toBe(true);
    expect(all.atlasSize).toBe(1024);
  });

  it('without the additive wing it is a single call', () => {
    expect(
      checkRepack(
        full.filter((a) => a.slot !== 'wing'),
        'S',
      ).drawCalls,
    ).toBe(1);
  });

  it('a second additive layer in the middle of the order breaks the rule', () => {
    const bad = full.map((a) => (a.slot === 'head' ? { ...a, blend: 'additive' as const } : a));
    const r = checkRepack(bad, 'S');
    expect(r.ok).toBe(false);
    expect(r.drawCalls).toBe(4); // wing(add) | cape..outfit_upper | head(add) | hair_front..weapon_R
  });

  it('overflowing 2048² fails; mid-size needs the 2048 texture', () => {
    const big = full.map((a) => ({ ...a, width: 600, height: 400 }));
    const r = checkRepack(big, 'S');
    expect(r.atlasSize).toBe(2048);
    expect(r.ok).toBe(true);
    const huge = full.map((a) => ({ ...a, width: 1000, height: 400 }));
    const h = checkRepack(huge, 'S');
    expect(h.atlasSize).toBeNull();
    expect(h.ok).toBe(false);
  });

  it('orbit sprite nodes do not count toward the Spine draw calls', () => {
    const withOrbit: PackedAttachment[] = [...full, { slot: 'orbit_back', width: 50, height: 50 }];
    expect(checkRepack(withOrbit, 'S').drawCalls).toBe(2);
  });
});
