import { describe, expect, it } from 'vitest';
import { footprintSortY, pivotSortY, tileToScreen } from '@vgtd/shared';
import {
  BOSS_FOOTPRINTS,
  MUTATION_SCALE_RANGE,
  PART_CRACK_THRESHOLD,
  PART_DEBRIS_FRAMES,
  PRERENDER_MAX_BREAKABLE_PARTS,
  RIG_LIMITS,
  TRANSFORM_COVER_FRAMES,
  TRANSFORM_END_S,
  TRANSFORM_START_S,
  bossFootprintSortY,
  bossSortYFromCentre,
  getBossFootprint,
  isInFrontOfBoss,
  occupiedTiles,
  partAttachmentNames,
  partStateEffects,
  partStateFromHp,
  phaseIndexForHp,
  phasePreloadAtlases,
  transformDuration,
  vSortLine,
  vSortLineY,
  type PhaseSpec,
} from '../src/index.js';

describe('boss footprints', () => {
  it('table: diamond, canvas, scheme, sort', () => {
    const t = Object.fromEntries(BOSS_FOOTPRINTS.map((b) => [b.footprint, b]));
    expect(t['2x2']!.diamondPx).toEqual({ width: 128, height: 64 });
    expect(t['2x2']!.canvas).toBe(256);
    expect(t['2x2']!.sort).toBe('bottom_vertex');
    expect(t['4x4']!.diamondPx).toEqual({ width: 256, height: 128 });
    expect(t['4x4']!.canvas).toBe(512);
    expect(t['4x4']!.sort).toBe('bottom_vertex_v_line');
    expect(t['4x4']!.render).toEqual(['spine']);
    expect(t['8x8']!.diamondPx).toEqual({ width: 512, height: 256 });
    expect(t['8x8']!.canvas).toBeNull();
    expect(t['8x8']!.scheme).toBe('parts_1_3');
    expect(t['8x8']!.sort).toBe('per_part');
    expect(getBossFootprint('4x4').examples).toContain('Giao Long');
  });
});

describe('boss sort key: sortY = y_centre + n × 16', () => {
  it.each([2, 4, 8])('n = %i: formula equals the bottom vertex of the footprint', (n) => {
    const fp = { i0: 10, j0: 20, n };
    const centre = tileToScreen(10 + n / 2, 20 + n / 2);
    expect(bossSortYFromCentre(fp)).toBe(centre.y + n * 16);
    expect(bossFootprintSortY(fp)).toBe(footprintSortY(10, 20, n, n));
    expect(bossFootprintSortY(fp)).toBe(bossSortYFromCentre(fp));
    expect(bossFootprintSortY(fp)).toBe(tileToScreen(10 + n, 20 + n).y);
  });
  it('example: 4x4 boss at (0,0): centre y = 64, sortY = 128', () => {
    expect(bossFootprintSortY({ i0: 0, j0: 0, n: 4 })).toBe(128);
  });
});

describe('V sort line (4x4 and up)', () => {
  const fp = { i0: 10, j0: 10, n: 4 };
  it('V runs W vertex → S vertex → E vertex', () => {
    const v = vSortLine(fp);
    expect(v.west).toEqual(tileToScreen(10, 14));
    expect(v.south).toEqual(tileToScreen(14, 14));
    expect(v.east).toEqual(tileToScreen(14, 10));
    expect(v.south.y).toBe(bossFootprintSortY(fp));
    expect(vSortLineY(fp, v.west.x - 1)).toBeNull();
    expect(vSortLineY(fp, v.south.x)).toBe(v.south.y);
    expect(vSortLineY(fp, (v.west.x + v.south.x) / 2)).toBe((v.west.y + v.south.y) / 2);
  });
  it('a player beside the east/west corners (Y < boss sortY) still stands in front of the flank', () => {
    // just outside the front-right edge: i = 14.2, j = 11 → Y below the V edge but above the S vertex
    const i = 14.2;
    const j = 11;
    expect(pivotSortY(i, j)).toBeLessThan(bossFootprintSortY(fp));
    expect(isInFrontOfBoss(i, j, fp)).toBe(true);
    // just outside the front-left edge
    expect(pivotSortY(11, 14.2)).toBeLessThan(bossFootprintSortY(fp));
    expect(isInFrontOfBoss(11, 14.2, fp)).toBe(true);
  });
  it('a player behind the boss is behind; below the bottom vertex is in front', () => {
    expect(isInFrontOfBoss(9, 9, fp)).toBe(false);
    expect(isInFrontOfBoss(12, 8, fp)).toBe(false); // N-E side, outside but behind the V
    expect(isInFrontOfBoss(15, 15, fp)).toBe(true);
  });
  it('2x2 bosses use plain sort-key comparison', () => {
    const small = { i0: 10, j0: 10, n: 2 };
    expect(isInFrontOfBoss(12.2, 10.5, small)).toBe(pivotSortY(12.2, 10.5) > bossFootprintSortY(small));
  });
  it('footprint locks n × n tiles on the navgrid, independent of facing', () => {
    expect(occupiedTiles(fp)).toHaveLength(16);
    expect(occupiedTiles({ i0: 3, j0: 4, n: 2 })).toEqual([
      { i: 3, j: 4 },
      { i: 3, j: 5 },
      { i: 4, j: 4 },
      { i: 4, j: 5 },
    ]);
  });
});

