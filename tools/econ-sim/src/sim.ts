/**
 * Cohort economy simulation (D113). `runSim(params)` replays `players` simulated players for `days` days and returns the daily ledger
 * (faucets and sinks per channel, stone supply, prices, pacing). Pure and deterministic: the same params and seed give the same result
 * (no Date.now / Math.random; iteration order is fixed).
 *
 * What is real: every formula and table comes from `@vgtd/shared` (drop table and modifiers, market tax / listing fee / direct trade tax,
 * teleport fee, durability and repair, cultivation minutes per stage, minor and major breakthrough success, root types). What is assumed is
 * behaviour and the gaps of the docs: `params.ts` `ASSUMPTIONS`.
 *
 * Money conservation: wallets change only by a faucet, a sink or a player-to-player transfer (market, which moves value from the buyer to the
 * seller and the tax / fee to a sink), so `sum(wallets) == sum(faucets) - sum(sinks)` at all times (tested).
 */
import {
  BOSS_REPEAT_STONE_FACTOR,
  BREAKTHROUGH,
  DROP_TABLE,
  DURABILITY_LOSS,
  DURABILITY_LOSS_PER_30MIN_COMBAT,
  FARM_DEPLETION,
  MARKET,
  MOB_DEFS,
  PLAYER_SMITH_STONE_FACTOR,
  QUALITY_DISTRIBUTION,
  ROOT_TYPES,
  STONE_VALUE,
  breakthroughSuccess,
  directTradeTax,
  expectedStoneValue,
  listingFee,
  lowRealmFactor,
  marketSaleTax,
  minorBreakthroughSuccess,
  minutesForStage,
  partyFactor,
  repairCost,
  stageToRealm,
  stoneRealmMultiplier,
  subStageCount,
  teleportFee,
  type DropEntry,
  type DropItem,
  type DropSource,
} from '@vgtd/shared';
import { Rand } from './rand.js';
import type { PlayGroup, SimParams } from './params.js';

export const FAUCET_CHANNELS = [
  'drop_field',
  'drop_elite',
  'drop_boss',
  'quest_daily',
  'quest_weekly',
  'quest_main',
  'quest_side',
  'quest_sect',
  'npc_sell',
] as const;
export const SINK_CHANNELS = [
  'market_tax',
  'listing_fee',
  'trade_tax',
  'craft_fee',
  'repair',
  'teleport',
  'convert_fee',
  'breakthrough_cost',
] as const;
export type FaucetChannel = (typeof FAUCET_CHANNELS)[number];
export type SinkChannel = (typeof SINK_CHANNELS)[number];
export type Activity = 'field' | 'elite' | 'boss' | 'quests' | 'craft';
export const ACTIVITIES: readonly Activity[] = ['field', 'elite', 'boss', 'quests', 'craft'];

/** docs/13 s5.1: kappa of the pill quality, V(r, q) = kappa x 1610 x 1.5^(r-1) */
export const KAPPA: readonly number[] = [0.15, 0.25, 0.4, 0.7, 1.2, 2.0];
/** docs/13 s4.3 quality ladder a_k and the Score step */
const LADDER_A = [0.5, 0.4, 0.3, 0.18, 0.08];
const CRAFT_FEE = 0.03; // docs/13 s6 (Đề xuất)
const TRIBULATION_DEATH_PP = DURABILITY_LOSS.death_tribulation * 100;
const PVE_DEATH_PP = DURABILITY_LOSS.death_pve * 100;
const COMBAT_PP_PER_HOUR = DURABILITY_LOSS_PER_30MIN_COMBAT * 100 * 2;

export interface DayStat {
  day: number;
  active: number;
  played: number;
  faucet: Record<FaucetChannel, number>;
  sink: Record<SinkChannel, number>;
  /** stones in the wallets of active players / of everybody (churned players keep theirs) */
  supplyActive: number;
  supplyAll: number;
  medianWallet: number;
  p90Wallet: number;
  gini: number;
  /** pill price multiplier of realms 1..3 (mean) and of crafting materials, tax rate of the week, weekly CPI */
  pillMult: number;
  matMult: number;
  tau: number;
  cpi: number;
  meanStage: number;
  /** item flows of the day */
  items: Record<string, number>;
  /** pills that could not be bought the day before / listed and unsold */
  pillUnmet: number;
  pillUnsold: number;
  breakthroughs: number;
  failures: number;
  forced: number;
}

