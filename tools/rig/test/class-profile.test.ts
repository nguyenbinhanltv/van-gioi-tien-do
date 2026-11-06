import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RIG_LIMITS } from '@vgtd/character';
import {
  THE_TU_DETAIL_RULES,
  THE_TU_E_PIECES,
  THE_TU_PROFILE,
  applyDetail,
  applyLandmarks,
  assembleContinuous,
  authorClassSet,
  buildSkirtMesh,
  createImage,
  evalPose,
  getAssemblyProfile,
  loadCharacterData,
  snapIkTargets,
  spineWeights,
  validateRig,
  type Image,
  type Landmarks,
} from '../src/index.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const view = { scale: 2, pivot: [64, 116] as const };
const base = loadCharacterData(repoRoot, 'kiem-tu').byDirection.get('E')!.rig;
// Thể tu E landmarks (worker 18's art): stockier and with different ankle heights than the Kiếm tu base rig
const landmarks: Landmarks = {
  neck: [131, 82],
  head: [130, 65],
  shoulder_R: [114, 98],
  elbow_R: [104, 119],
  wrist_R: [100, 133],
  shoulder_L: [148, 101],
  elbow_L: [154, 117],
  wrist_L: [157, 132],
  hip_R: [119, 150],
  knee_R: [116, 184],
  ankle_R: [115, 214],
  foot_tip_R: [126, 229],
  hip_L: [141, 150],
  knee_L: [147, 183],
  ankle_L: [145, 213],
  foot_tip_L: [158, 226],
  waist: [133, 126],
};

function rect(x0: number, y0: number, x1: number, y1: number): Image {
  const img = createImage(256, 256);
  for (let y = y0; y < y1; y++) for (let x = x0; x < x1; x++) img.data.set([200, 200, 200, 255], (y * 256 + x) * 4);
  return img;
}

const swaps = ['relaxed', 'guard', 'fist', 'open', 'ground'];

describe('Thể tu assembly profile', () => {
  it('has no weapon: no weapon / scabbard / trail / glint piece, gauntlets are displays on the hand slots', () => {
    const slots = new Set(THE_TU_E_PIECES.map((p) => p.slot));
    for (const s of ['weapon_R', 'scabbard', 'sword_trail', 'sword_glint']) expect(slots.has(s)).toBe(false);
    for (const side of ['L', 'R']) {
      const ids = THE_TU_E_PIECES.filter((p) => p.slot === `hand_${side}`).map((p) => p.id);
      expect(ids).toEqual(swaps.map((v) => `gauntlet_${side}_${v}`));
    }
    expect(THE_TU_PROFILE.dropBones).toEqual(expect.arrayContaining(['weapon', 'scabbard']));
    expect(THE_TU_PROFILE.qaWeapon).toBe('none');
    expect(THE_TU_PROFILE.borrowsSword).toBe(false);
    expect(getAssemblyProfile('the-tu')).toBe(THE_TU_PROFILE);
    expect(() => getAssemblyProfile('phap-tu')).toThrow(/no continuous-limb/);
  });

  it('direction-specific tuning: the R knee override is E-only, S has its own deeper-knee gait', () => {
    expect(Object.keys(THE_TU_PROFILE.ikBend!)).toEqual(['E']);
    expect(THE_TU_PROFILE.gaitByDir!.S!.crouchScale).toBeGreaterThan(THE_TU_PROFILE.gait.crouchScale);
    expect(THE_TU_PROFILE.gaitByDir!.E).toBeUndefined();
  });

  it('keeps piece ids unique and the slots inside the slot budget', () => {
    const ids = THE_TU_E_PIECES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(THE_TU_E_PIECES.map((p) => p.slot)).size).toBeLessThanOrEqual(RIG_LIMITS.player.slots);
  });

  it('every display named by a detail rule is a piece of the profile, in the slot the rule drives', () => {
    const slotOf = new Map(THE_TU_E_PIECES.map((p) => [p.id, p.slot]));
    const check = (name: string, slot: string) => expect(slotOf.get(name), `${name} in ${slot}`).toBe(slot);
    for (const rule of Object.values(THE_TU_DETAIL_RULES)) {
      const specs: [string, { base: string; holds?: readonly { show: string }[] } | undefined][] = [
        ['mouth', rule.mouth],
        ['hand_R', rule.handR],
        ['hand_L', rule.handL],
        ...Object.entries(rule.extra ?? {}),
      ];
      for (const [slot, s] of specs) {
        if (!s) continue;
        check(s.base, slot);
        for (const h of s.holds ?? []) check(h.show, slot);
      }
      if (rule.eyes) check(rule.eyes, 'eyes');
      expect(rule.trail).toBeUndefined();
      expect(rule.glint).toBeUndefined();
    }
  });

  it('has a rule for every clip of the 15-clip set and only meditate holds the eyes', () => {
    const clips = authorClassSet('the-tu', base, { detail: false }).map((c) => c.name);
    expect(clips).toHaveLength(15);
    for (const n of clips) expect(THE_TU_DETAIL_RULES[n], n).toBeDefined();
    expect(
      Object.entries(THE_TU_DETAIL_RULES)
        .filter(([, r]) => r.eyes)
        .map(([n]) => n),
    ).toEqual(['meditate']);
  });

  it('syncs gauntlets and brows to the strike: fist on the striking side only, angry brows through the clip', () => {
    const disp = (names: string[]) => Object.fromEntries(names.map((n) => [n, {} as never]));
    const rig = {
      ...base,
      slots: [
        ...base.slots,
        { name: 'hand_R', bone: 'hand_R', attachment: 'gauntlet_R_guard' },
        { name: 'hand_L', bone: 'hand_L', attachment: 'gauntlet_L_guard' },
        { name: 'brows', bone: 'head', attachment: 'brows_neutral' },
        { name: 'mouth', bone: 'head', attachment: 'mouth_neutral' },
      ],
      skins: [
        {
          name: 'default',
          attachments: {
            ...base.skins[0]!.attachments,
            hand_R: disp(['gauntlet_R_guard', 'gauntlet_R_fist']),
            hand_L: disp(['gauntlet_L_guard', 'gauntlet_L_fist']),
            brows: disp(['brows_neutral', 'brows_angry']),
            mouth: disp(['mouth_neutral', 'mouth_grit', 'mouth_shout']),
          },
        },
      ],
    };
    const clip = authorClassSet('the-tu', rig).find((c) => c.name === 'attack')!;
    const out = applyDetail(rig, clip, THE_TU_DETAIL_RULES);
    const track = (slot: string) => out.slots.find((s) => s.slot === slot)!.attachment!.map((k) => k.value);
    expect(track('hand_R')).toContain('gauntlet_R_fist');
    expect(track('hand_L')).not.toContain('gauntlet_L_fist');
    expect(track('brows')).toEqual(['brows_angry']);
    expect(track('mouth')).toContain('mouth_shout');
  });
});

