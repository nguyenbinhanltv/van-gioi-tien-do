/**
 * Chat box (D87, docs/05 "Khung chat"): fixed at the bottom-left, 360 x 200, a log of the last lines and one text input. A DOM overlay on
 * purpose (a real text input, IME, paste, mobile keyboard); everything it shows is `ChatLog.entries` from client-core, drawn with
 * `textContent` ONLY (names and lines come from other players: never markup). The server decides everything that matters (sender, rate
 * limit, mute, filter, whisper target); this only parses what the player types (`/z`, `/w name text`, `/r`, `/help`) and shows the answers.
 *
 * Keys: Enter or `/` focuses the input (the `/` starts a command), Enter sends, Esc leaves the box. While the input has focus none of its
 * key events reach the game (a typed "m" must not toggle meditation, "b" the bag, digits the hotbar, WASD walks). On small / touch screens
 * the box folds into a 2-line strip and unfolds when tapped; on touch screens it sits at the shared `chat-ticker` rect, outside the
 * joystick zone (`touchChatPlacement`).
 */
import { core } from './vendor/vgtd.mjs';

const WIDTH = 360;
const HEIGHT = 200;
const STRIP_HEIGHT = 44;
/** movement keys that must be released when the box takes the keyboard (their keyup would otherwise never reach the game) */
const MOVEMENT_CODES = [
  'KeyW',
  'KeyA',
  'KeyS',
  'KeyD',
  'ArrowUp',
  'ArrowDown',
  'ArrowLeft',
  'ArrowRight',
  'ShiftLeft',
  'ShiftRight',
];

const TONE_COLOR: Record<string, string> = {
  world: '#f0f0f5',
  zone: '#9fe7a3',
  whisper: '#f2a6ff',
  party: '#7fd4ff',
  system: '#f0dc96',
  error: '#ff8f85',
};

export class ChatBox {
  readonly log: InstanceType<typeof core.ChatLog>;
  /** the party state shown by `PartyFrames` (D93); fed by the same net hooks as the chat */
  readonly party: InstanceType<typeof core.PartyModel>;
  /** the trade window shown by `TradePanel` (D102); fed by the same net hooks as the chat */
  readonly trade: InstanceType<typeof core.TradeModel>;
  /** set by the trade panel: `/trade` alone toggles it (without one the window is printed as chat lines) */
  onTradeToggle: (() => void) | null = null;
  /** the NPC sect state shown by `SectPanel` (D98); fed by the same net hooks as the chat */
  readonly sect: InstanceType<typeof core.SectModel>;
  /** set by the sect panel: `/sect` toggles it (without one the sect is printed as chat lines) */
  onSectToggle: (() => void) | null = null;
  /** the friend list shown by `FriendsPanel` (D96); fed by the same net hooks as the chat */
  readonly friends: InstanceType<typeof core.FriendsModel>;
  /** set by the friends panel: `/friends` toggles it (without one the list is printed as chat lines) */
  onFriendsToggle: (() => void) | null = null;
  private readonly root: HTMLDivElement;
  private readonly list: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private readonly onResize: () => void;
  private drawn = -1;
  /** party commands waiting for their answer (by clientMsgId), to know what a `party_result` was about */
  private readonly asked = new Map<number, { op: number; name: string }>();
  private compact = false;

