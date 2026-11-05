import type { TilePos, Vec2 } from '../core/IsoMath.js';

export type InputMode = 'pointer' | 'touch';

/** Một lần thi triển kỹ năng. Không có aim = tự nhắm mục tiêu gần nhất (server quyết). */
export interface SkillCast {
  slot: number;
  /** Điểm thế giới được nhắm (PC: vị trí chuột; touch: kéo nút kỹ năng). */
  aimTile?: TilePos;
}

/** Kết quả đọc input của một frame, độc lập nền tảng. */
export interface InputFrame {
  /** Hướng di chuyển trong không gian ô (đã chuẩn hóa) hoặc (0, 0). */
  move: TilePos;
  /** Độ lớn 0..1 (cần analog); chuột / phím luôn 1. */
  magnitude: number;
  dodge: boolean;
  flyToggle: boolean;
  qinggong: boolean;
  casts: SkillCast[];
  cancelCast: boolean;
  /** Mục tiêu được chọn bằng click / chạm (id thực thể) nếu có. */
  target: number | null;
  /** Đường A* đang đi (chỉ PC click-to-move), để HUD vẽ điểm đến. */
  path: ReadonlyArray<TilePos> | null;
}

export const emptyFrame = (): InputFrame => ({
  move: { i: 0, j: 0 }, magnitude: 0, dodge: false, flyToggle: false, qinggong: false,
  casts: [], cancelCast: false, target: null, path: null,
});

/** Camera của engine: đổi tọa độ client (CSS px của phần tử) sang màn hình logic thế giới. */
export interface CameraLike {
  clientToWorld(clientX: number, clientY: number): Vec2;
}

/** Vị trí nhân vật đang được dự đoán phía client. */
export interface PlayerLocator {
  position(): TilePos;
}

/** Bit cờ trong gói input (khớp tài liệu server). */
export const FLAG_DODGE = 1;
export const FLAG_FLY_TOGGLE = 2;
export const FLAG_QINGGONG = 4;

export interface Rect { x: number; y: number; w: number; h: number }
export const inRect = (r: Rect, x: number, y: number) => x >= r.x && y >= r.y && x <= r.x + r.w && y <= r.y + r.h;
