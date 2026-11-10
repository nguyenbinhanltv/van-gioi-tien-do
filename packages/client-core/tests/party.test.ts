import { describe, expect, it } from 'vitest';
import { ChatChannel, PartyOp, PartyReason } from '@vgtd/protocol';
import { ChatLog, partyReasonText, PartyModel, parseChatInput } from '../src/index.js';

describe('party commands in the chat input', () => {
  it('/p talks on the Party channel', () => {
    expect(parseChatInput('/p pull left')).toEqual({
      kind: 'send',
      channel: ChatChannel.Party,
      target: '',
      text: 'pull left',
    });
    expect(parseChatInput('/party hi')).toMatchObject({ channel: ChatChannel.Party });
    expect(parseChatInput('/p')).toMatchObject({ kind: 'error' });
  });
  it('invite / kick need one name; accept / decline take an optional one; leave takes none', () => {
    expect(parseChatInput('/invite bob')).toEqual({ kind: 'party', op: PartyOp.Invite, name: 'bob' });
    expect(parseChatInput('/inv  bob extra')).toEqual({ kind: 'party', op: PartyOp.Invite, name: 'bob' });
    expect(parseChatInput('/kick bob')).toEqual({ kind: 'party', op: PartyOp.Kick, name: 'bob' });
    expect(parseChatInput('/invite')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/kick')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/accept')).toEqual({ kind: 'party', op: PartyOp.Accept, name: '' });
    expect(parseChatInput('/accept alice')).toEqual({ kind: 'party', op: PartyOp.Accept, name: 'alice' });
    expect(parseChatInput('/decline alice')).toEqual({ kind: 'party', op: PartyOp.Decline, name: 'alice' });
    expect(parseChatInput('/leave')).toEqual({ kind: 'party', op: PartyOp.Leave, name: '' });
    expect(parseChatInput('/invite ' + 'a'.repeat(25))).toMatchObject({ kind: 'error' });
  });
  it('ChatLog.submit sends a party command with a client id, and says so when the socket is closed', () => {
    const l = new ChatLog({ myName: () => 'me' });
    const got: unknown[] = [];
    const sent = l.submit(
      '/invite bob',
      () => true,
      (m) => {
        got.push(m);
        return true;
      },
    );
    expect(sent).toBe(true);
    expect(got).toEqual([{ op: PartyOp.Invite, name: 'bob', clientMsgId: 1 }]);
    expect(
      l.submit(
        '/leave',
        () => true,
        () => false,
      ),
    ).toBe(false);
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error', text: 'Chưa kết nối máy chủ.' });
    expect(l.submit('/leave', () => true)).toBe(false); // no party sender wired
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error' });
  });
  it('Party chat lines are tagged [Đội] with the party tone', () => {
    const l = new ChatLog({ myName: () => 'me' });
    const e = l.applyMsg({
      type: 'chat_msg',
      channel: ChatChannel.Party,
      senderId: 2,
      senderName: 'bob',
      toName: '',
      ts: 0,
      text: 'go',
    });
    expect(e).toMatchObject({ tone: 'party', text: '[Đội] bob: go' });
  });
});