  constructor(
    private readonly net: InstanceType<typeof core.NetClient>,
    username: string,
    parent: HTMLElement = document.body,
  ) {
    this.log = new core.ChatLog({
      myName: () => username,
      onTrade: () => this.showTrade(),
      onSect: () => this.showSect(),
      onFriends: () => this.showFriends(),
    });
    this.party = new core.PartyModel({ myId: () => net.entityId, now: () => performance.now() });
    this.trade = new core.TradeModel({ now: () => performance.now() });
    this.sect = new core.SectModel();
    this.friends = new core.FriendsModel();
    // a separate hook object: combat replaces `net.events` wholesale when it attaches
    net.chatEvents = {
      onChatMsg: (m) => this.log.applyMsg(m),
      onChatHistory: (m) => this.log.applyHistory(m),
      onChatResult: (m) => this.log.applyResult(m),
    };
    // party (D93): roster / invites / answers show up as chat lines, vitals only feed the frames
    net.partyEvents = {
      onPartyState: (m) => {
        const line = this.party.applyState(m);
        if (line) this.log.system(line, 'party');
      },
      onPartyVitals: (m) => this.party.applyVitals(m),
      onPartyInvite: (m) => this.log.system(this.party.applyInvite(m), 'party'),
      onPartyResult: (m) => {
        const asked = this.asked.get(m.clientMsgId);
        this.asked.delete(m.clientMsgId);
        const refusal = this.party.applyResult(m);
        if (refusal) this.log.system(refusal, 'error');
        else if (asked && asked.op === core.PartyOp.Decline) this.party.forgetInvite(asked.name);
      },
    };
    // trade (D102): the window lives in the panel; invites, a window opening / closing / completing and refusals show up as chat lines
    net.tradeEvents = {
      onTradeInvite: (m) => this.log.system(this.trade.applyInvite(m), 'system'),
      onTradeState: (m) => {
        const line = this.trade.applyState(m);
        if (line) this.log.system(line, 'system');
      },
      onTradeResult: (m) => {
        const refusal = this.trade.applyResult(m);
        if (refusal) this.log.system(refusal, 'error');
      },
    };
    // sect (D98): the library lives in the panel; only join / leave / learned manuals / refusals show up as chat lines
    net.sectEvents = {
      onSectState: (m) => {
        const line = this.sect.applyState(m);
        if (line) this.log.system(line, 'system');
      },
      onSectResult: (m) => {
        const refusal = this.sect.applyResult(m);
        if (refusal) this.log.system(refusal, 'error');
      },
    };
    // friends (D96): the list lives in the panel; only requests / new friends / refusals show up as chat lines
    net.friendEvents = {
      onFriendState: (m) => {
        const line = this.friends.applyState(m);
        if (line) this.log.system(line, 'system');
      },
      onFriendResult: (m) => {
        const refusal = this.friends.applyResult(m);
        if (refusal) this.log.system(refusal, 'error');
      },
    };

    const root = document.createElement('div');
    root.id = 'vgtd-chat';
    Object.assign(root.style, {
      position: 'fixed',
      left: '8px',
      bottom: '8px',
      width: `${WIDTH}px`,
      maxWidth: 'calc(100vw - 16px)',
      height: `${HEIGHT}px`,
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
      font: '13px/1.35 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: TONE_COLOR.world,
      zIndex: '500',
      pointerEvents: 'none', // clicks on the log fall through to the game (click-to-move); only the input takes them
    } as Partial<CSSStyleDeclaration>);
    const list = document.createElement('div');
    list.id = 'vgtd-chat-log';
    Object.assign(list.style, {
      flex: '1 1 auto',
      minHeight: '0',
      overflow: 'hidden',
      padding: '4px 6px',
      background: 'rgba(8,10,18,0.45)',
      borderRadius: '6px 6px 0 0',
      textShadow: '0 1px 2px #000',
      wordBreak: 'break-word',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'flex-end',
    } as Partial<CSSStyleDeclaration>);
    const input = document.createElement('input');
    input.id = 'vgtd-chat-input';
    input.type = 'text';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.maxLength = 256;
    input.placeholder = 'Enter để chat · /help';
    Object.assign(input.style, {
      flex: '0 0 auto',
      pointerEvents: 'auto',
      boxSizing: 'border-box',
      width: '100%',
      padding: '5px 8px',
      font: '13px sans-serif',
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.75)',
      border: '1px solid #556',
      borderRadius: '0 0 6px 6px',
      outline: 'none',
    } as Partial<CSSStyleDeclaration>);
    root.append(list, input);
    parent.appendChild(root);
    this.root = root;
    this.list = list;
    this.input = input;

    // nothing typed in the box may reach the game's window-level hotkeys
    const stop = (e: Event): void => e.stopPropagation();
    input.addEventListener('keydown', (e) => {
      stop(e);
      if (e.key === 'Enter') {
        e.preventDefault();
        this.submit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        input.value = ''; // Esc cancels what was typed
        input.blur();
      }
    });
    input.addEventListener('keyup', stop);
    input.addEventListener('keypress', stop);
    input.addEventListener('focus', () => this.onFocus());
    input.addEventListener('blur', () => this.layout());
    // tapping the folded strip opens it (the strip itself lets clicks through; this is for the strip's own area on touch screens)
    list.addEventListener('pointerdown', () => {
      if (this.compact) input.focus();
    });

