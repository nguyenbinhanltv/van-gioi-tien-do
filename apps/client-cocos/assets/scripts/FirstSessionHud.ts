import { Color, Label, Node, Sprite, UITransform } from 'cc';
import { core } from './vendor/vgtd.mjs';
import { newNode } from './IsoAdapter';
import type { ArtFrames } from './PlaceholderArt';
import { sharedAtlas } from './UiLabel';

type Net = InstanceType<typeof core.NetClient>;
type Tracker = InstanceType<typeof core.FirstSessionTracker>;

/**
 * First-session objective widget (D84): a small checklist, top-left under the perf HUD, that walks a new player through
 * field -> kills -> bag -> meditate -> breakthrough. The logic is client-core `FirstSessionTracker` (unit tested); this class only
 * feeds it and draws `tracker.view()`. Everything it reads is server state (own kills from `skill_result`, `net.bag`, `char_state`);
 * there is no quest system and nothing is stored server-side. Progress is kept per user name in localStorage so a reload does not
 * restart the loop. Online only; `?firstsession=0` turns it off. Layout contract: TOP-LEFT, below the perf HUD, `PANEL_W` x
 * `PANEL_H` design units; the progression HUD owns the top-right and the bag the right-middle, the bag is drawn above this widget.
 */
export const PANEL_W = 330;
export const PANEL_H = 142;
const TOP_OFFSET = 200; // below the perf HUD (it ends at ~190 design units)
const MARGIN = 8;
const ROW_H = 18;
const SHOW_DONE_S = 10;

const COL = {
  panel: new Color(10, 12, 20, 150),
  title: new Color(235, 225, 190, 255),
  done: new Color(120, 200, 140, 255),
  current: new Color(255, 225, 110, 255),
  todo: new Color(150, 150, 160, 255),
  hint: new Color(150, 200, 235, 255),
};
const MARK = { done: '[x] ', current: '[>] ', todo: '[ ] ' } as const;

function label(parent: Node, name: string, size: number, color: Color): Label {
  const n = newNode(name, parent);
  const ui = n.addComponent(UITransform);
  ui.setAnchorPoint(0, 0.5);
  const l = n.addComponent(Label);
  l.fontSize = size;
  l.lineHeight = size + 2;
  l.horizontalAlign = Label.HorizontalAlign.LEFT;
  l.verticalAlign = Label.VerticalAlign.CENTER;
  l.overflow = Label.Overflow.NONE;
  l.color = color;
  sharedAtlas(l);
  return l;
}

/** What Bootstrap hands over each frame (all read from other systems, nothing is computed twice). */
export interface FirstSessionFrame {
  pos: { i: number; j: number };
  bagOpen: boolean;
  meditating: boolean;
  tuViFraction: number;
}

const storageKey = (user: string): string => `vgtd.firstSession.v1.${user}`;
function readStored(user: string): ReturnType<typeof core.parseFirstSessionSnapshot> {
  try {
    return core.parseFirstSessionSnapshot(globalThis.localStorage?.getItem(storageKey(user)));
  } catch {
    return null; // storage can be blocked (privacy mode): the loop just restarts
  }
}
function writeStored(user: string, s: unknown): void {
  try {
    globalThis.localStorage?.setItem(storageKey(user), JSON.stringify(s));
  } catch {
    /* ignore: progress is a convenience, not state */
  }
}

export function firstSessionRequested(): boolean {
  return new URLSearchParams(location.search).get('firstsession') !== '0';
}

export class FirstSessionHud {
  readonly tracker: Tracker;
  private readonly root: Node;
  private readonly title: Label;
  private readonly rows: Label[] = [];
  private readonly hint: Label;
  private scale = 1;
  private doneForS = 0;

