/**
 * Toán isometric 2:1 dùng chung cho input, UI và (qua module dùng chung) cho server.
 * Đơn vị thế giới: ô (i, j) dạng số thực; tâm ô nguyên (ti, tj) là (ti + 0.5, tj + 0.5).
 * Màn hình logic @1x: ô 64 × 32 px, điểm (i, j) nằm ở x = (i − j)·32, y = (i + j)·16.
 */
export const TILE_W = 64;
export const TILE_H = 32;
const HW = TILE_W / 2;
const HH = TILE_H / 2;

export interface Vec2 {
  x: number;
  y: number;
}
export interface TilePos {
  i: number;
  j: number;
}

export function tileToScreen(p: TilePos): Vec2 {
  return { x: (p.i - p.j) * HW, y: (p.i + p.j) * HH };
}

export function screenToTile(v: Vec2): TilePos {
  return { i: (v.x / HW + v.y / HH) / 2, j: (v.y / HH - v.x / HW) / 2 };
}

/** Vector hướng trên màn hình (px) -> vector hướng trong không gian ô, đã chuẩn hóa. */
export function screenDirToTileDir(dx: number, dy: number): TilePos {
  const i = (dx / HW + dy / HH) / 2;
  const j = (dy / HH - dx / HW) / 2;
  const len = Math.hypot(i, j);
  return len > 1e-6 ? { i: i / len, j: j / len } : { i: 0, j: 0 };
}

/** Ô nguyên chứa một điểm thế giới. */
export const tileOf = (p: TilePos): TilePos => ({ i: Math.floor(p.i), j: Math.floor(p.j) });
export const tileCenter = (t: TilePos): TilePos => ({ i: t.i + 0.5, j: t.j + 0.5 });

/**
 * Mã hóa hướng cho gói input (khớp server: góc = dir / 256 · 2π, 255 = đứng yên).
 * Góc rơi đúng mã 255 được dời sang 254 (lệch tối đa 1,4°).
 */
export const DIR_IDLE = 255;
export function encodeDir(di: number, dj: number): number {
  if (Math.hypot(di, dj) < 1e-6) return DIR_IDLE;
  let a = Math.atan2(dj, di);
  if (a < 0) a += Math.PI * 2;
  const code = Math.round((a / (Math.PI * 2)) * 256) % 256;
  return code === DIR_IDLE ? 254 : code;
}

/** Khóa hướng về 8 hướng trong không gian ô (trùng 8 hướng isometric trên màn hình). */
export function snap8(d: TilePos): TilePos {
  if (Math.hypot(d.i, d.j) < 1e-6) return d;
  const a = Math.round(Math.atan2(d.j, d.i) / (Math.PI / 4)) * (Math.PI / 4);
  return { i: Math.cos(a), j: Math.sin(a) };
}

/** Bộ phát sự kiện tối giản, có kiểu. */
export class Emitter<Events extends { [K in keyof Events]: unknown }> {
  private handlers: { [K in keyof Events]?: Array<(payload: Events[K]) => void> } = {};
  on<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): () => void {
    (this.handlers[type] ??= []).push(fn);
    return () => this.off(type, fn);
  }
  off<K extends keyof Events>(type: K, fn: (payload: Events[K]) => void): void {
    const list = this.handlers[type];
    if (list) this.handlers[type] = list.filter((h) => h !== fn);
  }
  protected emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    for (const h of this.handlers[type] ?? []) h(payload);
  }
}
