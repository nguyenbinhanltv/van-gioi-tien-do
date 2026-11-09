/**
 * Sect panel (D98, docs/10 §7.1 P4 "Tông môn NPC: gia nhập, Cống hiến, kho bí tịch"): the dialog of the sect NPC and the library, a small
 * DOM overlay toggled with `K` (or `/sect`). Not a member: the NPC's welcome and a Gia nhập button. Member: the Cống hiến balance, the
 * library of this class's manuals (name, level, price in Cống hiến, a Học button, "Đã học" once bought) and a Rời tông môn button.
 * Everything shown is `SectModel` from client-core, drawn with `textContent` ONLY; every button runs the same `/sect ...` line the player
 * could type, and the server decides everything (the NPC range, the balance, the price): a button that looks disabled is only a hint.
 *
 * Placeholder for the six Sơn Môn NPC standees (art by another worker): the dialog speaks as the NPC keys of `SECT.NPCS`
 * (`npc_su_huynh` welcomes, `npc_truong_lao_dan` keeps the library), so the standees can bind to those ids later.
 */
import { core, shared } from './vendor/vgtd.mjs';
import { domIcon } from './DomIcons';
import { manualIconKey } from './ArtRegistry';

const BTN_STYLE: Partial<CSSStyleDeclaration> = {
  marginLeft: '6px',
  padding: '3px 9px',
  font: '12px sans-serif',
  color: '#f0f0f5',
  background: '#33405a',
  border: '1px solid #7fd4ff',
  borderRadius: '4px',
  cursor: 'pointer',
};
const DISABLED_STYLE: Partial<CSSStyleDeclaration> = { opacity: '0.45', cursor: 'default' };

export interface SectPanelHooks {
  /** run one chat-box line as if typed (`/sect join`, `/sect buy 2`) */
  run(command: string): void;
  /** where the local player stands (tile space), null before the first snapshot */
  position(): { i: number; j: number } | null;
}

