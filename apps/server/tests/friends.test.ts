/**
 * FriendService (D96): requests / accept / decline / remove, the friend list with online status, persistence through the store, limits,
 * and the anti-enumeration rule (rate-limit token BEFORE any name is resolved, like whispers in #247).
 */
import { describe, expect, it } from 'vitest';
import { FRIENDS } from '@vgtd/shared';
import { FriendOp, FriendReason, type FriendServerMessage, type FriendStateMsg } from '@vgtd/protocol';
import { FRIENDS_CONFIG, FriendService, InMemoryFriendStore, type FriendStore } from '../src/index.js';

interface Rig {
  svc: FriendService;
  store: InMemoryFriendStore;
  got: Map<number, FriendServerMessage[]>;
  /** run one friend command as `entity`, returns the reason */
  cmd(entity: number, op: number, name?: string, now?: number): FriendReason;
  /** flush the per-tick notifications and return the LAST state each entity got since the previous flush */
  flush(): Map<number, FriendStateMsg>;
}

const NAMES = ['alice', 'bob', 'carol', 'dave'];
function rig(extra: number = 0, store: FriendStore = new InMemoryFriendStore()): Rig {
  // accounts: acc-<name>; `extra` more accounts "pal0".. for the list-size tests
  const all = [...NAMES, ...Array.from({ length: extra }, (_, i) => `pal${i}`)];
  const byName = new Map(all.map((n) => [n, `acc-${n}`]));
  const byId = new Map(all.map((n) => [`acc-${n}`, n]));
  const svc = new FriendService({
    store,
    directory: { idOf: (n) => byName.get(n), nameOf: (id) => byId.get(id) },
  });
  const got = new Map<number, FriendServerMessage[]>();
  svc.attach({
    deliver: (id, m) => {
      const l = got.get(id) ?? [];
      l.push(m);
      got.set(id, l);
    },
  });
  // alice(1), bob(2), carol(3) are online; dave has an account but is offline
  [
    [1, 'alice', 1],
    [2, 'bob', 2],
    [3, 'carol', 3],
  ].forEach(([e, n, c]) =>
    svc.join({ entityId: e as number, accountId: `acc-${n as string}`, name: n as string, classId: c as number }),
  );
  svc.tick();
  got.clear();
  let msg = 0;
  // by default every command is far enough after the previous one that the rate limiter never interferes
  let clock = 100_000;
  return {
    svc,
    store: store as InMemoryFriendStore,
    got,
    cmd(entity, op, name = '', now = (clock += 2 * FRIENDS_CONFIG.RATE.refillMs)) {
      return svc.handle(entity, { type: 'friend_cmd', op, clientMsgId: ++msg, name }, now).reason;
    },
    flush() {
      svc.tick();
      const last = new Map<number, FriendStateMsg>();
      for (const [id, list] of got) for (const m of list) if (m.type === 'friend_state') last.set(id, m);
      got.clear();
      return last;
    },
  };
}
const ALICE = 1;
const BOB = 2;
const CAROL = 3;

