/**
 * Quest log and tracker (D107, docs/12): two small DOM overlays.
 *
 *  - The TRACKER is always visible once online (top right): up to three quests being worked on with their objective lines, and - when the
 *    player stands in reach of an NPC that matters - one button per thing that NPC can do now: "Nhận" (accept), "Trả nhiệm vụ" (turn in),
 *    "Nói chuyện" (a talk objective). That is the NPC interaction until the NPC art lands; a "?" / "!" marker is shown next to the
 *    nearest NPC's name exactly like the marker that will float over its head.
 *  - The LOG (`J` or `/quest`) lists what is being done (with rewards, pin and abandon), what can be accepted and how many are done,
 *    plus the daily / weekly reset countdowns.
 *
 * Everything shown is `QuestModel` from client-core, drawn with `textContent` ONLY, and every button only sends an intent
 * (`quest_cmd`): the server checks distance, prerequisites and objectives and pays the rewards.
 */
import { core } from './vendor/vgtd.mjs';

const BTN: Partial<CSSStyleDeclaration> = {
  marginLeft: '4px',
  padding: '2px 7px',
  font: '11px sans-serif',
  color: '#f0f0f5',
  background: '#33405a',
  border: '1px solid #7fd4ff',
  borderRadius: '4px',
  cursor: 'pointer',
};
const GOLD = '#f0dc96';
const MUTED = '#b6bccb';

export interface QuestPanelHooks {
  /** one `quest_cmd`; false when the socket is not open */
  send(op: number, arg: string, clientMsgId: number): boolean;
  /** tile position of the local player, null before spawn */
  position(): { i: number; j: number } | null;
  /** side of the (square) map in tiles */
  mapTiles(): number;
  /** the tracker was clicked: walk to the current objective (D124) */
  go?(): void;
  /** objective progress / completion to show as floating text and a tracker flash (D124) */
  feedback?(items: ReturnType<InstanceType<typeof core.QuestModel>['drainFeedback']>): void;
}

export class QuestPanel {
  private readonly tracker: HTMLDivElement;
  private readonly log: HTMLDivElement;
  private readonly logBody: HTMLDivElement;
  private readonly logTitle: HTMLDivElement;
  private readonly keyDown: (e: KeyboardEvent) => void;
  private drawnLog = -1;
  private drawnTracker = '';
  private open = false;
  private nextId = 1;
  /** until this time (performance.now) the tracker shows a brief highlight after an objective moved */
  private flash = 0;

  constructor(
    readonly model: InstanceType<typeof core.QuestModel>,
    readonly hooks: QuestPanelHooks,
    /** a line for the chat log (announcements and refusals) */
    private readonly say: (line: string, tone: 'system' | 'error') => void,
    parent: HTMLElement = document.body,
  ) {
    const tracker = document.createElement('div');
    tracker.id = 'vgtd-quest-tracker';
    Object.assign(tracker.style, {
      position: 'fixed',
      right: '12px',
      top: '204px', // below the minimap (176 px + its 12 px margin), D124
      width: '230px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: '150px',
      overflow: 'hidden',
      display: 'none',
      padding: '4px 8px',
      font: '11px/1.3 sans-serif',
      textAlign: 'left',
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.6)',
      border: '1px solid rgba(127,212,255,0.5)',
      borderRadius: '6px',
      zIndex: '440',
      pointerEvents: 'auto',
    } as Partial<CSSStyleDeclaration>);
    parent.appendChild(tracker);
    this.tracker = tracker;

