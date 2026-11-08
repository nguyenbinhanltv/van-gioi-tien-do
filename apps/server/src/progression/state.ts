/**
 * Pure progression rules on top of @vgtd/shared (docs/07 §2, §5). No clocks, no randomness except through the supplied
 * PRNG state; every function returns new values so the same inputs always give the same outputs.
 */
import {
  ELEMENTS,
  MUTATION_BASE,
  NGU_HANH,
  ROOT_TYPES,
  TOTAL_STAGES,
  absorbPerMinute,
  baseElement,
  breakthroughSuccess,
  density,
  match,
  maxSubStage,
  minorBreakthroughSuccess,
  realmToStage,
  requiredCultivation,
  rngFloat,
  rngInt,
  rootType,
  stageToRealm,
  type Element,
  type ElementWeights,
  type Mutation,
  type PathId,
  type RngState,
  type RootTypeId,
} from '@vgtd/shared';

export interface SpiritRoot {
  readonly type: RootTypeId;
  /** the root's elements (a mutated one is listed under its base element and flagged by `mutation`) */
  readonly elements: readonly Element[];
  /** at most one element is mutated; it keeps the base element's land weight and the root's purity P_n */
  readonly mutation: Mutation | null;
}

/** What the database stores (docs/23 §4.2): `characters` (realm, sub_realm, spirit_root, karma) + `character_state` (exp). */
export interface ProgressRecord {
  readonly characterId: string;
  readonly realm: number;
  readonly subRealm: number;
  readonly spiritRoot: SpiritRoot;
  readonly karma: number;
  /** tu vi accumulated in the current stage (`character_state.exp`) */
  readonly exp: number;
  /** consecutive failed MAJOR breakthroughs at this threshold (pity counter) */
  readonly nFail: number;
  /** optimistic-concurrency version, incremented by every successful save */
  readonly version: number;
  /**
   * Class (Đạo Lộ, `characters.class_id`, D82): decided ONCE at creation by the first login that names one, never changed by a later
   * hello. Absent on records written before D82: they are given a class by the next login (`resolveClass`).
   */
  readonly classId?: PathId;
}

type Position = Pick<ProgressRecord, 'realm' | 'subRealm'>;
export const stageOf = (r: Position): number => realmToStage(r.realm, r.subRealm);
export const tuViRequired = (r: Position): number => requiredCultivation(stageOf(r));
export const isMaxStage = (r: Position): boolean => stageOf(r) >= TOTAL_STAGES;
/** the next breakthrough is a major one when the character stands on the last sub-stage of its realm */
export const isMajorThreshold = (r: Position): boolean => r.subRealm >= maxSubStage(r.realm);

/** Land spirit-energy environment at the meditation spot (docs/07 §5: rho density and the land's element weights v_e). */
export interface MeditationEnv {
  readonly rho: number;
  readonly land: ElementWeights;
}
export const UNIFORM_LAND: ElementWeights = { kim: 0.2, moc: 0.2, thuy: 0.2, hoa: 0.2, tho: 0.2 };
export const DEFAULT_ENV: MeditationEnv = { rho: density(), land: UNIFORM_LAND };

/** a_e: equal weight per root element (the mutated element is keyed by its mutation id, which `match` maps back to its base). */
export function rootWeights(root: SpiritRoot): ElementWeights {
  const w: Record<string, number> = {};
  const share = 1 / root.elements.length;
  for (const e of root.elements) {
    const key = root.mutation && MUTATION_BASE[root.mutation] === e ? root.mutation : e;
    w[key] = (w[key] ?? 0) + share;
  }
  return w as ElementWeights;
}

/** Tu vi per minute (docs/07 §5): rho * A_s * P_n * sqrt(Match). */
export function meditationRate(r: ProgressRecord, env: MeditationEnv): number {
  const purity = rootType(r.spiritRoot.type).purity;
  return absorbPerMinute(stageOf(r), env.rho, purity, match(rootWeights(r.spiritRoot), env.land));
}

