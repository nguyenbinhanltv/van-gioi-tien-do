/**
 * Detail animation layer for the continuous-limb structure (D39): everything that is not a bone rotation of the body.
 * Pure data + two functions, so the same rules apply to any assembled rig that has the detail slots:
 *
 *  - display swaps on slots: eyes (open / half / closed blink cycles), mouth (neutral / open / smile), hands (grip /
 *    relaxed / fist / palm / seal) synced to the action of each clip;
 *  - sword trail and glint layers (additive slots, attachment + colour keys) around the hit of an attack;
 *  - secondary chains for hair strands, ponytail, ribbon tails, sash tails, pendant, sleeve edges and robe hem
 *    (`addDetailChains` adds bones + chains; the existing spring bake in the clip set then animates them).
 *
 * A rule is skipped when the rig lacks the slot or the attachment, so the layer is safe to apply to the old rig and to
 * partial pilot rigs. Deterministic: the blink schedule is a hash of the clip name, never `Math.random`.
 */
import { CLIP_FPS, type Clip, type Key, type RGBA, type SlotTrack } from './clip.js';
import { RIG_LIMITS } from '@vgtd/character';
import type { ChainTemplate } from './classes.js';
import type { RigBone, RigChain, RigDocument } from './schema.js';

/** Slot names of the detail layer (a rig may map several source pieces onto one slot as display variants). */
export const DETAIL_SLOTS = {
  eyes: 'eyes',
  mouth: 'mouth',
  handR: 'hand_R',
  handL: 'hand_L',
  trail: 'sword_trail',
  glint: 'sword_glint',
} as const;

/** Attachment (display) names per slot. */
export const DETAIL_DISPLAYS = {
  eyes: { open: 'eyes_open', half: 'eyes_half', closed: 'eyes_closed' },
  mouth: { neutral: 'mouth_neutral', open: 'mouth_open', smile: 'mouth_smile' },
  handR: {
    grip: 'hand_R_grip',
    relaxed: 'hand_R_relaxed',
    fist: 'hand_R_fist',
    palm: 'hand_R_palm',
    seal: 'hand_R_seal',
  },
  handL: { relaxed: 'hand_L_relaxed', fist: 'hand_L_fist', palm: 'hand_L_palm', seal: 'hand_L_seal' },
  trail: { trail: 'sword_trail' },
  glint: { glint: 'sword_glint' },
} as const;

/** A position in a clip: literal 30 fps frame, fraction of the duration, or a named phase plus an offset. */
export type At =
  { readonly frame: number } | { readonly frac: number } | { readonly phase: string; readonly offset?: number };

export interface Hold {
  readonly from: At;
  readonly to: At;
  /** Display shown during [from, to). */
  readonly show: string;
}

export interface TrailRule {
  readonly from: At;
  readonly peak: At;
  readonly to: At;
}

export interface ClipDetail {
  /** Blink cycles on the eyes slot (3-5 s apart, at least one per clip of 1.5 s or more). */
  readonly blink?: boolean;
  /** Display held for the whole clip on the eyes slot instead (meditate: eyes closed). */
  readonly eyes?: string;
  /** Default display and timed holds per slot key. */
  readonly mouth?: { readonly base: string; readonly holds?: readonly Hold[] };
  readonly handR?: { readonly base: string; readonly holds?: readonly Hold[] };
  readonly handL?: { readonly base: string; readonly holds?: readonly Hold[] };
  readonly trail?: TrailRule;
  /** Short additive flash around a frame. */
  readonly glint?: { readonly at: At; readonly halfWidth?: number };
}

const SWORD_ACTION: ClipDetail = {
  mouth: {
    base: 'mouth_neutral',
    holds: [{ from: { phase: 'hit_frame', offset: -2 }, to: { phase: 'hit_frame', offset: 4 }, show: 'mouth_open' }],
  },
  handR: { base: 'hand_R_grip' },
  handL: {
    base: 'hand_L_relaxed',
    holds: [{ from: { phase: 'windup_end' }, to: { phase: 'hit_frame', offset: 4 }, show: 'hand_L_fist' }],
  },
  trail: { from: { phase: 'windup_end' }, peak: { phase: 'hit_frame' }, to: { phase: 'hit_frame', offset: 5 } },
  glint: { at: { phase: 'hit_frame' }, halfWidth: 2 },
};

