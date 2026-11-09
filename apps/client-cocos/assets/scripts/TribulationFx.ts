import { Color, Graphics, Label, Node, Sprite, UITransform } from 'cc';
import { core, shared } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import { worldUiLayer } from './OverheadBar';

interface Bolt {
  /** ground point (world px) and the points of the main stroke + two branches, from the sky down */
  points: Array<{ x: number; y: number }>;
  branches: Array<Array<{ x: number; y: number }>>;
  atMs: number;
}

const BOLT_LIFE_MS = 650;
const FLASH_MS = 320;

/** A tiny deterministic generator for the shape of one bolt (so a bolt does not flicker between frames). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Tâm Ma / Lôi Kiếp presentation (D97), procedural only (no art): the overlay tint + headline + result card from client-core's
 * `MajorEventView`, and lightning bolts (jagged polylines with a glow, branches and a white screen flash) where the server says a bolt hit.
 * The server decides everything; this only draws what `major_event` / `tribulation_strike` say. The warning decal before each bolt is the
 * ordinary telegraph layer (D89).
 */
export class TribulationFx {
  readonly view: InstanceType<typeof core.MajorEventView>;
  private readonly root: Node;
  private readonly tint: Sprite;
  private readonly flash: Sprite;
  private readonly title: Label;
  private readonly card: Label;
  private readonly bolts: Bolt[] = [];
  private readonly g: Graphics;
  private clock = 0;
  private flashAt = -1e9;

