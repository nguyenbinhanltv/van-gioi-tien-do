import { test } from 'vitest';
import assert from 'node:assert/strict';
import { CAMERA_ZOOM_STEP } from '@vgtd/shared';
import { tileToScreen } from '../src/core/IsoMath.js';
import { InputManager } from '../src/input/InputManager.js';
import type { InputMode } from '../src/input/types.js';
import type { TouchLayout } from '../src/input/TouchController.js';
import { ZoomController } from '../src/camera/ZoomController.js';

// the camera is centred on the player's tile: client px (640, 360) = the player, 1:1 px
const P = tileToScreen({ i: 100, j: 100 });
const layout: TouchLayout = {
  joystickZone: { x: 0, y: 300, w: 500, h: 420 },
  joystickRadius: 64,
  wheelCenter: { x: 1180, y: 620 },
  mainRadius: 48,
  arcRadius: 128,
  skillRadius: 32,
  arcFromDeg: 165,
  arcToDeg: 285,
  dodgeButton: { x: 1184, y: 424 },
  flyButton: { x: 984, y: 624 },
  smallRadius: 24,
  cancelRect: { x: 1140, y: 16, w: 120, h: 52 },
  tilesPerPixel: 1 / 32,
};

/** InputManager on a stub element + stub window (the vitest env is plain node). */
function rig(mode: InputMode, uiHit?: (x: number, y: number) => boolean) {
  const el = Object.assign(new EventTarget(), {
    style: {} as Record<string, string>,
    setPointerCapture: () => {},
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 1280, height: 720 }),
  });
  const g = globalThis as unknown as { window?: EventTarget };
  const oldWindow = g.window;
  g.window = new EventTarget();
  const zoom = new ZoomController(1.5);
  const im = new InputManager(el as unknown as HTMLElement, {
    grid: { width: 200, height: 200, isWalkable: () => true },
    camera: { clientToWorld: (x, y) => ({ x: x - 640 + P.x, y: y - 360 + P.y }) },
    player: { position: () => ({ i: 100, j: 100 }) },
    forcedMode: mode,
    zoom,
    uiHitTest: uiHit,
  });
  im.setTouchLayout(layout);
  const fire = (type: string, props: Record<string, unknown>) => {
    el.dispatchEvent(Object.assign(new Event(type, { cancelable: true }), props));
  };
  const touch = (type: string, id: number, x: number, y: number) =>
    fire(type, { pointerId: id, pointerType: 'touch', clientX: x, clientY: y, button: 0 });
  return {
    im,
    zoom,
    touch,
    fire,
    down: (id: number, x: number, y: number) => touch('pointerdown', id, x, y),
    move: (id: number, x: number, y: number) => touch('pointermove', id, x, y),
    up: (id: number, x: number, y: number) => touch('pointerup', id, x, y),
    wheel: (deltaY: number, x = 640, y = 360) => fire('wheel', { deltaY, deltaMode: 0, clientX: x, clientY: y }),
    done: () => {
      im.destroy();
      g.window = oldWindow;
    },
  };
}

test('touch mode: joystick-claimed finger + one free finger does not pinch; joystick keeps working', () => {
  const r = rig('touch');
  r.down(1, 200, 500); // joystick zone: claimed by the joystick
  r.down(2, 800, 150); // free finger
  assert.ok(!r.zoom.pinching);
  r.move(1, 264, 500);
  r.move(2, 900, 150); // moving the free finger must not zoom
  assert.equal(r.zoom.target, 1.5);
  const f = r.im.poll();
  assert.ok(f.magnitude > 0.99, `joystick magnitude ${f.magnitude}`);
  r.up(2, 900, 150);
  r.up(1, 264, 500);
  assert.equal(r.im.poll().magnitude, 0);
  r.done();
});

test('touch mode: two free fingers pinch and change the zoom target; lifting one ends the pinch', () => {
  const r = rig('touch');
  r.down(1, 600, 150);
  r.down(2, 700, 150); // distance 100
  assert.ok(r.zoom.pinching);
  r.move(2, 750, 150); // distance 150 -> x1.5 of the start zoom 1.5, clamped to 2.0
  assert.equal(r.zoom.target, 2);
  r.move(2, 650, 150); // distance 50 -> 0.75, clamped to 1.0
  assert.equal(r.zoom.target, 1);
  r.up(2, 650, 150);
  assert.ok(!r.zoom.pinching);
  r.move(1, 100, 150); // the lone remaining finger must not zoom
  assert.equal(r.zoom.target, 1);
  r.up(1, 100, 150);
  // a fresh pinch afterwards works again
  r.down(3, 600, 150);
  r.down(4, 700, 150);
  assert.ok(r.zoom.pinching);
  r.done();
});

test('touch mode: a finger on the skill wheel is claimed, a second free finger does not pinch', () => {
  const r = rig('touch');
  r.down(1, 1180, 620); // attack button
  r.down(2, 700, 150);
  assert.ok(!r.zoom.pinching);
  r.done();
});

test('pointer mode: the first finger starts click-to-move, a second finger turns it into a pinch with no click', () => {
  const r = rig('pointer');
  r.down(1, 700, 100); // would start click-to-move
  assert.ok(r.im.poll().path, 'first finger begins a path');
  r.down(2, 800, 100);
  assert.ok(r.zoom.pinching);
  const f = r.im.poll();
  assert.equal(f.path, null);
  assert.equal(f.magnitude, 0);
  r.up(2, 800, 100); // lifting one pinch finger ends the pinch ...
  assert.ok(!r.zoom.pinching);
  r.up(1, 700, 100); // ... and the first finger's release fires nothing
  const g = r.im.poll();
  assert.equal(g.path, null);
  assert.equal(g.magnitude, 0);
  r.done();
});

test('pointer mode: a mouse click still walks (no pinch tracking for mice)', () => {
  const r = rig('pointer');
  r.fire('pointerdown', { pointerId: 1, pointerType: 'mouse', clientX: 700, clientY: 100, button: 0 });
  assert.ok(r.im.poll().path);
  assert.ok(!r.zoom.pinching);
  r.done();
});

test('wheel changes the zoom target; a wheel over a UI element does not', () => {
  const r = rig('pointer', (x) => x > 1000);
  r.wheel(-100, 640, 360);
  assert.ok(Math.abs(r.zoom.target - (1.5 + CAMERA_ZOOM_STEP)) < 1e-9);
  r.wheel(100, 640, 360);
  assert.ok(Math.abs(r.zoom.target - 1.5) < 1e-9);
  r.wheel(-100, 1100, 360); // over the UI
  assert.ok(Math.abs(r.zoom.target - 1.5) < 1e-9);
  r.done();
});
