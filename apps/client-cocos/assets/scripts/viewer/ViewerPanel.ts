import { character } from '../vendor/vgtd.mjs';
import {
  ALL_DIRECTIONS,
  ALL_CLIPS,
  SPINE_SLOTS,
  type ClipId,
  type Direction,
  type SkinName,
  type SlotId,
  type ViewerSettings,
} from './ViewerModel';
import type { ActorFrame, SeamMetric } from './CharacterActor';

export interface PanelInfo {
  a: ActorFrame | null;
  b: ActorFrame | null;
  viewA: character.CharacterViewState;
  rigDir: Direction | null;
  /** Slots whose rig setup order differs from the paperdoll table for the requested direction. */
  drawDelta: string[];
  events: string[];
  /** Loop seam of A's animation (realtime only). */
  seam: SeamMetric | null;
  /** Realtime-only features (scrub, mix, slot edits) available. */
  canSeek: boolean;
  rigSource: string;
  /** Clip names in the loaded armature (empty = unknown): buttons for missing clips are disabled. */
  clips: string[];
  /** performance.now() of the last loop wrap (flashes the seam badge). */
  wrapAt: number;
}

export interface PanelHandlers {
  /** Any setting changed: re-apply to the actors. */
  onChange(): void;
  /** Restart both actors from t = 0. */
  onRestart(): void;
  /** Scrub actor(s) to a normalised position 0..1 (panel already paused playback). */
  onSeek(norm: number): void;
  /** Step actor(s) by one actual runtime tick in the given direction (paused). */
  onStep(direction: -1 | 1): void;
}

export type PanelLayout = { mode: 'side' | 'bottom'; sizePx: number };

const CSS = `
.vv{position:fixed;z-index:10;box-sizing:border-box;background:rgba(14,18,30,.94);color:#dfe6f5;font:13px/1.35 system-ui,sans-serif;
  display:flex;flex-direction:column;touch-action:manipulation;user-select:none;-webkit-user-select:none}
.vv *{box-sizing:border-box}
.vv.side{top:0;right:0;bottom:0;width:340px;overflow-y:auto;border-left:1px solid #2c3550}
.vv.bottom{left:0;right:0;bottom:0;height:46vh;border-top:1px solid #2c3550;padding-bottom:env(safe-area-inset-bottom)}
.vv .tabs{display:none;flex:0 0 auto;border-bottom:1px solid #2c3550}
.vv.bottom .tabs{display:flex}
.vv .tabs button{flex:1;min-height:44px;background:none;border:0;color:#9fb0d4;font-size:13px}
.vv .tabs button.on{color:#fff;border-bottom:3px solid #5b8cff}
.vv .body{flex:1 1 auto;overflow-y:auto;padding:8px 10px 14px}
.vv section{margin:0 0 12px}
.vv.bottom section{display:none}
.vv.bottom section.on{display:block}
.vv h3{margin:0 0 6px;font-size:12px;letter-spacing:.06em;text-transform:uppercase;color:#8ea2cf}
.vv .grid{display:grid;grid-template-columns:repeat(3,1fr);gap:5px}
.vv.bottom .grid{grid-template-columns:repeat(4,1fr)}
.vv button.b{min-height:34px;background:#1e2740;border:1px solid #33406a;color:#dfe6f5;border-radius:6px;font-size:12px;padding:2px 4px}
.vv.bottom button.b{min-height:44px;font-size:13px}
.vv button.b.on{background:#3558c8;border-color:#7da0ff;color:#fff}
.vv button.b.m{border-style:dashed}
.vv .compass{display:grid;grid-template-columns:repeat(3,1fr);gap:5px;max-width:260px}
.vv label.row{display:flex;align-items:center;gap:8px;margin:5px 0}
.vv label.row span.k{flex:0 0 96px;color:#9fb0d4}
.vv label.row span.v{flex:0 0 52px;text-align:right;font-variant-numeric:tabular-nums}
.vv input[type=range]{flex:1;min-width:0;height:28px}
.vv.bottom input[type=range]{height:40px}
.vv select{flex:1;min-height:34px;background:#1e2740;color:#dfe6f5;border:1px solid #33406a;border-radius:6px}
.vv.bottom select{min-height:44px}
.vv .chk{display:flex;align-items:center;gap:8px;min-height:30px}
.vv.bottom .chk{min-height:42px}
.vv .chk input{width:20px;height:20px}
.vv .info{font:12px/1.4 ui-monospace,Consolas,monospace;color:#b9c6e6;white-space:pre-wrap;word-break:break-word}
.vv .warn{color:#ffcf6b}
.vv .row2{display:flex;gap:6px;margin:6px 0}
.vv .row2 button{flex:1}
.vv a{color:#8fb0ff}
.vv .wrap{display:inline-block;padding:1px 8px;border-radius:10px;background:#1e2740;color:#5a6a95}
.vv .wrap.hot{background:#d9534f;color:#fff}
`;