export interface PlayerResult {
  group: PlayGroup['id'];
  crafter: boolean;
  active: boolean;
  stage: number;
  /** first day each realm 1..9 was reached (index r-1), 0 = not reached */
  realmDay: number[];
  wallet: number;
  cong: number;
}

export interface ActivityTotals {
  hours: number;
  /** stone-equivalent income (stones + the stone value of the pills that dropped at the realm's pill price is NOT included) */
  stones: number;
  /** crafting only: costs (fee + material value) */
  cost: number;
}

export interface SimResult {
  params: SimParams;
  days: DayStat[];
  players: PlayerResult[];
  activity: Record<Activity, ActivityTotals>;
  /** stones per player per day by group, for the faucet report */
  totals: { faucet: number; sink: number; supplyAll: number };
  /** Cống hiến supply (a separate currency, docs/26 s7.1 excludes it from the ratio) */
  contribution: { earned: number; members: number };
  /** item stock at the end: unconsumed items by kind */
  itemStock: Record<string, number>;
}

interface Player {
  group: PlayGroup;
  purity: number;
  crafter: boolean;
  sect: boolean;
  active: boolean;
  stage: number;
  progMin: number;
  waitDays: number;
  waitStamp: number;
  nFail: number;
  wallet: number;
  cong: number;
  deficit: number;
  /** pills[r][q] */
  pills: number[][];
  mats: number;
  heal: number;
  bp: [number, number, number];
  bossDone: number;
  weeklyDone: boolean;
  sideLeft: number;
  mainDone: boolean[];
  realmDay: number[];
  targetRealm: number;
}

const zeros = <K extends string>(keys: readonly K[]): Record<K, number> =>
  Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/** hạ phẩm value of the realm's weekly boss chest: 1610 at realm 1 (07 s6, 13 s5.1) */
export const V_REF_1 = expectedStoneValue('boss');
export const vRef = (realm: number): number => V_REF_1 * stoneRealmMultiplier(realm);
export const pillValue = (realm: number, q: number): number => KAPPA[q]! * vRef(realm);

export function gini(sortedAsc: readonly number[]): number {
  const n = sortedAsc.length;
  let total = 0;
  let weighted = 0;
  for (let i = 0; i < n; i++) {
    total += sortedAsc[i]!;
    weighted += (i + 1) * sortedAsc[i]!;
  }
  return n === 0 || total === 0 ? 0 : (2 * weighted) / (n * total) - (n + 1) / n;
}
const quantile = (sorted: readonly number[], q: number): number =>
  sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!;

