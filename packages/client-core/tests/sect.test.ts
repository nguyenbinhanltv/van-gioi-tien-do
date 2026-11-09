import { describe, expect, it } from 'vitest';
import { SECT } from '@vgtd/shared';
import { SectOp, SectReason, type SectStateMsg } from '@vgtd/protocol';
import { ChatLog, SECT_REASON_TEXT, SectModel, parseChatInput } from '../src/index.js';

const lib = (owned: boolean[] = [false, false]) => [
  { name: 'Kim Quang Quet', levelMin: 20, price: 60, owned: owned[0]! },
  { name: 'Thiem Kiem Bo', levelMin: 31, price: 93, owned: owned[1]! },
];
const state = (o: Partial<SectStateMsg> = {}): SectStateMsg => ({
  type: 'sect_state',
  member: false,
  contribution: 0,
  npcQi: 50 * 32,
  npcQj: 50 * 32,
  library: lib(),
  ...o,
});

describe('sect commands in the chat input', () => {
  it('/sect shows, join / leave have no arguments, buy takes the 1-based manual number', () => {
    expect(parseChatInput('/sect')).toEqual({ kind: 'sects' });
    expect(parseChatInput('/tm')).toEqual({ kind: 'sects' });
    expect(parseChatInput('/sect join')).toEqual({ kind: 'sect', op: SectOp.Join, manual: 0 });
    expect(parseChatInput('/sect leave')).toEqual({ kind: 'sect', op: SectOp.Leave, manual: 0 });
    expect(parseChatInput('/sect buy 1')).toEqual({ kind: 'sect', op: SectOp.Buy, manual: 0 });
    expect(parseChatInput('/sect buy 5')).toEqual({ kind: 'sect', op: SectOp.Buy, manual: 4 });
    expect(parseChatInput('/sect mua 3')).toEqual({ kind: 'sect', op: SectOp.Buy, manual: 2 });
    expect(parseChatInput('/sect buy')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/sect buy 0')).toMatchObject({ kind: 'error' });
    expect(parseChatInput(`/sect buy ${SECT.MAX_MANUALS + 1}`)).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/sect buy x')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/sect nonsense')).toMatchObject({ kind: 'error' });
  });

  it('ChatLog.submit sends a sect command with a client id, says so when the socket is closed, and /sect calls the panel hook', () => {
    let shown = 0;
    const l = new ChatLog({ myName: () => 'me', onSect: () => shown++ });
    const got: unknown[] = [];
    const never = () => false;
    expect(l.submit('/sect buy 2', never, never, (m) => (got.push(m), true))).toBe(true);
    expect(got).toEqual([{ op: SectOp.Buy, manual: 1, clientMsgId: expect.any(Number) }]);
    expect(l.submit('/sect join', never, never, () => false)).toBe(false);
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error', text: 'Chưa kết nối máy chủ.' });
    expect(l.submit('/sect join', never)).toBe(false); // no sect sender wired
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error' });
    expect(l.submit('/sect', never, never, () => true)).toBe(false);
    expect(shown).toBe(1);
  });
});

describe('SectModel', () => {
  it('is not ready before the first state; then exposes membership, balance, library rows and the NPC position', () => {
    const m = new SectModel();
    expect(m.ready).toBe(false);
    expect(m.view()).toMatchObject({ ready: false, member: false, library: [], npc: null });
    m.applyState(state({ member: true, contribution: 70 }));
    const v = m.view();
    expect(v).toMatchObject({ ready: true, member: true, contribution: 70, npc: { i: 50, j: 50 } });
    expect(v.library.map((r) => [r.index, r.name, r.price, r.canBuy])).toEqual([
      [0, 'Kim Quang Quet', 60, true],
      [1, 'Thiem Kiem Bo', 93, false],
    ]);
  });

  it('canBuy is only a hint: members, enough Cống hiến, not owned yet', () => {
    const m = new SectModel();
    m.applyState(state({ member: false, contribution: 500 }));
    expect(m.view().library.some((r) => r.canBuy)).toBe(false); // not a member
    m.applyState(state({ member: true, contribution: 500, library: lib([true, false]) }));
    expect(m.view().library.map((r) => r.canBuy)).toEqual([false, true]);
  });

  it('nearNpc mirrors the server range as a hint (never authoritative)', () => {
    const m = new SectModel();
    expect(m.nearNpc({ i: 50, j: 50 })).toBe(false); // NPC position unknown yet
    m.applyState(state());
    expect(m.nearNpc({ i: 50 + SECT.NPC_RANGE_TILES - 1, j: 50 })).toBe(true);
    expect(m.nearNpc({ i: 50 + SECT.NPC_RANGE_TILES + 1, j: 50 })).toBe(false);
    expect(m.nearNpc(null)).toBe(false);
  });

  it('announces joining, leaving and a learned manual; not balance changes', () => {
    const m = new SectModel();
    expect(m.applyState(state())).toBeNull();
    expect(m.applyState(state({ member: true }))).toMatch(/đã gia nhập/);
    expect(m.applyState(state({ member: true, contribution: 5 }))).toBeNull(); // Cống hiến from a kill: silent
    expect(m.applyState(state({ member: true, contribution: 5, library: lib([true, false]) }))).toMatch(/đã học bí tịch Kim Quang Quet/);
    expect(m.applyState(state({ member: false, contribution: 5, library: lib([true, false]) }))).toMatch(/đã rời/);
    const first = new SectModel();
    expect(first.applyState(state({ member: true }))).toMatch(/là đệ tử/);
  });

  it('answers every refusal in Vietnamese, and bumps the version per state', () => {
    const m = new SectModel();
    const v0 = m.version;
    m.applyState(state());
    expect(m.version).toBeGreaterThan(v0);
    expect(m.applyResult({ type: 'sect_result', clientMsgId: 1, reason: SectReason.Ok })).toBeNull();
    for (const reason of Object.values(SectReason).filter((v): v is number => typeof v === 'number')) {
      if (reason === SectReason.Ok) continue;
      expect(SECT_REASON_TEXT[reason], `reason ${reason}`).toBeTruthy();
      expect(m.applyResult({ type: 'sect_result', clientMsgId: 1, reason })).toBe(SECT_REASON_TEXT[reason]);
    }
    expect(m.applyResult({ type: 'sect_result', clientMsgId: 1, reason: 200 })).toMatch(/mã 200/);
  });

  it('summary lines for /sect: not a member, then the numbered library with prices and what can be bought', () => {
    const m = new SectModel();
    expect(m.summaryLines()).toEqual(['Tông môn chưa tải xong.']);
    m.applyState(state());
    expect(m.summaryLines().join('\n')).toMatch(/chưa gia nhập/);
    m.applyState(state({ member: true, contribution: 70, library: lib([false, false]) }));
    const text = m.summaryLines().join('\n');
    expect(text).toMatch(/Cống hiến 70/);
    expect(text).toMatch(/1\. Kim Quang Quet \(cấp 20\) · 60 CH · \/sect buy 1/);
    expect(text).toMatch(/2\. Thiem Kiem Bo \(cấp 31\) · 93 CH/);
    expect(text).not.toMatch(/\/sect buy 2/); // cannot afford it
  });
});