  constructor(
    hudParent: Node,
    art: ArtFrames,
    private readonly net: Net,
    private readonly mapTiles: number,
    user: string,
  ) {
    this.tracker = new core.FirstSessionTracker({
      mapTiles,
      restore: readStored(user),
      onChange: (s) => writeStored(user, s),
    });
    this.root = newNode('FirstSessionHud', hudParent);
    const bg = newNode('Panel', this.root);
    bg.addComponent(UITransform).setContentSize(PANEL_W, PANEL_H);
    bg.setPosition(PANEL_W / 2, -PANEL_H / 2, 0);
    const sp = bg.addComponent(Sprite);
    sp.sizeMode = Sprite.SizeMode.CUSTOM;
    sp.spriteFrame = art.pixel;
    sp.color = COL.panel;
    this.title = label(this.root, 'Title', 15, COL.title);
    this.title.node.setPosition(10, -14, 0);
    for (let k = 0; k < core.FIRST_SESSION_STEPS.length; k++) {
      const l = label(this.root, `Row${k}`, 13, COL.todo);
      l.node.setPosition(10, -36 - k * ROW_H, 0);
      this.rows.push(l);
    }
    this.hint = sharedAtlas(label(this.root, 'Hint', 12, COL.hint), 'dynamic'); // the distance changes as you walk
    this.hint.node.setPosition(10, -PANEL_H + 14, 0);
    this.layout(1280, 720);
    // automation hook (scripts/bag-smoke.mjs): the tracker state without touching the DOM / canvas pixels
    (globalThis as unknown as Record<string, unknown>).__vgtdFirstSession = {
      state: () => ({ ...this.tracker.view(), kills: this.tracker.kills, snapshot: this.tracker.snapshot() }),
    };
  }

  /**
   * Also listen for the breakthrough answer. Call AFTER the progression HUD was created: it owns `net.progressionEvents` and
   * replaces it wholesale, so this wraps what is there instead of competing with it.
   */
  hookProgression(): void {
    const prev = this.net.progressionEvents;
    this.net.progressionEvents = {
      ...prev,
      onBreakthroughResult: (m) => {
        prev.onBreakthroughResult?.(m);
        this.tracker.onBreakthroughResult(m.outcome);
      },
    };
  }

  /** Top-left, below the perf HUD, shrunk on narrow canvases. */
  layout(canvasW: number, canvasH: number): void {
    this.scale = Math.min(1, (canvasW - 2 * MARGIN) / PANEL_W);
    this.root.setScale(this.scale, this.scale, 1);
    this.root.setPosition(-canvasW / 2 + MARGIN, canvasH / 2 - TOP_OFFSET * Math.min(1, canvasH / 720), 0);
  }

  update(dt: number, f: FirstSessionFrame): void {
    const bag = this.net.bag;
    const centre = this.mapTiles / 2;
    this.tracker.update({
      fromCentre: Math.max(Math.abs(f.pos.i - centre), Math.abs(f.pos.j - centre)),
      bagOpen: f.bagOpen,
      bagReady: bag.ready,
      hasLoot: bag.ready && (bag.freeSlots() < bag.slotCount || Object.values(bag.wallet).some((v) => Number(v) > 0)),
      pending: bag.pending.length,
      meditating: f.meditating,
      tuViFraction: f.tuViFraction,
    });
    const v = this.tracker.view();
    if (v.done) {
      this.doneForS += dt;
      this.root.active = this.doneForS < SHOW_DONE_S;
    }
    this.title.string = v.done
      ? core.t('firstsession.hud.title_done')
      : core.t('firstsession.hud.title', { done: v.completed, total: v.steps.length });
    let hint = '';
    for (let k = 0; k < v.steps.length; k++) {
      const s = v.steps[k]!;
      this.rows[k]!.string = MARK[s.state] + s.text;
      this.rows[k]!.color = s.state === 'done' ? COL.done : s.state === 'current' ? COL.current : COL.todo;
      if (s.state === 'current') hint = s.hint;
    }
    this.hint.string = hint;
  }

  destroy(): void {
    this.root.destroy();
  }
}
