import { describe, expect, it } from 'vitest';
import {
  SAMPLE_BOSS_4X4,
  SAMPLE_PLAYER,
  characterDefinitionSchema,
  monsterDefinitionSchema,
  validateCharacterDefinition,
  validateCharacterSchema,
  validateMonsterDefinition,
  validateMonsterSchema,
  type CharacterDefinition,
  type MonsterDefinition,
} from '../src/index.js';

type Mut<T> = { -readonly [K in keyof T]: Mut<T[K]> };
const clone = <T>(x: T): Mut<T> => JSON.parse(JSON.stringify(x)) as Mut<T>;
const player = (patch: Record<string, unknown>) => ({ ...clone(SAMPLE_PLAYER), ...patch });
const boss = (patch: Record<string, unknown>) => ({ ...clone(SAMPLE_BOSS_4X4), ...patch });

describe('schemas', () => {
  it('are draft 2020-12 documents with ids', () => {
    for (const s of [characterDefinitionSchema, monsterDefinitionSchema]) {
      expect(s.$schema).toBe('https://json-schema.org/draft/2020-12/schema');
      expect(s.$id).toMatch(/\.schema\.json$/);
    }
  });
});

describe('sample Player', () => {
  it('passes schema and semantic validation, also after a JSON round-trip', () => {
    expect(validateCharacterDefinition(SAMPLE_PLAYER)).toEqual({ valid: true, errors: [] });
    expect(validateCharacterDefinition(clone(SAMPLE_PLAYER)).valid).toBe(true);
  });
  it('flags attack / cast / channel as drawn in 8, nothing else', () => {
    expect(SAMPLE_PLAYER.animations.filter((a) => a.drawnInEight).map((a) => a.id)).toEqual([
      'attack',
      'cast',
      'channel',
    ]);
  });
  it('rejects wrong canvas, hit volumes, rig overflow and missing animations', () => {
    expect(validateCharacterDefinition(player({ canvas: 192 })).errors.join()).toMatch(/canvas/);
    const bad = clone(SAMPLE_PLAYER);
    bad.collision.hurtboxRadius = 0.5;
    expect(validateCharacterDefinition(bad).errors.join()).toMatch(/hurtboxRadius/);
    expect(validateCharacterDefinition(player({ rig: { ...SAMPLE_PLAYER.rig, bones: 61 } })).errors.join()).toMatch(
      /bones 61 > 60/,
    );
    expect(
      validateCharacterDefinition(player({ animations: SAMPLE_PLAYER.animations.slice(1) })).errors.join(),
    ).toMatch(/missing animation 'idle'/);
  });
  it('rejects animation values that differ from the table', () => {
    const p = clone(SAMPLE_PLAYER);
    p.animations.find((a) => a.id === 'walk')!.fps = 15;
    expect(validateCharacterDefinition(p).errors.join()).toMatch(/animation 'walk'/);
  });
  it('npc and pet cannot draw in 8; pet has no paperdoll', () => {
    const npc = player({ kind: 'npc' });
    expect(validateCharacterDefinition(npc).errors.join()).toMatch(/cannot draw animations in 8/);
    const pet = {
      ...clone(SAMPLE_PLAYER),
      kind: 'pet',
      rig: { bones: 40, slots: 20, meshVertices: 300, physicsConstraints: 3 },
      animations: SAMPLE_PLAYER.animations.slice(0, 2).map((a) => ({ ...a, drawnInEight: false })),
    } as unknown as CharacterDefinition;
    expect(validateCharacterDefinition(pet).errors.join()).toMatch(/no paperdoll/);
    const { paperdoll: _p, ...petNoDoll } = pet;
    void _p;
    expect(validateCharacterDefinition(petNoDoll).valid).toBe(true);
  });
  it('fails the repack rule when an extra additive layer splits the batch', () => {
    const p = clone(SAMPLE_PLAYER);
    p.paperdoll!.attachments!.find((a) => a.slot === 'head')!.blend = 'additive';
    expect(validateCharacterDefinition(p).errors.join()).toMatch(/repack: .*draw calls/);
  });
  it('schema errors for unknown fields / values', () => {
    expect(validateCharacterSchema({ ...clone(SAMPLE_PLAYER), extra: 1 }).valid).toBe(false);
    expect(validateCharacterSchema(player({ kind: 'boss' })).valid).toBe(false);
    expect(validateCharacterSchema(player({ paperdoll: { equipped: ['nope'] } })).valid).toBe(false);
    expect(validateCharacterSchema(null).valid).toBe(false);
  });
});

