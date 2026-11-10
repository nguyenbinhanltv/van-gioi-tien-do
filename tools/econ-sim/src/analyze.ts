import {
  DROP_TABLE,
  SINK_SOURCE_RATIO_TARGET,
  SINK_TARGETS,
  STONE_VALUE,
  expectedStoneValue,
  type DropEntry,
} from '@vgtd/shared';
import {
  ACTIVITIES,
  FAUCET_CHANNELS,
  SINK_CHANNELS,
  runSim,
  type Activity,
  type DayStat,
  type SimResult,
} from './sim.js';
import type { SimParams } from './params.js';

export interface WeekRow {
  week: number;
  faucet: number;
  sink: number;
  ratio: number;
  /** faucet per active player per day */
  faucetPerPlayerDay: number;
  sinkPerPlayerDay: number;
  medianWallet: number;
  p90Wallet: number;
  gini: number;
  pillMult: number;
  matMult: number;
  tau: number;
}

export interface Flag {
  severity: 'cao' | 'trung' | 'thấp' | 'thông tin';
  id: string;
  title: string;
  detail: string;
}

export interface Analysis {
  weeks: WeekRow[];
  /** weeks 5.. average ratio (steady state: the first weeks are the leveling burst) */
  steadyRatio: number;
  steadyFaucet: Record<string, number>;
  steadySink: Record<string, number>;
  sinkTargets: Array<{ key: string; target: number; modelled: number; channels: string[] }>;
  activityPerHour: Array<{ activity: Activity; hours: number; stones: number; perHour: number; cost: number }>;
  pacing: Array<{ group: string; realm: number; reached: number; p10: number; p50: number; p90: number }>;
  flags: Flag[];
}

const sum = (xs: readonly number[]): number => xs.reduce((a, b) => a + b, 0);
const fmt = (x: number): string => Math.round(x).toLocaleString('en-US').replace(/,/g, '.');
const d1c = (x: number): string => x.toFixed(1).replace('.', ',');
const pct = (x: number): string => `${(x * 100).toFixed(1).replace('.', ',')}%`;

export function weekly(days: readonly DayStat[]): WeekRow[] {
  const rows: WeekRow[] = [];
  for (let w = 0; w * 7 < days.length; w++) {
    const d = days.slice(w * 7, w * 7 + 7);
    const f = sum(d.map((x) => sum(FAUCET_CHANNELS.map((k) => x.faucet[k]))));
    const s = sum(d.map((x) => sum(SINK_CHANNELS.map((k) => x.sink[k]))));
    const activeDays = sum(d.map((x) => x.active));
    const last = d[d.length - 1]!;
    rows.push({
      week: w + 1,
      faucet: f,
      sink: s,
      ratio: f > 0 ? s / f : 0,
      faucetPerPlayerDay: activeDays > 0 ? f / activeDays : 0,
      sinkPerPlayerDay: activeDays > 0 ? s / activeDays : 0,
      medianWallet: last.medianWallet,
      p90Wallet: last.p90Wallet,
      gini: last.gini,
      pillMult: last.pillMult,
      matMult: last.matMult,
      tau: last.tau,
    });
  }
  return rows;
}

/** the ratio the docs gate on (07 s7, 26 s7.1): steady state = weeks 5 onwards, or the last half for short runs */
export function steadyRatio(rows: readonly WeekRow[]): number {
  const from = rows.length > 6 ? 4 : Math.floor(rows.length / 2);
  const part = rows.slice(from);
  const f = sum(part.map((r) => r.faucet));
  return f > 0 ? sum(part.map((r) => r.sink)) / f : 0;
}

/** chest EV share of the 12% thượng phẩm line (07 s6): the lottery inside the weekly boss chest */
export function bossThuongShare(): number {
  const e = (DROP_TABLE.boss as Record<string, DropEntry>)['stone_thuong']!;
  return (e.p * (e.qty ? (e.qty[0] + e.qty[1]) / 2 : 1) * STONE_VALUE.thuong) / expectedStoneValue('boss');
}

