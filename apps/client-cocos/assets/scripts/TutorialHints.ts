/**
 * Tutorial hint card (D105, docs/16): ONE small card, top centre under the target frame, that says what to do next in the first-session
 * flow (login to the first breakthrough) with wording for the current input mode, a progress count, and a "Bỏ qua" (skip) button.
 * Non-blocking by construction: the card takes no pointer events except on its own skip button, never pauses or gates anything, and
 * goes away for good once skipped. Everything it shows is the SERVER's tracker (`tutorial_state`); the only thing the client sends
 * is the skip. DOM overlay like the chat box and the party frames, drawn with `textContent` ONLY. Placement follows the shared layout
 * (`tutorial-hint` widget through `tutorialHintPlacement`), so it never covers the joystick, skill wheel, minimap or the other cards.
 *
 * After the required steps the card gives the optional tips (use an item, chat, party) one at a time, each for `TIP_SHOW_S` seconds,
 * and shows a short "done" message the first time the flow completes in this session. `?tutorial=0` turns the card off.
 */
import { core } from './vendor/vgtd.mjs';

const DONE_SHOW_S = 6;
const TIP_SHOW_S = 20;

export function tutorialRequested(): boolean {
  return new URLSearchParams(location.search).get('tutorial') !== '0';
}

export class TutorialHints {
  readonly model: InstanceType<typeof core.TutorialModel>;
  private readonly root: HTMLDivElement;
  private readonly head: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly hint: HTMLDivElement;
  private readonly onResize: () => void;
  private drawn = -1;
  private mode = '';
  private currentId = '';
  private shownForS = 0;
  private sawIncomplete = false;
  private doneShownForS = -1;
  private visible = false;

  constructor(
    private readonly net: InstanceType<typeof core.NetClient>,
    parent: HTMLElement = document.body,
  ) {
    this.model = new core.TutorialModel();
    net.tutorialEvents = { onTutorialState: (m) => this.model.applyState(m) };

    const root = document.createElement('div');
    root.id = 'vgtd-tutorial';
    Object.assign(root.style, {
      position: 'fixed',
      left: '0px',
      top: '0px',
      width: '420px',
      boxSizing: 'border-box',
      padding: '8px 12px',
      display: 'none',
      font: '13px/1.35 sans-serif',
      textAlign: 'left', // the page CSS centres text
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.78)',
      border: '1px solid #e8c872',
      borderRadius: '8px',
      textShadow: '0 1px 2px #000',
      zIndex: '350', // under the party frames (400) and the chat box (500)
      pointerEvents: 'none', // never blocks the game; only the skip button takes taps
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    head.style.color = '#e8c872';
    head.style.fontWeight = 'bold';
    const title = document.createElement('div');
    title.style.marginTop = '2px';
    const hint = document.createElement('div');
    hint.style.marginTop = '2px';
    hint.style.color = '#9fd4ff';
    const skip = document.createElement('button');
    skip.id = 'vgtd-tutorial-skip';
    skip.textContent = 'Bỏ qua';
    Object.assign(skip.style, {
      position: 'absolute',
      right: '8px',
      top: '6px',
      padding: '3px 10px',
      font: '12px sans-serif',
      color: '#f0f0f5',
      background: '#33405a',
      border: '1px solid #8a93a8',
      borderRadius: '4px',
      cursor: 'pointer',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    skip.addEventListener('click', () => this.skip());
    root.append(head, title, hint, skip);
    parent.appendChild(root);
    this.root = root;
    this.head = head;
    this.title = title;
    this.hint = hint;
    this.onResize = () => this.layout();
    window.addEventListener('resize', this.onResize);
    this.layout();

    // automation hook (scripts/tutorial-online-smoke.mjs)
    (globalThis as unknown as Record<string, unknown>).__vgtdTutorial = {
      view: () => {
        const v = this.model.view(this.inputMode());
        return {
          received: this.model.received,
          visible: this.visible,
          skipped: v.skipped,
          complete: v.complete,
          completed: v.completed,
          total: v.total,
          current: v.current?.id ?? null,
          isTip: v.isTip,
          hint: v.hint,
          progress: v.progress,
          done: v.steps.filter((s) => s.done).map((s) => s.id),
        };
      },
      rect: () => {
        const r = this.root.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
      text: () => this.root.innerText,
      skip: () => this.skip(),
    };
  }

  /** True once the server has sent its tutorial state: the old client-side checklist should step aside. */
  get active(): boolean {
    return this.model.received;
  }

  private inputMode(): 'pointer' | 'touch' {
    return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches ? 'touch' : 'pointer';
  }

  private skip(): void {
    this.net.sendTutorialSkip();
  }

  private layout(): void {
    const p = core.tutorialHintPlacement(window.innerWidth, window.innerHeight, this.inputMode() === 'touch');
    Object.assign(this.root.style, {
      left: `${p.x}px`,
      top: `${p.y}px`,
      width: `${p.w}px`,
      minHeight: `${p.h}px`,
      fontSize: `${Math.max(11, Math.round(13 * Math.max(0.8, p.scale)))}px`,
    } as Partial<CSSStyleDeclaration>);
    this.drawn = -1;
  }

  /** Per frame: redraw when the state or the input mode changed; tips and the closing message time out locally. */
  update(dt: number): void {
    const mode = this.inputMode();
    if (mode !== this.mode) {
      this.mode = mode;
      this.layout();
    }
    const v = this.model.view(mode);
    if (!v.complete) this.sawIncomplete = true;
    // the closing message: the first time this session sees the flow complete after having seen it incomplete
    if (v.complete && this.sawIncomplete && this.doneShownForS < 0) this.doneShownForS = 0;
    if (this.doneShownForS >= 0 && this.doneShownForS < DONE_SHOW_S) this.doneShownForS += dt;
    const closing = this.doneShownForS >= 0 && this.doneShownForS < DONE_SHOW_S;

    const id = v.current?.id ?? '';
    if (id !== this.currentId) {
      this.currentId = id;
      this.shownForS = 0;
    } else this.shownForS += dt;
    const tipExpired = v.isTip && this.shownForS > TIP_SHOW_S;
    const show = this.model.received && !v.skipped && (closing || (v.visible && !tipExpired));

    if (this.drawn !== this.model.version || this.visible !== show || this.hint.dataset.closing !== String(closing)) {
      this.drawn = this.model.version;
      this.hint.dataset.closing = String(closing);
      this.visible = show;
      this.root.style.display = show ? 'block' : 'none';
      if (closing && (v.isTip || v.current === null)) {
        this.head.textContent = 'Hành trình đầu tiên: hoàn thành!';
        this.title.textContent = 'Bạn đã đi từ điểm xuất phát tới lần đột phá đầu tiên.';
        this.hint.textContent = v.current ? `Gợi ý thêm: ${v.current.title.toLowerCase()}.` : '';
      } else if (v.current) {
        this.head.textContent = v.isTip ? 'Gợi ý thêm' : `Hành trình đầu tiên ${v.completed}/${v.total}`;
        this.title.textContent = v.progress ? `${v.current.title} (${v.progress})` : v.current.title; // text only
        this.hint.textContent = v.hint;
      }
    }
  }

  destroy(): void {
    window.removeEventListener('resize', this.onResize);
    this.root.remove();
  }
}
