/**
 * Engine-free decision of the L3 culling (YSortLayer.cull): which Y-sorted nodes are far enough outside the view to be parked.
 * Everything in shared screen px (y down, 1x world px), the same space as `cameraRect()`.
 */
export interface ViewRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Default reach of a Y-sorted node (px its art extends above / beside its foot): it stays visible while that much of it can be on screen. */
export const CULL_MARGIN = 340;
/** Reach of a chibi body (~90 px tall at CHIBI_SCALE, a little more for a weapon / aura). Mobs and props pass their own measured size. */
export const CHIBI_REACH = 120;
/** Extra margin before a visible node is parked: a node on the edge must not flip every frame. */
export const CULL_HYSTERESIS = 80;

/** Is a node at `p` inside the view inflated by `margin`? */
export function insideView(p: { x: number; y: number }, view: ViewRect, margin: number): boolean {
  return (
    p.x >= view.x - margin &&
    p.x <= view.x + view.width + margin &&
    p.y >= view.y - margin &&
    p.y <= view.y + view.height + margin
  );
}

/**
 * Should the node be culled after this frame? A visible node is parked only beyond margin + hysteresis; a parked one comes back as
 * soon as it is within the margin.
 */
export function shouldCull(
  p: { x: number; y: number },
  view: ViewRect,
  wasCulled: boolean,
  margin = CULL_MARGIN,
): boolean {
  return !insideView(p, view, wasCulled ? margin : margin + CULL_HYSTERESIS);
}