describe('sample 4x4 Boss', () => {
  it('passes schema and semantic validation', () => {
    expect(validateMonsterDefinition(SAMPLE_BOSS_4X4)).toEqual({ valid: true, errors: [] });
    expect(validateMonsterDefinition(clone(SAMPLE_BOSS_4X4)).valid).toBe(true);
  });
  it('4x4 values: canvas 512, collider 1.7, hurtbox 1.9, pick box 240×340, HUD bar', () => {
    const b: MonsterDefinition = SAMPLE_BOSS_4X4;
    expect(b.canvas).toBe(512);
    expect(b.collision).toEqual({
      multiPart: false,
      colliderRadius: 1.7,
      hurtboxRadius: 1.9,
      pickBox: { width: 240, height: 340 },
    });
    expect(b.hpBar).toBe('hud');
    expect(b.phases?.map((p) => p.hpThreshold)).toEqual([0.6, 0.25]);
  });
  it('rejects a pre-render 4x4, wrong canvas, overhead bar, rig overflow, bad scale', () => {
    expect(validateMonsterDefinition(boss({ render: 'prerender3d' })).errors.join()).toMatch(/Spine/);
    expect(validateMonsterDefinition(boss({ canvas: 256 })).errors.join()).toMatch(/canvas/);
    expect(validateMonsterDefinition(boss({ hpBar: 'overhead' })).errors.join()).toMatch(/HUD/);
    expect(
      validateMonsterDefinition(boss({ rig: { ...SAMPLE_BOSS_4X4.rig, meshVertices: 1501 } })).errors.join(),
    ).toMatch(/meshVertices/);
    const v = clone(SAMPLE_BOSS_4X4);
    v.variants![0]!.scale = 1.5;
    expect(validateMonsterDefinition(v).valid).toBe(false);
  });
  it('rejects duplicate phase thresholds and out-of-range thresholds', () => {
    const p = clone(SAMPLE_BOSS_4X4);
    p.phases![1]!.hpThreshold = 0.6;
    expect(validateMonsterDefinition(p).errors.join()).toMatch(/duplicate phase hpThreshold/);
    p.phases![1]!.hpThreshold = 1.2;
    expect(validateMonsterSchema(p).valid).toBe(false);
  });
  it('8x8 boss needs pieced render, parts, 1–3 directions', () => {
    const pieced = {
      ...clone(SAMPLE_BOSS_4X4),
      footprint: '8x8',
      canvas: null,
      render: 'spine_pieced',
      directions: { scheme: 'parts_1_3', drawn: ['S'] },
      collision: { multiPart: true },
      animations: SAMPLE_BOSS_4X4.animations.map((a) => ({ ...a, drawnInEight: false })),
      rig: undefined,
      phases: undefined,
      variants: undefined,
      partBreak: undefined,
      parts: [
        { id: 'body', role: 'body', skeleton: 'body', anchorBone: null, colliderRadius: 3, hurtboxRadius: 3.2 },
        { id: 'head_1', role: 'head', skeleton: 'head', anchorBone: 'neck_1', colliderRadius: 1, hurtboxRadius: 1.2 },
      ],
    };
    expect(validateMonsterDefinition(pieced)).toEqual({ valid: true, errors: [] });
    expect(validateMonsterDefinition({ ...pieced, parts: undefined }).errors.join()).toMatch(/parts\[\]/);
    expect(
      validateMonsterDefinition({ ...pieced, directions: { scheme: 'parts_1_3', drawn: ['S', 'E', 'N', 'W'] } }).valid,
    ).toBe(false);
  });
  it('pre-render monsters break at most one part', () => {
    const mob = {
      schemaVersion: 1,
      id: 'khoi_loi',
      name: 'Khôi lỗi',
      kind: 'mob',
      footprint: '2x2',
      canvas: 256,
      render: 'prerender3d',
      directions: { scheme: 'five_mirror' },
      animations: [{ id: 'idle', loop: true, frames: 12, fps: 12, drawnInEight: false }],
      collision: { multiPart: false, colliderRadius: 0.8, hurtboxRadius: 0.95, pickBox: { width: 120, height: 180 } },
      hpBar: 'hud',
      partBreak: [{ slot: 'arm', maxHp: 100, skills: [], drops: [] }],
    };
    expect(validateMonsterDefinition(mob)).toEqual({ valid: true, errors: [] });
    const two = { ...mob, partBreak: [...mob.partBreak, { slot: 'leg', maxHp: 100, skills: [], drops: [] }] };
    expect(validateMonsterDefinition(two).errors.join()).toMatch(/at most 1 part/);
    expect(
      validateMonsterDefinition({ ...mob, animations: [{ ...mob.animations[0], drawnInEight: true }] }).errors.join(),
    ).toMatch(/cannot draw animations in 8/);
  });
});

describe('malformed collision does not throw', () => {
  it('character: { multiPart: false } alone is a schema error', () => {
    const r = validateCharacterDefinition(player({ collision: { multiPart: false } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/pickBox|colliderRadius|hurtboxRadius/);
  });
  it('monster: { multiPart: false } alone is a schema error', () => {
    const r = validateMonsterDefinition(boss({ collision: { multiPart: false } }));
    expect(r.valid).toBe(false);
    expect(r.errors.join()).toMatch(/pickBox|colliderRadius|hurtboxRadius/);
  });
  it('multiPart: true must not carry single-volume fields', () => {
    const mp = { multiPart: true, colliderRadius: 1 };
    expect(validateMonsterSchema(boss({ collision: mp })).valid).toBe(false);
    expect(validateMonsterSchema(boss({ collision: { multiPart: true } })).valid).toBe(true);
  });
});

describe('hpBar placement', () => {
  it('1x1 / elite monsters need an overhead bar', () => {
    const mob = {
      schemaVersion: 1,
      id: 'yeu_lang',
      name: 'Yêu lang',
      kind: 'mob',
      footprint: '1x1',
      canvas: 128,
      render: 'prerender3d',
      directions: { scheme: 'five_mirror' },
      animations: [{ id: 'idle', loop: true, frames: 12, fps: 12, drawnInEight: false }],
      collision: { multiPart: false, colliderRadius: 0.35, hurtboxRadius: 0.45, pickBox: { width: 48, height: 100 } },
      hpBar: 'overhead',
    };
    expect(validateMonsterDefinition(mob)).toEqual({ valid: true, errors: [] });
    expect(validateMonsterDefinition({ ...mob, hpBar: 'hud' }).errors.join()).toMatch(/overhead/);
  });
});