describe('request / accept', () => {
  it('a request shows as outgoing for the sender and incoming for the target, and nobody else hears of it', () => {
    const r = rig();
    expect(r.cmd(ALICE, FriendOp.Request, 'bob')).toBe(FriendReason.Ok);
    const s = r.flush();
    expect(s.get(ALICE)).toMatchObject({ friends: [], incoming: [], outgoing: ['bob'] });
    expect(s.get(BOB)).toMatchObject({ friends: [], incoming: ['alice'], outgoing: [] });
    expect(s.has(CAROL)).toBe(false);
  });

  it('accepting makes both friends, both see each other online with their class, the request is gone', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'BOB'); // names match ignoring case
    r.flush();
    expect(r.cmd(BOB, FriendOp.Accept, 'alice')).toBe(FriendReason.Ok);
    const s = r.flush();
    expect(s.get(ALICE)).toEqual({
      type: 'friend_state',
      friends: [{ name: 'bob', classId: 2, online: true }],
      incoming: [],
      outgoing: [],
    });
    expect(s.get(BOB)).toEqual({
      type: 'friend_state',
      friends: [{ name: 'alice', classId: 1, online: true }],
      incoming: [],
      outgoing: [],
    });
    expect(r.svc.isFriend('acc-alice', 'acc-bob')).toBe(true);
    expect(r.svc.isFriend('acc-bob', 'acc-alice')).toBe(true);
  });

  it('accept / decline with no name take the oldest request', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'carol');
    r.cmd(BOB, FriendOp.Request, 'carol');
    expect(r.cmd(CAROL, FriendOp.Accept)).toBe(FriendReason.Ok); // alice asked first
    expect(r.svc.isFriend('acc-alice', 'acc-carol')).toBe(true);
    expect(r.cmd(CAROL, FriendOp.Decline)).toBe(FriendReason.Ok); // bob's
    expect(r.svc.isFriend('acc-bob', 'acc-carol')).toBe(false);
    expect(r.cmd(CAROL, FriendOp.Accept)).toBe(FriendReason.NoRequest);
  });

  it('asking someone who already asked you is accepting', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'bob');
    expect(r.cmd(BOB, FriendOp.Request, 'alice')).toBe(FriendReason.Ok);
    expect(r.svc.isFriend('acc-alice', 'acc-bob')).toBe(true);
    const s = r.flush();
    expect(s.get(ALICE)!.outgoing).toEqual([]);
    expect(s.get(BOB)!.incoming).toEqual([]);
  });

  it('works with an OFFLINE account: they see the request when they come online, and appear offline in the list', () => {
    const r = rig();
    expect(r.cmd(ALICE, FriendOp.Request, 'dave')).toBe(FriendReason.Ok);
    r.flush();
    r.svc.join({ entityId: 9, accountId: 'acc-dave', name: 'dave', classId: 4 });
    const s = r.flush();
    expect(s.get(9)).toMatchObject({ incoming: ['alice'] });
    expect(r.cmd(9, FriendOp.Accept, 'alice')).toBe(FriendReason.Ok);
    r.flush();
    r.svc.leave(9);
    const after = r.flush();
    expect(after.get(ALICE)!.friends).toEqual([{ name: 'dave', classId: 0, online: false }]);
  });
});

describe('decline / remove', () => {
  it('decline removes the request on both sides', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'bob');
    r.flush();
    expect(r.cmd(BOB, FriendOp.Decline, 'alice')).toBe(FriendReason.Ok);
    const s = r.flush();
    expect(s.get(ALICE)!.outgoing).toEqual([]);
    expect(s.get(BOB)!.incoming).toEqual([]);
    // the sender may ask again after a decline
    expect(r.cmd(ALICE, FriendOp.Request, 'bob')).toBe(FriendReason.Ok);
  });

  it('remove ends the friendship for both; remove also withdraws a request you sent', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'bob');
    r.cmd(BOB, FriendOp.Accept, 'alice');
    r.flush();
    expect(r.cmd(BOB, FriendOp.Remove, 'alice')).toBe(FriendReason.Ok);
    const s = r.flush();
    expect(s.get(ALICE)!.friends).toEqual([]);
    expect(s.get(BOB)!.friends).toEqual([]);
    expect(r.cmd(BOB, FriendOp.Remove, 'alice')).toBe(FriendReason.NotFriends);
    r.cmd(ALICE, FriendOp.Request, 'carol');
    expect(r.cmd(ALICE, FriendOp.Remove, 'carol')).toBe(FriendReason.Ok); // withdrawn
    expect(r.cmd(CAROL, FriendOp.Accept, 'alice')).toBe(FriendReason.NoRequest);
  });
});

