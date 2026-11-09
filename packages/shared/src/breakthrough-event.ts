/**
 * Major breakthrough events (D97): the Tâm Ma and Lôi Kiếp that guard a realm threshold (docs/01 §5.2-5.4, docs/07 §2-§3, docs/10 §7.1).
 * Pure data and small pure functions; the server-authoritative state machine is `MajorBreakthroughs` (apps/server world/breakthrough).
 *
 * The success rate, the pity counter and the lightning damage are NOT redefined here: they come from `breakthrough.ts` / `tribulation.ts`
 * (`breakthroughSuccess`, `strikeDamage`, `TRIBULATIONS`, `STRIKE_INTERVAL_S`, `WAVE_INTERVAL_S`). What is new is the event around them.
 *
 * PLACEHOLDERS - cần game designer duyệt khi cân bằng: docs/01 §5.3-5.4 marks almost all of this "Đề xuất". Implemented as written there:
 * the Tâm Ma difficulty formula, its 90 s limit and 30 min lock, the Nhẹ / Trung / Nặng thresholds, the tu vi losses and the 24 h lock.
 * Not implemented (no such system exists yet, see OPEN-ITEMS): the "Đạo Cơ Chấn Động" debuff, the durability loss, Đạo Tâm loss, the
 * Nghiệp Ảnh extra shadows, the escorts / formation / artifact-shield mitigation items, the heal-pill lock.
 */
import {
  LIGHTNING_GROWTH,
  STRIKE_INTERVAL_S,
  TRIBULATIONS,
  WAVE_INTERVAL_S,
  strikeDamage,
  type TribulationSpec,
} from './formulas/tribulation.js';
import { maxSubStage, statsAt } from './formulas/stats.js';

/** What guards the major threshold OUT OF `realm` (1 = Luyện Khí). `none` = a plain roll, `tam_ma` = Tâm Ma only, `tam_ma_kiep` = Tâm Ma then Lôi Kiếp. */
export type MajorEventKind = 'none' | 'tam_ma' | 'tam_ma_kiep';

export interface MajorEventSpec {
  kind: MajorEventKind;
  /** Lôi Kiếp spec (`TRIBULATIONS` index 0 = Kim Đan -> Nguyên Anh) or null */
  tribulation: TribulationSpec | null;
}

/**
 * The MVP thresholds (docs/10 §7.1: "2 đột phá lớn + cổng Kết Anh"): Luyện Khí -> Trúc Cơ has no event, Trúc Cơ -> Kim Đan has the light
 * Tâm Ma, Kim Đan -> Nguyên Anh has Tâm Ma + Lôi Kiếp 3 đạo. Higher realms are not part of the beta: undefined here.
 */
export function majorEventOf(realm: number): MajorEventSpec | undefined {
  if (realm === 1) return { kind: 'none', tribulation: null };
  if (realm === 2) return { kind: 'tam_ma', tribulation: null };
  if (realm === 3) return { kind: 'tam_ma_kiep', tribulation: TRIBULATIONS[0]! };
  return undefined;
}

export const MAJOR_EVENT = {
  /** wire telegraph ids of the major-event module (Tâm Ma shadow attacks, Lôi Kiếp bolt warnings) start here (u16): above the mob attack counter's usual range. The client uses it to draw them with the tribulation decal. */
  TELEGRAPH_ID_BASE: 0xf000,
  /** Tâm Ma: the shadow must be killed within this time (docs/01 §5.3, 90 s) */
  TAM_MA_LIMIT_MS: 90_000,
  /** Đạo Tâm assumed for everybody until a Đạo Tâm system exists (docs/01 §5.3 range 0..100). PLACEHOLDER */
  DEFAULT_DAO_TAM: 60,
  /** the shadow attacks every this many ms, with a warning decal of `TAM_MA_WARN_MS` over a circle of `TAM_MA_RADIUS` tiles. PLACEHOLDER */
  TAM_MA_ATTACK_INTERVAL_MS: 2500,
  TAM_MA_WARN_MS: 800,
  TAM_MA_RADIUS: 2,
  /** damage of one shadow attack = the player's own ATK x strength x this coefficient (a mirror of the player's basic attack). PLACEHOLDER */
  TAM_MA_COEFF: 1,
  /** the shadow stands this many tiles from the player when it appears */
  TAM_MA_SPAWN_DISTANCE: 3,
  /** pause after the Tâm Ma / before the roll, and the cloud-gathering pause before the first warning (docs/01 §5.4 step 1) */
  DESTINY_PAUSE_MS: 2000,
  CLOUD_GATHER_MS: 3000,
  /** warning decal before every bolt (docs/01 §5.4 step 3: "vòng cảnh báo 1-1,5 s") */
  BOLT_WARN_MS: 1200,
  /** radius of a bolt's warning decal (the bolt always hits the owner; the decal only tells when) */
  BOLT_RADIUS: 1.5,
  /** the player must start with at least this fraction of max HP (the 3-bolt Kiếp totals 0,6 x HP_ref: a hurt player could die). PLACEHOLDER */
  MIN_HP_FRACTION: 0.8,
  /** Tâm Ma loss: the major breakthrough is locked this long (docs/01 §5.3) */
  TAM_MA_LOSS_LOCK_MS: 30 * 60_000,
  /** Nặng: lock 24 h (docs/01 §5.4) */
  HEAVY_LOCK_MS: 24 * 60 * 60_000,
} as const;