    // Enter or "/" (outside any text field) takes the keyboard; the box is the only thing that listens for them
    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
      if (e.key === 'Enter' || e.key === '/') {
        e.preventDefault();
        this.focus(e.key === '/' ? '/' : '');
      }
    };
    window.addEventListener('keydown', this.keyDown);
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();
    this.log.system('Chat: Enter để gõ, /help để xem lệnh.');

    // automation hook (scripts/chat-online-smoke.mjs): read / drive the box without touching the DOM
    (globalThis as unknown as Record<string, unknown>).__vgtdChat = {
      lines: () => this.log.entries.map((e) => ({ tone: e.tone, text: e.text })),
      say: (raw: string) => this.command(raw),
      focused: () => document.activeElement === this.input,
      compact: () => this.compact,
      /** box rect and the shared joystick zone, for the touch smoke check */
      placement: () => {
        const r = this.root.getBoundingClientRect();
        const j = core.touchChatPlacement(window.innerWidth, window.innerHeight).joystick;
        return { box: { x: r.x, y: r.y, w: r.width, h: r.height }, joystick: j };
      },
    };
  }

  /** Per frame: redraw only when the log changed. */
  update(): void {
    if (this.drawn === this.log.version) return;
    this.drawn = this.log.version;
    const shown = this.compact && document.activeElement !== this.input ? 2 : 14;
    const frag = document.createDocumentFragment();
    for (const e of this.log.entries.slice(-shown)) {
      const row = document.createElement('div');
      row.textContent = e.text; // text only, never markup
      row.style.color = TONE_COLOR[e.tone] ?? TONE_COLOR.world!;
      frag.appendChild(row);
    }
    this.list.replaceChildren(frag);
  }

  /** Run one line as if typed: chat, `/` commands, party commands. Also used by the party frames' Accept / Decline buttons. */
  command(raw: string): boolean {
    return this.log.submit(
      raw,
      (m) => this.net.sendChat(m),
      (m) => {
        const ok = this.net.sendParty(m);
        if (ok) {
          this.asked.set(m.clientMsgId, { op: m.op, name: m.name });
          if (this.asked.size > 16) this.asked.delete(this.asked.keys().next().value as number);
        }
        return ok;
      },
      (m) => this.net.sendSect(m),
      (m) => this.net.sendFriend(m),
      (m) => this.net.sendTrade(m),
    );
  }

  /** `/trade` alone: toggle the panel when there is one, else print the window as chat lines. */
  private showTrade(): void {
    if (this.onTradeToggle) this.onTradeToggle();
    else for (const l of this.trade.summaryLines()) this.log.system(l);
  }

  /** `/sect`: toggle the panel when there is one, else print the sect as chat lines. */
  private showSect(): void {
    if (this.onSectToggle) this.onSectToggle();
    else for (const l of this.sect.summaryLines()) this.log.system(l);
  }

  /** `/friends`: toggle the panel when there is one, else print the list. */
  private showFriends(): void {
    if (this.onFriendsToggle) this.onFriendsToggle();
    else for (const l of this.friends.summaryLines()) this.log.system(l);
  }

  focus(prefill = ''): void {
    this.input.focus();
    if (prefill) this.input.value = prefill;
  }

  private submit(): void {
    const raw = this.input.value;
    this.input.value = '';
    this.command(raw);
    this.input.blur(); // back to playing; Enter again to continue the conversation
  }

  private onFocus(): void {
    // keys held while the box took the keyboard would never see their keyup: release the movement keys explicitly
    for (const code of MOVEMENT_CODES) window.dispatchEvent(new KeyboardEvent('keyup', { code, key: code }));
    this.layout();
  }

  /** Small or touch screens: a 2-line strip until the player taps / focuses it (docs/05). */
  private layout(): void {
    const touch = typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
    this.compact = touch || window.innerWidth < 700;
    const open = !this.compact || document.activeElement === this.input;
    let height = open ? HEIGHT : STRIP_HEIGHT;
    if (touch) {
      // the bottom-left corner belongs to the floating joystick (shared `joystick-zone`): follow the shared `chat-ticker` rect instead,
      // and grow the opened box upwards from it (never down into the joystick zone)
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const { strip } = core.touchChatPlacement(vw, vh);
      const bottom = vh - (strip.y + strip.h);
      height = Math.min(height, vh - bottom);
      Object.assign(this.root.style, {
        left: `${strip.x}px`,
        bottom: `${bottom}px`,
        width: `${strip.w}px`,
        maxWidth: 'none',
      } as Partial<CSSStyleDeclaration>);
    } else {
      Object.assign(this.root.style, {
        left: '8px',
        bottom: '8px',
        width: `${WIDTH}px`,
        maxWidth: 'calc(100vw - 16px)',
      } as Partial<CSSStyleDeclaration>);
    }
    this.root.style.height = `${height}px`;
    this.list.style.pointerEvents = this.compact ? 'auto' : 'none';
    this.drawn = -1; // the number of visible lines may have changed
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
