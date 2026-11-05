import { describe, expect, it } from 'vitest';
import {
  CANVAS_TABLE,
  HITBOX_BY_FOOTPRINT,
  HEAD_TOP_HAT_BONUS_PX,
  ORBIT_ELLIPSE_PX,
  OVERHEAD_UI,
  SHADOW_ELLIPSE_PX,
  SOCKETS,
  canvasSizeFor,
  footprintSize,
  getHitboxes,
  getSocket,
  headTopY,
  overheadAnchors,
  pickBoxRect,
  pivotOf,
  pivotToCanvas,
  socketCanvasPosition,
  usesHudHpBar,
} from '../src/index.js';

describe('canvas by footprint', () => {
  it('128 / 192 / 256 / 512 and none for the pieced 8x8', () => {
    expect(canvasSizeFor('1x1')).toBe(128);
    expect(canvasSizeFor('elite')).toBe(192);
    expect(canvasSizeFor('2x2')).toBe(256);
    expect(canvasSizeFor('4x4')).toBe(512);
    expect(canvasSizeFor('8x8')).toBeNull();
  });
  it('@2x column', () => {
    expect([128, 192, 256, 512].map((_, i) => canvasSizeFor(['1x1', 'elite', '2x2', '4x4'][i] as '1x1', 2))).toEqual([
      256, 384, 512, 1024,
    ]);
  });
  it('cells per 2048 atlas @1x: 256 / 100 / 64 / 16', () => {
    expect(CANVAS_TABLE.map((c) => c.cellsPerAtlas2048)).toEqual([256, 100, 64, 16, null]);
  });
  it('4x4 and up are Spine only; at @2x a 512 canvas fits 4 cells per 2048 atlas', () => {
    expect(CANVAS_TABLE.filter((c) => c.spineOnly).map((c) => c.footprint)).toEqual(['4x4', '8x8']);
    expect(Math.floor(2048 / canvasSizeFor('4x4', 2)!) ** 2 / 1).toBe(4);
  });
  it('figure heights', () => {
    const h = Object.fromEntries(CANVAS_TABLE.map((c) => [c.footprint, c.figureHeightPx]));
    expect(h['1x1']).toEqual({ min: 96, max: 110 });
    expect(h.elite!.min).toBe(140);
    expect(h['2x2']!.min).toBe(180);
    expect(h['4x4']!.min).toBe(360);
    expect(h['8x8']).toEqual({ min: 500, max: null });
  });
});

describe('pivot', () => {
  it('(W/2, H − 12) from the top-left corner', () => {
    expect(pivotOf(128)).toEqual({ x: 64, y: 116 });
    expect(pivotOf(192)).toEqual({ x: 96, y: 180 });
    expect(pivotOf(256)).toEqual({ x: 128, y: 244 });
    expect(pivotOf(512)).toEqual({ x: 256, y: 500 });
  });
  it('pivot-space (y up) → canvas (y down)', () => {
    expect(pivotToCanvas({ x: 0, y: 0 }, 128)).toEqual({ x: 64, y: 116 });
    expect(pivotToCanvas({ x: -18, y: 52 }, 128)).toEqual({ x: 46, y: 64 });
    expect(pivotToCanvas({ x: -18, y: 52 }, 128, 128, true)).toEqual({ x: 82, y: 64 });
  });
});

describe('sockets (1x1, canvas 128 @1x, pose S)', () => {
  const pos = (id: Parameters<typeof getSocket>[0]) => getSocket(id).pos;
  it('coordinates from the spec table', () => {
    expect(pos('origin')).toEqual({ x: 0, y: 0 });
    expect(pos('hand_R')).toEqual({ x: -18, y: 52 });
    expect(pos('hand_L')).toEqual({ x: 18, y: 52 });
    expect(pos('back')).toEqual({ x: 0, y: 64 });
    expect(getSocket('back').tiltDeg).toBe(45);
    expect(pos('chest')).toEqual({ x: 0, y: 48 });
    expect(pos('head_fx')).toEqual({ x: 0, y: 92 });
    expect(pos('head_top')).toEqual({ x: 0, y: 104 });
    expect(pos('orbit_center')).toEqual({ x: 0, y: 60 });
    expect(pos('mount_seat')).toBeNull();
    expect(pos('fly_feet')).toEqual({ x: 0, y: 0 });
    expect(ORBIT_ELLIPSE_PX).toEqual({ width: 36, height: 18 });
    expect(SOCKETS).toHaveLength(10);
  });
  it('bone attachment / animation following', () => {
    expect(getSocket('hand_R').bone).toBe('hand_R');
    expect(getSocket('back').bone).toBe('spine_upper');
    expect(getSocket('chest').bone).toBe('spine_mid');
    expect(getSocket('head_fx').bone).toBe('head');
    expect(getSocket('head_top').bone).toBeNull(); // deliberately not on a bone
    expect(getSocket('orbit_center').bone).toBeNull();
    expect(getSocket('head_top').followsAnimation).toBe(false);
    expect(getSocket('fly_feet').followsAnimation).toBe('code');
    expect(getSocket('mount_seat').followsAnimation).toBe('mount');
  });
  it('mirrored directions flip the x sign', () => {
    expect(socketCanvasPosition('hand_R', 128)).toEqual({ x: 46, y: 64 });
    expect(socketCanvasPosition('hand_R', 128, true)).toEqual({ x: 82, y: 64 });
    expect(() => socketCanvasPosition('mount_seat', 128)).toThrow();
    expect(socketCanvasPosition('mount_seat', 128, false, { x: 0, y: 40 })).toEqual({ x: 64, y: 76 });
  });
});