  constructor(hudParent: Node, worldRoot: Node, art: ArtFrames, net: InstanceType<typeof core.NetClient>) {
    this.view = new core.MajorEventView(() => this.clock);
    this.root = newNode('TribulationFx', hudParent);
    const mkQuad = (name: string, color: Color): Sprite => {
      const n = newNode(name, this.root);
      n.addComponent(UITransform).setContentSize(4000, 4000);
      const sp = n.addComponent(Sprite);
      sp.sizeMode = Sprite.SizeMode.CUSTOM;
      sp.spriteFrame = art.pixel;
      sp.color = color;
      n.active = false;
      return sp;
    };
    this.tint = mkQuad('Tint', new Color(80, 30, 120, 0));
    this.flash = mkQuad('Flash', new Color(255, 255, 255, 0));
    const mkLabel = (name: string, size: number, color: Color): Label => {
      const n = newNode(name, this.root);
      n.addComponent(UITransform);
      const l = n.addComponent(Label);
      l.fontSize = size;
      l.lineHeight = size + 6;
      l.horizontalAlign = Label.HorizontalAlign.CENTER;
      l.verticalAlign = Label.VerticalAlign.CENTER;
      l.overflow = Label.Overflow.NONE;
      l.color = color;
      n.active = false;
      return l;
    };
    this.title = mkLabel('Title', 30, new Color(235, 220, 255, 255));
    this.card = mkLabel('Card', 28, new Color(255, 240, 200, 255));
    const gn = newNode('Lightning', worldUiLayer(worldRoot));
    gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);
    // a reconnect drops whatever the old connection never finished (a lost final `major_event` would leave the tint up forever);
    // a resumed server re-sends the live event next tick. `attachCombat` spreads `net.events`, so this survives it.
    net.events = { ...net.events, onReconnect: this.view.chainReconnect(net.events.onReconnect?.bind(net.events)) };
    net.majorEvents = {
      onMajorEvent: (m) => this.view.apply(m),
      onTribulationStrike: (m) => {
        this.view.applyStrike(m);
        this.addBolt(m.qi, m.qj, m.wave * 31 + m.strike * 7 + m.damage);
      },
    };
    // automation hook (scripts/major-vfx-smoke.mjs): feed server-shaped messages without a server, read what is drawn
    (globalThis as unknown as Record<string, unknown>).__vgtdMajor = {
      event: (m: Parameters<typeof this.view.apply>[0]) => this.view.apply(m),
      strike: (m: { wave: number; waves: number; strike: number; qi: number; qj: number; damage: number }) => {
        this.view.applyStrike({ type: 'tribulation_strike', ...m });
        this.addBolt(m.qi, m.qj, m.wave * 31 + m.strike * 7 + m.damage);
      },
      state: () => ({
        active: this.view.active,
        title: this.title.string,
        titleShown: this.title.node.active,
        card: this.card.string,
        cardShown: this.card.node.active,
        bolts: this.bolts.length,
        tint: this.tint.node.active,
      }),
    };
  }

  /** Keep the overlay centred on the HUD canvas. */
  layout(_canvasW: number, canvasH: number): void {
    this.title.node.setPosition(0, canvasH / 2 - 90, 0);
    this.card.node.setPosition(0, 40, 0);
  }

  private addBolt(qi: number, qj: number, seed: number): void {
    const ground = tileToWorld(core.dequantizePos(qi), core.dequantizePos(qj));
    const rnd = lcg(seed);
    const top = { x: ground.x + (rnd() - 0.5) * 160, y: ground.y + 520 };
    const stroke = (from: { x: number; y: number }, to: { x: number; y: number }, steps: number, jitter: number) => {
      const pts = [from];
      for (let k = 1; k < steps; k++) {
        const t = k / steps;
        pts.push({
          x: from.x + (to.x - from.x) * t + (rnd() - 0.5) * jitter * (1 - t * 0.4),
          y: from.y + (to.y - from.y) * t + (rnd() - 0.5) * jitter * 0.3,
        });
      }
      pts.push(to);
      return pts;
    };
    const points = stroke(top, { x: ground.x, y: ground.y }, 12, 90);
    const branches = [3, 6].map((k) => {
      const b = points[k]!;
      return stroke(b, { x: b.x + (rnd() - 0.5) * 260, y: b.y - 120 - rnd() * 120 }, 4, 50);
    });
    this.bolts.push({ points, branches, atMs: this.clock });
    this.flashAt = this.clock;
  }

  /** Per frame (dt in seconds). */
  update(dt: number): void {
    this.clock += dt * 1000;
    const cur = this.view.current();
    const card = this.view.resultCard();
    // tint: purple for the Tâm Ma, dark blue-grey for the Kiếp, a slow pulse; nothing otherwise
    this.tint.node.active = !!cur;
    if (cur) {
      const pulse = 0.5 + 0.5 * Math.sin(this.clock / 350);
      const kiep = cur.phase === shared.MajorPhase.Tribulation;
      this.tint.color = kiep
        ? new Color(15, 20, 50, Math.round(125 + 30 * pulse))
        : new Color(90, 25, 140, Math.round(95 + 40 * pulse));
    }
    this.title.node.active = !!cur;
    if (cur) this.title.string = this.view.title();
    this.card.node.active = !!card;
    if (card) {
      this.card.string = card.lines.join('\n');
      this.card.color = card.tone === 'good' ? new Color(170, 255, 190, 255) : new Color(255, 190, 170, 255);
    }
    // lightning
    const g = this.g;
    g.clear();
    for (let k = this.bolts.length - 1; k >= 0; k--)
      if (this.clock - this.bolts[k]!.atMs > BOLT_LIFE_MS) this.bolts.splice(k, 1);
    for (const b of this.bolts) {
      const a = 1 - (this.clock - b.atMs) / BOLT_LIFE_MS;
      const line = (pts: Array<{ x: number; y: number }>, w: number, c: Color) => {
        g.lineWidth = w;
        g.strokeColor = c;
        g.moveTo(pts[0]!.x, pts[0]!.y);
        for (let i = 1; i < pts.length; i++) g.lineTo(pts[i]!.x, pts[i]!.y);
        g.stroke();
      };
      line(b.points, 14, new Color(90, 140, 255, Math.round(60 * a)));
      for (const br of b.branches) line(br, 8, new Color(90, 140, 255, Math.round(50 * a)));
      line(b.points, 6, new Color(170, 200, 255, Math.round(170 * a)));
      for (const br of b.branches) line(br, 3, new Color(190, 215, 255, Math.round(150 * a)));
      line(b.points, 2.5, new Color(255, 255, 255, Math.round(255 * a)));
    }
    // screen flash on a hit
    const f = 1 - (this.clock - this.flashAt) / FLASH_MS;
    this.flash.node.active = f > 0;
    if (f > 0) this.flash.color = new Color(235, 240, 255, Math.round(150 * f));
  }

  destroy(): void {
    this.root.destroy();
    this.g.node.destroy();
  }
}
