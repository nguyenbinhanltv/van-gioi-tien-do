import { test } from 'vitest';
import assert from 'node:assert/strict';
import {
  CAMERA_ZOOM_DEFAULT, CAMERA_ZOOM_MAX, CAMERA_ZOOM_MIN, CAMERA_ZOOM_STEP, DESIGN_HEIGHT, DESIGN_WIDTH, tileToScreen,
} from '@vgtd/shared';
import {
  ZoomController, clampZoom, parseZoomParam, pinchZoom, snapToDevicePx, viewToWorldAxis, visibleWorldSize,
  wheelZoomDelta,
} from '../src/camera/ZoomController.js';

const close = (a: number, b: number, eps = 1e-9) => assert.ok(Math.abs(a - b) <= eps, `${a} != ${b}`);

test('zoom constants: default inside the allowed range (owner decision: 1.5x, 1.0-2.0x)', () => {
  assert.equal(CAMERA_ZOOM_DEFAULT, 1.5);
  assert.equal(CAMERA_ZOOM_MIN, 1);
  assert.equal(CAMERA_ZOOM_MAX, 2);
  assert.ok(CAMERA_ZOOM_STEP > 0);
});

test('clampZoom / parseZoomParam clamp to range and reject garbage', () => {
  assert.equal(clampZoom(0.2), CAMERA_ZOOM_MIN);
  assert.equal(clampZoom(9), CAMERA_ZOOM_MAX);
  assert.equal(clampZoom(1.25), 1.25);
  assert.equal(clampZoom(NaN), CAMERA_ZOOM_DEFAULT);
  assert.equal(parseZoomParam(null), CAMERA_ZOOM_DEFAULT);
  assert.equal(parseZoomParam(''), CAMERA_ZOOM_DEFAULT);
  assert.equal(parseZoomParam('abc'), CAMERA_ZOOM_DEFAULT);
  assert.equal(parseZoomParam('0.5'), CAMERA_ZOOM_MIN);
  assert.equal(parseZoomParam('3'), CAMERA_ZOOM_MAX);
  assert.equal(parseZoomParam('1.75'), 1.75);
});

test('wheel: one notch = one step, wheel up zooms in, clamped at both ends', () => {
  close(wheelZoomDelta(-100), CAMERA_ZOOM_STEP);
  close(wheelZoomDelta(100), -CAMERA_ZOOM_STEP);
  close(wheelZoomDelta(-3, 1), CAMERA_ZOOM_STEP);        // line mode: 3 lines ~ one notch, capped at 1 notch
  close(wheelZoomDelta(-5000), CAMERA_ZOOM_STEP);        // a huge delta never exceeds one notch
  close(wheelZoomDelta(-10), CAMERA_ZOOM_STEP / 10);     // trackpad: proportional
  const z = new ZoomController();
  for (let i = 0; i < 50; i++) z.wheel(-100);
  assert.equal(z.target, CAMERA_ZOOM_MAX);
  for (let i = 0; i < 50; i++) z.wheel(100);
  assert.equal(z.target, CAMERA_ZOOM_MIN);
});

test('pinch math: spread zooms in, pinch zooms out, relative to the zoom at pinch start, clamped', () => {
  close(pinchZoom(1.5, 100, 100), 1.5);
  close(pinchZoom(1.2, 100, 125), 1.5);
  close(pinchZoom(1.5, 200, 100), CAMERA_ZOOM_MIN);      // 0.75 -> clamped up to 1.0
  assert.equal(pinchZoom(1.5, 100, 1000), CAMERA_ZOOM_MAX);
  assert.equal(pinchZoom(1.5, 0, 50), 1.5);              // degenerate start distance keeps the zoom
  assert.equal(pinchZoom(1.5, 100, NaN), 1.5);

  const z = new ZoomController(1.2);
  z.pinchStart(100);
  assert.ok(z.pinching);
  z.pinchUpdate(150);
  close(z.target, 1.8);
  z.pinchUpdate(120);                                    // always relative to the START, not cumulative
  close(z.target, 1.44);
  z.pinchEnd();
  z.pinchUpdate(400);                                    // ignored after the pinch ended
  close(z.target, 1.44);
  assert.ok(!z.pinching);
});

test('smoothing: current approaches target monotonically, frame-rate independent, never overshoots', () => {
  const a = new ZoomController(1.5), b = new ZoomController(1.5);
  a.setTarget(2); b.setTarget(2);
  let prev = a.current;
  for (let i = 0; i < 30; i++) { const c = a.update(1 / 60); assert.ok(c >= prev && c <= 2); prev = c; }
  for (let i = 0; i < 15; i++) b.update(1 / 30);
  close(a.current, b.current, 1e-9);                     // same wall time at 60 vs 30 fps
  for (let i = 0; i < 200; i++) a.update(1 / 60);
  assert.equal(a.current, 2);
  const c = new ZoomController();
  c.setTarget(1, true);
  assert.equal(c.current, 1);
});

test('picking inverse at non-1 zoom: world -> view -> world round-trips (zoom 1.0, 1.5, 2.0, mid-lerp)', () => {
  const player = tileToScreen(37.4, 12.9);
  for (const zoom of [1, 1.5, 2, 1.37]) {
    for (const ppu of [1, 1.5, 2]) {
      // forward: the view puts `player` at the canvas centre; offsets are snapped to the device px grid
      const offX = snapToDevicePx(-player.x * zoom, ppu);
      const offY = snapToDevicePx(-player.y * zoom, ppu);  // same axis maths (the y-flip itself lives in IsoAdapter)
      // a point 200 design px right of the centre must map back to player.x + 200 / zoom (+ <= half device px error)
      const wx = viewToWorldAxis(200, offX, zoom);
      assert.ok(Math.abs(wx - (player.x + 200 / zoom)) <= 0.5 / (ppu * zoom) + 1e-9, `zoom ${zoom} ppu ${ppu}: ${wx}`);
      const wy = viewToWorldAxis(-120, offY, zoom);
      assert.ok(Math.abs(wy - (player.y - 120 / zoom)) <= 0.5 / (ppu * zoom) + 1e-9);
    }
  }
  // the centre of the screen always picks the player's own tile
  const off = snapToDevicePx(-player.x * 1.5, 1);
  assert.ok(Math.abs(viewToWorldAxis(0, off, 1.5) - player.x) < 0.5 / 1.5 + 1e-9);
});

test('snapToDevicePx lands on the device grid and tolerates bad ratios', () => {
  close(snapToDevicePx(10.3, 1), 10);
  close(snapToDevicePx(10.3, 2), 10.5);
  close(snapToDevicePx(-7.26, 1.5) * 1.5, Math.round(-7.26 * 1.5));
  assert.equal(snapToDevicePx(10.4, 0), 10);
  assert.equal(snapToDevicePx(10.4, NaN), 10);
});

test('visible world size: bigger at 1.0x (stream more), smaller at 2.0x', () => {
  const w1 = visibleWorldSize(DESIGN_WIDTH, DESIGN_HEIGHT, 1);
  const w2 = visibleWorldSize(DESIGN_WIDTH, DESIGN_HEIGHT, 2);
  assert.equal(w1.w, DESIGN_WIDTH);
  assert.equal(w2.w, DESIGN_WIDTH / 2);
  assert.equal(w2.h, DESIGN_HEIGHT / 2);
});
