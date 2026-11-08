import { describe, expect, it } from 'vitest';
import { Layer, PICK_BOX_PX } from '@vgtd/shared';
import {
  FadeAnimator,
  OCCLUSION,
  computeOcclusion,
  objectDrawItems,
  occluderCandidates,
  playerPickBox,
  pointInPolygon,
  type OccluderCandidate,
  type PlayerOcclusionInput,
  type WorldObject,
} from '../src/index.js';

const player: PlayerOcclusionInput = { id: 1, i: 5.5, j: 5.5, group: 0 };

function obj(partial: Partial<WorldObject> & { id: number }): WorldObject {
  return { layer: Layer.L3_YSORT, i0: 6, j0: 6, w: 1, h: 1, group: 0, spriteWidth: 64, spriteHeight: 128, ...partial };
}
function cands(...os: WorldObject[]): OccluderCandidate[] {
  return os.flatMap((o) => occluderCandidates(o, objectDrawItems(o)));
}

describe('pick box', () => {
  it('is 48 × 100 px, bottom-centre on the pivot (y down), lifted 32 px per elevation level', () => {
    const b = playerPickBox(player);
    expect(b.width).toBe(PICK_BOX_PX.width);
    expect(b.height).toBe(PICK_BOX_PX.height);
    expect(b.x + b.width / 2).toBe(0); // i - j = 0
    expect(b.y + b.height).toBe(11 * 16);
    expect(playerPickBox({ ...player, group: 2 }).y).toBe(b.y - 64);
  });
});

describe('L3 occluders', () => {
  it('a tree in front (drawn after, overlapping the pick box) is flagged inFront; xray only if the renderer supports it', () => {
    const tree = obj({ id: 10, heightTiles: 2 }); // footprint (6,6): S vertex (7,7) → sortY 224 > player 176
    const r = computeOcclusion(player, cands(tree), { xray: true });
    const f = r.flags.get(10)!;
    expect(f.inFront).toBe(true);
    expect(f.coverage).toBeGreaterThan(0.4);
    expect(f.reason).toBe('front'); // not taller than 2 tiles → hole-punch flag only
    expect(r.xray).toBe(true);
    expect(computeOcclusion(player, cands(tree), { xray: false }).xray).toBe(false);
  });

  it('a tree behind the player (sorted before) never occludes', () => {
    const behind = obj({ id: 11, i0: 3, j0: 3 });
    const r = computeOcclusion(player, cands(behind), { xray: true });
    expect(r.flags.size).toBe(0);
    expect(r.xray).toBe(false);
  });

  it('an object in front whose sprite does not overlap the pick box is ignored', () => {
    const farRight = obj({ id: 12, i0: 12, j0: 6, w: 1, h: 1 }); // S vertex x = (13-7)*32 = 192, well right of the player
    expect(computeOcclusion(player, cands(farRight)).flags.size).toBe(0);
  });

  it('tall objects (> 2 tiles) covering > 40 % fade to 60 % alpha; short ones only get the hole-punch flag', () => {
    const tall = obj({ id: 13, spriteHeight: 160, heightTiles: 5, spriteWidth: 128 });
    const short = obj({ id: 14, spriteHeight: 160, heightTiles: 1.5, spriteWidth: 128 });
    const rt = computeOcclusion(player, cands(tall)).flags.get(13)!;
    expect(rt.reason).toBe('tall');
    expect(rt.targetAlpha).toBe(OCCLUSION.TALL_FADE_ALPHA);
    const rs = computeOcclusion(player, cands(short)).flags.get(14)!;
    expect(rs.reason).toBe('front');
    expect(rs.targetAlpha).toBe(1);
    expect(rs.inFront).toBe(true);
    // tall but covering only a sliver (player at the side of the sprite) → no alpha change
    const sliver = obj({ id: 15, i0: 9, j0: 6, spriteHeight: 160, spriteWidth: 12, heightTiles: 5 });
    const p2: PlayerOcclusionInput = { ...player, i: 8.4, j: 5.5 };
    const rr = computeOcclusion(p2, cands(sliver)).flags.get(15)!;
    expect(rr.inFront).toBe(true);
    expect(rr.coverage).toBeLessThan(0.4);
    expect(rr.targetAlpha).toBe(1);
  });

  it('elevation: a higher group is drawn after and can hide a player standing lower; a lower group cannot', () => {
    const plateauProp = obj({ id: 16, group: 1, i0: 5, j0: 5 });
    const lowerProp = obj({ id: 17, group: 0, i0: 6, j0: 6 });
    const onPlateau: PlayerOcclusionInput = { ...player, group: 1 };
    expect(computeOcclusion(player, cands(plateauProp)).flags.has(16)).toBe(true);
    expect(computeOcclusion(onPlateau, cands(lowerProp)).flags.size).toBe(0);
  });

  it('all slices of a big object report under one sourceId with the summed coverage', () => {
    const big = obj({ id: 18, i0: 6, j0: 6, w: 4, h: 4, spriteWidth: 256, spriteHeight: 192, heightTiles: 6 });
    const items = objectDrawItems(big);
    expect(items.length).toBe(7);
    const r = computeOcclusion(player, occluderCandidates(big, items));
    expect([...r.flags.keys()]).toEqual([18]);
    expect(r.flags.get(18)!.coverage).toBeGreaterThan(0.4);
    expect(r.flags.get(18)!.reason).toBe('tall');
  });
});

