/**
 * Friends panel (D96, docs/10 §7.1 P4 "bạn bè"): a small DOM overlay on the right, toggled with `O` (or `/friends`). Rows of friends
 * (online first, a green / grey dot, the name coloured by class) with the shortcut buttons Nhắn (whisper: puts `/w name ` into the chat
 * input), Mời (party invite: `/invite name`) and Xóa; requests received with Nhận / Từ chối; requests sent with Hủy; an input to ask someone.
 * Everything shown is `FriendsModel` from client-core, drawn with `textContent` ONLY (names come from other players), and every button
 * runs the same `/friend ...` / `/invite` / `/w` line the player could type: the server decides everything.
 *
 * It sits below the chat box (z-index 450 < 500) and above the party frames; on small screens it shrinks to the available width.
 */
import { core } from './vendor/vgtd.mjs';
import { domIcon } from './DomIcons';

const CLASS_COLOR: Record<number, string> = {
  1: '#e8c872',
  2: '#8fb8ff',
  3: '#e08a6a',
  4: '#8fe0a0',
  5: '#d6a0ff',
  6: '#ffb06a',
};

const BTN_STYLE: Partial<CSSStyleDeclaration> = {
  marginLeft: '4px',
  padding: '2px 7px',
  font: '11px sans-serif',
  color: '#f0f0f5',
  background: '#33405a',
  border: '1px solid #7fd4ff',
  borderRadius: '4px',
  cursor: 'pointer',
};

export interface FriendsPanelHooks {
  /** run one chat-box line as if typed (`/friend add x`, `/invite x`) */
  run(command: string): void;
  /** put text in the chat input and focus it (`/w name `) */
  prefill(text: string): void;
}

