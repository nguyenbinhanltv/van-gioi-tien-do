import { Layers, Node, Vec3 } from 'cc';
import { shared } from './vendor/vgtd.mjs';

/**
 * THE ONLY Y-FLIP IN THE CLIENT.
 *
 * `@vgtd/shared` / `@vgtd/client-core` work in "logical screen" space: x right, y DOWN, px @1x
 * (tileToScreen etc.). Cocos 2D world space is y UP. Every conversion between the two goes through
 * this file; nothing else in client-cocos may negate a y coordinate.
 *
 *   shared screen (x, y↓)  <->  Cocos local (x, -y↑)
 */
export interface ScreenPoint {
  x: number;
  y: number;
}

/** shared screen point -> Cocos local position. */
export function screenToCocos(p: ScreenPoint, out: Vec3 = new Vec3(), z = 0): Vec3 {
  return out.set(p.x, -p.y, z);
}

/** Cocos local x / y -> shared screen point. */
export function cocosToScreen(x: number, y: number): ScreenPoint {
  return { x, y: -y };
}

/** Continuous tile position (entities, camera; NO +0.5: integer (i, j) is the N vertex, docs/21 §8) -> Cocos world. */
export function tileToWorld(i: number, j: number, elevation = 0, out: Vec3 = new Vec3()): Vec3 {
  return screenToCocos(shared.tileToScreen(i, j, elevation), out);
}

/** Exact inverse of tileToWorld: Cocos world (x, y up) -> continuous tile coord. */
export function worldToTile(x: number, y: number, elevation = 0): { i: number; j: number } {
  const p = cocosToScreen(x, y);
  return shared.screenToTile(p.x, p.y, elevation);
}

/** Centre of whole tile (i, j): only for per-cell sprites / overlays / markers (= tileToWorld(i + .5, j + .5)). */
export function cellCenterToWorld(i: number, j: number, elevation = 0, out: Vec3 = new Vec3()): Vec3 {
  return screenToCocos(shared.tileCenterToScreen(i, j, elevation), out);
}

/** World-root offset that puts a shared-screen point at the centre of the (fixed) Canvas camera. */
export function cameraOffset(target: ScreenPoint, zoom: number, out: Vec3 = new Vec3()): Vec3 {
  const p = screenToCocos(target);
  return out.set(Math.round(-p.x * zoom), Math.round(-p.y * zoom), 0);
}

/** L3 draw-order key of a point entity (ground Y of its pivot; jump height ignored). */
export function pointSortable(id: number, group: number, i: number, j: number) {
  return { id, group, sortY: shared.pivotSortY(i, j), x: shared.tileToScreen(i, j).x };
}

/** L3 draw-order key of a w x h footprint object whose N-corner tile is (i0, j0). */
export function footprintSortable(id: number, group: number, i0: number, j0: number, w = 1, h = 1) {
  return { id, group, sortY: shared.footprintSortY(i0, j0, w, h), x: shared.tileToScreen(i0 + w / 2, j0 + h / 2).x };
}

/** New 2D-visible node (code-built nodes must be put on the UI_2D layer to be seen by the Canvas camera). */
export function newNode(name: string, parent: Node | null = null): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  if (parent) parent.addChild(n);
  return n;
}
