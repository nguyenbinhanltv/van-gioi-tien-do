/**
 * Paperdoll (docs/03 §2): 15 layers (13 Spine slots + 2 sprite-node orbit layers) and the 8 per-direction
 * Draw Order presets, plus a resolver and the "≤ 2 draw calls per character" repack check.
 */
import { BUDGETS, DIRECTIONS, type Direction } from '@vgtd/shared';

export type SlotId =
  | 'orbit_back'
  | 'wing'
  | 'cape'
  | 'sword_back'
  | 'hair_back'
  | 'body'
  | 'outfit_lower'
  | 'outfit_upper'
  | 'head'
  | 'hair_front'
  | 'headwear'
  | 'arm_L'
  | 'arm_R'
  | 'weapon_R'
  | 'orbit_front';

export type SlotForm = 'spine' | 'sprite_node';

export interface SlotInfo {
  readonly id: SlotId;
  readonly form: SlotForm;
  /** Spec "Hình thức". */
  readonly kind: string;
}

/** The 15 layers in the spec's table order (also the S draw order, 1..15). */
export const PAPERDOLL_SLOTS: readonly SlotInfo[] = [
  { id: 'orbit_back', form: 'sprite_node', kind: 'sprite node riêng, không thuộc skeleton' },
  { id: 'wing', form: 'spine', kind: 'attachment + flipbook additive' },
  { id: 'cape', form: 'spine', kind: 'mesh attachment + physics constraint' },
  { id: 'sword_back', form: 'spine', kind: 'attachment gắn bone lưng' },
  { id: 'hair_back', form: 'spine', kind: 'mesh + physics constraint' },
  { id: 'body', form: 'spine', kind: 'mesh' },
  { id: 'outfit_lower', form: 'spine', kind: 'mesh (tay áo rộng có physics)' },
  { id: 'outfit_upper', form: 'spine', kind: 'mesh (tay áo rộng có physics)' },
  { id: 'head', form: 'spine', kind: 'attachment (mắt, miệng đổi attachment)' },
  { id: 'hair_front', form: 'spine', kind: 'mesh + physics constraint' },
  { id: 'headwear', form: 'spine', kind: 'attachment' },
  { id: 'arm_L', form: 'spine', kind: 'mesh' },
  { id: 'arm_R', form: 'spine', kind: 'mesh' },
  { id: 'weapon_R', form: 'spine', kind: 'attachment gắn socket tay' },
  { id: 'orbit_front', form: 'sprite_node', kind: 'sprite node riêng, không thuộc skeleton' },
];

export const SLOT_IDS: readonly SlotId[] = PAPERDOLL_SLOTS.map((s) => s.id);
export const PAPERDOLL_LAYER_COUNT = 15;
export const SPINE_SLOT_COUNT = 13;
export const SPRITE_NODE_SLOT_COUNT = 2;

export function slotForm(slot: SlotId): SlotForm {
  return PAPERDOLL_SLOTS.find((s) => s.id === slot)!.form;
}

type DrawOrderRow = readonly [number, number, number, number, number, number, number, number];

/** Column order of the spec table: S, SE, E, NE, N, NW, W, SW (same as shared `DIRECTIONS`). */
const ROWS: Readonly<Record<SlotId, DrawOrderRow>> = {
  orbit_back: [1, 1, 1, 1, 1, 1, 1, 1],
  wing: [2, 2, 2, 14, 14, 14, 2, 2],
  cape: [3, 3, 3, 13, 13, 13, 3, 3],
  sword_back: [4, 4, 4, 12, 12, 12, 4, 4],
  hair_back: [5, 6, 6, 8, 10, 9, 7, 7],
  body: [6, 7, 7, 3, 5, 4, 8, 8],
  outfit_lower: [7, 8, 8, 4, 6, 5, 9, 9],
  outfit_upper: [8, 9, 9, 5, 7, 6, 10, 10],
  head: [9, 10, 10, 6, 8, 7, 11, 11],
  hair_front: [10, 11, 11, 7, 9, 8, 12, 12],
  headwear: [11, 12, 12, 9, 11, 10, 13, 13],
  arm_L: [12, 5, 5, 2, 3, 11, 14, 14],
  arm_R: [13, 13, 13, 10, 4, 3, 6, 6],
  weapon_R: [14, 14, 14, 11, 2, 2, 5, 5],
  orbit_front: [15, 15, 15, 15, 15, 15, 15, 15],
};

/** Draw Order table: slot → direction → order (1 = drawn first / furthest back). */
export const DRAW_ORDER: Readonly<Record<SlotId, Readonly<Record<Direction, number>>>> = Object.fromEntries(
  SLOT_IDS.map((slot) => [slot, Object.fromEntries(DIRECTIONS.map((d, i) => [d, ROWS[slot][i]!]))]),
) as Record<SlotId, Record<Direction, number>>;