    const log = document.createElement('div');
    log.id = 'vgtd-quest-log';
    Object.assign(log.style, {
      position: 'fixed',
      left: '50%',
      top: '80px',
      transform: 'translateX(-50%)',
      width: '380px',
      maxWidth: 'calc(100vw - 32px)',
      maxHeight: 'calc(100vh - 220px)',
      overflowY: 'auto',
      display: 'none',
      padding: '8px',
      font: '12px/1.35 sans-serif',
      textAlign: 'left',
      color: '#f0f0f5',
      background: 'rgba(8,10,18,0.9)',
      border: '1px solid #7fd4ff',
      borderRadius: '8px',
      zIndex: '450',
    } as Partial<CSSStyleDeclaration>);
    const head = document.createElement('div');
    Object.assign(head.style, { display: 'flex', justifyContent: 'space-between', marginBottom: '6px' });
    this.logTitle = document.createElement('div');
    this.logTitle.style.fontWeight = 'bold';
    const close = document.createElement('button');
    close.textContent = '×';
    close.title = core.t('quest.panel.close_hint');
    Object.assign(close.style, BTN);
    close.addEventListener('click', () => this.toggle(false));
    head.append(this.logTitle, close);
    this.logBody = document.createElement('div');
    log.append(head, this.logBody);
    parent.appendChild(log);
    this.log = log;

    this.keyDown = (e) => {
      if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      if (e.code === 'KeyJ') this.toggle();
    };
    window.addEventListener('keydown', this.keyDown);

