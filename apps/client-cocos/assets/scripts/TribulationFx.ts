import { Color, Graphics, Label, Node, Sprite, UIOpacity, UITransform, Vec3 } from 'cc';
import { core, shared } from './vendor/vgtd.mjs';
import { newNode, tileToWorld } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import { worldUiLayer } from './OverheadBar';
import { getFxFrame, getFxInfo, preloadFx } from './PropArt';

interface Bolt {
  /** ground point (world px) and the points of the main stroke + two branches, from the sky down */
  points: Array<{ x: number; y: number }>;
  branches: Array<Array<{ x: number; y: number }>>;
  atMs: number;
}

const BOLT_LIFE_MS = 650;
const FLASH_MS = 320;
/** the strike texture is drawn this much bigger than its @1x size (the old procedural bolt was ~520 px tall; the texture is 384 px) */
const STRIKE_SCALE = 1.4;
const SCORCH_LIFE_MS = 5000;
const CLOUD_SCALE = 1.5;
/** px above the player's feet where the storm cloud hovers */
const CLOUD_LIFT = 300;

/** A sprite that lives for a while and fades out (bolt texture, scorch mark). */
interface FadeSprite {
  node: Node;
  opacity: UIOpacity;
  atMs: number;
  lifeMs: number;
  /** peak opacity 0..255 and the exponent of the fade curve */
  peak: number;
  curve: number;
}