/** The preset for one direction (the real facing — W is NOT E mirrored: its preset is its own). */
export function drawOrderFor(direction: Direction): Readonly<Record<SlotId, number>> {
  return Object.fromEntries(SLOT_IDS.map((s) => [s, DRAW_ORDER[s][direction]])) as Record<SlotId, number>;
}

/** All 15 slots of one direction sorted back → front. */
export function slotsInDrawOrder(direction: Direction): SlotId[] {
  return [...SLOT_IDS].sort((a, b) => DRAW_ORDER[a][direction] - DRAW_ORDER[b][direction]);
}

// ------------------------------------------------------------------ conflict rules
/** Mirrored-art rule: weapon_R gets an extra hand-drawn flipped variant for SW, W, NW (docs/03 §2 table). */
export const MIRRORED_VARIANT_SLOTS: readonly SlotId[] = ['weapon_R'];
/**
 * Other attachments the spec says may need redrawing when mirrored ("họa tiết pháp y một bên, tóc rẽ ngôi") —
 * decided per asset, so they only get the mirrored variant when the caller lists them.
 */
export const ASYMMETRIC_CANDIDATE_SLOTS: readonly SlotId[] = [
  'outfit_upper',
  'outfit_lower',
  'hair_back',
  'hair_front',
];

export type AttachmentVariant = 'mirrored' | 'under_hat';
export type HideReason = 'mounted' | 'sword_in_hand' | 'sword_flying' | 'hood';

export interface PaperdollOptions {
  /** The rig is played mirrored (scaleX = −1): weapon_R (+ `asymmetricSlots`) use their flipped variant. */
  readonly mirrored?: boolean;
  /** Extra slots (from ASYMMETRIC_CANDIDATE_SLOTS) that the equipped set ships a flipped variant for. */
  readonly asymmetricSlots?: readonly SlotId[];
  /** Riding a mount: wing hidden. */
  readonly mounted?: boolean;
  /** Sword is in hand: sword_back hidden. */
  readonly swordInHand?: boolean;
  /** Ngự kiếm (flying on the sword): sword_back hidden. */
  readonly swordFlying?: boolean;
  /** Headwear is a hood: hair_front hidden. */
  readonly hoodedHeadwear?: boolean;
  /** An equipped outfit occupies both outfit_lower and outfit_upper (áo dài liền váy). */
  readonly longRobe?: boolean;
}

export interface ResolvedSlot {
  readonly slot: SlotId;
  /** Draw Order value for this direction (1..15). */
  readonly order: number;
  readonly form: SlotForm;
  readonly variants: readonly AttachmentVariant[];
}

export interface PaperdollResolution {
  readonly direction: Direction;
  /** Visible slots, back → front. */
  readonly ordered: readonly ResolvedSlot[];
  readonly hidden: readonly { slot: SlotId; reason: HideReason }[];
}

/**
 * (direction, equipped slots, options) → ordered slot list. `body` is always present. Slots the entity has not
 * equipped are skipped; conflict rules hide slots that are equipped but must not render.
 */
export function resolvePaperdoll(
  direction: Direction,
  equipped: Iterable<SlotId>,
  options: PaperdollOptions = {},
): PaperdollResolution {
  const have = new Set<SlotId>(equipped);
  have.add('body'); // "Luôn hiện"
  if (options.longRobe && (have.has('outfit_upper') || have.has('outfit_lower'))) {
    have.add('outfit_upper');
    have.add('outfit_lower');
  }

  const hidden: { slot: SlotId; reason: HideReason }[] = [];
  const hide = (slot: SlotId, reason: HideReason) => {
    if (have.delete(slot)) hidden.push({ slot, reason });
  };
  if (options.mounted) hide('wing', 'mounted');
  if (options.swordInHand) hide('sword_back', 'sword_in_hand');
  else if (options.swordFlying) hide('sword_back', 'sword_flying');
  if (options.hoodedHeadwear && have.has('headwear')) hide('hair_front', 'hood');

  const mirroredSlots = new Set<SlotId>([...MIRRORED_VARIANT_SLOTS, ...(options.asymmetricSlots ?? [])]);
  const underHat = have.has('headwear');

  const ordered: ResolvedSlot[] = [...have]
    .map((slot): ResolvedSlot => {
      const variants: AttachmentVariant[] = [];
      if (options.mirrored && mirroredSlots.has(slot)) variants.push('mirrored');
      if (underHat && (slot === 'hair_back' || slot === 'hair_front')) variants.push('under_hat');
      return { slot, order: DRAW_ORDER[slot][direction], form: slotForm(slot), variants };
    })
    .sort((a, b) => a.order - b.order);
  return { direction, ordered, hidden };
}

