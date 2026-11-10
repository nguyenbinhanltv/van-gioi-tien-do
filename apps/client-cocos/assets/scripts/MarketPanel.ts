/**
 * Market panel (D112, docs/10 §7.1 P4 "Vạn Bảo Lâu cơ bản"): a small DOM overlay on the left, toggled with `V`. Three tabs: Mua (browse with an
 * item / quality / sort filter and pages), Hàng của tôi (your listings, with Gỡ), Bán (pick an item from the bag, type a price, see the fee
 * and the tax BEFORE sending). Everything shown is `MarketModel` / `net.bag` from client-core, drawn with `textContent` ONLY (seller names
 * come from other players); every number the player pays or receives comes back from the server in the result line, the preview is only the
 * same shared formula. The server decides everything (escrow, price, fee, tax, refusals).
 *
 * It sits above the chat box's z-index (450 < 500) like the friends panel, on the opposite side, and shrinks on small screens.
 */
import { core, shared } from './vendor/vgtd.mjs';

const BTN_STYLE: Partial<CSSStyleDeclaration> = {
  marginLeft: '4px',
  padding: '2px 7px',
  font: '11px sans-serif',
  color: '#f0f0f5',
  background: '#33405a',
  border: '1px solid #e8c872',
  borderRadius: '4px',
  cursor: 'pointer',
};
const QUALITY_COLOR = ['#e8e8ee', '#8fe0a0', '#8fb8ff', '#d6a0ff', '#e8c872', '#ff8a7a'];

type Net = InstanceType<typeof core.NetClient>;
type Tab = 'buy' | 'mine' | 'sell';

export class MarketPanel {
  private readonly model = new core.MarketModel();
  private readonly root: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly status: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private open = false;
  private tab: Tab = 'buy';
  private drawn = '';
  /** the bag slot picked on the Bán tab (-1 = none) and the form values */
  private slot = -1;
  private qty = '1';
  private price = '';
  private duration = 24;

  constructor(
    private readonly net: Net,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-market';
    Object.assign(root.style, {
      position: 'fixed',
      left: '16px',
      top: '96px',
      width: '400px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 160px)',
      overflowY: 'auto',
      display: 'none',
      padding: '8px',
      font: '12px/1.3 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.9)',
      border: '1px solid #e8c872',
      borderRadius: '8px',
      zIndex: '450',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    this.title = document.createElement('div');
    this.title.style.fontWeight = 'bold';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = core.t('market.panel.close_hint');
    Object.assign(close.style, BTN_STYLE);
    close.addEventListener('click', () => this.toggle(false));
    head.append(this.title, close);
    const tabs = document.createElement('div');
    tabs.style.marginBottom = '6px';
    for (const [t, label] of [
      ['buy', core.t('market.panel.tab_buy')],
      ['mine', core.t('market.panel.tab_mine')],
      ['sell', core.t('market.panel.tab_sell')],
    ] as const) {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.tab = t;
      Object.assign(b.style, BTN_STYLE, { marginLeft: '0', marginRight: '4px' });
      b.addEventListener('click', () => this.setTab(t));
      tabs.appendChild(b);
    }
    this.body = document.createElement('div');
    this.status = document.createElement('div');
    Object.assign(this.status.style, { marginTop: '6px', color: '#f0dc96', minHeight: '1.3em' });
    root.append(head, tabs, this.body, this.status);
    parent.appendChild(root);
    this.root = root;

    // answers from the server: a successful list / buy / cancel refreshes the page that is showing
    this.net.marketEvents = {
      onMarketResults: (m) => this.model.applyResults(m),
      onMarketResult: (m) => {
        const line = this.model.applyResult(m);
        if (line) this.status.textContent = line;
        if (m.reason === 0 && m.op !== core.MarketOp.Search) this.refresh();
      },
      onMarketNotice: (m) => {
        this.status.textContent = this.model.applyNotice(m);
        if (this.open) this.refresh();
      },
    };

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyV') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);

    // automation hook (scripts/market-online-smoke.mjs): what the panel shows, without reading the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdMarket = {
      visible: () => this.open,
      toggle: () => this.toggle(),
      tab: (t: Tab) => this.setTab(t),
      listings: () => this.model.listings().map((l) => ({ ...l })),
      status: () => this.status.textContent,
      buy: (id: number) => this.send(this.model.buyCmd(id)),
      cancel: (id: number) => this.send(this.model.cancelCmd(id)),
      list: (slot: number, qty: number, price: number, hours: number) =>
        this.send(this.model.listCmd(slot, qty, price, hours)),
    };
  }

  get visible(): boolean {
    return this.open;
  }

  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.root.style.display = this.open ? 'block' : 'none';
    this.drawn = '';
    if (this.open) {
      this.model.reset(); // a fresh view: nothing from before a reconnect
      this.refresh();
    }
  }

  private setTab(t: Tab): void {
    this.tab = t;
    this.model.setFilter({ view: t === 'mine' ? core.MarketView.Mine : core.MarketView.Browse });
    this.drawn = '';
    if (t !== 'sell') this.refresh();
  }

