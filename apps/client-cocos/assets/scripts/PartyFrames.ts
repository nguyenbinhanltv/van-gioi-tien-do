/**
 * Party frames (D93, docs/05 "khung đồng đội"): a stack of one row per OTHER party member (name, HP bar, MP bar, a star for the leader)
 * directly under the player frame, plus a small invite card with Accept / Decline buttons while an invite is pending. A DOM overlay like
 * the chat box; everything shown is `PartyModel` from client-core, drawn with `textContent` ONLY (names come from other players).
 * The server decides everything (roster, vitals, invites); the buttons just run the same `/accept` / `/decline` commands as typing them.
 *
 * Placement follows the shared layout (`partyFramesPlacement`: under `player-frame` of the current profile), so on touch screens the
 * stack stays clear of the joystick zone and the folded chat strip. Rows do not take pointer events (taps fall through to the game);
 * only the invite buttons do.
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

function bar(color: string): { box: HTMLDivElement; fill: HTMLDivElement } {
  const box = document.createElement('div');
  Object.assign(box.style, {
    height: '6px',
    background: 'rgba(0,0,0,0.55)',
    borderRadius: '3px',
    overflow: 'hidden',
    marginTop: '2px',
  } as Partial<CSSStyleDeclaration>);
  const fill = document.createElement('div');
  Object.assign(fill.style, { height: '100%', width: '0%', background: color } as Partial<CSSStyleDeclaration>);
  box.appendChild(fill);
  return { box, fill };
}

export class PartyFrames {
  private readonly root: HTMLDivElement;
  private readonly rows: HTMLDivElement;
  private readonly card: HTMLDivElement;
  private readonly cardText: HTMLDivElement;
  private readonly onResize: () => void;
  private drawn = -1;
  private inviteShown = '';

  constructor(
    private readonly party: InstanceType<typeof core.PartyModel>,
    private readonly run: (command: string) => void,
    parent: HTMLElement = document.body,
  ) {
    const root = document.createElement('div');
    root.id = 'vgtd-party';
    Object.assign(root.style, {
      position: 'fixed',
      left: '16px',
      top: '96px',
      width: '220px',
      font: '12px/1.25 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      zIndex: '400', // under the chat box (500): an opened chat covers the frames instead of the other way round
      pointerEvents: 'none',
    } as Partial<CSSStyleDeclaration>);
    const rows = document.createElement('div');
    rows.id = 'vgtd-party-rows';
    const card = document.createElement('div');
    card.id = 'vgtd-party-invite';
    Object.assign(card.style, {
      display: 'none',
      marginTop: '6px',
      padding: '6px 8px',
      background: 'rgba(8,10,18,0.8)',
      border: '1px solid #7fd4ff',
      borderRadius: '6px',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    const cardText = document.createElement('div');
    const buttons = document.createElement('div');
    buttons.style.marginTop = '4px';
    const mkButton = (label: string, command: string): HTMLButtonElement => {
      const b = document.createElement('button');
      b.textContent = label;
      b.dataset.cmd = command;
      Object.assign(b.style, {
        marginRight: '6px',
        padding: '4px 10px',
        font: '12px sans-serif',
        color: '#f0f0f5',
        background: '#33405a',
        border: '1px solid #7fd4ff',
        borderRadius: '4px',
        cursor: 'pointer',
      } as Partial<CSSStyleDeclaration>);
      b.addEventListener('click', () => this.answer(command));
      return b;
    };
    buttons.append(
      mkButton(core.t('party.invite.accept'), '/accept'),
      mkButton(core.t('party.invite.decline'), '/decline'),
    );
    card.append(cardText, buttons);
    root.append(rows, card);
    parent.appendChild(root);
    this.root = root;
    this.rows = rows;
    this.card = card;
    this.cardText = cardText;
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();

    // automation hook (scripts/party-online-smoke.mjs): what the frames show, without reading the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdParty = {
      members: () =>
        this.party
          .members()
          .map((m) => ({ name: m.name, isLeader: m.isLeader, isMe: m.isMe, hp: m.hp, hpMax: m.hpMax })),
      inviteFrom: () => this.party.invite()?.fromName ?? null,
      rect: () => {
        const r = this.root.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
      layoutRects: () => {
        const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
        const c = core.touchChatPlacement(window.innerWidth, window.innerHeight);
        const f = core.partyFramesPlacement(window.innerWidth, window.innerHeight, touch);
        return { touch, joystick: c.joystick, strip: c.strip, frames: f };
      },
      accept: () => this.answer('/accept'),
    };
  }

  /** Accept / Decline: the newest pending invite (the one on the card). */
  private answer(command: string): void {
    const inv = this.party.invite();
    this.run(inv ? `${command} ${inv.fromName}` : command);
  }

  private layout(): void {
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    const p = core.partyFramesPlacement(window.innerWidth, window.innerHeight, touch);
    Object.assign(this.root.style, {
      left: `${p.x}px`,
      top: `${p.y}px`,
      width: `${Math.max(140, p.w)}px`,
      fontSize: `${Math.max(10, Math.round(12 * Math.max(0.75, p.scale)))}px`,
    } as Partial<CSSStyleDeclaration>);
    this.drawn = -1;
  }

  /** Per frame: redraw only when the party model changed (an invite's countdown is re-checked every call, which is cheap). */
  update(): void {
    const inv = this.party.invite(); // also expires old invites (bumps the version)
    const invKey = inv ? inv.fromName : '';
    if (this.drawn === this.party.version && invKey === this.inviteShown) return;
    this.drawn = this.party.version;
    this.inviteShown = invKey;

    const frag = document.createDocumentFragment();
    for (const m of this.party.members()) {
      if (m.isMe) continue; // the player frame already shows me
      const row = document.createElement('div');
      Object.assign(row.style, {
        marginBottom: '4px',
        padding: '3px 6px',
        background: 'rgba(8,10,18,0.55)',
        borderRadius: '5px',
        textShadow: '0 1px 2px #000',
      } as Partial<CSSStyleDeclaration>);
      const title = document.createElement('div');
      // the leader's crown icon when the art is there (the ★ glyph otherwise); the name is text only, never markup
      const crown = m.isLeader ? domIcon('hud', 'leader', 14) : null;
      title.dataset.leader = m.isLeader ? '1' : '0';
      if (crown) title.append(crown, m.name);
      else title.textContent = `${m.isLeader ? '★ ' : ''}${m.name}`;
      title.style.color = CLASS_COLOR[m.classId] ?? '#f0f0f5';
      title.style.whiteSpace = 'nowrap';
      title.style.overflow = 'hidden';
      title.style.textOverflow = 'ellipsis';
      const hp = bar('#d9534f');
      const mp = bar('#4a90e2');
      const frac = (v: number | undefined, max: number | undefined): number =>
        v === undefined || !max ? 0 : Math.max(0, Math.min(1, v / max));
      hp.fill.style.width = `${Math.round(frac(m.hp, m.hpMax) * 100)}%`;
      mp.fill.style.width = `${Math.round(frac(m.mp, m.mpMax) * 100)}%`;
      row.append(title, hp.box, mp.box);
      frag.appendChild(row);
    }
    this.rows.replaceChildren(frag);

    this.card.style.display = inv ? 'block' : 'none';
    if (inv) {
      this.cardText.textContent = core.t('party.invite.banner', { from: inv.fromName }); // text only
      const ic = domIcon('hud', 'party_invite', 18);
      if (ic) this.cardText.prepend(ic);
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