    // automation hook (scripts/quests-online-smoke.mjs): what the panels show and a way to press their buttons
    (globalThis as unknown as Record<string, unknown>).__vgtdQuests = {
      visible: () => this.open,
      toggle: () => this.toggle(),
      active: () => this.model.active().map((v) => ({ id: v.id, status: v.status, lines: v.lines })),
      available: () => this.model.available().map((v) => v.id),
      completed: () => this.model.completedCount(),
      tracker: () => this.tracker.textContent ?? '',
      actions: () => this.actions().map((a) => a.label),
      /** press the tracker action whose label contains `label` */
      press: (label: string) => {
        const b = Array.from(this.tracker.querySelectorAll('button')).find((x) =>
          (x.textContent ?? '').includes(label),
        );
        b?.click();
        return !!b;
      },
      send: (op: number, arg: string) => this.send(op, arg),
      rect: () => {
        const r = this.tracker.getBoundingClientRect();
        return { x: r.x, y: r.y, w: r.width, h: r.height };
      },
    };
  }

  get visible(): boolean {
    return this.open;
  }
  toggle(force?: boolean): void {
    this.open = force ?? !this.open;
    this.log.style.display = this.open ? 'block' : 'none';
    this.drawnLog = -1;
  }

  /** Feed from the net hooks (set by the owner of `net.questEvents`). Announcements and refusals go to the chat log. */
  onState(m: Parameters<InstanceType<typeof core.QuestModel>['applyState']>[0]): void {
    for (const line of this.model.applyState(m, performance.now())) this.say(line, 'system');
    const fb = this.model.drainFeedback();
    if (fb.length) {
      this.flash = performance.now() + 1200;
      this.drawnTracker = '';
      this.hooks.feedback?.(fb);
    }
  }
  onResult(m: Parameters<InstanceType<typeof core.QuestModel>['applyResult']>[0]): void {
    const refusal = this.model.applyResult(m);
    if (refusal) this.say(refusal, 'error');
  }

  /** An intent sent for the NPC dialogue (same path as the tracker buttons: the server decides). */
  sendIntent(op: number, arg: string): boolean {
    return this.send(op, arg);
  }

  private send(op: number, arg: string): boolean {
    const ok = this.hooks.send(op, arg, this.nextId++ & 0xffff);
    if (!ok) this.say(core.t('chat.err.not_connected'), 'error');
    return ok;
  }

  /** What the nearest NPC (when in reach) can do for the player right now. */
  private actions(): { label: string; run: () => void }[] {
    const near = this.model.nearestNpc(this.hooks.position(), this.hooks.mapTiles());
    if (!near || !near.inReach) return [];
    const out: { label: string; run: () => void }[] = [];
    for (const v of this.model.list([core.QuestStatus.Ready])) {
      if (v.def.turnIn === near.key)
        out.push({
          label: core.t('quest.panel.action_claim', { name: v.name }),
          run: () => void this.send(core.QuestOp.Claim, v.id),
        });
    }
    const talk = this.model
      .active()
      .some(
        (v) =>
          v.status === core.QuestStatus.Active &&
          v.def.objectives.some(
            (o: { kind: string; npc?: string }, i: number) =>
              o.kind === 'talk' && o.npc === near.key && (v.progress[i] ?? 0) < 1,
          ),
      );
    if (talk)
      out.push({
        label: core.t('quest.panel.action_talk', { npc: near.name }),
        run: () => void this.send(core.QuestOp.Talk, near.key),
      });
    for (const v of this.model.available()) {
      if (v.def.giver === near.key)
        out.push({
          label: core.t('quest.panel.action_accept', { name: v.name }),
          run: () => void this.send(core.QuestOp.Accept, v.id),
        });
    }
    return out;
  }

  private btn(label: string, run: () => void): HTMLButtonElement {
    const b = document.createElement('button');
    b.textContent = label;
    Object.assign(b.style, BTN);
    b.addEventListener('click', run);
    return b;
  }
  private text(s: string, color?: string, extra: Partial<CSSStyleDeclaration> = {}): HTMLDivElement {
    const d = document.createElement('div');
    d.textContent = s; // text only, never markup
    if (color) d.style.color = color;
    Object.assign(d.style, extra);
    return d;
  }

  /** Per frame: redraw the tracker when its content changed, the log only when the model changed (or it was just opened). */
  update(): void {
    if (!this.model.ready) return;
    this.drawTracker();
    if (this.open && this.drawnLog !== this.model.version) this.drawLog();
  }

  private drawTracker(): void {
    const near = this.model.nearestNpc(this.hooks.position(), this.hooks.mapTiles());
    const acts = this.actions();
    const tracked = this.model.tracker(2);
    // nothing being worked on: show the first quest that can be accepted, so the player always has somewhere to go (D124)
    const offer = tracked.length === 0 ? this.model.available().slice(0, 1) : [];
    const items = tracked.length ? tracked : offer;
    const marker = near && near.inReach ? this.model.markerFor(near.key) : null;
    const flashing = performance.now() < this.flash;
    const sig = JSON.stringify([
      this.model.version,
      items.map((v) => [v.id, v.lines, v.status]),
      acts.map((a) => a.label),
      near ? [near.key, near.inReach, Math.round(near.dist)] : null,
      flashing,
    ]);
    if (sig === this.drawnTracker) return;
    this.drawnTracker = sig;
    if (items.length === 0 && acts.length === 0) {
      this.tracker.style.display = 'none';
      return;
    }
    this.tracker.style.display = 'block';
    this.tracker.style.borderColor = flashing ? '#ffd84a' : 'rgba(127,212,255,0.5)';
    const frag = document.createDocumentFragment();
    items.forEach((v, n) => {
      const status = v.status;
      const head = this.text(
        `${status === core.QuestStatus.Available ? '! ' : ''}${v.name}`,
        status === core.QuestStatus.Ready ? '#8fe0a0' : GOLD,
        { fontWeight: 'bold' },
      );
      frag.appendChild(head);
      // the objectives (clicking them auto-walks to the first one that is not done; a ready / acceptable quest walks to its NPC)
      const body = document.createElement('div');
      if (n === 0 && this.hooks.go) {
        body.style.cursor = 'pointer';
        body.title = core.t('quest.guide.go_hint');
        body.addEventListener('click', () => this.hooks.go?.());
      }
      if (status === core.QuestStatus.Ready)
        body.appendChild(this.text(core.t('quest.panel.turn_in_at', { npc: v.goToName }), MUTED));
      else if (status === core.QuestStatus.Available)
        body.appendChild(this.text(core.t('quest.panel.go_meet', { npc: v.goToName }), '#7fd4ff'));
      else
        v.lines.forEach((l, i) =>
          body.appendChild(
            this.text(`${v.done[i] ? '✓' : '·'} ${l.replace(/^[·✓]\s*/, '')}`, v.done[i] ? '#8fe0a0' : MUTED),
          ),
        );
      frag.appendChild(body);
    });
    if (acts.length) {
      const row = document.createElement('div');
      row.style.marginTop = '2px';
      if (near)
        row.appendChild(this.text(`${near.name}${marker ? ` ${marker}` : ''}`, GOLD, { display: 'inline-block' }));
      for (const a of acts.slice(0, 2)) row.appendChild(this.btn(a.label, a.run));
      frag.appendChild(row);
    }
    this.tracker.replaceChildren(frag);
  }

  private fmt(s: number): string {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return h >= 24
      ? core.t('quest.panel.duration_days', { d: Math.floor(h / 24), h: h % 24 })
      : core.t('quest.panel.duration_hours', { h, m });
  }

  private drawLog(): void {
    this.drawnLog = this.model.version;
    const reset = this.model.resetIn(performance.now());
    this.logTitle.textContent = core.t('quest.panel.title', { n: this.model.completedCount() });
    const frag = document.createDocumentFragment();
    const heading = (s: string): HTMLDivElement => this.text(s, GOLD, { margin: '8px 0 2px', fontWeight: 'bold' });
    frag.appendChild(
      this.text(core.t('quest.panel.reset', { daily: this.fmt(reset.daily), weekly: this.fmt(reset.weekly) }), MUTED, {
        fontSize: '11px',
      }),
    );

    frag.appendChild(heading(core.t('quest.panel.active')));
    const act = this.model.active();
    if (act.length === 0) frag.appendChild(this.text(core.t('quest.panel.none_active'), MUTED));
    for (const v of act) {
      const box = document.createElement('div');
      Object.assign(box.style, { padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' });
      const top = document.createElement('div');
      Object.assign(top.style, { display: 'flex', alignItems: 'center' });
      const name = this.text(
        core.t('quest.panel.active_row', {
          mark: v.status === core.QuestStatus.Ready ? '? ' : '',
          name: v.name,
          type: v.type,
        }),
        v.status === core.QuestStatus.Ready ? '#8fe0a0' : '#f0f0f5',
        { flex: '1 1 auto', fontWeight: 'bold' },
      );
      top.append(
        name,
        this.btn(this.model.pinned === v.id ? core.t('quest.panel.unpin') : core.t('quest.panel.pin'), () =>
          this.model.pin(v.id),
        ),
        this.btn(core.t('quest.panel.abandon'), () => void this.send(core.QuestOp.Abandon, v.id)),
      );
      box.appendChild(top);
      box.appendChild(this.text(v.desc, MUTED, { fontSize: '11px' }));
      for (const l of v.lines) box.appendChild(this.text(`  ${l}`));
      if (v.goTo)
        box.appendChild(
          this.text(
            core.t(v.status === core.QuestStatus.Ready ? 'quest.panel.go_turn_in' : 'quest.panel.go_meet', {
              npc: v.goToName,
            }),
            '#7fd4ff',
          ),
        );
      box.appendChild(this.text(core.t('quest.panel.reward', { reward: v.reward }), GOLD, { fontSize: '11px' }));
      frag.appendChild(box);
    }

    const av = this.model.available();
    frag.appendChild(heading(core.t('quest.panel.available', { n: av.length })));
    if (av.length === 0) frag.appendChild(this.text(core.t('quest.panel.none_available'), MUTED));
    for (const v of av) {
      const row = document.createElement('div');
      Object.assign(row.style, { padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.08)' });
      row.appendChild(
        this.text(core.t('quest.panel.available_row', { name: v.name, type: v.type, npc: v.goToName }), '#f0f0f5'),
      );
      row.appendChild(this.text(v.desc, MUTED, { fontSize: '11px' }));
      row.appendChild(this.text(core.t('quest.panel.reward', { reward: v.reward }), GOLD, { fontSize: '11px' }));
      frag.appendChild(row);
    }
    this.logBody.replaceChildren(frag);
  }

  destroy(): void {
    window.removeEventListener('keydown', this.keyDown);
    this.tracker.remove();
    this.log.remove();
  }
}
