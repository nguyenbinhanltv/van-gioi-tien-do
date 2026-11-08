/**
 * Monster definitions, tier multipliers, AI parameters and per-zone spawn tables (docs/10 §4, D74).
 *
 * Source of the identity data (id, zone, tier, element(s), level range, footprint): docs/10-mvp-scope.md §4 table. Tier
 * multipliers: docs/10 §4.1 (marked "Đề xuất" there). Everything under `MOB_AI`, `MOB_RESPAWN_MS` and the spawn COUNTS
 * is NOT specified by any doc: D74 sets placeholder defaults, marked "cần game designer duyệt khi cân bằng"
 * (docs/OPEN-ITEMS.md). Names/ids are the temporary ids of docs/10.
 *
 * Engine-free and deterministic: tables only, plus `mobStats` which reuses the 07 §1 stat curve.
 */
import { realmProgression, type ElementId } from './data.js';
import { statsAt, subStageCount, type Stats } from './formulas/stats.js';
import type { DropSource } from './formulas/economy.js';

export type MobTier = 'normal' | 'elite' | 'boss';
export type MobZoneId = 'bia_rung' | 'dam_lay_doc' | 'co_thu_trung_tam' | 'doc_hoa_dam';

export interface MobDef {
  /** wire id (`EnterEntity.defId`, u16), 1-based and stable: never renumber */
  id: number;
  /** docs/10 id (temporary) */
  key: string;
  zone: MobZoneId;
  tier: MobTier;
  /** main element first, then the variant element (docs/10 "Hệ chính / biến thể") */
  elements: readonly ElementId[];
  levelMin: number;
  levelMax: number;
  /** tiles per side (docs/10: 1 normal and elite, 2 or 4 for bosses) */
  footprint: 1 | 2 | 4;
}

/** docs/10 §4 table, in table order. */
export const MOB_DEFS: readonly MobDef[] = [
  {
    id: 1,
    key: 'mob_doc_tho',
    zone: 'bia_rung',
    tier: 'normal',
    elements: ['moc', 'thuy'],
    levelMin: 5,
    levelMax: 15,
    footprint: 1,
  },
  {
    id: 2,
    key: 'mob_hoi_lang',
    zone: 'bia_rung',
    tier: 'normal',
    elements: ['kim', 'tho'],
    levelMin: 10,
    levelMax: 25,
    footprint: 1,
  },
  {
    id: 3,
    key: 'mob_thanh_xa',
    zone: 'bia_rung',
    tier: 'normal',
    elements: ['moc', 'hoa'],
    levelMin: 15,
    levelMax: 30,
    footprint: 1,
  },
  {
    id: 4,
    key: 'elite_lang_vuong',
    zone: 'bia_rung',
    tier: 'elite',
    elements: ['kim'],
    levelMin: 25,
    levelMax: 30,
    footprint: 1,
  },
  {
    id: 5,
    key: 'mob_doc_chu',
    zone: 'dam_lay_doc',
    tier: 'normal',
    elements: ['thuy', 'moc'],
    levelMin: 20,
    levelMax: 40,
    footprint: 1,
  },
  {
    id: 6,
    key: 'mob_doc_thiem',
    zone: 'dam_lay_doc',
    tier: 'normal',
    elements: ['thuy', 'hoa'],
    levelMin: 30,
    levelMax: 50,
    footprint: 1,
  },
  {
    id: 7,
    key: 'elite_thiem_vuong',
    zone: 'dam_lay_doc',
    tier: 'elite',
    elements: ['thuy'],
    levelMin: 45,
    levelMax: 50,
    footprint: 1,
  },
  {
    id: 8,
    key: 'mob_co_can',
    zone: 'co_thu_trung_tam',
    tier: 'normal',
    elements: ['moc', 'tho'],
    levelMin: 40,
    levelMax: 60,
    footprint: 1,
  },
  {
    id: 9,
    key: 'mob_huyet_diep',
    zone: 'co_thu_trung_tam',
    tier: 'normal',
    elements: ['moc', 'hoa'],
    levelMin: 50,
    levelMax: 70,
    footprint: 1,
  },
  {
    id: 10,
    key: 'elite_co_can_mau',
    zone: 'co_thu_trung_tam',
    tier: 'elite',
    elements: ['moc'],
    levelMin: 60,
    levelMax: 70,
    footprint: 1,
  },
  {
    id: 11,
    key: 'boss_ho_vuong',
    zone: 'co_thu_trung_tam',
    tier: 'boss',
    elements: ['moc'],
    levelMin: 55,
    levelMax: 60,
    footprint: 2,
  },
  {
    id: 12,
    key: 'mob_xich_diem',
    zone: 'doc_hoa_dam',
    tier: 'normal',
    elements: ['hoa', 'tho'],
    levelMin: 50,
    levelMax: 70,
    footprint: 1,
  },
  {
    id: 13,
    key: 'elite_xich_mang',
    zone: 'doc_hoa_dam',
    tier: 'elite',
    elements: ['hoa'],
    levelMin: 60,
    levelMax: 70,
    footprint: 1,
  },
  {
    id: 14,
    key: 'boss_co_mang',
    zone: 'doc_hoa_dam',
    tier: 'boss',
    elements: ['hoa', 'moc'],
    levelMin: 65,
    levelMax: 70,
    footprint: 4,
  },
];

