import { TilePos, Vec2, screenDirToTileDir, snap8 } from '../core/IsoMath.js';
import { InputFrame, PlayerLocator, Rect, inRect } from './types.js';

/**
 * Hình học cụm điều khiển cảm ứng, tính bằng CSS px trong hệ tọa độ client của phần tử.
 * AnchorLayout cung cấp các giá trị này (xem touchLayoutFromRects trong ui/AnchorLayout.ts).
 */
export interface TouchLayout {
  joystickZone: Rect;        // vùng ngón cái trái được phép gọi Joystick
  joystickRadius: number;
  wheelCenter: Vec2;         // tâm nút đánh thường
  mainRadius: number;
  arcRadius: number;         // bán kính vòng cung các nút kỹ năng
  skillRadius: number;
  arcFromDeg: number;        // góc màn hình (y hướng xuống), ví dụ 165
  arcToDeg: number;          // ví dụ 285
  dodgeButton: Vec2;
  flyButton: Vec2;
  smallRadius: number;
  cancelRect: Rect;          // kéo kỹ năng vào đây để hủy
  /** Bao nhiêu ô của thế giới ứng với 1 px kéo khi nhắm (theo zoom camera). */
  tilesPerPixel: number;
}

export const SKILLS_PER_PAGE = 5;
export const SKILL_PAGES = 2;
const DEAD_ZONE = 0.1;
const AIM_START_PX = 12;
const PAGE_SWIPE_DEG = 20;

type ButtonId =
  | { kind: 'attack' }
  | { kind: 'skill'; index: number }   // 0..4 trong trang hiện tại
  | { kind: 'dodge' }
  | { kind: 'fly' };

interface Press {
  pointerId: number;
  button: ButtonId;
  origin: Vec2;
  current: Vec2;
  aiming: boolean;
  overCancel: boolean;
}

interface RingSwipe { pointerId: number; startAngle: number; angle: number }

interface Joystick { pointerId: number; base: Vec2; knob: Vec2 }

export interface TouchVisualState {
  joystick: { base: Vec2; knob: Vec2; radius: number } | null;
  page: number;
  buttons: Array<{ id: string; center: Vec2; radius: number; pressed: boolean; slot: number | null }>;
  aim: { from: Vec2; to: Vec2; overCancel: boolean } | null;
  cancelVisible: boolean;
}

export class TouchController {
  private layout: TouchLayout | null = null;
  private joy: Joystick | null = null;
  private presses = new Map<number, Press>();
  private ring: RingSwipe | null = null;
  private page = 0;
  private pendingCasts: Array<{ slot: number; aimTile?: TilePos }> = [];
  private pendingDodge = false;
  private pendingFly = false;
  private pendingCancel = false;

  /** Khóa 8 hướng isometric (tùy chọn trong Cài đặt). */
  eightWay = false;

  constructor(private readonly player: PlayerLocator, private readonly elementOrigin: () => Vec2) {}

  setLayout(l: TouchLayout): void { this.layout = l; }

  reset(): void {
    this.joy = null;
    this.presses.clear();
    this.ring = null;
    this.pendingCasts = [];
    this.pendingDodge = this.pendingFly = this.pendingCancel = false;
  }

  private local(e: PointerEvent): Vec2 {
    const o = this.elementOrigin();
    return { x: e.clientX - o.x, y: e.clientY - o.y };
  }

  /** Vị trí các nút kỹ năng trên vòng cung (trang hiện tại). */
  skillCenters(): Vec2[] {
    const L = this.layout!;
    const out: Vec2[] = [];
    for (let k = 0; k < SKILLS_PER_PAGE; k++) {
      const a = ((L.arcFromDeg + ((L.arcToDeg - L.arcFromDeg) * k) / (SKILLS_PER_PAGE - 1)) * Math.PI) / 180;
      out.push({ x: L.wheelCenter.x + Math.cos(a) * L.arcRadius, y: L.wheelCenter.y + Math.sin(a) * L.arcRadius });
    }
    return out;
  }

