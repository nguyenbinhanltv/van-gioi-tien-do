/**
 * Quests (D107, docs/12-nhiem-vu-cot-truyen.md, owner-approved 2026-11-09): the main chain of chapter 1 "Phàm Căn" (full), chapters 2-3
 * as data, a daily set, a weekly quest and sect quests. This module is the executable form of docs/12 §2, §4, §5: types, the content
 * table, the reset clock (05:00 UTC+7) and the reward unit conversions. The server owns every state change (`apps/server/src/quests`);
 * the client only shows what the server sends and prints the names from `QUEST_TEXT`.
 *
 * All numbers are the docs/12 PROPOSALS (owner-approved as a starting point, "cần game designer duyệt khi cân bằng"): the per-type
 * faucet budgets of §4.2 are asserted by tests so no later content edit can silently break them.
 *
 * Rewards are in-game only (tu vi, Linh thạch hạ phẩm, items, Cống hiến). There is no price, shop, receipt or entitlement field.
 */
import { absorbBase, requiredCultivation } from './formulas/cultivation.js';
import type { MobLayoutZone } from './mob-layout.js';

export const QUESTS = {
  /** the daily reset hour in Vietnam time (UTC+7), docs/12 §2.1 */
  RESET_HOUR_VN: 5,
  /** Vietnam is UTC+7 all year */
  VN_OFFSET_HOURS: 7,
  /** an NPC is "in reach" for accept / turn in / talk within this many tiles (PLACEHOLDER) */
  NPC_RANGE_TILES: 4,
  /** quests accepted at the same time per type (docs/12 §2.2; main = 1) */
  MAX_ACTIVE: { main: 1, side: 10, daily: 5, weekly: 6, sect: 6 },
  /** completions per cycle (docs/12 §2.2) */
  MAX_PER_CYCLE: { daily: 5, weekly: 6, sect_daily: 3, sect_weekly: 3 },
  /** the world is a 20 Hz sim: the server looks for "reach a zone" / meditation time at this period */
  SCAN_INTERVAL_MS: 500,
  /** most quests one `quest_state` can carry (wire bound) */
  MAX_ENTRIES: 64,
  /** most objectives one quest can have (wire bound) */
  MAX_OBJECTIVES: 4,
  /** docs/12 §4.1: stone_wild_hours = n x 180 x 1.5^(r-1) Linh thạch hạ phẩm */
  STONES_PER_WILD_HOUR_R1: 180,
  STONE_REALM_GROWTH: 1.5,
} as const;

export type QuestType = 'main' | 'side' | 'daily' | 'weekly' | 'sect';
export type QuestRepeat = 'none' | 'daily' | 'weekly';

/** Wire-stable status values (docs/12 §5.1). */
export enum QuestStatus {
  Locked = 0,
  Available = 1,
  Active = 2,
  /** every objective done, waiting for the turn-in */
  Ready = 3,
  /** claimed (repeatable quests return to Available at the next reset) */
  Completed = 4,
}

/** Where a quest's objective is measured. Progress is in `target` units (kills, items, seconds, 1). */
export type QuestObjective =
  | {
      kind: 'kill';
      /** a mob key (`mob_doc_tho`) or a tier: `tier:normal` | `tier:elite` | `tier:boss` */
      target: string;
      count: number;
    }
  | { kind: 'collect'; item: string; count: number }
  | { kind: 'talk'; npc: string }
  | { kind: 'reach'; zone: MobLayoutZone }
  | { kind: 'breakthrough' }
  | { kind: 'cultivate'; minutes: number };

export interface QuestRewards {
  /** minutes of normalised cultivation (docs/12 §4.1) */
  cultMinutes?: number;
  /** hours of normalised wild farming, converted to Linh thạch hạ phẩm */
  stoneWildHours?: number;
  /** Cống hiến (sect quests only; paid by the sect module when it is present) */
  contribution?: number;
  items?: readonly { item: string; count: number; quality?: number }[];
}

