import { describe, expect, it, vi } from 'vitest';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { QUALITY_TIERS } from '@vgtd/shared';
import {
  SPINE_KEY_FPS,
  VISUAL_TIERS,
  SpriteLayerCache,
  composeSpriteLayers,
  namespaceSpriteLayerAtlas,
  resolveEquipmentVisuals,
  spriteLayerMotionSignature,
  validateEquipmentVisualMapping,
  validateSpriteLayerSet,
  type EquipmentVisualMapping,
  type SpriteLayerRole,
  type SpriteLayerSet,
} from '../src/index.js';

function layer(role: SpriteLayerRole, id: string = role): SpriteLayerSet {
  return {
    format: 'vgtd-sprite-layer-set',
    version: 1,
    id,
    role,
    direction: 'E',
    motionId: 'class-t1-v2',
    frameRate: SPINE_KEY_FPS,
    canvas: { width: 128, height: 128, pivotX: 64, pivotY: 116 },
    textures: [`${id}_tex`],
    displays: [0, 1].map((i) => ({
      name: `frame_${i}`,
      region: `frame_${i}`,
      x: i,
      y: -20,
      width: 32,
      height: 40,
      textureWidth: 64,
      textureHeight: 80,
    })),
    clips: [
      {
        name: 'attack',
        duration: 18,
        loop: false,
        frames: [
          { at: 0, display: 'frame_0', ...(role === 'weapon' ? { order: 'back' as const } : {}) },
          { at: 9, display: 'frame_1', ...(role === 'weapon' ? { order: 'front' as const } : {}) },
        ],
        events: [
          { at: 9, name: 'hit' },
          { at: 13, name: 'cancel_window' },
        ],
      },
    ],
  };
}
function mapping(): EquipmentVisualMapping {
  return {
    format: 'vgtd-equipment-visuals',
    version: 1,
    tiers: Object.fromEntries(
      VISUAL_TIERS.map((tier) => [
        tier,
        { body: `${tier}-body`, weapon: `${tier}-weapon`, fx: `${tier}-fx`, aura: `${tier}-aura` },
      ]),
    ) as EquipmentVisualMapping['tiers'],
    costumes: { ceremonial: { body: 'costume-body' } },
    weaponSkins: { jade: { weapon: 'skin-weapon' } },
    qualityGlow: Object.fromEntries(
      QUALITY_TIERS.map((q) => [q.id, [q.index / QUALITY_TIERS.length, 0.5, 1, 1]]),
    ) as unknown as EquipmentVisualMapping['qualityGlow'],
  };
}

describe('D45 equipment appearance', () => {
  it('swaps body and weapon independently and hides only the costume', () => {
    const map = mapping();
    const appearance = { tier: 'T3' as const, quality: 'gold' as const, costume: 'ceremonial', weaponSkin: 'jade' };
    const visible = resolveEquipmentVisuals(map, appearance),
      hidden = resolveEquipmentVisuals(map, { ...appearance, hideCostume: true });
    expect(visible.bodySet).toBe('costume-body');
    expect(hidden.bodySet).toBe('T3-body');
    expect(visible.weaponSet).toBe('skin-weapon');
    expect(hidden.weaponSet).toBe('skin-weapon');
    expect(hidden.fxSet).toBe('T3-fx');
    expect(hidden.aura).toBe('T3-aura');
    expect(hidden.glowTint).toEqual(map.qualityGlow.gold);
    for (const q of QUALITY_TIERS)
      expect(resolveEquipmentVisuals(map, { tier: 'T3', quality: q.id }).glowTint).toEqual(map.qualityGlow[q.id]);
  });
  it('rejects incomplete quality mappings, unsafe ids and unknown cosmetics', () => {
    const map = mapping();
    expect(() =>
      validateEquipmentVisualMapping({ ...map, qualityGlow: {} as EquipmentVisualMapping['qualityGlow'] }),
    ).toThrow(/glow tint/);
    expect(() => resolveEquipmentVisuals(map, { tier: 'T1', quality: 'white', costume: 'toString' })).toThrow(
      /unknown costume/,
    );
    expect(() => resolveEquipmentVisuals(map, { tier: 'T1', quality: 'white', weaponSkin: '../skin' })).toThrow(
      /unknown weapon skin/,
    );
    expect(() => validateEquipmentVisualMapping({ ...map, costumes: { bad: { body: '../bad' } } })).toThrow(
      /invalid visual set/,
    );
  });
});

