/**
 * Progression HUD model (D76 wire): turns the server's `char_state`, `meditate_result` and `breakthrough_result` into what a
 * HUD draws, and decides which commands the player may send. Engine-free; the server stays authoritative: the view never
 * predicts tu vi or outcomes, it only mirrors the last server state and guards against double-sending (one command in
 * flight per kind, answered by its `requestId`).
 */
import {
  BreakthroughKind,
  BreakthroughOutcome,
  CHAR_FLAG,
  ProgressionReason,
  type BreakthroughResultMsg,
  type CharStateMsg,
  type MeditateResultMsg,
} from '@vgtd/protocol';
import { stageLabel, stageToRealm } from '@vgtd/shared';

/** Vietnamese texts of every refusal reason (user-facing). */
export const PROGRESSION_REASON_TEXT: Readonly<Record<number, string>> = {
  [ProgressionReason.Ok]: '',
  [ProgressionReason.NotReady]: 'Hồ sơ nhân vật đang tải…',
  [ProgressionReason.Moving]: 'Đang di chuyển: hãy đứng yên để đả tọa.',
  [ProgressionReason.InCombat]: 'Đang giao chiến: chưa thể đả tọa.',
  [ProgressionReason.Dead]: 'Nhân vật đã tử vong.',
  [ProgressionReason.RateLimited]: 'Thao tác quá nhanh, hãy thử lại sau giây lát.',
  [ProgressionReason.NotEnoughTuVi]: 'Tu vi chưa đủ để đột phá.',
  [ProgressionReason.AtMaxStage]: 'Đã đạt cảnh giới cao nhất.',
  [ProgressionReason.Cooldown]: 'Vừa đột phá xong, hãy chờ giây lát.',
  [ProgressionReason.TribulationRequired]: 'Đột phá đại cảnh cần Tâm Ma và Lôi Kiếp, chưa mở ở bản này.',
  [ProgressionReason.EventActive]: 'Tâm Ma / Lôi Kiếp đang diễn ra.',
  [ProgressionReason.NotPrepared]: 'Cần gần đầy Khí Huyết để bước vào đại cảnh.',
  [ProgressionReason.Locked]: 'Đột phá đại cảnh đang bị khóa (sau thất bại).',
};

export interface ProgressionSnapshot {
  /** flat stage 1..41 */
  readonly stage: number;
  /** e.g. "Luyện Khí tầng 3" */
  readonly label: string;
  readonly realm: number;
  readonly subRealm: number;
  readonly tuVi: number;
  readonly tuViReq: number;
  /** tuVi / tuViReq clamped to 0..1 */
  readonly fraction: number;
  readonly meditating: boolean;
  /** tu vi is full: a breakthrough can be attempted */
  readonly ready: boolean;
  readonly maxStage: boolean;
  /** consecutive failed major attempts (pity counter) */
  readonly nFail: number;
  readonly karma: number;
  readonly rootType: number;
  readonly elements: number;
  readonly mutation: number;
}

export interface Toast {
  readonly text: string;
  readonly tone: 'good' | 'bad' | 'info';
  readonly untilMs: number;
}

export type ProgressionCommand =
  | { type: 'meditate_start'; requestId: string }
  | { type: 'meditate_stop'; requestId: string }
  | { type: 'breakthrough_start'; requestId: string };
/** Transport: returns false when the socket is not open. */
export type SendProgression = (m: ProgressionCommand) => boolean;

export interface ProgressionViewOptions {
  now: () => number;
  /** 32 lowercase hex characters (a UUID without dashes); injected so tests are deterministic */
  newRequestId: () => string;
  toastMs?: number;
  /** a command with no answer after this long may be sent again (lost reply) */
  pendingTimeoutMs?: number;
}

/** 32 hex characters from any uniform [0,1) source. */
export function requestIdFrom(rng: () => number): string {
  let out = '';
  for (let k = 0; k < 32; k++) out += Math.floor(rng() * 16).toString(16);
  return out;
}

export class ProgressionView {
  state: ProgressionSnapshot | null = null;
  private toast: Toast | null = null;
  private meditatePending: { id: string; at: number } | null = null;
  private breakthroughPending: { id: string; at: number } | null = null;
  private readonly toastMs: number;
  private readonly pendingMs: number;

  constructor(private readonly o: ProgressionViewOptions) {
    this.toastMs = o.toastMs ?? 4000;
    this.pendingMs = o.pendingTimeoutMs ?? 5000;
  }

