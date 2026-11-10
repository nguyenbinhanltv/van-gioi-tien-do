import { core } from './vendor/vgtd.mjs';
import { GOLD_LIGHT, frameStyle, typingTarget } from './HudChrome';

const KEY_VOLUME = 'vgtd.settings.volume';
const KEY_DEBUG = 'vgtd.settings.debug';

/** Master volume 0-100 (stored for the audio system; nothing plays sound yet). */
export function savedVolume(): number {
  try {
    const n = Number(localStorage.getItem(KEY_VOLUME));
    return Number.isFinite(n) && localStorage.getItem(KEY_VOLUME) !== null ? Math.max(0, Math.min(100, n)) : 80;
  } catch {
    return 80;
  }
}

/** Was the debug overlay left on from a previous session (the checkbox below)? */
export function savedDebug(): boolean {
  try {
    return localStorage.getItem(KEY_DEBUG) === '1';
  } catch {
    return false;
  }
}

export interface SettingsHooks {
  debugOn(): boolean;
  setDebug(on: boolean): void;
  /** Esc closes the topmost open panel first; true when it closed one (the settings stay closed) */
  closeTopPanel(): boolean;
}

/**
 * Settings (Esc): master volume (stored, no audio yet), the debug overlay switch (same as F3 / backquote / `?debug=1`) and a language
 * placeholder (only Tiếng Việt exists). Framed DOM panel; everything it saves goes to localStorage.
 */
export class SettingsPanel {
  private readonly root: HTMLDivElement;
  private readonly debug: HTMLInputElement;
  private open = false;
  private readonly keyDown: (e: KeyboardEvent) => void;
  volume = savedVolume();

  constructor(
    private readonly hooks: SettingsHooks,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-settings';
    Object.assign(root.style, frameStyle(0.95), {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '340px',
      maxWidth: 'calc(100vw - 24px)',
      padding: '10px 14px 14px',
      display: 'none',
      font: '13px/1.4 sans-serif',
      zIndex: '470',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' });
    const title = document.createElement('div');
    title.textContent = core.t('hud.settings.title');
    Object.assign(title.style, { fontWeight: 'bold', fontSize: '15px', color: GOLD_LIGHT });
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = core.t('hud.close');
    Object.assign(close.style, {
      cursor: 'pointer',
      background: 'transparent',
      color: '#f0ecdf',
      border: '0',
      font: '18px/1 sans-serif',
    });
    close.addEventListener('click', () => this.toggle(false));
    head.append(title, close);

    const row = (label: string, control: HTMLElement, note?: string): HTMLDivElement => {
      const r = document.createElement('div');
      Object.assign(r.style, { padding: '6px 0', borderBottom: '1px solid rgba(201,162,74,0.25)' });
      const line = document.createElement('div');
      Object.assign(line.style, {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: '12px',
      });
      const l = document.createElement('span');
      l.textContent = label;
      line.append(l, control);
      r.appendChild(line);
      if (note) {
        const n = document.createElement('div');
        n.textContent = note;
        Object.assign(n.style, { fontSize: '11px', color: '#9fb5aa', marginTop: '2px' });
        r.appendChild(n);
      }
      return r;
    };

    const vol = document.createElement('input');
    vol.type = 'range';
    vol.min = '0';
    vol.max = '100';
    vol.value = String(this.volume);
    vol.style.width = '150px';
    vol.addEventListener('input', () => {
      this.volume = Number(vol.value);
      try {
        localStorage.setItem(KEY_VOLUME, String(this.volume));
      } catch {
        /* storage blocked: the slider still moves, nothing is kept */
      }
    });
    this.debug = document.createElement('input');
    this.debug.type = 'checkbox';
    this.debug.addEventListener('change', () => {
      this.hooks.setDebug(this.debug.checked);
      try {
        localStorage.setItem(KEY_DEBUG, this.debug.checked ? '1' : '0');
      } catch {
        /* storage blocked: the switch still works for this session */
      }
    });
    const lang = document.createElement('select');
    const vi = document.createElement('option');
    vi.value = 'vi-VN';
    vi.textContent = core.t('hud.settings.language_vi');
    const en = document.createElement('option');
    en.value = 'en';
    en.disabled = true;
    en.textContent = core.t('hud.settings.language_en');
    lang.append(vi, en);

    root.append(
      head,
      row(core.t('hud.settings.volume'), vol, core.t('hud.settings.volume_note')),
      row(core.t('hud.settings.debug'), this.debug),
      row(core.t('hud.settings.language'), lang, core.t('hud.settings.language_note')),
    );
    parent.appendChild(root);
    this.root = root;

    this.keyDown = (e) => {
      if (e.code !== 'Escape' || e.repeat || typingTarget(e)) return;
      if (this.open) this.toggle(false);
      else if (!this.hooks.closeTopPanel()) this.toggle(true);
    };
    window.addEventListener('keydown', this.keyDown);
  }

  get visible(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
    if (this.open) this.debug.checked = this.hooks.debugOn();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.root.remove();
  }
}
