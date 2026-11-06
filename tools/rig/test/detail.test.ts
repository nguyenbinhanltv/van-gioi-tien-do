import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { RIG_LIMITS } from '@vgtd/character';
import { describe, expect, it } from 'vitest';
import {
  DETAIL_DISPLAYS,
  DETAIL_SLOTS,
  DETAIL_CHAINS,
  DETAIL_CHAIN_PRIORITY,
  addDetailChains,
  loadCharacterData,
  validateRig,
  applyDetail,
  authorKiemTuSet,
  bakeSecondaryMotion,
  blinkStarts,
  buildReferenceHumanoid,
  type Clip,
  type RegionAttachment,
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

  it('blinks open-half-closed-half-open, 3-5 s apart, deterministically, never past the loop end', () => {
    const idle = clip('idle', 150, true);
    const a = applyDetail(rig, idle);
    const b = applyDetail(rig, idle);
    expect(a).toEqual(b);
    const starts = blinkStarts('idle', 600);
    expect(starts.length).toBeGreaterThanOrEqual(3);
    for (let i = 1; i < starts.length; i++) {
      expect(starts[i]! - starts[i - 1]!).toBeGreaterThanOrEqual(90);
      expect(starts[i]! - starts[i - 1]!).toBeLessThanOrEqual(150);
    }
    const long = applyDetail(rig, clip('idle', 600, true));
    const keys = track(long, 'eyes')!.attachment!;
    expect(keys.some((k) => k.value === 'eyes_closed')).toBe(true);
    expect(Math.max(...keys.map((k) => k.frame))).toBeLessThan(600);
    expect(shown(long, 'eyes', 0)).toBe('eyes_open');
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

  it('never exceeds RIG_LIMITS: the committed Kiếm tu rig is already at 6 chains, so nothing is added and it stays valid', () => {
    expect(errors(kiem)).toEqual([]);
    const res = addDetailChains(kiem);
    expect(res.added).toEqual([]);
    expect(res.skipped.length).toBe(DETAIL_CHAINS.length);
    expect(res.skipped[0]!.reason).toMatch(/chain budget/);
    expect(errors(res.rig)).toEqual([]);
  });

  it('on a rig with a free chain budget it adds in priority order up to the limit and validates', () => {
    const bare: RigDocument = { ...kiem, chains: [] };
    const res = addDetailChains(bare);
    expect(res.added).toEqual(DETAIL_CHAIN_PRIORITY.slice(0, RIG_LIMITS.player.physicsConstraints));
    expect(res.skipped.length).toBe(DETAIL_CHAINS.length - res.added.length);
    expect(res.rig.chains!.length).toBeLessThanOrEqual(RIG_LIMITS.player.physicsConstraints);
    expect(res.rig.bones.length).toBeLessThanOrEqual(RIG_LIMITS.player.bones);
    expect(errors(res.rig)).toEqual([]);
  });

  it('skips chains whose bones do not fit the bone budget and says so; strict throws', () => {
    const tight: RigDocument = { ...kiem, chains: [], bones: [...kiem.bones] };
    const room = RIG_LIMITS.player.bones - tight.bones.length;
    const res = addDetailChains(tight, { overrides: { ponytail: { segments: room + 1 } } });
    expect(res.skipped.find((x) => x.name === 'ponytail')!.reason).toMatch(/bone budget/);
    expect(() => addDetailChains(tight, { overrides: { ponytail: { segments: room + 1 } }, strict: true })).toThrow(
      /ponytail: bone budget/,
    );
    expect(() => addDetailChains(kiem, { strict: true })).toThrow(/chain budget/);
  });

  it('is idempotent and honours overrides', () => {
    const bare: RigDocument = { ...kiem, chains: [] };
    const once = addDetailChains(bare, { overrides: { ponytail: { segments: 3 } } });
    expect(once.rig.chains!.find((c) => c.name === 'ponytail')!.bones).toHaveLength(3);
    const twice = addDetailChains(once.rig);
    expect(twice.added).toEqual([]);
    expect(twice.rig).toEqual(once.rig);
  });

  it('the spring bake moves an added chain when the body moves', () => {
    const rig = addDetailChains(buildReferenceHumanoid('E')).rig;
    expect(rig.chains!.some((c) => c.name === 'ponytail')).toBe(true);
    const run = authorKiemTuSet(rig, { only: ['run'] })[0]!;
    expect(run.bones.find((b) => b.bone === 'ponytail_1')?.rotate?.length ?? 0).toBeGreaterThan(2);
    expect(bakeSecondaryMotion(rig, run, { gain: 0 })).toBe(run);
  });
});
