/**
 * Minimap and world map panel (PART 3 T, docs/05 section 3: minimap top-right, world map; docs/05 says `M` but meditation already owns `M` (D76), so the map is on `L` and on a click of the minimap). Both are DOM overlays (like the chat, party
 * and friends panels), so they cost no draw call of the world scene: the minimap is a 2D canvas redrawn a few times a second, the map panel an
 * `<img>` of the owner's parchment painting with the player's marker and the region names on top.
 *
 * The minimap is rotated 45 degrees to match the isometric screen (up on the minimap = up on screen). It shows the ground around the player
 * (`WorldView.groundAt`), the player's arrow, party members (green), other players (blue), elites (skull) and bosses (demon skull); the rest of the
 * markers of the sheet (quest, portal, herb) have no data source yet and are not drawn. Everything shown comes from what the server already sends
 * (`net.remotes()`, the party roster): no new messages. Text is set with `textContent` only.
 *
 * The painting does not follow the D95 quadrants (its forest is NW, lava NE, giant trees E, swamp SW), so the player marker on the map is placed
 * by REGION (`worldMapPoint` in ArtRegistry.ts), not by raw tile position. Every string comes from the string table (D104).
 */
import { core, shared } from './vendor/vgtd.mjs';
import { getMinimapSheet, loadWorldMapUrl } from './PropArt';
import {
  WORLD_MAP_NAME_KEYS,
  WORLD_MAP_REGIONS,
  worldMapPoint,
  type WorldMapRegion,
  type ZoneRect,
} from './ArtRegistry';

export interface MapWorld {
  width: number;
  groundAt(i: number, j: number): string | null;
  zones: readonly ZoneRect[];
}

export interface MapFeed {
  self(): { i: number; j: number } | null;
  remotes(): ReadonlyArray<{ entityId: number; kind: number; defId: number; i: number; j: number }>;
  isPartyMember(entityId: number): boolean;
  /** the quest objective to mark (D123): a yellow diamond, pinned to the rim when it is outside the shown area */
  objective?(): { i: number; j: number; label: string } | null;
}

const GROUND_COLOR: Record<string, string> = {
  grass: '#4f7a3c',
  dirt: '#8a6a45',
  stone: '#6d6d78',
  swamp: '#5b4a7a',
  water: '#3b6ea5',
  lava: '#c4501b',
};
const KIND_PLAYER = 0;
const KIND_MONSTER = 1;

