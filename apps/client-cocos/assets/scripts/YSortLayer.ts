import { Node } from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { cocosToScreen, newNode } from './IsoAdapter';
import { CULL_MARGIN, shouldCull, type ViewRect } from './CullMath';

interface Entry {
  node: Node;
  /** Draw-order key, re-read every frame (see shared compareDrawOrder: group, sortY, x, id). */
  key: () => shared.Sortable;
  /** how far (1x px) the node's art reaches from its foot: the culling margin */
  reach: number;
}

/**
 * L3: the only layer sorted against the player / props (Asset Matrix §Y-sort). Cocos 2D draws
 * siblings in child order, so sorting = reordering children by depth. Reorders only when the order
 * actually changes (cheap for <= 300 objects).
 */
export class YSortLayer {
  readonly root: Node;
  private entries: Entry[] = [];
  /** inactive parking node for entries far outside the view (their draw calls and batch breaks disappear) */
  private readonly stash: Node;
  private readonly culled = new Set<Node>();

  constructor(parent: Node) {
    this.root = newNode('L3_YSort', parent);
    this.stash = newNode('L3_Culled', parent);
    this.stash.active = false;
  }

  /** `reach` = how far the art extends from the foot point in 1x px (culling margin); the default fits props up to a pine tree. */
  add(node: Node, key: () => shared.Sortable, reach: number = CULL_MARGIN): void {
    this.root.addChild(node);
    this.entries.push({ node, key, reach });
  }

  remove(node: Node): void {
    const k = this.entries.findIndex((e) => e.node === node);
    if (k >= 0) this.entries.splice(k, 1);
    this.culled.delete(node);
  }

  get count(): number {
    return this.entries.length;
  }

  /** Entries currently drawn (not parked outside the view). */
  get visibleCount(): number {
    return this.entries.length - this.culled.size;
  }

  /**
   * Park the entries outside `view` (shared screen px, y down) under an inactive node and bring them back when they re-enter: every
   * armature / sprite outside the screen otherwise costs draw calls and splits the batches around it. Parked nodes keep their state
   * (animations pause while inactive). Call once per frame before `sort()`. Returns how many entries are parked.
   */
  cull(view: ViewRect): number {
    for (const e of this.entries) {
      const p = cocosToScreen(e.node.position.x, e.node.position.y);
      const was = this.culled.has(e.node);
      const now = shouldCull(p, view, was, e.reach);
      if (now === was) continue;
      e.node.setParent(now ? this.stash : this.root);
      if (now) this.culled.add(e.node);
      else this.culled.delete(e.node);
    }
    return this.culled.size;
  }

  sort(): void {
    const keyed = this.entries.filter((e) => !this.culled.has(e.node)).map((e) => ({ e, k: e.key() }));
    keyed.sort((a, b) => shared.compareDrawOrder(a.k, b.k));
    for (let idx = 0; idx < keyed.length; idx++) {
      const node = keyed[idx].e.node;
      if (this.root.children[idx] !== node) node.setSiblingIndex(idx);
    }
  }
}
