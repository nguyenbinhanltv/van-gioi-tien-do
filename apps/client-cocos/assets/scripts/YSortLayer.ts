import { Node } from 'cc';
import { newNode } from './IsoAdapter';

interface Entry {
  node: Node;
  /** Painter depth (see depthOf): larger = drawn later (on top). */
  depth: () => number;
}

/**
 * L3: the only layer sorted against the player / props (Asset Matrix §Y-sort). Cocos 2D draws
 * siblings in child order, so sorting = reordering children by depth. Reorders only when the order
 * actually changes (cheap for <= 300 objects).
 */
export class YSortLayer {
  readonly root: Node;
  private entries: Entry[] = [];
  private order: Node[] = [];

  constructor(parent: Node) {
    this.root = newNode('L3_YSort', parent);
  }

  add(node: Node, depth: () => number): void {
    this.root.addChild(node);
    this.entries.push({ node, depth });
  }

  get count(): number {
    return this.entries.length;
  }

  sort(): void {
    const keyed = this.entries.map((e) => ({ e, k: e.depth() }));
    keyed.sort((a, b) => a.k - b.k);
    for (let idx = 0; idx < keyed.length; idx++) {
      const node = keyed[idx].e.node;
      if (this.order[idx] !== node) {
        node.setSiblingIndex(idx);
        this.order[idx] = node;
      }
    }
  }
}
