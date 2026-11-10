import { core } from './vendor/vgtd.mjs';
import { domIcon } from './DomIcons';
import { GOLD, GOLD_LIGHT, INK, placeDesign } from './HudChrome';

export interface MenuEntry {
  id: string;
  /** HUD icon id (`HUD_ICON_IDS`), null = the short text instead */
  icon: string | null;
  /** string-table key of the 1-2 letter fallback shown when there is no icon art */
  shortKey: Parameters<typeof core.t>[0];
  /** string-table key of the full name (tooltip) */
  nameKey: Parameters<typeof core.t>[0];
  /** the hotkey the system already answers to ('' = none), shown on the button */
  key: string;
  /** what the button does; null = no panel for it yet (shown dimmed, tooltip says so) */
  run: (() => void) | null;
  /** online-only systems: dimmed with a hint while this says false */
  available?: () => boolean;
}

/**
 * Menu bar (bottom-right on desktop): one button per system that already exists but had no way to reach it except a hotkey nobody knows.
 * DOM overlay (no draw call). The hotkeys themselves stay with each panel (Bag B, Character C, Sect K, Quests J, Friends O, World map L,
 * Settings Esc); this bar is the clickable index. Placed by the shared HUD layout (`menu-bar`).
 */
export class MenuBar {
  private readonly root: HTMLDivElement;
  private readonly buttons = new Map<string, { el: HTMLButtonElement; entry: MenuEntry }>();

  constructor(entries: readonly MenuEntry[], parent: HTMLElement = document.body) {
    const root = document.createElement('div');
    root.id = 'vgtd-menu-bar';
    Object.assign(root.style, {
      position: 'fixed',
      display: 'grid',
      zIndex: '430',
      pointerEvents: 'none', // only the buttons take clicks
    } as Partial<CSSStyleDeclaration>);
    for (const entry of entries) {
      const b = document.createElement('button');
      b.dataset.menu = entry.id;
      b.type = 'button';
      Object.assign(b.style, {
        position: 'relative',
        padding: '0',
        cursor: 'pointer',
        pointerEvents: 'auto',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        border: `2px solid ${GOLD}`,
        borderRadius: '8px',
        background: 'linear-gradient(180deg, rgba(40,62,54,0.95), rgba(12,20,22,0.95))',
        boxShadow: 'inset 0 0 0 1px rgba(255,236,170,0.25), 0 2px 5px rgba(0,0,0,0.6)',
        color: GOLD_LIGHT,
        font: 'bold 12px sans-serif',
      } as Partial<CSSStyleDeclaration>);
      const ic = entry.icon ? domIcon('hud', entry.icon, 24) : null;
      if (ic) {
        ic.style.marginRight = '0';
        b.appendChild(ic);
      } else {
        const t = document.createElement('span');
        t.textContent = core.t(entry.shortKey);
        b.appendChild(t);
      }
      if (entry.key) {
        const k = document.createElement('span');
        k.textContent = entry.key;
        Object.assign(k.style, {
          position: 'absolute',
          right: '2px',
          bottom: '0',
          font: 'bold 9px/10px sans-serif',
          color: INK,
          textShadow: '0 1px 2px #000, 0 0 3px #000',
          pointerEvents: 'none',
        } as Partial<CSSStyleDeclaration>);
        b.appendChild(k);
      }
      b.addEventListener('click', () => {
        if (this.enabled(entry)) entry.run?.();
      });
      // pointer presses here must not start click-to-move on the canvas below
      b.addEventListener('pointerdown', (e) => e.stopPropagation());
      root.appendChild(b);
      this.buttons.set(entry.id, { el: b, entry });
    }
    parent.appendChild(root);
    this.root = root;
    this.refresh();
  }

  private enabled(e: MenuEntry): boolean {
    return e.run !== null && (e.available?.() ?? true);
  }

  /** Dim the entries that cannot open right now and keep each tooltip in step. */
  refresh(): void {
    for (const { el, entry } of this.buttons.values()) {
      const ok = this.enabled(entry);
      el.style.opacity = ok ? '1' : '0.45';
      el.style.cursor = ok ? 'pointer' : 'default';
      const name = core.t(entry.nameKey);
      el.title = !entry.run
        ? core.t('hud.menu.todo', { name })
        : !ok
          ? core.t('hud.menu.needs_online', { name })
          : core.t('hud.menu.title_fmt', { name, key: entry.key || '-' });
      el.setAttribute('aria-label', name);
    }
  }

  place(
    rect: { x: number; y: number; w: number; h: number },
    f: number,
    grid: { button: number; gap: number; cols: number },
  ): void {
    Object.assign(this.root.style, {
      gridTemplateColumns: `repeat(${grid.cols}, ${grid.button}px)`,
      gridAutoRows: `${grid.button}px`,
      gap: `${grid.gap}px`,
    } as Partial<CSSStyleDeclaration>);
    placeDesign(this.root, rect, f);
  }

  destroy(): void {
    this.root.remove();
  }
}