const TABS = [
  ['anim', 'Anim'],
  ['dir', 'Dir'],
  ['play', 'Play'],
  ['layers', 'Layers'],
  ['compare', 'Modes'],
  ['info', 'Info'],
] as const;

const DIR_GRID: (Direction | null)[] = ['NW', 'N', 'NE', 'W', null, 'E', 'SW', 'S', 'SE'];

/**
 * DOM control panel overlaid on the Cocos canvas (Web). Desktop: right sidebar with all sections.
 * Mobile / touch (narrow or `#mobile`): bottom sheet with tabs, 44 px touch targets.
 * The panel only edits `ViewerSettings` and shows read-outs; the scene applies them.
 */
export class ViewerPanel {
  private readonly el: HTMLDivElement;
  private mode: PanelLayout['mode'] = 'side';
  private tab: (typeof TABS)[number][0] = 'anim';
  private dragging = false;
  private lastRefresh = 0;
  private readonly mq: MediaQueryList;
  onLayout: (() => void) | null = null;

  constructor(
    private readonly s: ViewerSettings,
    private readonly h: PanelHandlers,
  ) {
    const style = document.createElement('style');
    style.textContent = CSS;
    document.head.appendChild(style);
    this.el = document.createElement('div');
    this.el.id = 'vgtd-viewer';
    this.el.className = 'vv side';
    this.el.innerHTML = this.html();
    document.body.appendChild(this.el);
    this.mq = window.matchMedia('(max-width: 820px), (pointer: coarse) and (max-width: 1100px)');
    this.mq.addEventListener('change', () => this.layout());
    window.addEventListener('resize', () => this.layout());
    this.bind();
    this.layout();
    this.sync();
  }