export function mobDefById(id: number): MobDef | undefined {
  return MOB_DEFS.find((d) => d.id === id);
}
export function mobDefByKey(key: string): MobDef | undefined {
  return MOB_DEFS.find((d) => d.key === key);
}

/** docs/10 §4.1 (Đề xuất): multipliers on the 07 §1 curve of the mob's realm/stage, and the basic attack interval. */
export const MOB_TIERS: Readonly<
  Record<MobTier, { hpMult: number; atkMult: number; defMult: number; attackIntervalMs: number }>
> = {
  normal: { hpMult: 0.35, atkMult: 1.0, defMult: 1.0, attackIntervalMs: 1800 },
  elite: { hpMult: 2.0, atkMult: 1.2, defMult: 1.0, attackIntervalMs: 1600 },
  boss: { hpMult: 45, atkMult: 1.5, defMult: 1.2, attackIntervalMs: 1500 },
};

/**
 * AI parameters per tier. PLACEHOLDERS (D74): no doc specifies them; tune with a game designer. Distances are tiles
 * (tile space), times are ms, `agi` feeds `@vgtd/sim` `walkSpeed` (normal 80 -> 3.6 tiles/s, below the player's 4.5).
 */
export interface MobAiParams {
  agi: number;
  /** a player closer than this (tiles) pulls the mob */
  aggroRadius: number;
  /** a chasing mob gives up when its target is farther than this from the MOB */
  loseRadius: number;
  /** a mob farther than this from its home breaks off and returns (leash) */
  leashRadius: number;
  /** distance (tiles) at which a chasing mob stops (melee reach; no damage yet) */
  engageRange: number;
  /** wander target is picked within this radius of home (0 = stands still) */
  wanderRadius: number;
  /** idle pause between wander legs, drawn uniformly in [min, max] ms */
  idleMinMs: number;
  idleMaxMs: number;
  /** fraction of walk speed while wandering (0..1) */
  wanderSpeed: number;
  /** a returning mob counts as home within this distance (tiles) */
  homeRadius: number;
}
export const MOB_AI: Readonly<Record<MobTier, MobAiParams>> = {
  normal: {
    agi: 80,
    aggroRadius: 6,
    loseRadius: 9,
    leashRadius: 15,
    engageRange: 1.2,
    wanderRadius: 4,
    idleMinMs: 2000,
    idleMaxMs: 5000,
    wanderSpeed: 0.5,
    homeRadius: 0.6,
  },
  elite: {
    agi: 90,
    aggroRadius: 8,
    loseRadius: 12,
    leashRadius: 18,
    engageRange: 1.4,
    wanderRadius: 3,
    idleMinMs: 3000,
    idleMaxMs: 6000,
    wanderSpeed: 0.5,
    homeRadius: 0.6,
  },
  boss: {
    agi: 100,
    aggroRadius: 10,
    loseRadius: 15,
    leashRadius: 24,
    engageRange: 2.5,
    wanderRadius: 0,
    idleMinMs: 4000,
    idleMaxMs: 8000,
    wanderSpeed: 0.5,
    homeRadius: 0.8,
  },
};

/** Respawn delay after death, ms. PLACEHOLDER (D74); docs/07 §6 only gives hourly kill rates (150 normal, 20 elite). */
export const MOB_RESPAWN_MS: Readonly<Record<MobTier, number>> = { normal: 30_000, elite: 300_000, boss: 1_800_000 };

