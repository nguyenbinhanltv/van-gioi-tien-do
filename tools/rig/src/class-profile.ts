/**
 * Per-class assembly profile for `assembleContinuous` / `rig:assemble --class <id>` (D39): which painted parts the class
 * has, how each binds to the rig, which bones of the borrowed base rig it drops and what its detail layer (display swaps)
 * does in each clip. Pure data: a new class is an entry here plus its parts folder, not a new assembler.
 *
 * Thể tu (A: Sơn Môn Hộ Vệ): whole arms and legs, ivory torso + neck, a split tabard (front / back panels hung from the
 * shoulders, chest on the spine, hem on the thighs), gathered trouser hems over the boots, a sash with two tails, a bun
 * with strands, and quyền sáo (gauntlets) WORN on the hands: five displays per side on the `hand_L` / `hand_R` slots.
 * There is no weapon bone, no `weapon_R`, no scabbard and no trail / glint layer.
 */
import type { Direction } from '@vgtd/shared';
import type { CharacterId } from './classes.js';
import { REPLACED_BONES, type PieceSpec } from './continuous.js';
import type { ChainTemplate } from './classes.js';
import type { ClipDetail, DetailGroup, Hold } from './detail.js';
import type { GaitProfile } from './kiemtu.js';

export interface AssemblyProfile {
  readonly id: CharacterId;
  /** File stem of the export (`<stem>_<DIR>_ske.json`, see the character registry). */
  readonly stem: string;
  /** Pieces in back-to-front draw order; missing part files are reported, not fatal. */
  readonly pieces: readonly PieceSpec[];
  /** Per-direction piece lists (draw order + which pieces exist) replacing `pieces`; see `profilePieces`. */
  readonly piecesByDir?: Readonly<Partial<Record<Direction, readonly PieceSpec[]>>>;
  /** Bones of the base rig removed before assembly. */
  readonly dropBones: readonly string[];
  /** Detail rules by clip name (display swaps synced to the actions). */
  readonly detail: Readonly<Record<string, ClipDetail>>;
  /** IK constraint name -> `bendPositive`: knees (and elbows) bend toward the facing, unlike the mirrored base rig. */
  readonly ikBend?: Readonly<Partial<Record<Direction, Readonly<Record<string, boolean>>>>>;
  /** Class chain templates (see `AssembleInput.extraChains`). */
  readonly chains?: { readonly templates: readonly ChainTemplate[]; readonly groups: readonly DetailGroup[] };
  /** Gait of run / walk / dash (`authorClassSet` and `rig:assemble` use it unless `--gait` says otherwise). */
  readonly gait: GaitProfile;
  /** Per-direction replacement of `gait` (the stride runs along the screen's vertical axis in S / N: deeper knee for short legs). */
  readonly gaitByDir?: Readonly<Partial<Record<Direction, GaitProfile>>>;
  /** Weapon rule of the QA gate: a sword is visible (`one`) or no weapon may exist (`none`). */
  readonly qaWeapon: 'one' | 'none';
  /** The class carries a weapon piece borrowed from the old Kiếm tu atlas (only Kiếm tu). */
  readonly borrowsSword: boolean;
}

const SPINE = ['hip', 'spine_mid', 'spine_upper'] as const;
const gauntlet = (side: 'L' | 'R', v: string): PieceSpec => ({
  id: `gauntlet_${side}_${v}`,
  slot: `hand_${side}`,
  binding: { kind: 'rigid', bone: `hand_${side}` },
});
const GAUNTLET_SWAPS = ['relaxed', 'guard', 'fist', 'open', 'ground'] as const;
const arm = (side: 'L' | 'R'): PieceSpec[] => [
  {
    id: `arm_${side}`,
    slot: `arm_${side}`,
    binding: { kind: 'limb', chain: [`upper_arm_${side}`, `lower_arm_${side}`, `hand_${side}`], step: 6, ramp: 6 },
  },
  // cuff: a chain of the shared sleeve_group (parent lower_arm), laid along the painted band
  {
    id: `sleeve_cuff_${side}`,
    slot: `sleeve_cuff_${side}`,
    binding: { kind: 'hanging', template: `sleeve_edge_${side}`, cols: 3 },
  },
  ...GAUNTLET_SWAPS.map((v) => gauntlet(side, v)),
];
const leg = (side: 'L' | 'R'): PieceSpec[] => [
  {
    id: `leg_${side}`,
    slot: `leg_${side}`,
    binding: { kind: 'limb', chain: [`thigh_${side}`, `shin_${side}`, `foot_${side}`], step: 7, ramp: 7 },
  },
  // gathered hem above the boot: a chain of hem_group hanging from the shin
  {
    id: `trouser_hem_${side}`,
    slot: `trouser_hem_${side}`,
    binding: { kind: 'hanging', template: `trouser_hem_${side}`, cols: 3, alongParent: true },
  },
  { id: `boot_${side}`, slot: `boot_${side}`, binding: { kind: 'rigid', bone: `foot_${side}` } },
];