describe('refusals', () => {
  it('self, unknown, already friends, already requested, no request', () => {
    const r = rig();
    expect(r.cmd(ALICE, FriendOp.Request, 'alice')).toBe(FriendReason.Self);
    expect(r.cmd(ALICE, FriendOp.Remove, 'alice')).toBe(FriendReason.Self);
    expect(r.cmd(ALICE, FriendOp.Request, 'nobody_here')).toBe(FriendReason.NoSuchPlayer);
    r.cmd(ALICE, FriendOp.Request, 'bob');
    expect(r.cmd(ALICE, FriendOp.Request, 'bob')).toBe(FriendReason.AlreadyRequested);
    r.cmd(BOB, FriendOp.Accept, 'alice');
    expect(r.cmd(ALICE, FriendOp.Request, 'bob')).toBe(FriendReason.AlreadyFriends);
    expect(r.cmd(ALICE, FriendOp.Accept, 'carol')).toBe(FriendReason.NoRequest);
    expect(r.cmd(ALICE, FriendOp.Decline, 'zzz')).toBe(FriendReason.NoRequest);
    expect(r.svc.metrics.refused[FriendReason.Self]).toBe(2);
  });

  it('an entity that never joined gets NotReady', () => {
    const r = rig();
    expect(r.cmd(77, FriendOp.Request, 'bob')).toBe(FriendReason.NotReady);
  });

  it('list limits: your friend list, their friend list, their inbox, your outbox', () => {
    const r = rig(FRIENDS.MAX_FRIENDS + FRIENDS.MAX_INCOMING + 5);
    const t = (k: number) => 1000 + k * 10_000; // far apart on the clock so the rate limiter never interferes
    let k = 0;
    // alice fills her friend list (the pals ask alice and she accepts, mutual-request path included)
    for (let i = 0; i < FRIENDS.MAX_FRIENDS; i++) {
      r.svc.join({ entityId: 100 + i, accountId: `acc-pal${i}`, name: `pal${i}`, classId: 1 });
      expect(r.cmd(100 + i, FriendOp.Request, 'alice', t(k++))).toBe(FriendReason.Ok);
      expect(r.cmd(ALICE, FriendOp.Accept, `pal${i}`, t(k++))).toBe(FriendReason.Ok);
    }
    expect(r.svc.friendCount('acc-alice')).toBe(FRIENDS.MAX_FRIENDS);
    expect(r.cmd(ALICE, FriendOp.Request, 'dave', t(k++))).toBe(FriendReason.FriendListFull);
    // someone asks alice: refused for the SENDER as "target full"; alice cannot accept either way
    expect(r.cmd(BOB, FriendOp.Request, 'alice', t(k++))).toBe(FriendReason.TargetListFull);
    // bob's inbox (carol, then pals) fills: the next sender is told the target cannot take more
    const spare = FRIENDS.MAX_FRIENDS;
    for (let i = 0; i < FRIENDS.MAX_INCOMING; i++) {
      const id = 300 + i;
      r.svc.join({ entityId: id, accountId: `acc-pal${spare + i}`, name: `pal${spare + i}`, classId: 1 });
      expect(r.cmd(id, FriendOp.Request, 'bob', t(k++))).toBe(FriendReason.Ok);
    }
    expect(r.cmd(CAROL, FriendOp.Request, 'bob', t(k++))).toBe(FriendReason.TargetListFull);
    // carol's outbox: MAX_OUTGOING pending requests, then TooManyRequests
    const first = FRIENDS.MAX_FRIENDS + FRIENDS.MAX_INCOMING;
    for (let i = 0; i < FRIENDS.MAX_OUTGOING; i++)
      expect(
        r.cmd(CAROL, FriendOp.Request, `pal${(first + i) % (FRIENDS.MAX_FRIENDS + FRIENDS.MAX_INCOMING + 5)}`, t(k++)),
      ).not.toBe(FriendReason.TooManyRequests);
  });
});

describe('anti-enumeration: the token is spent before any name is resolved', () => {
  it('rapid probes of unknown names end in RateLimited, and once the bucket is empty an unknown name and a real one answer the same', () => {
    const r = rig();
    const burst = FRIENDS_CONFIG.RATE.burst;
    const answers = Array.from({ length: burst + 4 }, (_, k) => r.cmd(ALICE, FriendOp.Request, `ghost${k}`, 0));
    expect(answers.slice(0, burst).every((a) => a === FriendReason.NoSuchPlayer)).toBe(true);
    expect(answers.slice(burst).every((a) => a === FriendReason.RateLimited)).toBe(true);
    for (const name of ['bob', 'alice', 'ghost', 'dave'])
      expect(r.cmd(ALICE, FriendOp.Request, name, 0)).toBe(FriendReason.RateLimited);
    expect(r.cmd(ALICE, FriendOp.Remove, 'bob', 0)).toBe(FriendReason.RateLimited);
    expect(r.cmd(ALICE, FriendOp.Accept, 'bob', 0)).toBe(FriendReason.RateLimited);
    // nothing leaked into the state either
    expect(r.flush().size).toBe(0);
    // one refill interval buys exactly one more answer
    expect(r.cmd(ALICE, FriendOp.Request, 'ghost', FRIENDS_CONFIG.RATE.refillMs)).toBe(FriendReason.NoSuchPlayer);
    expect(r.cmd(ALICE, FriendOp.Request, 'ghost2', FRIENDS_CONFIG.RATE.refillMs)).toBe(FriendReason.RateLimited);
  });

  it('the limit is per account: bob is not slowed down by alice probing', () => {
    const r = rig();
    for (let k = 0; k < 10; k++) r.cmd(ALICE, FriendOp.Request, `ghost${k}`, 0);
    expect(r.cmd(BOB, FriendOp.Request, 'carol', 0)).toBe(FriendReason.Ok);
  });
});