export function analyze(r: SimResult): Analysis {
  const P = r.params;
  const weeks = weekly(r.days);
  const from = weeks.length > 6 ? 4 : Math.floor(weeks.length / 2);
  const steadyDays = r.days.slice(from * 7);
  const steadyFaucet: Record<string, number> = {};
  const steadySink: Record<string, number> = {};
  for (const k of FAUCET_CHANNELS) steadyFaucet[k] = sum(steadyDays.map((d) => d.faucet[k]));
  for (const k of SINK_CHANNELS) steadySink[k] = sum(steadyDays.map((d) => d.sink[k]));
  const fTot = sum(Object.values(steadyFaucet));
  const sTot = sum(Object.values(steadySink));

  const groups: Record<string, string[]> = {
    breakthrough: ['breakthrough_cost'],
    marketTax: ['market_tax', 'listing_fee', 'trade_tax'],
    repair: ['repair'],
    guardianArrayAndLeyLine: [],
    teleport: ['teleport'],
    tierSwapAndOther: ['convert_fee', 'craft_fee'],
  };
  const sinkTargets = Object.entries(groups).map(([key, channels]) => ({
    key,
    target: SINK_TARGETS[key as keyof typeof SINK_TARGETS],
    modelled: sTot > 0 ? sum(channels.map((c) => steadySink[c] ?? 0)) / sTot : 0,
    channels,
  }));

  const activityPerHour = ACTIVITIES.map((a) => {
    const t = r.activity[a];
    return {
      activity: a,
      hours: t.hours,
      stones: t.stones,
      perHour: t.hours > 0 ? t.stones / t.hours : 0,
      cost: t.cost,
    };
  });

  const pacing: Analysis['pacing'] = [];
  for (const g of P.groups) {
    const ps = r.players.filter((p) => p.group === g.id);
    for (let realm = 2; realm <= 9; realm++) {
      const days = ps
        .map((p) => p.realmDay[realm - 1]!)
        .filter((d) => d > 0)
        .sort((a, b) => a - b);
      if (days.length === 0) continue;
      const q = (x: number): number => days[Math.min(days.length - 1, Math.floor(x * days.length))]!;
      pacing.push({ group: g.id, realm, reached: days.length / ps.length, p10: q(0.1), p50: q(0.5), p90: q(0.9) });
    }
  }

  const flags: Flag[] = [];
  const ratio = steadyRatio(weeks);
  const [lo, hi] = SINK_SOURCE_RATIO_TARGET;
  const low2 = weeks.slice(from).some((w, i, a) => i > 0 && w.ratio < lo && a[i - 1]!.ratio < lo);
  if (low2)
    flags.push({
      severity: 'cao',
      id: 'inflation',
      title: `Lạm phát Linh thạch: tỷ lệ tiêu hao / sinh ra ${ratio.toFixed(2).replace('.', ',')} (mục tiêu ${d1c(lo)}–${d1c(hi)})`,
      detail: `Tuần ${from + 1} trở đi dưới ${d1c(lo)} hai tuần liền (docs/26 §7.2). Phần tiêu hao thiếu mỗi người chơi mỗi ngày: ${fmt(
        weeks.slice(from).reduce((a, w) => a + (lo * w.faucet - w.sink), 0) /
          Math.max(1, sum(steadyDays.map((d) => d.active))),
      )} hạ phẩm để chạm ${d1c(lo)}.`,
    });
  else if (ratio > 1.05)
    flags.push({
      severity: 'cao',
      id: 'deflation',
      title: `Giảm phát: tỷ lệ ${ratio.toFixed(2)} > 1,05`,
      detail: 'Tiêu hao vượt sinh ra.',
    });
  const first = weeks[Math.min(3, weeks.length - 1)]!;
  const lastW = weeks[weeks.length - 1]!;
  if (first.medianWallet > 0 && lastW.medianWallet / first.medianWallet >= 2)
    flags.push({
      severity: 'cao',
      id: 'runaway-supply',
      title: `Lượng Linh thạch trong ví tăng không ngừng: trung vị ${fmt(first.medianWallet)} (tuần ${first.week}) → ${fmt(lastW.medianWallet)} (tuần ${lastW.week})`,
      detail:
        'Người chơi còn hoạt động tích lũy Linh thạch nhanh hơn mọi kênh tiêu hao rút ra; giá đan và nguyên liệu mất tín hiệu khi ví đầy.',
    });
  // dominant faucet channel
  const dropTotal = steadyFaucet['drop_field']! + steadyFaucet['drop_elite']! + steadyFaucet['drop_boss']!;
  for (const [k, v] of Object.entries(steadyFaucet)) {
    if (fTot > 0 && v / fTot >= 0.35)
      flags.push({
        severity: 'cao',
        id: `dominant-faucet-${k}`,
        title: `Kênh sinh ra chi phối: ${k} chiếm ${pct(v / fTot)} tổng Linh thạch sinh ra`,
        detail: `Rương boss tuần: ${pct(bossThuongShare())} giá trị kỳ vọng của rương nằm ở dòng "thượng phẩm 12% × 10.000" (07 §6): một quả xổ số, không phải thu nhập đều.`,
      });
  }
  const perHour = Object.fromEntries(activityPerHour.map((a) => [a.activity, a.perHour])) as Record<Activity, number>;
  const farmBest = Math.max(perHour.field, perHour.elite);
  if (farmBest > 0 && perHour.boss / farmBest >= 5)
    flags.push({
      severity: 'trung',
      id: 'dominant-loop-boss',
      title: `Vòng lặp chi phối theo giờ: boss tuần ${fmt(perHour.boss)} hạ phẩm/giờ so với ${fmt(farmBest)} khi săn thường (×${(perHour.boss / farmBest).toFixed(1).replace('.', ',')})`,
      detail: `Bị khóa theo tuần (1 rương / boss / tuần) nên không nhân lên được, nhưng một người chơi làm đủ rương tuần có phần lớn thu nhập tuần từ ~${P.bossMinutes} phút. Cần xem: số boss khả dụng mỗi tuần và hệ số rương theo cảnh giới.`,
    });
  const craft = activityPerHour.find((a) => a.activity === 'craft')!;
  const craftNet = craft.hours > 0 ? (craft.stones - craft.cost) / craft.hours : 0;
  flags.push({
    severity: craftNet > farmBest * 2 ? 'cao' : 'thông tin',
    id: 'crafting-loop',
    title: `Chế tạo: lãi ròng ${fmt(craftNet)} hạ phẩm mỗi giờ chế (săn thường ${fmt(farmBest)})`,
    detail: `Doanh thu sau thuế ${fmt(craft.stones)}, chi phí (phí lò + nguyên liệu theo giá chợ) ${fmt(craft.cost)}. Lãi âm nghĩa là nguyên liệu đắt hơn đan bán được ở giá chợ trong mô hình này.`,
  });
  const quests =
    steadyFaucet['quest_daily']! +
    steadyFaucet['quest_weekly']! +
    steadyFaucet['quest_main']! +
    steadyFaucet['quest_side']! +
    steadyFaucet['quest_sect']!;
  if (dropTotal > 0 && quests / dropTotal > 0.15)
    flags.push({
      severity: 'trung',
      id: 'quest-faucet',
      title: `Nhiệm vụ vượt trần 15% của docs/12 §4.2: ${pct(quests / dropTotal)} Linh thạch săn quái`,
      detail:
        'Kiểm bắt buộc trước khi duyệt dữ liệu nhiệm vụ: tổng faucet nhiệm vụ mỗi tuần ≤ 15% Linh thạch từ săn quái cùng người chơi.',
    });
  // sink channels with a target but no mechanism, and channels above their share
  for (const t of sinkTargets) {
    if (t.channels.length === 0 || (t.key === 'breakthrough' && t.modelled === 0))
      flags.push({
        severity: 'cao',
        id: `sink-missing-${t.key}`,
        title: `Kênh tiêu hao mục tiêu ${pct(t.target)} không có cơ chế Linh thạch: ${t.key}`,
        detail:
          t.key === 'breakthrough'
            ? 'docs/07 §7 và docs/26 §7.1 đặt 35% cho "đột phá và vật liệu đột phá" nhưng không tài liệu nào định nghĩa phí Linh thạch của đột phá; đan đột phá đi qua chợ (chuyển giữa người chơi, chỉ thuế bị hủy). Ngoài ra đột phá chỉ xảy ra vài lần mỗi nhân vật nên không thể là sink hằng ngày.'
            : 'Hộ Sơn Đại Trận / Linh Mạch: beta chỉ có tông môn NPC (D98), không có tông môn người chơi nên kênh này chưa tồn tại.',
      });
    else if (t.modelled > t.target * 2)
      flags.push({
        severity: 'thấp',
        id: `sink-over-${t.key}`,
        title: `Kênh ${t.key} chiếm ${pct(t.modelled)} tiêu hao (mục tiêu ${pct(t.target)})`,
        detail: 'Cơ cấu tiêu hao lệch xa cơ cấu mục tiêu của docs/07 §7 vì các kênh khác thiếu.',
      });
  }
  const mid = (P.groups.find((g) => g.id === 'regular') ?? P.groups[0]!).id;
  const reg = pacing.filter((p) => p.group === mid);
  const gate = reg.find((p) => p.realm === 4);
  flags.push({
    severity: 'thông tin',
    id: 'pacing',
    title: gate
      ? `Nhịp tu luyện: nhóm ${mid} qua cổng Kết Anh (vào Nguyên Anh) ở ngày trung vị ${gate.p50} (${pct(gate.reached)} nhóm tới được)`
      : `Nhịp tu luyện: nhóm ${mid} chưa tới cổng Kết Anh trong ${P.days} ngày`,
    detail:
      'Tu vi chỉ tăng khi tu luyện: tổng 41 nấc ≈ 47 giờ thuần (docs/12 §4.2) và 17 nấc đầu ≈ 5,6 giờ; thời gian chờ chủ yếu là đan đột phá, không phải tu vi. Đây là hệ quả trực tiếp của công thức 07 §5; game designer cần xem có muốn nhịp này không.',
  });
  // item supply that has no sink
  const stockPer = (k: string): number => (r.itemStock[k] ?? 0) / Math.max(1, P.players);
  if (stockPer('heal_pill') > 20)
    flags.push({
      severity: 'trung',
      id: 'item-heal',
      title: `Đan hồi phục dư: ${stockPer('heal_pill').toFixed(0)} viên mỗi người chơi cuối kỳ (dùng giả định 0,3 viên / giờ săn)`,
      detail:
        'Nguồn rơi (3% dã ngoại, 15% × 1–2 tinh anh) lớn hơn nhu cầu giả định; không có chợ hay NPC mua; nếu có thì giá trị κ = 0,01 × V_ref mỗi viên thành một faucet Linh thạch lớn (X7).',
    });
  if (stockPer('blueprint_low') > 1)
    flags.push({
      severity: 'thấp',
      id: 'item-blueprint',
      title: `Bản vẽ Trắng–Lục tích lũy ${stockPer('blueprint_low').toFixed(1)} bản mỗi người chơi`,
      detail: 'Không có kênh dùng hoặc hủy bản vẽ trong mô hình (chế tạo trang bị chưa mô phỏng).',
    });
  // doc discrepancy found while building the model
  flags.push({
    severity: 'thông tin',
    id: 'doc-daily-quest',
    title:
      'Mâu thuẫn trong docs/12 §4.2: nhiệm vụ nhật "0,25 giờ farm quy chuẩn" = 45 hạ phẩm ở r = 1, nhưng ghi chú ghi "≈ 90"',
    detail: `0,25 × ${P.fieldKillsPerHour} × ${expectedStoneValue('field').toFixed(1).replace('.', ',')} = ${fmt(0.25 * P.fieldKillsPerHour * expectedStoneValue('field'))}. Mô phỏng dùng đơn vị (45).`,
  });
  return { weeks, steadyRatio: ratio, steadyFaucet, steadySink, sinkTargets, activityPerHour, pacing, flags };
}

/** Bisection on the repair price multiplier (the docs' own weekly knob) that brings the steady sink/faucet ratio to `target`; undefined when out of [1, 64]. */
export function solveRepairMult(base: SimParams, target = SINK_SOURCE_RATIO_TARGET[0]): number | undefined {
  const run = (m: number): number => steadyRatio(weekly(runSim({ ...base, repairMult: m }).days));
  if (run(1) >= target) return 1;
  let lo = 1;
  let hi = 64;
  if (run(hi) < target) return undefined;
  for (let i = 0; i < 9; i++) {
    const mid = (lo + hi) / 2;
    if (run(mid) < target) lo = mid;
    else hi = mid;
  }
  return Math.round(hi * 10) / 10;
}