describe('part-breaking', () => {
  it('states: intact > 50 %, cracked ≤ 50 %, broken at 0', () => {
    expect(PART_CRACK_THRESHOLD).toBe(0.5);
    expect(partStateFromHp(100, 100)).toBe('intact');
    expect(partStateFromHp(51, 100)).toBe('intact');
    expect(partStateFromHp(50, 100)).toBe('cracked');
    expect(partStateFromHp(1, 100)).toBe('cracked');
    expect(partStateFromHp(0, 100)).toBe('broken');
    expect(partStateFromHp(-5, 100)).toBe('broken');
  });
  it('3 attachments: original, _cracked, _stump', () => {
    expect(partAttachmentNames('horn')).toEqual({ intact: 'horn', cracked: 'horn_cracked', stump: 'horn_stump' });
  });
  it('effects: cracked weakens skills (+ sparks/smoke); broken locks them, spawns debris and drops materials', () => {
    expect(partStateEffects('intact')).toMatchObject({
      attachment: 'intact',
      skillsWeakened: false,
      skillsLocked: false,
    });
    expect(partStateEffects('cracked')).toMatchObject({
      attachment: 'cracked',
      sparksAndSmoke: true,
      skillsWeakened: true,
      skillsLocked: false,
    });
    expect(partStateEffects('broken')).toMatchObject({
      attachment: 'stump',
      skillsLocked: true,
      spawnDebris: true,
      dropRareMaterial: true,
    });
    expect(PART_DEBRIS_FRAMES).toEqual({ min: 8, max: 12 });
    expect(PRERENDER_MAX_BREAKABLE_PARTS).toBe(1);
  });
});

describe('phase by skin', () => {
  const phases: PhaseSpec[] = [
    { id: 'p2', hpThreshold: 0.6, skin: 'phase2', atlas: 'a2' },
    { id: 'p3', hpThreshold: 0.25, skin: 'phase3', atlas: 'a3' },
  ];
  it('thresholds 60 % and 25 % (example): reached at or below', () => {
    expect(phaseIndexForHp(phases, 1)).toBe(0);
    expect(phaseIndexForHp(phases, 0.61)).toBe(0);
    expect(phaseIndexForHp(phases, 0.6)).toBe(1);
    expect(phaseIndexForHp(phases, 0.3)).toBe(1);
    expect(phaseIndexForHp(phases, 0.25)).toBe(2);
    expect(phaseIndexForHp([...phases].reverse(), 0.1)).toBe(2); // order-independent
  });
  it('transform timings and cover frames', () => {
    expect(TRANSFORM_START_S).toBe(0.8);
    expect(TRANSFORM_END_S).toBe(1.0);
    expect(transformDuration()).toBeCloseTo(1.8);
    expect(TRANSFORM_COVER_FRAMES).toEqual({ min: 2, max: 3 });
  });
  it('later phases preload their atlases at fight start', () => {
    expect(phasePreloadAtlases(phases)).toEqual(['a2', 'a3']);
  });
  it('mutation variants scale 1.1–1.3', () => {
    expect(MUTATION_SCALE_RANGE).toEqual({ min: 1.1, max: 1.3 });
  });
});

describe('rig limits', () => {
  it('Player / Linh thú / Boss', () => {
    expect(RIG_LIMITS.player).toEqual({ bones: 60, slots: 40, meshVertices: 600, physicsConstraints: 6 });
    expect(RIG_LIMITS.pet).toEqual({ bones: 50, slots: 25, meshVertices: 400, physicsConstraints: 4 });
    expect(RIG_LIMITS.boss).toEqual({ bones: 120, slots: 60, meshVertices: 1500, physicsConstraints: 8 });
  });
});
