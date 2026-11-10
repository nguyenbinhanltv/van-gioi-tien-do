import { Node, UITransform, game } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { CameraFilter } from './Smoothing';
import { cameraOffset, clientToCocosUi, cocosToScreen, type ScreenPoint } from './IsoAdapter';

/**
 * Camera follow + zoom + client->world conversion.
 *
 * The Canvas camera stays fixed; the world root is translated (and scaled by `zoom`) so the target
 * sits at the centre of the screen. Implements client-core's `CameraLike`, i.e. returns
 * shared "logical screen" coordinates (y DOWN) - the y-flip happens in IsoAdapter only.
 * Zoom (D81) belongs to a client-core `ZoomController` (wheel / pinch / `?zoom=`) that smooths it; the HUD canvas is
 * never scaled, only `worldRoot`.
 *
 * SEAM: client-world will own streaming windows; it only needs `follow()` each frame.
 */
export class CameraRig {
  /**
   * Follow filter (shared screen px, 1x world): ~0.1 s exponential damping, a 2 px dead-zone, and an instant snap beyond 480 px
   * (teleport / zone change / respawn). Feeds the interpolated render position, never the raw 20 Hz authoritative one.
   */
  private readonly filter = new CameraFilter(
    CameraRig.FOLLOW_TAU_SEC,
    CameraRig.DEAD_ZONE_PX,
    CameraRig.SNAP_DISTANCE_PX,
  );
  /** A/B switch (`?rawfollow=1`): hard-set the camera onto the target like before the smoothing fix. */
  static rawFollow = false;
  static readonly FOLLOW_TAU_SEC = 0.1;
  static readonly DEAD_ZONE_PX = 2;
  static readonly SNAP_DISTANCE_PX = 480;

  constructor(
    private readonly worldRoot: Node,
    private readonly canvas: UITransform,
    readonly zoomCtl: InstanceType<typeof core.ZoomController>,
  ) {}

  /** Smoothed zoom actually applied this frame. */
  get zoom(): number {
    return this.zoomCtl.current;
  }

  /** Smaller of current and target zoom = the biggest world area that is or is about to be visible (streaming). */
  get streamZoom(): number {
    return Math.min(this.zoomCtl.current, this.zoomCtl.target);
  }

  /** Device px per design unit (canvas backing store / design width); 1 when unknown. */
  private pxPerUnit(): number {
    const w = this.canvas.contentSize.width;
    const cw = game.canvas?.width ?? 0;
    return w > 0 && cw > 0 ? cw / w : 1;
  }

  /** Where the camera is centred now (shared screen px); lags the follow target by the damping. */
  get center(): ScreenPoint {
    return this.filter.position;
  }

  /** Jump onto a shared-screen point without easing (scene rebuild, teleport the caller already knows about). */
  snap(target: ScreenPoint): void {
    this.filter.snap(target);
    this.follow(target, 0);
  }

  /**
   * Advance the zoom lerp and the damped follow by `dt` seconds, then place the world root. Only the final offset is snapped to
   * the device px grid, so the smoothed motion is not quantised before it is drawn.
   */
  follow(target: ScreenPoint, dt = 0): void {
    const z = this.zoomCtl.update(dt);
    const c = CameraRig.rawFollow ? (this.filter.snap(target), target) : this.filter.update(target, dt);
    this.worldRoot.setScale(z, z, 1);
    this.worldRoot.setPosition(cameraOffset(c, z, this.pxPerUnit()));
  }

  /** Browser client px -> UI-space (Canvas-local, y up) design units. */
  clientToUi(clientX: number, clientY: number): { x: number; y: number } {
    return clientToCocosUi(clientX, clientY, game.canvas!.getBoundingClientRect(), this.canvas.contentSize);
  }

  /** client-core CameraLike: client px -> shared logical screen coords (y down), 1x world px (inverse of follow()). */
  clientToWorld(clientX: number, clientY: number): ScreenPoint {
    const ui = this.clientToUi(clientX, clientY);
    const wp = this.worldRoot.position;
    return cocosToScreen(core.viewToWorldAxis(ui.x, wp.x, this.zoom), core.viewToWorldAxis(ui.y, wp.y, this.zoom));
  }
}