/** What each clip of the Kiếm tu set does with the detail layer (sword always in the right hand). */
export const DETAIL_RULES: Readonly<Record<string, ClipDetail>> = {
  idle: {
    blink: true,
    mouth: { base: 'mouth_neutral' },
    handR: { base: 'hand_R_grip' },
    handL: { base: 'hand_L_relaxed' },
  },
  walk: {
    blink: true,
    mouth: { base: 'mouth_neutral' },
    handR: { base: 'hand_R_grip' },
    handL: { base: 'hand_L_relaxed' },
  },
  run: { mouth: { base: 'mouth_neutral' }, handR: { base: 'hand_R_grip' }, handL: { base: 'hand_L_fist' } },
  dash: { mouth: { base: 'mouth_neutral' }, handR: { base: 'hand_R_grip' }, handL: { base: 'hand_L_fist' } },
  attack: SWORD_ACTION,
  attack_2: SWORD_ACTION,
  attack_3: SWORD_ACTION,
  cast: {
    mouth: {
      base: 'mouth_neutral',
      holds: [
        { from: { phase: 'windup_end', offset: -2 }, to: { phase: 'windup_end', offset: 8 }, show: 'mouth_open' },
      ],
    },
    handR: { base: 'hand_R_grip' },
    handL: { base: 'hand_L_relaxed', holds: [{ from: { frac: 0.15 }, to: { frac: 0.9 }, show: 'hand_L_seal' }] },
    glint: { at: { phase: 'windup_end' }, halfWidth: 3 },
  },
  channel: {
    blink: true,
    mouth: { base: 'mouth_neutral' },
    handR: { base: 'hand_R_grip' },
    handL: { base: 'hand_L_seal' },
  },
  sword_fly: { mouth: { base: 'mouth_neutral' }, handR: { base: 'hand_R_grip' }, handL: { base: 'hand_L_seal' } },
  tribulation: { mouth: { base: 'mouth_open' }, handR: { base: 'hand_R_grip' }, handL: { base: 'hand_L_palm' } },
  meditate: {
    eyes: 'eyes_closed',
    mouth: { base: 'mouth_neutral' },
    handR: { base: 'hand_R_relaxed' },
    handL: { base: 'hand_L_relaxed' },
  },
  emote: {
    blink: true,
    mouth: { base: 'mouth_smile' },
    handR: { base: 'hand_R_grip' },
    handL: { base: 'hand_L_palm' },
  },
  hit: {
    mouth: { base: 'mouth_open', holds: [{ from: { frac: 0.6 }, to: { frac: 1 }, show: 'mouth_neutral' }] },
    handR: { base: 'hand_R_grip' },
    handL: { base: 'hand_L_fist' },
  },
  die: {
    mouth: { base: 'mouth_open', holds: [{ from: { frac: 0.3 }, to: { frac: 1 }, show: 'mouth_neutral' }] },
    eyes: 'eyes_open',
    handR: { base: 'hand_R_grip', holds: [{ from: { frac: 0.5 }, to: { frac: 1 }, show: 'hand_R_relaxed' }] },
    handL: { base: 'hand_L_fist', holds: [{ from: { frac: 0.5 }, to: { frac: 1 }, show: 'hand_L_relaxed' }] },
  },
};

// ---------------------------------------------------------------------------------------------------------------------
// display / colour tracks

const BLINK_FRAMES = [
  ['open', 0],
  ['half', 1],
  ['closed', 2],
  ['half', 4],
  ['open', 5],
] as const;
/** Blink spacing in frames: 3-5 s at 30 fps. */
const BLINK_MIN = 3 * CLIP_FPS;
const BLINK_SPAN = 2 * CLIP_FPS;

/** FNV-1a: a small deterministic hash for the blink schedule. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** Frames at which a blink starts: first one inside the clip, then every 3-5 s; none too close to the loop end. */
export function blinkStarts(clipName: string, frames: number): number[] {
  const last = frames - 6;
  if (last < 4 || frames < 1.5 * CLIP_FPS) return [];
  let state = hash(clipName) || 1;
  const next = () => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state / 4294967296;
  };
  const out: number[] = [];
  let t = Math.floor(next() * Math.min(last, BLINK_MIN));
  while (t <= last) {
    out.push(t);
    t += BLINK_MIN + Math.floor(next() * BLINK_SPAN);
  }
  return out;
}

