/**
 * Sect model (D98): what the client knows about Sơn Môn Đại Phái, fed by the server's `sect_state` / `sect_result`. Engine-free and
 * DOM-free: the Cocos sect panel only renders `view()`. The server stays authoritative (membership, Cống hiến, prices, the NPC range, every
 * refusal); this keeps no rules of its own beyond "can I probably afford it" hints and the texts of the string table.
 *
 * Cống hiến is an in-game currency (docs/26 `CONG_HIEN`): there is nothing about money, shops or receipts here.
 */
import { SECT } from '@vgtd/shared';
import { SectReason, type SectManualEntry, type SectResultMsg, type SectStateMsg } from '@vgtd/protocol';
import { reasonTexts, t } from '../i18n/strings.js';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { SectOp } from '@vgtd/protocol';

/** Text of every sect refusal (user-facing, from the string table; `{sect}` = the sect name, `{range}` = the NPC range). */
export const SECT_REASON_TEXT: Readonly<Record<number, string>> = reasonTexts(
  {
    [SectReason.Ok]: null,
    [SectReason.RateLimited]: 'sect.reason.rate_limited',
    [SectReason.NotReady]: 'sect.reason.not_ready',
    [SectReason.TooFar]: 'sect.reason.too_far',
    [SectReason.AlreadyMember]: 'sect.reason.already_member',
    [SectReason.NotMember]: 'sect.reason.not_member',
    [SectReason.NoSuchManual]: 'sect.reason.no_such_manual',
    [SectReason.AlreadyOwned]: 'sect.reason.already_owned',
    [SectReason.NotEnoughContribution]: 'sect.reason.no_contribution',
  },
  () => ({ sect: SECT.NAME, range: SECT.NPC_RANGE_TILES }),
);

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
    if (!before) return m.member ? t('sect.line.is_member', { sect: SECT.NAME }) : null;
    if (m.member && !before.member) return t('sect.line.joined', { sect: SECT.NAME });
    if (!m.member && before.member) return t('sect.line.left', { sect: SECT.NAME });
    const gained = m.library.find((e, i) => e.owned && !before.library[i]?.owned);
    if (gained) return t('sect.line.learned', { name: gained.name });
    return null;
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: SectResultMsg): string | null {
    if (m.reason === SectReason.Ok) return null;
    return SECT_REASON_TEXT[m.reason] ?? t('sect.line.refused', { code: m.reason });
  }

  /** The state as plain lines (for `/sect` in the chat log). */
  summaryLines(): string[] {
    const v = this.view();
    if (!v.ready) return [t('sect.summary.loading')];
    const lines = [
      t('sect.summary.head', {
        sect: SECT.NAME,
        status: t(v.member ? 'sect.summary.member' : 'sect.summary.not_member'),
        contribution: v.contribution,
      }),
    ];
    if (!v.member) lines.push(t('sect.summary.join_hint'));
    else
      for (const m of v.library)
        lines.push(
          t('sect.summary.manual', {
            n: m.index + 1,
            name: m.name,
            level: m.levelMin,
            price: m.price,
            state: m.owned ? t('sect.summary.owned') : m.canBuy ? t('sect.summary.buy_hint', { n: m.index + 1 }) : '',
          }).trimEnd(),
        );
    return lines;
  }
}
