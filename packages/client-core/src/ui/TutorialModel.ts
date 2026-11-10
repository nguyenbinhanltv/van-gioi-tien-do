/**
 * Tutorial model (D105, docs/16): what the client shows of the SERVER's first-session tracker. It is fed by `tutorial_state` only (the
 * server decides every step; the client never reports progress except "skip") and turns it into one non-blocking hint card: the
 * current step, a short contextual hint that depends on the input mode (docs/16 §2: the same lesson with PC or touch wording), a
 * progress count, and the optional tips once the required steps are done. Engine-free and DOM-free; the Cocos `TutorialHints`
 * only draws `view()`. The texts are in the string table (first editorial pass, OPEN-ITEMS 22).
 */
import {
  TUTORIAL,
  TUTORIAL_FLAG_COMPLETE,
  TUTORIAL_FLAG_SKIPPED,
  TUTORIAL_REQUIRED_COUNT,
  TUTORIAL_STEPS,
  tutorialBit,
  type TutorialStepId,
} from '@vgtd/shared';
import type { TutorialStateMsg } from '@vgtd/protocol';
import { t, type StringKey } from '../i18n/strings.js';

export type TutorialInputMode = 'pointer' | 'touch';

export interface TutorialStepText {
  /** one line, what to do */
  title: string;
  /** how, per input mode */
  hint: Record<TutorialInputMode, string>;
}

/** String keys of every step's title and per-mode hint (the texts are in the string table). */
const TUTORIAL_KEYS: Readonly<Record<TutorialStepId, { title: StringKey; pointer: StringKey; touch: StringKey }>> = {
  move: { title: 'tutorial.move.title', pointer: 'tutorial.move.pointer', touch: 'tutorial.move.touch' },
  field: { title: 'tutorial.field.title', pointer: 'tutorial.field.pointer', touch: 'tutorial.field.touch' },
  skill: { title: 'tutorial.skill.title', pointer: 'tutorial.skill.pointer', touch: 'tutorial.skill.touch' },
  kills: { title: 'tutorial.kills.title', pointer: 'tutorial.kills.pointer', touch: 'tutorial.kills.touch' },
  loot: { title: 'tutorial.loot.title', pointer: 'tutorial.loot.pointer', touch: 'tutorial.loot.touch' },
  meditate: {
    title: 'tutorial.meditate.title',
    pointer: 'tutorial.meditate.pointer',
    touch: 'tutorial.meditate.touch',
  },
  breakthrough: {
    title: 'tutorial.breakthrough.title',
    pointer: 'tutorial.breakthrough.pointer',
    touch: 'tutorial.breakthrough.touch',
  },
  item: { title: 'tutorial.item.title', pointer: 'tutorial.item.pointer', touch: 'tutorial.item.touch' },
  chat: { title: 'tutorial.chat.title', pointer: 'tutorial.chat.pointer', touch: 'tutorial.chat.touch' },
  party: { title: 'tutorial.party.title', pointer: 'tutorial.party.pointer', touch: 'tutorial.party.touch' },
};

/**
 * Title and hints of every step, read through the string table (each property is a getter: it follows the installed language).
 * `{n}` of the kills title = `TUTORIAL.killTarget`.
 */
export const TUTORIAL_TEXT: Readonly<Record<TutorialStepId, TutorialStepText>> = Object.fromEntries(
  (Object.keys(TUTORIAL_KEYS) as TutorialStepId[]).map((id) => {
    const k = TUTORIAL_KEYS[id];
    return [
      id,
      {
        get title() {
          return t(k.title, { n: TUTORIAL.killTarget });
        },
        hint: {
          get pointer() {
            return t(k.pointer);
          },
          get touch() {
            return t(k.touch);
          },
        },
      },
    ];
  }),
) as Record<TutorialStepId, TutorialStepText>;

export interface TutorialStepView {
  id: TutorialStepId;
  title: string;
  done: boolean;
  required: boolean;
}
export interface TutorialView {
  /** the card should be on screen: state received, not skipped, and something left to say */
  visible: boolean;
  skipped: boolean;
  /** every required step is done */
  complete: boolean;
  /** required steps done / required steps */
  completed: number;
  total: number;
  /** the step the card points at (null when only the closing message is left) */
  current: TutorialStepView | null;
  /** is `current` an optional tip rather than a required step */
  isTip: boolean;
  /** contextual hint for `current` in the given input mode ('' when none) */
  hint: string;
  /** `current` progress detail, e.g. kills "1/3" ('' when none) */
  progress: string;
  steps: TutorialStepView[];
}

export class TutorialModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private doneMask = 0;
  private killCount = 0;
  private flags = 0;
  private got = false;

  /** a `tutorial_state` has arrived (a server without the module never sends one: the old client-side loop stays in charge) */
  get received(): boolean {
    return this.got;
  }
  get skipped(): boolean {
    return (this.flags & TUTORIAL_FLAG_SKIPPED) !== 0;
  }
  get complete(): boolean {
    return (this.flags & TUTORIAL_FLAG_COMPLETE) !== 0;
  }
  get kills(): number {
    return this.killCount;
  }
  isDone(id: TutorialStepId): boolean {
    return (this.doneMask & tutorialBit(id)) !== 0;
  }

  applyState(m: TutorialStateMsg): void {
    this.doneMask = m.done;
    this.killCount = m.kills;
    this.flags = m.flags;
    this.got = true;
    this.version++;
  }

  view(mode: TutorialInputMode): TutorialView {
    const steps = TUTORIAL_STEPS.map((id, k): TutorialStepView => ({
      id,
      title: TUTORIAL_TEXT[id].title,
      done: this.isDone(id),
      required: k < TUTORIAL_REQUIRED_COUNT,
    }));
    const completed = steps.filter((s) => s.required && s.done).length;
    // the first unfinished REQUIRED step; once those are done, the first unfinished tip
    const current = steps.find((s) => s.required && !s.done) ?? steps.find((s) => !s.done) ?? null;
    const isTip = !!current && !current.required;
    const progress =
      current?.id === 'kills' ? `${Math.min(this.killCount, TUTORIAL.killTarget)}/${TUTORIAL.killTarget}` : '';
    return {
      visible: this.got && !this.skipped && current !== null,
      skipped: this.skipped,
      complete: this.complete,
      completed,
      total: TUTORIAL_REQUIRED_COUNT,
      current,
      isTip,
      hint: current ? TUTORIAL_TEXT[current.id].hint[mode] : '',
      progress,
      steps,
    };
  }
}