function typing(e: KeyboardEvent): boolean {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

const regionName = (r: WorldMapRegion): string => core.t(WORLD_MAP_NAME_KEYS[r] as Parameters<typeof core.t>[0]);

/** The region the player stands in, for the corner caption and the map. */
export function regionOf(world: MapWorld, i: number, j: number): WorldMapRegion {
  return worldMapPoint(i, j, world.width, world.zones).region;
}

export class Minimap {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastMs = -1e9;
  /** half-size of the shown area in tiles */
  private readonly radius = 32;
  private readonly size: number;
  private visible = true;

  constructor(
    private readonly world: MapWorld,
    private readonly feed: MapFeed,
    parent: HTMLElement = document.body,
  ) {
    const small = typeof window !== 'undefined' && Math.min(window.innerWidth, window.innerHeight) < 520;
    this.size = small ? 120 : 176;
    const c = document.createElement('canvas');
    c.id = 'vgtd-minimap';
    c.width = this.size;
    c.height = this.size;
    Object.assign(c.style, {
      position: 'fixed',
      right: '12px',
      top: '12px',
      width: `${this.size}px`,
      height: `${this.size}px`,
      borderRadius: '12px',
      border: '2px solid #c9a24a',
      boxShadow: '0 2px 10px rgba(0,0,0,0.6)',
      background: '#101018',
      zIndex: '300',
      cursor: 'pointer',
    } satisfies Partial<CSSStyleDeclaration>);
    c.title = core.t('map.minimap_hint');
    parent.appendChild(c);
    this.canvas = c;
    this.ctx = c.getContext('2d')!;
  }

  /** Clicking the minimap opens the world map. */
  onClick(fn: () => void): void {
    this.canvas.onclick = fn;
  }

  setVisible(v: boolean): void {
    this.visible = v;
    this.canvas.style.display = v ? 'block' : 'none';
  }

  /** Redraw at most 8 times a second. */
  update(nowMs: number): void {
    if (!this.visible || nowMs - this.lastMs < 125) return;
    this.lastMs = nowMs;
    const me = this.feed.self();
    const ctx = this.ctx;
    const S = this.size;
    ctx.clearRect(0, 0, S, S);
    if (!me) {
      ctx.fillStyle = '#101018';
      ctx.fillRect(0, 0, S, S);
      return;
    }
    const ppt = S / (2 * this.radius);
    const root = Math.SQRT1_2;
    // ground, in 4 px cells, rotated 45 degrees
    const cell = 4;
    for (let cy = 0; cy < S; cy += cell)
      for (let cx = 0; cx < S; cx += cell) {
        const sx = (cx + cell / 2 - S / 2) / ppt;
        const sy = (cy + cell / 2 - S / 2) / ppt;
        const di = (sx + sy) * root;
        const dj = (sy - sx) * root;
        const g = this.world.groundAt(Math.floor(me.i + di), Math.floor(me.j + dj));
        ctx.fillStyle = (g && GROUND_COLOR[g]) || '#101018';
        ctx.fillRect(cx, cy, cell, cell);
      }
    const sheet = getMinimapSheet();
    const toScreen = (i: number, j: number): { x: number; y: number } => {
      const di = i - me.i;
      const dj = j - me.j;
      return { x: S / 2 + (di - dj) * root * ppt, y: S / 2 + (di + dj) * root * ppt };
    };
    const mark = (id: string, i: number, j: number, size: number, dot: string): void => {
      const p = toScreen(i, j);
      if (p.x < 4 || p.y < 4 || p.x > S - 4 || p.y > S - 4) return;
      const f = sheet?.frames[id];
      if (sheet && f) ctx.drawImage(sheet.image, f.x, f.y, f.w, f.h, p.x - size / 2, p.y - size / 2, size, size);
      else {
        ctx.fillStyle = dot;
        ctx.beginPath();
        ctx.arc(p.x, p.y, size / 3, 0, Math.PI * 2);
        ctx.fill();
      }
    };
    for (const r of this.feed.remotes()) {
      if (r.kind === KIND_PLAYER)
        mark(this.feed.isPartyMember(r.entityId) ? 'party' : 'player', r.i, r.j, 16, '#5aa0ff');
      else if (r.kind === KIND_MONSTER) {
        const tier = shared.mobDefById(r.defId)?.tier;
        if (tier === 'boss') mark('boss', r.i, r.j, 20, '#e0402a');
        else if (tier === 'elite') mark('elite', r.i, r.j, 16, '#f09a3a');
        else {
          const p = toScreen(r.i, r.j);
          ctx.fillStyle = 'rgba(220,70,60,0.85)';
          ctx.fillRect(Math.round(p.x) - 1, Math.round(p.y) - 1, 3, 3);
        }
      }
    }
    const obj = this.feed.objective?.() ?? null;
    if (obj) {
      const p = toScreen(obj.i, obj.j);
      const cx = S / 2;
      const rim = S / 2 - 9;
      const dx = p.x - cx;
      const dy = p.y - cx;
      const k = Math.max(Math.abs(dx), Math.abs(dy)) > rim ? rim / Math.max(Math.abs(dx), Math.abs(dy)) : 1;
      const x = cx + dx * k;
      const y = cx + dy * k;
      ctx.fillStyle = '#ffd84a';
      ctx.strokeStyle = '#3a2a00';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x, y - 7);
      ctx.lineTo(x + 6, y);
      ctx.lineTo(x, y + 7);
      ctx.lineTo(x - 6, y);
      ctx.closePath();
      ctx.stroke();
      ctx.fill();
      const tip = core.t('quest.guide.minimap', { name: obj.label });
      if (
        this.canvas.title !==
        `${core.t('map.minimap_hint')}
${tip}`
      )
        this.canvas.title = `${core.t('map.minimap_hint')}
${tip}`;
    }
    mark('self', me.i, me.j, 22, '#ffd75a');
    // caption: the region (and tile) the player stands in
    const region = regionOf(this.world, me.i, me.j);
    ctx.font = '11px sans-serif';
    ctx.textBaseline = 'top';
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(0, 0, S, 16);
    ctx.fillStyle = '#f4e8c8';
    ctx.fillText(core.t('map.caption', { region: regionName(region), i: Math.floor(me.i), j: Math.floor(me.j) }), 6, 2);
  }

  destroy(): void {
    this.canvas.remove();
  }
}

export class WorldMapPanel {
  private readonly root: HTMLDivElement;
  private readonly frame: HTMLDivElement;
  private readonly img: HTMLImageElement;
  private readonly status: HTMLDivElement;
  private readonly me: HTMLCanvasElement;
  private readonly dots: HTMLDivElement[] = [];
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly onResize: () => void;
  private open = false;
  private loadStarted = false;
  private timer = 0;

