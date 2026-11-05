/** Typed access to the sample/default data and JSON Schemas (generated from src/data and src/schemas). */
import {
  ELEMENTAL_MATRIX_JSON,
  ELEMENTAL_MATRIX_SCHEMA,
  REALM_PROGRESSION_JSON,
  REALM_PROGRESSION_SCHEMA,
} from './generated.js';

export interface StatParamData {
  base: number;
  model: 'exponential' | 'linear';
  lambda?: number;
  slope?: number;
}
export interface TribulationData {
  type: 'none' | 'heart_demon' | 'heart_demon_multi' | 'lightning' | 'lightning_heart_demon';
  strikes?: number;
  waves?: number;
  strikes_per_wave?: number;
  kappa?: number;
  wave_growth?: number;
  strike_interval_s?: number;
  wave_interval_s?: number;
  durability_loss_on_death?: number;
}
export interface RealmData {
  id: string;
  order: number;
  name: string;
  sub_stages: number;
  level_range: [number, number];
  unlocks?: string[];
  breakthrough: {
    to: string;
    base_rate: number;
    main_pill_ids?: string[];
    tribulation: TribulationData;
  };
}
export interface RealmProgression {
  schema_version: string;
  stat_formula: {
    alpha: number;
    stats: { hp: StatParamData; mp: StatParamData; atk: StatParamData; def: StatParamData; agi: StatParamData };
  };
  breakthrough_rules: {
    min_rate: number;
    max_rate: number;
    pity_per_fail: number;
    pity_cap: number;
    max_pills: number;
    wrong_realm_pill_factor: number;
    karma_penalty_per_1000: number;
    quality_multipliers: number[];
    minor_stage_base: { luyen_khi: number; default: number };
    minor_stage_karma_factor: number;
  };
  cultivation: { req_base: number; req_growth: number; absorb_base: number; absorb_growth: number };
  realms: RealmData[];
}

export type ElementId = 'kim' | 'moc' | 'thuy' | 'hoa' | 'tho';
export interface ElementalMatrix {
  schema_version: string;
  elements: ElementId[];
  overcomes: Record<ElementId, ElementId>;
  generates: Record<ElementId, ElementId>;
  damage_matrix: Record<ElementId, Record<ElementId, number>>;
  overcome_def_multiplier: number;
  generate_support: { mp_restore_pct: number; cooldown_s: number; applies_to_self: boolean };
  mutations: { id: 'phong' | 'loi' | 'bang'; base: ElementId }[];
  mutation_chance: number;
  root_types: {
    id: string;
    element_count: number;
    spawn_weight: number;
    purity: number;
    off_element_damage_penalty: number;
  }[];
  absorption: {
    match_floor: number;
    match_scale: number;
    curve: 'linear' | 'sqrt';
    density: { normal: number; main_city: number; ley_line_base: number; ley_line_per_grade: number };
  };
}

export const realmProgression = REALM_PROGRESSION_JSON as RealmProgression;
export const elementalMatrix = ELEMENTAL_MATRIX_JSON as ElementalMatrix;
export const realmProgressionSchema = REALM_PROGRESSION_SCHEMA as Record<string, unknown>;
export const elementalMatrixSchema = ELEMENTAL_MATRIX_SCHEMA as Record<string, unknown>;

/** Approved base-stat table (Công thức §1, "Bảng giá trị") — CI rejects data deviating > 1%. */
export interface ApprovedStatRow {
  label: string;
  realm: number;
  subStage: number;
  x: number;
  hp: number;
  mp: number;
  atk: number;
  def: number;
  agi: number;
}
export const APPROVED_STAT_TABLE: readonly ApprovedStatRow[] = [
  { label: 'Luyện Khí tầng 1', realm: 1, subStage: 1, x: 0, hp: 1200, mp: 400, atk: 60, def: 40, agi: 100 },
  { label: 'Trúc Cơ sơ kỳ', realm: 2, subStage: 1, x: 1, hp: 2136, mp: 680, atk: 105, def: 69, agi: 115 },
  { label: 'Kim Đan sơ kỳ', realm: 3, subStage: 1, x: 2, hp: 3802, mp: 1156, atk: 184, def: 118, agi: 130 },
  { label: 'Nguyên Anh sơ kỳ', realm: 4, subStage: 1, x: 3, hp: 6768, mp: 1965, atk: 322, def: 204, agi: 145 },
  { label: 'Hóa Thần sơ kỳ', realm: 5, subStage: 1, x: 4, hp: 12047, mp: 3341, atk: 563, def: 350, agi: 160 },
  { label: 'Luyện Hư sơ kỳ', realm: 6, subStage: 1, x: 5, hp: 21443, mp: 5680, atk: 985, def: 602, agi: 175 },
  { label: 'Hợp Thể sơ kỳ', realm: 7, subStage: 1, x: 6, hp: 38168, mp: 9655, atk: 1723, def: 1036, agi: 190 },
  { label: 'Đại Thừa sơ kỳ', realm: 8, subStage: 1, x: 7, hp: 67940, mp: 16414, atk: 3016, def: 1781, agi: 205 },
  { label: 'Độ Kiếp sơ kỳ', realm: 9, subStage: 1, x: 8, hp: 120936, mp: 27903, atk: 5278, def: 3064, agi: 220 },
  { label: 'Độ Kiếp Viên Mãn', realm: 9, subStage: 4, x: 8.45, hp: 156733, mp: 35437, atk: 6788, def: 3910, agi: 227 },
];
