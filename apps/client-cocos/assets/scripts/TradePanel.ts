/**
 * Trade panel (D102, docs/10 §7.1 P4 "Giao dịch trực tiếp (thuế 3%)"): the direct-trade window, a DOM overlay. It opens by itself when a trade
 * window opens (and with `T` / `/trade`), shows what I give and what the other player gives (item lines and the three stones), my bag with
 * "+1" / "Tất cả" buttons to put items in, stone inputs, and the buttons Khóa (step 1), Xác nhận (step 2, only after both locked) and Hủy. A pending
 * invite shows as a small card with Đồng ý / Từ chối. Everything shown is `TradeModel` from client-core, drawn with `textContent` ONLY (names
 * come from other players); every button runs the same `/trade ...` line the player could type, and the server decides everything (range,
 * ownership, locks, the 3% stone tax, the atomic exchange): a button that looks disabled is only a hint.
 *
 * In-game currency only: linh thạch hạ / trung / thượng. There is nothing about money, prices, shops or receipts here.
 */
import { core } from './vendor/vgtd.mjs';

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

export interface BagRow {
  slot: number;
  defId: number;
  quality: number;
  qty: number;
  bound: boolean;
}
export interface TradePanelHooks {
  /** run one chat-box line as if typed (`/trade lock`, `/trade add 3 5`) */
  run(command: string): void;
  /** the items in my bag right now */
  bag(): BagRow[];
}

export class TradePanel {
  private readonly root: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private drawn = -1;
  private bagSig = '';
  private open = false;
  private wasOpen = false;
  private inviteShown = '';

  constructor(
    private readonly model: InstanceType<typeof core.TradeModel>,
    private readonly hooks: TradePanelHooks,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-trade';
    Object.assign(root.style, {
      position: 'fixed',
      left: '50%',
      top: '88px',
      transform: 'translateX(-50%)',
      width: '460px',
      maxWidth: 'calc(100vw - 24px)',
      maxHeight: 'calc(100vh - 200px)',
      overflowY: 'auto',
      display: 'none',
      padding: '8px',
      font: '12px/1.35 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.92)',
      border: '1px solid #8fe0a0',
      borderRadius: '8px',
      zIndex: '460',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    this.title = document.createElement('div');
    this.title.style.fontWeight = 'bold';
    this.title.style.color = '#8fe0a0';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = 'Ẩn bảng (T). Giao dịch vẫn mở: dùng Hủy để hủy.';
    Object.assign(close.style, BTN_STYLE);
    close.addEventListener('click', () => this.toggle(false));
    head.append(this.title, close);
    this.body = document.createElement('div');
    root.append(head, this.body);
    parent.appendChild(root);
    this.root = root;

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.code === 'KeyT') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);

    // automation hook (scripts/trade-online-smoke.mjs): what the panel shows, without reading the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdTrade = {
      visible: () => this.open,
      toggle: () => this.toggle(),
      state: () => {
        const v = this.model.view();
        return {
          open: v.open,
          partner: v.partner,
          canLock: v.canLock,
          canConfirm: v.canConfirm,
          mine: {
            locked: v.mine.locked,
            confirmed: v.mine.confirmed,
            stones: v.mine.stones,
            items: v.mine.items.length,
          },
          theirs: {
            locked: v.theirs.locked,
            confirmed: v.theirs.confirmed,
            stones: v.theirs.stones,
            items: v.theirs.items.length,
          },
          invite: this.model.invite()?.fromName ?? null,
        };
      },
      /** click the first button of the panel whose label is `label` */
      click: (label: string) => {
        const btn = Array.from(this.root.querySelectorAll('button')).find((b) => b.textContent === label);
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

  private button(label: string, command: string, enabled = true): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, BTN_STYLE);
    if (!enabled) Object.assign(b.style, DISABLED_STYLE);
    // the button always sends the command: the SERVER decides; "disabled" is only the look of a likely refusal
    b.addEventListener('click', () => this.hooks.run(command));
    return b;
  }

  private text(text: string, color = '#f0f0f5'): HTMLDivElement {
    const d = document.createElement('div');
    d.textContent = text; // text only, never markup
    d.style.color = color;
    d.style.margin = '2px 0';
    return d;
  }

  private sideColumn(
    label: string,
    s: { items: { qty: number; name: string }[]; stones: number[]; locked: boolean; confirmed: boolean },
  ): HTMLDivElement {
    const col = document.createElement('div');
    Object.assign(col.style, {
      flex: '1 1 0',
      minWidth: '0',
      padding: '4px 6px',
      background: 'rgba(255,255,255,0.05)',
      borderRadius: '5px',
    });
    col.appendChild(this.text(label, '#e8c872'));
    for (const l of s.items) col.appendChild(this.text(`${l.qty}× ${l.name}`));
    s.stones.forEach(
      (n, i) => n > 0 && col.appendChild(this.text(`${n} linh thạch ${core.STONE_LABELS[i]}`, '#9fd6ff')),
    );
    if (s.items.length === 0 && s.stones.every((n) => n === 0)) col.appendChild(this.text('(chưa đặt gì)', '#8a8fa0'));
    col.appendChild(
      this.text(
        s.confirmed ? '✔ Đã xác nhận' : s.locked ? '🔒 Đã khóa' : 'Chưa khóa',
        s.confirmed ? '#8fe0a0' : s.locked ? '#f0dc96' : '#8a8fa0',
      ),
    );
    return col;
  }