export interface QuestDef {
  id: string;
  type: QuestType;
  chapter?: number;
  /** NPC keys (`QUEST_NPCS`) */
  giver: string;
  turnIn: string;
  repeat: QuestRepeat;
  minRealm?: number;
  maxRealm?: number;
  /** quests that must be completed first */
  after?: readonly string[];
  sectRequired?: boolean;
  /** all objectives must be met (docs/12 `mode: all`; `any` is not used by the content so far) */
  objectives: readonly QuestObjective[];
  rewards: QuestRewards;
}

export interface QuestNpc {
  key: string;
  /** offset from the map centre in tiles (the slice map is a square; works for any map size) */
  offset: readonly [number, number];
}

/**
 * Quest-giving NPCs. Keys follow the interim standee keys of D98 / #255 (`npc_*`). The positions are the Sơn Môn plaza around the
 * spawn; they are PLACEHOLDERS until the NPC art lands, the server only needs "is the player near this NPC".
 */
export const QUEST_NPCS: readonly QuestNpc[] = [
  { key: 'npc_truong_lao_dan', offset: [-3, -3] },
  { key: 'npc_su_huynh', offset: [3, -3] },
  { key: 'npc_ve_binh', offset: [-3, 3] },
  { key: 'npc_thuong_nhan', offset: [3, 3] },
  { key: 'npc_chuong_mon', offset: [0, -5] },
];
export const questNpc = (key: string): QuestNpc | undefined => QUEST_NPCS.find((n) => n.key === key);

const TL = 'npc_truong_lao_dan';
const SH = 'npc_su_huynh';
const VB = 'npc_ve_binh';
const TN = 'npc_thuong_nhan';
const CM = 'npc_chuong_mon';

/**
 * The content. Chapter 1 follows docs/12 §3.3 (Mở / Thân / Kết) and ends with the one Trúc Cơ pill that docs/12 §4.1 allows as the
 * onboarding exception (`breakthrough_pill`, quality 0 = white). Chapters 2-3 are data only: they stay `Locked` until Trúc Cơ and
 * their Chính / Tà / Ma branches (docs/12 §3.4) need the karma system, see OPEN-ITEMS.
 */