  // ---------------------------------------------------------------- server -> view
  applyCharState(m: CharStateMsg): void {
    const { realm, subStage } = stageToRealm(m.stage);
    this.state = {
      stage: m.stage,
      label: stageLabel(m.stage),
      realm,
      subRealm: subStage,
      tuVi: m.tuVi,
      tuViReq: m.tuViReq,
      fraction: m.tuViReq > 0 ? Math.min(1, Math.max(0, m.tuVi / m.tuViReq)) : 0,
      meditating: (m.flags & CHAR_FLAG.MEDITATING) !== 0,
      ready: (m.flags & CHAR_FLAG.BREAKTHROUGH_READY) !== 0,
      maxStage: (m.flags & CHAR_FLAG.MAX_STAGE) !== 0,
      nFail: m.nFail,
      karma: m.karma,
      rootType: m.rootType,
      elements: m.elements,
      mutation: m.mutation,
    };
  }

  applyMeditateResult(m: MeditateResultMsg): void {
    if (this.meditatePending?.id === m.requestId) this.meditatePending = null;
    if (m.reason !== ProgressionReason.Ok) this.say(reasonText(m.reason), 'info');
  }

  applyBreakthroughResult(m: BreakthroughResultMsg): void {
    if (this.breakthroughPending?.id === m.requestId) this.breakthroughPending = null;
    if (m.outcome === BreakthroughOutcome.Rejected) return this.say(reasonText(m.reason), 'bad');
    const kind = m.kind === BreakthroughKind.Major ? 'đại cảnh' : 'tiểu cảnh';
    const pct = `${(m.chance / 100).toFixed(m.chance % 100 === 0 ? 0 : 1)}%`;
    if (m.outcome === BreakthroughOutcome.Success)
      this.say(`Đột phá ${kind} thành công: ${stageLabel(m.toStage)} (tỉ lệ ${pct}).`, 'good');
    else if (m.kind === BreakthroughKind.Major) this.say(`Đột phá ${kind} thất bại (tỉ lệ ${pct}).`, 'bad');
    else this.say(`Đột phá ${kind} thất bại (tỉ lệ ${pct}). Tu vi được giữ nguyên, hãy thử lại.`, 'bad');
  }

  // ---------------------------------------------------------------- queries
  /** Toast to draw now (null once expired). */
  currentToast(): Toast | null {
    if (this.toast && this.o.now() >= this.toast.untilMs) this.toast = null;
    return this.toast;
  }
  private pendingOf(p: { id: string; at: number } | null): boolean {
    return p !== null && this.o.now() - p.at < this.pendingMs;
  }
  meditateBusy(): boolean {
    return this.pendingOf(this.meditatePending);
  }
  breakthroughBusy(): boolean {
    return this.pendingOf(this.breakthroughPending);
  }
  /** Meditate button: stopping is always possible; starting needs a loaded, living, non-full, non-final character. */
  canMeditate(): boolean {
    const s = this.state;
    if (!s || this.meditateBusy()) return false;
    return s.meditating || (!s.ready && !s.maxStage);
  }
  canBreakthrough(): boolean {
    const s = this.state;
    return !!s && s.ready && !s.maxStage && !this.breakthroughBusy();
  }
  /** One-line status for a HUD label. */
  statusLine(): string {
    const s = this.state;
    if (!s) return 'Tu luyện: đang tải…';
    const bar = `${Math.floor(s.tuVi)}/${Math.floor(s.tuViReq)}`;
    if (s.maxStage) return `${s.label} · cảnh giới cao nhất`;
    if (s.meditating) return `${s.label} · đang đả tọa ${bar}`;
    if (s.ready) return `${s.label} · tu vi đầy, có thể đột phá`;
    return `${s.label} · ${bar}`;
  }

  // ---------------------------------------------------------------- player -> server
  /** Start or stop meditation depending on the last server state. Returns false when nothing was sent. */
  toggleMeditate(send: SendProgression): boolean {
    if (!this.canMeditate()) return false;
    const id = this.o.newRequestId();
    const ok = send({ type: this.state!.meditating ? 'meditate_stop' : 'meditate_start', requestId: id });
    if (!ok) {
      this.say('Chưa kết nối máy chủ.', 'info');
      return false;
    }
    this.meditatePending = { id, at: this.o.now() };
    return true;
  }

  attemptBreakthrough(send: SendProgression): boolean {
    if (!this.canBreakthrough()) return false;
    const id = this.o.newRequestId();
    if (!send({ type: 'breakthrough_start', requestId: id })) {
      this.say('Chưa kết nối máy chủ.', 'info');
      return false;
    }
    this.breakthroughPending = { id, at: this.o.now() };
    return true;
  }

  private say(text: string, tone: Toast['tone']): void {
    if (text) this.toast = { text, tone, untilMs: this.o.now() + this.toastMs };
  }
}

export function reasonText(reason: number): string {
  return PROGRESSION_REASON_TEXT[reason] ?? `Bị từ chối (mã ${reason}).`;
}
