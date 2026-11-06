import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIG_LIMITS } from '@vgtd/character';
import { describe, expect, it } from 'vitest';
import {
  DETAIL_DISPLAYS,
  DETAIL_SLOTS,
  DETAIL_CHAINS,
  DEFAULT_IGNORED_SLOTS,
  DETAIL_GROUPS,
  BLINK_CYCLE_CLIP,
  BLINK_CYCLE_FRAMES,
  addDetailChains,
  authorBlinkCycle,
  loadCharacterData,
  validateRig,
  applyDetail,
  authorKiemTuSet,
  bakeSecondaryMotion,
  blinkStarts,
  buildReferenceHumanoid,
  type Clip,
  type RegionAttachment,
  type RigAttachment,
  type RigDocument,
} from '../src/index.js';

const region = (path: string): RegionAttachment => ({ type: 'region', path, x: 0, y: 0, width: 4, height: 4 });

/** Reference humanoid plus the detail slots with every display variant. */
function detailRig(): RigDocument {
  const base = buildReferenceHumanoid('E');
  const add: Record<string, readonly string[]> = {
    [DETAIL_SLOTS.eyes]: Object.values(DETAIL_DISPLAYS.eyes),
    [DETAIL_SLOTS.mouth]: Object.values(DETAIL_DISPLAYS.mouth),
    [DETAIL_SLOTS.handR]: Object.values(DETAIL_DISPLAYS.handR),
    [DETAIL_SLOTS.handL]: Object.values(DETAIL_DISPLAYS.handL),
    [DETAIL_SLOTS.trail]: Object.values(DETAIL_DISPLAYS.trail),
    [DETAIL_SLOTS.glint]: Object.values(DETAIL_DISPLAYS.glint),
  };
  const bone = (slot: string) =>
    slot === 'eyes' || slot === 'mouth' ? 'head' : slot.startsWith('hand_L') ? 'hand_L' : 'hand_R';
  return {
    ...base,
    slots: [
      ...base.slots,
      ...Object.keys(add).map((name) => ({
        name,
        bone: bone(name),
        ...(name.startsWith('sword') ? { blend: 'additive' as const } : {}),
      })),
    ],
    skins: base.skins.map((sk) => ({
      ...sk,
      attachments: {
        ...sk.attachments,
        ...Object.fromEntries(
          Object.entries(add).map(([slot, names]) => [slot, Object.fromEntries(names.map((n) => [n, region(n)]))]),
        ),
      },
    })),
  };
}

const clip = (name: string, frames: number, loop: boolean, phases?: Record<string, number>): Clip => ({
  name,
  frames,
  loop,
  bones: [],
  slots: [],
  ik: [],
  events: [],
  ...(phases ? { phases } : {}),
});

const track = (c: Clip, slot: string) => c.slots.find((s) => s.slot === slot);
const shown = (c: Clip, slot: string, frame: number) => {
  const keys = track(c, slot)?.attachment ?? [];
  return [...keys].reverse().find((k) => k.frame <= frame)?.value;
};

