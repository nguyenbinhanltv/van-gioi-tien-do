import { describe, expect, it } from 'vitest';
import { DIRECTIONS } from '@vgtd/shared';
import {
  DEFAULT_BOSS_ASYMMETRIC_ANIMATIONS,
  DEFAULT_PLAYER_ASYMMETRIC_ANIMATIONS,
  EVENT_FRAME_INDEX_BASE,
  SAMPLE_BOSS_4X4,
  SPINE_SLOT_IDS,
  getAnimationTable,
  getCharacterViewState,
  isInFrontOfBoss,
  socketLocalPosition,
  validateMonsterDefinition,
  type AnimationId,
  type SlotId,
} from '../src/index.js';

const outfit: SlotId[] = ['cape', 'hair_back', 'outfit_upper', 'outfit_lower', 'head', 'arm_L', 'arm_R', 'weapon_R'];
const view = (direction: (typeof DIRECTIONS)[number], animation: AnimationId = 'idle', extra = {}) =>
  getCharacterViewState({ kind: 'player', direction, equipped: outfit, animation, ...extra });

describe('getCharacterViewState', () => {
  it('slot order per direction is the Draw Order preset of the real direction (13 Spine slots)', () => {
    const w = view('W');
    expect(w.slotOrder).toHaveLength(13);
    expect(w.slotOrder.indexOf('weapon_R')).toBeLessThan(w.slotOrder.indexOf('body')); // behind the body at W
    const e = view('E');
    expect(e.slotOrder.indexOf('weapon_R')).toBeGreaterThan(e.slotOrder.indexOf('body'));
    for (const d of DIRECTIONS) {
      const v = view(d);
      expect([...v.slotOrder].sort()).toEqual([...SPINE_SLOT_IDS].sort());
      expect(v.orbit).toEqual({ back: 1, front: 15 });
    }
  });

  it('mirror flag: SW/W/NW play SE/E/NE with scaleX −1 and negated socket x; flipped weapon variant', () => {
    const v = view('W');
    expect(v).toMatchObject({ skeletonDirection: 'E', mirrored: true, scaleX: -1 });
    expect(v.sockets.hand_R).toEqual({ x: 18, y: 52 });
    expect(v.visibleSlots.find((s) => s.slot === 'weapon_R')!.variants).toContain('mirrored');
    const s = view('SE');
    expect(s).toMatchObject({ skeletonDirection: 'SE', mirrored: false, scaleX: 1 });
    expect(s.sockets.hand_R).toEqual({ x: -18, y: 52 }); // y up, never flipped
  });

  it('asymmetric animations (F-01 / ADR-020 default) play the true direction without mirroring', () => {
    expect(view('W', 'attack')).toMatchObject({ skeletonDirection: 'W', mirrored: false, scaleX: 1 });
    expect(view('W', 'attack', { drawnInEight: false }).mirrored).toBe(true);
    // non-Player kinds never default to 8
    expect(getCharacterViewState({ kind: 'npc', direction: 'W', equipped: outfit, animation: 'attack' }).mirrored).toBe(
      true,
    );
  });

  it('animation entry carries fps, loop, events and the playback rate', () => {
    const run = view('S', 'run', { profile: 'pc' });
    expect(run.animation).toMatchObject({
      id: 'run',
      loop: true,
      frames: 10,
      fps: 20,
      durationSec: 0.5,
      playbackFps: 60,
    });
    expect(run.animation.events.map((e) => e.name)).toEqual(['footstep_L', 'footstep_R']);
    expect(EVENT_FRAME_INDEX_BASE).toBe(0);
    const table = getAnimationTable();
    expect(table).toHaveLength(13);
    expect(table.every((a) => a.playbackFps === 30)).toBe(true);
  });

  it('head_top and overhead anchors follow hat / mount / flight; mount_seat only with an override', () => {
    const v = getCharacterViewState({
      kind: 'player',
      direction: 'S',
      equipped: [],
      animation: 'idle',
      headTop: { tallHat: true },
      socketsOverride: { mount_seat: { x: 0, y: 40 } },
    });
    expect(v.headTop).toBe(112);
    expect(v.sockets.head_top).toEqual({ x: 0, y: 112 });
    expect(v.overhead.hp_bar).toEqual({ x: 0, y: 118 });
    expect(v.sockets.mount_seat).toEqual({ x: 0, y: 40 });
    const plain = getCharacterViewState({ kind: 'player', direction: 'S', equipped: [], animation: 'idle' });
    expect(plain.sockets.mount_seat).toBeNull();
  });

  it('conflicts are reported', () => {
    const v = getCharacterViewState({
      kind: 'player',
      direction: 'S',
      equipped: ['wing', 'sword_back'],
      animation: 'idle',
      paperdoll: { mounted: true, swordInHand: true },
    });
    expect(v.hidden.map((h) => h.slot).sort()).toEqual(['sword_back', 'wing']);
    expect(v.visibleSlots.map((s) => s.slot)).toEqual(['body']);
  });
});

