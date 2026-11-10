import { TilePos, screenToTile, screenDirToTileDir, tileOf } from '../core/IsoMath.js';
import { IsoPathfinder } from './IsoPathfinder.js';
import { CameraLike, InputFrame, PlayerLocator } from './types.js';

/**
 * Điều khiển PC:
 *  - Chuột trái vào đất: tìm đường A* trên lưới ô rồi đi theo; giữ chuột thì liên tục
 *    tìm lại đường tới con trỏ (tối đa mỗi 150 ms). Click lên thực thể thì chọn mục tiêu.
 *  - Phím 1–6: thi triển kỹ năng ô 1–6, nhắm vào vị trí chuột.
 *  - Space: né theo hướng đang đi (đứng yên thì né về phía chuột).
 *  - WASD: đi trực tiếp (hủy đường A*); Shift giữ = khinh công; F = bật / tắt ngự kiếm.
 */
export class PointerController {
  private path: TilePos[] | null = null;
  private holding = false;
  private lastRepath = 0;
  private mouseWorld: TilePos | null = null;
  private keys = new Set<string>();
  private pendingCasts: number[] = [];
  private pendingDodge = false;
  private pendingFly = false;
  private pendingTarget: number | null = null;

  /** Khoảng cách coi như đã tới một điểm của đường (ô). */
  arriveRadius = 0.2;
  repathIntervalMs = 150;

  constructor(
    private readonly camera: CameraLike,
    private readonly player: PlayerLocator,
    private readonly finder: IsoPathfinder,
    private readonly pickEntity?: (world: TilePos) => number | null,
  ) {}

  /** Walks `path` as if the player had clicked its end (quest guidance, D125); WASD or a new click cancels it. */
  followPath(path: TilePos[] | null): void {
    this.holding = false;
    this.path = path && path.length > 0 ? path.map((p) => ({ ...p })) : null;
  }

  /** True while a click-to-move / guided path is being walked. */
  get walking(): boolean {
    return this.path !== null;
  }

  reset(): void {
    this.path = null;
    this.holding = false;
    this.keys.clear();
    this.pendingCasts = [];
    this.pendingDodge = this.pendingFly = false;
  }

  private toWorld(e: PointerEvent): TilePos {
    return screenToTile(this.camera.clientToWorld(e.clientX, e.clientY));
  }

  pointerDown(e: PointerEvent): void {
    this.mouseWorld = this.toWorld(e);
    if (e.button !== 0) return;
    const hit = this.pickEntity?.(this.mouseWorld) ?? null;
    if (hit !== null) {
      this.pendingTarget = hit;
      return;
    }
    this.holding = true;
    this.repath(performance.now(), true);
  }

  pointerMove(e: PointerEvent): void {
    this.mouseWorld = this.toWorld(e);
    if (this.holding) this.repath(performance.now(), false);
  }

  pointerUp(e: PointerEvent): void {
    if (e.button === 0) this.holding = false;
  }

  private repath(now: number, force: boolean): void {
    if (!this.mouseWorld) return;
    if (!force && now - this.lastRepath < this.repathIntervalMs) return;
    this.lastRepath = now;
    this.path = this.finder.findPath(tileOf(this.player.position()), tileOf(this.mouseWorld));
  }

  /** Trả về true nếu phím được dùng (để InputManager chặn hành vi mặc định của trình duyệt). */
  key(e: KeyboardEvent, down: boolean): boolean {
    const c = e.code;
    if (down) {
      if (/^Digit[1-6]$/.test(c) && !e.repeat) {
        this.pendingCasts.push(Number(c.slice(5)));
        return true;
      }
      if (c === 'Space' && !e.repeat) {
        this.pendingDodge = true;
        return true;
      }
      if (c === 'KeyF' && !e.repeat) {
        this.pendingFly = true;
        return true;
      }
    }
    if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ShiftLeft', 'ShiftRight'].includes(c)) {
      if (down) this.keys.add(c);
      else this.keys.delete(c);
      if (down && c.startsWith('Key')) this.path = null; // WASD hủy click-to-move
      return true;
    }
    return false;
  }

  update(frame: InputFrame): void {
    const pos = this.player.position();

    // 1. WASD: hướng trên màn hình (W = lên) -> không gian ô
    const sx = (this.keys.has('KeyD') ? 1 : 0) - (this.keys.has('KeyA') ? 1 : 0);
    const sy = (this.keys.has('KeyS') ? 1 : 0) - (this.keys.has('KeyW') ? 1 : 0);
    if (sx !== 0 || sy !== 0) {
      frame.move = screenDirToTileDir(sx, sy);
      frame.magnitude = 1;
    } else if (this.path && this.path.length > 0) {
      // 2. Đi theo đường A*: bỏ các điểm đã tới, hướng về điểm kế tiếp
      while (this.path.length > 0 && Math.hypot(this.path[0].i - pos.i, this.path[0].j - pos.j) < this.arriveRadius) {
        this.path.shift();
      }
      if (this.path.length === 0) this.path = null;
      else {
        const di = this.path[0].i - pos.i,
          dj = this.path[0].j - pos.j;
        const len = Math.hypot(di, dj);
        frame.move = { i: di / len, j: dj / len };
        frame.magnitude = 1;
      }
    }
    frame.path = this.path;
    frame.qinggong = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');

    // 3. Kỹ năng nhắm theo chuột
    for (const slot of this.pendingCasts) frame.casts.push({ slot, aimTile: this.mouseWorld ?? undefined });
    this.pendingCasts = [];

    // 4. Né: theo hướng đang đi, nếu đứng yên thì về phía chuột
    if (this.pendingDodge) {
      frame.dodge = true;
      if (frame.magnitude === 0 && this.mouseWorld) {
        const di = this.mouseWorld.i - pos.i,
          dj = this.mouseWorld.j - pos.j;
        const len = Math.hypot(di, dj) || 1;
        frame.move = { i: di / len, j: dj / len };
        frame.magnitude = 1;
      }
      this.pendingDodge = false;
    }
    frame.flyToggle = this.pendingFly;
    this.pendingFly = false;
    if (this.pendingTarget !== null) {
      frame.target = this.pendingTarget;
      this.pendingTarget = null;
    }
  }
}