describe('detail layer', () => {
  const rig = detailRig();

  it('body clips never key blinks: idle / walk / channel / emote / die leave the eyes slot to blink_cycle', () => {
    for (const name of ['idle', 'walk', 'channel', 'emote', 'die', 'run', 'attack', 'cast', 'hit']) {
      for (const [frames, loop] of [
        [30, true],
        [150, true],
        [600, true],
        [600, false],
      ] as const)
        expect(track(applyDetail(rig, clip(name, frames, loop)), 'eyes'), `${name}/${frames}`).toBeUndefined();
    }
    // authored Kiem tu set: only meditate keeps an explicit eyes hold
    const set = authorKiemTuSet(rig, { secondary: false, detail: true });
    expect(set.filter((c) => track(c, 'eyes')).map((c) => c.name)).toEqual(['meditate']);
    expect(blinkStarts('idle', 30)).toEqual([]);
  });

  it('meditate keeps the eyes closed', () => {
    const m = applyDetail(rig, clip('meditate', 90, true));
    expect(shown(m, 'eyes', 0)).toBe('eyes_closed');
    expect(shown(m, 'eyes', 80)).toBe('eyes_closed');
  });

  it('attacks: shout around the hit, fist on the free hand, trail and glint only around the hit', () => {
    const atk = applyDetail(rig, clip('attack_2', 13, false, { windup_end: 4, hit_frame: 6, combo_window: 9 }));
    expect(shown(atk, 'mouth', 3)).toBe('mouth_neutral');
    expect(shown(atk, 'mouth', 5)).toBe('mouth_open');
    expect(shown(atk, 'mouth', 11)).toBe('mouth_neutral');
    expect(shown(atk, 'hand_R', 0)).toBe('hand_R_grip');
    expect(shown(atk, 'hand_L', 5)).toBe('hand_L_fist');
    expect(shown(atk, 'sword_trail', 0)).toBeNull();
    expect(shown(atk, 'sword_trail', 5)).toBe('sword_trail');
    expect(shown(atk, 'sword_trail', 12)).toBeNull();
    const alpha = track(atk, 'sword_trail')!.color!;
    expect(alpha.find((k) => k.frame === 6)!.value[3]).toBe(1);
    expect(alpha[0]!.value[3]).toBe(0);
    expect(shown(atk, 'sword_glint', 6)).toBe('sword_glint');
  });

  it('cast shows the sword seal on the free hand and an open mouth while channelling', () => {
    const c = applyDetail(rig, clip('cast', 20, false, { windup_end: 8 }));
    expect(shown(c, 'hand_L', 10)).toBe('hand_L_seal');
    expect(shown(c, 'mouth', 9)).toBe('mouth_open');
  });

  it('skips tracks the rig has no slot or display for (old rigs stay valid)', () => {
    const old = buildReferenceHumanoid('E');
    const c = clip('attack', 13, false, { windup_end: 4, hit_frame: 6 });
    expect(applyDetail(old, c)).toBe(c);
    const partial = { ...rig, slots: rig.slots.filter((s) => s.name !== 'sword_trail') };
    expect(track(applyDetail(partial, c), 'sword_trail')).toBeUndefined();
    expect(track(applyDetail(partial, c), 'mouth')).toBeDefined();
  });

  it('only references displays that exist (QA passes on the whole Kiếm tu set)', () => {
    const set = authorKiemTuSet(rig, { secondary: false }).map((c) => applyDetail(rig, c));
    for (const c of set)
      for (const t of c.slots)
        for (const k of t.attachment ?? [])
          if (k.value) expect(rig.skins[0]!.attachments[t.slot]?.[k.value]).toBeDefined();
    expect(set.filter((c) => track(c, 'mouth')).length).toBeGreaterThanOrEqual(12);
  });
});

