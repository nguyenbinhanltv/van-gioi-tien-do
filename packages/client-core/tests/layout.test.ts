import { test } from 'vitest';
import assert from 'node:assert/strict';
import { AnchorLayout, DEFAULT_PROFILES, touchLayoutFromRects } from '../src/ui/AnchorLayout.js';

const opts = {
  refLandscape: [1280, 720] as [number, number],
  refPortrait: [720, 1280] as [number, number],
  userScale: 1,
  touchMargin: 16,
};
const noInsets = { top: 0, right: 0, bottom: 0, left: 0 };

test('16:9, 1920 × 1080: scale 1,5; chat bám góc dưới trái', () => {
  const r = AnchorLayout.compute(1920, 1080, noInsets, 'pointer', DEFAULT_PROFILES, opts);
  assert.equal(r.scale, 1.5);
  assert.deepEqual(r.rects.get('chat'), { x: 24, y: 1080 - 24 - 300, w: 540, h: 300 });
  const mm = r.rects.get('minimap')!;
  assert.equal(mm.x + mm.w, 1920 - 24);
});

test('19,5:9 điện thoại 2532 × 1170 có tai thỏ trái 47 px, thanh home dưới 21 px', () => {
  const insets = { top: 0, right: 47, bottom: 21, left: 47 };
  const r = AnchorLayout.compute(2532, 1170, insets, 'touch', DEFAULT_PROFILES, opts);
  assert.equal(r.profile, 'touch-landscape');
  assert.equal(r.scale, 1170 / 720); // theo chiều cao
  const pf = r.rects.get('player-frame')!;
  assert.ok(pf.x >= 47, 'không bị tai thỏ che');
  const wheel = r.rects.get('skill-wheel')!;
  assert.ok(wheel.x + wheel.w <= 2532 - 47 && wheel.y + wheel.h <= 1170 - 21, 'cụm skill nằm trong safe area');
  const tl = touchLayoutFromRects(r, 1 / 32)!;
  assert.ok(tl.skillRadius * 2 >= 88, 'nút kỹ năng ≥ 44 pt (88 px @2x)');
});

test('Dọc 1080 × 2340: dùng bố cục touch-portrait', () => {
  const r = AnchorLayout.compute(1080, 2340, noInsets, 'touch', DEFAULT_PROFILES, opts);
  assert.equal(r.orientation, 'portrait');
  assert.equal(r.profile, 'touch-portrait');
  const ticker = r.rects.get('chat-ticker')!;
  assert.equal(ticker.x, Math.round(16 * r.scale));
  assert.equal(ticker.w, Math.round(1080 - 32 * r.scale));
});

test('PC không có bố cục dọc -> rơi về ngang', () => {
  const r = AnchorLayout.compute(800, 1200, noInsets, 'pointer', DEFAULT_PROFILES, opts);
  assert.equal(r.profile, 'pointer-landscape');
});