  private html(): string {
    const btn = (data: string, label: string, extra = '') =>
      `<button class="b ${extra}" data-${data}>${label}</button>`;
    const anims = ALL_CLIPS.map((id) => btn(`anim="${id}"`, id)).join('');
    const compass = DIR_GRID.map((d) => (d ? btn(`dir="${d}"`, d) : '<span></span>')).join('');
    const slots = SPINE_SLOTS.map(
      (sl) =>
        `<label class="chk"><input type="checkbox" data-slot="${sl}"><span>${sl}</span><small data-slotnote="${sl}"></small></label>`,
    ).join('');
    const flag = (k: string, label: string) =>
      `<label class="chk"><input type="checkbox" data-flag="${k}"><span>${label}</span></label>`;
    const animsB = ALL_CLIPS.map((id) => `<option value="${id}">${id}</option>`).join('');
    return `
<div class="tabs">${TABS.map(([k, l]) => `<button data-tab="${k}">${l}</button>`).join('')}</div>
<div class="body">
 <section data-sec="anim"><h3>Animation (13)</h3><div class="grid">${anims}</div></section>
 <section data-sec="dir"><h3>Direction (5 drawn + mirror)</h3><div class="compass">${compass}</div>
   <div class="info" data-r="dirinfo" style="margin-top:6px"></div>
   <label class="chk"><input type="checkbox" data-r="eight"><span>drawn in 8 (no mirror)</span></label></section>
 <section data-sec="play"><h3>Playback</h3>
   <div class="row2"><button class="b" data-act="pause">Pause</button><button class="b" data-act="restart">Restart</button><button class="b" data-act="step-">-1f</button><button class="b" data-act="step+">+1f</button></div>
   <label class="row"><span class="k">scrub</span><input type="range" min="0" max="1000" value="0" data-r="scrub"><span class="v" data-r="scrubv">0.00</span></label>
   <label class="row"><span class="k">timeScale</span><input type="range" min="5" max="300" value="100" data-r="ts"><span class="v" data-r="tsv">1.00</span></label>
   <label class="row"><span class="k">mix (s)</span><input type="range" min="0" max="50" value="12" data-r="mix"><span class="v" data-r="mixv">0.12</span></label>
   <label class="row"><span class="k">profile</span><select data-r="profile"><option value="pc">pc (60 fps)</option><option value="mobileWeb">mobile/web (30)</option><option value="far">far (15)</option></select></label>
   <label class="chk"><input type="checkbox" data-r="repeat"><span>repeat one-shots</span></label>
   <div class="info"><span data-r="wrap" class="wrap">&#9679; wrap</span></div>
   <div class="info" data-r="timeinfo"></div></section>
 <section data-sec="layers"><h3>Paperdoll layers (13 slots)</h3>${slots}
   <div class="info">orbit_back / orbit_front are sprite nodes outside the skeleton (draw order 1 / 15).</div>
   <h3 style="margin-top:10px">Conflicts</h3>${flag('mounted', 'mounted (hides wing)')}${flag('swordInHand', 'sword in hand (hides sword_back)')}${flag('swordFlying', 'sword flying (hides sword_back)')}${flag('hoodedHeadwear', 'hood (hides hair_front)')}${flag('longRobe', 'long robe')}
   <label class="row"><span class="k">skin</span><select data-r="skin"><option value="default">default (blue)</option><option value="red">red</option></select></label>
   <div class="info" data-r="hidden"></div></section>
 <section data-sec="compare"><h3>View mode</h3>
   <div class="row2"><button class="b" data-mode="single">Single</button><button class="b" data-mode="compare">Compare</button><button class="b" data-mode="review">Review</button><button class="b" data-mode="crowd">Crowd</button></div>
   <div class="info">Compare: A and B side by side. Review: all 8 directions (5 drawn + mirror) of A's animation, synced. Crowd: 30 copies (CPU update / render ms in the HUD, for cache-mode comparisons).</div>
   <label class="row"><span class="k">B plays</span><select data-r="animb">${animsB}</select></label>
   <label class="chk"><input type="checkbox" data-r="onion"><span>onion skin (blue = -2f, red = +2f)</span></label>
   <div class="row2"><button class="b" data-act="restart">Sync restart</button></div>
   <label class="chk"><input type="checkbox" data-r="batch"><span>batch armatures (enableBatch)</span></label>
   <label class="row"><span class="k">cache mode</span><select data-r="cache"><option value="realtime">realtime</option><option value="shared">shared cache</option><option value="private">private cache</option></select></label>
   <div class="info" data-r="cmpinfo"></div>
   <div class="info" data-r="seam" style="margin-top:6px"></div></section>
 <section data-sec="info"><h3>Events &amp; checks</h3><div class="info" data-r="events">-</div>
   <div class="info" data-r="draworder" style="margin-top:6px"></div>
   <div class="info" style="margin-top:8px">keys: Space pause, &larr;/&rarr; direction, &uarr;/&darr; animation, [ ] speed<br><a href="#" data-act="world">&larr; world demo</a></div></section>
</div>`;
  }

  private q<T extends HTMLElement>(sel: string): T {
    return this.el.querySelector(sel) as T;
  }
  private all<T extends HTMLElement>(sel: string): T[] {
    return Array.from(this.el.querySelectorAll(sel)) as T[];
  }

