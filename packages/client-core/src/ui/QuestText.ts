/**
 * String keys of the quest text (D104): every name / description / label is a `vi-VN.ts` entry, these maps only point at them.
 * Generated once from the content table of `@vgtd/shared` `QUEST_DEFS`; a new quest needs its two keys here and in the table
 * (`quests.test.ts` fails otherwise).
 */
import type { StringKey } from '../i18n/strings.js';

export const QUEST_NAME_KEY: Readonly<Record<string, StringKey>> = {
  'q_c1_nhap_mon': 'quest.q_c1_nhap_mon.name',
  'q_c1_van_khi': 'quest.q_c1_van_khi.name',
  'q_c1_ra_chan_nui': 'quest.q_c1_ra_chan_nui.name',
  'q_c1_san_doc_tho': 'quest.q_c1_san_doc_tho.name',
  'q_c1_thu_thap': 'quest.q_c1_thu_thap.name',
  'q_c1_hau_son': 'quest.q_c1_hau_son.name',
  'q_c1_tinh_anh': 'quest.q_c1_tinh_anh.name',
  'q_c1_dot_pha': 'quest.q_c1_dot_pha.name',
  'q_c2_bi_canh': 'quest.q_c2_bi_canh.name',
  'q_c2_doc_nguyen': 'quest.q_c2_doc_nguyen.name',
  'q_c2_ho_vuong': 'quest.q_c2_ho_vuong.name',
  'q_c3_tam_ma': 'quest.q_c3_tam_ma.name',
  'q_c3_hau_son': 'quest.q_c3_hau_son.name',
  'q_daily_san_quai': 'quest.q_daily_san_quai.name',
  'q_daily_hai_thuoc': 'quest.q_daily_hai_thuoc.name',
  'q_daily_tu_luyen': 'quest.q_daily_tu_luyen.name',
  'q_weekly_tru_ma': 'quest.q_weekly_tru_ma.name',
  'q_sect_tuan_tra': 'quest.q_sect_tuan_tra.name',
  'q_sect_thanh_loc': 'quest.q_sect_thanh_loc.name',
};

export const QUEST_DESC_KEY: Readonly<Record<string, StringKey>> = {
  'q_c1_nhap_mon': 'quest.q_c1_nhap_mon.desc',
  'q_c1_van_khi': 'quest.q_c1_van_khi.desc',
  'q_c1_ra_chan_nui': 'quest.q_c1_ra_chan_nui.desc',
  'q_c1_san_doc_tho': 'quest.q_c1_san_doc_tho.desc',
  'q_c1_thu_thap': 'quest.q_c1_thu_thap.desc',
  'q_c1_hau_son': 'quest.q_c1_hau_son.desc',
  'q_c1_tinh_anh': 'quest.q_c1_tinh_anh.desc',
  'q_c1_dot_pha': 'quest.q_c1_dot_pha.desc',
  'q_c2_bi_canh': 'quest.q_c2_bi_canh.desc',
  'q_c2_doc_nguyen': 'quest.q_c2_doc_nguyen.desc',
  'q_c2_ho_vuong': 'quest.q_c2_ho_vuong.desc',
  'q_c3_tam_ma': 'quest.q_c3_tam_ma.desc',
  'q_c3_hau_son': 'quest.q_c3_hau_son.desc',
  'q_daily_san_quai': 'quest.q_daily_san_quai.desc',
  'q_daily_hai_thuoc': 'quest.q_daily_hai_thuoc.desc',
  'q_daily_tu_luyen': 'quest.q_daily_tu_luyen.desc',
  'q_weekly_tru_ma': 'quest.q_weekly_tru_ma.desc',
  'q_sect_tuan_tra': 'quest.q_sect_tuan_tra.desc',
  'q_sect_thanh_loc': 'quest.q_sect_thanh_loc.desc',
};

export const QUEST_TARGET_KEY: Readonly<Record<string, StringKey>> = {
  'mob_doc_tho': 'quest.target.mob_doc_tho',
  'mob_hoi_lang': 'quest.target.mob_hoi_lang',
  'boss_ho_vuong': 'quest.target.boss_ho_vuong',
  'boss_co_mang': 'quest.target.boss_co_mang',
  'tier:normal': 'quest.target.tier_normal',
  'tier:elite': 'quest.target.tier_elite',
  'tier:boss': 'quest.target.tier_boss',
  'heal_pill': 'quest.target.heal_pill',
  'breakthrough_pill': 'quest.target.breakthrough_pill',
  'craft_material': 'quest.target.craft_material',
  'bia_rung': 'quest.target.bia_rung',
  'dam_lay_doc': 'quest.target.dam_lay_doc',
  'co_thu_trung_tam': 'quest.target.co_thu_trung_tam',
  'doc_hoa_dam': 'quest.target.doc_hoa_dam',
};

export const QUEST_NPC_KEY: Readonly<Record<string, StringKey>> = {
  'npc_truong_lao_dan': 'quest.npc_truong_lao_dan',
  'npc_su_huynh': 'quest.npc_su_huynh',
  'npc_ve_binh': 'quest.npc_ve_binh',
  'npc_thuong_nhan': 'quest.npc_thuong_nhan',
  'npc_chuong_mon': 'quest.npc_chuong_mon',
};