  private hitButton(p: Vec2): ButtonId | null {
    const L = this.layout!;
    const d = (c: Vec2) => Math.hypot(p.x - c.x, p.y - c.y);
    if (d(L.wheelCenter) <= L.mainRadius) return { kind: 'attack' };
    const centers = this.skillCenters();
    for (let k = 0; k < centers.length; k++) if (d(centers[k]) <= L.skillRadius) return { kind: 'skill', index: k };
    if (d(L.dodgeButton) <= L.smallRadius) return { kind: 'dodge' };
    if (d(L.flyButton) <= L.smallRadius) return { kind: 'fly' };
    return null;
  }

  private onRing(p: Vec2): boolean {
    const L = this.layout!;
    const r = Math.hypot(p.x - L.wheelCenter.x, p.y - L.wheelCenter.y);
    return Math.abs(r - L.arcRadius) <= L.skillRadius * 1.4;
  }

  /** Cụm điều khiển có nhận điểm chạm này không (để InputManager không đẩy xuống UI khác). */
  claims(e: PointerEvent): boolean {
    if (!this.layout) return false;
    const p = this.local(e);
    return this.hitButton(p) !== null || this.onRing(p) || inRect(this.layout.joystickZone, p.x, p.y);
  }

  pointerDown(e: PointerEvent): boolean {
    if (!this.layout) return false;
    const p = this.local(e);
    const btn = this.hitButton(p);
    if (btn) {
      this.presses.set(e.pointerId, { pointerId: e.pointerId, button: btn, origin: p, current: p, aiming: false, overCancel: false });
      return true;
    }
    if (this.onRing(p)) {
      const a = this.angleAt(p);
      this.ring = { pointerId: e.pointerId, startAngle: a, angle: a };
      return true;
    }
    if (!this.joy && inRect(this.layout.joystickZone, p.x, p.y)) {
      this.joy = { pointerId: e.pointerId, base: p, knob: p };   // Joystick hiện đúng chỗ ngón tay
      return true;
    }
    return false;
  }

  pointerMove(e: PointerEvent): void {
    if (!this.layout) return;
    const p = this.local(e);
    if (this.joy && this.joy.pointerId === e.pointerId) {
      const R = this.layout.joystickRadius;
      let dx = p.x - this.joy.base.x, dy = p.y - this.joy.base.y;
      const len = Math.hypot(dx, dy);
      if (len > R) {
        // Joystick nổi: đế đi theo ngón tay khi kéo quá bán kính
        const k = (len - R) / len;
        this.joy.base = { x: this.joy.base.x + dx * k, y: this.joy.base.y + dy * k };
        dx = p.x - this.joy.base.x; dy = p.y - this.joy.base.y;
      }
      this.joy.knob = { x: this.joy.base.x + dx, y: this.joy.base.y + dy };
      return;
    }
    const press = this.presses.get(e.pointerId);
    if (press) {
      press.current = p;
      const aimable = press.button.kind === 'skill' || press.button.kind === 'attack';
      if (aimable && Math.hypot(p.x - press.origin.x, p.y - press.origin.y) > AIM_START_PX) press.aiming = true;
      press.overCancel = press.aiming && inRect(this.layout.cancelRect, p.x, p.y);
      return;
    }
    if (this.ring && this.ring.pointerId === e.pointerId) this.ring.angle = this.angleAt(p);
  }

  pointerUp(e: PointerEvent): void {
    if (this.joy && this.joy.pointerId === e.pointerId) { this.joy = null; return; }
    const press = this.presses.get(e.pointerId);
    if (press) {
      this.presses.delete(e.pointerId);
      this.release(press);
      return;
    }
    if (this.ring && this.ring.pointerId === e.pointerId) {
      let d = this.ring.angle - this.ring.startAngle;
      d = ((d + 540) % 360) - 180;                          // về khoảng (−180°, 180°]
      if (Math.abs(d) >= PAGE_SWIPE_DEG) this.page = (this.page + (d > 0 ? 1 : SKILL_PAGES - 1)) % SKILL_PAGES;
      this.ring = null;
    }
  }

