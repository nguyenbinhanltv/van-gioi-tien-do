import { Color, Label, Node, Sprite, UITransform, director } from 'cc';
import { shared } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';

export interface PerfStats {
  fps: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  /** Real GPU texture bytes tracked by the gfx device (what the engine has uploaded). */
  textureMB: number;
  /** Our own estimate: sum of w*h*4 of textures we created (sanity cross-check). */
  textureEstMB: number;
  /** performance.memory.usedJSHeapSize (Chromium only), else null. */
  jsHeapMB: number | null;
  nodes: number;
  l3Objects: number;
}

/** Top-left perf overlay. Also publishes the latest numbers on `window.__vgtdPerf` for automation. */
export class PerfHud {
  private readonly label: Label;
  private readonly bg: Node;
  private acc = 0;
  private frames = 0;
  private logClock = 0;
  /** Extra free-text line (debug hooks). */
  note = '';
  private readonly textures: Array<{ w: number; h: number }> = [];
  readonly stats: PerfStats = {
    fps: 0,
    frameMs: 0,
    drawCalls: 0,
    triangles: 0,
    textureMB: 0,
    textureEstMB: 0,
    jsHeapMB: null,
    nodes: 0,
    l3Objects: 0,
  };
  extra: () => { l3Objects: number } = () => ({ l3Objects: 0 });

  constructor(hudRoot: Node, art: ArtFrames) {
    this.bg = newNode('HudBg', hudRoot);
    const bgUi = this.bg.addComponent(UITransform);
    bgUi.setAnchorPoint(0, 1);
    bgUi.setContentSize(560, 150);
    const sp = this.bg.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = art.pixel;
    sp.color = new Color(0, 0, 0, 150);

    const n = newNode('HudText', this.bg);
    const ui = n.addComponent(UITransform);
    ui.setAnchorPoint(0, 1);
    n.setPosition(8, -6, 0);
    this.label = n.addComponent(Label);
    this.label.fontSize = 14;
    this.label.lineHeight = 17;
    this.label.horizontalAlign = Label.HorizontalAlign.LEFT;
    this.label.verticalAlign = Label.VerticalAlign.TOP;
    this.label.overflow = Label.Overflow.NONE;
    this.label.color = new Color(235, 255, 235, 255);
  }

  /** Register a texture for the byte estimate. */
  trackTexture(w: number, h: number): void {
    this.textures.push({ w, h });
  }

  /** Pin the HUD to the top-left corner of a canvas of the given design size. */
  layout(canvasW: number, canvasH: number): void {
    this.bg.setPosition(-canvasW / 2 + 8, canvasH / 2 - 8, 0);
  }

  update(dt: number): void {
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const s = this.stats;
    s.fps = this.frames / this.acc;
    s.frameMs = (this.acc / this.frames) * 1000;
    this.acc = 0;
    this.frames = 0;

    const dev = director.root?.device;
    s.drawCalls = dev?.numDrawCalls ?? 0;
    s.triangles = dev?.numTris ?? 0;
    s.textureMB = (dev?.memoryStatus?.textureSize ?? 0) / 1048576;
    s.textureEstMB = this.textures.reduce((a, t) => a + t.w * t.h * 4, 0) / 1048576;
    const mem = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    s.jsHeapMB = mem ? mem.usedJSHeapSize / 1048576 : null;
    s.l3Objects = this.extra().l3Objects;
    s.nodes = this.countNodes();
    (globalThis as unknown as { __vgtdPerf?: PerfStats }).__vgtdPerf = s;

    this.logClock += 0.5;
    if (this.logClock >= 2) {
      this.logClock = 0;
      console.log(
        '[vgtd][perf] ' + JSON.stringify(s, (_k, v) => (typeof v === 'number' ? Math.round(v * 100) / 100 : v)),
      );
    }
    const B = shared.BUDGETS; // docs/06 Mobile/Web budgets, single-sourced in @vgtd/shared
    const dcOk = s.drawCalls <= B.DRAW_CALLS_WEB_MOBILE ? 'ok' : 'OVER';
    const texOk = s.textureMB <= B.TEXTURE_RAM_MB_WEB ? 'ok' : 'OVER';
    const heapOk = s.jsHeapMB === null || s.jsHeapMB + s.textureMB <= B.RAM_MB_WEB ? 'ok' : 'OVER';
    const heap = s.jsHeapMB === null ? 'n/a' : `${s.jsHeapMB.toFixed(1)} MB`;
    this.label.string =
      `FPS ${s.fps.toFixed(1)}  (${s.frameMs.toFixed(1)} ms)\n` +
      `Draw calls ${s.drawCalls} / ${B.DRAW_CALLS_WEB_MOBILE} ${dcOk}   Tris ${s.triangles}\n` +
      `Tex mem ${s.textureMB.toFixed(2)} MB (est ${s.textureEstMB.toFixed(2)}) / ${B.TEXTURE_RAM_MB_WEB} MB ${texOk}
` +
      `JS heap ${heap}\n` +
      `Nodes ${s.nodes}   L3 ${s.l3Objects}\n` +
      `click / WASD move | ?input=touch for joystick` +
      (this.note
        ? `
${this.note}`
        : '');
  }

  private countNodes(): number {
    let n = 0;
    const walk = (node: Node) => {
      n++;
      for (const c of node.children) walk(c);
    };
    const scene = director.getScene();
    if (scene) walk(scene);
    return n;
  }
}
