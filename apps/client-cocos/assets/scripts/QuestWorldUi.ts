/**
 * Quest guidance in the world (D123): NPC name plates with quest markers, the NPC dialogue, the edge-of-screen objective arrow, the walk
 * to the objective and the floating feedback text. All DOM overlays over the game canvas (like the chat, minimap and quest log), so they cost
 * no draw call of the world scene. Everything is drawn with `textContent` only and every string comes from the vi-VN table (D104).
 *
 * The server stays authoritative: the dialogue buttons only send the existing quest intents (`quest_cmd`: accept 120, claim, talk), the
 * server checks the distance (`QUESTS.NPC_RANGE_TILES`), the prerequisites and pays the rewards. What this file decides is only where to
 * point and what to show: `guideTarget` / `edgeArrow` / `QuestModel` from client-core carry the logic and are unit-tested there.
 *
 * Interaction: click / tap an NPC (or its plate), or press F within reach. Far away, a click walks to the NPC first (the existing
 * `IsoPathfinder`) and opens the dialogue on arrival. F is also the fly toggle: inside an NPC's reach F opens the dialogue instead.
 */
import { core, shared } from './vendor/vgtd.mjs';

type Model = InstanceType<typeof core.QuestModel>;
type Tile = { i: number; j: number };

const GOLD = '#f0dc96';
const MUTED = '#b6bccb';
const MARK_COLOR = { ready: '#ffd84a', available: '#ffd84a', active: '#9a9fae' } as const;
const MARK_GLYPH = { ready: '?', available: '!', active: '?' } as const;
/** plates farther than this many tiles from the player are not drawn */
const PLATE_RANGE_TILES = 24;
/** the dialogue closes when the player walks farther than this from the NPC (server reach + a little) */
const DIALOGUE_LEAVE_TILES = 7;

export interface NpcSpot {
  key: string;
  /** tile the NPC stands on (integer anchor; the standee centre is +0.5) */
  i: number;
  j: number;
  /** how far the art reaches above the foot, world px */
  height: number;
}

export interface QuestWorldHooks {
  /** shared logical screen (y down, 1x world px) of a browser client point: the camera inverse */
  clientToWorld(x: number, y: number): { x: number; y: number };
  npcs(): readonly NpcSpot[];
  self(): Tile | null;
  mapTiles(): number;
  /** monsters the server has told us about */
  mobs(): { defId: number; i: number; j: number }[];
  /** one `quest_cmd` intent; false when the socket is not open */
  send(op: number, arg: string): boolean;
  /** A* path (continuous tiles) or null; the walk itself is `walk` */
  findPath(from: Tile, to: Tile): Tile[] | null;
  walk(path: Tile[]): void;
  /** true while a click / guided path is being walked */
  walking(): boolean;
  /** the NPC's portrait when its art can be drawn into a canvas */
  portrait?(key: string): HTMLCanvasElement | null;
  say(line: string, tone: 'system' | 'error'): void;
}

const css = (el: HTMLElement, style: Partial<CSSStyleDeclaration>): void => void Object.assign(el.style, style);

export class QuestWorldUi {
  private readonly layer: HTMLDivElement;
  private readonly plates = new Map<
    string,
    { root: HTMLDivElement; mark: HTMLDivElement; name: HTMLDivElement; hint: HTMLDivElement; state: string }
  >();
  private readonly arrow: HTMLDivElement;
  private readonly arrowSvg: HTMLDivElement;
  private readonly arrowText: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly canvasDown: (e: PointerEvent) => void;
  private openNpc: string | null = null;
  private drawnDialog = '';
  private pendingNpc: string | null = null;
  private walkingGrace = 0;
  private target: ReturnType<typeof core.guideTarget> = null;
  private lastTarget: ReturnType<typeof core.guideTarget> = null;
  private clock = 0;
  private activeWalk: { tile: Tile; radius: number; name: string } | null = null;