function resolve(at: At, clip: Clip): number | null {
  if ('frame' in at) return at.frame;
  if ('frac' in at) return Math.round(at.frac * clip.frames);
  const p = clip.phases?.[at.phase];
  return p === undefined ? null : p + (at.offset ?? 0);
}

function stepped(keys: Key<string | null>[]): Key<string | null>[] {
  // collapse keys on the same frame (last wins) and consecutive duplicates; keep frame order
  const byFrame = new Map<number, string | null>();
  for (const k of keys) byFrame.set(k.frame, k.value);
  const sorted = [...byFrame].sort((a, b) => a[0] - b[0]);
  const out: Key<string | null>[] = [];
  for (const [frame, value] of sorted) {
    if (out.length && out[out.length - 1]!.value === value) continue;
    out.push({ frame, value, curve: 'stepped' });
  }
  return out;
}

const hasDisplay = (rig: RigDocument, slot: string, name: string) =>
  rig.slots.some((s) => s.name === slot) && rig.skins.some((sk) => sk.attachments[slot]?.[name]);

function holdTrack(
  rig: RigDocument,
  clip: Clip,
  slot: string,
  spec: { readonly base: string; readonly holds?: readonly Hold[] } | undefined,
): SlotTrack | null {
  if (!spec || !hasDisplay(rig, slot, spec.base)) return null;
  const keys: Key<string | null>[] = [{ frame: 0, value: spec.base }];
  for (const h of spec.holds ?? []) {
    const a = resolve(h.from, clip);
    const b = resolve(h.to, clip);
    if (a === null || b === null || b <= a || !hasDisplay(rig, slot, h.show)) continue;
    const from = Math.max(0, Math.min(clip.frames, a));
    const to = Math.max(0, Math.min(clip.frames, b));
    keys.push({ frame: from, value: h.show });
    if (to < clip.frames) keys.push({ frame: to, value: spec.base });
  }
  return { slot, attachment: stepped(keys) };
}

function eyesTrack(rig: RigDocument, clip: Clip, rule: ClipDetail): SlotTrack | null {
  const slot = DETAIL_SLOTS.eyes;
  const D = DETAIL_DISPLAYS.eyes;
  if (rule.eyes && hasDisplay(rig, slot, rule.eyes))
    return { slot, attachment: stepped([{ frame: 0, value: rule.eyes }]) };
  if (!rule.blink || !hasDisplay(rig, slot, D.open)) return null;
  const keys: Key<string | null>[] = [{ frame: 0, value: D.open }];
  for (const start of blinkStarts(clip.name, clip.frames)) {
    for (const [state, off] of BLINK_FRAMES) {
      const name = D[state];
      keys.push({ frame: start + off, value: hasDisplay(rig, slot, name) ? name : D.open });
    }
  }
  return { slot, attachment: stepped(keys) };
}

const WHITE = (a: number): RGBA => [1, 1, 1, a];

/** Colour keys sorted by frame, one per frame (last wins): a window starting at frame 0 would otherwise key it twice. */
function colorKeys(keys: Key<RGBA>[]): Key<RGBA>[] {
  const byFrame = new Map<number, Key<RGBA>>();
  for (const k of keys) byFrame.set(k.frame, k);
  return [...byFrame.values()].sort((x, y) => x.frame - y.frame);
}

/** Trail: visible from `from` to `to`, alpha ramps 0 → 1 at `peak` → 0. */
function trailTracks(rig: RigDocument, clip: Clip, rule: TrailRule | undefined): SlotTrack | null {
  const slot = DETAIL_SLOTS.trail;
  const name = DETAIL_DISPLAYS.trail.trail;
  if (!rule || !hasDisplay(rig, slot, name)) return null;
  const a = resolve(rule.from, clip);
  const p = resolve(rule.peak, clip);
  const b = resolve(rule.to, clip);
  if (a === null || p === null || b === null || !(a < p && p < b)) return null;
  const to = Math.min(b, clip.frames);
  return {
    slot,
    attachment: stepped([
      { frame: 0, value: null },
      { frame: a, value: name },
      ...(to < clip.frames ? [{ frame: to, value: null }] : []),
    ]),
    color: colorKeys([
      { frame: 0, value: WHITE(0) },
      { frame: a, value: WHITE(0) },
      { frame: p, value: WHITE(1) },
      { frame: to, value: WHITE(0) },
    ]),
  };
}