describe('overhead UI', () => {
  it('offsets 6 / 16 / 30 from head_top, sizes 48×5, 12px font, 16×16', () => {
    const by = Object.fromEntries(OVERHEAD_UI.map((e) => [e.id, e]));
    expect(by.hp_bar!.offset).toBe(6);
    expect(by.hp_bar!.size).toEqual({ width: 48, height: 5 });
    expect(by.name_title!.offset).toBe(16);
    expect(by.name_title!.size.height).toBe(12);
    expect(by.realm_icon!.offset).toBe(30);
    expect(by.realm_icon!.size).toEqual({ width: 16, height: 16 });
  });
  it('head_top rises with tall hat (+8), mount seat height and flight height', () => {
    expect(headTopY()).toBe(104);
    expect(headTopY({ tallHat: true })).toBe(104 + HEAD_TOP_HAT_BONUS_PX);
    expect(HEAD_TOP_HAT_BONUS_PX).toBe(8);
    expect(headTopY({ mountSeatHeight: 40, tallHat: true })).toBe(152);
    expect(headTopY({ flyHeight: 30 })).toBe(134);
  });
  it('anchors sit at head_top + offset', () => {
    expect(overheadAnchors(104)).toEqual({
      hp_bar: { x: 0, y: 110 },
      name_title: { x: 0, y: 120 },
      realm_icon: { x: 0, y: 134 },
    });
  });
  it('multi-tile bosses use the HUD bar', () => {
    expect(usesHudHpBar('1x1')).toBe(false);
    expect(usesHudHpBar('elite')).toBe(false);
    expect(usesHudHpBar('2x2')).toBe(true);
    expect(usesHudHpBar('4x4')).toBe(true);
    expect(usesHudHpBar('8x8')).toBe(true);
  });
});

describe('hit volumes by footprint', () => {
  it('1x1: collider 0.35, hurtbox 0.45, pick box 48×100', () => {
    expect(HITBOX_BY_FOOTPRINT[1]).toEqual({
      multiPart: false,
      colliderRadius: 0.35,
      hurtboxRadius: 0.45,
      pickBox: { width: 48, height: 100 },
    });
  });
  it('2x2, 4x4 and 8x8 rows', () => {
    expect(HITBOX_BY_FOOTPRINT[2]).toEqual({
      multiPart: false,
      colliderRadius: 0.8,
      hurtboxRadius: 0.95,
      pickBox: { width: 120, height: 180 },
    });
    expect(HITBOX_BY_FOOTPRINT[4]).toEqual({
      multiPart: false,
      colliderRadius: 1.7,
      hurtboxRadius: 1.9,
      pickBox: { width: 240, height: 340 },
    });
    expect(HITBOX_BY_FOOTPRINT[8]).toEqual({ multiPart: true });
  });
  it('class → size; elite is logically 1x1', () => {
    expect(footprintSize('elite')).toBe(1);
    expect(getHitboxes('elite')).toEqual(HITBOX_BY_FOOTPRINT[1]);
  });
  it('pick box: centred on the pivot, bottom edge at the pivot', () => {
    expect(pickBoxRect({ x: 100, y: 200 }, { width: 48, height: 100 })).toEqual({
      x: 76,
      y: 100,
      width: 48,
      height: 100,
    });
  });
  it('shadow is a 40×20 (2:1) ellipse', () => {
    expect(SHADOW_ELLIPSE_PX).toEqual({ width: 40, height: 20 });
  });
});