  private release(p: Press): void {
    const b = p.button;
    if (b.kind === 'dodge') { this.pendingDodge = true; return; }
    if (b.kind === 'fly') { this.pendingFly = true; return; }
    if (p.overCancel) { this.pendingCancel = true; return; }
    const slot = b.kind === 'attack' ? 0 : 1 + this.page * SKILLS_PER_PAGE + b.index;
    if (!p.aiming) { this.pendingCasts.push({ slot }); return; }      // chạm nhanh: tự nhắm
    // Kéo để nhắm: hướng kéo trên màn hình -> hướng trong không gian ô, độ dài kéo -> tầm
    const dx = p.current.x - p.origin.x, dy = p.current.y - p.origin.y;
    const dir = screenDirToTileDir(dx, dy);
    const range = Math.hypot(dx, dy) * this.layout!.tilesPerPixel;
    const pos = this.player.position();
    this.pendingCasts.push({ slot, aimTile: { i: pos.i + dir.i * range, j: pos.j + dir.j * range } });
  }

  private angleAt(p: Vec2): number {
    const c = this.layout!.wheelCenter;
    return (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI;
  }

  update(frame: InputFrame): void {
    if (this.joy && this.layout) {
      const dx = this.joy.knob.x - this.joy.base.x, dy = this.joy.knob.y - this.joy.base.y;
      const m = Math.min(1, Math.hypot(dx, dy) / this.layout.joystickRadius);
      if (m > DEAD_ZONE) {
        const dir = screenDirToTileDir(dx, dy);
        frame.move = this.eightWay ? snap8(dir) : dir;
        frame.magnitude = (m - DEAD_ZONE) / (1 - DEAD_ZONE);
      }
    }
    for (const c of this.pendingCasts) frame.casts.push(c);
    this.pendingCasts = [];
    frame.dodge = this.pendingDodge;
    frame.flyToggle = this.pendingFly;
    frame.cancelCast = this.pendingCancel;
    this.pendingDodge = this.pendingFly = this.pendingCancel = false;
  }

  /** Trạng thái để renderer của engine vẽ Joystick và Skill Wheel. */
  visualState(): TouchVisualState | null {
    const L = this.layout;
    if (!L) return null;
    const pressedIds = new Set([...this.presses.values()].map((p) => JSON.stringify(p.button)));
    const isPressed = (b: ButtonId) => pressedIds.has(JSON.stringify(b));
    const buttons: TouchVisualState['buttons'] = [
      { id: 'attack', center: L.wheelCenter, radius: L.mainRadius, pressed: isPressed({ kind: 'attack' }), slot: 0 },
      ...this.skillCenters().map((c, k) => ({
        id: `skill-${k}`, center: c, radius: L.skillRadius,
        pressed: isPressed({ kind: 'skill', index: k }), slot: 1 + this.page * SKILLS_PER_PAGE + k,
      })),
      { id: 'dodge', center: L.dodgeButton, radius: L.smallRadius, pressed: isPressed({ kind: 'dodge' }), slot: null },
      { id: 'fly', center: L.flyButton, radius: L.smallRadius, pressed: isPressed({ kind: 'fly' }), slot: null },
    ];
    const aimPress = [...this.presses.values()].find((p) => p.aiming);
    return {
      joystick: this.joy ? { base: this.joy.base, knob: this.joy.knob, radius: L.joystickRadius } : null,
      page: this.page,
      buttons,
      aim: aimPress ? { from: aimPress.origin, to: aimPress.current, overCancel: aimPress.overCancel } : null,
      cancelVisible: !!aimPress,
    };
  }
}
