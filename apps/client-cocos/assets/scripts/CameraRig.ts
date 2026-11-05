import { Node, UITransform, game } from 'cc';
import { cameraOffset, clientToCocosUi, cocosToScreen, type ScreenPoint } from './IsoAdapter';

/**
 * Camera follow + client->world conversion.
 *
 * The Canvas camera stays fixed; the world root is translated (and scaled by `zoom`) so the target
 * sits at the centre of the screen. Implements client-core's `CameraLike`, i.e. returns
 * shared "logical screen" coordinates (y DOWN) - the y-flip happens in IsoAdapter only.
 *
 * SEAM: client-world will own streaming windows; it only needs `follow()` each frame.
 */
export class CameraRig {
  zoom = 1;

  constructor(
    private readonly worldRoot: Node,
    private readonly canvas: UITransform,
  ) {}

  /** Centre the camera on a shared-screen point. Offset is rounded to whole px (no sub-pixel shimmer). */
  follow(target: ScreenPoint): void {
    this.worldRoot.setScale(this.zoom, this.zoom, 1);
    this.worldRoot.setPosition(cameraOffset(target, this.zoom));
  }

  /** Browser client px -> UI-space (Canvas-local, y up) design units. */
  clientToUi(clientX: number, clientY: number): { x: number; y: number } {
    return clientToCocosUi(clientX, clientY, game.canvas!.getBoundingClientRect(), this.canvas.contentSize);
  }

  /** client-core CameraLike: client px -> shared logical screen coords (y down), 1x world px. */
  clientToWorld(clientX: number, clientY: number): ScreenPoint {
    const ui = this.clientToUi(clientX, clientY);
    const wp = this.worldRoot.position;
    return cocosToScreen((ui.x - wp.x) / this.zoom, (ui.y - wp.y) / this.zoom);
  }
}
