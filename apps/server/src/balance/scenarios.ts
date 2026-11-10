/**
 * Class-balance harness (D115): the scenario matrix and its statistics. Everything here is a pure function of the configuration.
 */
import { HARD_CC, PATHS, classOf, skillDefinitions, type PathId } from '@vgtd/shared';
import { runDummy } from '@vgtd/shared';
import { runFight, pickSeeds, type FightResult } from './rig.js';
import { runDuel } from './duel.js';
import { kitCoverage, branchFor, unmodelledBranchMods, type BranchMode, type KitCoverage } from './defs.js';

export type Tier = 'normal' | 'elite' | 'boss';
export interface Band {
  id: string;
  name: string;
  realm: number;
  /** representative mob def per tier (docs/10 §4); null = the band has none */
  mobs: Record<Tier, string | null>;
}
/** Realm bands of the task (Luyện Khí, Trúc Cơ, Kim Đan); the mobs are the docs/10 defs whose level range sits in the realm. */
export const BANDS: readonly Band[] = [
  {
    id: 'luyen_khi',
    name: 'Luyện Khí',
    realm: 1,
    mobs: { normal: 'mob_hoi_lang', elite: 'elite_lang_vuong', boss: null },
  },
  {
    id: 'truc_co',
    name: 'Trúc Cơ',
    realm: 2,
    mobs: { normal: 'mob_doc_thiem', elite: 'elite_thiem_vuong', boss: null },
  },
  {
    id: 'kim_dan',
    name: 'Kim Đan',
    realm: 3,
    mobs: { normal: 'mob_huyet_diep', elite: 'elite_co_can_mau', boss: 'boss_ho_vuong' },
  },
];
export const TIER_LIMIT_S: Record<Tier, number> = { normal: 120, elite: 300, boss: 900 };

export interface BalanceConfig {
  /** seeds (= different mob levels of the same realm) per tier */
  seeds: Record<Tier, number>;
  duelSeeds: number;
  /** a class is an outlier when its figure is more than this far from the median of the six classes */
  outlierBand: number;
  /** reference realm / sub-stage of the duels */
  duelRealm: { realm: number; subStage: number };
}
export const DEFAULT_CONFIG: BalanceConfig = {
  seeds: { normal: 6, elite: 4, boss: 3 },
  duelSeeds: 6,
  outlierBand: 0.15,
  duelRealm: { realm: 2, subStage: 3 },
};
export const QUICK_CONFIG: BalanceConfig = {
  seeds: { normal: 2, elite: 2, boss: 1 },
  duelSeeds: 2,
  outlierBand: 0.15,
  duelRealm: { realm: 2, subStage: 3 },
};