function glintTrack(rig: RigDocument, clip: Clip, rule: ClipDetail['glint']): SlotTrack | null {
  const slot = DETAIL_SLOTS.glint;
  const name = DETAIL_DISPLAYS.glint.glint;
  if (!rule || !hasDisplay(rig, slot, name)) return null;
  const c = resolve(rule.at, clip);
  if (c === null) return null;
  const w = rule.halfWidth ?? 2;
  const a = Math.max(0, c - w);
  const b = Math.min(clip.frames, c + w);
  return {
    slot,
    attachment: stepped([
      { frame: 0, value: null },
      { frame: a, value: name },
      ...(b < clip.frames ? [{ frame: b, value: null }] : []),
    ]),
    color: colorKeys([
      { frame: 0, value: WHITE(0) },
      { frame: a, value: WHITE(0) },
      { frame: c, value: WHITE(1) },
      { frame: b, value: WHITE(0) },
    ]),
  };
}

/**
 * Add the detail tracks of `rules[clip.name]` (default `DETAIL_RULES`) to `clip`. Existing tracks of the same slot are
 * replaced. Returns the clip unchanged when no rule matches or the rig has none of the detail slots.
 */
export function applyDetail(
  rig: RigDocument,
  clip: Clip,
  rules: Readonly<Record<string, ClipDetail>> = DETAIL_RULES,
): Clip {
  const rule = rules[clip.name] ?? rules[clip.name.replace(/_\d+$/, '')];
  if (!rule) return clip;
  const added = [
    eyesTrack(rig, clip, rule),
    holdTrack(rig, clip, DETAIL_SLOTS.mouth, rule.mouth),
    holdTrack(rig, clip, DETAIL_SLOTS.handR, rule.handR),
    holdTrack(rig, clip, DETAIL_SLOTS.handL, rule.handL),
    trailTracks(rig, clip, rule.trail),
    glintTrack(rig, clip, rule.glint),
  ].filter((t): t is SlotTrack => !!t);
  if (!added.length) return clip;
  const replaced = new Set(added.map((t) => t.slot));
  return { ...clip, slots: [...clip.slots.filter((s) => !replaced.has(s.slot)), ...added] };
}

/** Apply the layer to a whole clip set. */
export function applyDetailSet(
  rig: RigDocument,
  clips: readonly Clip[],
  rules?: Readonly<Record<string, ClipDetail>>,
): Clip[] {
  return clips.map((c) => applyDetail(rig, c, rules));
}

// ---------------------------------------------------------------------------------------------------------------------
// secondary chains

/**
 * Chains of the detail layer. Placement (`at`) is relative to the parent bone and tuned against the assembled rig:
 * `addDetailChains(rig, overrides)` takes per-chain replacements. Stiffness/damping/gravity follow the existing
 * hair/sash/sleeve chains (docs/art/rig-pipeline.md): light cloth is looser than hair, the pendant is a pendulum.
 */