export const QUEST_DEFS: readonly QuestDef[] = [
  // ---------------------------------------------------------------- chapter 1: Phàm Căn
  {
    id: 'q_c1_nhap_mon',
    type: 'main',
    chapter: 1,
    giver: TL,
    turnIn: SH,
    repeat: 'none',
    maxRealm: 1,
    objectives: [{ kind: 'talk', npc: SH }],
    rewards: { cultMinutes: 1, items: [{ item: 'heal_pill', count: 2 }] },
  },
  {
    id: 'q_c1_van_khi',
    type: 'main',
    chapter: 1,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_nhap_mon'],
    objectives: [{ kind: 'cultivate', minutes: 3 }],
    rewards: { cultMinutes: 4, stoneWildHours: 0.05 },
  },
  {
    id: 'q_c1_ra_chan_nui',
    type: 'main',
    chapter: 1,
    giver: VB,
    turnIn: VB,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_van_khi'],
    objectives: [{ kind: 'reach', zone: 'bia_rung' }],
    rewards: { cultMinutes: 3, items: [{ item: 'heal_pill', count: 1 }] },
  },
  {
    id: 'q_c1_san_doc_tho',
    type: 'main',
    chapter: 1,
    giver: VB,
    turnIn: VB,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_ra_chan_nui'],
    objectives: [{ kind: 'kill', target: 'mob_doc_tho', count: 5 }],
    rewards: { cultMinutes: 5, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c1_thu_thap',
    type: 'main',
    chapter: 1,
    giver: TN,
    turnIn: TN,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_san_doc_tho'],
    objectives: [{ kind: 'collect', item: 'craft_material', count: 3 }],
    rewards: { cultMinutes: 3, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c1_hau_son',
    type: 'main',
    chapter: 1,
    giver: VB,
    turnIn: VB,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_thu_thap'],
    objectives: [{ kind: 'kill', target: 'mob_hoi_lang', count: 4 }],
    rewards: { cultMinutes: 4, stoneWildHours: 0.15 },
  },
  {
    id: 'q_c1_tinh_anh',
    type: 'main',
    chapter: 1,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_hau_son'],
    objectives: [{ kind: 'kill', target: 'tier:elite', count: 1 }],
    rewards: { cultMinutes: 5, stoneWildHours: 0.2 },
  },
  {
    id: 'q_c1_dot_pha',
    type: 'main',
    chapter: 1,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    maxRealm: 1,
    after: ['q_c1_tinh_anh'],
    objectives: [{ kind: 'breakthrough' }],
    rewards: { cultMinutes: 4, stoneWildHours: 0.2, items: [{ item: 'breakthrough_pill', count: 1, quality: 0 }] },
  },
  // ---------------------------------------------------------------- chapter 2: Trúc Cơ Thí Luyện (Mở 3 / Thân 4 / Kết 3, docs/12 §3.3)
  {
    id: 'q_c2_nhan_lenh',
    type: 'main',
    chapter: 2,
    giver: CM,
    turnIn: CM,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c1_dot_pha'],
    objectives: [{ kind: 'talk', npc: CM }],
    rewards: { cultMinutes: 1, stoneWildHours: 0.05, items: [{ item: 'heal_pill', count: 2 }] },
  },
  {
    id: 'q_c2_bia_rung',
    type: 'main',
    chapter: 2,
    giver: VB,
    turnIn: VB,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_nhan_lenh'],
    objectives: [{ kind: 'kill', target: 'mob_thanh_xa', count: 6 }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.08 },
  },
  {
    id: 'q_c2_vao_dam',
    type: 'main',
    chapter: 2,
    giver: VB,
    turnIn: VB,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_bia_rung'],
    objectives: [{ kind: 'reach', zone: 'dam_lay_doc' }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.08 },
  },
  {
    id: 'q_c2_doc_chu',
    type: 'main',
    chapter: 2,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_vao_dam'],
    objectives: [{ kind: 'kill', target: 'mob_doc_chu', count: 6 }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c2_doc_thiem',
    type: 'main',
    chapter: 2,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_doc_chu'],
    objectives: [{ kind: 'kill', target: 'mob_doc_thiem', count: 5 }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c2_thu_thap',
    type: 'main',
    chapter: 2,
    giver: TN,
    turnIn: TN,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_doc_thiem'],
    objectives: [{ kind: 'collect', item: 'craft_material', count: 6 }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c2_thiem_vuong',
    type: 'main',
    chapter: 2,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_thu_thap'],
    objectives: [{ kind: 'kill', target: 'elite_thiem_vuong', count: 1 }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c2_bi_canh',
    type: 'main',
    chapter: 2,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_thiem_vuong'],
    objectives: [{ kind: 'reach', zone: 'doc_hoa_dam' }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c2_doc_nguyen',
    type: 'main',
    chapter: 2,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_bi_canh'],
    objectives: [{ kind: 'kill', target: 'tier:elite', count: 3 }],
    rewards: { cultMinutes: 2, stoneWildHours: 0.12 },
  },
  {
    id: 'q_c2_ho_vuong',
    type: 'main',
    chapter: 2,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_doc_nguyen'],
    objectives: [{ kind: 'kill', target: 'boss_ho_vuong', count: 1 }],
    rewards: { cultMinutes: 3, stoneWildHours: 0.15, items: [{ item: 'heal_pill', count: 3 }] },
  },
  // ---------------------------------------------------------------- chapter 3: Tâm Ma (6 quests; the last one is the major breakthrough, D97)
  {
    id: 'q_c3_tam_tinh',
    type: 'main',
    chapter: 3,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c2_ho_vuong'],
    objectives: [{ kind: 'talk', npc: SH }],
    rewards: { cultMinutes: 1, stoneWildHours: 0.05 },
  },
  {
    id: 'q_c3_co_can',
    type: 'main',
    chapter: 3,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c3_tam_tinh'],
    objectives: [{ kind: 'kill', target: 'mob_co_can', count: 6 }],
    rewards: { cultMinutes: 3, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c3_huyet_diep',
    type: 'main',
    chapter: 3,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c3_co_can'],
    objectives: [{ kind: 'kill', target: 'mob_huyet_diep', count: 5 }],
    rewards: { cultMinutes: 3, stoneWildHours: 0.1 },
  },
  {
    id: 'q_c3_co_can_mau',
    type: 'main',
    chapter: 3,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c3_huyet_diep'],
    objectives: [{ kind: 'kill', target: 'elite_co_can_mau', count: 1 }],
    rewards: { cultMinutes: 3, stoneWildHours: 0.15 },
  },
  {
    id: 'q_c3_tam_ma',
    type: 'main',
    chapter: 3,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c3_co_can_mau'],
    objectives: [{ kind: 'cultivate', minutes: 10 }],
    rewards: { cultMinutes: 4, stoneWildHours: 0.15 },
  },
  {
    id: 'q_c3_hau_son',
    type: 'main',
    chapter: 3,
    giver: SH,
    turnIn: SH,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c3_tam_ma'],
    objectives: [{ kind: 'kill', target: 'boss_co_mang', count: 1 }],
    rewards: { cultMinutes: 4, stoneWildHours: 0.2 },
  },
  {
    id: 'q_c3_kim_dan',
    type: 'main',
    chapter: 3,
    giver: TL,
    turnIn: TL,
    repeat: 'none',
    minRealm: 2,
    after: ['q_c3_hau_son'],
    objectives: [{ kind: 'breakthrough' }],
    rewards: { cultMinutes: 1, stoneWildHours: 0.1, items: [{ item: 'heal_pill', count: 3 }] },
  },
  // ---------------------------------------------------------------- daily set (docs/12 §2: max 5 per day, 3 are defined)
  {
    id: 'q_daily_san_quai',
    type: 'daily',
    giver: VB,
    turnIn: VB,
    repeat: 'daily',
    objectives: [{ kind: 'kill', target: 'tier:normal', count: 8 }],
    rewards: { cultMinutes: 6, stoneWildHours: 0.03 },
  },
  {
    id: 'q_daily_hai_thuoc',
    type: 'daily',
    giver: TN,
    turnIn: TN,
    repeat: 'daily',
    objectives: [{ kind: 'collect', item: 'craft_material', count: 5 }],
    rewards: { cultMinutes: 6, stoneWildHours: 0.03 },
  },
  {
    id: 'q_daily_tu_luyen',
    type: 'daily',
    giver: SH,
    turnIn: SH,
    repeat: 'daily',
    objectives: [{ kind: 'cultivate', minutes: 5 }],
    rewards: { cultMinutes: 6, stoneWildHours: 0.03 },
  },
  // ---------------------------------------------------------------- weekly
  {
    id: 'q_weekly_tru_ma',
    type: 'weekly',
    giver: VB,
    turnIn: VB,
    repeat: 'weekly',
    objectives: [{ kind: 'kill', target: 'tier:boss', count: 1 }],
    rewards: { cultMinutes: 30, stoneWildHours: 0.25, items: [{ item: 'heal_pill', count: 3 }] },
  },
  // ---------------------------------------------------------------- sect (Cống hiến; needs the sect module, locked without it)
  {
    id: 'q_sect_tuan_tra',
    type: 'sect',
    giver: CM,
    turnIn: CM,
    repeat: 'daily',
    sectRequired: true,
    objectives: [{ kind: 'kill', target: 'tier:normal', count: 10 }],
    rewards: { cultMinutes: 5, stoneWildHours: 0.02, contribution: 10 },
  },
  {
    id: 'q_sect_thanh_loc',
    type: 'sect',
    giver: CM,
    turnIn: CM,
    repeat: 'weekly',
    sectRequired: true,
    objectives: [{ kind: 'kill', target: 'tier:elite', count: 3 }],
    rewards: { cultMinutes: 20, stoneWildHours: 0.1, contribution: 60 },
  },
];

export function questDefById(id: string): QuestDef | undefined {
  return QUEST_DEFS.find((q) => q.id === id);
}
/** Position of a quest in `QUEST_DEFS`: the stable wire/storage order. */
export function questIndexOf(id: string): number {
  return QUEST_DEFS.findIndex((q) => q.id === id);
}

/** Vietnamese names, descriptions and the verb of each objective (docs/12 §5.2 keeps i18n keys; `quest.<id>.name|desc`). */
export const QUEST_TEXT: Readonly<Record<string, { name: string; desc: string }>> = {
  q_c1_nhap_mon: { name: 'Nhập Môn', desc: 'Gặp Sư Huynh ở quảng trường để nhận hướng dẫn tu hành đầu tiên.' },
  q_c1_van_khi: {
    name: 'Vận Khí Đầu Tiên',
    desc: 'Đả tọa vận khí (không di chuyển, không giao chiến) tổng cộng 3 phút.',
  },
  q_c1_ra_chan_nui: { name: 'Ra Chân Núi', desc: 'Rời quảng trường, tiến tới bãi quái ở Bìa Rừng.' },
  q_c1_san_doc_tho: { name: 'Săn Độc Thố', desc: 'Hạ 5 Độc Thố đang gặm nhấm linh mạch.' },
  q_c1_thu_thap: { name: 'Thu Thập Nguyên Liệu', desc: 'Nhặt 3 Nguyên liệu chế tạo từ quái rơi ra.' },
  q_c1_hau_son: { name: 'Hậu Sơn Dậy Sóng', desc: 'Hạ 4 Hôi Lang ở hậu sơn.' },
  q_c1_tinh_anh: { name: 'Hạ Tinh Anh', desc: 'Hạ một quái tinh anh để chứng minh đủ sức trước ngưỡng đột phá.' },
  q_c1_dot_pha: {
    name: 'Đột Phá Tiểu Cảnh',
    desc: 'Đột phá thành công một cảnh giới. Trưởng Lão tặng Trúc Cơ Đan phẩm Trắng.',
  },
  q_c2_nhan_lenh: { name: 'Nhận Lệnh Thí Luyện', desc: 'Gặp Chưởng Môn để nhận lệnh thí luyện Trúc Cơ.' },
  q_c2_bia_rung: { name: 'Dọn Bìa Rừng', desc: 'Hạ 6 Thanh Xà đang chặn đường vào bí cảnh.' },
  q_c2_vao_dam: { name: 'Vào Đầm Lầy Độc', desc: 'Tiến vào Đầm Lầy Độc, nơi độc khí bắt đầu đặc lại.' },
  q_c2_doc_chu: { name: 'Độc Chu Giăng Tơ', desc: 'Hạ 6 Độc Chu trong đầm.' },
  q_c2_doc_thiem: { name: 'Độc Thiềm Kêu Đêm', desc: 'Hạ 5 Độc Thiềm.' },
  q_c2_thu_thap: {
    name: 'Nguyên Liệu Thanh Độc',
    desc: 'Mang về 6 Nguyên liệu chế tạo để luyện thuốc giải. Nộp khi trả nhiệm vụ.',
  },
  q_c2_thiem_vuong: { name: 'Thiềm Vương', desc: 'Hạ Thiềm Vương, tinh anh của Đầm Lầy Độc.' },
  q_c2_bi_canh: { name: 'Vào Bí Cảnh', desc: 'Tiến vào Độc Hỏa Đầm, nguồn của độc khí.' },
  q_c2_doc_nguyen: { name: 'Truy Tìm Độc Nguyên', desc: 'Hạ 3 quái tinh anh canh giữ Độc Nguyên.' },
  q_c2_ho_vuong: { name: 'Hổ Vương', desc: 'Hạ Hổ Vương, thủ lĩnh của bí cảnh.' },
  q_c3_tam_tinh: { name: 'Tâm Cảnh Lung Lay', desc: 'Gặp Sư Huynh: độc khí đã chạm vào tâm cảnh của ngươi.' },
  q_c3_co_can: { name: 'Cổ Căn Trung Tâm', desc: 'Hạ 6 Cổ Căn ở Cổ Thụ Trung Tâm.' },
  q_c3_huyet_diep: { name: 'Huyết Diệp', desc: 'Hạ 5 Huyết Diệp.' },
  q_c3_co_can_mau: { name: 'Cổ Căn Mẫu', desc: 'Hạ Cổ Căn Mẫu, gốc của rễ độc.' },
  q_c3_tam_ma: { name: 'Đối Mặt Tâm Ma', desc: 'Đả tọa 10 phút để ổn định tâm cảnh trước Kim Đan.' },
  q_c3_hau_son: { name: 'Cổng Kim Đan', desc: 'Hạ Cổ Mãng canh giữ cổng sang Kim Đan.' },
  q_c3_kim_dan: {
    name: 'Qua Cổng Kim Đan',
    desc: 'Đột phá thành công sang Kim Đan (Tâm Ma và Lôi Kiếp, D97). Kết chương một.',
  },
  q_daily_san_quai: { name: 'Nhật Thường: Săn Quái', desc: 'Hạ 8 quái thường.' },
  q_daily_hai_thuoc: { name: 'Nhật Thường: Thu Nguyên Liệu', desc: 'Có trong túi 5 Nguyên liệu chế tạo.' },
  q_daily_tu_luyen: { name: 'Nhật Thường: Tu Luyện', desc: 'Đả tọa tổng cộng 5 phút.' },
  q_weekly_tru_ma: { name: 'Chu Thường: Trừ Ma', desc: 'Hạ một boss.' },
  q_sect_tuan_tra: { name: 'Tông Môn: Tuần Tra', desc: 'Hạ 10 quái thường quanh sơn môn. Thưởng Cống hiến.' },
  q_sect_thanh_loc: { name: 'Tông Môn: Thanh Lọc', desc: 'Hạ 3 quái tinh anh. Thưởng Cống hiến.' },
};

/** Vietnamese names of the mobs, items and tiers the objectives and rewards mention (the client prints them; unknown keys fall back to the key). */
export const QUEST_TARGET_TEXT: Readonly<Record<string, string>> = {
  mob_doc_tho: 'Độc Thố',
  mob_hoi_lang: 'Hôi Lang',
  boss_ho_vuong: 'Hổ Vương',
  boss_co_mang: 'Cổ Mãng',
  mob_thanh_xa: 'Thanh Xà',
  mob_doc_chu: 'Độc Chu',
  mob_doc_thiem: 'Độc Thiềm',
  elite_thiem_vuong: 'Thiềm Vương',
  mob_co_can: 'Cổ Căn',
  mob_huyet_diep: 'Huyết Diệp',
  elite_co_can_mau: 'Cổ Căn Mẫu',
  'tier:normal': 'quái thường',
  'tier:elite': 'quái tinh anh',
  'tier:boss': 'boss',
  heal_pill: 'Hồi Huyết Đan',
  breakthrough_pill: 'Trúc Cơ Đan',
  craft_material: 'Nguyên liệu chế tạo',
  bia_rung: 'Bìa Rừng',
  dam_lay_doc: 'Đầm Lầy Độc',
  co_thu_trung_tam: 'Cổ Thụ Trung Tâm',
  doc_hoa_dam: 'Độc Hỏa Đầm',
};

export const NPC_TEXT: Readonly<Record<string, string>> = {
  npc_truong_lao_dan: 'Trưởng Lão',
  npc_su_huynh: 'Sư Huynh',
  npc_ve_binh: 'Vệ Binh',
  npc_thuong_nhan: 'Thương Nhân',
  npc_chuong_mon: 'Chưởng Môn',
};

// ------------------------------------------------------------------ objectives

/** How many progress units an objective needs (kills / items / seconds / 1). */
export function objectiveTarget(o: QuestObjective): number {
  switch (o.kind) {
    case 'kill':
    case 'collect':
      return o.count;
    case 'cultivate':
      return Math.round(o.minutes * 60);
    default:
      return 1;
  }
}

/** Does a kill of mob `mobKey` of tier `tier` count for the objective target (`mob_x` or `tier:elite`)? */
export function killMatches(target: string, mobKey: string, tier: string): boolean {
  return target.startsWith('tier:') ? target === `tier:${tier}` : target === mobKey;
}

// ------------------------------------------------------------------ reset clock (docs/12 §2.1)

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** Local (UTC+7) time shifted so that the reset hour is midnight: whole days of this are the reset cycles. */
const shifted = (unixMs: number): number => unixMs + (QUESTS.VN_OFFSET_HOURS - QUESTS.RESET_HOUR_VN) * HOUR;

/** Daily cycle number: it changes at 05:00 Vietnam time. */
export function questDayEpoch(unixMs: number): number {
  return Math.floor(shifted(unixMs) / DAY);
}
/** Weekly cycle number: it changes at 05:00 Vietnam time on Monday. (Day 0 of the shifted clock, 1970-01-01, was a Thursday.) */
export function questWeekEpoch(unixMs: number): number {
  return Math.floor((questDayEpoch(unixMs) + 3) / 7);
}
/** Seconds until the next daily / weekly reset (for the client countdown). */
export function questResetIn(unixMs: number): { daily: number; weekly: number } {
  const day = questDayEpoch(unixMs);
  const dailyMs = (day + 1) * DAY - shifted(unixMs);
  const weekMs = (questWeekEpoch(unixMs) + 1) * 7 * DAY - 3 * DAY - shifted(unixMs);
  return { daily: Math.ceil(dailyMs / 1000), weekly: Math.ceil(weekMs / 1000) };
}
export const questEpochOf = (repeat: QuestRepeat, unixMs: number): number =>
  repeat === 'weekly' ? questWeekEpoch(unixMs) : repeat === 'daily' ? questDayEpoch(unixMs) : 0;

// ------------------------------------------------------------------ reward units (docs/12 §4.1)

/** Tu vi for `minutes` of normalised cultivation at stage `stage` (rho = 1, purity = 1, match = 1). */
export function cultMinutesToTuVi(minutes: number, stage: number): number {
  return Math.max(0, Math.floor(minutes * absorbBase(stage)));
}
/** Linh thạch hạ phẩm for `hours` of normalised wild farming at realm `realm` (docs/12 §4.1: n x 180 x 1.5^(r-1)). */
export function stoneWildHoursToStones(hours: number, realm: number): number {
  return Math.floor(hours * QUESTS.STONES_PER_WILD_HOUR_R1 * Math.pow(QUESTS.STONE_REALM_GROWTH, realm - 1));
}

/** Ceiling of tu vi the whole chapter-1 chain may pay (docs/12 §4.2: 25 % of the realm's total Req, in normalised minutes). */
export function chapterCultBudgetMinutes(totalReqMinutes: number): number {
  return totalReqMinutes * 0.25;
}
/** Total Req of `realm`'s stages in normalised cultivation minutes: sum of Req(s) / Absorb(s) (realm 1 = stages 1..9, then 4 per realm). */
export function realmReqMinutes(realm: number): number {
  const first = realm === 1 ? 1 : 10 + (realm - 2) * 4;
  const last = realm === 1 ? 9 : first + 3;
  let t = 0;
  for (let st = first; st <= last; st++) t += requiredCultivation(st) / absorbBase(st);
  return t;
}
/** Total Req of realm 1 (stages 1..9) in normalised cultivation minutes: sum of Req(s) / Absorb(s). */
export function realm1ReqMinutes(): number {
  let t = 0;
  for (let s = 1; s <= 9; s++) t += requiredCultivation(s) / absorbBase(s);
  return t;
}