/** Thể tu E pieces, back to front (the draw order of the art's `restOrder`: far arm / leg behind the body, near ones in front). */
export const THE_TU_E_PIECES: readonly PieceSpec[] = [
  {
    id: 'hair_back',
    slot: 'hair_back',
    binding: { kind: 'rigid', bone: 'head' },
    paperdoll: 'hair_back',
    compose: ['hair_back', 'hair_bun'],
  },
  ...leg('L'),
  { id: 'tabard_back', slot: 'tabard_back', binding: { kind: 'skirt', spine: true, panel: 'robe_back' } },
  ...arm('L'),
  {
    id: 'torso',
    slot: 'torso',
    binding: { kind: 'limb', chain: SPINE, ramp: 6, step: 8 },
    paperdoll: 'body',
    // the neck is painted as its own part, drawn straight after the torso: one strip mesh carries both
    compose: ['torso', 'neck'],
  },
  ...leg('R'),
  {
    id: 'tabard_front',
    slot: 'tabard_front',
    binding: { kind: 'skirt', spine: true, panel: 'robe_front' },
    paperdoll: 'outfit_upper',
  },
  {
    id: 'tabard_shoulders',
    slot: 'tabard_shoulders',
    binding: { kind: 'rigid', bone: 'spine_upper' },
    compose: ['tabard_shoulder_L', 'tabard_shoulder_R'],
  },
  {
    id: 'sash_set',
    slot: 'sash_set',
    binding: { kind: 'limb', chain: SPINE, ramp: 6, step: 8 },
    compose: ['sash_band', 'sash_knot'],
  },
  { id: 'sash_tail_1', slot: 'sash_tail_L', binding: { kind: 'hanging', template: 'sash_tail_L' } },
  { id: 'sash_tail_2', slot: 'sash_tail_R', binding: { kind: 'hanging', template: 'sash_tail_R' } },
  ...arm('R'),
  {
    id: 'head',
    slot: 'head',
    binding: { kind: 'rigid', bone: 'head' },
    paperdoll: 'head',
    compose: ['head', 'ear_R'],
  },
  { id: 'eyes_open', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'eyes_half', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'eyes_closed', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'eyes_angry', slot: 'eyes', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'brows_neutral', slot: 'brows', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'brows_angry', slot: 'brows', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'brows_pain', slot: 'brows', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_neutral', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_grit', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_shout', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'mouth_pain', slot: 'mouth', binding: { kind: 'rigid', bone: 'head' } },
  // a short bang (12 x 9 px): too small for a chain, rigid on the head
  { id: 'hair_strand_1', slot: 'hair_strand_a', binding: { kind: 'rigid', bone: 'head' } },
  { id: 'hair_strand_2', slot: 'hair_strand_b', binding: { kind: 'hanging', template: 'hair_strand_b' } },
  { id: 'hair_strand_3', slot: 'hair_strand_c', binding: { kind: 'hanging', template: 'hair_strand_c' } },
  { id: 'hairpin', slot: 'hairpin', binding: { kind: 'rigid', bone: 'head' } },
];

// ---------------------------------------------------------------------------------------------------------------------
// per-direction pieces: draw order (@vgtd/character slotsInDrawOrder) and visibility

const BY_ID = new Map(THE_TU_E_PIECES.map((p) => [p.id, p] as const));
const ids = (...groups: (string | readonly string[])[]): string[] => groups.flat();
const legSet = (s: 'L' | 'R') => [`leg_${s}`, `trouser_hem_${s}`, `boot_${s}`];
const armSet = (s: 'L' | 'R') => [`arm_${s}`, `sleeve_cuff_${s}`, ...GAUNTLET_SWAPS.map((v) => `gauntlet_${s}_${v}`)];
const EYES = ['eyes_open', 'eyes_half', 'eyes_closed', 'eyes_angry'];
const BROWS = ['brows_neutral', 'brows_angry', 'brows_pain'];
const STRANDS = ['hair_strand_1', 'hair_strand_2', 'hair_strand_3'];

const pick = (order: readonly string[], patch: Readonly<Record<string, Partial<PieceSpec>>> = {}): PieceSpec[] =>
  order.map((id) => {
    const p = BY_ID.get(id);
    if (!p) throw new RangeError(`unknown Thể tu piece '${id}'`);
    return patch[id] ? ({ ...p, ...patch[id] } as PieceSpec) : p;
  });

/** Seen from the back the BACK panel is the visible one (over the torso, carries the outfit tag), the front panel hangs behind. */
const BACK_VIEW_TABARD: Record<string, Partial<PieceSpec>> = {
  tabard_front: { paperdoll: undefined },
  tabard_back: { paperdoll: 'outfit_upper' },
};

/**
 * Thể tu pieces per direction. E / SE / S: the E order (the art's `restOrder`; SE and S arms draw as in the E table, the S
 * arms hang at the sides so they never cross the head). NE: far arm and the front panel behind the body, the back panel over
 * it, the rear hair over the back of the head (drawOrder NE), near arm last; only the visible facial edge (eyes, brows, no
 * mouth, no ear). N: both arms behind the body, back panel visible, no face at all (11 swaps + ear + facial bangs omitted),
 * the rear hair covers the head. Part files that do not exist are reported by the assembler, not fatal.
 */
export const THE_TU_PIECES_BY_DIR: Readonly<Partial<Record<Direction, readonly PieceSpec[]>>> = {
  E: THE_TU_E_PIECES,
  SE: THE_TU_E_PIECES,
  S: THE_TU_E_PIECES,
  NE: pick(
    ids(
      legSet('L'),
      'tabard_front',
      armSet('L'),
      'torso',
      legSet('R'),
      'tabard_back',
      'tabard_shoulders',
      'sash_set',
      'sash_tail_1',
      'sash_tail_2',
      'head',
      EYES,
      BROWS,
      STRANDS,
      'hair_back',
      'hairpin',
      armSet('R'),
    ),
    // no ear in the back three-quarter view either: the head is composed from `head` only (as in N)
    { ...BACK_VIEW_TABARD, head: { compose: ['head'] } },
  ),
  N: pick(
    ids(
      armSet('L'),
      armSet('R'),
      legSet('L'),
      legSet('R'),
      'tabard_front',
      'torso',
      'tabard_back',
      'tabard_shoulders',
      'sash_set',
      'sash_tail_1',
      'sash_tail_2',
      'head',
      'hair_back',
      'hairpin',
    ),
    { ...BACK_VIEW_TABARD, head: { compose: ['head'] } },
  ),
};

/** The pieces of `profile` for one direction (its `piecesByDir` entry, else `pieces`). */
export function profilePieces(profile: AssemblyProfile, dir: Direction): readonly PieceSpec[] {
  return profile.piecesByDir?.[dir] ?? profile.pieces;
}

// ---------------------------------------------------------------------------------------------------------------------
// detail rules: gauntlet swaps and the face, synced to what the body does

const G = (side: 'L' | 'R', v: (typeof GAUNTLET_SWAPS)[number]) => `gauntlet_${side}_${v}`;
const both = (v: (typeof GAUNTLET_SWAPS)[number]): Pick<ClipDetail, 'handL' | 'handR'> => ({
  handL: { base: G('L', v) },
  handR: { base: G('R', v) },
});
const face = (
  mouth: string,
  brows = 'brows_neutral',
  holds: readonly Hold[] = [],
): Pick<ClipDetail, 'mouth' | 'extra'> => ({
  mouth: { base: mouth, holds },
  extra: { brows: { base: brows } },
});
const SHOUT_AT_HIT: Hold = {
  from: { phase: 'hit_frame', offset: -2 },
  to: { phase: 'hit_frame', offset: 4 },
  show: 'mouth_shout',
};
const GRIT: Hold = { from: { frame: 0 }, to: { phase: 'hit_frame', offset: -2 }, show: 'mouth_grit' };
const ANGRY_BROWS: Hold = { from: { frame: 0 }, to: { frac: 1 }, show: 'brows_angry' };
const throwing = (side: 'L' | 'R', v: (typeof GAUNTLET_SWAPS)[number]): Hold => ({
  from: { phase: 'hit_frame', offset: -1 },
  to: { phase: 'hit_frame', offset: 4 },
  show: G(side, v),
});
const attack = (striker: 'L' | 'R', v: (typeof GAUNTLET_SWAPS)[number]): ClipDetail => {
  const other = striker === 'R' ? 'L' : 'R';
  return {
    mouth: { base: 'mouth_neutral', holds: [GRIT, SHOUT_AT_HIT] },
    extra: { brows: { base: 'brows_neutral', holds: [ANGRY_BROWS] } },
    [`hand${striker}`]: { base: G(striker, 'guard'), holds: [throwing(striker, v)] },
    [`hand${other}`]: { base: G(other, 'guard') },
  } as ClipDetail;
};

/**
 * What each clip of the Thể tu set does with the detail layer. Eyes are never keyed here (the `blink_cycle` layer owns
 * them; only meditate holds `eyes_closed`); `eyes_angry` is a reserved display for the runtime.
 */
export const THE_TU_DETAIL_RULES: Readonly<Record<string, ClipDetail>> = {
  idle: { ...face('mouth_neutral'), ...both('guard') },
  walk: { ...face('mouth_neutral'), ...both('relaxed') },
  run: { ...face('mouth_neutral'), ...both('fist') },
  dash: { ...face('mouth_grit', 'brows_angry'), ...both('fist') },
  attack: attack('R', 'fist'),
  attack_2: attack('L', 'fist'),
  attack_3: {
    mouth: { base: 'mouth_neutral', holds: [GRIT, SHOUT_AT_HIT] },
    extra: { brows: { base: 'brows_neutral', holds: [ANGRY_BROWS] } },
    handL: { base: G('L', 'guard'), holds: [throwing('L', 'open')] },
    handR: { base: G('R', 'guard'), holds: [throwing('R', 'open')] },
  },
  // ground slam: fists gathered overhead, gauntlets flatten (`ground`) on the release
  cast: {
    mouth: {
      base: 'mouth_grit',
      holds: [
        { from: { phase: 'windup_end', offset: 1 }, to: { phase: 'windup_end', offset: 9 }, show: 'mouth_shout' },
      ],
    },
    extra: { brows: { base: 'brows_angry' } },
    handL: {
      base: G('L', 'fist'),
      holds: [{ from: { phase: 'windup_end', offset: 3 }, to: { frac: 1 }, show: G('L', 'ground') }],
    },
    handR: {
      base: G('R', 'fist'),
      holds: [{ from: { phase: 'windup_end', offset: 3 }, to: { frac: 1 }, show: G('R', 'ground') }],
    },
  },
  channel: { ...face('mouth_grit', 'brows_angry'), ...both('open') },
  sword_fly: { ...face('mouth_neutral'), ...both('open') },
  tribulation: { ...face('mouth_pain', 'brows_pain'), ...both('guard') },
  meditate: { eyes: 'eyes_closed', ...face('mouth_neutral'), ...both('relaxed') },
  emote: {
    ...face('mouth_neutral', 'brows_neutral', [{ from: { frac: 0.25 }, to: { frac: 0.85 }, show: 'mouth_shout' }]),
    handR: { base: G('R', 'fist') },
    handL: { base: G('L', 'relaxed') },
  },
  hit: {
    mouth: { base: 'mouth_pain', holds: [{ from: { frac: 0.6 }, to: { frac: 1 }, show: 'mouth_grit' }] },
    extra: { brows: { base: 'brows_pain' } },
    ...both('guard'),
  },
  die: {
    mouth: { base: 'mouth_pain', holds: [{ from: { frac: 0.3 }, to: { frac: 1 }, show: 'mouth_neutral' }] },
    extra: { brows: { base: 'brows_pain', holds: [{ from: { frac: 0.5 }, to: { frac: 1 }, show: 'brows_neutral' }] } },
    handL: { base: G('L', 'fist'), holds: [{ from: { frac: 0.5 }, to: { frac: 1 }, show: G('L', 'relaxed') }] },
    handR: { base: G('R', 'fist'), holds: [{ from: { frac: 0.5 }, to: { frac: 1 }, show: G('R', 'relaxed') }] },
  },
};

/** Thể tu gait: half stride at the real speed (cycles 2), moderate knee bend and stomp, forward lean of a bruiser. */
export const THE_TU_GAIT: GaitProfile = { cycles: 2, reachScale: 0.6, crouchScale: 0.3, liftScale: 0.6, lean: 4 };

/** Trouser hems: one short segment from the shin (light cloth, a small swing so the band does not fold over the boot). */
const trouserHem = (side: 'L' | 'R'): ChainTemplate => ({
  name: `trouser_hem_${side}`,
  kind: 'cape',
  parent: `shin_${side}`,
  segments: 1,
  length: 8,
  at: { x: 0, y: 0, rotation: 0 },
  stiffness: 0.4,
  damping: 0.45,
  gravity: 60,
});
export const THE_TU_CHAINS: { readonly templates: readonly ChainTemplate[]; readonly groups: readonly DetailGroup[] } =
  {
    templates: [trouserHem('L'), trouserHem('R')],
    groups: [
      {
        name: 'hem_group',
        kind: 'cape',
        stiffness: 0.4,
        damping: 0.45,
        gravity: 60,
        maxAngle: 15,
        members: ['trouser_hem_L', 'trouser_hem_R'],
      },
    ],
  };

/**
 * S (front view) and SE: the stride has a large vertical part on screen, the short legs need more knee bend to reach it without
 * sliding (crouchScale 0.35 still slid 0.7 px/frame in both; 0.45 passes). NE / N / E are not tuned here.
 */
export const THE_TU_GAIT_S: GaitProfile = { ...THE_TU_GAIT, crouchScale: 0.45 };

export const THE_TU_PROFILE: AssemblyProfile = {
  id: 'the-tu',
  stem: 'thetu',
  pieces: THE_TU_E_PIECES,
  piecesByDir: THE_TU_PIECES_BY_DIR,
  // the Kiếm tu base rig lends its roles / IK / sockets; its sword bones go, the quyền sáo hang on the hand bones
  dropBones: [...REPLACED_BONES, 'scabbard', 'weapon'],
  detail: THE_TU_DETAIL_RULES,
  // stocky tank in trousers: the legs are visible, so keep the stride of the robe gait (two step pairs per clip) but plant
  // harder: a deeper knee than a robe and a higher foot lift than a robe, no splayed squat
  gait: THE_TU_GAIT,
  gaitByDir: { S: THE_TU_GAIT_S, SE: THE_TU_GAIT_S },
  chains: THE_TU_CHAINS,
  // the base rig bends the R knee backward (hidden under a robe in the Kiếm tu pilot); trousers show it as bow legs
  // E only: the profile view needs the R knee forward; the other views keep the base rig's bend until checked there
  ikBend: { E: { ik_leg_R: true } },
  qaWeapon: 'none',
  borrowsSword: false,
};

/** Profiles of the classes that have continuous-limb art (Kiếm tu keeps the built-in pilot defaults of `assembleContinuous`). */
export const ASSEMBLY_PROFILES: Readonly<Partial<Record<CharacterId, AssemblyProfile>>> = {
  'the-tu': THE_TU_PROFILE,
};

export function getAssemblyProfile(id: CharacterId): AssemblyProfile {
  const p = ASSEMBLY_PROFILES[id];
  if (!p) throw new RangeError(`no continuous-limb assembly profile for '${id}' yet`);
  return p;
}