export class SectPanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly onResize: () => void;
  private drawn = -1;
  private nearShown: boolean | null = null;
  private open = false;

  constructor(
    private readonly model: InstanceType<typeof core.SectModel>,
    private readonly hooks: SectPanelHooks,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-sect';
    Object.assign(root.style, {
      position: 'fixed',
      right: '292px',
      top: '96px',
      width: '300px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 220px)',
      overflowY: 'auto',
      display: 'none',
      padding: '8px',
      font: '12px/1.35 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.88)',
      border: '1px solid #e8c872',
      borderRadius: '8px',
      zIndex: '450',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    this.title = document.createElement('div');
    this.title.style.fontWeight = 'bold';
    this.title.style.color = '#e8c872';
    const close = document.createElement('button');
    const closeIcon = domIcon('hud', 'close', 20);
    if (closeIcon) {
      closeIcon.style.marginRight = '0';
      close.append(closeIcon);
    } else close.textContent = '×';
    close.title = core.t('sect.panel.close_hint');
    Object.assign(close.style, BTN_STYLE);
    close.addEventListener('click', () => this.toggle(false));
    head.append(this.title, close);
    this.body = document.createElement('div');
    root.append(head, this.body);
    parent.appendChild(root);
    this.root = root;

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyK') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);
    this.onResize = () => {
      this.drawn = -1;
    };
    window.addEventListener('resize', this.onResize);

    // automation hook (scripts/sect-online-smoke.mjs): what the panel shows, without reading the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdSect = {
      visible: () => this.open,
      toggle: () => this.toggle(),
      state: () => {
        const v = this.model.view();
        return {
          ready: v.ready,
          member: v.member,
          contribution: v.contribution,
          library: v.library.map((m) => ({ name: m.name, price: m.price, owned: m.owned, canBuy: m.canBuy })),
          near: this.model.nearNpc(this.hooks.position()),
        };
      },
      /** click the first button of the panel whose label is `label` (optionally inside the row of manual `name`) */
      click: (label: string, name?: string) => {
        const scope = name
          ? Array.from(this.body.querySelectorAll<HTMLElement>('[data-manual]')).find((r) => r.dataset.manual === name)
          : this.body;
        const btn = scope
          ? Array.from(scope.querySelectorAll('button')).find((b) => b.textContent === label)
          : undefined;
        btn?.click();
        return !!btn;
      },
      rect: () => {
        const r = this.root.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
    };
  }

  get visible(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
    this.drawn = -1;
  }

  private button(label: string, command: string, enabled: boolean): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, BTN_STYLE);
    if (!enabled) Object.assign(b.style, DISABLED_STYLE);
    // the button always sends the command: the SERVER decides (range, balance); "disabled" is only the look of a likely refusal
    b.addEventListener('click', () => this.hooks.run(command));
    return b;
  }

  private line(text: string, color = '#f0f0f5'): HTMLDivElement {
    const d = document.createElement('div');
    d.textContent = text; // text only, never markup
    d.style.color = color;
    d.style.margin = '3px 0';
    return d;
  }

  /** Per frame: redraw when the model changed, the panel was just opened or the near-NPC hint flipped. */
  update(): void {
    if (!this.open) return;
    const near = this.model.nearNpc(this.hooks.position());
    if (this.drawn === this.model.version && this.nearShown === near) return;
    this.drawn = this.model.version;
    this.nearShown = near;
    const v = this.model.view();
    this.title.textContent = shared.SECT.NAME;
    const sectIcon = domIcon('hud', 'sect', 20);
    if (sectIcon) this.title.prepend(sectIcon);
    const frag = document.createDocumentFragment();
    if (!v.ready) {
      frag.appendChild(this.line(core.t('sect.panel.loading'), '#b6bccb'));
      this.body.replaceChildren(frag);
      return;
    }
    frag.appendChild(
      this.line(
        near ? core.t('sect.panel.near') : core.t('sect.panel.far', { range: shared.SECT.NPC_RANGE_TILES }),
        near ? '#8fe0a0' : '#f0dc96',
      ),
    );
    if (!v.member) {
      frag.appendChild(this.line(core.t('sect.panel.recruit'), '#d6d9e6'));
      const row = document.createElement('div');
      row.style.margin = '6px 0';
      row.appendChild(this.button(core.t('sect.panel.join'), '/sect join', near));
      (row.firstElementChild as HTMLElement).style.marginLeft = '0';
      frag.appendChild(row);
    } else {
      const ch = this.line(core.t('sect.panel.contribution', { n: v.contribution }), '#e8c872');
      const token = domIcon('item', 'cong_hien_token', 18);
      if (token) ch.prepend(token);
      frag.appendChild(ch);
      frag.appendChild(this.line(core.t('sect.panel.elder'), '#d6d9e6'));
      if (v.library.length === 0) frag.appendChild(this.line(core.t('sect.panel.no_manuals'), '#b6bccb'));
      for (const m of v.library) {
        const row = document.createElement('div');
        row.dataset.manual = m.name;
        Object.assign(row.style, {
          display: 'flex',
          alignItems: 'center',
          padding: '3px 0',
          borderBottom: '1px solid rgba(255,255,255,0.08)',
        } as Partial<CSSStyleDeclaration>);
        const label = document.createElement('div');
        Object.assign(label.style, {
          flex: '1 1 auto',
          minWidth: '0',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        });
        label.textContent = core.t('sect.panel.manual', {
          n: m.index + 1,
          name: m.name,
          level: m.levelMin,
          price: m.price,
        });
        label.style.color = m.owned ? '#8a8fa0' : '#f0f0f5';
        // the manual's icon: tier by level, form by position in the library (PART 3 group O art)
        const manualIcon = domIcon('item', manualIconKey(m.levelMin, m.index), 28);
        if (manualIcon) row.appendChild(manualIcon);
        row.appendChild(label);
        if (m.owned) {
          const owned = document.createElement('span');
          owned.textContent = core.t('sect.panel.learned');
          owned.style.color = '#8fe0a0';
          owned.style.marginLeft = '6px';
          row.appendChild(owned);
        } else row.appendChild(this.button(core.t('sect.panel.learn'), `/sect buy ${m.index + 1}`, near && m.canBuy));
        frag.appendChild(row);
      }
      const leave = document.createElement('div');
      leave.style.marginTop = '8px';
      leave.appendChild(this.button(core.t('sect.panel.leave'), '/sect leave', near));
      frag.appendChild(leave);
    }
    this.body.replaceChildren(frag);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
