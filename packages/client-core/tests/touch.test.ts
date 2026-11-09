import { test } from 'vitest';
import assert from 'node:assert/strict';
import { TouchController, TouchLayout } from '../src/input/TouchController.js';
import { emptyFrame } from '../src/input/types.js';

const layout: TouchLayout = {
  joystickZone: { x: 0, y: 300, w: 500, h: 420 }, joystickRadius: 64,
  wheelCenter: { x: 1180, y: 620 }, mainRadius: 48, arcRadius: 128, skillRadius: 32,
  arcFromDeg: 165, arcToDeg: 285, dodgeButton: { x: 1184, y: 424 }, flyButton: { x: 984, y: 624 },
  smallRadius: 24, cancelRect: { x: 1140, y: 16, w: 120, h: 52 }, tilesPerPixel: 1 / 32,
};
const ev = (id: number, x: number, y: number) => ({ pointerId: id, clientX: x, clientY: y } as unknown as PointerEvent);
const player = { position: () => ({ i: 10, j: 10 }) };
const tc = new TouchController(player, () => ({ x: 0, y: 0 }));
tc.setLayout(layout);

test('touch controller: joystick, skill wheel, aim, cancel, page swipe', () => {
  // Joystick động: chạm ở (200, 500), kéo sang phải 64 px -> hướng màn hình phải = (1, −1)/√2 trong không gian ô
  assert.ok(tc.pointerDown(ev(1, 200, 500)));
  tc.pointerMove(ev(1, 264, 500));
  let f = emptyFrame(); tc.update(f);
  assert.ok(f.magnitude > 0.99, `độ lớn ${f.magnitude}`);
  assert.ok(Math.abs(f.move.i - Math.SQRT1_2) < 1e-6 && Math.abs(f.move.j + Math.SQRT1_2) < 1e-6);
  // Kéo quá bán kính: đế đi theo, độ lớn vẫn 1
  tc.pointerMove(ev(1, 400, 500));
  const vs = tc.visualState()!;
  assert.ok(Math.abs(Math.hypot(vs.joystick!.knob.x - vs.joystick!.base.x, vs.joystick!.knob.y - vs.joystick!.base.y) - 64) < 1e-6);
  tc.pointerUp(ev(1, 400, 500));
  f = emptyFrame(); tc.update(f);
  assert.equal(f.magnitude, 0);

  // Chạm nhanh nút đánh thường -> slot 0, tự nhắm
  tc.pointerDown(ev(2, 1180, 620)); tc.pointerUp(ev(2, 1180, 620));
  f = emptyFrame(); tc.update(f);
  assert.deepEqual(f.casts, [{ slot: 0 }]);

  // Kéo nút kỹ năng đầu tiên để nhắm -> có aimTile
  const s0 = tc.skillCenters()[0];
  tc.pointerDown(ev(3, s0.x, s0.y)); tc.pointerMove(ev(3, s0.x - 96, s0.y)); tc.pointerUp(ev(3, s0.x - 96, s0.y));
  f = emptyFrame(); tc.update(f);
  assert.equal(f.casts.length, 1);
  assert.equal(f.casts[0].slot, 1);
  assert.ok(f.casts[0].aimTile && f.casts[0].aimTile.i < 10, 'kéo sang trái màn hình -> i giảm');

  // Kéo vào vùng Hủy -> cancelCast, không thi triển
  tc.pointerDown(ev(4, s0.x, s0.y)); tc.pointerMove(ev(4, 1200, 40)); tc.pointerUp(ev(4, 1200, 40));
  f = emptyFrame(); tc.update(f);
  assert.equal(f.casts.length, 0);
  assert.equal(f.cancelCast, true);

  // Vuốt dọc dải vòng cung (ngoài các nút) từ góc 200° tới 250° -> sang trang kỹ năng 2
  const a = (200 * Math.PI) / 180, b = (250 * Math.PI) / 180;
  const ringStart = [1180 + Math.cos(a) * 160, 620 + Math.sin(a) * 160] as const;
  const ringEnd = [1180 + Math.cos(b) * 160, 620 + Math.sin(b) * 160] as const;
  assert.ok(tc.pointerDown(ev(6, ringStart[0], ringStart[1])));
  tc.pointerMove(ev(6, ringEnd[0], ringEnd[1]));
  tc.pointerUp(ev(6, ringEnd[0], ringEnd[1]));
  assert.equal(tc.visualState()!.page, 1);
  assert.equal(tc.visualState()!.buttons[1].slot, 6);
});

test('touch aim: the live aim tile follows the finger and dragging back to the button drops the cast', () => {
  const t = new TouchController(player, () => ({ x: 0, y: 0 }));
  t.setLayout(layout);
  t.aimZoom = 1;
  const s0 = t.skillCenters()[0];
  t.pointerDown(ev(7, s0.x, s0.y));
  assert.equal(t.visualState()!.aim, null, 'a press is not an aim yet');
  t.pointerMove(ev(7, s0.x - 96, s0.y));
  const v = t.visualState()!.aim!;
  assert.equal(v.backAtOrigin, false);
  assert.equal(v.overCancel, false);
  assert.ok(v.tile.i < 10, 'aim tile is where a release would cast');
  // the cast the release produces carries exactly that tile
  t.pointerUp(ev(7, s0.x - 96, s0.y));
  let f = emptyFrame(); t.update(f);
  assert.deepEqual(f.casts[0].aimTile, v.tile);

  // drag out, then back onto the button: indicator says "dropped", release casts nothing and cancels nothing
  t.pointerDown(ev(8, s0.x, s0.y));
  t.pointerMove(ev(8, s0.x - 96, s0.y));
  t.pointerMove(ev(8, s0.x + 3, s0.y - 2));
  assert.equal(t.visualState()!.aim!.backAtOrigin, true);
  t.pointerUp(ev(8, s0.x + 3, s0.y - 2));
  f = emptyFrame(); t.update(f);
  assert.equal(f.casts.length, 0);
  assert.equal(f.cancelCast, false);

  // a plain tap still auto-targets
  t.pointerDown(ev(9, s0.x, s0.y)); t.pointerUp(ev(9, s0.x, s0.y));
  f = emptyFrame(); t.update(f);
  assert.deepEqual(f.casts, [{ slot: 1 }]);
});
