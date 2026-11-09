import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@vgtd/shared';
import { FriendOp, FriendReason, type FriendStateMsg } from '@vgtd/protocol';
import { ChatLog, friendReasonText, FriendsModel, parseChatInput } from '../src/index.js';

const state = (o: Partial<FriendStateMsg> = {}): FriendStateMsg => ({
  type: 'friend_state',
  friends: [],
  incoming: [],
  outgoing: [],
  ...o,
});

describe('friend commands in the chat input', () => {
  it('/friend add | remove need a name, accept | decline take an optional one, /friends lists', () => {
    expect(parseChatInput('/friend add bob')).toEqual({ kind: 'friend', op: FriendOp.Request, name: 'bob' });
    expect(parseChatInput('/f add  bob extra')).toEqual({ kind: 'friend', op: FriendOp.Request, name: 'bob' });
    expect(parseChatInput('/friend remove bob')).toEqual({ kind: 'friend', op: FriendOp.Remove, name: 'bob' });
    expect(parseChatInput('/friend accept')).toEqual({ kind: 'friend', op: FriendOp.Accept, name: '' });
    expect(parseChatInput('/friend accept alice')).toEqual({ kind: 'friend', op: FriendOp.Accept, name: 'alice' });
    expect(parseChatInput('/friend decline alice')).toEqual({ kind: 'friend', op: FriendOp.Decline, name: 'alice' });
    expect(parseChatInput('/friends')).toEqual({ kind: 'friends' });
    expect(parseChatInput('/friend')).toEqual({ kind: 'friends' });
    expect(parseChatInput('/friend add')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/friend remove')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/friend bogus x')).toMatchObject({ kind: 'error' });
    expect(parseChatInput('/friend add ' + 'a'.repeat(25))).toMatchObject({ kind: 'error' });
  });

  it('ChatLog.submit sends a friend command with a client id, says so when the socket is closed, and /friends calls the panel hook', () => {
    let shown = 0;
    const l = new ChatLog({ myName: () => 'me', onFriends: () => shown++ });
    const got: unknown[] = [];
    const never = () => false;
    expect(l.submit('/friend add bob', never, never, (m) => (got.push(m), true))).toBe(true);
    expect(got).toEqual([{ op: FriendOp.Request, name: 'bob', clientMsgId: expect.any(Number) }]);
    expect(l.submit('/friend add bob', never, never, () => false)).toBe(false);
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error', text: 'Chưa kết nối máy chủ.' });
    expect(l.submit('/friend add bob', never)).toBe(false); // no friend sender wired
    expect(l.entries.at(-1)).toMatchObject({ tone: 'error' });
    expect(l.submit('/friends', never, never, () => true)).toBe(false);
    expect(shown).toBe(1);
  });
});

describe('FriendsModel', () => {
  it('lists online friends first, then by name; shortcuts only for online friends', () => {
    const m = new FriendsModel();
    expect(m.ready).toBe(false);
    m.applyState(
      state({
        friends: [
          { name: 'zed', classId: 0, online: false },
          { name: 'Bob', classId: 2, online: true },
          { name: 'alice', classId: 1, online: true },
          { name: 'carol', classId: 0, online: false },
        ],
      }),
    );
    expect(m.ready).toBe(true);
    expect(m.friends().map((f) => [f.name, f.online, f.canWhisper, f.canInvite])).toEqual([
      ['alice', true, true, true],
      ['Bob', true, true, true],
      ['carol', false, false, false],
      ['zed', false, false, false],
    ]);
    expect([m.count, m.onlineCount]).toEqual([4, 2]);
    expect(m.isFriend('BOB')).toBe(true);
    expect(m.isFriend('nobody')).toBe(false);
  });

  it('announces a new request / a new friend / a removed friend, but not presence changes', () => {
    const m = new FriendsModel();
    expect(m.applyState(state())).toBeNull(); // first state, nothing pending
    expect(m.applyState(state({ incoming: ['carol'] }))).toMatch(/carol muốn kết bạn/);
    expect(m.applyState(state({ friends: [{ name: 'carol', classId: 3, online: true }] }))).toMatch(/đã là bạn bè/);
    expect(m.applyState(state({ friends: [{ name: 'carol', classId: 0, online: false }] }))).toBeNull(); // went offline
    expect(m.applyState(state())).toMatch(/không còn trong danh sách/);
    const first = new FriendsModel();
    expect(first.applyState(state({ incoming: ['a', 'b'] }))).toMatch(/2 lời mời/);
  });

  it('bumps the version on every state, returns copies, and answers results in Vietnamese', () => {
    const m = new FriendsModel();
    const v0 = m.version;
    m.applyState(state({ incoming: ['x'] }));
    expect(m.version).toBeGreaterThan(v0);
    m.incoming().push('hacked');
    expect(m.incoming()).toEqual(['x']);
    expect(m.applyResult({ type: 'friend_result', clientMsgId: 1, reason: FriendReason.Ok })).toBeNull();
    for (const reason of Object.values(FriendReason).filter((v): v is number => typeof v === 'number')) {
      if (reason === FriendReason.Ok) continue;
      expect(friendReasonText(reason), `reason ${reason}`).toBeTruthy();
      expect(m.applyResult({ type: 'friend_result', clientMsgId: 1, reason })).toBe(friendReasonText(reason));
    }
    expect(m.applyResult({ type: 'friend_result', clientMsgId: 1, reason: 200 })).toMatch(/mã 200/);
  });

  it('builds the existing whisper input and party command for the list shortcuts, and a text summary for /friends', () => {
    const m = new FriendsModel();
    expect(m.summaryLines()).toEqual(['Danh sách bạn bè chưa tải xong.']);
    m.applyState(
      state({ friends: [{ name: 'bob', classId: 2, online: true }], incoming: ['carol'], outgoing: ['dave'] }),
    );
    expect(m.whisperPrefill('bob')).toBe('/w bob ');
    expect(m.inviteCommand('bob')).toBe('/invite bob');
    // the prefills parse as the existing commands
    expect(parseChatInput(m.inviteCommand('bob'))).toMatchObject({ kind: 'party' });
    expect(parseChatInput(m.whisperPrefill('bob') + 'hi')).toMatchObject({ kind: 'send', target: 'bob', text: 'hi' });
    const lines = m.summaryLines();
    expect(lines[0]).toBe(`Bạn bè (1/${FRIENDS.MAX_FRIENDS}, 1 đang online):`);
    expect(lines.join('\n')).toMatch(/● bob/);
    expect(lines.join('\n')).toMatch(/carol/);
    expect(lines.join('\n')).toMatch(/dave/);
  });
});