describe('class-aware helpers', () => {
  it('snapIkTargets puts the foot IK targets on the new ankles and leaves a rig without IK alone', () => {
    const moved = applyLandmarks({ ...base, chains: [] }, landmarks, view);
    const snapped = snapIkTargets(moved);
    const p = evalPose(snapped, null, 0, { noIk: true });
    for (const side of ['L', 'R'] as const) {
      const ankle = p.byName.get(`shin_${side}`)!.tip;
      const target = p.byName.get(`ik_foot_${side}`)!.pos;
      expect(Math.hypot(ankle.x - target.x, ankle.y - target.y)).toBeLessThan(0.05);
    }
    expect(snapIkTargets({ ...moved, ik: [] })).toEqual({ ...moved, ik: [] });
  });

  it('spineWeights: above the hip the tabard follows the spine (no thigh weight), below it keeps the thigh blend', () => {
    const rig = applyLandmarks({ ...base, chains: [] }, landmarks, view);
    const r = rig.roles;
    const mesh = buildSkirtMesh(rig, {
      name: 'tabard',
      slotBone: r.hips!,
      hips: r.hips!,
      thighs: [r.thigh_L!, r.thigh_R!],
      view,
      image: rect(100, 80, 164, 180),
      cell: 10,
    });
    const out = spineWeights(rig, mesh, r.hips!);
    if (out.attachment.type !== 'mesh') throw new Error('mesh expected');
    const att = out.attachment;
    const rest = evalPose(rig, null, 0, { noIk: true });
    const hip = rest.byName.get(r.hips!)!;
    const yOf = (i: number) =>
      hip.world.b * att.vertices[i * 2]! + hip.world.d * att.vertices[i * 2 + 1]! + hip.world.ty;
    const upperY = rest.byName.get(r.spine_upper!)!.pos.y;
    let above = 0;
    let below = 0;
    att.weights!.forEach((w, i) => {
      expect(w.reduce((a, b) => a + b[1], 0)).toBeCloseTo(1, 3);
      const thighW = w.filter(([b]) => b === r.thigh_L || b === r.thigh_R).reduce((a, b) => a + b[1], 0);
      if (yOf(i) > hip.pos.y) {
        above++;
        expect(thighW).toBe(0);
        if (yOf(i) > upperY + 6) expect(w).toEqual([[r.spine_upper, 1]]);
      } else below++;
    });
    expect(above).toBeGreaterThan(0);
    expect(below).toBeGreaterThan(0);
  });

  it('assembles a Thể tu rig from synthetic parts: no weapon bone or slot, valid, inside the RIG_LIMITS budgets', () => {
    const parts = new Map<string, Image>([
      ['torso', rect(108, 74, 150, 153)],
      ['neck', rect(123, 73, 141, 84)],
      ['arm_L', rect(139, 92, 165, 140)],
      ['arm_R', rect(98, 92, 126, 140)],
      ['leg_L', rect(127, 135, 161, 222)],
      ['leg_R', rect(98, 133, 135, 227)],
      ['tabard_front', rect(98, 80, 163, 180)],
      ['tabard_back', rect(97, 81, 163, 178)],
      ['tabard_shoulder_L', rect(138, 90, 153, 112)],
      ['tabard_shoulder_R', rect(110, 81, 133, 98)],
      ['sash_band', rect(111, 120, 152, 137)],
      ['sash_tail_1', rect(135, 131, 147, 190)],
      ['head', rect(122, 60, 146, 81)],
      ['gauntlet_L_relaxed', rect(152, 122, 169, 163)],
      ['gauntlet_L_fist', rect(148, 123, 166, 160)],
      ['gauntlet_R_relaxed', rect(90, 124, 112, 165)],
      ['eyes_open', rect(136, 64, 142, 67)],
      ['boot_L', rect(134, 199, 162, 228)],
      ['sleeve_cuff_L', rect(150, 125, 165, 136)],
      ['trouser_hem_L', rect(134, 193, 155, 206)],
      ['trouser_hem_R', rect(102, 194, 127, 207)],
    ]);
    const res = assembleContinuous({
      base: { ...base, id: 'the-tu' },
      landmarks,
      view,
      parts,
      pieces: THE_TU_PROFILE.pieces,
      dropBones: THE_TU_PROFILE.dropBones,
      snapIk: true,
      extraChains: THE_TU_PROFILE.chains!,
      ikBend: THE_TU_PROFILE.ikBend!.E!,
    });
    expect(res.skipped).toEqual([]);
    expect(validateRig(res.rig).filter((i) => i.severity === 'error')).toEqual([]);
    expect(res.rig.bones.some((b) => b.name === 'weapon' || b.name === 'scabbard')).toBe(false);
    expect(res.rig.slots.some((s) => /weapon|scabbard|trail|glint/.test(s.name))).toBe(false);
    expect(res.rig.slots.find((s) => s.name === 'hand_L')!.attachment).toBe('gauntlet_L_relaxed');
    expect(Object.keys(res.rig.skins[0]!.attachments.hand_L!)).toEqual(['gauntlet_L_relaxed', 'gauntlet_L_fist']);
    expect(res.rig.ik!.find((k) => k.name === 'ik_leg_R')!.bendPositive).toBe(true);
    // cuffs and trouser hems are chains hanging from the forearm / shin, in the shared sleeve_group and the hem_group
    const chain = (n: string) => res.rig.chains!.find((c) => c.name === n)!;
    expect(chain('sleeve_group').bones).toEqual(['sleeve_edge_L_1']);
    expect(chain('hem_group').bones).toEqual(['trouser_hem_L_1', 'trouser_hem_R_1']);
    const parent = (n: string) => res.rig.bones.find((b) => b.name === n)!.parent;
    expect(parent('sleeve_edge_L_1')).toBe('lower_arm_L');
    expect(parent('trouser_hem_L_1')).toBe('shin_L');
    expect(parent('trouser_hem_R_1')).toBe('shin_R');
    for (const id of ['sleeve_cuff_L', 'trouser_hem_L', 'trouser_hem_R'])
      expect(res.rig.skins[0]!.attachments[id]![id]!.type).toBe('mesh');
    // a wide band lies along its parent: the hem chain starts parallel to the shin whatever the painted outline's slant
    const rest = evalPose(res.rig, null, 0, { noIk: true });
    for (const s of ['L', 'R'] as const) {
      const diff = Math.abs(
        ((rest.byName.get(`trouser_hem_${s}_1`)!.rotation - rest.byName.get(`shin_${s}`)!.rotation + 540) % 360) - 180,
      );
      expect(diff, s).toBeLessThan(0.01);
    }
    expect(res.stats.bones).toBeLessThanOrEqual(res.stats.limits.bones);
    expect(res.stats.vertices).toBeLessThanOrEqual(res.stats.limits.meshVertices);
    expect(res.stats.slots).toBeLessThanOrEqual(res.stats.limits.slots);
    expect(res.stats.chains).toBeLessThanOrEqual(res.stats.limits.chains);
    expect(res.stats.nonPremultiplied).toBe(0);
  });
});