describe('presence', () => {
  it('a friend coming online / going offline updates the other side at the next tick, coalesced to one message per session', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'dave');
    // dave is offline: befriend through his later accept
    r.svc.join({ entityId: 9, accountId: 'acc-dave', name: 'dave', classId: 5 });
    r.flush();
    r.cmd(9, FriendOp.Accept, 'alice');
    r.flush();
    // dave leaves and comes back inside one tick: alice gets ONE message, saying online
    r.svc.leave(9);
    r.svc.join({ entityId: 10, accountId: 'acc-dave', name: 'dave', classId: 5 });
    r.svc.tick();
    expect(r.got.get(ALICE)).toHaveLength(1);
    expect(r.got.get(ALICE)![0]).toMatchObject({ friends: [{ name: 'dave', online: true, classId: 5 }] });
    r.got.clear();
    r.svc.leave(10);
    const s = r.flush();
    expect(s.get(ALICE)!.friends).toEqual([{ name: 'dave', classId: 0, online: false }]);
  });

  it('every live session of an account gets the state; the account is "online" until its LAST session leaves', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'bob');
    r.cmd(BOB, FriendOp.Accept, 'alice');
    r.flush();
    r.svc.join({ entityId: 20, accountId: 'acc-bob', name: 'bob', classId: 2 }); // a second tab of bob
    r.svc.tick();
    expect(r.got.get(20)).toHaveLength(1);
    r.got.clear();
    r.svc.leave(BOB);
    expect(r.flush().get(ALICE)).toBeUndefined(); // bob still has a session: nothing changed for his friends
    r.svc.leave(20);
    expect(r.flush().get(ALICE)!.friends[0]).toMatchObject({ name: 'bob', online: false });
  });
});

describe('persistence', () => {
  it('friendships and pending requests survive a restart (a new service on the same store); presence does not', () => {
    const store = new InMemoryFriendStore();
    const a = rig(0, store);
    a.cmd(ALICE, FriendOp.Request, 'bob');
    a.cmd(BOB, FriendOp.Accept, 'alice');
    a.cmd(ALICE, FriendOp.Request, 'carol'); // pending
    expect(store.saves).toBeGreaterThan(0);
    const b = rig(0, store); // a "restart": same store, fresh service, everyone online again
    expect(b.svc.isFriend('acc-alice', 'acc-bob')).toBe(true);
    const st = b.svc.stateOf('acc-alice');
    expect(st.friends).toEqual([{ name: 'bob', classId: 2, online: true }]);
    expect(st.outgoing).toEqual(['carol']);
    expect(b.svc.stateOf('acc-carol').incoming).toEqual(['alice']);
    expect(b.cmd(CAROL, FriendOp.Accept, 'alice')).toBe(FriendReason.Ok);
  });

  it('the snapshot is deterministic and does not store names or presence (ids only)', () => {
    const r = rig();
    r.cmd(ALICE, FriendOp.Request, 'bob');
    r.cmd(BOB, FriendOp.Accept, 'alice');
    r.cmd(CAROL, FriendOp.Request, 'alice');
    const snap = r.svc.snapshot();
    expect(snap).toEqual({ friends: [['acc-alice', 'acc-bob']], requests: [['acc-carol', 'acc-alice']] });
    expect(JSON.stringify(snap)).not.toMatch(/online|classId/);
  });

  it('accounts that no longer exist are skipped in the list instead of breaking it', () => {
    const store = new InMemoryFriendStore();
    store.save({ friends: [['acc-alice', 'acc-ghost']], requests: [['acc-ghost', 'acc-alice']] });
    const r = rig(0, store);
    expect(r.svc.stateOf('acc-alice')).toEqual({ type: 'friend_state', friends: [], incoming: [], outgoing: [] });
  });
});
