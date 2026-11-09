/**
 * Tutorial model (D105, docs/16): what the client shows of the SERVER's first-session tracker. It is fed by `tutorial_state` only (the
 * server decides every step; the client never reports progress except "skip") and turns it into one non-blocking hint card: the
 * current step, a short contextual hint that depends on the input mode (docs/16 §2: the same lesson with PC or touch wording), a
 * progress count, and the optional tips once the required steps are done. Engine-free and DOM-free; the Cocos `TutorialHints`
 * only draws `view()`. Vietnamese texts are the first editorial pass (OPEN-ITEMS 22).
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

export type TutorialInputMode = 'pointer' | 'touch';

export interface TutorialStepText {
  /** one line, what to do */
  title: string;
  /** how, per input mode */
  hint: Record<TutorialInputMode, string>;
}

export const TUTORIAL_TEXT: Readonly<Record<TutorialStepId, TutorialStepText>> = {
  move: {
    title: 'Di chuyển',
    hint: {
      pointer: 'Bấm chuột trái xuống đất hoặc dùng WASD để đi.',
      touch: 'Chạm giữ bên trái màn hình rồi kéo để đi.',
    },
  },
  field: {
    title: 'Ra khu săn yêu thú',
    hint: {
      pointer: 'Đi ra xa điểm xuất phát, tới vùng có yêu thú.',
      touch: 'Kéo cần điều khiển đi ra xa điểm xuất phát, tới vùng có yêu thú.',
    },
  },
  skill: {
    title: 'Dùng kỹ năng',
    hint: {
      pointer: 'Đứng gần yêu thú rồi bấm phím 1-8 để dùng kỹ năng.',
      touch: 'Đứng gần yêu thú rồi chạm nút kỹ năng ở góc phải.',
    },
  },
  kills: {
    title: `Hạ ${TUTORIAL.killTarget} yêu thú`,
    hint: {
      pointer: 'Tab chọn mục tiêu, phím 1-8 dùng kỹ năng.',
      touch: 'Chạm nhanh để nhắm mục tiêu gần nhất, giữ và kéo để nhắm hướng.',
    },
  },
  loot: {
    title: 'Nhặt chiến lợi phẩm',
    hint: {
      pointer: 'Yêu thú rơi đồ vào túi: nhấn B để xem.',
      touch: 'Yêu thú rơi đồ vào túi: mở túi để xem.',
    },
  },
  meditate: {
    title: 'Đả tọa tăng tu vi',
    hint: {
      pointer: 'Đứng yên, nhấn M để đả tọa.',
      touch: 'Đứng yên, chạm nút Đả tọa trên bảng tu luyện.',
    },
  },
  breakthrough: {
    title: 'Đột phá tiểu cảnh',
    hint: {
      pointer: 'Khi thanh tu vi đầy, nhấn N để đột phá.',
      touch: 'Khi thanh tu vi đầy, chạm nút Đột phá trên bảng tu luyện.',
    },
  },
  item: {
    title: 'Dùng một món đồ',
    hint: {
      pointer: 'Mở túi (B), chuột phải vào đan dược để dùng.',
      touch: 'Mở túi, chạm đan dược rồi chạm Dùng.',
    },
  },
  chat: {
    title: 'Trò chuyện',
    hint: {
      pointer: 'Nhấn Enter để chat với mọi người, /help xem lệnh.',
      touch: 'Chạm dải chat bên trái để gõ, /help xem lệnh.',
    },
  },
  party: {
    title: 'Lập tổ đội',
    hint: {
      pointer: 'Gõ /invite tên để mời bạn cùng đi.',
      touch: 'Chạm dải chat rồi gõ /invite tên để mời bạn cùng đi.',
    },
  },
};

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
    const steps = TUTORIAL_STEPS.map(
      (id, k): TutorialStepView => ({
        id,
        title: TUTORIAL_TEXT[id].title,
        done: this.isDone(id),
        required: k < TUTORIAL_REQUIRED_COUNT,
      }),
    );
    const completed = steps.filter((s) => s.required && s.done).length;
    // the first unfinished REQUIRED step; once those are done, the first unfinished tip
    const current = steps.find((s) => s.required && !s.done) ?? steps.find((s) => !s.done) ?? null;
    const isTip = !!current && !current.required;
    const progress = current?.id === 'kills' ? `${Math.min(this.killCount, TUTORIAL.killTarget)}/${TUTORIAL.killTarget}` : '';
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