describe('PartyModel', () => {
  const mk = () => {
    let now = 0;
    const me = 5;
    const m = new PartyModel({ myId: () => me, now: () => now });
    return { m, tick: (ms: number) => (now += ms) };
  };
  const roster = (...ids: number[]) => ids.map((id) => ({ entityId: id, name: `p${id}`, classId: 1 + (id % 6) }));

  it('starts outside a party; a roster puts members in order with leader and me flagged', () => {
    const { m } = mk();
    expect(m.inParty).toBe(false);
    expect(m.members()).toEqual([]);
    const line = m.applyState({ type: 'party_state', leaderId: 3, members: roster(3, 5) });
    expect(line).toBe('Bạn đã vào tổ đội của p3 (2/4).');
    expect(m.inParty).toBe(true);
    expect(m.amLeader).toBe(false);
    expect(m.members()).toMatchObject([
      { entityId: 3, name: 'p3', isLeader: true, isMe: false },
      { entityId: 5, name: 'p5', isLeader: false, isMe: true },
    ]);
  });

  it('describes joins and leaves, and the end of the party', () => {
    const { m } = mk();
    m.applyState({ type: 'party_state', leaderId: 5, members: roster(5, 6) });
    expect(m.amLeader).toBe(true);
    expect(m.applyState({ type: 'party_state', leaderId: 5, members: roster(5, 6, 7) })).toBe('p7 vào tổ đội.');
    expect(m.applyState({ type: 'party_state', leaderId: 5, members: roster(5, 7) })).toBe('p6 rời tổ đội.');
    expect(m.applyState({ type: 'party_state', leaderId: 0, members: [] })).toBe('Bạn đã rời tổ đội.');
    expect(m.inParty).toBe(false);
    expect(m.applyState({ type: 'party_state', leaderId: 0, members: [] })).toBeNull();
  });

  it('vitals attach to members and are forgotten when a member leaves', () => {
    const { m } = mk();
    m.applyState({ type: 'party_state', leaderId: 5, members: roster(5, 6) });
    m.applyVitals({ type: 'party_vitals', members: [{ entityId: 6, hp: 30, hpMax: 60, mp: 5, mpMax: 10 }] });
    expect(m.members()[1]).toMatchObject({ hp: 30, hpMax: 60, mp: 5, mpMax: 10 });
    expect(m.members()[0]!.hp).toBeUndefined();
    m.applyState({ type: 'party_state', leaderId: 0, members: [] });
    m.applyState({ type: 'party_state', leaderId: 5, members: roster(5, 6) });
    expect(m.members()[1]!.hp).toBeUndefined();
  });

  it('invites: newest first, expire by their ttl, replaced per inviter, dropped when a party is joined', () => {
    const { m, tick } = mk();
    expect(m.applyInvite({ type: 'party_invite', fromName: 'alice', ttlMs: 30000 })).toContain('alice mời bạn');
    tick(10000);
    m.applyInvite({ type: 'party_invite', fromName: 'bob', ttlMs: 30000 });
    expect(m.invite()!.fromName).toBe('bob');
    tick(20001); // alice's is over (30 s), bob's has 9.999 s left
    expect(m.pendingInvites().map((i) => i.fromName)).toEqual(['bob']);
    m.applyInvite({ type: 'party_invite', fromName: 'bob', ttlMs: 30000 });
    expect(m.pendingInvites()).toHaveLength(1);
    m.forgetInvite('');
    expect(m.invite()).toBeNull();
    m.applyInvite({ type: 'party_invite', fromName: 'carol', ttlMs: 30000 });
    m.applyState({ type: 'party_state', leaderId: 9, members: roster(9, 5) });
    expect(m.invite()).toBeNull();
  });

  it('version bumps on every change, and results turn into Vietnamese refusals', () => {
    const { m } = mk();
    const v0 = m.version;
    m.applyState({ type: 'party_state', leaderId: 5, members: roster(5, 6) });
    m.applyVitals({ type: 'party_vitals', members: [] });
    expect(m.version).toBe(v0 + 2);
    expect(m.applyResult({ type: 'party_result', clientMsgId: 1, reason: PartyReason.Ok })).toBeNull();
    expect(m.applyResult({ type: 'party_result', clientMsgId: 1, reason: PartyReason.NotLeader })).toBe(
      partyReasonText(PartyReason.NotLeader),
    );
    expect(m.applyResult({ type: 'party_result', clientMsgId: 1, reason: 200 })).toContain('200');
    for (const r of Object.values(PartyReason).filter((x): x is number => typeof x === 'number')) {
      if (r !== PartyReason.Ok) expect(partyReasonText(r), `reason ${r}`).toBeTruthy();
    }
  });
});
