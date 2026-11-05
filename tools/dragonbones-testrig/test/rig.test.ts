import { describe, expect, it } from 'vitest';
import { ANIMATIONS, SPINE_SLOT_IDS, animationDuration, slotForm, slotsInDrawOrder } from '@vgtd/character';
import { BUDGETS, DIRECTIONS, DRAWN_DIRECTIONS } from '@vgtd/shared';
import { ATLAS_SETTINGS, DRAGONBONES_VERSION, SKINS, generateAllRigs, generateRig } from '../src/index.js';

describe('DragonBones test rig', () => {
  const rig = generateRig('S');
  const ske = JSON.parse(rig.ske);
  const arm = ske.armature[0];
  const tex = JSON.parse(rig.tex);

  it('writes DragonBones 5.5 data with one armature and the 13 slots in the direction draw order', () => {
    expect(ske.version).toBe(DRAGONBONES_VERSION);
    expect(ske.compatibleVersion).toBe(DRAGONBONES_VERSION);
    expect(Number(ske.version)).toBeLessThanOrEqual(5.6); // Cocos 3.8.8 runtime reads <= 5.6.x
    expect(ske.armature).toHaveLength(1);
    expect(arm.type).toBe('Armature');
    const order = slotsInDrawOrder('S').filter((s) => slotForm(s) === 'spine');
    expect(arm.slot.map((s: { name: string }) => s.name)).toEqual(order);
    expect(new Set(arm.slot.map((s: { name: string }) => s.name))).toEqual(new Set(SPINE_SLOT_IDS));
  });

  it('has per-direction slot order (N differs from S)', () => {
    const names = (d: 'S' | 'N') =>
      JSON.parse(generateRig(d).ske).armature[0].slot.map((s: { name: string }) => s.name);
    expect(names('N')).not.toEqual(names('S'));
  });

  it('is y-down / clockwise: the hip sits below the root at positive y, a CCW setup rotation is negative', () => {
    const hip = arm.bone.find((b: { name: string }) => b.name === 'hip');
    expect(hip.transform.y).toBe(-22); // neutral y-up 22 -> y-down -22 (DragonBones y grows downward)
    const sword = arm.bone.find((b: { name: string }) => b.name === 'sword');
    expect(sword.transform.skX).toBe(-35);
    expect(arm.aabb.y).toBe(-108);
  });

  it('has all 13 animations with durations from the table (30 fps frames) and loops per table', () => {
    expect(arm.animation.map((a: { name: string }) => a.name).sort()).toEqual(ANIMATIONS.map((a) => a.id).sort());
    for (const spec of ANIMATIONS) {
      const a = arm.animation.find((x: { name: string }) => x.name === spec.id);
      expect(a.duration).toBe(Math.max(2, Math.round(animationDuration(spec.id) * 30)));
      expect(a.playTimes).toBe(spec.loop ? 0 : 1);
      for (const b of a.bone as { translateFrame?: { duration: number }[]; rotateFrame?: { duration: number }[] }[]) {
        for (const track of [b.translateFrame, b.rotateFrame]) {
          if (track) expect(track.reduce((n, f) => n + f.duration, 0)).toBe(a.duration);
        }
      }
    }
  });

  it('loops are seamless: pose at frame 0 equals the pose a loop would restart with', () => {
    const idle = arm.animation.find((x: { name: string }) => x.name === 'idle');
    const hip = idle.bone.find((b: { name: string }) => b.name === 'hip');
    const first = hip.translateFrame[0];
    const last = hip.translateFrame[hip.translateFrame.length - 1];
    // last key is one step before the wrap: closer to the first key than to the extreme
    expect(Math.abs(last.y - first.y)).toBeLessThan(0.7);
  });

  it('puts the spec events on the animations that own them (event frames sum to the duration)', () => {
    const run = arm.animation.find((x: { name: string }) => x.name === 'run');
    const names = run.frame.flatMap((f: { events?: { name: string }[] }) => (f.events ?? []).map((e) => e.name));
    expect(names).toEqual(['footstep_L', 'footstep_R']);
    for (const spec of ANIMATIONS) {
      const a = arm.animation.find((x: { name: string }) => x.name === spec.id);
      if (a.frame) expect(a.frame.reduce((n: number, f: { duration: number }) => n + f.duration, 0)).toBe(a.duration);
    }
    expect(arm.animation.find((x: { name: string }) => x.name === 'idle').frame).toBeUndefined();
  });

  it('atlas follows the export settings: pow2, <= max size, padding, no overlaps; tex.json matches', () => {
    const size = rig.atlasInfo.page.width;
    expect(size & (size - 1)).toBe(0);
    expect(size).toBeLessThanOrEqual(ATLAS_SETTINGS.maxSize);
    expect(ATLAS_SETTINGS.maxSize).toBe(BUDGETS.ATLAS_MAX_WEB_MOBILE);
    expect(ATLAS_SETTINGS.padding).toBe(BUDGETS.ATLAS_PADDING_PX);
    expect(tex.width).toBe(size);
    expect(tex.imagePath).toBe('rig_S_tex.png');
    const rs = rig.atlasInfo.regions;
    for (const r of rs) {
      expect(r.x).toBeGreaterThanOrEqual(2);
      expect(r.y).toBeGreaterThanOrEqual(2);
      expect(r.x + r.w + 2).toBeLessThanOrEqual(size);
      expect(r.y + r.h + 2).toBeLessThanOrEqual(size);
    }
    for (const a of rs) {
      for (const b of rs) {
        if (a === b) continue;
        const sep = a.x + a.w + 2 <= b.x || b.x + b.w + 2 <= a.x || a.y + a.h + 2 <= b.y || b.y + b.h + 2 <= a.y;
        expect(sep).toBe(true);
      }
    }
    expect(tex.SubTexture).toHaveLength(rs.length);
  });

  it('every display exists in the atlas; skin variants are extra displays of the same slot', () => {
    const names = new Set(tex.SubTexture.map((t: { name: string }) => t.name));
    for (const slot of arm.skin[0].slot as { name: string; display: { name: string }[] }[]) {
      for (const d of slot.display) expect(names.has(d.name)).toBe(true);
    }
    const upper = arm.skin[0].slot.find((s: { name: string }) => s.name === 'outfit_upper');
    expect(upper.display).toHaveLength(SKINS.length);
    expect(arm.skin[0].slot.find((s: { name: string }) => s.name === 'head').display).toHaveLength(1);
  });

  it('PNG is valid (signature, IHDR size = atlas size) and premultiplied (rgb <= alpha)', () => {
    expect(Array.from(rig.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(rig.png.buffer, rig.png.byteOffset);
    expect(dv.getUint32(16)).toBe(rig.atlasInfo.page.width);
    const d = rig.atlasInfo.page.data;
    for (let i = 0; i < d.length; i += 4) expect(Math.max(d[i]!, d[i + 1]!, d[i + 2]!)).toBeLessThanOrEqual(d[i + 3]!);
  });

  it('is deterministic and covers 8 directions (5 drawn + 3 for drawn-in-8)', () => {
    expect(generateRig('E').ske).toBe(generateRig('E').ske);
    expect(Buffer.from(generateRig('E').png).equals(Buffer.from(generateRig('E').png))).toBe(true);
    const all = generateAllRigs();
    expect(all.map((r) => r.direction)).toEqual([...DIRECTIONS]);
    expect(DRAWN_DIRECTIONS.every((d) => all.some((r) => r.direction === d))).toBe(true);
  });

  it('neutral rig stays y-up (format-neutral source of truth)', () => {
    const hip = rig.neutral.bones.find((b) => b.name === 'hip')!;
    expect(hip.y).toBe(22);
  });
});