export const DETAIL_CHAINS: readonly ChainTemplate[] = [
  {
    name: 'hair_strand_a',
    kind: 'hair',
    parent: 'head',
    segments: 2,
    length: 7,
    at: { x: 8, y: 6, rotation: 100 },
    stiffness: 0.4,
    damping: 0.35,
    gravity: 100,
  },
  {
    name: 'hair_strand_b',
    kind: 'hair',
    parent: 'head',
    segments: 2,
    length: 8,
    at: { x: 8, y: -6, rotation: 80 },
    stiffness: 0.4,
    damping: 0.35,
    gravity: 100,
  },
  {
    name: 'hair_strand_c',
    kind: 'hair',
    parent: 'head',
    segments: 2,
    length: 6,
    at: { x: 10, y: 2, rotation: 95 },
    stiffness: 0.45,
    damping: 0.35,
    gravity: 90,
  },
  {
    name: 'ponytail',
    kind: 'hair',
    parent: 'head',
    segments: 4,
    length: 7,
    at: { x: 12, y: 0, rotation: 180 },
    stiffness: 0.3,
    damping: 0.3,
    gravity: 140,
  },
  {
    name: 'ribbon_tail_L',
    kind: 'ribbon',
    parent: 'head',
    segments: 3,
    length: 6,
    at: { x: 10, y: 2, rotation: 160 },
    stiffness: 0.22,
    damping: 0.35,
    gravity: 90,
  },
  {
    name: 'ribbon_tail_R',
    kind: 'ribbon',
    parent: 'head',
    segments: 3,
    length: 6,
    at: { x: 10, y: -2, rotation: 200 },
    stiffness: 0.22,
    damping: 0.35,
    gravity: 90,
  },
  {
    name: 'sash_tail_L',
    kind: 'sash',
    parent: 'hips',
    segments: 3,
    length: 7,
    at: { x: 2, y: 3, rotation: -180 },
    stiffness: 0.3,
    damping: 0.3,
    gravity: 200,
  },
  {
    name: 'sash_tail_R',
    kind: 'sash',
    parent: 'hips',
    segments: 3,
    length: 7,
    at: { x: 2, y: -3, rotation: -180 },
    stiffness: 0.3,
    damping: 0.3,
    gravity: 200,
  },
  {
    name: 'pendant',
    kind: 'tail',
    parent: 'hips',
    segments: 2,
    length: 6,
    at: { x: 0, y: 4, rotation: -180 },
    stiffness: 0.15,
    damping: 0.25,
    gravity: 260,
  },
  {
    name: 'sleeve_edge_L',
    kind: 'sleeve',
    parent: 'lower_arm_L',
    segments: 1,
    length: 9,
    at: { x: 10, y: 0, rotation: 0 },
    stiffness: 0.5,
    damping: 0.4,
  },
  {
    name: 'sleeve_edge_R',
    kind: 'sleeve',
    parent: 'lower_arm_R',
    segments: 1,
    length: 9,
    at: { x: 10, y: 0, rotation: 0 },
    stiffness: 0.5,
    damping: 0.4,
  },
  {
    name: 'robe_hem_front',
    kind: 'cape',
    parent: 'hips',
    segments: 2,
    length: 12,
    at: { x: -8, y: 3, rotation: -180 },
    stiffness: 0.35,
    damping: 0.4,
    gravity: 120,
  },
  {
    name: 'robe_hem_back',
    kind: 'cape',
    parent: 'hips',
    segments: 2,
    length: 12,
    at: { x: -8, y: -3, rotation: -180 },
    stiffness: 0.35,
    damping: 0.4,
    gravity: 120,
  },
];

/**
 * The 13 detail templates share secondary-motion chains: `RIG_LIMITS.player` allows 6 chains per rig, but a chain may be
 * a tree of bones with one spring setting, and the springs are baked to keys anyway. Grouping by motion character gives
 * 5 chains (hair strands + ponytail, sash tails + pendant, ribbon tails, sleeve edges, robe hem), leaving one free.
 */
export interface DetailGroup {
  readonly name: string;
  readonly kind: ChainTemplate['kind'];
  readonly stiffness: number;
  readonly damping: number;
  readonly gravity: number;
  readonly members: readonly string[];
}

export const DETAIL_GROUPS: readonly DetailGroup[] = [
  {
    name: 'hair_group',
    kind: 'hair',
    stiffness: 0.35,
    damping: 0.33,
    gravity: 110,
    members: ['ponytail', 'hair_strand_a', 'hair_strand_b', 'hair_strand_c'],
  },
  {
    name: 'sash_group',
    kind: 'sash',
    stiffness: 0.25,
    damping: 0.28,
    gravity: 220,
    members: ['sash_tail_L', 'sash_tail_R', 'pendant'],
  },
  {
    name: 'ribbon_group',
    kind: 'ribbon',
    stiffness: 0.22,
    damping: 0.35,
    gravity: 90,
    members: ['ribbon_tail_L', 'ribbon_tail_R'],
  },
  {
    name: 'sleeve_group',
    kind: 'sleeve',
    stiffness: 0.5,
    damping: 0.4,
    gravity: 0,
    members: ['sleeve_edge_L', 'sleeve_edge_R'],
  },
  {
    name: 'hem_group',
    kind: 'cape',
    stiffness: 0.35,
    damping: 0.4,
    gravity: 120,
    members: ['robe_hem_front', 'robe_hem_back'],
  },
];

