/**
 * Crafting panel (D108, docs/13 §9, docs/10 §6 "luyện đan tối giản"): a small DOM overlay on the left, toggled with `P`. One row per recipe with the
 * numbers of docs/13 (success chance at your mastery, furnace fee in Linh thạch hạ, materials needed / held, best quality), a count box (1..10) and
 * a "Luyện" button; while a job runs a "Dừng" button and the progress line replace them. Everything shown is `CraftModel` from client-core (the same
 * formulas the server uses), drawn with `textContent` ONLY, and every button just sends the command: the server decides (realm, distance to the
 * furnace NPC, materials, stones, bag room) and rolls. Moving or fighting cancels a job without losing anything, so the panel never blocks input.
 *
 * It costs no draw calls (DOM, not the Cocos canvas), sits below the chat box (z-index 440) and stops above it (it scrolls inside).
 */
import { core } from './vendor/vgtd.mjs';

type Model = InstanceType<typeof core.CraftModel>;

const BTN: Partial<CSSStyleDeclaration> = {
  padding: '2px 8px',
  font: '11px sans-serif',
  color: '#f0f0f5',
  background: '#33405a',
  border: '1px solid #7fd4ff',
  borderRadius: '4px',
  cursor: 'pointer',
};
const TONE: Record<string, string> = { good: '#8fe0a0', bad: '#ff8f85', info: '#f0dc96' };

export interface CraftPanelHooks {
  /** the player's tile position (null until known) */
  position(): { i: number; j: number } | null;
  /** send a craft command; false = socket closed */
  send(m: { op: number; requestId: string; recipeId: number; count: number }): boolean;
}

export class CraftPanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly toast: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly counts = new Map<number, number>();
  private open = false;
  private drawn = '';

  constructor(
    private readonly model: Model,
    private readonly hooks: CraftPanelHooks,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-craft';
    Object.assign(root.style, {
      position: 'fixed',
      left: '16px',
      top: '96px',
      width: '330px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 340px)', // leaves the chat box (bottom left) uncovered
      overflowY: 'auto',
      display: 'none',
      padding: '8px',
      font: '12px/1.35 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.88)',
      border: '1px solid #7fd4ff',
      borderRadius: '8px',
      zIndex: '440',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    const title = document.createElement('div');
    title.textContent = 'Luyện đan · Đan lô Sơn Môn';
    title.style.fontWeight = 'bold';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Đóng (P)';
    Object.assign(close.style, BTN);
    close.addEventListener('click', () => this.toggle(false));
    head.append(title, close);
    this.status = document.createElement('div');
    Object.assign(this.status.style, { color: '#b6bccb', marginBottom: '6px' });
    this.body = document.createElement('div');
    this.toast = document.createElement('div');
    Object.assign(this.toast.style, { marginTop: '6px', minHeight: '16px' });
    root.append(head, this.status, this.body, this.toast);
    parent.appendChild(root);
    this.root = root;

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return; // typing in the chat box
      if (e.code === 'KeyP') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);

    // automation hook (scripts/craft-online-smoke.mjs): what the panel shows, without reading the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdCraft = {
      visible: () => this.open,
      toggle: () => this.toggle(),
      recipes: () => this.model.recipes(this.hooks.position()),
      job: () => this.model.job(),
      toastText: () => this.model.toast()?.text ?? '',
      start: (wireId: number, count: number) => this.model.start(wireId, count, this.hooks.send),
      cancel: () => this.model.cancel(this.hooks.send),
    };
  }

  get visible(): boolean {
    return this.open;
  }
  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
    this.drawn = '';
  }

  /** Per frame: redraw only when what it shows changed (the progress line changes every second). */
  update(): void {
    if (!this.open) return;
    const pos = this.hooks.position();
    const job = this.model.job();
    const sig = JSON.stringify([
      this.model.version,
      Math.floor((job?.remainingMs ?? 0) / 500),
      this.model.recipes(pos).map((r) => [r.canStart, r.have, r.stones]),
      this.model.toast()?.text ?? '',
      this.model.nearFurnace(pos),
    ]);
    if (sig === this.drawn) return;
    this.drawn = sig;
    this.status.textContent = this.model.statusLine(pos);
    const frag = document.createDocumentFragment();
    for (const r of this.model.recipes(pos)) {
      const row = document.createElement('div');
      row.dataset.recipe = String(r.wireId);
      Object.assign(row.style, { padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' });
      const top = document.createElement('div');
      top.textContent = `${r.name} · bậc ${r.tier} · độ khó ${r.difficulty}`;
      top.style.fontWeight = 'bold';
      const info = document.createElement('div');
      info.textContent =
        `Nguyên liệu ${r.have}/${r.materials} · phí lò ${r.fee} LT hạ · thành công ${Math.round(r.chance * 100)}% · ` +
        `phẩm tối đa ${r.capName} · thạo luyện ${r.mastery}/100`;
      info.style.color = r.have >= r.materials ? '#cfd4e2' : '#ff9f95';
      const act = document.createElement('div');
      Object.assign(act.style, { display: 'flex', alignItems: 'center', gap: '6px', marginTop: '3px' });
      const n = document.createElement('input');
      n.type = 'number';
      n.min = '1';
      n.max = '10';
      n.value = String(this.counts.get(r.wireId) ?? 1);
      Object.assign(n.style, { width: '44px', font: '11px sans-serif' });
      n.addEventListener('keydown', (e) => e.stopPropagation()); // typing a number must not walk / cast
      n.addEventListener('keyup', (e) => e.stopPropagation());
      n.addEventListener('change', () =>
        this.counts.set(r.wireId, Math.min(10, Math.max(1, Math.floor(Number(n.value) || 1)))),
      );
      const go = document.createElement('button');
      go.textContent = 'Luyện';
      Object.assign(go.style, BTN);
      go.disabled = !r.canStart;
      go.style.opacity = r.canStart ? '1' : '0.5';
      go.addEventListener('click', () => {
        const count = Math.min(10, Math.max(1, Math.floor(Number(n.value) || 1)));
        this.counts.set(r.wireId, count);
        this.model.start(r.wireId, count, this.hooks.send);
      });
      act.append(n, go);
      row.append(top, info, act);
      frag.appendChild(row);
    }
    if (job) {
      const stop = document.createElement('button');
      stop.textContent = `Dừng (${job.name} ${job.done}/${job.total})`;
      Object.assign(stop.style, BTN);
      stop.style.marginTop = '6px';
      stop.addEventListener('click', () => this.model.cancel(this.hooks.send));
      frag.appendChild(stop);
    }
    this.body.replaceChildren(frag);
    const t = this.model.toast();
    this.toast.textContent = t?.text ?? '';
    this.toast.style.color = t ? (TONE[t.tone] ?? '#f0f0f5') : '#f0f0f5';
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.root.remove();
  }
}