describe('configurable open rows (docs/31)', () => {
  it('F-01 defaults: Player attack/cast/channel, Boss none', () => {
    expect(DEFAULT_PLAYER_ASYMMETRIC_ANIMATIONS).toEqual(['attack', 'cast', 'channel']);
    expect(DEFAULT_BOSS_ASYMMETRIC_ANIMATIONS).toEqual([]);
    expect(SAMPLE_BOSS_4X4.animations.some((a) => a.drawnInEight)).toBe(false);
  });
  it('F-02: socket axis defaults to y up, switchable', () => {
    expect(socketLocalPosition('hand_R')).toEqual({ x: -18, y: 52 });
    expect(socketLocalPosition('hand_R', false, undefined, 'y_down')).toEqual({ x: -18, y: -52 });
  });
  it('F-04: V rule default below-draws-after, literal reading selectable', () => {
    const fp = { i0: 10, j0: 10, n: 4 };
    expect(isInFrontOfBoss(14.2, 11, fp)).toBe(true);
    expect(isInFrontOfBoss(14.2, 11, fp, { vRule: 'below_draws_before' })).toBe(false);
  });
  it('F-05: non-boss Spine monsters use Linh thu rig limits by default; uncapped on request', () => {
    const snake = {
      ...JSON.parse(JSON.stringify(SAMPLE_BOSS_4X4)),
      id: 'xa_yeu',
      kind: 'mob',
      footprint: '2x2',
      canvas: 256,
      collision: { multiPart: false, colliderRadius: 0.8, hurtboxRadius: 0.95, pickBox: { width: 120, height: 180 } },
      rig: { bones: 70, slots: 30, meshVertices: 300, physicsConstraints: 2 },
      phases: undefined,
      variants: undefined,
      partBreak: undefined,
    };
    expect(validateMonsterDefinition(snake).errors.join()).toMatch(/bones 70 > 50/);
    expect(validateMonsterDefinition(snake, { nonBossSpineRig: null }).valid).toBe(true);
  });
});

describe('pieced 8x8 boss', () => {
  const base = { kind: 'boss' as const, footprint: '8x8' as const, equipped: [], animation: 'idle' as const };
  it('plays the nearest available direction, never mirrored', () => {
    const v = getCharacterViewState({ ...base, direction: 'NW', availableDirections: ['S', 'E'] });
    expect(v).toMatchObject({ skeletonDirection: 'S', mirrored: false, scaleX: 1 });
  });
  it('throws a clear RangeError without 1–3 available directions', () => {
    expect(() => getCharacterViewState({ ...base, direction: 'S' })).toThrow(RangeError);
    expect(() => getCharacterViewState({ ...base, direction: 'S', availableDirections: ['S', 'E', 'N', 'W'] })).toThrow(
      /1–3 available directions/,
    );
  });
});
