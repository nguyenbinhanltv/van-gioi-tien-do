/**
 * Simulation parameters (D113). Everything the docs fix comes from `@vgtd/shared` (drop table, market, teleport, repair, cultivation,
 * breakthrough formulas): this file only holds the BEHAVIOUR of the simulated players and the numbers the docs leave open. Every such number
 * is listed in `ASSUMPTIONS` (printed in the report) and is "cần game designer duyệt": nothing here is a gameplay value.
 * The parameter set is versioned: a report names its `PARAMS_VERSION` and seed so a run can be reproduced exactly.
 */
export const PARAMS_VERSION = 1;

export type GroupId = 'casual' | 'regular' | 'hardcore';

export interface PlayGroup {
  id: GroupId;
  /** share of the cohort */
  share: number;
  /** hours played on a day the player logs in */
  hoursPerDay: number;
  /** probability of playing on a given day */
  playProb: number;
  /** one continuous session length (h): depletion x0.5 applies to farming beyond 2 h (07 s6) */
  sessionHours: number;
  /** daily probability of quitting for good */
  churnPerDay: number;
  /** boss chest kills per week (docs/07 s6: 1 chest per boss per week) */
  bossPerWeek: number;
  /** extra paid teleports per played day */
  teleportsPerDay: number;
}

export interface SimParams {
  /** cohort size */
  players: number;
  days: number;
  seed: number;
  /** highest flat stage 1..41 a player can reach (beta scope: 18 = Kim Đan Viên Mãn + the Kết Anh gate, docs/10 s7.1) */
  maxStage: number;
  groups: readonly PlayGroup[];

  // ---- time split of a played day (assumed)
  cultFrac: number;
  farmFrac: number;
  craftFrac: number;
  // ---- farming (docs/07 s6 "Nhịp điển hình")
  fieldKillsPerHour: number;
  eliteKillsPerHour: number;
  /** share of kills at the player's own realm; the rest is 1 realm below (x0.2, 07 s6) (assumed) */
  atRealmShare: number;
  /** share of farming done in a party of 4 and the kill-speed gain of a party (assumed); loot factor is `partyFactor(4)` */
  partyShare: number;
  partyKillBoost: number;
  /** share of the farming hours spent on elites (20 / h) instead of field monsters (150 / h) (assumed) */
  eliteTimeShare: number;
  /** recovery pills used per farming hour (assumed) */
  healUsePerFarmHour: number;
  /** minutes spent per weekly boss kill (assumed) */
  bossMinutes: number;
  /** multiplier on every drop probability (sensitivity runs: 0.8 / 1.2, docs/26 s8 M1) */
  dropMult: number;
  // ---- deaths, repair, travel
  deathsPerFarmHour: number;
  /** wear items value: pieces x kappa(Lam) x V_ref(r) (docs/13 s5.1) (assumed) */
  gearPieces: number;
  gearKappa: number;
  /** repair when the missing durability reaches this many percentage points */
  repairAtDeficit: number;
  /** share of repairs done by a player smith (pays 50% of the NPC fee, 07 s7) */
  smithShare: number;
  /** multiplier on the repair price (the docs' weekly adjustment knob, 07 s7 "nhân phí sửa chữa 1,1"); sensitivity only */
  repairMult: number;
  // ---- convert fee (docs/26 s7.1 "đổi phẩm 5%")
  convertFee: number;
  convertProbPerDay: number;
  convertMinWallet: number;
  // ---- quests (docs/12 s4.2): done probabilities (assumed)
  dailyQuestProb: number;
  weeklyQuestProb: number;
  sectQuestProb: number;
  sideQuestsPerDay: number;
  sideQuestsPerRealm: number;
  /** players that join the NPC sect (D98) */
  sectShare: number;
  /** Cống hiến from a sect daily set (docs: "số nguyên cố định trong dữ liệu", unspecified) (assumed) */
  sectDailyContribution: number;
  // ---- crafting (docs/13)
  crafterShare: number;
  /** crafts per hour spent crafting (assumed) */
  craftsPerHour: number;
  /** quality ceiling of the crafters' pill recipes, 0..5 (assumed: Lam) */
  recipeCeil: number;
  craftScore: number;
  /** value of one crafting material in hạ phẩm at realm 1 (assumed; docs give no price) */
  matUnitValue: number;
  // ---- breakthrough
  /** pills a player wants for a major attempt, and the best quality he is willing to pay for */
  pillsWanted: number;
  pillMaxQuality: number;
  /** share of the wallet he may spend on pills */
  pillBudgetShare: number;
  /** progress (share of the last stage) at which he starts buying pills */
  preBuyAt: number;
  /** attempt without the wanted pills after waiting this many days */
  attemptAfterWaitDays: number;
  /** fraction of the stage's requirement lost on a failed major attempt (assumed; D97 placeholders are in tu vi) */
  failLossFrac: number;
  minorFailPenaltyMin: number;
  /** stone cost of a major attempt as a multiple of V_ref(r) = 1610 x 1.5^(r-1); 0 = none (the docs define none) */
  breakthroughCostMult: number;
  // ---- market
  directTradeShare: number;
  /** price reaction to imbalance and bounds of the price multiplier */
  priceStep: number;
  priceMin: number;
  priceMax: number;
  /** NPC buys crafting materials at this fraction of `matUnitValue` (0 = no NPC buyer: docs X7 define none) */
  npcBuyFrac: number;
}

