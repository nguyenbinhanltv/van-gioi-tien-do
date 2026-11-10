import { core } from './vendor/vgtd.mjs';
import { GOLD_LIGHT, frameStyle, typingTarget } from './HudChrome';
import type { PlayerFrameSource } from './PlayerFrame';

export interface CharacterSource extends PlayerFrameSource {
  /** tu vi line (`123 / 1000`), '' when the server has not told us yet */
  tuVi(): string;
  /** Nghiệp Lực / Đạo Tâm line (D103), '' when none */
  standing(): string;
}

/**
 * Character sheet (key C): the numbers the client already has about the own character, nothing invented: name, class, realm, tu vi, HP / MP
 * (combat HUD vitals) and the standing line. A minimal framed panel (the full stat sheet waits for the equipment system, see PR notes).
 */
export class CharacterPanel {
  private readonly root: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private open = false;
  private readonly keyDown: (e: KeyboardEvent) => void;

  constructor(
    private readonly src: CharacterSource,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-character';
    Object.assign(root.style, frameStyle(0.94), {
      position: 'fixed',
      left: '50%',
      top: '50%',
      transform: 'translate(-50%,-50%)',
      width: '320px',
      maxWidth: 'calc(100vw - 24px)',
      padding: '10px 14px 14px',
      display: 'none',
      font: '13px/1.4 sans-serif',
      zIndex: '455',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '8px' });
    const title = document.createElement('div');
    title.textContent = core.t('hud.char.title');
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
    this.rows = document.createElement('div');
    root.append(head, this.rows);
    parent.appendChild(root);
    this.root = root;
    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey || typingTarget(e)) return;
      if (e.code === 'KeyC') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);
  }

  get visible(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
    if (this.open) this.render();
  }

  private render(): void {
    const v = this.src.vitals();
    const none = core.t('hud.char.none');
    const lines: Array<[string, string]> = [
      [core.t('hud.char.name'), this.src.name()],
      [core.t('hud.char.class'), this.src.className()],
      [core.t('hud.char.realm'), this.src.realm() || none],
      [core.t('hud.char.tu_vi'), this.src.tuVi() || none],
      [core.t('hud.char.hp'), v ? `${Math.ceil(v.hp)} / ${Math.round(v.hpMax)}` : none],
      [core.t('hud.char.mp'), v ? `${Math.ceil(v.mp)} / ${Math.round(v.mpMax)}` : none],
      [core.t('hud.char.standing'), this.src.standing() || none],
    ];
    this.rows.replaceChildren(
      ...lines.map(([k, val]) => {
        const row = document.createElement('div');
        Object.assign(row.style, {
          display: 'flex',
          justifyContent: 'space-between',
          gap: '12px',
          padding: '3px 0',
          borderBottom: '1px solid rgba(201,162,74,0.25)',
        });
        const a = document.createElement('span');
        a.textContent = k;
        a.style.color = '#b9cfc4';
        const b = document.createElement('span');
        b.textContent = val;
        b.style.textAlign = 'right';
        row.append(a, b);
        return row;
      }),
    );
  }

  /** Keep the numbers live while open. */
  update(): void {
    if (this.open) this.render();
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.root.remove();
  }
}