export interface DetailChainsResult {
  readonly rig: RigDocument;
  /** Templates whose bones were added. */
  readonly added: readonly string[];
  /** Templates not added, with the reason (missing parent, name clash, or which RIG_LIMITS budget they would exceed). */
  readonly skipped: readonly { readonly name: string; readonly reason: string }[];
}

export interface DetailChainsOptions {
  /** Per-template replacements of placement / size. Spring settings belong to the group (`DETAIL_GROUPS`). */
  readonly overrides?: Readonly<Record<string, Partial<Pick<ChainTemplate, 'at' | 'length' | 'segments'>>>>;
  /** Throw (listing what does not fit) instead of reporting skipped templates. */
  readonly strict?: boolean;
}

/**
 * Bones + grouped chains for the detail templates whose parent exists and that the rig does not have yet, **within the
 * docs/03 budget** (`RIG_LIMITS`: bones and secondary-motion chains of the rig's kind). A template that does not fit is
 * skipped and reported (groups are filled in `DETAIL_GROUPS` order); the limits are never exceeded. Needing more than the
 * limits allow is a limit change (DECISIONS entry + `@vgtd/character`), not something this function works around.
 */
export function addDetailChains(rig: RigDocument, opts: DetailChainsOptions = {}): DetailChainsResult {
  const limits = RIG_LIMITS[rig.kind === 'boss' ? 'boss' : rig.kind === 'pet' ? 'pet' : 'player'];
  const overrides = opts.overrides ?? {};
  const bones: RigBone[] = [...rig.bones];
  const chains: RigChain[] = [...(rig.chains ?? [])];
  const names = new Set(bones.map((b) => b.name));
  const added: string[] = [];
  const skipped: { name: string; reason: string }[] = [];
  const byName = new Map(DETAIL_CHAINS.map((t) => [t.name, t]));
  for (const g of DETAIL_GROUPS) {
    for (const member of g.members) {
      const t0 = byName.get(member);
      if (!t0) continue;
      const t = { ...t0, ...(overrides[member] ?? {}) };
      const parent = rig.roles[t.parent as keyof typeof rig.roles] ?? t.parent;
      const ids = Array.from({ length: t.segments }, (_, i) => `${t.name}_${i + 1}`);
      const existing = chains.find((c) => c.name === g.name);
      const why = !names.has(parent)
        ? `parent bone '${parent}' is missing`
        : ids.some((n) => names.has(n))
          ? 'the rig already has it'
          : !existing && chains.length + 1 > limits.physicsConstraints
            ? `chain budget: ${chains.length} chains already, limit ${limits.physicsConstraints}`
            : bones.length + ids.length > limits.bones
              ? `bone budget: ${bones.length} bones + ${ids.length} > limit ${limits.bones}`
              : null;
      if (why) {
        skipped.push({ name: member, reason: why });
        continue;
      }
      ids.forEach((name, i) => {
        bones.push(
          i === 0
            ? { name, parent, length: t.length, x: t.at.x, y: t.at.y, rotation: t.at.rotation }
            : { name, parent: ids[i - 1]!, length: t.length, x: t.length, y: 0, rotation: 0 },
        );
        names.add(name);
      });
      if (existing) {
        chains[chains.indexOf(existing)] = { ...existing, bones: [...existing.bones, ...ids] };
      } else {
        chains.push({
          name: g.name,
          kind: g.kind,
          bones: ids,
          stiffness: g.stiffness,
          damping: g.damping,
          ...(g.gravity ? { gravity: g.gravity } : {}),
        });
      }
      added.push(member);
    }
  }
  const real = skipped.filter((x) => !x.reason.endsWith('already has it'));
  if (opts.strict && real.length) {
    const lines = real.map((x) => `  ${x.name}: ${x.reason}`);
    throw new RangeError(`detail chains do not fit the rig budget:\n${lines.join('\n')}`);
  }
  return { rig: { ...rig, bones, chains }, added, skipped };
}
