import { Color, Graphics, Node, Vec3 } from 'cc';
import { sim } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';

/** The slice of client-core's `TelegraphView` this layer draws (tile space; D87). */
export interface TelegraphShapeView {
  id: number;
  shape: 'circle' | 'cone' | 'line';
  i: number;
  j: number;
  facing: number;
  size: number;
  angleDeg: number;
  width: number;
  progress: number;
}

const OUTLINE = new Color(255, 70, 50, 230);
const FILL = new Color(255, 60, 40, 110);
const EDGE_STEPS = 24;

/**
 * Mob attack danger areas as ground decals (D87): a red outline of the locked shape plus a fill that grows from the origin to the
 * full shape over the telegraph time. Placeholder art (one `Graphics`, redrawn every frame; no sprites). The shape is built in
 * TILE space and projected point by point through `tileToWorld`, the client's only y-flip, so it lies correctly on the iso ground.
 */
export class TelegraphLayer {
  private readonly node: Node;
  private readonly g: Graphics;
  private readonly tmp = new Vec3();

  constructor(parent: Node) {
    this.node = newNode('Telegraphs', parent);
    this.g = this.node.addComponent(Graphics);
    this.g.lineWidth = 2;
  }

  /** Redraw `views` (an empty list clears the decals). Call once per frame. */
  update(views: readonly TelegraphShapeView[]): void {
    const g = this.g;
    g.clear();
    for (const v of views) {
      this.drawShape(v, 1, false);
      if (v.progress > 0.02) this.drawShape(v, v.progress, true);
    }
  }

  destroy(): void {
    this.g.clear();
    this.node.destroy();
  }

  private drawShape(v: TelegraphShapeView, scale: number, fill: boolean): void {
    const g = this.g;
    const pts = this.outline(v, scale);
    if (pts.length < 3) return;
    for (let k = 0; k < pts.length; k++) {
      const p = tileToWorld(pts[k]!.i, pts[k]!.j, 0, this.tmp);
      if (k === 0) g.moveTo(p.x, p.y);
      else g.lineTo(p.x, p.y);
    }
    g.close();
    if (fill) {
      g.fillColor = FILL;
      g.fill();
    } else {
      g.strokeColor = OUTLINE;
      g.stroke();
    }
  }

  /** Polygon of the shape in tile space; `scale` shrinks it toward its origin (circle: toward the centre) for the growing fill. */
  private outline(v: TelegraphShapeView, scale: number): { i: number; j: number }[] {
    const out: { i: number; j: number }[] = [];
    const code = v.facing >= 0 && v.facing < sim.DIR_CODES ? v.facing : 0;
    const fi = sim.DIR_COS[code]!;
    const fj = sim.DIR_SIN[code]!;
    if (v.shape === 'circle') {
      const r = v.size * scale;
      for (let k = 0; k < EDGE_STEPS; k++) {
        const a = (k / EDGE_STEPS) * Math.PI * 2;
        out.push({ i: v.i + Math.cos(a) * r, j: v.j + Math.sin(a) * r });
      }
    } else if (v.shape === 'cone') {
      const r = v.size * scale;
      const half = (v.angleDeg / 2) * (Math.PI / 180);
      out.push({ i: v.i, j: v.j });
      const steps = Math.max(4, Math.ceil((EDGE_STEPS * v.angleDeg) / 360));
      for (let k = 0; k <= steps; k++) {
        const a = -half + (2 * half * k) / steps;
        const c = Math.cos(a);
        const s = Math.sin(a);
        out.push({ i: v.i + (fi * c - fj * s) * r, j: v.j + (fi * s + fj * c) * r });
      }
    } else {
      const len = v.size * scale;
      const hw = v.width / 2;
      const ni = -fj;
      const nj = fi;
      out.push(
        { i: v.i + ni * hw, j: v.j + nj * hw },
        { i: v.i + fi * len + ni * hw, j: v.j + fj * len + nj * hw },
        { i: v.i + fi * len - ni * hw, j: v.j + fj * len - nj * hw },
        { i: v.i - ni * hw, j: v.j - nj * hw },
      );
    }
    return out;
  }
}
