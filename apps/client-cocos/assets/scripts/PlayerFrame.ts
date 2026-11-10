import { core } from './vendor/vgtd.mjs';
import { GOLD, GOLD_LIGHT, frameStyle, makeBar, placeDesign } from './HudChrome';

export interface PlayerFrameSource {
  name(): string;
  /** class name (Kiếm tu, ...) */
  className(): string;
  /** realm label from the server (`Luyện Khí tầng 3`), '' when not known yet */
  realm(): string;
  /** own vitals, null when there is no combat HUD (no HP / MP to show) */
  vitals(): { hp: number; hpMax: number; mp: number; mpMax: number; shield: number } | null;
}

/**
 * Player frame (top-left): avatar ring, name, class + realm, HP and MP bars. A DOM widget (no draw call); the bars read the combat HUD's own
 * vitals (server-authoritative online), the realm is the server's `char_state` label. Placed by the shared HUD layout (`player-frame`).
 */
export class PlayerFrame {
  private readonly root: HTMLDivElement;
  private readonly avatar: HTMLDivElement;
  private readonly name: HTMLDivElement;
  private readonly sub: HTMLDivElement;
  private readonly bars: HTMLDivElement;
  private readonly hp = makeBar('linear-gradient(180deg,#e0605a,#a82a2a)', 16);
  private readonly mp = makeBar('linear-gradient(180deg,#5f8fe6,#2a4fa8)', 14);
  private lastKey = '';

  constructor(
    private readonly src: PlayerFrameSource,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-player-frame';
    Object.assign(root.style, frameStyle(), {
      position: 'fixed',
      display: 'flex',
      gap: '8px',
      padding: '6px 8px',
      font: '12px/1.2 sans-serif',
      zIndex: '420',
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    this.avatar = document.createElement('div');
    Object.assign(this.avatar.style, {
      flex: '0 0 auto',
      width: '54px',
      height: '54px',
      alignSelf: 'center',
      borderRadius: '50%',
      border: `3px double ${GOLD}`,
      background: 'radial-gradient(circle at 35% 30%, #4a7a68, #16302a)',
      color: GOLD_LIGHT,
      font: 'bold 24px/48px sans-serif',
      textAlign: 'center',
      textShadow: '0 1px 3px #000',
      boxShadow: '0 0 6px rgba(240,217,138,0.35)',
    } as Partial<CSSStyleDeclaration>);
    const col = document.createElement('div');
    Object.assign(col.style, { flex: '1 1 auto', minWidth: '0', display: 'flex', flexDirection: 'column', gap: '3px' });
    this.name = document.createElement('div');
    Object.assign(this.name.style, {
      font: 'bold 14px/16px sans-serif',
      color: GOLD_LIGHT,
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    } as Partial<CSSStyleDeclaration>);
    this.sub = document.createElement('div');
    Object.assign(this.sub.style, {
      fontSize: '11px',
      color: '#cfe3d8',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    } as Partial<CSSStyleDeclaration>);
    this.bars = document.createElement('div');
    Object.assign(this.bars.style, { display: 'flex', flexDirection: 'column', gap: '3px' });
    this.bars.append(this.hp.track, this.mp.track);
    col.append(this.name, this.sub, this.bars);
    root.append(this.avatar, col);
    parent.appendChild(root);
    this.root = root;
  }

  place(rect: { x: number; y: number; w: number; h: number }, f: number): void {
    placeDesign(this.root, rect, f);
  }

  update(): void {
    const v = this.src.vitals();
    const realm = this.src.realm();
    const key = `${this.src.name()}|${this.src.className()}|${realm}`;
    if (key !== this.lastKey) {
      this.lastKey = key;
      const name = this.src.name();
      this.name.textContent = name;
      this.avatar.textContent = (name[0] ?? '?').toUpperCase();
      this.sub.textContent = realm
        ? core.t('hud.player.sub', { cls: this.src.className(), realm })
        : this.src.className();
    }
    this.bars.style.display = v ? 'flex' : 'none';
    if (v) {
      const f = (n: number, d: number): number => (d > 0 ? n / d : 0);
      this.hp.set(f(v.hp, v.hpMax), `${Math.ceil(v.hp)} / ${Math.round(v.hpMax)}`, f(v.shield, v.hpMax));
      this.mp.set(f(v.mp, v.mpMax), `${Math.ceil(v.mp)} / ${Math.round(v.mpMax)}`);
    }
  }

  destroy(): void {
    this.root.remove();
  }
}