export const DEFAULT_GROUPS: readonly PlayGroup[] = [
  {
    id: 'casual',
    share: 0.5,
    hoursPerDay: 0.8,
    playProb: 0.6,
    sessionHours: 0.8,
    churnPerDay: 0.02,
    bossPerWeek: 0.5,
    teleportsPerDay: 0.3,
  },
  {
    id: 'regular',
    share: 0.35,
    hoursPerDay: 1.8,
    playProb: 0.85,
    sessionHours: 1.8,
    churnPerDay: 0.01,
    bossPerWeek: 1.5,
    teleportsPerDay: 0.8,
  },
  {
    id: 'hardcore',
    share: 0.15,
    hoursPerDay: 4,
    playProb: 0.95,
    sessionHours: 4,
    churnPerDay: 0.005,
    bossPerWeek: 3,
    teleportsPerDay: 1.5,
  },
];

export const DEFAULT_PARAMS: SimParams = {
  players: 2000,
  days: 90,
  seed: 1,
  maxStage: 18,
  groups: DEFAULT_GROUPS,
  cultFrac: 0.4,
  farmFrac: 0.45,
  craftFrac: 0.1,
  fieldKillsPerHour: 150,
  eliteKillsPerHour: 20,
  atRealmShare: 0.8,
  partyShare: 0.3,
  partyKillBoost: 1.5,
  eliteTimeShare: 0.5,
  healUsePerFarmHour: 0.3,
  bossMinutes: 10,
  dropMult: 1,
  deathsPerFarmHour: 0.25,
  gearPieces: 3,
  gearKappa: 0.4,
  repairAtDeficit: 25,
  smithShare: 0.3,
  repairMult: 1,
  convertFee: 0.05,
  convertProbPerDay: 0.05,
  convertMinWallet: 1000,
  dailyQuestProb: 0.8,
  weeklyQuestProb: 0.7,
  sectQuestProb: 0.6,
  sideQuestsPerDay: 0.3,
  sideQuestsPerRealm: 12,
  sectShare: 0.8,
  sectDailyContribution: 20,
  crafterShare: 0.2,
  craftsPerHour: 4,
  recipeCeil: 2,
  craftScore: 1,
  matUnitValue: 1,
  pillsWanted: 2,
  pillMaxQuality: 2,
  pillBudgetShare: 0.8,
  preBuyAt: 0.6,
  attemptAfterWaitDays: 3,
  failLossFrac: 0.15,
  minorFailPenaltyMin: 5,
  breakthroughCostMult: 0,
  directTradeShare: 0.2,
  priceStep: 0.15,
  priceMin: 0.3,
  priceMax: 50,
  npcBuyFrac: 0,
};

