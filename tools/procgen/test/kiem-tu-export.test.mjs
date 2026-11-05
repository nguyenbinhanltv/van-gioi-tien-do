import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { validateRigSet, KIEMTU_REQUIRED_ROLES, exportDragonBones, runQa } from '@vgtd/rig';
const { decodePNG } = createRequire(import.meta.url)('../src/lib/png.js');
import { alphaBounds } from '../scripts/kiem_tu_rig.mjs';

const root = new URL('../../../', import.meta.url);
const json = (path) => JSON.parse(readFileSync(new URL(path, root), 'utf8'));
const set = json('tools/rig/data/kiem-tu.rig.json');
const idle = json('tools/rig/data/kiem-tu.idle.json');
const assets = json('tools/rig/data/kiem-tu.assets.json');
const png = (path) => decodePNG(readFileSync(new URL(path, root)));

describe('Committed Kiếm tu art data through the public rig toolkit', () => {
  it('validates the full RigSet and animation roles against the canonical schema', () => {
    expect(validateRigSet(set, { requireRoles: KIEMTU_REQUIRED_ROLES })).toEqual([]);
    for (const rig of Object.values(set.rigs)) {
      expect(rig.ik.map((constraint) => constraint.name)).toEqual(
        expect.arrayContaining(['ik_leg_L', 'ik_leg_R']),
      );
    }
  });

  it('passes canonical idle QA against every committed direction', () => {
    for (const [direction, rig] of Object.entries(set.rigs)) {
      // This authored idle translates the chest for breathing; retain default root/IK translation exemptions.
      const translatable = Object.entries(rig.roles)
        .filter(([role]) => role === 'root' || role === 'hips' || role.startsWith('ik_'))
        .map(([, bone]) => bone);
      const report = runQa(rig, idle, { translatable: [...translatable, rig.roles.spine_upper] });
      expect(report.issues.filter((issue) => issue.severity === 'error'), direction).toEqual([]);
    }
  });

  it('matches manifest paths and atlas regions to the actual committed PNGs', () => {
    expect(assets.rig).toBe('tools/rig/data/kiem-tu.rig.json');
    expect(assets.idle).toBe('tools/rig/data/kiem-tu.idle.json');
    expect(Object.keys(assets.directions).sort()).toEqual(Object.keys(set.rigs).sort());
    for (const [direction, entry] of Object.entries(assets.directions)) {
      const atlas = json(entry.atlas);
      expect(new URL(atlas.imagePath, new URL(entry.atlas, root)).href).toBe(new URL(entry.texture, root).href);
      const image = png(entry.texture);
      expect([image.width, image.height]).toEqual([atlas.width, atlas.height]);
      expect(new Set(atlas.regions.map((region) => region.name)).size).toBe(atlas.regions.length);
      for (const region of atlas.regions) {
        for (const value of [region.x, region.y, region.width, region.height]) expect(Number.isInteger(value)).toBe(true);
        expect(region.x).toBeGreaterThanOrEqual(0);
        expect(region.y).toBeGreaterThanOrEqual(0);
        expect(region.width).toBeGreaterThan(0);
        expect(region.height).toBeGreaterThan(0);
        expect(region.x + region.width).toBeLessThanOrEqual(image.width);
        expect(region.y + region.height).toBeLessThanOrEqual(image.height);
        if (region.name === 'kiemtu_page') {
          expect(region).toMatchObject({ x: 0, y: 0, width: image.width, height: image.height });
          continue;
        }
        const canonical = region.name.startsWith('slot_');
        const source = png(`assets-src/placeholder/kiem-tu-rig-v1/${canonical ? 'parts' : 'pieces'}/${direction}/${canonical ? region.name.slice(5) : region.name}.png`);
        const box = alphaBounds(source);
        expect([region.width, region.height], `${direction}/${region.name}`).toEqual([box.w, box.h]);
        const expected = Buffer.alloc(box.w * box.h * 4);
        const actual = Buffer.alloc(expected.length);
        for (let y = 0; y < box.h; y++) for (let x = 0; x < box.w; x++) {
          const src = ((box.y + y) * source.width + box.x + x) * 4;
          const dst = ((region.y + y) * image.width + region.x + x) * 4;
          const offset = (y * box.w + x) * 4;
          const alpha = source.data[src + 3];
          expected[offset + 3] = alpha;
          for (let c = 0; c < 3; c++) expected[offset + c] = Math.round(source.data[src + c] * alpha / 255);
          for (let c = 0; c < 4; c++) actual[offset + c] = image.data[dst + c];
        }
        expect(actual.equals(expected), `${direction}/${region.name} PMA pixels`).toBe(true);
      }
    }
  });

  it('exports every real atlas, weighted skin, fallback skin and idle without writing runtime output', () => {
    for (const [direction, rig] of Object.entries(set.rigs)) {
      const atlas = json(assets.directions[direction].atlas);
      const result = exportDragonBones([{ rig, clips: [idle] }], atlas, { name: rig.id });
      const armature = result.ske.armature[0];
      expect(result.ske.version).toBe('5.5');
      expect(result.tex.premultipliedAlpha).toBe(true);
      expect(result.tex.width).toBe(512);
      expect(armature.bone).toHaveLength(rig.bones.length);
      expect(armature.slot).toHaveLength(rig.slots.length);
      expect(armature.ik).toHaveLength(4);
      // DragonBones encodes its default skin with the empty name.
      expect(armature.skin.map((skin) => skin.name)).toEqual(['', 'bones-only']);
      const displays = armature.skin[0].slot.flatMap((slot) => slot.display).filter(Boolean);
      expect(displays.length).toBeGreaterThan(0);
      expect(displays.every((display) => display.type === 'mesh' && display.weights.length > 0)).toBe(true);
      expect(armature.animation[0]).toMatchObject({ name: 'idle', duration: 60, playTimes: 0 });
    }
  });
});