/** Wire / entity constants shared by server and client. */
export const MOB_ENTITY_KIND = 1; // EnterEntity.kind: "1 monster" (protocol types)
/** Mob entity ids are MOB_ID_BASE + slot; players are allocated below it. */
export const MOB_ID_BASE = 1_000_000;

export interface SpawnGroup {
  /** `MobDef.key` */
  def: string;
  /** how many of this mob the zone keeps alive at density 1 (PLACEHOLDER counts, D74 / D83) */
  count: number;
  /** members that spawn together around one anchor point (packs); 1 = every mob has its own point (D83) */
  pack?: number;
}
export interface ZoneSpawnTable {
  zone: MobZoneId;
  groups: readonly SpawnGroup[];
}

/** Pack members spawn within this many tiles of the pack anchor (D83, PLACEHOLDER). */
export const MOB_PACK_RADIUS = 3;
/** Pack size of normal mobs (elites and bosses spawn alone; D83, PLACEHOLDER). */
export const MOB_PACK_NORMAL = 3;
/** Normal mobs per def and zone (4 packs of 3; was 10 in D74); elites 2, boss 1 (D83, PLACEHOLDERS). */
export const MOB_COUNT_NORMAL = 12;

/**
 * Threat (aggro) table parameters (D83, PLACEHOLDERS, cần game designer duyệt). A mob that takes damage gains threat on the
 * attacker equal to the damage; it chases the player with the most threat. A switch needs more than `switchRatio` times the
 * current target's threat (no ping-pong between two players). Threat on a player farther than `forgetRadius` tiles from the mob
 * decays by `decayPerS` (fraction per second); entries under `minThreat` are dropped. All threat is cleared when the mob
 * returns home, dies or respawns.
 */
export const MOB_THREAT = {
  switchRatio: 1.1,
  forgetRadius: 24,
  decayPerS: 0.2,
  minThreat: 1,
} as const;

/** One table per zone: every def of the zone, counts by tier (normal 12 in packs of 3 / elite 2 / boss 1), PLACEHOLDERS (D74, D83). */
export const ZONE_SPAWN_TABLES: readonly ZoneSpawnTable[] = (
  ['bia_rung', 'dam_lay_doc', 'co_thu_trung_tam', 'doc_hoa_dam'] as const
).map((zone) => ({
  zone,
  groups: MOB_DEFS.filter((d) => d.zone === zone).map((d) => ({
    def: d.key,
    count: d.tier === 'normal' ? MOB_COUNT_NORMAL : d.tier === 'elite' ? 2 : 1,
    pack: d.tier === 'normal' ? MOB_PACK_NORMAL : 1,
  })),
}));

/** Realm (1-based, `order` of the realm table) and sub-stage that contain a mob `level`. */
export function mobRealmAt(level: number): { realm: number; subStage: number } {
  const realms = realmProgression.realms;
  const lv = Math.max(1, Math.trunc(level));
  const r = realms.find((x) => lv >= x.level_range[0] && lv <= x.level_range[1]) ?? realms[realms.length - 1]!;
  const K = subStageCount(r.order);
  const [lo, hi] = r.level_range;
  const k = Math.min(K, Math.max(1, 1 + Math.floor(((lv - lo) / (hi - lo + 1)) * K)));
  return { realm: r.order, subStage: k };
}
/** Realm of a mob level (suppression and stone quantity use it). */
export function mobRealm(level: number): number {
  return mobRealmAt(level).realm;
}
/** Drop table row of a tier: normal -> field, elite -> elite, boss -> boss (docs/07 §6). */
export function mobDropSource(tier: MobTier): DropSource {
  return tier === 'normal' ? 'field' : tier;
}

/**
 * Stats of a mob at `level`: the 07 §1 curve at the (realm, sub-stage) that contains `level` (realm `level_range`
 * from the realm table, sub-stage proportional inside the range), times the tier multipliers (docs/10 §4.1). Integers.
 */
export function mobStats(def: MobDef, level: number): { hp: number; atk: number; def: number } {
  const { realm, subStage } = mobRealmAt(level);
  const s: Stats = statsAt(realm, subStage);
  const t = MOB_TIERS[def.tier];
  return {
    hp: Math.max(1, Math.round(s.hp * t.hpMult)),
    atk: Math.round(s.atk * t.atkMult),
    def: Math.round(s.def * t.defMult),
  };
}