/** The numbers and rules the docs leave open (printed in the report; each needs a designer decision). */
export const ASSUMPTIONS: readonly string[] = [
  'Nhóm người chơi (casual / regular / hardcore: 50 / 35 / 15%, 0,8 / 1,8 / 4 giờ mỗi ngày chơi, xác suất chơi 60 / 85 / 95%, rời bỏ 2 / 1 / 0,5% mỗi ngày): không có số liệu, đây là giả định về hành vi.',
  'Chia thời gian một ngày chơi: 40% tu luyện, 45% săn, 10% chế tạo, 5% còn lại. Tu vi chỉ tăng khi tu luyện (D84 dả tọa) và từ nhiệm vụ; giết quái không cho tu vi.',
  'Nhịp săn 150 quái dã ngoại mỗi giờ hoặc 20 tinh anh mỗi giờ (một nửa thời gian săn cho mỗi loại), dùng 0,3 đan hồi phục mỗi giờ săn; 80% ở cảnh giới của mình, 20% thấp hơn 1 cảnh giới (×0,2); 30% săn theo đội 4 người (mỗi người ×0,5, giết nhanh ×1,5); mỗi boss tuần mất 10 phút.',
  'Chết 0,25 lần mỗi giờ săn; trang bị = 3 món, mỗi món κ(Lam) × V_ref(r) (docs/13 §5.1); sửa khi thiếu ≥ 25 điểm phần trăm; 30% lượt sửa do thợ rèn người chơi (trả 50% phí NPC).',
  'Đổi phẩm Linh thạch: 5% số ngày, đổi tới nửa số ví (ngẫu nhiên) khi ví ≥ 1.000 hạ phẩm, phí 5% (docs/26 §7.1); không tài liệu nói người chơi có đổi hay không, đổi bao nhiêu.',
  'Nhiệm vụ: nhật 80%, tuần 70%, tông môn 60% số ngày / tuần làm; 0,3 nhiệm vụ phụ mỗi ngày (tối đa 12 mỗi cảnh giới); mỗi cảnh giới một chương chính (1,0 giờ farm quy chuẩn). Đơn vị phần thưởng theo docs/12 §4.1 (180 × 1,5^(r−1) mỗi giờ quy chuẩn).',
  'Nhiệm vụ tông môn cho 20 Cống hiến mỗi ngày (docs/12: "số nguyên cố định trong dữ liệu", chưa có); tông môn nhận 80% người chơi (D98).',
  'Chế tạo: 20% người chơi là thợ; 4 lần chế mỗi giờ; công thức đan đột phá có phẩm trần Lam; điểm thạo luyện 1 (docs/13 §4); nguyên liệu giá 1 hạ phẩm mỗi đơn vị (docs/13 §5.1 chỉ cho giá vốn của sản phẩm, V(r, q) = κ × 1610 × 1,5^(r−1)).',
  'Đột phá lớn: người chơi muốn 2 đan đúng cảnh giới (tốt nhất tới phẩm Lam, tối đa 80% ví), bắt đầu mua khi đạt 60% nấc cuối, chờ tối đa 3 ngày rồi thử với những gì có; đan dùng là mất dù thành hay bại; thất bại mất 15% yêu cầu nấc. **Chi phí Linh thạch của đột phá không có trong docs** (chỉ đan và vật liệu); kịch bản gốc đặt 0.',
  'Chợ: đan đột phá và nguyên liệu mua bán giữa người chơi, giá = V(r, q) × hệ số giá, hệ số đổi theo cung cầu (±15% mỗi ngày, trong [0,3; 50]); 20% giao dịch trực tiếp (thuế 3%), còn lại qua chợ (phí niêm yết 1% + thuế τ theo CPI). Không có NPC mua đồ (docs/OPEN-ITEMS X7); kịch bản riêng thử NPC mua nguyên liệu.',
  'Không mô phỏng: nhiều vùng với mật độ linh khí khác nhau (ρ = 1, Match = 1), Linh Mạch / Hộ Sơn Đại Trận (không có trong beta, tông môn chỉ có NPC), đấu giá, đổi phẩm bản vẽ, trang bị mua mới khi lên cảnh giới (giá trị trang bị bám theo cảnh giới, lấy từ ngoài vòng Linh thạch), pity bản vẽ Vàng–Đỏ của chế tạo, Tiên Ngọc (docs/15), gian lận (M2).',
];

/** quality ids, index 0..5 */
export const QUALITY_NAMES: readonly string[] = ['Trắng', 'Lục', 'Lam', 'Tím', 'Vàng', 'Đỏ'];