  private bind(): void {
    const s = this.s;
    const changed = () => {
      this.sync();
      this.h.onChange();
    };
    this.el.addEventListener('click', (ev) => {
      const t = (ev.target as HTMLElement).closest(
        '[data-anim],[data-dir],[data-act],[data-tab],[data-mode]',
      ) as HTMLElement | null;
      if (!t) return;
      const d = t.dataset;
      if (d.mode) {
        s.mode = d.mode as ViewerSettings['mode'];
        changed();
      } else if (d.tab) {
        this.tab = d.tab as typeof this.tab;
        this.sync();
      } else if (d.anim) {
        // in compare mode with B focused we still edit A; B has its own selector
        s.animation = d.anim as ClipId;
        changed();
      } else if (d.dir) {
        s.direction = d.dir as Direction;
        changed();
      } else if (d.act === 'pause') {
        s.paused = !s.paused;
        changed();
      } else if (d.act === 'restart') {
        s.scrub = null;
        this.h.onRestart();
      } else if (d.act === 'step+' || d.act === 'step-') {
        s.paused = true;
        this.sync();
        this.h.onChange();
        this.h.onStep(d.act === 'step+' ? 1 : -1);
      } else if (d.act === 'world') {
        ev.preventDefault();
        location.hash = '';
        location.reload();
      }
    });
    const range = (sel: string, fn: (v: number) => void) =>
      this.q<HTMLInputElement>(sel).addEventListener('input', (e) => fn(Number((e.target as HTMLInputElement).value)));
    range('[data-r=scrub]', (v) => {
      s.paused = true;
      s.scrub = v / 1000;
      this.sync();
      this.h.onChange();
      this.h.onSeek(v / 1000);
    });
    const scrubEl = this.q<HTMLInputElement>('[data-r=scrub]');
    scrubEl.addEventListener('pointerdown', () => (this.dragging = true));
    window.addEventListener('pointerup', () => (this.dragging = false));
    range('[data-r=ts]', (v) => {
      s.timeScale = v / 100;
      changed();
    });
    range('[data-r=mix]', (v) => {
      s.mixDuration = v / 100;
      changed();
    });
    this.q<HTMLSelectElement>('[data-r=profile]').addEventListener('change', (e) => {
      s.profile = (e.target as HTMLSelectElement).value as ViewerSettings['profile'];
      changed();
    });
    this.q<HTMLSelectElement>('[data-r=skin]').addEventListener('change', (e) => {
      s.skin = (e.target as HTMLSelectElement).value as SkinName;
      changed();
    });
    this.q<HTMLSelectElement>('[data-r=animb]').addEventListener('change', (e) => {
      s.animationB = (e.target as HTMLSelectElement).value as ClipId;
      changed();
    });
    this.q<HTMLInputElement>('[data-r=onion]').addEventListener('change', (e) => {
      s.onion = (e.target as HTMLInputElement).checked;
      changed();
    });
    this.q<HTMLInputElement>('[data-r=batch]').addEventListener('change', (e) => {
      s.batch = (e.target as HTMLInputElement).checked;
      changed();
    });
    this.q<HTMLSelectElement>('[data-r=cache]').addEventListener('change', (e) => {
      s.cache = (e.target as HTMLSelectElement).value as ViewerSettings['cache'];
      changed();
    });
    this.q<HTMLInputElement>('[data-r=repeat]').addEventListener('change', (e) => {
      s.repeatOneShots = (e.target as HTMLInputElement).checked;
      changed();
    });
    this.q<HTMLInputElement>('[data-r=eight]').addEventListener('change', (e) => {
      s.drawnInEight = (e.target as HTMLInputElement).checked;
      changed();
    });
    for (const cb of this.all<HTMLInputElement>('[data-slot]')) {
      cb.addEventListener('change', () => {
        const slot = cb.dataset.slot as SlotId;
        if (cb.checked) s.equipped.add(slot);
        else s.equipped.delete(slot);
        changed();
      });
    }
    for (const cb of this.all<HTMLInputElement>('[data-flag]')) {
      cb.addEventListener('change', () => {
        (s.flags as Record<string, boolean>)[cb.dataset.flag!] = cb.checked;
        changed();
      });
    }
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement).tagName === 'SELECT') return;
      const dirs = ALL_DIRECTIONS;
      const i = dirs.indexOf(s.direction);
      const a = ALL_CLIPS.indexOf(s.animation);
      if (e.code === 'Space') s.paused = !s.paused;
      else if (e.code === 'ArrowRight') s.direction = dirs[(i + 1) % dirs.length]!;
      else if (e.code === 'ArrowLeft') s.direction = dirs[(i + dirs.length - 1) % dirs.length]!;
      else if (e.code === 'ArrowDown') s.animation = ALL_CLIPS[(a + 1) % ALL_CLIPS.length]!;
      else if (e.code === 'ArrowUp') s.animation = ALL_CLIPS[(a + ALL_CLIPS.length - 1) % ALL_CLIPS.length]!;
      else if (e.code === 'BracketRight') s.timeScale = Math.min(3, Math.round((s.timeScale + 0.1) * 10) / 10);
      else if (e.code === 'BracketLeft') s.timeScale = Math.max(0.05, Math.round((s.timeScale - 0.1) * 10) / 10);
      else return;
      e.preventDefault();
      changed();
    });
  }

  /** Show an error banner at the top of the panel (also logged to the console). */
  fail(message: string): void {
    console.error('[viewer]', message);
    let b = this.el.querySelector<HTMLElement>('[data-r=err]');
    if (!b) {
      b = document.createElement('div');
      b.dataset.r = 'err';
      b.style.cssText =
        'background:#7a1f1f;color:#fff;padding:6px 10px;font:12px monospace;white-space:pre-wrap;word-break:break-word';
      this.el.insertBefore(b, this.el.firstChild);
    }
    b.textContent = message;
  }

  /** Reflect `settings` into the controls. */
  sync(): void {
    const s = this.s;
    for (const b of this.all('[data-anim]')) b.classList.toggle('on', b.dataset.anim === s.animation);
    for (const b of this.all('[data-dir]')) {
      b.classList.toggle('on', b.dataset.dir === s.direction);
      b.classList.toggle('m', MIRRORED.has(b.dataset.dir as Direction));
    }
    for (const b of this.all('[data-tab]')) b.classList.toggle('on', b.dataset.tab === this.tab);
    for (const sec of this.all('[data-sec]')) sec.classList.toggle('on', sec.dataset.sec === this.tab);
    this.q('[data-act=pause]').textContent = s.paused ? 'Play' : 'Pause';
    for (const cb of this.all<HTMLInputElement>('[data-slot]')) cb.checked = s.equipped.has(cb.dataset.slot as SlotId);
    for (const cb of this.all<HTMLInputElement>('[data-flag]'))
      cb.checked = (s.flags as Record<string, boolean>)[cb.dataset.flag!]!;
    this.q<HTMLInputElement>('[data-r=onion]').checked = s.onion;
    this.q<HTMLSelectElement>('[data-r=cache]').value = s.cache;
    this.q<HTMLInputElement>('[data-r=batch]').checked = s.batch;
    for (const b of this.all('[data-mode]')) b.classList.toggle('on', b.dataset.mode === s.mode);
    this.q<HTMLInputElement>('[data-r=repeat]').checked = s.repeatOneShots;
    this.q<HTMLSelectElement>('[data-r=animb]').value = s.animationB;
    this.q<HTMLSelectElement>('[data-r=profile]').value = s.profile;
    this.q<HTMLSelectElement>('[data-r=skin]').value = s.skin;
    this.q<HTMLInputElement>('[data-r=ts]').value = String(Math.round(s.timeScale * 100));
    this.q('[data-r=tsv]').textContent = s.timeScale.toFixed(2);
    this.q<HTMLInputElement>('[data-r=mix]').value = String(Math.round(s.mixDuration * 100));
    this.q('[data-r=mixv]').textContent = s.mixDuration.toFixed(2);
  }

  private layout(): void {
    const force = /mobile/.test(location.hash);
    const bottom = force || this.mq.matches;
    this.mode = bottom ? 'bottom' : 'side';
    this.el.className = `vv ${this.mode}`;
    this.sync();
    this.onLayout?.();
  }

  /** CSS px the panel covers (the scene keeps the actors centred in the remaining area). */
  getLayout(): PanelLayout {
    const r = this.el.getBoundingClientRect();
    return this.mode === 'side' ? { mode: 'side', sizePx: r.width } : { mode: 'bottom', sizePx: r.height };
  }

  /** Per-frame read-outs (throttled to ~10 Hz). */
  refresh(now: number, info: PanelInfo): void {
    if (now - this.lastRefresh < 100) return;
    this.lastRefresh = now;
    const s = this.s;
    for (const b of this.all<HTMLButtonElement>('[data-anim]')) {
      b.disabled = info.clips.length > 0 && !info.clips.includes(b.dataset.anim!);
      b.style.opacity = b.disabled ? '0.35' : '';
    }
    const fmt = (f: ActorFrame | null) =>
      f ? `${f.time.toFixed(2)} / ${f.duration.toFixed(2)} s  frame ${f.frame + 1}/${f.frames}` : '-';
    const a = info.viewA.animation;
    if (!this.dragging && info.a)
      this.q<HTMLInputElement>('[data-r=scrub]').value = String(Math.round((info.a.time / info.a.duration) * 1000));
    this.q('[data-r=scrubv]').textContent = info.a ? info.a.time.toFixed(2) : '-';
    this.q('[data-r=timeinfo]').textContent =
      `A ${fmt(info.a)}\n${a.loop ? 'loop' : 'one-shot'}  table ${a.fps} fps  playback ${a.playbackFps} fps\n` +
      `events: ${a.events.map((e) => `${e.name}@${'frame' in e.at ? 'f' + e.at.frame : e.at.phase}`).join(', ') || '-'}`;
    const v = info.viewA;
    this.q('[data-r=dirinfo]').textContent =
      `${v.direction} -> rig ${v.skeletonDirection}${v.mirrored ? ' + mirror (scaleX -1)' : ''}   plays: ${info.rigDir ?? 'loading...'}`;
    this.q<HTMLInputElement>('[data-r=eight]').checked = s.drawnInEight ?? this.defaultEight(v);
    const hidden = v.hidden.map((h) => `${h.slot} (${h.reason})`);
    const unequipped = SPINE_SLOTS.filter((sl) => !s.equipped.has(sl));
    this.q('[data-r=hidden]').textContent =
      `hidden by rules: ${hidden.join(', ') || '-'}\nunequipped: ${unequipped.join(', ') || '-'}`;
    this.q('[data-r=cmpinfo]').textContent =
      (s.mode === 'compare'
        ? `A ${s.animation}: ${fmt(info.a)}
B ${s.animationB}: ${fmt(info.b)}
`
        : `mode: ${s.mode}
`) +
      `rig: ${info.rigSource}
` +
      (info.canSeek
        ? 'realtime: mix, scrub, slot toggles available'
        : 'CACHED mode: no mix / scrub / slot toggles (DragonBones limitation)');
    this.q('[data-r=wrap]').classList.toggle('hot', now - info.wrapAt < 250);
    const sm = info.seam;
    const seamLine = sm
      ? `wrap step ${sm.seamStep.toFixed(1)} vs mean step ${sm.meanStep.toFixed(1)} (x${sm.ratio.toFixed(2)})`
      : '';
    this.q('[data-r=seam]').innerHTML = !sm
      ? 'loop seam: n/a'
      : sm.specLoop
        ? `loop seam: ${seamLine} ` + (sm.ratio > 2.5 ? '<span class="warn">POP at the loop point</span>' : 'ok')
        : `one-shot (not a loop in the table): ${seamLine}, informational`;
    this.q('[data-r=events]').textContent = info.events.length ? info.events.join('\n') : 'no events yet';
    const d = info.drawDelta;
    this.q('[data-r=draworder]').innerHTML = d.length
      ? `<span class="warn">draw order: ${d.length} slot(s) differ from the ${v.direction} table in the ${info.rigDir} rig (mirrored directions reuse the drawn rig): ${d.join(', ')}</span>`
      : `draw order matches the ${v.direction} paperdoll table`;
  }

  private defaultEight(v: character.CharacterViewState): boolean {
    return v.skeletonDirection === v.direction && !v.mirrored && ['W', 'SW', 'NW'].includes(v.direction);
  }

  /** Hide / show the whole panel (clean capture frames). */
  setVisible(v: boolean): void {
    this.el.style.display = v ? '' : 'none';
  }

  destroy(): void {
    this.el.remove();
  }
}

/** Directions that are mirrors of a drawn one (SW, W, NW) - dashed border in the compass. Source: character policy. */
const MIRRORED = new Set<Direction>(Object.keys(character.getDirectionPolicy('player').mirrored) as Direction[]);