describe('detail chains', () => {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const kiem = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('E')!.rig;
  const errors = (r: RigDocument) => validateRig(r).filter((i) => i.severity === 'error');
  /**
   * The Kiếm tu body without its old chain bones: the starting point of the continuous rig. Mesh weights on a dropped
   * bone move to its nearest kept ancestor.
   */
  const lean: RigDocument = (() => {
    const drop = new Set((kiem.chains ?? []).flatMap((c) => c.bones));
    const parent = new Map(kiem.bones.map((b) => [b.name, b.parent]));
    const kept = (n: string): string => (drop.has(n) ? kept(parent.get(n)!) : n);
    const remap = (a: RigAttachment): RigAttachment =>
      a.type === 'mesh' && a.weights
        ? {
            ...a,
            weights: a.weights.map((w) => {
              const sum = new Map<string, number>();
              for (const [bone, v] of w) sum.set(kept(bone), (sum.get(kept(bone)) ?? 0) + v);
              return [...sum];
            }),
          }
        : a;
    return {
      ...kiem,
      chains: [],
      bones: kiem.bones.filter((b) => !drop.has(b.name)),
      skins: kiem.skins.map((sk) => ({
        ...sk,
        attachments: Object.fromEntries(
          Object.entries(sk.attachments).map(([slot, m]) => [
            slot,
            Object.fromEntries(Object.entries(m).map(([n, a]) => [n, remap(a)])),
          ]),
        ),
      })),
    };
  })();

  it('never exceeds RIG_LIMITS: the committed Kiếm tu rig already has 6 chains, so nothing is added and it stays valid', () => {
    expect(errors(kiem)).toEqual([]);
    const res = addDetailChains(kiem);
    expect(res.added).toEqual([]);
    expect(res.skipped.length).toBe(DETAIL_CHAINS.length);
    expect(res.skipped[0]!.reason).toMatch(/chain budget/);
    expect(errors(res.rig)).toEqual([]);
  });

  it('puts all 13 detail templates into 5 grouped chains within the 6-chain / 60-bone budget, and validates', () => {
    expect(errors(lean)).toEqual([]);
    const res = addDetailChains(lean);
    expect(res.skipped).toEqual([]);
    expect(res.added.length).toBe(DETAIL_CHAINS.length);
    expect(res.rig.chains!.map((c) => c.name)).toEqual(DETAIL_GROUPS.map((g) => g.name));
    expect(res.rig.chains!.length).toBeLessThanOrEqual(RIG_LIMITS.player.physicsConstraints);
    expect(res.rig.bones.length).toBeLessThanOrEqual(RIG_LIMITS.player.bones);
    expect(errors(res.rig)).toEqual([]);
    // every chain bone belongs to exactly one group and sits under its template's parent
    const inChains = (res.rig.chains ?? []).flatMap((c) => c.bones);
    expect(new Set(inChains).size).toBe(inChains.length);
  });

  it('skips templates whose bones do not fit the bone budget and says so; strict throws', () => {
    const tight = { overrides: { ponytail: { segments: RIG_LIMITS.player.bones } } };
    const res = addDetailChains(lean, tight);
    expect(res.skipped.find((x) => x.name === 'ponytail')!.reason).toMatch(/bone budget/);
    expect(res.rig.bones.length).toBeLessThanOrEqual(RIG_LIMITS.player.bones);
    expect(errors(res.rig)).toEqual([]);
    expect(() => addDetailChains(lean, { ...tight, strict: true })).toThrow(/ponytail: bone budget/);
    expect(() => addDetailChains(kiem, { strict: true })).toThrow(/chain budget/);
  });

  it('is idempotent and honours placement overrides', () => {
    const once = addDetailChains(lean, { overrides: { ponytail: { segments: 3 } } });
    expect(once.rig.bones.filter((b) => b.name.startsWith('ponytail_'))).toHaveLength(3);
    const twice = addDetailChains(once.rig);
    expect(twice.added).toEqual([]);
    expect(twice.rig).toEqual(once.rig);
  });

  it('the spring bake moves the grouped chain bones when the body moves', () => {
    const rig = addDetailChains(buildReferenceHumanoid('E')).rig;
    expect(rig.chains!.some((c) => c.name === 'hair_group')).toBe(true);
    expect(errors(rig)).toEqual([]);
    const run = authorKiemTuSet(rig, { only: ['run'] })[0]!;
    expect(run.bones.find((b) => b.bone === 'ponytail_1')?.rotate?.length ?? 0).toBeGreaterThan(2);
    expect(bakeSecondaryMotion(rig, run, { gain: 0 })).toBe(run);
  });
});