/** A tiny deterministic generator for the shape of one bolt (so a bolt does not flicker between frames). */
function lcg(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Tâm Ma / Lôi Kiếp presentation (D97): the overlay tint + headline + result card from client-core's `MajorEventView`, and where the server says
 * a bolt hit: the owner's lightning texture (PART 3 R) with a scorch mark that fades, a white screen flash, and a storm cloud hovering above the
 * player while the Kiếp lasts. The warning before each bolt (and each Tâm Ma shadow attack) is a ground decal sprite in place of the red D89
 * telegraph circle. All of it needs the lazy effect page (`preloadFx`, started with the first `major_event`); until it has loaded, or when the art
 * was not generated, the procedural jagged-polyline bolt and the ordinary telegraph circle are drawn instead. The server decides everything;
 * this only draws what `major_event` / `tribulation_strike` / `telegraph_start` say.
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
  /** ground decals (warning, scorch) go under the actors, like the telegraph layer; the cloud and the bolts above them */
  private readonly decalLayer: Node;
  private readonly worldLayer: Node;
  private readonly sprites: FadeSprite[] = [];
  private readonly warnings = new Map<number, { node: Node; opacity: UIOpacity }>();
  private cloud: { node: Node; opacity: UIOpacity } | null = null;
  /** automation only (`__vgtdMajor.warning`): a fake live major-event telegraph so the decal can be captured without a Lôi Kiếp running */
  private demoTelegraphs: Array<{ id: number; i: number; j: number; size: number; progress: number; shape: 'circle' }> =
    [];
  private readonly tmpA = new Vec3();
  private readonly tmpB = new Vec3();
  private clock = 0;
  private flashAt = -1e9;

  constructor(
    hudParent: Node,
    worldRoot: Node,
    art: ArtFrames,
    private readonly net: InstanceType<typeof core.NetClient>,
  ) {
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
    this.worldLayer = worldUiLayer(worldRoot);
    this.decalLayer = worldRoot.getChildByName('L2_Shadow') ?? this.worldLayer;
    const gn = newNode('Lightning', this.worldLayer);
    gn.addComponent(UITransform);
    this.g = gn.addComponent(Graphics);
    // a reconnect drops whatever the old connection never finished (a lost final `major_event` would leave the tint up forever);
    // a resumed server re-sends the live event next tick. `attachCombat` spreads `net.events`, so this survives it.
    net.events = { ...net.events, onReconnect: this.view.chainReconnect(net.events.onReconnect?.bind(net.events)) };
    net.majorEvents = {
      onMajorEvent: (m) => {
        this.view.apply(m);
        void preloadFx(); // the effect page: ready long before the first bolt (the Tâm Ma and the cloud-gathering pause come first)
      },
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
      warning: (i: number, j: number, size: number, progress: number) => {
        this.demoTelegraphs = [{ id: shared.MAJOR_EVENT.TELEGRAPH_ID_BASE + 1, i, j, size, progress, shape: 'circle' }];
      },
      clearWarning: () => {
        this.demoTelegraphs = [];
      },
      state: () => ({
        active: this.view.active,
        title: this.title.string,
        titleShown: this.title.node.active,
        card: this.card.string,
        cardShown: this.card.node.active,
        bolts: this.bolts.length,
        sprites: this.sprites.length,
        warnings: this.warnings.size,
        cloud: !!this.cloud?.node.active,
        art: !!getFxFrame('fx_strike'),
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
    // the owner's textures: the bolt standing on the impact point, and the scorch mark it leaves
    const strike = getFxFrame('fx_strike');
    const info = getFxInfo('fx_strike');
    if (strike && info)
      this.spawn(
        this.worldLayer,
        strike,
        ground.x,
        ground.y,
        info.w * STRIKE_SCALE,
        info.h * STRIKE_SCALE,
        1 - info.pivotY,
        BOLT_LIFE_MS,
        255,
        1.4,
      );
    const scorch = getFxFrame('fx_scorch');
    const sInfo = getFxInfo('fx_scorch');
    if (scorch && sInfo) {
      const w = this.groundWidth(core.dequantizePos(qi), core.dequantizePos(qj), shared.MAJOR_EVENT.BOLT_RADIUS) * 1.15;
      this.spawn(
        this.decalLayer,
        scorch,
        ground.x,
        ground.y,
        w,
        (w * sInfo.h) / sInfo.w,
        0.5,
        SCORCH_LIFE_MS,
        235,
        1.3,
      );
    }
  }

  /** Width in world px of the on-screen ellipse of a ground circle of `radiusTiles` around tile (i, j) (the iso diamond's horizontal extent). */
  private groundWidth(i: number, j: number, radiusTiles: number): number {
    const a = tileToWorld(i + radiusTiles, j - radiusTiles, 0, this.tmpA);
    const ax = a.x;
    const b = tileToWorld(i - radiusTiles, j + radiusTiles, 0, this.tmpB);
    return Math.abs(ax - b.x);
  }

  private spawn(
    parent: Node,
    frame: NonNullable<ReturnType<typeof getFxFrame>>,
    x: number,
    y: number,
    w: number,
    h: number,
    anchorY: number,
    lifeMs: number,
    peak: number,
    curve: number,
  ): void {
    const node = newNode('TribFx', parent);
    const ui = node.addComponent(UITransform);
    ui.setContentSize(w, h);
    ui.setAnchorPoint(0.5, anchorY);
    node.setPosition(x, y, 0);
    const sp = node.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = frame;
    const opacity = node.addComponent(UIOpacity);
    opacity.opacity = peak;
    this.sprites.push({ node, opacity, atMs: this.clock, lifeMs, peak, curve });
  }

  /** True when this telegraph is drawn here as the tribulation warning decal (the ordinary telegraph layer must skip it). */
  handlesTelegraph(id: number): boolean {
    return id >= shared.MAJOR_EVENT.TELEGRAPH_ID_BASE && !!getFxFrame('fx_warning');
  }

  private updateSprites(): void {
    for (let k = this.sprites.length - 1; k >= 0; k--) {
      const f = this.sprites[k]!;
      const t = (this.clock - f.atMs) / f.lifeMs;
      if (t >= 1) {
        f.node.destroy();
        this.sprites.splice(k, 1);
      } else f.opacity.opacity = Math.round(f.peak * Math.pow(1 - t, f.curve));
    }
    // the storm cloud: above the player while the Kiếp lasts
    const cloudFrame = getFxFrame('fx_cloud');
    const cloudInfo = getFxInfo('fx_cloud');
    const cur = this.view.current();
    const me = this.net.selfPosition();
    const show = !!cloudFrame && !!cloudInfo && !!me && !!cur && cur.phase === shared.MajorPhase.Tribulation;
    if (show && cloudFrame && cloudInfo && me) {
      if (!this.cloud) {
        const node = newNode('TribCloud', this.worldLayer);
        node.addComponent(UITransform).setContentSize(cloudInfo.w * CLOUD_SCALE, cloudInfo.h * CLOUD_SCALE);
        const sp = node.addComponent(Sprite);
        sp.sizeMode = Sprite.SizeMode.CUSTOM;
        sp.spriteFrame = cloudFrame;
        this.cloud = { node, opacity: node.addComponent(UIOpacity) };
      }
      const g = tileToWorld(me.i, me.j, 0, this.tmpA);
      const pulse = 0.5 + 0.5 * Math.sin(this.clock / 420);
      this.cloud.node.active = true;
      this.cloud.node.setPosition(g.x, g.y + CLOUD_LIFT, 0);
      const k = 1 + 0.03 * pulse;
      this.cloud.node.setScale(k, k, 1);
      this.cloud.opacity.opacity = Math.round(200 + 45 * pulse);
    } else if (this.cloud) this.cloud.node.active = false;
    // warning decals: one per live major-event telegraph, brighter as the damage nears
    const warn = getFxFrame('fx_warning');
    const wInfo = getFxInfo('fx_warning');
    const live = new Set<number>();
    if (warn && wInfo)
      for (const v of [...this.net.telegraphs(), ...this.demoTelegraphs]) {
        if (!this.handlesTelegraph(v.id) || v.shape !== 'circle') continue;
        live.add(v.id);
        let w = this.warnings.get(v.id);
        const width = this.groundWidth(v.i, v.j, v.size);
        if (!w) {
          const node = newNode('TribWarn', this.decalLayer);
          node.addComponent(UITransform).setContentSize(width, (width * wInfo.h) / wInfo.w);
          const sp = node.addComponent(Sprite);
          sp.sizeMode = Sprite.SizeMode.CUSTOM;
          sp.spriteFrame = warn;
          w = { node, opacity: node.addComponent(UIOpacity) };
          this.warnings.set(v.id, w);
        }
        const c = tileToWorld(v.i, v.j, 0, this.tmpA);
        w.node.setPosition(c.x, c.y, 0);
        const flicker = 0.85 + 0.15 * Math.sin(this.clock / 90);
        w.opacity.opacity = Math.round((70 + 185 * v.progress) * flicker);
      }
    for (const [id, w] of this.warnings)
      if (!live.has(id)) {
        w.node.destroy();
        this.warnings.delete(id);
      }
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
        : new Color(58, 12, 82, Math.round(105 + 45 * pulse)); // black-violet, like the owner's Tâm Ma concept (assets-src/concepts/tribulation)
    }
    this.title.node.active = !!cur;
    if (cur) this.title.string = this.view.title();
    this.card.node.active = !!card;
    if (card) {
      this.card.string = card.lines.join('\n');
      this.card.color = card.tone === 'good' ? new Color(170, 255, 190, 255) : new Color(255, 190, 170, 255);
    }
    if (cur) void preloadFx(); // lazy effect page: starts with the first event of any path (cached afterwards)
    this.updateSprites();
    // lightning: the procedural bolt is the fallback while the textures are not there
    const g = this.g;
    g.clear();
    const haveArt = !!getFxFrame('fx_strike');
    for (let k = this.bolts.length - 1; k >= 0; k--)
      if (this.clock - this.bolts[k]!.atMs > BOLT_LIFE_MS) this.bolts.splice(k, 1);
    for (const b of this.bolts) {
      if (haveArt) break;
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
    for (const f of this.sprites) f.node.destroy();
    this.sprites.length = 0;
    for (const w of this.warnings.values()) w.node.destroy();
    this.warnings.clear();
    this.cloud?.node.destroy();
  }
}
