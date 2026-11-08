import { Node } from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';

interface Entry {
  node: Node;
  /** Draw-order key, re-read every frame (see shared compareDrawOrder: group, sortY, x, id). */
  key: () => shared.Sortable;
}

/**
 * L3: the only layer sorted against the player / props (Asset Matrix §Y-sort). Cocos 2D draws
 * siblings in child order, so sorting = reordering children by depth. Reorders only when the order
 * actually changes (cheap for <= 300 objects).
 */
export class YSortLayer {
  readonly root: Node;
  private entries: Entry[] = [];

  constructor(parent: Node) {
    this.root = newNode('L3_YSort', parent);
  }

  add(node: Node, key: () => shared.Sortable): void {
    this.root.addChild(node);
    this.entries.push({ node, key });
  }

  /** Unregister and destroy an object (an enemy that left the AOI). */
  remove(node: Node): void {
    const k = this.entries.findIndex((e) => e.node === node);
    if (k >= 0) this.entries.splice(k, 1);
    node.destroy();
  }

  get count(): number {
    return this.entries.length;
  }

  sort(): void {
    const keyed = this.entries.map((e) => ({ e, k: e.key() }));
    keyed.sort((a, b) => shared.compareDrawOrder(a.k, b.k));
    for (let idx = 0; idx < keyed.length; idx++) {
      const node = keyed[idx].e.node;
      if (this.root.children[idx] !== node) node.setSiblingIndex(idx);
    }
  }
}
