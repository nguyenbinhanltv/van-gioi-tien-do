import { test } from 'vitest';
import assert from 'node:assert/strict';
import { IsoPathfinder, WalkGrid } from '../src/input/IsoPathfinder.js';
import { encodeDir, screenDirToTileDir, screenToTile, tileToScreen, snap8 } from '../src/core/IsoMath.js';

/** Lưới thử từ chuỗi: '#' = chặn, '.' = đi được. Hàng = j, cột = i. */
function gridFrom(rows: string[]): WalkGrid {
  return { width: rows[0].length, height: rows.length, isWalkable: (i, j) => rows[j][i] !== '#' };
}

test('1. Đi vòng qua tường', () => {
  const g = gridFrom([
    '..........',
    '....#.....',
    '....#.....',
    '....#.....',
    '....#.....',
    '..........',
  ]);
  const pf = new IsoPathfinder(g);
  const path = pf.findPath({ i: 1, j: 2 }, { i: 8, j: 2 });
  assert.ok(path, 'phải tìm được đường');
  const last = path![path!.length - 1];
  assert.deepEqual(last, { i: 8.5, j: 2.5 });
  for (let k = 0; k < path!.length; k++) {
    assert.ok(g.isWalkable(Math.floor(path![k].i), Math.floor(path![k].j)), 'điểm đường phải đi được');
  }
  // đã rút gọn: ít điểm hơn số ô thô
  assert.ok(path!.length <= 4, `đường đã rút gọn, nhận ${path!.length} điểm`);
});

test('2. Không cắt góc chéo giữa hai ô chặn', () => {
  const g = gridFrom([
    '.#',
    '#.',
  ]);
  const pf = new IsoPathfinder(g);
  assert.equal(pf.findPath({ i: 0, j: 0 }, { i: 1, j: 1 }, { snapRadius: 0 }), null, 'không được lách qua góc');
});

test('3. Đích bị chặn -> ô đi được gần nhất', () => {
  const g = gridFrom(['.....', '..#..', '.....']);
  const pf = new IsoPathfinder(g);
  const p = pf.findPath({ i: 0, j: 1 }, { i: 2, j: 1 });
  assert.ok(p && p.length > 0);
  const end = p![p!.length - 1];
  assert.notDeepEqual(end, { i: 2.5, j: 1.5 });
});

test('4. Không có đường -> null', () => {
  const g = gridFrom(['..#..', '..#..', '..#..']);
  assert.equal(new IsoPathfinder(g).findPath({ i: 0, j: 0 }, { i: 4, j: 2 }, { snapRadius: 0 }), null);
});

test('5. Toán isometric', () => {
  const s = tileToScreen({ i: 3, j: 1 });
  assert.deepEqual(s, { x: 64, y: 64 });
  const t = screenToTile(s);
  assert.ok(Math.abs(t.i - 3) < 1e-9 && Math.abs(t.j - 1) < 1e-9);
  const right = screenDirToTileDir(1, 0);           // sang phải màn hình = hướng (1, −1) trong ô
  assert.ok(Math.abs(right.i - Math.SQRT1_2) < 1e-9 && Math.abs(right.j + Math.SQRT1_2) < 1e-9);
  assert.equal(encodeDir(0, 0), 255);
  assert.equal(encodeDir(1, 0), 0);
  assert.equal(encodeDir(0, 1), 64);
  const sn = snap8({ i: 0.9, j: 0.2 });
  assert.ok(Math.abs(sn.i - 1) < 1e-9 && Math.abs(sn.j) < 1e-9);
});

test('6. Hiệu năng: lưới 256 × 256, 15% ô chặn ngẫu nhiên có seed', () => {
  let seed = 12345;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const W = 256, blocked = new Uint8Array(W * W);
  for (let k = 0; k < blocked.length; k++) blocked[k] = rand() < 0.15 ? 1 : 0;
  blocked[0] = 0; blocked[W * W - 1] = 0;
  const pf = new IsoPathfinder({ width: W, height: W, isWalkable: (i, j) => blocked[j * W + i] === 0 });
  const t0 = performance.now();
  const p = pf.findPath({ i: 0, j: 0 }, { i: 120, j: 100 }, { maxExpanded: 60000 });
  const ms = performance.now() - t0;
  assert.ok(p, 'phải có đường trên lưới ngẫu nhiên');
  console.log(`  A* 256×256: ${p!.length} điểm sau rút gọn, ${ms.toFixed(1)} ms`);
});