  private send(m: Parameters<Net['sendMarket']>[0]): boolean {
    return this.net.sendMarket(m);
  }
  private refresh(): void {
    if (this.tab !== 'sell') this.send(this.model.searchCmd());
  }

  // ------------------------------------------------------------------ drawing
  private button(label: string, onClick: () => void, disabled = false): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, BTN_STYLE);
    b.disabled = disabled;
    if (disabled) b.style.opacity = '0.5';
    b.addEventListener('click', onClick);
    return b;
  }
  private select(options: Array<[string, string]>, value: string, onChange: (v: string) => void): HTMLSelectElement {
    const s = document.createElement('select');
    Object.assign(s.style, { font: '11px sans-serif', marginRight: '4px', maxWidth: '110px' });
    for (const [v, label] of options) {
      const o = document.createElement('option');
      o.value = v;
      o.textContent = label;
      s.appendChild(o);
    }
    s.value = value;
    s.addEventListener('change', () => onChange(s.value));
    s.addEventListener('keydown', (e) => e.stopPropagation());
    return s;
  }
  private row(left: string, color: string, buttons: HTMLButtonElement[], right = ''): HTMLDivElement {
    const row = document.createElement('div');
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
      overflow: 'hidden',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    });
    label.textContent = left; // text only, never markup
    label.style.color = color;
    const r = document.createElement('div');
    r.textContent = right;
    r.style.color = '#b6bccb';
    r.style.margin = '0 4px';
    row.append(label, r, ...buttons);
    return row;
  }

  private drawBrowse(frag: DocumentFragment): void {
    const f = this.model.filter;
    const bar = document.createElement('div');
    bar.style.marginBottom = '4px';
    const items: Array<[string, string]> = [['0', core.t('market.panel.any_item')]];
    for (const d of shared.ITEM_DEFS) items.push([String(d.id), core.itemLabel(d.id)]);
    bar.appendChild(
      this.select(items, String(f.defId), (v) => {
        this.model.setFilter({ defId: Number(v) });
        this.refresh();
      }),
    );
    bar.appendChild(
      this.select(
        [0, 1, 2, 3, 4, 5].map((q): [string, string] => [
          String(q),
          q === 0
            ? core.t('market.panel.any_quality')
            : core.t('market.panel.min_quality', { q: core.QUALITY_LABEL[q] ?? '' }),
        ]),
        String(f.minQuality),
        (v) => {
          this.model.setFilter({ minQuality: Number(v) });
          this.refresh();
        },
      ),
    );
    bar.appendChild(
      this.select(
        Object.entries(core.SORT_LABEL).map(([k, label]): [string, string] => [k, label]),
        String(f.sort),
        (v) => {
          this.model.setFilter({ sort: Number(v) });
          this.refresh();
        },
      ),
    );
    frag.appendChild(bar);
    if (!this.model.ready) frag.appendChild(this.note(core.t('market.panel.loading')));
    else if (this.model.listings().length === 0) frag.appendChild(this.note(core.t('market.panel.no_match')));
    for (const l of this.model.listings()) {
      const left = core.t('market.panel.row_buy', {
        item: core.itemLabel(l.defId),
        quality: core.QUALITY_LABEL[l.quality] ?? '',
        qty: l.qty,
        price: l.unitPrice,
        total: l.unitPrice * l.qty,
        seller: l.seller,
        mins: l.minutesLeft,
      });
      const id = l.listingId;
      frag.appendChild(
        this.row(left, QUALITY_COLOR[l.quality] ?? '#f0f0f5', [
          l.mine
            ? this.button(core.t('market.panel.cancel'), () => this.send(this.model.cancelCmd(id)))
            : this.button('Mua', () => this.send(this.model.buyCmd(id))),
        ]),
      );
    }
    frag.appendChild(this.pager());
  }

  private drawMine(frag: DocumentFragment): void {
    if (!this.model.ready) frag.appendChild(this.note(core.t('market.panel.loading')));
    else if (this.model.listings().length === 0) frag.appendChild(this.note(core.t('market.panel.none_mine')));
    for (const l of this.model.listings()) {
      const left = core.t('market.panel.row_mine', {
        item: core.itemLabel(l.defId),
        quality: core.QUALITY_LABEL[l.quality] ?? '',
        qty: l.qty,
        price: l.unitPrice,
        mins: l.minutesLeft,
      });
      const id = l.listingId;
      frag.appendChild(
        this.row(left, QUALITY_COLOR[l.quality] ?? '#f0f0f5', [
          this.button(core.t('market.panel.cancel'), () => this.send(this.model.cancelCmd(id))),
        ]),
      );
    }
    frag.appendChild(this.pager());
  }

  private pager(): HTMLDivElement {
    const p = document.createElement('div');
    Object.assign(p.style, { display: 'flex', alignItems: 'center', marginTop: '4px' });
    const page = this.model.filter.page;
    p.append(
      this.button(
        '‹',
        () => {
          this.model.setFilter({ page: page - 1 });
          this.refresh();
        },
        page <= 0,
      ),
      this.note(core.t('market.panel.page', { page: page + 1, pages: this.model.pages, total: this.model.total })),
      this.button(
        '›',
        () => {
          this.model.setFilter({ page: page + 1 });
          this.refresh();
        },
        page + 1 >= this.model.pages,
      ),
      this.button(core.t('market.panel.refresh'), () => this.refresh()),
    );
    return p;
  }

  private note(text: string): HTMLDivElement {
    const n = document.createElement('div');
    n.textContent = text;
    n.style.color = '#b6bccb';
    n.style.margin = '0 6px';
    return n;
  }

  private drawSell(frag: DocumentFragment): void {
    const bag = this.net.bag;
    frag.appendChild(this.note(core.t('market.panel.pick')));
    let any = false;
    for (let i = 0; i < bag.slotCount; i++) {
      const it = bag.itemAt(i);
      if (!it) continue;
      any = true;
      const left = core.t('market.panel.bag_row', {
        slot: i,
        item: core.itemLabel(it.defId),
        quality: core.QUALITY_LABEL[it.quality] ?? '',
        qty: it.qty,
        bound: it.bound ? core.t('market.panel.bound') : '',
      });
      const slot = i;
      frag.appendChild(
        this.row(left, QUALITY_COLOR[it.quality] ?? '#f0f0f5', [
          this.button(
            core.t(this.slot === i ? 'market.panel.selected' : 'market.panel.select'),
            () => {
              this.slot = slot;
              this.qty = String(it.qty);
              this.drawn = '';
            },
            it.bound,
          ),
        ]),
      );
    }
    if (!any) frag.appendChild(this.note(core.t('market.panel.bag_empty')));
    const picked = this.slot >= 0 ? bag.itemAt(this.slot) : null;
    if (!picked) return;
    const form = document.createElement('div');
    Object.assign(form.style, { marginTop: '8px', paddingTop: '6px', borderTop: '1px solid rgba(255,255,255,0.15)' });
    const input = (
      placeholder: string,
      value: string,
      onInput: (v: string) => void,
      width: string,
    ): HTMLInputElement => {
      const el = document.createElement('input');
      el.placeholder = placeholder;
      el.value = value;
      el.inputMode = 'numeric';
      el.autocomplete = 'off';
      Object.assign(el.style, { width, font: '12px sans-serif', padding: '2px 4px', marginRight: '4px' });
      // typing here must not walk / cast / toggle panels: the game listens on window, so keep the keys inside the input
      el.addEventListener('keydown', (e) => e.stopPropagation());
      el.addEventListener('keyup', (e) => e.stopPropagation());
      el.addEventListener('input', () => {
        onInput(el.value);
        this.updatePreview(preview, picked.qty);
      });
      return el;
    };
    const preview = document.createElement('div');
    preview.style.margin = '4px 0';
    preview.style.color = '#f0dc96';
    const qty =
      picked.kind === 'instance'
        ? this.note(core.t('market.panel.qty_one'))
        : input(core.t('market.panel.qty'), this.qty, (v) => (this.qty = v), '60px');
    if (picked.kind === 'instance') this.qty = '1';
    const price = input(core.t('market.panel.unit_price'), this.price, (v) => (this.price = v), '120px');
    const dur = this.select(
      shared.MARKET_BOARD.DURATIONS_H.map((h): [string, string] => [String(h), core.t('market.panel.hours', { h })]),
      String(this.duration),
      (v) => {
        this.duration = Number(v);
      },
    );
    const send = this.button(core.t('market.panel.list'), () => {
      const q = Number(this.qty);
      const p = Number(this.price);
      const problem = this.model.listProblem(p, q, picked.qty, this.duration);
      if (problem) {
        this.status.textContent = problem;
        return;
      }
      this.send(this.model.listCmd(this.slot, q, p, this.duration));
      this.slot = -1;
      this.price = '';
      this.drawn = '';
    });
    form.append(qty, price, dur, send, preview);
    frag.appendChild(form);
    this.updatePreview(preview, picked.qty);
  }

  private updatePreview(el: HTMLElement, _available: number): void {
    const p = this.model.preview(Number(this.price) || 0, Number(this.qty) || 0);
    el.textContent =
      p.total > 0
        ? core.t('market.panel.preview', { total: p.total, fee: p.fee, tax: p.tax, proceeds: p.proceeds })
        : core.t('market.panel.preview_hint');
  }

  /** Per frame: redraw only when something that is shown changed (or the panel was just opened). */
  update(): void {
    if (!this.open) return;
    const bag = this.net.bag;
    const key = `${this.tab}|${this.model.version}|${bag.states}|${this.slot}`;
    if (key === this.drawn) return;
    this.drawn = key;
    this.title.textContent = core.t('market.panel.title', { stones: bag.wallet.LT_HA });
    for (const b of Array.from(this.root.querySelectorAll<HTMLButtonElement>('button[data-tab]')))
      b.style.background = b.dataset.tab === this.tab ? '#5a4a22' : '#33405a';
    const frag = document.createDocumentFragment();
    if (this.tab === 'buy') this.drawBrowse(frag);
    else if (this.tab === 'mine') this.drawMine(frag);
    else this.drawSell(frag);
    this.body.replaceChildren(frag);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.root.remove();
  }
}