export class FriendsPanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly title: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly onResize: () => void;
  private drawn = -1;
  private open = false;

  constructor(
    private readonly model: InstanceType<typeof core.FriendsModel>,
    private readonly hooks: FriendsPanelHooks,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-friends';
    Object.assign(root.style, {
      position: 'fixed',
      right: '16px',
      top: '96px',
      width: '260px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 220px)',
      overflowY: 'auto',
      display: 'none',
      padding: '8px',
      font: '12px/1.3 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.85)',
      border: '1px solid #7fd4ff',
      borderRadius: '8px',
      zIndex: '450',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    this.title = document.createElement('div');
    this.title.style.fontWeight = 'bold';
    const close = document.createElement('button');
    const closeIcon = domIcon('hud', 'close', 20);
    if (closeIcon) {
      closeIcon.style.marginRight = '0';
      close.append(closeIcon);
    } else close.textContent = '×';
    close.title = 'Đóng (O)';
    Object.assign(close.style, BTN_STYLE);
    close.addEventListener('click', () => this.toggle(false));
    head.append(this.title, close);
    this.body = document.createElement('div');
    const add = document.createElement('div');
    Object.assign(add.style, { display: 'flex', marginTop: '8px' });
    this.input = document.createElement('input');
    this.input.placeholder = 'Tên người chơi…';
    this.input.maxLength = 24;
    this.input.autocomplete = 'off';
    Object.assign(this.input.style, { flex: '1 1 auto', minWidth: '0', font: '12px sans-serif', padding: '3px 5px' });
    const send = document.createElement('button');
    send.textContent = 'Kết bạn';
    const addIcon = domIcon('hud', 'friend_add', 16);
    if (addIcon) send.prepend(addIcon); // an <img> adds no text: the label stays 'Kết bạn'
    Object.assign(send.style, BTN_STYLE);
    const submit = (): void => {
      const name = this.input.value.trim().split(/\s+/)[0] ?? '';
      if (!name) return;
      this.input.value = '';
      this.hooks.run(`/friend add ${name}`);
    };
    send.addEventListener('click', submit);
    // typing here must not walk / cast / toggle panels: the game listens on window, so keep the keys inside the input
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') submit();
      else if (e.key === 'Escape') this.input.blur();
    });
    this.input.addEventListener('keyup', (e) => e.stopPropagation());
    add.append(this.input, send);
    root.append(head, this.body, add);
    parent.appendChild(root);
    this.root = root;

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyO') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);
    this.onResize = () => {
      this.drawn = -1;
    };
    window.addEventListener('resize', this.onResize);

    // automation hook (scripts/friends-online-smoke.mjs): what the panel shows, without reading the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdFriends = {
      visible: () => this.open,
      toggle: () => this.toggle(),
      friends: () => this.model.friends().map((f) => ({ name: f.name, online: f.online, classId: f.classId })),
      incoming: () => this.model.incoming(),
      outgoing: () => this.model.outgoing(),
      /** click the first button whose label is `label` inside the row of `name` */
      click: (name: string, label: string) => {
        const row = Array.from(this.body.querySelectorAll<HTMLElement>('[data-name]')).find(
          (r) => r.dataset.name === name,
        );
        const btn = row ? Array.from(row.querySelectorAll('button')).find((b) => b.textContent === label) : undefined;
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
    if (!this.open) this.input.blur();
  }

  private button(label: string, command: string, prefill = false, icon?: string): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    const ic = icon ? domIcon('hud', icon, 16) : null;
    if (ic) b.prepend(ic); // an <img> adds no text: the label stays the label
    Object.assign(b.style, BTN_STYLE);
    b.addEventListener('click', () => (prefill ? this.hooks.prefill(command) : this.hooks.run(command)));
    return b;
  }

  private row(name: string, color: string, dot: string, buttons: HTMLButtonElement[]): HTMLDivElement {
    const row = document.createElement('div');
    row.dataset.name = name;
    Object.assign(row.style, {
      display: 'flex',
      alignItems: 'center',
      padding: '2px 0',
      borderBottom: '1px solid rgba(255,255,255,0.08)',
    } as Partial<CSSStyleDeclaration>);
    const label = document.createElement('div');
    Object.assign(label.style, {
      flex: '1 1 auto',
      minWidth: '0',
      whiteSpace: 'nowrap',
      overflow: 'hidden',
      textOverflow: 'ellipsis',
    });
    // online / offline: the round HUD icon when the art is there (text glyph otherwise); the name is text only, never markup
    const status = domIcon('hud', dot === '●' ? 'online' : 'offline', 14);
    if (status) {
      label.append(status, name);
    } else label.textContent = `${dot} ${name}`;
    label.style.color = color;
    row.append(label, ...buttons);
    return row;
  }

  private heading(text: string): HTMLDivElement {
    const h = document.createElement('div');
    h.textContent = text;
    Object.assign(h.style, { margin: '8px 0 2px', color: '#f0dc96', fontWeight: 'bold' });
    return h;
  }

  /** Per frame: redraw only when the model changed (or the panel was just opened). */
  update(): void {
    if (!this.open || this.drawn === this.model.version) return;
    this.drawn = this.model.version;
    this.title.textContent = this.model.ready
      ? `Bạn bè (${this.model.count}, ${this.model.onlineCount} online)`
      : 'Bạn bè (đang tải…)';
    const frag = document.createDocumentFragment();
    for (const f of this.model.friends()) {
      const buttons: HTMLButtonElement[] = [];
      if (f.canWhisper) buttons.push(this.button('Nhắn', this.model.whisperPrefill(f.name), true, 'chat'));
      if (f.canInvite) buttons.push(this.button('Mời', this.model.inviteCommand(f.name), false, 'party_invite'));
      buttons.push(this.button('Xóa', `/friend remove ${f.name}`, false, 'friend_remove'));
      frag.appendChild(
        this.row(f.name, f.online ? (CLASS_COLOR[f.classId] ?? '#f0f0f5') : '#8a8fa0', f.online ? '●' : '○', buttons),
      );
    }
    if (this.model.ready && this.model.count === 0) {
      const none = document.createElement('div');
      none.textContent = 'Chưa có bạn bè. Nhập tên bên dưới để gửi lời mời.';
      none.style.color = '#b6bccb';
      frag.appendChild(none);
    }
    const inc = this.model.incoming();
    if (inc.length) {
      frag.appendChild(this.heading('Lời mời nhận được'));
      for (const n of inc)
        frag.appendChild(
          this.row(n, '#f0f0f5', '✉', [
            this.button('Nhận', `/friend accept ${n}`),
            this.button('Từ chối', `/friend decline ${n}`),
          ]),
        );
    }
    const out = this.model.outgoing();
    if (out.length) {
      frag.appendChild(this.heading('Lời mời đã gửi'));
      for (const n of out) frag.appendChild(this.row(n, '#b6bccb', '…', [this.button('Hủy', `/friend remove ${n}`)]));
    }
    this.body.replaceChildren(frag);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