  constructor(
    private readonly model: Model,
    private readonly hooks: QuestWorldHooks,
    private readonly canvas: HTMLElement,
    parent: HTMLElement = document.body,
  ) {
    const layer = document.createElement('div');
    layer.id = 'vgtd-quest-world';
    css(layer, { position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '430', overflow: 'hidden' });
    parent.appendChild(layer);
    this.layer = layer;

    const arrow = document.createElement('div');
    arrow.id = 'vgtd-quest-arrow';
    css(arrow, { position: 'absolute', left: '0', top: '0', display: 'none', pointerEvents: 'none', zIndex: '1' });
    this.arrowSvg = document.createElement('div');
    css(this.arrowSvg, {
      width: '28px',
      height: '28px',
      marginLeft: '-14px',
      marginTop: '-14px',
      transformOrigin: '50% 50%',
    });
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 28 28');
    svg.setAttribute('width', '28');
    svg.setAttribute('height', '28');
    const path = document.createElementNS(ns, 'path');
    path.setAttribute('d', 'M3 14 L22 4 L17 14 L22 24 Z');
    path.setAttribute('fill', '#ffd84a');
    path.setAttribute('stroke', '#3a2a00');
    path.setAttribute('stroke-width', '1.5');
    path.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(path);
    this.arrowSvg.appendChild(svg);
    this.arrowText = document.createElement('div');
    css(this.arrowText, {
      position: 'absolute',
      left: '0',
      top: '18px',
      transform: 'translateX(-50%)',
      whiteSpace: 'nowrap',
      font: 'bold 11px sans-serif',
      color: '#ffe9a0',
      textShadow: '0 0 3px #000, 0 0 3px #000',
    });
    arrow.append(this.arrowSvg, this.arrowText);
    layer.appendChild(arrow);
    this.arrow = arrow;

    const dialog = document.createElement('div');
    dialog.id = 'vgtd-npc-dialog';
    css(dialog, {
      position: 'fixed',
      left: '50%',
      bottom: '120px',
      transform: 'translateX(-50%)',
      width: '420px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100vh - 260px)',
      overflowY: 'auto',
      display: 'none',
      padding: '10px',
      font: '12px/1.4 sans-serif',
      textAlign: 'left',
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.92)',
      border: '1px solid #c9a24a',
      borderRadius: '8px',
      zIndex: '455',
      pointerEvents: 'auto',
    });
    parent.appendChild(dialog);
    this.dialog = dialog;

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.code === 'Escape' && this.openNpc) {
        this.close();
        return;
      }
      if (e.code !== 'KeyF') return;
      const near = this.nearNpc();
      if (!near) return;
      e.stopPropagation(); // F is also the fly toggle: next to an NPC it talks instead
      e.preventDefault();
      if (this.openNpc === near.key) this.close();
      else this.open(near.key);
    };
    window.addEventListener('keydown', this.keyDown, true);

    this.canvasDown = (e) => {
      if (e.button !== 0) return;
      const hit = this.npcAtClient(e.clientX, e.clientY);
      if (!hit) return;
      e.stopImmediatePropagation(); // an NPC click is not a walk / target click
      this.interact(hit.key);
    };
    canvas.addEventListener('pointerdown', this.canvasDown, true);

    // automation hook (scripts/quest-guidance-smoke.mjs and manual checks): read what the player sees, press what the player presses
    const g = globalThis as unknown as Record<string, Record<string, unknown>>;
    g.__vgtdQuestWorld = {
      plates: () =>
        Array.from(this.plates.entries()).map(([key, p]) => ({
          key,
          text: p.name.textContent ?? '',
          marker: p.mark.textContent ?? '',
          shown: p.root.style.display !== 'none',
        })),
      arrow: () => ({
        shown: this.arrow.style.display !== 'none',
        text: this.arrowText.textContent ?? '',
        target: this.target
          ? { kind: this.target.kind, i: this.target.tile.i, j: this.target.tile.j, label: this.target.label }
          : null,
      }),
      dialog: () => ({ open: this.openNpc, text: this.dialog.textContent ?? '' }),
      interact: (key: string) => this.interact(key),
      press: (label: string) => {
        const b = Array.from(this.dialog.querySelectorAll('button')).find((x) => (x.textContent ?? '').includes(label));
        b?.click();
        return !!b;
      },
      go: () => this.goToObjective(),
    };
  }

  /** The objective the arrow and the minimap marker point at, or null. */
  get objective(): { i: number; j: number; label: string } | null {
    const t = this.target;
    return t ? { i: t.tile.i, j: t.tile.j, label: t.label } : null;
  }

  // ------------------------------------------------------------------ projection
  /** Browser client px of a tile centre, from the camera inverse (two samples give the affine map; y-flip lives in IsoAdapter). */
  private project(
    i: number,
    j: number,
    c0: { x: number; y: number },
    kx: number,
    ky: number,
  ): { x: number; y: number } {
    const w = shared.tileToScreen(i + 0.5, j + 0.5);
    return { x: (w.x - c0.x) * kx, y: (w.y - c0.y) * ky };
  }

  private nearNpc(): { key: string; dist: number } | null {
    const me = this.hooks.self();
    const n = this.model.nearestNpc(me, this.hooks.mapTiles());
    if (!n || !n.inReach) return null;
    // only the NPCs actually standing in the world (a key without art has no body to talk to)
    return this.hooks.npcs().some((s) => s.key === n.key) ? { key: n.key, dist: n.dist } : null;
  }

  private npcAtClient(x: number, y: number): NpcSpot | null {
    const c0 = this.hooks.clientToWorld(0, 0);
    const c1 = this.hooks.clientToWorld(100, 100);
    const kx = 100 / (c1.x - c0.x || 1);
    const ky = 100 / (c1.y - c0.y || 1);
    const zoom = Math.abs(kx);
    for (const s of this.hooks.npcs()) {
      const p = this.project(s.i, s.j, c0, kx, ky);
      const h = s.height * zoom;
      if (Math.abs(x - p.x) <= 0.4 * h && y >= p.y - h && y <= p.y + 14 * zoom) return s;
    }
    return null;
  }

  // ------------------------------------------------------------------ interaction
  /** Click / tap on an NPC: talk when in reach, else walk there first and talk on arrival. */
  interact(key: string): void {
    const spot = this.hooks.npcs().find((s) => s.key === key);
    if (!spot) return;
    const near = this.nearNpc();
    if (near && near.key === key) {
      this.open(key);
      return;
    }
    this.pendingNpc = key;
    this.walkToTile({ i: spot.i + 0.5, j: spot.j + 0.5 }, shared.QUESTS.NPC_RANGE_TILES - 1.5, core.npcName(key));
  }

  open(key: string): void {
    this.openNpc = key;
    this.pendingNpc = null;
    this.drawnDialog = '';
    this.dialog.style.display = 'block';
  }
  close(): void {
    this.openNpc = null;
    this.dialog.style.display = 'none';
  }
  get dialogueOpen(): boolean {
    return this.openNpc !== null;
  }

  /** Auto-walk to the objective the tracker points at (click on the tracker). */
  goToObjective(): boolean {
    const t = this.target ?? this.lastTarget;
    if (!t) {
      this.hooks.say(core.t('quest.guide.nowhere'), 'system');
      return false;
    }
    if (t.kind === 'npc' && t.npc) this.pendingNpc = t.npc;
    return this.walkToTile(t.tile, core.arrivalRadius(t), t.label);
  }

  private walkToTile(to: Tile, radius: number, name: string): boolean {
    const me = this.hooks.self();
    if (!me) return false;
    const path = this.hooks.findPath(me, to);
    if (!path || path.length === 0) {
      this.pendingNpc = null;
      this.hooks.say(core.t('quest.guide.no_path', { name }), 'error');
      return false;
    }
    // stop at the arrival radius instead of on the NPC's own tile
    const stop = path.findIndex((p) => Math.hypot(p.i - to.i, p.j - to.j) <= radius);
    const trimmed = stop >= 0 ? path.slice(0, stop + 1) : path;
    this.hooks.walk(trimmed);
    this.walkingGrace = 0.5;
    this.activeWalk = { tile: to, radius, name };
    this.hooks.say(core.t('quest.guide.walking', { name }), 'system');
    return true;
  }

  // ------------------------------------------------------------------ per frame
  /** Redraw positions every frame; the content of plates / dialogue only when the model changed. */
  update(dt: number): void {
    this.clock += dt;
    const me = this.hooks.self();
    const w = window.innerWidth;
    const h = window.innerHeight;
    const c0 = this.hooks.clientToWorld(0, 0);
    const c1 = this.hooks.clientToWorld(100, 100);
    const kx = 100 / (c1.x - c0.x || 1);
    const ky = 100 / (c1.y - c0.y || 1);
    const zoom = Math.abs(kx);
    const npcs = this.hooks.npcs();
    const mapTiles = this.hooks.mapTiles();

    // plates + markers
    const nearKey = this.nearNpc()?.key ?? null;
    for (const s of npcs) {
      let p = this.plates.get(s.key);
      if (!p) {
        p = this.makePlate(s.key);
        this.plates.set(s.key, p);
      }
      const dist = me ? Math.hypot(me.i - (s.i + 0.5), me.j - (s.j + 0.5)) : 0;
      const pos = this.project(s.i, s.j, c0, kx, ky);
      const head = s.height * zoom;
      const visible = dist <= PLATE_RANGE_TILES && pos.x > -60 && pos.x < w + 60 && pos.y > -20 && pos.y < h + head;
      p.root.style.display = visible ? 'block' : 'none';
      if (!visible) continue;
      p.root.style.transform = `translate(${Math.round(pos.x)}px, ${Math.round(pos.y - head - 6)}px) translate(-50%, -100%)`;
      const st = this.model.ready ? (this.model.markerState(s.key) ?? '') : '';
      if (st !== p.state) {
        p.state = st;
        p.mark.textContent = st ? MARK_GLYPH[st as keyof typeof MARK_GLYPH] : '';
        p.mark.style.color = st ? MARK_COLOR[st as keyof typeof MARK_COLOR] : '';
        p.mark.style.display = st ? 'block' : 'none';
      }
      p.hint.style.display = nearKey === s.key && !this.openNpc ? 'block' : 'none';
      if (st) p.mark.style.transform = `translateY(${Math.round(Math.sin(this.clock * 4) * 2)}px)`;
    }

    // guidance target + arrow
    this.target = this.model.ready ? core.guideTarget(this.model, mapTiles, me, this.hooks.mobs()) : null;
    if (this.target) this.lastTarget = this.target;
    if (this.target && me) {
      const a = core.edgeArrow(me, this.target.tile, w, h, Math.abs(kx), 44);
      const n = core.guideDistance(me, this.target.tile);
      this.arrow.style.display = n <= 2 ? 'none' : 'block';
      this.arrow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y)}px)`;
      // on screen the arrow bobs above the target and points down; off screen it points along the edge direction
      this.arrowSvg.style.transform = `rotate(${a.onScreen ? Math.PI / 2 : a.angle}rad)`;
      if (a.onScreen)
        this.arrow.style.transform = `translate(${Math.round(a.x)}px, ${Math.round(a.y - 46 + Math.sin(this.clock * 5) * 3)}px)`;
      // keep the label on screen: right-aligned near the right edge, left-aligned near the left edge
      this.arrowText.style.transform =
        a.x > w - 150 ? 'translateX(-100%)' : a.x < 150 ? 'translateX(0)' : 'translateX(-50%)';
      this.arrowText.textContent = core.t('quest.guide.arrow', { name: this.target.label, n });
    } else this.arrow.style.display = 'none';

    this.tickWalk(dt, me);
    this.tickDialog(me);
  }

  /** Arrival handling: a pending NPC opens its dialogue once within reach; a finished walk is reported once. */
  private tickWalk(dt: number, me: Tile | null): void {
    if (this.walkingGrace > 0) this.walkingGrace -= dt;
    if (this.pendingNpc) {
      const near = this.nearNpc();
      if (near && near.key === this.pendingNpc) this.open(this.pendingNpc);
      else if (this.walkingGrace <= 0 && !this.hooks.walking()) this.pendingNpc = null; // the walk was cancelled (WASD / a new click)
    }
    const aw = this.activeWalk;
    if (aw && this.walkingGrace <= 0 && !this.hooks.walking()) {
      this.activeWalk = null;
      if (me && Math.hypot(me.i - aw.tile.i, me.j - aw.tile.j) <= aw.radius + 1)
        this.hooks.say(core.t('quest.guide.arrived', { name: aw.name }), 'system');
    }
  }

  private tickDialog(me: Tile | null): void {
    if (!this.openNpc) return;
    const spot = this.hooks.npcs().find((s) => s.key === this.openNpc);
    if (!spot || !me || Math.hypot(me.i - (spot.i + 0.5), me.j - (spot.j + 0.5)) > DIALOGUE_LEAVE_TILES) {
      this.close();
      return;
    }
    const sig = `${this.openNpc}:${this.model.version}`;
    if (sig === this.drawnDialog) return;
    this.drawnDialog = sig;
    this.drawDialog(this.openNpc);
  }

  // ------------------------------------------------------------------ drawing
  private makePlate(key: string): {
    root: HTMLDivElement;
    mark: HTMLDivElement;
    name: HTMLDivElement;
    hint: HTMLDivElement;
    state: string;
  } {
    const root = document.createElement('div');
    css(root, {
      position: 'absolute',
      left: '0',
      top: '0',
      display: 'none',
      textAlign: 'center',
      pointerEvents: 'auto',
      cursor: 'pointer',
      willChange: 'transform',
    });
    root.addEventListener('click', (e) => {
      e.stopPropagation();
      this.interact(key);
    });
    const mark = document.createElement('div');
    css(mark, {
      display: 'none',
      font: 'bold 26px/26px sans-serif',
      textShadow: '0 0 4px #000, 0 0 4px #000, 0 2px 0 #000',
    });
    const name = document.createElement('div');
    name.textContent = core.npcPlate(key);
    css(name, {
      display: 'inline-block',
      padding: '1px 7px',
      font: 'bold 11px sans-serif',
      color: '#fff3c8',
      whiteSpace: 'nowrap',
      background: 'rgba(8,10,18,0.62)',
      border: '1px solid rgba(201,162,74,0.7)',
      borderRadius: '9px',
      textShadow: '0 1px 2px #000',
    });
    const hint = document.createElement('div');
    css(hint, { display: 'none', font: '10px sans-serif', color: '#7fd4ff', textShadow: '0 0 3px #000, 0 0 3px #000' });
    hint.textContent = core.t('npc.dialog.hint', { npc: core.npcName(key) });
    root.append(mark, name, hint);
    this.layer.appendChild(root);
    return { root, mark, name, hint, state: '\u0000' };
  }

  private btn(label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    css(b, {
      marginLeft: '6px',
      padding: '4px 10px',
      font: '12px sans-serif',
      color: '#f0f0f5',
      background: '#33405a',
      border: '1px solid #7fd4ff',
      borderRadius: '4px',
      cursor: 'pointer',
    });
    b.addEventListener('click', run);
    return b;
  }
  private line(s: string, color?: string, extra: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
    const d = document.createElement('div');
    d.textContent = s;
    if (color) d.style.color = color;
    css(d, extra);
    return d;
  }

  private drawDialog(key: string): void {
    const frag = document.createDocumentFragment();
    const head = document.createElement('div');
    css(head, { display: 'flex', alignItems: 'center', marginBottom: '6px' });
    const portrait = this.hooks.portrait?.(key) ?? null;
    const face = portrait ?? this.monogram(key);
    head.appendChild(face);
    head.appendChild(this.line(core.npcPlate(key), GOLD, { flex: '1 1 auto', fontWeight: 'bold', fontSize: '14px' }));
    head.appendChild(this.btn(core.t('npc.dialog.close'), () => this.close()));
    frag.appendChild(head);

    const body = document.createElement('div');
    frag.appendChild(body);
    let any = false;
    const rows: HTMLElement[] = [];
    const quest = (v: ReturnType<Model['list']>[number], blurb: string, action?: HTMLButtonElement): void => {
      any = true;
      const row = document.createElement('div');
      css(row, { padding: '5px 0', borderTop: '1px solid rgba(255,255,255,0.1)' });
      const top = document.createElement('div');
      css(top, { display: 'flex', alignItems: 'center' });
      top.appendChild(this.line(v.name, '#f0f0f5', { flex: '1 1 auto', fontWeight: 'bold' }));
      if (action) top.appendChild(action);
      row.appendChild(top);
      if (blurb) row.appendChild(this.line(blurb, MUTED, { fontSize: '11px' }));
      for (const l of v.lines) row.appendChild(this.line(`  ${l}`));
      if (v.reward)
        row.appendChild(this.line(core.t('quest.panel.reward', { reward: v.reward }), GOLD, { fontSize: '11px' }));
      rows.push(row);
    };

    for (const v of this.model.list([core.QuestStatus.Ready]))
      if (v.def.turnIn === key)
        quest(
          v,
          core.t('npc.dialog.ready_line'),
          this.btn(core.t('npc.dialog.turn_in'), () => void this.hooks.send(core.QuestOp.Claim, v.id)),
        );
    for (const v of this.model.list([core.QuestStatus.Active])) {
      const talk = v.def.objectives.some(
        (o: { kind: string; npc?: string }, i: number) =>
          o.kind === 'talk' && o.npc === key && (v.progress[i] ?? 0) < 1,
      );
      if (talk)
        quest(
          v,
          v.desc,
          this.btn(core.t('npc.dialog.talk'), () => void this.hooks.send(core.QuestOp.Talk, key)),
        );
      else if (v.def.giver === key || v.def.turnIn === key)
        quest(v, core.t('npc.dialog.in_progress', { name: v.name }));
    }
    for (const v of this.model.available())
      if (v.def.giver === key)
        quest(
          v,
          v.desc,
          this.btn(core.t('npc.dialog.accept'), () => void this.hooks.send(core.QuestOp.Accept, v.id)),
        );

    body.appendChild(
      this.line(any ? core.t('npc.dialog.greeting') : core.t('npc.dialog.nothing'), '#f0f0f5', { marginBottom: '4px' }),
    );
    for (const r of rows) body.appendChild(r);
    this.dialog.replaceChildren(frag);
  }

  private monogram(key: string): HTMLElement {
    const d = document.createElement('div');
    d.textContent = (core.npcName(key).trim()[0] ?? '?').toUpperCase();
    css(d, {
      width: '44px',
      height: '44px',
      marginRight: '10px',
      borderRadius: '50%',
      border: '2px solid #c9a24a',
      background: '#2a3045',
      color: GOLD,
      font: 'bold 22px/40px sans-serif',
      textAlign: 'center',
      flex: '0 0 auto',
    });
    return d;
  }

  // ------------------------------------------------------------------ feedback
  /** Floating text above the player, rising and fading (objective progress, objective done, quest done). */
  float(text: string, tone: 'progress' | 'done' | 'quest'): void {
    const me = this.hooks.self();
    if (!me) return;
    const c0 = this.hooks.clientToWorld(0, 0);
    const c1 = this.hooks.clientToWorld(100, 100);
    const kx = 100 / (c1.x - c0.x || 1);
    const ky = 100 / (c1.y - c0.y || 1);
    const p = this.project(me.i - 0.5, me.j - 0.5, c0, kx, ky);
    const el = document.createElement('div');
    el.textContent = text;
    const color = tone === 'quest' ? '#ffd84a' : tone === 'done' ? '#8fe0a0' : '#ffffff';
    css(el, {
      position: 'absolute',
      left: `${Math.round(p.x)}px`,
      top: `${Math.round(p.y - 90 * Math.abs(kx))}px`,
      transform: 'translateX(-50%)',
      whiteSpace: 'nowrap',
      font: `bold ${tone === 'quest' ? 20 : 15}px sans-serif`,
      color,
      textShadow: '0 0 4px #000, 0 0 4px #000, 0 2px 0 #000',
      pointerEvents: 'none',
    });
    this.layer.appendChild(el);
    const rise = tone === 'quest' ? 80 : 56;
    const anim = el.animate(
      [
        { transform: 'translateX(-50%) translateY(0) scale(0.8)', opacity: 0 },
        { transform: 'translateX(-50%) translateY(-8px) scale(1.15)', opacity: 1, offset: 0.15 },
        { transform: `translateX(-50%) translateY(-${rise}px) scale(1)`, opacity: 0 },
      ],
      { duration: tone === 'quest' ? 2200 : 1500, easing: 'ease-out' },
    );
    anim.onfinish = () => el.remove();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown, true);
    this.canvas.removeEventListener('pointerdown', this.canvasDown, true);
    this.layer.remove();
    this.dialog.remove();
  }
}