describe('overhead (L4/L5)', () => {
  const canopy = obj({
    id: 30,
    layer: Layer.L4_AIR,
    i0: 4,
    j0: 4,
    w: 3,
    h: 3,
    spriteWidth: 288,
    spriteHeight: 160,
    zone: [
      { i: 4, j: 4 },
      { i: 7, j: 4 },
      { i: 7, j: 7 },
      { i: 4, j: 7 },
    ],
  });
  const cloud = obj({ id: 31, layer: Layer.L5_WEATHER, passive: true });

  it('fades to 35 % while the player pivot is inside the trigger zone, not otherwise', () => {
    const inside = computeOcclusion(player, cands(canopy)).flags.get(30)!;
    expect(inside.targetAlpha).toBe(OCCLUSION.ZONE_ALPHA);
    expect(inside.reason).toBe('zone');
    expect(computeOcclusion({ ...player, i: 8.5, j: 5.5 }, cands(canopy)).flags.has(30)).toBe(false);
  });

  it('clouds never trigger: constant alpha', () => {
    for (const p of [player, { ...player, i: 40, j: 40 }]) {
      const f = computeOcclusion(p, cands(cloud)).flags.get(31)!;
      expect(f.targetAlpha).toBe(OCCLUSION.CLOUD_ALPHA);
      expect(f.reason).toBe('passive');
    }
  });

  it('overhead never triggers xray / inFront', () => {
    const r = computeOcclusion(player, cands(canopy), { xray: true });
    expect(r.xray).toBe(false);
    expect(r.flags.get(30)!.inFront).toBe(false);
  });

  it('pointInPolygon handles concave polygons', () => {
    const L = [
      { i: 0, j: 0 },
      { i: 4, j: 0 },
      { i: 4, j: 2 },
      { i: 2, j: 2 },
      { i: 2, j: 4 },
      { i: 0, j: 4 },
    ];
    expect(pointInPolygon(1, 3, L)).toBe(true);
    expect(pointInPolygon(3, 1, L)).toBe(true);
    expect(pointInPolygon(3, 3, L)).toBe(false);
  });
});

describe('FadeAnimator', () => {
  it('reaches 35 % in 0.2 s and recovers to 100 % in 0.3 s', () => {
    const fade = new FadeAnimator();
    const canopy = obj({
      id: 40,
      layer: Layer.L4_AIR,
      zone: [
        { i: 0, j: 0 },
        { i: 10, j: 0 },
        { i: 10, j: 10 },
        { i: 0, j: 10 },
      ],
    });
    const inside = computeOcclusion({ ...player, i: 5, j: 5 }, cands(canopy)).flags;
    for (let k = 0; k < 10; k++) fade.update(0.02, inside); // 0.2 s
    expect(fade.alphaOf(40)).toBeCloseTo(OCCLUSION.ZONE_ALPHA, 5);
    const none = new Map();
    for (let k = 0; k < 14; k++) fade.update(0.02, none); // 0.28 s: not yet
    expect(fade.alphaOf(40)).toBeLessThan(1);
    fade.update(0.02, none); // 0.30 s
    expect(fade.alphaOf(40)).toBe(1);
  });
});