/** Orbit weapons: above the character (screen y < centre) use the back half, below use the front half. */
export function orbitLayerFor(dyFromCentre: number): 'orbit_back' | 'orbit_front' {
  return dyFromCentre < 0 ? 'orbit_back' : 'orbit_front';
}

// ------------------------------------------------------------------ repack / draw-call rule
/** Repacked equipment must stay within 2 draw calls per character (docs/03 §2). */
export const MAX_DRAW_CALLS_PER_CHARACTER = 2;
/** Per-outfit export: one atlas page ≤ 1024 for the 5 drawn directions. */
export const OUTFIT_ATLAS_MAX_PX = 1024;
/** Runtime repack target texture: 1024–2048. */
export const REPACK_ATLAS_SIZES: readonly number[] = [1024, 2048];

export type BlendMode = 'normal' | 'additive';

export interface PackedAttachment {
  readonly slot: SlotId;
  /** Region size in px @1x (the caller sums every region of the slot it needs in the repacked texture). */
  readonly width: number;
  readonly height: number;
  /** Defaults: wing = additive (flipbook additive), everything else normal. */
  readonly blend?: BlendMode;
}

export interface RepackCheck {
  readonly ok: boolean;
  readonly drawCalls: number;
  /** Smallest repack texture that fits all attachments, or null if even the largest overflows. */
  readonly atlasSize: number | null;
  /** Σ (w + 2·pad)(h + 2·pad) / atlas². */
  readonly fill: number;
  readonly errors: readonly string[];
}

export interface RepackOptions extends PaperdollOptions {
  readonly paddingPx?: number;
}

export function defaultBlend(slot: SlotId): BlendMode {
  return slot === 'wing' ? 'additive' : 'normal';
}

/**
 * Draw calls = number of runs of consecutive slots (in Draw Order) that change texture page or blend mode.
 * All attachments share one repacked page, so only blend changes split a batch. Only Spine slots count: the two
 * orbit layers are separate sprite nodes with their own (fixed) batches.
 */
export function countDrawCalls(
  resolution: PaperdollResolution,
  attachments: readonly PackedAttachment[],
  pageOf: (slot: SlotId) => number = () => 0,
): number {
  const bySlot = new Map(attachments.map((a) => [a.slot, a]));
  let calls = 0;
  let prev: string | null = null;
  for (const r of resolution.ordered) {
    if (r.form !== 'spine') continue;
    const att = bySlot.get(r.slot);
    if (!att) continue;
    const key = `${pageOf(r.slot)}|${att.blend ?? defaultBlend(r.slot)}`;
    if (key !== prev) calls++;
    prev = key;
  }
  return calls;
}

/** Validate that a repacked equipment set fits one 1024–2048 texture and ≤ 2 draw calls in `direction`. */
export function checkRepack(
  attachments: readonly PackedAttachment[],
  direction: Direction,
  options: RepackOptions = {},
): RepackCheck {
  const errors: string[] = [];
  const pad = options.paddingPx ?? BUDGETS.ATLAS_PADDING_PX;
  const spine = attachments.filter((a) => slotForm(a.slot) === 'spine');
  const area = spine.reduce((s, a) => s + (a.width + 2 * pad) * (a.height + 2 * pad), 0);
  const atlasSize = REPACK_ATLAS_SIZES.find((s) => area <= s * s) ?? null;
  const largest = REPACK_ATLAS_SIZES[REPACK_ATLAS_SIZES.length - 1]!;
  if (atlasSize === null) errors.push(`attachments need ${area} px² > ${largest}² repack texture`);

  const resolution = resolvePaperdoll(
    direction,
    spine.map((a) => a.slot),
    options,
  );
  const drawCalls = countDrawCalls(resolution, spine);
  if (drawCalls > MAX_DRAW_CALLS_PER_CHARACTER) {
    errors.push(`${drawCalls} draw calls > ${MAX_DRAW_CALLS_PER_CHARACTER} in direction ${direction}`);
  }
  return { ok: errors.length === 0, drawCalls, atlasSize, fill: area / (atlasSize ?? largest) ** 2, errors };
}

/** Worst case over all 8 directions (draw order differs per direction, so blend runs can too). */
export function checkRepackAllDirections(
  attachments: readonly PackedAttachment[],
  options: RepackOptions = {},
): RepackCheck {
  const checks = DIRECTIONS.map((d) => checkRepack(attachments, d, options));
  const worst = checks.reduce((a, b) => (b.drawCalls > a.drawCalls ? b : a));
  const errors = [...new Set(checks.flatMap((c) => c.errors))];
  return { ...worst, ok: errors.length === 0, errors };
}
