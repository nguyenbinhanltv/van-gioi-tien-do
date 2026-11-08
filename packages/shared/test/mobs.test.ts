import { describe, expect, it } from 'vitest';
import {
  MOB_AI,
  MOB_DEFS,
  MOB_RESPAWN_MS,
  MOB_TIERS,
  ZONE_SPAWN_TABLES,
  mobDefByKey,
  mobDropSource,
  mobRealm,
  mobRealmAt,
  mobStats,
  realmProgression,
  statsAt,
  subStageCount,
} from '../src/index.js';

describe('mob definitions (docs/10 §4)', () => {
  it('has the 14 documented kinds with stable unique ids 1..14', () => {
    expect(MOB_DEFS.map((d) => d.id)).toEqual(Array.from({ length: 14 }, (_, i) => i + 1));
    expect(new Set(MOB_DEFS.map((d) => d.key)).size).toBe(14);
    expect(MOB_DEFS.filter((d) => d.tier === 'normal')).toHaveLength(8);
    expect(MOB_DEFS.filter((d) => d.tier === 'elite')).toHaveLength(4);
    expect(MOB_DEFS.filter((d) => d.tier === 'boss')).toHaveLength(2);
    expect(mobDefByKey('boss_co_mang')).toMatchObject({ id: 14, footprint: 4, zone: 'doc_hoa_dam' });
    for (const d of MOB_DEFS) expect(d.levelMin).toBeLessThanOrEqual(d.levelMax);
  });
  it('every zone table lists exactly the defs of that zone, with counts by tier', () => {
    expect(ZONE_SPAWN_TABLES).toHaveLength(4);
    for (const t of ZONE_SPAWN_TABLES) {
      const keys = MOB_DEFS.filter((d) => d.zone === t.zone).map((d) => d.key);
      expect(t.groups.map((g) => g.def)).toEqual(keys);
      for (const g of t.groups) expect(g.count).toBeGreaterThan(0);
    }
  });
  it('tier tables match docs/10 §4.1 and are ordered normal < elite < boss', () => {
    expect(MOB_TIERS.normal).toMatchObject({ hpMult: 0.35, atkMult: 1.0, defMult: 1.0, attackIntervalMs: 1800 });
    expect(MOB_TIERS.elite).toMatchObject({ hpMult: 2.0, atkMult: 1.2, attackIntervalMs: 1600 });
    expect(MOB_TIERS.boss).toMatchObject({ hpMult: 45, atkMult: 1.5, defMult: 1.2 });
    for (const t of ['normal', 'elite', 'boss'] as const) {
      const a = MOB_AI[t];
      expect(a.loseRadius).toBeGreaterThan(a.aggroRadius);
      expect(a.leashRadius).toBeGreaterThan(a.loseRadius);
      expect(a.idleMinMs).toBeLessThanOrEqual(a.idleMaxMs);
    }
    expect(MOB_RESPAWN_MS.normal).toBeLessThan(MOB_RESPAWN_MS.elite);
    expect(MOB_RESPAWN_MS.elite).toBeLessThan(MOB_RESPAWN_MS.boss);
  });
});

describe('mobStats (07 §1 curve x docs/10 §4.1 multipliers)', () => {
  const tho = mobDefByKey('mob_doc_tho')!;
  it('uses the stat curve of the realm that contains the level', () => {
    const luyenKhi = realmProgression.realms[0]!;
    const k = subStageCount(1);
    const s = mobStats(tho, luyenKhi.level_range[0]);
    expect(s.hp).toBe(Math.round(statsAt(1, 1).hp * 0.35));
    const top = mobStats(tho, luyenKhi.level_range[1]);
    expect(top.hp).toBe(Math.round(statsAt(1, k).hp * 0.35));
  });
  it('grows with level and with tier', () => {
    expect(mobStats(tho, 15).hp).toBeGreaterThan(mobStats(tho, 5).hp);
    const wolf = mobDefByKey('mob_hoi_lang')!;
    const king = mobDefByKey('elite_lang_vuong')!;
    expect(mobStats(king, 27).hp).toBeGreaterThan(mobStats(wolf, 27).hp * 5);
    expect(mobStats(mobDefByKey('boss_ho_vuong')!, 58).hp).toBeGreaterThan(
      mobStats(mobDefByKey('mob_co_can')!, 58).hp * 100,
    );
  });
  it('is deterministic and integral', () => {
    const a = mobStats(tho, 9);
    expect(mobStats(tho, 9)).toEqual(a);
    for (const v of Object.values(a)) expect(Number.isInteger(v)).toBe(true);
  });
});

describe('mob realm and drop source', () => {
  it('mobRealm follows the realm level ranges and mobRealmAt matches the stat lookup', () => {
    expect(mobRealm(1)).toBe(1);
    expect(mobRealm(30)).toBe(1);
    expect(mobRealm(31)).toBe(2);
    expect(mobRealm(50)).toBe(2);
    expect(mobRealm(51)).toBe(3);
    expect(mobRealm(70)).toBe(3);
    const tho = mobDefByKey('mob_doc_tho')!;
    const { realm, subStage } = mobRealmAt(9);
    expect(mobStats(tho, 9).hp).toBe(Math.round(statsAt(realm, subStage).hp * 0.35));
  });
  it('tier -> drop table row', () => {
    expect(mobDropSource('normal')).toBe('field');
    expect(mobDropSource('elite')).toBe('elite');
    expect(mobDropSource('boss')).toBe('boss');
  });
});
