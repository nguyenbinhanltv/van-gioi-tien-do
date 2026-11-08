import { Node, UITransform, game } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { cameraOffset, clientToCocosUi, cocosToScreen, type ScreenPoint } from './IsoAdapter';

/**
 * Camera follow + zoom + client->world conversion.
 *
 * The Canvas camera stays fixed; the world root is translated (and scaled by `zoom`) so the target
 * sits at the centre of the screen. Implements client-core's `CameraLike`, i.e. returns
 * shared "logical screen" coordinates (y DOWN) - the y-flip happens in IsoAdapter only.
 * Zoom (D79) belongs to a client-core `ZoomController` (wheel / pinch / `?zoom=`) that smooths it; the HUD canvas is
 * never scaled, only `worldRoot`.
 *
 * SEAM: client-world will own streaming windows; it only needs `follow()` each frame.
 */
export class CameraRig {
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

  /** Advance the zoom lerp by `dt` and centre the camera on a shared-screen point (offset on the device px grid). */
  follow(target: ScreenPoint, dt = 0): void {
    const z = this.zoomCtl.update(dt);
    this.worldRoot.setScale(z, z, 1);
    this.worldRoot.setPosition(cameraOffset(target, z, this.pxPerUnit()));
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
