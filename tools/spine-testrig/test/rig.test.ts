import { describe, expect, it } from 'vitest';
import { ANIMATIONS, SPINE_SLOT_IDS, animationDuration, slotsInDrawOrder, slotForm } from '@vgtd/character';
import { BUDGETS, DIRECTIONS, DRAWN_DIRECTIONS } from '@vgtd/shared';
import { ATLAS_SETTINGS, SKINS, generateAllRigs, generateRig } from '../src/index.js';

describe('spine test rig', () => {
  const rig = generateRig('S');
  const json = JSON.parse(rig.json);

  it('writes a Spine 4.2 skeleton with the 13 spine slots in the direction draw order', () => {
    expect(json.skeleton.spine).toMatch(/^4\.2\./);
    const order = slotsInDrawOrder('S').filter((s) => slotForm(s) === 'spine');
    expect(json.slots.map((s: { name: string }) => s.name)).toEqual(order);
    expect(new Set(json.slots.map((s: { name: string }) => s.name))).toEqual(new Set(SPINE_SLOT_IDS));
    expect(json.slots).toHaveLength(13);
  });

  it('has per-direction slot order (N differs from S)', () => {
    const names = (d: 'S' | 'N') => JSON.parse(generateRig(d).json).slots.map((s: { name: string }) => s.name);
    expect(names('N')).not.toEqual(names('S'));
  });

  it('has all 13 animations with durations from the table and keyed at 30 fps', () => {
    expect(Object.keys(json.animations).sort()).toEqual(ANIMATIONS.map((a) => a.id).sort());
    for (const a of ANIMATIONS) {
      const anim = json.animations[a.id];
      const times: number[] = Object.values<{ rotate?: { time: number }[]; translate?: { time: number }[] }>(
        anim.bones,
      ).flatMap((b) => [...(b.rotate ?? []).map((k) => k.time), ...(b.translate ?? []).map((k) => k.time)]);
      expect(Math.max(...times)).toBeCloseTo(animationDuration(a.id), 2);
    }
  });

  it('loops are periodic: first and last key of every timeline match', () => {
    for (const a of ANIMATIONS.filter((x) => x.loop)) {
      for (const b of Object.values<{ rotate?: { value: number }[] }>(json.animations[a.id].bones)) {
        const r = b.rotate;
        if (r) expect(r[r.length - 1]!.value).toBeCloseTo(r[0]!.value, 2);
      }
    }
  });

  it('puts the spec events on the animations that own them', () => {
    expect(json.animations.run.events.map((e: { name: string }) => e.name)).toEqual(['footstep_L', 'footstep_R']);
    expect(json.animations.attack.events.map((e: { name: string }) => e.name)).toContain('hit');
    expect(json.animations.idle.events).toBeUndefined();
  });

  it('atlas follows the export settings: pow2, <= max size, padding, PMA, no overlaps', () => {
    const size = rig.atlasInfo.page.width;
    expect(size & (size - 1)).toBe(0);
    expect(size).toBeLessThanOrEqual(ATLAS_SETTINGS.maxSize);
    expect(ATLAS_SETTINGS.maxSize).toBe(BUDGETS.ATLAS_MAX_WEB_MOBILE);
    expect(ATLAS_SETTINGS.padding).toBe(BUDGETS.ATLAS_PADDING_PX);
    expect(rig.atlas).toContain('pma:true');
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
  });

  it('every region used by a skin exists in the atlas; every skin overrides outfit_upper', () => {
    const names = new Set(rig.atlasInfo.regions.map((r) => r.name));
    expect(json.skins.map((s: { name: string }) => s.name)).toEqual([...SKINS]);
    for (const skin of json.skins) {
      for (const atts of Object.values<Record<string, { path: string }>>(skin.attachments)) {
        for (const att of Object.values(atts)) expect(names.has(att.path)).toBe(true);
      }
      expect(skin.attachments.outfit_upper).toBeDefined();
    }
  });

  it('PNG is valid (signature, IHDR size = atlas size) and premultiplied (rgb <= alpha)', () => {
    expect(Array.from(rig.png.subarray(0, 8))).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
    const dv = new DataView(rig.png.buffer, rig.png.byteOffset);
    expect(dv.getUint32(16)).toBe(rig.atlasInfo.page.width);
    const d = rig.atlasInfo.page.data;
    for (let i = 0; i < d.length; i += 4) expect(Math.max(d[i]!, d[i + 1]!, d[i + 2]!)).toBeLessThanOrEqual(d[i + 3]!);
  });

  it('is deterministic and covers 8 directions (5 drawn + 3 for drawn-in-8)', () => {
    expect(generateRig('E').json).toBe(generateRig('E').json);
    expect(Buffer.from(generateRig('E').png).equals(Buffer.from(generateRig('E').png))).toBe(true);
    const all = generateAllRigs();
    expect(all.map((r) => r.direction)).toEqual([...DIRECTIONS]);
    expect(DRAWN_DIRECTIONS.every((d) => all.some((r) => r.direction === d))).toBe(true);
  });
});
