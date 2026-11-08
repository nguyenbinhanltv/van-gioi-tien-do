/**
 * First-session objective tracker (D84): five ordered steps that guide a new player through spawn -> field -> kills -> loot ->
 * meditate -> breakthrough. Engine-free, no quest system, nothing persisted server-side: it only READS state the server already
 * owns (the player's own kills from `skill_result`, the bag from `inv_state`, tu vi from `char_state`) and remembers which steps
 * were reached. Progress is sticky (a step never un-completes) and steps complete in order. All numbers come from `@vgtd/shared`
 * `FIRST_SESSION` (PLACEHOLDERS, cần game designer duyệt). The widget that draws it lives in the Cocos client.
 */
import { BreakthroughOutcome } from '@vgtd/protocol';
import { FIRST_SESSION, fieldBandStart } from '@vgtd/shared';

export type FirstSessionStepId = 'field' | 'kills' | 'bag' | 'meditate' | 'breakthrough';
export const FIRST_SESSION_STEPS: readonly FirstSessionStepId[] = ['field', 'kills', 'bag', 'meditate', 'breakthrough'];

/** What the tracker reads each frame (all derived from server state; see the file comment). */
export interface FirstSessionInputs {
  /** Chebyshev distance of the player from the map centre, in tiles */
  fromCentre: number;
  bagOpen: boolean;
  /** the first `inv_state` has arrived */
  bagReady: boolean;
  /** the bag holds an item or the wallet holds stones */
  hasLoot: boolean;
  /** entries waiting to be claimed */
  pending: number;
  meditating: boolean;
  /** tu vi / requirement, 0..1 (0 before the first `char_state`) */
  tuViFraction: number;
}

export interface FirstSessionStepView {
  id: FirstSessionStepId;
  text: string;
  state: 'done' | 'current' | 'todo';
  /** a short hint for the current step (empty otherwise) */
  hint: string;
}
export interface FirstSessionView {
  /** every step is done */
  done: boolean;
  /** number of completed steps */
  completed: number;
  steps: FirstSessionStepView[];
}

/** What is remembered between sessions (a plain object so any storage can hold it as JSON). */
export interface FirstSessionSnapshot {
  done: FirstSessionStepId[];
  kills: number;
}

export interface FirstSessionOptions {
  mapTiles: number;
  restore?: FirstSessionSnapshot | null;
  /** called after progress changed (kill counted or a step completed) */
  onChange?: (s: FirstSessionSnapshot) => void;
}

export const FIRST_SESSION_TEXT: Readonly<Record<FirstSessionStepId, string>> = {
  field: 'Rời điểm xuất phát, tiến vào khu săn yêu thú',
  kills: 'Hạ yêu thú bằng kỹ năng của mình',
  bag: 'Mở túi đồ [B] và xem chiến lợi phẩm',
  meditate: 'Đả tọa [M] để tăng tu vi',
  breakthrough: 'Đột phá tiểu cảnh [N] khi tu vi đầy',
};

/** Parse a stored snapshot defensively (anything unexpected gives null = start fresh). */
export function parseFirstSessionSnapshot(raw: string | null | undefined): FirstSessionSnapshot | null {
  if (!raw) return null;
  try {
    const v = JSON.parse(raw) as { done?: unknown; kills?: unknown };
    if (!Array.isArray(v.done)) return null;
    const done = v.done.filter((x): x is FirstSessionStepId => FIRST_SESSION_STEPS.includes(x as FirstSessionStepId));
    const kills = typeof v.kills === 'number' && Number.isFinite(v.kills) ? Math.max(0, Math.trunc(v.kills)) : 0;
    return { done, kills };
  } catch {
    return null;
  }
}

export class FirstSessionTracker {
  private readonly done = new Set<FirstSessionStepId>();
  private killCount = 0;
  private breakthroughAttempted = false;
  private readonly fieldAt: number;
  private last: FirstSessionInputs | null = null;

  constructor(private readonly o: FirstSessionOptions) {
    this.fieldAt = fieldBandStart(o.mapTiles) + FIRST_SESSION.fieldMarginTiles;
    // restore only a consistent prefix (steps complete in order)
    for (const id of FIRST_SESSION_STEPS) {
      if (!o.restore?.done.includes(id)) break;
      this.done.add(id);
    }
    this.killCount = Math.min(FIRST_SESSION.killTarget, Math.max(0, o.restore?.kills ?? 0));
    if (this.done.has('kills')) this.killCount = FIRST_SESSION.killTarget;
    if (this.done.has('breakthrough')) this.breakthroughAttempted = true;
  }