  /** Per frame: open on a new window / invite, redraw when the model, the bag or the visibility changed. */
  update(): void {
    const v = this.model.view();
    if (v.open && !this.wasOpen) this.toggle(true); // a window just opened: show it
    if (!v.open && this.wasOpen) this.drawn = -1; // it just closed: clear the rows
    this.wasOpen = v.open;
    const inv = this.model.invite();
    const invKey = inv ? inv.fromName : '';
    const rows = v.open ? this.hooks.bag() : [];
    const bagSig = rows.map((r) => `${r.slot}:${r.defId}:${r.qty}`).join(',');
    if (inv && !this.open) this.toggle(true); // an invite is worth showing
    if (!this.open) return;
    if (this.drawn === this.model.version && invKey === this.inviteShown && bagSig === this.bagSig) return;
    this.drawn = this.model.version;
    this.inviteShown = invKey;
    this.bagSig = bagSig;
    this.title.textContent = v.open ? `Giao dịch với ${v.partner}` : 'Giao dịch';
    const frag = document.createDocumentFragment();
    if (inv) {
      const card = document.createElement('div');
      Object.assign(card.style, {
        padding: '6px',
        margin: '0 0 6px',
        border: '1px solid #7fd4ff',
        borderRadius: '6px',
      });
      card.appendChild(this.text(`${inv.fromName} mời bạn giao dịch.`, '#7fd4ff'));
      const row = document.createElement('div');
      row.append(this.button('Đồng ý', '/trade accept'), this.button('Từ chối', '/trade decline'));
      (row.firstElementChild as HTMLElement).style.marginLeft = '0';
      card.appendChild(row);
      frag.appendChild(card);
    }
    if (!v.open) {
      if (!inv)
        frag.appendChild(this.text('Không có giao dịch. Gõ /trade tên (người chơi đứng gần) để mời.', '#b6bccb'));
      this.body.replaceChildren(frag);
      return;
    }
    const cols = document.createElement('div');
    Object.assign(cols.style, { display: 'flex', gap: '6px' });
    cols.append(this.sideColumn('Bạn đưa', v.mine), this.sideColumn(`${v.partner} đưa`, v.theirs));
    frag.appendChild(cols);
    frag.appendChild(
      this.text('Thuế giao dịch trực tiếp: 3% linh thạch bên nhận (làm tròn lên). Vật phẩm không bị thuế.', '#8a8fa0'),
    );

    // stones I give: one input per stone, Enter or the OK button sends `/trade stones ...`
    const stones = document.createElement('div');
    Object.assign(stones.style, { display: 'flex', alignItems: 'center', margin: '6px 0', flexWrap: 'wrap' });
    stones.appendChild(this.text('Linh thạch đưa:', '#f0dc96'));
    (['ha', 'trung', 'thuong'] as const).forEach((code, i) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.min = '0';
      input.value = String(v.mine.stones[i] ?? 0);
      input.title = `Linh thạch ${core.STONE_LABELS[i]}`;
      Object.assign(input.style, { width: '70px', margin: '0 2px 0 8px', font: '12px sans-serif', padding: '2px 4px' });
      const send = (): void =>
        this.hooks.run(`/trade stones ${code} ${Math.max(0, Math.floor(Number(input.value) || 0))}`);
      // typing here must not walk / cast / toggle panels: the game listens on window, so keep the keys inside the input
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') send();
      });
      input.addEventListener('keyup', (e) => e.stopPropagation());
      const label = document.createElement('span');
      label.textContent = ['hạ', 'trung', 'thượng'][i]!;
      label.style.color = '#9fd6ff';
      const ok = document.createElement('button');
      ok.textContent = 'OK';
      Object.assign(ok.style, BTN_STYLE);
      ok.addEventListener('click', send);
      stones.append(label, input, ok);
    });
    frag.appendChild(stones);

    // my bag: put items in
    frag.appendChild(this.text('Túi đồ của bạn (bấm để đặt vào giao dịch):', '#f0dc96'));
    const bag = document.createElement('div');
    Object.assign(bag.style, { maxHeight: '110px', overflowY: 'auto' });
    for (const r of rows) {
      const line = document.createElement('div');
      Object.assign(line.style, { display: 'flex', alignItems: 'center', padding: '2px 0' });
      const label = document.createElement('div');
      Object.assign(label.style, {
        flex: '1 1 auto',
        minWidth: '0',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        whiteSpace: 'nowrap',
      });
      label.textContent = `${r.slot + 1}. ${r.qty}× ${this.model.itemName(r.defId, r.quality)}${r.bound ? ' (khóa, không giao dịch)' : ''}`;
      line.appendChild(label);
      if (!r.bound) {
        line.appendChild(this.button('+1', `/trade add ${r.slot + 1} 1`));
        if (r.qty > 1) line.appendChild(this.button('Tất cả', `/trade add ${r.slot + 1} ${r.qty}`));
      }
      bag.appendChild(line);
    }
    if (rows.length === 0) bag.appendChild(this.text('(túi trống)', '#8a8fa0'));
    frag.appendChild(bag);

    const actions = document.createElement('div');
    actions.style.marginTop = '8px';
    actions.append(
      this.button('Khóa', '/trade lock', v.canLock),
      this.button('Xác nhận', '/trade confirm', v.canConfirm),
      this.button('Hủy', '/trade cancel'),
    );
    (actions.firstElementChild as HTMLElement).style.marginLeft = '0';
    frag.appendChild(actions);
    this.body.replaceChildren(frag);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.root.remove();
  }
}