export function runSim(params: SimParams): SimResult {
  const P = params;
  const rng = new Rand(P.seed);
  const nBoss = MOB_DEFS.filter((m) => m.tier === 'boss').length;
  /** hạ phẩm per field-monster hour at realm 1 (the docs' "giờ farm dã ngoại quy chuẩn", 07 s6: 180) */
  const wildUnit1 = expectedStoneValue('field') * P.fieldKillsPerHour;
  const wildUnit = (r: number): number => wildUnit1 * stoneRealmMultiplier(r);

  // ---- cohort
  const players: Player[] = [];
  for (const g of P.groups) {
    const n = Math.round(P.players * g.share);
    for (let i = 0; i < n; i++) {
      const root = ROOT_TYPES[rng.pick(ROOT_TYPES.map((t) => t.spawnWeight))]!;
      players.push({
        group: g,
        purity: root.purity,
        crafter: rng.next() < P.crafterShare,
        sect: rng.next() < P.sectShare,
        active: true,
        stage: 1,
        progMin: 0,
        waitDays: 0,
        waitStamp: -1,
        nFail: 0,
        wallet: 0,
        cong: 0,
        deficit: 0,
        pills: Array.from({ length: 10 }, () => new Array<number>(6).fill(0)),
        mats: 0,
        heal: 0,
        bp: [0, 0, 0],
        bossDone: 0,
        weeklyDone: false,
        sideLeft: P.sideQuestsPerRealm,
        mainDone: new Array<boolean>(10).fill(false),
        realmDay: new Array<number>(9).fill(0),
        targetRealm: 1,
      });
    }
  }
  for (const p of players) {
    p.realmDay[0] = 1;
    p.mainDone[1] = false;
  }

  // ---- market state
  const pillMult = new Array<number>(10).fill(1);
  let matMult = 1;
  let tau: number = MARKET.TAX_MIN;
  let cpi = 1;
  let weekIdxSum = 0;
  let prevWeekIdx = 0;
  const unmetByRealm = new Array<number>(10).fill(0);

  const activity: Record<Activity, ActivityTotals> = Object.fromEntries(
    ACTIVITIES.map((a) => [a, { hours: 0, stones: 0, cost: 0 }]),
  ) as Record<Activity, ActivityTotals>;
  const itemStock: Record<string, number> = {};
  const stock = (k: string, d: number): void => void (itemStock[k] = (itemStock[k] ?? 0) + d);
  let contributionEarned = 0;
  const days: DayStat[] = [];

  for (let day = 1; day <= P.days; day++) {
    const faucet = zeros(FAUCET_CHANNELS);
    const sink = zeros(SINK_CHANNELS);
    const items: Record<string, number> = {};
    const item = (k: string, d: number): void => {
      items[k] = (items[k] ?? 0) + d;
      stock(k, d);
    };
    let breakthroughs = 0;
    let failures = 0;
    let forced = 0;
    if ((day - 1) % 7 === 0) {
      for (const p of players) {
        p.bossDone = 0;
        p.weeklyDone = false;
      }
    }
    const dayInWeek = (day - 1) % 7;

    // ---- money helpers (every change goes through one of these)
    const earn = (p: Player, ch: FaucetChannel, x: number, act?: Activity): void => {
      if (x <= 0) return;
      p.wallet += x;
      faucet[ch] += x;
      if (act) activity[act].stones += x;
    };
    const spend = (p: Player, ch: SinkChannel, want: number): number => {
      const pay = Math.min(p.wallet, Math.max(0, want));
      p.wallet -= pay;
      sink[ch] += pay;
      return pay;
    };

    // ---- drops
    const applyDrops = (
      p: Player,
      src: DropSource,
      n: number,
      f: number,
      mobRealm: number,
      ch: FaucetChannel,
      act: Activity,
      stonesOnly = false,
    ): void => {
      if (n <= 0 || f <= 0) return;
      const mult = stoneRealmMultiplier(mobRealm);
      for (const [key, e] of Object.entries(DROP_TABLE[src]) as [DropItem, DropEntry][]) {
        const succ = rng.binom(n, Math.min(1, e.p * f * P.dropMult));
        if (succ === 0) continue;
        const stoneVal =
          key === 'stone_ha'
            ? 1
            : key === 'stone_trung'
              ? STONE_VALUE.trung
              : key === 'stone_thuong'
                ? STONE_VALUE.thuong
                : 0;
        if (stoneVal > 0) {
          const qty = e.qty ?? [1, 1];
          earn(p, ch, Math.round(rng.sumUniform(succ, qty[0], qty[1]) * mult) * stoneVal, act);
          continue;
        }
        if (stonesOnly) continue;
        const q = e.qty ?? [1, 1];
        if (key === 'craft_material') {
          const m = rng.sumUniform(succ, q[0], q[1]);
          p.mats += m;
          item('mats', m);
        } else if (key === 'heal_pill') {
          const m = rng.sumUniform(succ, q[0], q[1]);
          p.heal += m;
          item('heal_pill', m);
        } else if (key === 'breakthrough_pill') {
          for (let i = 0; i < succ; i++) {
            const qi = rng.pick(QUALITY_DISTRIBUTION[src]);
            p.pills[stageToRealm(p.stage).realm]![qi]!++;
            item('breakthrough_pill', 1);
          }
        } else if (key === 'blueprint_white_green') {
          p.bp[0] += succ;
          item('blueprint_low', succ);
        } else if (key === 'blueprint_blue_purple') {
          p.bp[1] += succ;
          item('blueprint_mid', succ);
        } else if (key === 'blueprint_gold_red') {
          p.bp[2] += succ;
          item('blueprint_high', succ);
        }
      }
    };

    // ---- cultivation and breakthroughs
    const ownedPills = (p: Player, realm: number): number => p.pills[realm]!.reduce((a, b) => a + b, 0);
    const advance = (p: Player, minutes: number): void => {
      let guard = 0;
      while (minutes > 0 && p.stage < P.maxStage && guard++ < 200) {
        const need = minutesForStage(p.stage, 1, p.purity, 1);
        if (p.progMin + minutes < need) {
          p.progMin += minutes;
          return;
        }
        minutes -= need - p.progMin;
        p.progMin = need;
        const ref = stageToRealm(p.stage);
        const major = ref.subStage === subStageCount(ref.realm);
        if (!major) {
          if (rng.next() < minorBreakthroughSuccess(ref.realm)) {
            p.stage++;
            p.progMin = 0;
          } else {
            p.progMin = Math.max(0, need - P.minorFailPenaltyMin);
            minutes -= 0;
            if (minutes <= P.minorFailPenaltyMin) return;
          }
          continue;
        }
        // major threshold out of `ref.realm`
        const have = ownedPills(p, ref.realm);
        const cost = P.breakthroughCostMult * vRef(ref.realm);
        const waiting = have < P.pillsWanted || p.wallet < cost;
        if (waiting && p.waitDays < P.attemptAfterWaitDays) {
          if (p.waitStamp !== day) {
            p.waitStamp = day;
            p.waitDays++;
          }
          return;
        }
        if (p.wallet < cost) return; // cannot pay the (assumed) fee: keep waiting
        if (waiting) forced++;
        if (cost > 0) spend(p, 'breakthrough_cost', cost);
        // use the best pills, at most MAX_PILLS
        const used: { kind: 'main'; quality: number; rightRealm: true }[] = [];
        for (let q = 5; q >= 0 && used.length < BREAKTHROUGH.MAX_PILLS; q--) {
          while (p.pills[ref.realm]![q]! > 0 && used.length < BREAKTHROUGH.MAX_PILLS) {
            p.pills[ref.realm]![q]!--;
            used.push({ kind: 'main', quality: q, rightRealm: true });
            item('breakthrough_pill', -1);
          }
        }
        p.waitDays = 0;
        const ok = rng.next() < breakthroughSuccess({ realm: ref.realm, pills: used, nFail: p.nFail });
        if (ok) {
          breakthroughs++;
          p.nFail = 0;
          p.stage++;
          p.progMin = 0;
          const r = ref.realm + 1;
          if (p.realmDay[r - 1] === 0) p.realmDay[r - 1] = day;
          if (r <= 3 && !p.mainDone[r]) {
            p.mainDone[r] = true;
            earn(p, 'quest_main', wildUnit(r), 'quests');
          }
        } else {
          failures++;
          p.nFail++;
          p.progMin = need * (1 - P.failLossFrac);
          if (ref.realm >= 2) p.deficit += TRIBULATION_DEATH_PP;
          return;
        }
      }
    };

    // ---- the day of one player
    let played = 0;
    for (const p of players) {
      if (!p.active) continue;
      const g = p.group;
      if (rng.next() >= g.playProb) continue;
      played++;
      const hours = g.hoursPerDay * (0.7 + 0.6 * rng.next());
      const realm = stageToRealm(p.stage).realm;
      let cultMin = hours * 60 * P.cultFrac;

      // quests (docs/12 s4.2)
      let questStones = 0;
      if (rng.next() < P.dailyQuestProb) {
        earn(p, 'quest_daily', 0.25 * wildUnit(realm), 'quests');
        questStones++;
        cultMin += 20;
      }
      if (!p.weeklyDone && rng.next() < P.weeklyQuestProb / 2.5) {
        p.weeklyDone = true;
        earn(p, 'quest_weekly', 1.0 * wildUnit(realm), 'quests');
        cultMin += 60;
      }
      if (p.sect && rng.next() < P.sectQuestProb) {
        earn(p, 'quest_sect', 0.1 * wildUnit(realm), 'quests');
        cultMin += 10;
        p.cong += P.sectDailyContribution;
        contributionEarned += P.sectDailyContribution;
      }
      const side = Math.min(p.sideLeft, rng.poisson(P.sideQuestsPerDay));
      if (side > 0) {
        p.sideLeft -= side;
        earn(p, 'quest_side', side * 0.05 * wildUnit(realm), 'quests');
        cultMin += 5 * side;
      }
      void questStones;

      // farming (docs/07 s6) with the farm-depletion rule
      let farmH = hours * P.farmFrac;
      const nSess = Math.max(1, Math.round(hours / g.sessionHours));
      const per = farmH / nSess;
      const eff =
        nSess *
        (Math.min(per, FARM_DEPLETION.AFTER_HOURS) +
          FARM_DEPLETION.MULTIPLIER * Math.max(0, per - FARM_DEPLETION.AFTER_HOURS));
      const bossToday = rng.next() < Math.min(1, g.bossPerWeek / (7 * g.playProb));
      if (bossToday) farmH = Math.max(0, farmH - P.bossMinutes / 60);
      const effFarm = farmH === 0 ? 0 : eff * (farmH / (hours * P.farmFrac));
      const party = partyFactor(4);
      for (const [tier, perHour, share] of [
        ['field', P.fieldKillsPerHour, 1 - P.eliteTimeShare],
        ['elite', P.eliteKillsPerHour, P.eliteTimeShare],
      ] as const) {
        const hrs = effFarm * share;
        activity[tier].hours += hrs;
        const src: DropSource = tier === 'field' ? 'field' : 'elite';
        const ch: FaucetChannel = tier === 'field' ? 'drop_field' : 'drop_elite';
        for (const [kills, loot] of [
          [perHour * hrs * (1 - P.partyShare), 1],
          [perHour * hrs * P.partyShare * P.partyKillBoost, party],
        ] as const) {
          for (const gap of realm === 1 ? [0] : [0, 1]) {
            const portion = realm === 1 ? 1 : gap === 0 ? P.atRealmShare : 1 - P.atRealmShare;
            const f = (lowRealmFactor(gap) ?? 0) * loot;
            applyDrops(p, src, kills * portion, f, Math.max(1, realm - gap), ch, tier);
          }
        }
      }
      // heal pills are used up in the fights (item sink)
      const useHeal = Math.min(p.heal, Math.round(P.healUsePerFarmHour * effFarm));
      p.heal -= useHeal;
      item('heal_pill', -useHeal);

      // weekly boss chest (07 s6): the first kill of each boss per week pays the full chest, repeats only stones x0.3
      if (bossToday) {
        const b = (rng.next() * nBoss) | 0;
        activity.boss.hours += P.bossMinutes / 60;
        if ((p.bossDone & (1 << b)) === 0) {
          p.bossDone |= 1 << b;
          applyDrops(p, 'boss', 1, 1, realm, 'drop_boss', 'boss');
        } else {
          applyDrops(p, 'boss', 1, BOSS_REPEAT_STONE_FACTOR, realm, 'drop_boss', 'boss', true);
        }
      }
      // kill rewards of the NPC sect (D98): Cống hiến, never stones
      if (p.sect) {
        const c =
          Math.round(P.fieldKillsPerHour * effFarm * (1 - P.eliteTimeShare)) * 1 +
          Math.round(P.eliteKillsPerHour * effFarm * P.eliteTimeShare) * 5;
        p.cong += c;
        contributionEarned += c;
      }

      // wear and tear, repair (07 s7)
      const deaths = rng.poisson(P.deathsPerFarmHour * effFarm);
      p.deficit += deaths * PVE_DEATH_PP + COMBAT_PP_PER_HOUR * effFarm;
      if (p.deficit >= P.repairAtDeficit) {
        const gear = P.gearPieces * P.gearKappa * vRef(realm);
        const smith = rng.next() < P.smithShare;
        const full = repairCost(gear, Math.min(100, p.deficit)) * P.repairMult;
        const paid = spend(p, 'repair', smith ? full * PLAYER_SMITH_STONE_FACTOR : full);
        if (paid >= (smith ? full * PLAYER_SMITH_STONE_FACTOR : full) - 1e-9) p.deficit = 0;
      }
      // paid teleports
      const trips = rng.poisson(g.teleportsPerDay);
      for (let i = 0; i < trips; i++) spend(p, 'teleport', teleportFee(realm, 1 + (rng.next() < 0.5 ? 1 : 0)));
      // converting stones up a denomination (docs/26 s7.1)
      if (p.wallet >= P.convertMinWallet && rng.next() < P.convertProbPerDay)
        spend(p, 'convert_fee', 0.5 * p.wallet * rng.next() * P.convertFee);

      // crafting (docs/13)
      if (p.crafter) {
        const craftH = hours * P.craftFrac;
        activity.craft.hours += craftH;
        const tr = p.targetRealm;
        const ceil = P.recipeCeil;
        const matNeed = Math.ceil(pillValue(tr, ceil) / P.matUnitValue);
        const D = ceil + 1;
        const pOk = Math.min(0.98, Math.max(0.4, 0.95 - 0.07 * (D - 1) + 0.02 * P.craftScore));
        const crafts = rng.poisson(P.craftsPerHour * craftH);
        for (let i = 0; i < crafts; i++) {
          const fee = CRAFT_FEE * pillValue(tr, ceil);
          if (p.mats < matNeed || p.wallet < fee) break;
          spend(p, 'craft_fee', fee);
          activity.craft.cost += fee;
          if (rng.next() < pOk) {
            p.mats -= matNeed;
            item('mats', -matNeed);
            activity.craft.cost += matNeed * P.matUnitValue * matMult * 0.6;
            let q = 0;
            while (q < 5 && rng.next() < Math.min(0.9, LADDER_A[q]! + 0.04 * P.craftScore)) q++;
            q = Math.min(q, ceil);
            p.pills[tr]![q]!++;
            item('breakthrough_pill', 1);
          } else {
            const lost = Math.ceil(matNeed * 0.6);
            p.mats -= lost;
            item('mats', -lost);
            activity.craft.cost += lost * P.matUnitValue * matMult;
          }
        }
      }
      advance(p, cultMin);
      const r2 = stageToRealm(p.stage).realm;
      if (p.stage > 1 && p.realmDay[r2 - 1] === 0) p.realmDay[r2 - 1] = day;
    }

    // ---- market: pills (per realm) and materials
    const idxPill = (pillMult[1]! + pillMult[2]! + pillMult[3]!) / 3;
    void idxPill;
    interface Lot {
      p: Player;
      qty: number;
    }
    const sellNet = (seller: Player, gross: number, direct: boolean): void => {
      const taxRate = direct ? MARKET.DIRECT_TRADE_TAX : tau;
      const tax = direct ? directTradeTax(gross) : gross * taxRate;
      const fee = direct ? 0 : listingFee(gross);
      sink[direct ? 'trade_tax' : 'market_tax'] += Math.min(tax, gross);
      sink.listing_fee += Math.min(fee, Math.max(0, gross - tax));
      const net = Math.max(0, gross - tax - fee);
      seller.wallet += net;
      if (seller.crafter) activity.craft.stones += net;
    };
    let pillUnmet = 0;
    let pillUnsold = 0;
    unmetByRealm.fill(0);
    for (let r = 1; r <= 9; r++) {
      // sellers: crafters list every pill; other players keep up to 3 pills of their own next threshold realm, list the rest
      const lots: Lot[][] = Array.from({ length: 6 }, () => []);
      for (const p of players) {
        if (!p.active) continue;
        const own = stageToRealm(p.stage).realm === r && !p.crafter;
        let keep = own ? 3 : 0;
        for (let q = 5; q >= 0; q--) {
          const n = p.pills[r]![q]!;
          if (n === 0) continue;
          const k = Math.min(n, keep);
          keep -= k;
          if (n - k > 0) lots[q]!.push({ p, qty: n - k });
        }
      }
      // buyers: players at the viên mãn stage of realm r who passed `preBuyAt` of it
      const buyers: Player[] = [];
      for (const p of players) {
        if (!p.active || p.stage >= P.maxStage) continue;
        const ref = stageToRealm(p.stage);
        if (ref.realm !== r || ref.subStage !== subStageCount(r)) continue;
        if (p.progMin < P.preBuyAt * minutesForStage(p.stage, 1, p.purity, 1)) continue;
        if (ownedPills(p, r) >= P.pillsWanted) continue;
        buyers.push(p);
      }
      // random order (deterministic): Fisher-Yates over the buyers
      for (let i = buyers.length - 1; i > 0; i--) {
        const j = (rng.next() * (i + 1)) | 0;
        [buyers[i], buyers[j]] = [buyers[j]!, buyers[i]!];
      }
      let supplyLeft = 0;
      for (const l of lots) for (const x of l) supplyLeft += x.qty;
      let unmet = 0;
      for (const b of buyers) {
        let want = P.pillsWanted - ownedPills(b, r);
        for (let q = Math.min(5, P.pillMaxQuality); q >= 0 && want > 0; q--) {
          const price = pillValue(r, q) * pillMult[r]!;
          const afford = Math.floor((b.wallet * P.pillBudgetShare) / price);
          if (afford < 1) continue;
          const pool = lots[q]!;
          while (want > 0 && pool.length > 0 && b.wallet >= price) {
            const lot = pool[pool.length - 1]!;
            if (lot.p === b) {
              pool.pop();
              continue;
            }
            const take = Math.min(want, lot.qty, Math.floor(b.wallet / price));
            if (take < 1) break;
            const gross = take * price;
            b.wallet -= gross;
            lot.p.pills[r]![q]! -= take;
            b.pills[r]![q]! += take;
            sellNet(lot.p, gross, rng.next() < P.directTradeShare);
            lot.qty -= take;
            if (lot.qty <= 0) pool.pop();
            want -= take;
            supplyLeft -= take;
          }
        }
        // only a want the buyer could pay for (at the cheapest quality) is demand that the price should answer
        if (want > 0 && b.wallet * P.pillBudgetShare >= pillValue(r, 0) * pillMult[r]!) unmet += want;
      }
      pillUnmet += unmet;
      pillUnsold += supplyLeft;
      unmetByRealm[r] = unmet;
      if (buyers.length > 0 || supplyLeft > 0) {
        const imb = (unmet - supplyLeft) / Math.max(1, unmet + supplyLeft);
        pillMult[r] = Math.min(P.priceMax, Math.max(P.priceMin, pillMult[r]! * (1 + P.priceStep * imb)));
      }
    }
    // crafters follow the pill shortage: the realm with the most unmet demand yesterday
    let bestR = 1;
    for (let r = 1; r <= 9; r++) if (unmetByRealm[r]! > unmetByRealm[bestR]!) bestR = r;
    for (const p of players)
      p.targetRealm = unmetByRealm[bestR]! > 0 ? bestR : Math.min(3, stageToRealm(p.stage).realm);

    // materials: non-crafters sell everything, crafters buy what their next crafts need
    const matSellers: Lot[] = [];
    let matSupply = 0;
    for (const p of players) {
      if (!p.active || p.crafter || p.mats <= 0) continue;
      matSellers.push({ p, qty: p.mats });
      matSupply += p.mats;
    }
    const matPrice = P.matUnitValue * matMult;
    let matUnmet = 0;
    const crafters = players.filter((p) => p.active && p.crafter);
    for (const c of crafters) {
      const tr = c.targetRealm;
      const need = Math.max(0, Math.ceil(pillValue(tr, P.recipeCeil) / P.matUnitValue) * 2 - c.mats);
      let want = Math.min(need, Math.floor((c.wallet * 0.5) / matPrice));
      while (want > 0 && matSellers.length > 0) {
        const lot = matSellers[matSellers.length - 1]!;
        const take = Math.min(want, lot.qty);
        const gross = take * matPrice;
        c.wallet -= gross;
        c.mats += take;
        lot.p.mats -= take;
        activity.craft.cost += 0; // the purchase price is counted when the materials are consumed
        sellNet(lot.p, gross, rng.next() < P.directTradeShare);
        lot.qty -= take;
        matSupply -= take;
        want -= take;
        if (lot.qty <= 0) matSellers.pop();
      }
      matUnmet += want;
    }
    if (P.npcBuyFrac > 0) {
      for (const lot of matSellers) {
        if (lot.qty <= 0) continue;
        const gross = lot.qty * P.matUnitValue * P.npcBuyFrac;
        earn(lot.p, 'npc_sell', gross);
        item('mats', -lot.qty);
        lot.p.mats -= lot.qty;
        matSupply -= lot.qty;
      }
    }
    if (crafters.length > 0 || matSupply > 0)
      matMult = Math.min(
        P.priceMax,
        Math.max(
          P.priceMin,
          matMult * (1 + P.priceStep * ((matUnmet - matSupply) / Math.max(1, matUnmet + matSupply))),
        ),
      );

    // ---- weekly CPI and tax (07 s7): basket = realm 1..3 pills and materials
    weekIdxSum += (idxPill + matMult) / 2;
    if (dayInWeek === 6) {
      const idx = weekIdxSum / 7;
      cpi = prevWeekIdx > 0 ? idx / prevWeekIdx : 1;
      tau = marketSaleTax(cpi);
      prevWeekIdx = idx;
      weekIdxSum = 0;
    }

    // ---- churn and the day's numbers
    for (const p of players) if (p.active && rng.next() < p.group.churnPerDay) p.active = false;
    const act = players.filter((p) => p.active);
    const wallets = act.map((p) => p.wallet).sort((a, b) => a - b);
    let supplyAll = 0;
    for (const p of players) supplyAll += p.wallet;
    let stageSum = 0;
    for (const p of act) stageSum += p.stage;
    days.push({
      day,
      active: act.length,
      played,
      faucet,
      sink,
      supplyActive: wallets.reduce((a, b) => a + b, 0),
      supplyAll,
      medianWallet: quantile(wallets, 0.5),
      p90Wallet: quantile(wallets, 0.9),
      gini: gini(wallets),
      pillMult: (pillMult[1]! + pillMult[2]! + pillMult[3]!) / 3,
      matMult,
      tau,
      cpi,
      meanStage: act.length ? stageSum / act.length : 0,
      items,
      pillUnmet,
      pillUnsold,
      breakthroughs,
      failures,
      forced,
    });
  }

  let totalF = 0;
  let totalS = 0;
  for (const d of days) {
    for (const k of FAUCET_CHANNELS) totalF += d.faucet[k];
    for (const k of SINK_CHANNELS) totalS += d.sink[k];
  }
  return {
    params: P,
    days,
    players: players.map((p) => ({
      group: p.group.id,
      crafter: p.crafter,
      active: p.active,
      stage: p.stage,
      realmDay: p.realmDay,
      wallet: p.wallet,
      cong: p.cong,
    })),
    activity,
    totals: { faucet: totalF, sink: totalS, supplyAll: days.at(-1)?.supplyAll ?? 0 },
    contribution: { earned: contributionEarned, members: players.filter((p) => p.sect).length },
    itemStock,
  };
}