describe('Thể tu combat poses', () => {
  const clips = authorClassSet('the-tu', base, { secondary: false });
  const get = (n: string) => clips.find((c) => c.name === n)!;
  const rot = (clip: ReturnType<typeof get>, bone: string, f: number) => {
    const keys = clip.bones.find((b) => b.bone === bone)!.rotate!;
    const k = [...keys].reverse().find((x) => x.frame <= f)!;
    return k.value;
  };

  it('strikes start and end in the guard stance (no drop of the arms), not in the bare rest pose', () => {
    for (const n of ['attack', 'attack_2', 'attack_3', 'hit']) {
      const c = get(n);
      const first = c.bones.find((b) => b.bone === 'upper_arm_R')!.rotate![0]!.value;
      const last = c.bones.find((b) => b.bone === 'upper_arm_R')!.rotate!.at(-1)!.value;
      expect(first, n).toBeCloseTo(55, 3);
      expect(last, n).toBeCloseTo(55, 3);
    }
  });

  it('holds the impact pose for the configured frames, with the hit event on the first of them', () => {
    const jab = get('attack');
    const hit = jab.phases!.hit_frame!;
    const arm = (f: number) => rot(jab, 'upper_arm_R', f);
    expect(arm(hit)).toBeCloseTo(115, 3);
    expect(arm(hit + 2)).toBeCloseTo(115, 3);
    expect(arm(hit + 3)).toBeLessThan(115);
    // the finisher holds one frame longer than the jab (3 vs 2): it is NOT clamped by the combo window
    const fin = get('attack_3');
    const finHit = fin.phases!.hit_frame!;
    const finArm = (f: number) => rot(fin, 'upper_arm_R', f);
    expect(fin.phases!.combo_window! - finHit).toBeGreaterThan(jab.phases!.combo_window! - hit);
    expect(finArm(finHit)).toBeCloseTo(112, 3);
    expect(finArm(finHit + 3)).toBeCloseTo(112, 3);
    expect(finArm(finHit + 4)).toBeLessThan(112);
    // the combo window is strictly inside the clip (30 fps clip length 13 = the table's 10 frames at 24 fps) with room to settle,
    // and the recoil pose (not the stance) is what the arm shows at the combo frame; the final key is the stance alone
    for (const c of [jab, get('attack_2'), fin]) expect(c.phases!.combo_window!, c.name).toBeLessThan(c.frames - 1);
    const finCombo = fin.phases!.combo_window!;
    expect(finArm(finCombo)).toBeCloseTo(85, 3);
    const finKeys = fin.bones.find((b) => b.bone === 'upper_arm_R')!.rotate!;
    expect(finKeys.filter((k) => k.frame === fin.frames)).toHaveLength(1);
    expect(new Set(finKeys.map((k) => k.frame)).size).toBe(finKeys.length);
    expect(jab.events.find((e) => e.name === 'hit')!.frame).toBe(hit);
    expect(get('attack_3').bones.find((b) => b.bone === 'upper_arm_L')).toBeDefined();
    // anticipation: the striking arm is drawn back before the impact, weight loaded back (hips behind the stance)
    expect(arm(jab.phases!.windup_end!)).toBeLessThan(arm(0));
  });

  it('shows the fist at the impact of the jab and cross, open gauntlets at the palm strike', () => {
    const disp = (names: string[]) => Object.fromEntries(names.map((n) => [n, {} as never]));
    const rig = {
      ...base,
      slots: [
        ...base.slots,
        { name: 'hand_R', bone: 'hand_R', attachment: 'gauntlet_R_guard' },
        { name: 'hand_L', bone: 'hand_L', attachment: 'gauntlet_L_guard' },
      ],
      skins: [
        {
          name: 'default',
          attachments: {
            ...base.skins[0]!.attachments,
            hand_R: disp(['gauntlet_R_guard', 'gauntlet_R_fist', 'gauntlet_R_open']),
            hand_L: disp(['gauntlet_L_guard', 'gauntlet_L_fist', 'gauntlet_L_open']),
          },
        },
      ],
    };
    const shown = (clip: string, slot: string, frame: number) => {
      const c = applyDetail(
        rig,
        authorClassSet('the-tu', rig, { secondary: false }).find((x) => x.name === clip)!,
        THE_TU_DETAIL_RULES,
      );
      const keys = c.slots.find((s) => s.slot === slot)!.attachment!;
      return [...keys].reverse().find((k) => k.frame <= frame)!.value;
    };
    const hitFrame = (n: string) => get(n).phases!.hit_frame!;
    expect(shown('attack', 'hand_R', hitFrame('attack'))).toBe('gauntlet_R_fist');
    expect(shown('attack_2', 'hand_L', hitFrame('attack_2'))).toBe('gauntlet_L_fist');
    expect(shown('attack_3', 'hand_R', hitFrame('attack_3'))).toBe('gauntlet_R_open');
    expect(shown('attack_3', 'hand_L', hitFrame('attack_3'))).toBe('gauntlet_L_open');
  });
});