/** Tu vi after meditating `dtMs`, clamped to Req(s); `full` when the stage requirement is reached. */
export function advanceTuVi(r: ProgressRecord, dtMs: number, env: MeditationEnv): { exp: number; full: boolean } {
  const req = tuViRequired(r);
  const exp = Math.min(req, r.exp + (meditationRate(r, env) * dtMs) / 60_000);
  return { exp, full: exp >= req };
}

export interface BreakthroughPlan {
  readonly kind: 'minor' | 'major';
  readonly fromStage: number;
  readonly toStage: number;
  /** success probability from @vgtd/shared (pills and tribulation are out of scope for now) */
  readonly chance: number;
}
/** What the next breakthrough would be and its success chance, or null at the last stage. */
export function planBreakthrough(r: ProgressRecord): BreakthroughPlan | null {
  if (isMaxStage(r)) return null;
  const from = stageOf(r);
  if (isMajorThreshold(r))
    return {
      kind: 'major',
      fromStage: from,
      toStage: from + 1,
      chance: breakthroughSuccess({ realm: r.realm, karma: r.karma, nFail: r.nFail }),
    };
  return { kind: 'minor', fromStage: from, toStage: from + 1, chance: minorBreakthroughSuccess(r.realm, r.karma) };
}

/** Apply a roll: success moves to the next stage (tu vi resets, pity resets); failure never drops the realm (docs/01). */
export function applyBreakthrough(r: ProgressRecord, plan: BreakthroughPlan, success: boolean): ProgressRecord {
  if (success) {
    const next = stageToRealm(plan.toStage);
    return { ...r, realm: next.realm, subRealm: next.subStage, exp: 0, nFail: plan.kind === 'major' ? 0 : r.nFail };
  }
  // Failure keeps the accumulated tu vi (OPEN-ITEMS section 17); only major failures feed the pity counter (docs/07 §2).
  return plan.kind === 'major' ? { ...r, nFail: r.nFail + 1 } : r;
}

/** Roll a new character's spirit root from a PRNG stream (docs/07 §5: type weights, 2% mutation). */
export function rollSpiritRoot(rng: RngState): [SpiritRoot, RngState] {
  let u: number;
  [u, rng] = rngFloat(rng);
  let acc = 0;
  let type = ROOT_TYPES[ROOT_TYPES.length - 1]!;
  for (const t of ROOT_TYPES) {
    acc += t.spawnWeight;
    if (u < acc) {
      type = t;
      break;
    }
  }
  const pool: Element[] = [...ELEMENTS];
  const elements: Element[] = [];
  for (let k = 0; k < type.elementCount; k++) {
    let at: number;
    [at, rng] = rngInt(rng, pool.length);
    elements.push(pool.splice(at, 1)[0]!);
  }
  let m: number;
  let pick: number;
  [m, rng] = rngFloat(rng);
  [pick, rng] = rngInt(rng, elements.length);
  // Only Moc (Phong), Kim (Loi) and Thuy (Bang) have a mutated form: a mutation roll on another element changes nothing.
  const mutated = (Object.keys(MUTATION_BASE) as Mutation[]).find((x) => MUTATION_BASE[x] === elements[pick]);
  const mutation = m < NGU_HANH.MUTATION_CHANCE && mutated ? mutated : null;
  return [{ type: type.id, elements, mutation }, rng];
}

export function newRecord(characterId: string, spiritRoot: SpiritRoot, classId?: PathId): ProgressRecord {
  return {
    characterId,
    realm: 1,
    subRealm: 1,
    spiritRoot,
    karma: 0,
    exp: 0,
    nFail: 0,
    version: 0,
    ...(classId ? { classId } : {}),
  };
}

/** Base elements as the wire bitmask of char_state (bit 0..4 = kim, moc, thuy, hoa, tho). */
export function elementMask(root: SpiritRoot): number {
  return root.elements.reduce((m, e) => m | (1 << ELEMENTS.indexOf(baseElement(e))), 0);
}