export const median = (xs: readonly number[]): number => {
  if (xs.length === 0) return Number.NaN;
  const s = [...xs].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const mean = (xs: readonly number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : Number.NaN);

// ---------------------------------------------------------------------------------------------------- solo PvE
export interface SoloSummary {
  band: string;
  tier: Tier;
  path: PathId;
  mode: BranchMode;
  mob: string;
  runs: number;
  /** share of runs where the mob died */
  killRate: number;
  /** share of runs where the player lived to the end */
  survival: number;
  /** median seconds to kill over the runs that killed it (NaN when none) */
  ttkS: number;
  /**
   * Median projected TTK: the kill time when it was killed, else the time spent divided by the share of its HP removed (what the fight would take
   * at the damage rate seen, ignoring the player's death). Comparable between classes even when some die.
   */
  projTtkS: number;
  /** median damage per second over the whole fight */
  dps: number;
  /** median of the lowest HP fraction reached */
  minHp: number;
  /** damage taken per second of fight, as a share of max HP (median) */
  dtps: number;
  pills: number;
  mobHpLeft: number;
}

function summarise(band: Band, tier: Tier, path: PathId, mode: BranchMode, runs: FightResult[]): SoloSummary {
  const kills = runs.filter((r) => r.killed);
  const proj = runs.map((r) => (r.killed ? r.ttkS! : r.timeS / Math.max(1e-6, 1 - r.mobHpLeft)));
  return {
    band: band.id,
    tier,
    path,
    mode,
    mob: band.mobs[tier]!,
    runs: runs.length,
    killRate: kills.length / runs.length,
    survival: runs.filter((r) => r.players[0]!.deaths === 0).length / runs.length,
    ttkS: median(kills.map((r) => r.ttkS!)),
    projTtkS: median(proj),
    dps: median(runs.map((r) => r.players[0]!.damage / Math.max(1, r.timeS))),
    minHp: median(runs.map((r) => r.players[0]!.minHp)),
    dtps: median(runs.map((r) => r.players[0]!.taken / Math.max(1, r.timeS) / Math.max(1, r.players[0]!.hpMax))),
    pills: mean(runs.map((r) => r.players[0]!.pills)),
    mobHpLeft: median(runs.map((r) => r.mobHpLeft)),
  };
}

export function runSolo(cfg: BalanceConfig): SoloSummary[] {
  const out: SoloSummary[] = [];
  for (const band of BANDS) {
    for (const tier of ['normal', 'elite', 'boss'] as const) {
      const mob = band.mobs[tier];
      if (!mob) continue;
      const seeds = pickSeeds(mob, band.realm, cfg.seeds[tier]);
      for (const path of PATHS) {
        for (const mode of ['solo', 'team'] as const) {
          const runs = seeds.map((seed) =>
            runFight({ mob, seed, players: [{ path, mode }], limitS: TIER_LIMIT_S[tier], stopOnDeath: true }),
          );
          out.push(summarise(band, tier, path, mode, runs));
        }
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- party
export interface PartySummary {
  path: PathId;
  mode: BranchMode;
  team: PathId[];
  runs: number;
  killRate: number;
  killTimeS: number;
  deathsPerRun: number;
  /** median seconds until the team was wiped (or the limit), and the share of the boss's HP still left then */
  wipeS: number;
  bossHpLeft: number;
  /** the class under test: median damage / heal / shield per second and its share of the team's total (damage + heal + shield) */
  dps: number;
  hps: number;
  sps: number;
  share: number;
}
const REFERENCE_ALLIES: readonly PathId[] = ['the', 'dan_phu', 'dao', 'kiem'];
export const PARTY_BOSS = { mob: 'boss_ho_vuong', realm: 3, limitS: 600 } as const;

/** One member (`path`, `mode`) added to three fixed reference allies, against the Kim Đan boss. */
export function runParty(cfg: BalanceConfig): PartySummary[] {
  const seeds = pickSeeds(PARTY_BOSS.mob, PARTY_BOSS.realm, cfg.seeds.boss);
  const out: PartySummary[] = [];
  for (const path of PATHS) {
    const allies = REFERENCE_ALLIES.filter((x) => x !== path).slice(0, 3);
    for (const mode of ['solo', 'team'] as const) {
      const runs = seeds.map((seed) =>
        runFight({
          mob: PARTY_BOSS.mob,
          seed,
          players: [{ path, mode }, ...allies.map((p) => ({ path: p, mode: 'solo' as const }))],
          limitS: PARTY_BOSS.limitS,
        }),
      );
      const per = (f: (r: FightResult) => number): number => median(runs.map(f));
      const total = (r: FightResult): number => r.players.reduce((n, p) => n + p.damage + p.heal + p.shield, 0);
      out.push({
        path,
        mode,
        team: [path, ...allies],
        runs: runs.length,
        killRate: runs.filter((r) => r.killed).length / runs.length,
        killTimeS: median(runs.filter((r) => r.killed).map((r) => r.ttkS!)),
        deathsPerRun: mean(runs.map((r) => r.players.reduce((n, p) => n + p.deaths, 0))),
        wipeS: median(runs.map((r) => r.timeS)),
        bossHpLeft: median(runs.map((r) => r.mobHpLeft)),
        dps: per((r) => r.players[0]!.damage / Math.max(1, r.timeS)),
        hps: per((r) => r.players[0]!.heal / Math.max(1, r.timeS)),
        sps: per((r) => r.players[0]!.shield / Math.max(1, r.timeS)),
        share: per((r) => (r.players[0]!.damage + r.players[0]!.heal + r.players[0]!.shield) / Math.max(1, total(r))),
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------------------------------------------- duels
export interface DuelMatrix {
  realm: number;
  subStage: number;
  runs: number;
  /** win rate (draws count half) of the row class against the column class, 0..1 */
  winRate: Record<PathId, Record<PathId, number>>;
  /** median fight length (s) */
  timeS: Record<PathId, Record<PathId, number>>;
}
export function runDuels(cfg: BalanceConfig): DuelMatrix {
  const { realm, subStage } = cfg.duelRealm;
  const winRate = {} as DuelMatrix['winRate'];
  const timeS = {} as DuelMatrix['timeS'];
  for (const a of PATHS) {
    winRate[a] = {} as Record<PathId, number>;
    timeS[a] = {} as Record<PathId, number>;
    for (const b of PATHS) {
      const rs = Array.from({ length: cfg.duelSeeds }, (_v, k) => runDuel(a, b, 'solo', realm, subStage, 100 + k));
      winRate[a][b] = rs.reduce((n, r) => n + (r.winner === 'a' ? 1 : r.winner === 'draw' ? 0.5 : 0), 0) / rs.length;
      timeS[a][b] = median(rs.map((r) => r.timeS));
    }
  }
  return { realm, subStage, runs: cfg.duelSeeds, winRate, timeS };
}

// ---------------------------------------------------------------------------------------------------- static data views
export interface KitRow extends KitCoverage {
  role: string;
  /** designed hard-CC potential: sum of (duration / cooldown) over the kit's hard CC effects, in "bodies controlled at once" (design data, NOT run on the server) */
  designedCcPotential: number;
  ccSkills: number;
  /** design simulation: solo dummy ratio vs the class basic attack (docs/11 §4.5) */
  designRatio: number;
  unmodelledSolo: string[];
  unmodelledTeam: string[];
}
export function kitRows(): KitRow[] {
  return PATHS.map((path) => {
    const cov = kitCoverage(path);
    let cc = 0;
    let n = 0;
    for (const s of skillDefinitions.skills) {
      if (s.path !== path || s.kind !== 'active') continue;
      let has = false;
      for (const e of s.effects) {
        if (e.type === 'status' && e.status_id && HARD_CC.includes(e.status_id) && e.duration_ms) {
          cc += e.duration_ms / Math.max(s.timing.cooldown_ms, e.duration_ms);
          has = true;
        }
      }
      if (has) n++;
    }
    return {
      ...cov,
      role: classOf(path).role,
      designedCcPotential: Math.min(1, cc),
      ccSkills: n,
      designRatio: runDummy({ path, mode: 'solo' }).ratio,
      unmodelledSolo: unmodelledBranchMods(branchFor(path, 'solo')),
      unmodelledTeam: unmodelledBranchMods(branchFor(path, 'team')),
    };
  });
}

// ---------------------------------------------------------------------------------------------------- outliers
export interface Outlier {
  where: string;
  path: PathId;
  mode: BranchMode;
  metric: string;
  value: number;
  median: number;
  /** value / median - 1 */
  delta: number;
}
/** Flag every (cell, class) whose `metric` is further than `band` from the median of the six classes of the same cell and mode. */
export function findOutliers(
  rows: readonly SoloSummary[],
  band: number,
  metric: 'projTtkS' | 'dps' | 'dtps',
  label: string,
): Outlier[] {
  const out: Outlier[] = [];
  const cells = new Map<string, SoloSummary[]>();
  for (const r of rows) {
    const k = `${r.band}|${r.tier}|${r.mode}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(r);
  }
  for (const [k, rs] of cells) {
    const m = median(rs.map((r) => r[metric]));
    for (const r of rs) {
      const d = r[metric] / m - 1;
      if (Number.isFinite(d) && Math.abs(d) > band)
        out.push({
          where: k.replace(/\|/g, ' / '),
          path: r.path,
          mode: r.mode,
          metric: label,
          value: r[metric],
          median: m,
          delta: d,
        });
    }
  }
  return out;
}