  /** Index of the first step that is not done (the number of steps when all are). */
  get current(): number {
    let k = 0;
    while (k < FIRST_SESSION_STEPS.length && this.done.has(FIRST_SESSION_STEPS[k]!)) k++;
    return k;
  }
  get kills(): number {
    return this.killCount;
  }
  /** Distance from the map centre (tiles) at which the field objective is reached. */
  get fieldDistance(): number {
    return this.fieldAt;
  }
  get finished(): boolean {
    return this.current >= FIRST_SESSION_STEPS.length;
  }

  /** The player killed a monster with their own skill (`skill_result` KILL flag). */
  onKill(): void {
    if (this.killCount >= FIRST_SESSION.killTarget) return;
    this.killCount++;
    this.advance();
    this.changed();
  }

  /** A breakthrough answer: an attempt counts when the server rolled it (success or failure), not when it refused. */
  onBreakthroughResult(outcome: number): void {
    if (outcome !== BreakthroughOutcome.Success && outcome !== BreakthroughOutcome.Failure) return;
    this.breakthroughAttempted = true;
    this.advance();
    this.changed();
  }

  /** Feed the current state; completes as many steps as the state allows. Call every frame (cheap). */
  update(i: FirstSessionInputs): void {
    this.last = i;
    if (this.advance()) this.changed();
  }

  private met(id: FirstSessionStepId): boolean {
    const i = this.last;
    switch (id) {
      case 'kills':
        return this.killCount >= FIRST_SESSION.killTarget;
      case 'breakthrough':
        return this.breakthroughAttempted;
      case 'field':
        return !!i && i.fromCentre >= this.fieldAt;
      case 'bag':
        return !!i && i.bagOpen && i.bagReady && i.hasLoot && i.pending === 0;
      case 'meditate':
        return !!i && i.meditating;
    }
  }

  /** Complete steps in order while their condition holds. Kills and the breakthrough answer are events: they count before any `update`. */
  private advance(): boolean {
    let moved = false;
    for (let k = this.current; k < FIRST_SESSION_STEPS.length; k++) {
      const id = FIRST_SESSION_STEPS[k]!;
      if (!this.met(id)) break;
      this.done.add(id);
      moved = true;
    }
    return moved;
  }

  private changed(): void {
    this.o.onChange?.(this.snapshot());
  }

  snapshot(): FirstSessionSnapshot {
    return { done: FIRST_SESSION_STEPS.filter((s) => this.done.has(s)), kills: this.killCount };
  }

  /** What the widget draws now. */
  view(): FirstSessionView {
    const cur = this.current;
    const steps = FIRST_SESSION_STEPS.map((id, k): FirstSessionStepView => {
      const state = k < cur ? 'done' : k === cur ? 'current' : 'todo';
      let text = FIRST_SESSION_TEXT[id];
      if (id === 'kills')
        text = `${text} (${Math.min(this.killCount, FIRST_SESSION.killTarget)}/${FIRST_SESSION.killTarget})`;
      return { id, text, state, hint: state === 'current' ? this.hint(id) : '' };
    });
    return { done: cur >= FIRST_SESSION_STEPS.length, completed: cur, steps };
  }

  private hint(id: FirstSessionStepId): string {
    const i = this.last;
    if (!i) return '';
    switch (id) {
      case 'field': {
        const d = Math.max(0, Math.ceil(this.fieldAt - i.fromCentre));
        return d > 0 ? `còn khoảng ${d} ô` : '';
      }
      case 'kills':
        return 'Tab chọn mục tiêu, phím 1-8 dùng kỹ năng';
      case 'bag':
        if (!i.bagOpen) return 'nhấn B';
        if (i.pending > 0) return 'bấm "Claim loot" để nhận hàng chờ';
        return i.hasLoot ? '' : 'chưa có gì: hạ thêm yêu thú';
      case 'meditate':
        return 'đứng yên rồi nhấn M';
      case 'breakthrough':
        return i.tuViFraction >= 1 ? 'tu vi đầy: nhấn N' : `tu vi ${Math.floor(i.tuViFraction * 100)}%: tiếp tục đả tọa`;
    }
  }
}