describe('layered sprite composer', () => {
  const runtimePath = join(
    dirname(process.env.COCOS_CREATOR_PATH ?? 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe'),
    'resources/resources/3d/engine/node_modules/@cocos/dragonbones-js/out/dragonBones.js',
  );
  const engineTest = existsSync(runtimePath) ? it : it.skip;
  engineTest('parses one armature, slots and z-order through the real Cocos 3.8.8 DragonBones parser', async () => {
    const runtime = (await import(pathToFileURL(runtimePath).href)) as {
      ObjectDataParser: new () => {
        parseDragonBonesData(data: unknown): {
          getArmature(name: string): {
            sortedSlots: { name: string }[];
            getAnimation(name: string): { duration: number; zOrderTimeline: unknown };
          };
        };
      };
    };
    const data = new runtime.ObjectDataParser().parseDragonBonesData(
      composeSpriteLayers({ name: 'engine_check', body: layer('body'), weapon: layer('weapon'), fx: layer('fx') })
        .skeleton,
    );
    const armature = data.getArmature('engine_check');
    expect(armature.sortedSlots.map((s) => s.name)).toEqual(['fx', 'body', 'weapon']);
    expect(armature.getAnimation('attack').duration).toBeCloseTo(18 / SPINE_KEY_FPS);
    expect(armature.getAnimation('attack').zOrderTimeline).toBeTruthy();
  });
  it('emits one armature with independent display swaps, front/back changes and one event timeline', () => {
    const body = layer('body'),
      weapon = layer('weapon');
    const before = JSON.stringify([body, weapon]);
    const out = composeSpriteLayers({ name: 'composed', body, weapon });
    expect(out.skeleton.armature).toHaveLength(1);
    const arm = out.skeleton.armature[0]!;
    expect(arm.slot.map((s) => s.name)).toEqual(['body', 'weapon']);
    expect(arm.animation[0]!.slot.map((s) => s.displayFrame.map((f) => f.value))).toEqual([
      [0, 1],
      [0, 1],
    ]);
    expect(arm.animation[0]!.zOrder.frame).toEqual([
      { duration: 9, zOrder: [0, 1] },
      { duration: 9, zOrder: [] },
    ]);
    expect(arm.animation[0]!.frame!.flatMap((f) => f.events ?? []).map((e) => e.name)).toEqual([
      'hit',
      'cancel_window',
    ]);
    expect(arm.animation[0]!.frame!.reduce((sum, f) => sum + f.duration, 0)).toBe(18);
    expect(arm.skin[0]!.slot[0]!.display[0]!.path).toBe('body_body__frame_0');
    expect(arm.skin[0]!.slot[0]!.display[0]!.transform.scX).toBe(0.5);
    expect(JSON.stringify([body, weapon])).toBe(before);
  });
  it('tints only the FX slot, namespaces atlas pages and keeps z-order correct with FX present', () => {
    const out = composeSpriteLayers({
      name: 'fx_test',
      body: layer('body'),
      weapon: layer('weapon'),
      fx: layer('fx'),
      glowTint: [0.2, 0.4, 0.6, 0.8],
    });
    expect(out.skeleton.armature[0]!.slot[0]).toMatchObject({
      name: 'fx',
      blendMode: 'add',
      color: { rM: 20, gM: 40, bM: 60, aM: 80 },
    });
    expect(out.skeleton.armature[0]!.slot[1]!.color).toBeUndefined();
    expect(out.skeleton.armature[0]!.animation[0]!.zOrder.frame[0]!.zOrder).toEqual([1, 1]);
    const atlas = { name: 'page0', SubTexture: [{ name: 'frame_0', x: 4 }] };
    const namespaced = namespaceSpriteLayerAtlas(atlas, layer('weapon'));
    expect(namespaced.SubTexture[0]).toEqual({ name: 'weapon_weapon__frame_0', x: 4 });
    expect(atlas.SubTexture[0]!.name).toBe('frame_0');
  });
  it('rejects incompatible motions, missing frame order and invalid displays', () => {
    const body = layer('body'),
      weapon = layer('weapon');
    for (const patch of [
      { direction: 'S' as const },
      { motionId: 'other-motion' },
      { canvas: { ...weapon.canvas, pivotX: 65 } },
    ])
      expect(() => composeSpriteLayers({ name: 'bad', body, weapon: { ...weapon, ...patch } })).toThrow(/incompatible/);
    expect(() =>
      validateSpriteLayerSet({
        ...weapon,
        clips: weapon.clips.map((c) => ({ ...c, frames: c.frames.map((f) => ({ ...f, order: undefined })) })),
      }),
    ).toThrow(/order/);
    expect(() =>
      validateSpriteLayerSet({
        ...body,
        clips: body.clips.map((c) => ({ ...c, frames: [{ at: 0, display: 'missing' }] })),
      }),
    ).toThrow(/display/);
    expect(() =>
      composeSpriteLayers({
        name: 'bad',
        body,
        weapon: { ...weapon, clips: weapon.clips.map((c) => ({ ...c, events: [] })) },
      }),
    ).toThrow(/incompatible/);
  });
  it('compares semantic canvas/event values independently of JSON key order', () => {
    const a = layer('body'),
      b = {
        ...a,
        canvas: { pivotY: 116, pivotX: 64, height: 128, width: 128 },
        clips: a.clips.map((c) => ({ ...c, events: c.events.map((e) => ({ name: e.name, at: e.at })) })),
      };
    expect(spriteLayerMotionSignature(a)).toBe(spriteLayerMotionSignature(b));
  });
});

describe('lazy layer cache', () => {
  it('loads only selected pairs, deduplicates concurrent requests and retries failures', async () => {
    const load = vi.fn(async (id: string) => layer('body', id));
    const cache = new SpriteLayerCache(load);
    expect(load).not.toHaveBeenCalled();
    const a = cache.get('chosen', 'E'),
      b = cache.get('chosen', 'E');
    expect(a).toBe(b);
    await a;
    expect(load).toHaveBeenCalledTimes(1);
    expect(cache.size).toBe(1);
    cache.evict('chosen');
    await cache.get('chosen', 'E');
    expect(load).toHaveBeenCalledTimes(2);
    const failed = vi.fn().mockRejectedValueOnce(new Error('temporary')).mockResolvedValue(layer('body', 'retry'));
    const retry = new SpriteLayerCache(failed);
    await expect(retry.get('retry', 'E')).rejects.toThrow('temporary');
    await expect(retry.get('retry', 'E')).resolves.toMatchObject({ id: 'retry' });
    expect(failed).toHaveBeenCalledTimes(2);
  });
  it('does not repopulate cleared caches when a pending load completes', async () => {
    let finish!: (set: SpriteLayerSet) => void;
    const cache = new SpriteLayerCache(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    );
    const pending = cache.get('body', 'E');
    await Promise.resolve();
    cache.clear();
    finish(layer('body'));
    await pending;
    expect(cache.size).toBe(0);
  });
});