/**
 * Tâm Ma strength (docs/01 §5.3): `1,0 + 0,5 · (1 − ĐạoTâm/100) + Phạt_nghiệp`, `Phạt_nghiệp = max(0, −K)/2000`. 1,0 (best) .. ~2,0.
 * `dinhTamQuality` (Định Tâm Đan, q 0,6..1,6; null = none) takes 10% x q off the result, as the doc says.
 */
export function tamMaStrength(daoTam: number, karma: number, dinhTamQuality: number | null = null): number {
  const dao = Math.min(100, Math.max(0, daoTam));
  const base = 1 + 0.5 * (1 - dao / 100) + Math.max(0, -karma) / 2000;
  return dinhTamQuality === null ? base : base * (1 - 0.1 * dinhTamQuality);
}

/** One bolt of a Lôi Kiếp: when its warning starts and when it hits, relative to the moment the first bolt is scheduled (t = 0). */
export interface BoltPlan {
  /** 1-based wave (đợt) */
  wave: number;
  /** 0-based strike inside the wave */
  strike: number;
  warnAtMs: number;
  hitAtMs: number;
  /** damage of this bolt (pure damage, 07 §3): `HP_ref · κ · 1,22^(w-1)` */
  damage: number;
}

/** HP_ref of docs/07 §3: base HP (no gear) at Viên Mãn of the realm being tribulated. */
export function hpRefOf(realm: number): number {
  return statsAt(realm, maxSubStage(realm)).hp;
}

/**
 * The full bolt schedule of a Lôi Kiếp: wave w starts `(w-1)·WAVE_INTERVAL_S` after the first one (07 §3: waves 8 s apart), the `m` strikes of a
 * wave `STRIKE_INTERVAL_S` apart; every bolt hits `BOLT_WARN_MS` after its warning starts. Deterministic, no randomness.
 */
export function boltSchedule(spec: TribulationSpec, hpRef: number): BoltPlan[] {
  const out: BoltPlan[] = [];
  for (let w = 1; w <= spec.waves; w++) {
    for (let s = 0; s < spec.strikesPerWave; s++) {
      const hitAtMs = MAJOR_EVENT.BOLT_WARN_MS + Math.round(((w - 1) * WAVE_INTERVAL_S + s * STRIKE_INTERVAL_S) * 1000);
      out.push({
        wave: w,
        strike: s,
        warnAtMs: hitAtMs - MAJOR_EVENT.BOLT_WARN_MS,
        hitAtMs,
        damage: Math.round(strikeDamage(hpRef, spec.kappa, w, LIGHTNING_GROWTH)),
      });
    }
  }
  return out;
}

/** Consequence of dying in a Lôi Kiếp (docs/01 §5.4): by the share of waves already survived. 0 = none (success / not a Kiếp death). */
export enum ConsequenceTier {
  None = 0,
  Light = 1,
  Medium = 2,
  Heavy = 3,
}

/** Nhẹ >= 2/3 of the waves survived, Trung 1/3 to < 2/3, Nặng < 1/3 (docs/01 §5.4). */
export function consequenceTier(wavesSurvived: number, waves: number): ConsequenceTier {
  const p = waves > 0 ? wavesSurvived / waves : 0;
  if (p >= 2 / 3 - 1e-9) return ConsequenceTier.Light;
  if (p >= 1 / 3 - 1e-9) return ConsequenceTier.Medium;
  return ConsequenceTier.Heavy;
}

/** Share of the CURRENT stage's tu vi lost per tier (docs/01 §5.4: Nhẹ 0, Trung 25%, Nặng 50%) and the major-breakthrough lock it causes. */
export const TIER_EXP_LOSS: Readonly<Record<ConsequenceTier, number>> = {
  [ConsequenceTier.None]: 0,
  [ConsequenceTier.Light]: 0,
  [ConsequenceTier.Medium]: 0.25,
  [ConsequenceTier.Heavy]: 0.5,
};
export function tierLockMs(tier: ConsequenceTier): number {
  return tier === ConsequenceTier.Heavy ? MAJOR_EVENT.HEAVY_LOCK_MS : 0;
}

/** How a major attempt ended. */
export enum MajorResult {
  /** still running (never the final result) */
  Running = 0,
  Success = 1,
  /** lost the Tâm Ma (killed, time out, left): no pity, 30 min lock */
  TamMaLost = 2,
  /** the Thiên Mệnh roll missed: pity +1 */
  RollFailed = 3,
  /** died in the Lôi Kiếp: pity +1, consequence by tier */
  Died = 4,
}

/** Event phases as the client sees them. */
export enum MajorPhase {
  TamMa = 1,
  Destiny = 2,
  Tribulation = 3,
  Ended = 4,
}