  constructor(
    private readonly world: MapWorld,
    private readonly feed: MapFeed,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-worldmap';
    Object.assign(root.style, {
      position: 'fixed',
      inset: '0',
      display: 'none',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'rgba(8,6,14,0.72)',
      zIndex: '460',
    } satisfies Partial<CSSStyleDeclaration>);
    root.onclick = (e) => {
      if (e.target === root) this.toggle(false);
    };
    const frame = document.createElement('div');
    Object.assign(frame.style, {
      position: 'relative',
      background: '#1a1410',
      borderRadius: '6px',
      boxShadow: '0 4px 24px rgba(0,0,0,0.7)',
    });
    const img = document.createElement('img');
    img.alt = '';
    img.draggable = false;
    Object.assign(img.style, { width: '100%', height: '100%', display: 'block', userSelect: 'none' });
    frame.appendChild(img);
    // region names over the painting
    for (const id of Object.keys(WORLD_MAP_REGIONS) as WorldMapRegion[]) {
      const r = WORLD_MAP_REGIONS[id];
      const label = document.createElement('div');
      label.textContent = regionName(id);
      Object.assign(label.style, {
        position: 'absolute',
        left: `${((r.x0 + r.x1) / 2) * 100}%`,
        top: `${(id === 'son_mon' ? r.y1 - 0.02 : r.y0 + 0.02) * 100}%`,
        transform: 'translateX(-50%)',
        font: 'bold 14px sans-serif',
        color: '#fff6dc',
        textShadow: '0 0 4px #000, 0 0 2px #000, 1px 1px 2px #000',
        pointerEvents: 'none',
        whiteSpace: 'nowrap',
      } satisfies Partial<CSSStyleDeclaration>);
      frame.appendChild(label);
    }
    const status = document.createElement('div');
    Object.assign(status.style, {
      position: 'absolute',
      left: '0',
      right: '0',
      top: '45%',
      textAlign: 'center',
      font: '16px sans-serif',
      color: '#e8dcc0',
    });
    frame.appendChild(status);
    const title = document.createElement('div');
    title.textContent = core.t('map.title');
    Object.assign(title.style, {
      position: 'absolute',
      left: '8px',
      top: '-24px',
      font: '13px sans-serif',
      color: '#f0e6cc',
    });
    frame.appendChild(title);
    const me = document.createElement('canvas');
    me.width = 40;
    me.height = 40;
    Object.assign(me.style, {
      position: 'absolute',
      width: '30px',
      height: '30px',
      transform: 'translate(-50%, -50%)',
      pointerEvents: 'none',
      filter: 'drop-shadow(0 0 4px #000)',
    });
    frame.appendChild(me);
    root.appendChild(frame);
    parent.appendChild(root);
    this.root = root;
    this.frame = frame;
    this.img = img;
    this.status = status;
    this.me = me;
    this.keyDown = (e) => {
      if (typing(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.key === 'l' || e.key === 'L') this.toggle();
      else if (e.key === 'Escape' && this.open) this.toggle(false);
    };
    window.addEventListener('keydown', this.keyDown);
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
  }

  get isOpen(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.style.display = this.open ? 'flex' : 'none';
    window.clearInterval(this.timer);
    if (!this.open) return;
    this.layout();
    if (!this.loadStarted) {
      this.loadStarted = true;
      this.status.textContent = core.t('map.loading');
      void loadWorldMapUrl().then((url) => {
        if (url) {
          this.img.src = url;
          this.status.textContent = '';
        } else this.status.textContent = core.t('map.missing');
      });
    }
    this.refresh();
    this.timer = window.setInterval(() => this.refresh(), 250);
  }

  private layout(): void {
    const s = Math.floor(Math.min(window.innerHeight * 0.84, window.innerWidth * 0.92, 760));
    this.frame.style.width = `${s}px`;
    this.frame.style.height = `${s}px`;
  }

  private refresh(): void {
    const me = this.feed.self();
    if (!me) {
      this.me.style.display = 'none';
      return;
    }
    const p = worldMapPoint(me.i, me.j, this.world.width, this.world.zones);
    this.me.style.display = 'block';
    this.me.style.left = `${p.x * 100}%`;
    this.me.style.top = `${p.y * 100}%`;
    const sheet = getMinimapSheet();
    const f = sheet?.frames['self'];
    const ctx = this.me.getContext('2d')!;
    ctx.clearRect(0, 0, 40, 40);
    if (sheet && f) ctx.drawImage(sheet.image, f.x, f.y, f.w, f.h, 0, 0, 40, 40);
    else {
      ctx.fillStyle = '#ffd75a';
      ctx.beginPath();
      ctx.arc(20, 20, 10, 0, Math.PI * 2);
      ctx.fill();
    }
    // party members: green dots at their region position
    const party = this.feed.remotes().filter((r) => r.kind === KIND_PLAYER && this.feed.isPartyMember(r.entityId));
    while (this.dots.length < party.length) {
      const d = document.createElement('div');
      Object.assign(d.style, {
        position: 'absolute',
        width: '10px',
        height: '10px',
        borderRadius: '50%',
        background: '#4fd06a',
        border: '2px solid #0a2a10',
        transform: 'translate(-50%, -50%)',
        pointerEvents: 'none',
      } satisfies Partial<CSSStyleDeclaration>);
      this.frame.appendChild(d);
      this.dots.push(d);
    }
    this.dots.forEach((d, k) => {
      const r = party[k];
      if (!r) {
        d.style.display = 'none';
        return;
      }
      const q = worldMapPoint(r.i, r.j, this.world.width, this.world.zones);
      d.style.display = 'block';
      d.style.left = `${q.x * 100}%`;
      d.style.top = `${q.y * 100}%`;
    });
  }

  destroy(): void {
    window.clearInterval(this.timer);
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
