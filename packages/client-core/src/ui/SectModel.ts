/**
 * Sect model (D98): what the client knows about Sơn Môn Đại Phái, fed by the server's `sect_state` / `sect_result`. Engine-free and
 * DOM-free: the Cocos sect panel only renders `view()`. The server stays authoritative (membership, Cống hiến, prices, the NPC range, every
 * refusal); this keeps no rules of its own beyond "can I probably afford it" hints and Vietnamese texts.
 *
 * Cống hiến is an in-game currency (docs/26 `CONG_HIEN`): there is nothing about money, shops or receipts here.
 */
import { SECT } from '@vgtd/shared';
import { SectReason, type SectManualEntry, type SectResultMsg, type SectStateMsg } from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { SectOp } from '@vgtd/protocol';

/** Vietnamese text of every sect refusal (user-facing). */
export const SECT_REASON_TEXT: Readonly<Record<number, string>> = {
  [SectReason.Ok]: '',
  [SectReason.RateLimited]: 'Bạn thao tác quá nhanh, hãy chờ giây lát.',
  [SectReason.NotReady]: 'Chưa vào game, chưa thao tác được.',
  [SectReason.TooFar]: `Hãy đến gần NPC của ${SECT.NAME} (trong ${SECT.NPC_RANGE_TILES} ô).`,
  [SectReason.AlreadyMember]: `Bạn đã là đệ tử ${SECT.NAME}.`,
  [SectReason.NotMember]: `Bạn chưa gia nhập ${SECT.NAME}.`,
  [SectReason.NoSuchManual]: 'Không có bí tịch này trong Tàng Kinh Các của Đạo Lộ bạn.',
  [SectReason.AlreadyOwned]: 'Bạn đã có bí tịch này.',
  [SectReason.NotEnoughContribution]: 'Không đủ Cống hiến.',
};

/** What the panel needs to draw, in one object. */
export interface SectView {
  /** false until the server has sent the first state */
  ready: boolean;
  member: boolean;
  contribution: number;
  library: SectManualRow[];
  /** where the NPC stands in tile space (null until known) */
  npc: { i: number; j: number } | null;
}
export interface SectManualRow extends SectManualEntry {
  index: number;
  /** a hint only (the server decides): a member with enough Cống hiến and not owned yet */
  canBuy: boolean;
}

export class SectModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private state: SectStateMsg | null = null;

  get ready(): boolean {
    return this.state !== null;
  }
  get member(): boolean {
    return this.state?.member ?? false;
  }
  get contribution(): number {
    return this.state?.contribution ?? 0;
  }

  view(): SectView {
    const s = this.state;
    if (!s) return { ready: false, member: false, contribution: 0, library: [], npc: null };
    return {
      ready: true,
      member: s.member,
      contribution: s.contribution,
      npc: { i: s.npcQi / 32, j: s.npcQj / 32 },
      library: s.library.map((m, index) => ({
        ...m,
        index,
        canBuy: s.member && !m.owned && s.contribution >= m.price,
      })),
    };
  }

  /** Is a point (tile space) within the range in which the server accepts sect commands? A hint for the panel. */
  nearNpc(at: { i: number; j: number } | null): boolean {
    const n = this.view().npc;
    return !!at && !!n && Math.hypot(at.i - n.i, at.j - n.j) <= SECT.NPC_RANGE_TILES;
  }

  /**
   * The picture changed. Returns a system line for what is worth announcing (joined / left, a bought manual, Cống hiến earned is NOT
   * announced: it would spam the log, the panel shows the balance), or null.
   */
  applyState(m: SectStateMsg): string | null {
    const before = this.state;
    this.state = { ...m, library: m.library.map((e) => ({ ...e })) };
    this.version++;
    if (!before) return m.member ? `Bạn là đệ tử ${SECT.NAME}.` : null;
    if (m.member && !before.member) return `Bạn đã gia nhập ${SECT.NAME}.`;
    if (!m.member && before.member) return `Bạn đã rời ${SECT.NAME}.`;
    const gained = m.library.find((e, i) => e.owned && !before.library[i]?.owned);
    if (gained) return `Bạn đã học bí tịch ${gained.name}.`;
    return null;
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: SectResultMsg): string | null {
    if (m.reason === SectReason.Ok) return null;
    return SECT_REASON_TEXT[m.reason] ?? `Thao tác bị từ chối (mã ${m.reason}).`;
  }

  /** The state as plain lines (for `/sect` in the chat log). */
  summaryLines(): string[] {
    const v = this.view();
    if (!v.ready) return ['Tông môn chưa tải xong.'];
    const lines = [`${SECT.NAME}: ${v.member ? 'đệ tử' : 'chưa gia nhập'} · Cống hiến ${v.contribution}`];
    if (!v.member) lines.push('Đến gần NPC rồi gõ /sect join để gia nhập.');
    else
      for (const m of v.library)
        lines.push(`  ${m.index + 1}. ${m.name} (cấp ${m.levelMin}) · ${m.price} CH ${m.owned ? '· đã có' : m.canBuy ? '· /sect buy ' + (m.index + 1) : ''}`.trimEnd());
    return lines;
  }
}
