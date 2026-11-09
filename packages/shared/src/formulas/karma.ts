/**
 * Nghiệp Lực (K) and Đạo Tâm (docs/01 §5.3, §8; docs/07 §2, §7; docs/14 §3; D103).
 *
 * K in [-1000, +1000]: Karma_Penalty on breakthrough is `breakthrough.ts` (unchanged); Ma đạo (K <= -700) wears gear 1,5x faster;
 * the faction band is a DISPLAY label only (docs/10 §7.1: no faction-exclusive content). Đạo Tâm in [0, 100] only changes the Tâm Ma
 * strength (docs/01 §5.3), its ceiling depends on the K band (docs/01 §8.3). Every number below is quoted from those docs; the ones the
 * docs mark "Đề xuất / chờ duyệt" stay so (cần game designer duyệt khi cân bằng), and the starting Đạo Tâm is a placeholder (OPEN-ITEMS).
 */
import { BREAKTHROUGH, clamp } from './breakthrough.js';

export const KARMA = {
  MIN: -1000,
  MAX: 1000,
  /** faction band edges (docs/14 §3.2): Chính >= +300, Tán tu -299..+299, Tà -699..-300, Ma <= -700 (the 07 threshold) */
  CHINH_MIN: 300,
  TA_MAX: -300,
  MA_MAX: BREAKTHROUGH.DEMONIC_KARMA,
  /** gear durability loss multiplier for Ma đạo (docs/07 §7, docs/01 §8.1) */
  MA_DURABILITY_MULT: 1.5,
  /** Nghiệp Ảnh: one extra Tâm Ma shadow per this much negative K, at most `NGHIEP_ANH_MAX` (docs/01 §5.3) */
  NGHIEP_ANH_STEP: 200,
  NGHIEP_ANH_MAX: 3,
  /** at most this much K gained per (server) day through PvP (docs/14 §3.3) and per week through causality quests (docs/12 §3.4) */
  PVP_DAILY_GAIN_CAP: 100,
  QUEST_WEEKLY_GAIN_CAP: 100,
} as const;

export const DAO_TAM = {
  MIN: 0,
  MAX: 100,
  /**
   * Đạo Tâm of a new character. PLACEHOLDER: docs/01 §8.3 gives ceilings and no starting value; 60 matches the value the Tâm Ma code
   * used until this system existed (a Tâm Ma of strength 1,2 for a neutral character). Cần game designer duyệt.
   */
  START: 60,
  /** ceiling by band (docs/01 §8.3, Đề xuất): Chính 100, Tán tu 100, Tà 80, Ma 60 */
  CAP: { chinh: 100, tan_tu: 100, ta: 80, ma: 60 },
} as const;

export type Faction = 'chinh' | 'tan_tu' | 'ta' | 'ma';
export const FACTION_ORDER: readonly Faction[] = ['chinh', 'tan_tu', 'ta', 'ma'];
/** display names (docs/14 §3.2); the wire carries K and the client derives the band */
export const FACTION_LABEL: Readonly<Record<Faction, string>> = {
  chinh: 'Chính đạo',
  tan_tu: 'Tán tu',
  ta: 'Tà đạo',
  ma: 'Ma đạo',
};

export const clampKarma = (k: number): number => (Number.isFinite(k) ? clamp(Math.trunc(k), KARMA.MIN, KARMA.MAX) : 0);

export function factionOf(karma: number): Faction {
  const k = clampKarma(karma);
  if (k >= KARMA.CHINH_MIN) return 'chinh';
  if (k <= KARMA.MA_MAX) return 'ma';
  if (k <= KARMA.TA_MAX) return 'ta';
  return 'tan_tu';
}

/** Đạo Tâm ceiling of the band K falls in. */
export const daoTamCap = (karma: number): number => DAO_TAM.CAP[factionOf(karma)];

export const clampDaoTam = (d: number): number =>
  Number.isFinite(d) ? clamp(Math.round(d), DAO_TAM.MIN, DAO_TAM.MAX) : DAO_TAM.START;

/** The Đạo Tâm that counts (and is shown): the stored value under the ceiling of the current band. */
export const effectiveDaoTam = (daoTam: number, karma: number): number =>
  Math.min(clampDaoTam(daoTam), daoTamCap(karma));

/** Gear durability loss multiplier: 1,5 for Ma đạo (K <= -700), else 1. The game has no gear wear event yet (OPEN-ITEMS D103). */
export const durabilityLossMultiplier = (karma: number): number =>
  factionOf(karma) === 'ma' ? KARMA.MA_DURABILITY_MULT : 1;

/** Nghiệp Ảnh: extra Tâm Ma shadows from heavy negative K (docs/01 §5.3): one per 200 negative K, at most 3. */
export const nghiepAnhCount = (karma: number): number =>
  Math.min(KARMA.NGHIEP_ANH_MAX, Math.floor(Math.max(0, -clampKarma(karma)) / KARMA.NGHIEP_ANH_STEP));

/**
 * The K / Đạo Tâm events the docs define a NUMBER for. Only these can be applied; others (docs/01 §8.3: quests of the heart, keeping an oath,
 * dying in a Tâm Cảnh: "số cụ thể: chưa thiết kế") have no entry. `gainCap` names the daily / weekly gain budget the event draws on.
 */
export const KARMA_EVENTS = {
  /** docs/14 §3.3: killed a player with no PK flag, realm gap <= 1 (in a PK zone) */
  pvp_kill_unflagged: { delta: -50, cap: null },
  /** killed a player with no flag who is 2+ realms below */
  pvp_kill_unflagged_weaker: { delta: -120, cap: null },
  /** killed a Gây hấn / Truy nã flagged player */
  pvp_kill_flagged: { delta: 10, cap: 'pvp_daily' },
  /** the 3rd kill of the same victim within one hour: extra penalty */
  pvp_kill_repeat: { delta: -50, cap: null },
  /** killed a player outside a war but inside an instance */
  pvp_kill_instance: { delta: -50, cap: null },
  /** war kill between the two sides at war: 0 (listed so a caller states the reason) */
  pvp_kill_war: { delta: 0, cap: null },
} as const;
export type KarmaEventId = keyof typeof KARMA_EVENTS;
export type KarmaCap = 'pvp_daily';

/**
 * K after an event. `gainedInPeriod` is how much K the same cap already gave in the current period; a gain is cut to what is left of
 * `KARMA.PVP_DAILY_GAIN_CAP`. A loss is never limited (docs/14 §3.3: "tổng giảm không giới hạn, dưới -1000 bị kẹp"). Returns the new K and
 * the K actually gained against the cap (0 for losses).
 */
export function applyKarmaEvent(
  karma: number,
  id: KarmaEventId,
  gainedInPeriod = 0,
): { karma: number; delta: number; gained: number } {
  const ev = KARMA_EVENTS[id];
  let delta: number = ev.delta;
  if (delta > 0 && ev.cap === 'pvp_daily')
    delta = Math.min(delta, Math.max(0, KARMA.PVP_DAILY_GAIN_CAP - gainedInPeriod));
  const before = clampKarma(karma);
  const after = clampKarma(before + delta);
  return { karma: after, delta: after - before, gained: Math.max(0, after - before) };
}