describe('chain swing limit and silhouette props', () => {
  it('maxAngle keeps every bone of a chain within its limit while the body moves', () => {
    const base = addDetailChains(buildReferenceHumanoid('E')).rig;
    const limited: RigDocument = {
      ...base,
      chains: (base.chains ?? []).map((c) => ({ ...c, maxAngle: 20 })),
    };
    const run = authorKiemTuSet(limited, { only: ['run'] })[0]!;
    const chainBones = new Set((limited.chains ?? []).flatMap((c) => c.bones));
    let worst = 0;
    for (const t of run.bones) {
      if (!chainBones.has(t.bone)) continue;
      for (const k of t.rotate ?? []) worst = Math.max(worst, Math.abs(k.value));
    }
    expect(worst).toBeGreaterThan(1);
    expect(worst).toBeLessThanOrEqual(20.01);
    for (const g of DETAIL_GROUPS) expect(g.maxAngle).toBeLessThanOrEqual(35);
  });

  it('the silhouette check ignores the ground shadow and the sword effect layers', () => {
    for (const s of ['weapon_R', 'shadow', 'sword_trail', 'sword_glint']) expect(DEFAULT_IGNORED_SLOTS).toContain(s);
  });
});

describe('blink cycle', () => {
  const rig = detailRig();
  it('is an independent looping eyes-only clip with blinks 3-5 s apart and no double blink across the loop', () => {
    const c = authorBlinkCycle(rig)!;
    expect(c.name).toBe(BLINK_CYCLE_CLIP);
    expect(c.loop).toBe(true);
    expect(c.bones).toEqual([]);
    expect(c.slots.map((s) => s.slot)).toEqual(['eyes']);
    const starts = blinkStarts(BLINK_CYCLE_CLIP, BLINK_CYCLE_FRAMES, true);
    expect(starts.length).toBeGreaterThanOrEqual(2);
    for (let i = 1; i < starts.length; i++) expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(90);
    expect(BLINK_CYCLE_FRAMES - starts[starts.length - 1]! + starts[0]!).toBeGreaterThanOrEqual(90);
    expect(BLINK_CYCLE_FRAMES - starts[starts.length - 1]! + starts[0]!).toBeLessThanOrEqual(150);
    const keys = c.slots[0]!.attachment!;
    expect(keys.filter((k) => k.value === 'eyes_closed')).toHaveLength(starts.length);
    expect(Math.max(...keys.map((k) => k.frame))).toBeLessThan(BLINK_CYCLE_FRAMES);
  });
  it('every blink gap of a looping clip, including across the wrap, is 3-5 s', () => {
    for (const name of ['blink_cycle', 'idle', 'walk', 'x', 'emote'])
      for (const frames of [135, 150, 180, 200, 270, 300, 330, 450, 600]) {
        const s = blinkStarts(name, frames, true);
        expect(s.length).toBeGreaterThanOrEqual(1);
        expect(Math.max(...s) + 5).toBeLessThan(frames);
        if (s.length > 1) {
          const sorted = [...s].sort((a, b) => a - b);
          for (let i = 0; i < sorted.length; i++) {
            const gap = i + 1 < sorted.length ? sorted[i + 1]! - sorted[i]! : frames - sorted[i]! + sorted[0]!;
            expect(gap, `${name}/${frames}`).toBeGreaterThanOrEqual(90);
            expect(gap, `${name}/${frames}`).toBeLessThanOrEqual(150);
          }
        }
      }
    // 151-179 frames: two blinks would be < 3 s apart and one would leave a gap > 5 s, so no blink (documented)
    for (const f of [151, 160, 170, 179]) expect(blinkStarts('idle', f, true), String(f)).toEqual([]);
    // a single blink per loop is only allowed when the loop itself is 3-5 s
    expect(blinkStarts('idle', 120, true).length).toBe(1);
    expect(blinkStarts('idle', 60, true)).toEqual([]);
  });

  it('is null for a rig without the eyes slot and deterministic otherwise', () => {
    expect(authorBlinkCycle(buildReferenceHumanoid('E'))).toBeNull();
    expect(authorBlinkCycle(rig)).toEqual(authorBlinkCycle(rig));
  });
});
