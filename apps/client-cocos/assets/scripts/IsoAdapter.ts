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

/** Continuous tile coord (i, j) (+ optional elevation levels) -> Cocos local position. */
export function tileToCocos(i: number, j: number, elevation = 0, out: Vec3 = new Vec3()): Vec3 {
  return screenToCocos(shared.tileToScreen(i, j, elevation), out);
}

/** Painter's-algorithm depth of a tile-space foot position (larger = nearer the viewer = drawn later). */
export function depthOf(i: number, j: number): number {
  return i + j;
}

/** New 2D-visible node (code-built nodes must be put on the UI_2D layer to be seen by the Canvas camera). */
export function newNode(name: string, parent: Node | null = null): Node {
  const n = new Node(name);
  n.layer = Layers.Enum.UI_2D;
  if (parent) parent.addChild(n);
  return n;
}
