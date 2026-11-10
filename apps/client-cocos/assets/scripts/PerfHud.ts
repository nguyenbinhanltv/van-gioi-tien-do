import { Color, Director, Label, Node, Sprite, UITransform, director } from 'cc';
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
  /** Average CPU ms per frame in the update phase (components + animation systems). */
  updateMs: number;
  /** Average CPU ms per frame submitting the render (GPU time is not included). */
  renderMs: number;
  l3Objects: number;
  chunks: number;
  npcs: number;
  /** Sum of transfer sizes of everything fetched so far (Resource Timing), MB: the runtime view of the initial package. */
  loadedMB: number;
  /** The @vgtd/shared BUDGETS the HUD judges against; scripts/perf-p1.mjs gates on these (single source of truth). */
  /** Streaming (multi-chunk map): chunk node-tree builds / unloads, build cost, frames the view had unresolved chunks. */
  chunksLoaded: number;
  chunksBuilt: number;
  chunksUnloaded: number;
  chunkBuildMsAvg: number;
  chunkBuildMsMax: number;
  /** Worst single-frame slice of node-tree building (what the player feels as a hitch). */
  chunkStepMsMax: number;
  notReadyUpdates: number;
  /** Real frame time (wall clock, not the clamped dt): worst frame so far and frames over 50 ms / 100 ms. */
  frameMsMax: number;
  hitches50: number;
  hitches100: number;
  budgets: { drawCalls: number; ramMB: number; initialDownloadMB: number; lazyDownloadMB: number };
}

/** Top-left perf overlay. Also publishes the latest numbers on `window.__vgtdPerf` for automation. */
export class PerfHud {
  private readonly label: Label;
  private readonly bg: Node;
  private acc = 0;
  private frames = 0;
  private logClock = 0;
  private t0 = 0;
  private updAcc = 0;
  private updN = 0;
  private rndAcc = 0;
  private rndN = 0;
  /** Extra free-text line (debug hooks). */
  note = '';
  /** Hint line shown under the numbers. */
  hint = 'click / WASD move | ?input=touch for joystick';
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
    updateMs: 0,
    renderMs: 0,
    l3Objects: 0,
    chunks: 0,
    npcs: 0,
    loadedMB: 0,
    chunksLoaded: 0,
    chunksBuilt: 0,
    chunksUnloaded: 0,
    chunkBuildMsAvg: 0,
    chunkBuildMsMax: 0,
    chunkStepMsMax: 0,
    notReadyUpdates: 0,
    frameMsMax: 0,
    hitches50: 0,
    hitches100: 0,
    budgets: {
      drawCalls: shared.BUDGETS.DRAW_CALLS_WEB_MOBILE,
      ramMB: shared.BUDGETS.RAM_MB_WEB,
      initialDownloadMB: shared.BUDGETS.INITIAL_DOWNLOAD_MB_WEB,
      lazyDownloadMB: shared.BUDGETS.LAZY_DOWNLOAD_MB_WEB,
    },
  };
  extra: () => {
    l3Objects: number;
    chunks?: number;
    npcs?: number;
    chunksLoaded?: number;
    stream?: {
      built: number;
      unloaded: number;
      buildMsTotal: number;
      buildMsMax: number;
      stepMsMax: number;
      notReadyUpdates: number;
    };
  } = () => ({ l3Objects: 0 });
  private lastFrameAt = 0;
  /** Called by `window.__vgtdPerfReset()` so a measured window can start from zero peaks / counters. */
  onReset: (() => void) | null = null;

  constructor(hudRoot: Node, art: ArtFrames) {
    director.on(Director.EVENT_BEFORE_UPDATE, () => (this.t0 = performance.now()));
    director.on(Director.EVENT_AFTER_UPDATE, () => {
      this.updAcc += performance.now() - this.t0;
      this.updN++;
    });
    director.on(Director.EVENT_BEFORE_RENDER, () => (this.t0 = performance.now()));
    director.on(Director.EVENT_AFTER_RENDER, () => {
      this.rndAcc += performance.now() - this.t0;
      this.rndN++;
    });
    (globalThis as unknown as { __vgtdPerfReset?: () => void }).__vgtdPerfReset = () => {
      this.stats.frameMsMax = 0;
      this.stats.hitches50 = 0;
      this.stats.hitches100 = 0;
      this.onReset?.();
    };
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

  /** Background width in design units (narrow screens). */
  setWidth(w: number): void {
    this.bg.getComponent(UITransform)!.setContentSize(w, 150);
  }

  /** Show / hide the overlay. */
  setVisible(v: boolean): void {
    this.bg.active = v;
  }

  /** Register a texture for the byte estimate. */
  trackTexture(w: number, h: number): void {
    this.textures.push({ w, h });
  }

  /** Pin the HUD to the top-left corner of a canvas of the given design size, `left` units in (clear of the player frame column). */
  layout(canvasW: number, canvasH: number, left = 8): void {
    this.bg.setPosition(-canvasW / 2 + left, canvasH / 2 - 8, 0);
  }

  get visible(): boolean {
    return this.bg.active;
  }

  update(dt: number): void {
    const nowMs = performance.now();
    if (this.lastFrameAt > 0) {
      const fm = nowMs - this.lastFrameAt;
      const s0 = this.stats;
      if (fm > s0.frameMsMax) s0.frameMsMax = fm;
      if (fm > 50) s0.hitches50++;
      if (fm > 100) s0.hitches100++;
    }
    this.lastFrameAt = nowMs;
    this.acc += dt;
    this.frames++;
    if (this.acc < 0.5) return;
    const s = this.stats;
    s.updateMs = this.updN ? this.updAcc / this.updN : 0;
    s.renderMs = this.rndN ? this.rndAcc / this.rndN : 0;
    this.updAcc = this.updN = this.rndAcc = this.rndN = 0;
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
    const ex = this.extra();
    s.l3Objects = ex.l3Objects;
    s.chunks = ex.chunks ?? 0;
    s.npcs = ex.npcs ?? 0;
    s.chunksLoaded = ex.chunksLoaded ?? 0;
    s.loadedMB = this.loadedBytes() / 1048576;
    if (ex.stream) {
      s.chunksBuilt = ex.stream.built;
      s.chunksUnloaded = ex.stream.unloaded;
      s.chunkBuildMsAvg = ex.stream.built ? ex.stream.buildMsTotal / ex.stream.built : 0;
      s.chunkBuildMsMax = ex.stream.buildMsMax;
      s.chunkStepMsMax = ex.stream.stepMsMax;
      s.notReadyUpdates = ex.stream.notReadyUpdates;
    }
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
      `CPU update ${s.updateMs.toFixed(2)} ms  render ${s.renderMs.toFixed(2)} ms
` +
      `JS heap ${heap} (heap + tex / ${B.RAM_MB_WEB} MB ${heapOk})\n` +
      `Nodes ${s.nodes}   L3 ${s.l3Objects}   Chunks ${s.chunks}/${s.chunksLoaded}   NPC ${s.npcs}   Loaded ${s.loadedMB.toFixed(1)} MB\n` +
      this.hint +
      (this.note
        ? `
${this.note}`
        : '');
  }

  /** Bytes fetched so far (compressed on the wire when the server compresses; body size otherwise). */
  private loadedBytes(): number {
    let n = 0;
    for (const e of performance.getEntriesByType('resource') as PerformanceResourceTiming[]) {
      n += e.transferSize || e.encodedBodySize || 0;
    }
    return n;
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
