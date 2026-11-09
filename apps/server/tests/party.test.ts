import { describe, expect, it } from 'vitest';
import { NETWORK, PARTY, resolveDrops, rngFloat, rngFork, rngSeed, type DropRoll } from '@vgtd/shared';
import {
  ChatChannel,
  ChatReason,
  ErrorCode,
  PartyOp,
  PartyReason,
  decode,
  encode,
  type Message,
  type PartyServerMessage,
  type PartyStateMsg,
  type PartyVitalsMsg,
} from '@vgtd/protocol';
import { TileGrid, compileSkills, createWorld, spawnEntity, step, type SimContext, type SimWorld } from '@vgtd/sim';
import {
  ChatService,
  CombatSystem,
  PARTY_CONFIG,
  PartyService,
  WorldNode,
  type ClientTransport,
  type MobCombatStats,
  type MobPort,
} from '../src/index.js';

// ------------------------------------------------------------------ service units
interface Rig {
  party: PartyService;
  got: Map<number, PartyServerMessage[]>;
  vitals: Map<number, { hp: number; hpMax: number; mp: number; mpMax: number }>;
  cmd(id: number, op: PartyOp, name?: string, now?: number): PartyReason;
  last(id: number, type: PartyServerMessage['type']): PartyServerMessage | undefined;
  state(id: number): PartyStateMsg | undefined;
}
const NAMES = ['alice', 'bob', 'carol', 'dave', 'erin', 'frank'];
function rig(): Rig {
  const party = new PartyService();
  const got = new Map<number, PartyServerMessage[]>();
  const vitals = new Map<number, { hp: number; hpMax: number; mp: number; mpMax: number }>();
  party.attach({
    deliver: (id, m) => {
      const l = got.get(id) ?? [];
      l.push(m);
      got.set(id, l);
    },
    vitalsOf: (id) => vitals.get(id),
  });
  NAMES.forEach((name, k) => {
    party.join({ entityId: k + 1, accountId: `acc-${name}`, name, classId: 1 + (k % 6) });
    vitals.set(k + 1, { hp: 100, hpMax: 100, mp: 50, mpMax: 50 });
  });
  const r: Rig = {
    party,
    got,
    vitals,
    cmd: (id, op, name = '', now = 1000) =>
      party.handle(id, { type: 'party_cmd', op, clientMsgId: 7, name }, now).reason,
    last: (id, type) => [...(got.get(id) ?? [])].reverse().find((m) => m.type === type),
    state: (id) => r.last(id, 'party_state') as PartyStateMsg | undefined,
  };
  return r;
}
/** alice (1) leads a party with the first `n - 1` others */
function formed(n: number): Rig {
  const r = rig();
  for (let id = 2; id <= n; id++) {
    expect(r.cmd(1, PartyOp.Invite, NAMES[id - 1], 1000 + id * 1000)).toBe(PartyReason.Ok);
    expect(r.cmd(id, PartyOp.Accept, 'alice', 1000 + id * 1000)).toBe(PartyReason.Ok);
  }
  return r;
}

describe('invite / accept / decline', () => {
  it('an accepted invite forms a party led by the inviter, and every member gets the roster', () => {
    const r = rig();
    expect(r.cmd(1, PartyOp.Invite, 'bob')).toBe(PartyReason.Ok);
    expect(r.last(2, 'party_invite')).toEqual({ type: 'party_invite', fromName: 'alice', ttlMs: PARTY.INVITE_TTL_MS });
    expect(r.state(1)).toBeUndefined(); // nothing yet: an invite alone changes nobody's party
    expect(r.cmd(2, PartyOp.Accept, 'alice')).toBe(PartyReason.Ok);
    for (const id of [1, 2]) {
      expect(r.state(id)).toEqual({
        type: 'party_state',
        leaderId: 1,
        members: [
          { entityId: 1, name: 'alice', classId: 1 },
          { entityId: 2, name: 'bob', classId: 2 },
        ],
      });
    }
    expect(r.party.membersOf(2)).toEqual([1, 2]);
    expect(r.party.leaderOf(2)).toBe(1);
    expect(r.party.partyIdOf(1)).toBe(r.party.partyIdOf(2));
  });

  it('names are case-insensitive; Accept with an empty name answers the newest invite', () => {
    const r = rig();
    r.cmd(1, PartyOp.Invite, 'CAROL');
    r.cmd(2, PartyOp.Invite, 'carol');
    expect(r.cmd(3, PartyOp.Accept, '')).toBe(PartyReason.Ok);
    expect(r.party.leaderOf(3)).toBe(2); // bob's invite was the newest
    expect(r.party.partyIdOf(1)).toBe(0);
  });

  it('decline drops the invite; a second answer finds none', () => {
    const r = rig();
    r.cmd(1, PartyOp.Invite, 'bob');
    expect(r.cmd(2, PartyOp.Decline, 'alice')).toBe(PartyReason.Ok);
    expect(r.cmd(2, PartyOp.Accept, 'alice')).toBe(PartyReason.NoInvite);
    expect(r.cmd(2, PartyOp.Decline, '')).toBe(PartyReason.NoInvite);
    expect(r.party.partyCount).toBe(0);
  });

  it('an invite whose sender is no longer solo or leader is void (a non-leader cannot pull people in with an old invite)', () => {
    const r = rig();
    r.cmd(1, PartyOp.Invite, 'carol'); // alice, alone, invites carol
    r.cmd(2, PartyOp.Invite, 'alice'); // bob invites alice, who joins bob's party as a plain member
    expect(r.cmd(1, PartyOp.Accept, 'bob')).toBe(PartyReason.Ok);
    expect(r.party.leaderOf(1)).toBe(2);
    expect(r.cmd(3, PartyOp.Accept, 'alice')).toBe(PartyReason.NoInvite);
    expect(r.party.partyIdOf(3)).toBe(0);
    expect(r.party.membersOf(2)).toEqual([1, 2]);
    // while the sender still leads, an invite stays good even after the party formed around them
    const s = rig();
    s.cmd(1, PartyOp.Invite, 'bob');
    s.cmd(1, PartyOp.Invite, 'carol');
    expect(s.cmd(2, PartyOp.Accept, 'alice')).toBe(PartyReason.Ok);
    expect(s.cmd(3, PartyOp.Accept, 'alice')).toBe(PartyReason.Ok);
    expect(s.party.membersOf(1)).toEqual([1, 2, 3]);
  });

  it('an invite expires after PARTY.INVITE_TTL_MS', () => {
    const r = rig();
    r.cmd(1, PartyOp.Invite, 'bob', 1000);
    expect(r.cmd(2, PartyOp.Accept, 'alice', 1000 + PARTY.INVITE_TTL_MS)).toBe(PartyReason.NoInvite);
    r.cmd(1, PartyOp.Invite, 'bob', 50_000); // can be invited again
    expect(r.cmd(2, PartyOp.Accept, 'alice', 50_000 + PARTY.INVITE_TTL_MS - 1)).toBe(PartyReason.Ok);
  });

  it('refusals: unknown name, self, already in a party, duplicate invite, accepting while in a party', () => {
    const r = rig();
    expect(r.cmd(1, PartyOp.Invite, 'nobody')).toBe(PartyReason.NoSuchPlayer);
    expect(r.cmd(1, PartyOp.Invite, 'alice')).toBe(PartyReason.Self);
    expect(r.cmd(1, PartyOp.Invite, 'bob')).toBe(PartyReason.Ok);
    expect(r.cmd(1, PartyOp.Invite, 'bob')).toBe(PartyReason.TooManyInvites); // already pending from me
    r.cmd(2, PartyOp.Accept, 'alice');
    expect(r.cmd(3, PartyOp.Invite, 'bob')).toBe(PartyReason.TargetInParty);
    r.cmd(3, PartyOp.Invite, 'dave');
    expect(r.cmd(4, PartyOp.Accept, 'carol')).toBe(PartyReason.Ok);
    r.cmd(5, PartyOp.Invite, 'bob');
    expect(r.cmd(2, PartyOp.Accept, 'erin')).toBe(PartyReason.AlreadyInParty);
  });

  it('only the leader invites; a full party refuses; a player holds at most MAX_PENDING_INVITES', () => {
    const r = formed(PARTY.MAX_SIZE);
    expect(r.party.membersOf(1)).toHaveLength(PARTY.MAX_SIZE);
    expect(r.cmd(1, PartyOp.Invite, 'erin')).toBe(PartyReason.PartyFull);
    expect(r.cmd(2, PartyOp.Invite, 'erin')).toBe(PartyReason.NotLeader);
    const s = rig();
    const ids = [1, 2, 3, 4, 5];
    for (const id of ids) s.party.join({ entityId: 10 + id, accountId: `x${id}`, name: `x${id}`, classId: 1 });
    for (let k = 0; k < PARTY.MAX_PENDING_INVITES; k++)
      expect(s.cmd(10 + ids[k]!, PartyOp.Invite, 'frank')).toBe(PartyReason.Ok);
    expect(s.cmd(10 + ids[4]!, PartyOp.Invite, 'frank')).toBe(PartyReason.TooManyInvites);
  });

  it('accepting into a party that filled up meanwhile is PartyFull and keeps the invite out of the party', () => {
    const r = formed(PARTY.MAX_SIZE);
    // dave (4) is a member; erin (5) got an invite from bob BEFORE the party filled: forge it by inviting through carol earlier
    const s = rig();
    s.cmd(1, PartyOp.Invite, 'bob');
    s.cmd(1, PartyOp.Invite, 'erin');
    s.cmd(1, PartyOp.Invite, 'frank');
    s.cmd(1, PartyOp.Invite, 'carol');
    expect(s.cmd(2, PartyOp.Accept, 'alice')).toBe(PartyReason.Ok);
    expect(s.cmd(3, PartyOp.Accept, 'alice')).toBe(PartyReason.Ok);
    expect(s.cmd(5, PartyOp.Accept, 'alice')).toBe(PartyReason.Ok);
    expect(s.party.membersOf(1)).toHaveLength(PARTY.MAX_SIZE);
    expect(s.cmd(6, PartyOp.Accept, 'alice')).toBe(PartyReason.PartyFull);
    expect(s.party.partyIdOf(6)).toBe(0);
    expect(r.party.partyCount).toBe(1);
  });

  it('commands are rate limited per account (an invite flood answers RateLimited, nothing is silent)', () => {
    const r = rig();
    const reasons: PartyReason[] = [];
    for (let k = 0; k < PARTY_CONFIG.RATE.burst + 2; k++) reasons.push(r.cmd(1, PartyOp.Invite, 'nobody', 1000));
    expect(reasons.filter((x) => x === PartyReason.RateLimited)).toHaveLength(2);
    expect(r.cmd(1, PartyOp.Invite, 'nobody', 1000 + PARTY_CONFIG.RATE.refillMs)).toBe(PartyReason.NoSuchPlayer);
  });

  it('a player who is not in the world gets NotReady', () => {
    const r = rig();
    expect(r.party.handle(99, { type: 'party_cmd', op: PartyOp.Leave, clientMsgId: 1, name: '' }, 0)).toEqual({
      type: 'party_result',
      clientMsgId: 1,
      reason: PartyReason.NotReady,
    });
  });
});

describe('leave / kick / disconnect', () => {
  it('a party of two disbands when one leaves: both are told the roster is empty', () => {
    const r = formed(2);
    expect(r.cmd(2, PartyOp.Leave)).toBe(PartyReason.Ok);
    expect(r.state(1)).toEqual({ type: 'party_state', leaderId: 0, members: [] });
    expect(r.state(2)).toEqual({ type: 'party_state', leaderId: 0, members: [] });
    expect(r.party.partyCount).toBe(0);
    expect(r.cmd(1, PartyOp.Leave)).toBe(PartyReason.NotInParty);
  });

  it('the leader leaving hands the party to the longest-standing member', () => {
    const r = formed(3);
    r.cmd(1, PartyOp.Leave);
    expect(r.state(2)).toMatchObject({ leaderId: 2, members: [{ entityId: 2 }, { entityId: 3 }] });
    expect(r.party.leaderOf(3)).toBe(2);
    expect(r.state(1)).toEqual({ type: 'party_state', leaderId: 0, members: [] });
  });

  it('only the leader kicks; the kicked member is told and the others get the new roster', () => {
    const r = formed(3);
    expect(r.cmd(2, PartyOp.Kick, 'carol')).toBe(PartyReason.NotLeader);
    expect(r.cmd(1, PartyOp.Kick, 'alice')).toBe(PartyReason.Self);
    expect(r.cmd(1, PartyOp.Kick, 'dave')).toBe(PartyReason.NotInParty); // exists, but not in my party
    expect(r.cmd(1, PartyOp.Kick, 'nobody')).toBe(PartyReason.NotInParty);
    expect(r.cmd(1, PartyOp.Kick, 'carol')).toBe(PartyReason.Ok);
    expect(r.state(3)).toEqual({ type: 'party_state', leaderId: 0, members: [] });
    expect(r.state(2)).toMatchObject({ leaderId: 1, members: [{ entityId: 1 }, { entityId: 2 }] });
    expect(r.party.partyIdOf(3)).toBe(0);
    expect(r.cmd(5, PartyOp.Kick, 'bob')).toBe(PartyReason.NotInParty);
  });

  it('a disconnect is a leave and drops the invites sent and received', () => {
    const r = formed(3);
    r.cmd(1, PartyOp.Invite, 'dave');
    r.cmd(5, PartyOp.Invite, 'frank');
    r.party.leave(1); // the leader's connection closes
    expect(r.party.leaderOf(2)).toBe(2);
    expect(r.cmd(4, PartyOp.Accept, 'alice')).toBe(PartyReason.NoInvite);
    r.party.leave(6); // frank
    r.party.join({ entityId: 6, accountId: 'acc-frank', name: 'frank', classId: 6 }); // a new session
    expect(r.cmd(6, PartyOp.Accept, 'erin')).toBe(PartyReason.NoInvite);
    r.party.leave(2);
    r.party.leave(3);
    expect(r.party.partyCount).toBe(0);
  });
});

describe('vitals', () => {
  it('sent every PARTY.VITALS_EVERY_TICKS ticks, and only when something changed', () => {
    const r = formed(2);
    r.got.clear();
    r.party.tick(5000, 1); // not a vitals tick
    expect(r.got.size).toBe(0);
    r.party.tick(5000, PARTY.VITALS_EVERY_TICKS);
    for (const id of [1, 2]) {
      expect(r.last(id, 'party_vitals')).toEqual({
        type: 'party_vitals',
        members: [
          { entityId: 1, hp: 100, hpMax: 100, mp: 50, mpMax: 50 },
          { entityId: 2, hp: 100, hpMax: 100, mp: 50, mpMax: 50 },
        ],
      });
    }
    r.got.clear();
    r.party.tick(5200, PARTY.VITALS_EVERY_TICKS * 2);
    expect(r.got.size).toBe(0); // nothing changed
    r.vitals.get(2)!.hp = 40;
    r.party.tick(5400, PARTY.VITALS_EVERY_TICKS * 3);
    expect((r.last(1, 'party_vitals') as PartyVitalsMsg).members[1]!.hp).toBe(40);
    expect(r.got.get(2)).toHaveLength(1);
  });

  it('a roster change forces a fresh vitals pass (a newcomer must see everyone)', () => {
    const r = formed(2);
    r.party.tick(5000, PARTY.VITALS_EVERY_TICKS);
    r.cmd(1, PartyOp.Invite, 'carol', 6000);
    r.cmd(3, PartyOp.Accept, 'alice', 6000);
    r.got.clear();
    r.party.tick(6100, PARTY.VITALS_EVERY_TICKS * 2);
    expect((r.last(3, 'party_vitals') as PartyVitalsMsg).members).toHaveLength(3);
  });

  it('vitals never leak outside the party', () => {
    const r = formed(2);
    r.party.tick(5000, PARTY.VITALS_EVERY_TICKS);
    expect(r.got.has(3)).toBe(false);
  });
});

// ------------------------------------------------------------------ the WorldNode, over the binary protocol
class Fake implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  send(d: Uint8Array): void {
    this.msgs.push(decode(d));
  }
  close(code: ErrorCode, text: string): void {
    this.closed = { code, text };
  }
  buffered(): number {
    return 0;
  }
  of<T extends Message['type']>(type: T): Extract<Message, { type: T }>[] {
    return this.msgs.filter((m): m is Extract<Message, { type: T }> => m.type === type);
  }
}
function world(party: PartyService | null = new PartyService(), chat: ChatService | null = new ChatService()) {
  const n = new WorldNode({
    mapTiles: 160,
    spawn: { i0: 78, j0: 78, side: 4 },
    ...(party ? { party } : {}),
    ...(chat ? { chat } : {}),
  });
  const mk = (account: string, name: string) => {
    const t = new Fake();
    const id = n.addPlayer(t, account, undefined, name);
    return { t, id };
  };
  const send = (p: { t: Fake; id: number }, m: Parameters<typeof encode>[0]) => n.receive(p.id, encode(m), p.t);
  const cmd = (p: { t: Fake; id: number }, op: PartyOp, name = '', clientMsgId = 1) =>
    send(p, { type: 'party_cmd', op, clientMsgId, name });
  return { n, mk, send, cmd };
}

describe('party over the wire (WorldNode)', () => {
  it('invite, accept, party chat, vitals, leave: every command is answered, roster and chat reach exactly the members', () => {
    const w = world();
    const a = w.mk('acc-a', 'alice');
    const b = w.mk('acc-b', 'bob');
    const c = w.mk('acc-c', 'carol');

    w.cmd(a, PartyOp.Invite, 'bob', 11);
    expect(a.t.of('party_result')).toEqual([{ type: 'party_result', clientMsgId: 11, reason: PartyReason.Ok }]);
    expect(b.t.of('party_invite')).toEqual([{ type: 'party_invite', fromName: 'alice', ttlMs: PARTY.INVITE_TTL_MS }]);
    w.cmd(b, PartyOp.Accept, 'alice', 12);
    expect(b.t.of('party_result').at(-1)).toMatchObject({ clientMsgId: 12, reason: PartyReason.Ok });
    for (const p of [a, b]) {
      expect(p.t.of('party_state').at(-1)).toMatchObject({
        leaderId: a.id,
        members: [{ entityId: a.id }, { entityId: b.id }],
      });
    }
    expect(c.t.of('party_state')).toEqual([]);

    // party chat: members only; a non-member is refused with NotInParty
    w.send(a, { type: 'chat_send', channel: ChatChannel.Party, clientMsgId: 21, target: '', text: 'pull left' });
    expect(a.t.of('chat_result').at(-1)).toMatchObject({ clientMsgId: 21, reason: ChatReason.Ok });
    expect(a.t.of('chat_msg').map((m) => m.text)).toEqual(['pull left']);
    expect(b.t.of('chat_msg')).toMatchObject([{ channel: ChatChannel.Party, senderName: 'alice', text: 'pull left' }]);
    expect(c.t.of('chat_msg')).toEqual([]);
    w.send(c, { type: 'chat_send', channel: ChatChannel.Party, clientMsgId: 22, target: '', text: 'let me in' });
    expect(c.t.of('chat_result').at(-1)).toMatchObject({ clientMsgId: 22, reason: ChatReason.NotInParty });

    // vitals arrive on a tick, with the real hp / mp of the entities
    for (let k = 0; k < PARTY.VITALS_EVERY_TICKS; k++) w.n.tick();
    const v = b.t.of('party_vitals').at(-1)!;
    expect(v.members.map((m) => m.entityId)).toEqual([a.id, b.id]);
    expect(v.members.every((m) => m.hpMax > 0 && m.hp > 0)).toBe(true);
    expect(c.t.of('party_vitals')).toEqual([]);

    w.cmd(b, PartyOp.Leave, '', 31);
    expect(b.t.of('party_result').at(-1)).toMatchObject({ clientMsgId: 31, reason: PartyReason.Ok });
    expect(a.t.of('party_state').at(-1)).toEqual({ type: 'party_state', leaderId: 0, members: [] });
  });

  it('removing a player (disconnect) takes them out of the party', () => {
    const w = world();
    const a = w.mk('acc-a', 'alice');
    const b = w.mk('acc-b', 'bob');
    const c = w.mk('acc-c', 'carol');
    w.cmd(a, PartyOp.Invite, 'bob');
    w.cmd(b, PartyOp.Accept, 'alice');
    w.cmd(a, PartyOp.Invite, 'carol', 2);
    w.cmd(c, PartyOp.Accept, '', 2);
    w.n.removePlayer(a.id, a.t);
    expect(b.t.of('party_state').at(-1)).toMatchObject({
      leaderId: b.id,
      members: [{ entityId: b.id }, { entityId: c.id }],
    });
    expect(w.n.party!.leaderOf(c.id)).toBe(b.id);
  });

  it('a node without a party module rejects party commands like any unexpected message', () => {
    const w = world(null);
    const a = w.mk('acc-a', 'alice');
    w.cmd(a, PartyOp.Leave);
    expect(a.t.of('error')).toMatchObject([{ code: ErrorCode.BadMessage }]);
    expect(a.t.of('party_result')).toEqual([]);
  });
});

// ------------------------------------------------------------------ shared kill credit (personal loot, docs/07 §6)
const MOB = 1_000_001;
class OneMob implements MobPort {
  killed: number[] = [];
  combatStats(id: number): MobCombatStats | undefined {
    if (this.killed.includes(id)) return undefined;
    return { defense: 40, realm: 1, element: 'moc', dropSource: 'field', hpMax: 3000 };
  }
  kill(w: SimWorld, id: number): SimWorld {
    this.killed.push(id);
    return { ...w, entities: w.entities.filter((e) => e.id !== id) };
  }
}

function killRig(group: (killer: number) => readonly number[], playerIds = [1, 2, 3]) {
  const ctx: SimContext = {
    grid: TileGrid.fromRows(Array.from({ length: 64 }, () => '.'.repeat(64))),
    skills: compileSkills(),
  };
  const credited: Array<{ killerId: number; rolls: DropRoll[] }> = [];
  const combat = new CombatSystem(ctx, {
    seed: 3,
    mobs: new OneMob(),
    partyOf: group,
    onDrops: (d) => credited.push({ killerId: d.killerId, rolls: [...d.rolls] }),
  });
  let w = createWorld(3);
  for (const id of playerIds) {
    const st = combat.addPlayer(id, 'kiem');
    w = spawnEntity(w, { id, i: 20.5, j: 20.5, hp: st.hpMax, mpMax: st.mpMax, facing: 0 });
  }
  w = spawnEntity(w, { id: MOB, i: 22.5, j: 20.5, hp: 1, mpMax: 0 });
  const skillId = ctx.skills.find((s) => s.key === 'kiem_khi_tram')!.id;
  const input = [{ kind: 'cast', entityId: 1, seq: 1, skillId, targetId: 0, rttMs: 0, aim: null }] as never;
  let first = true;
  const run = () => {
    for (let k = 0; k < 12; k++) {
      const pre = combat.preStep(first ? input : [], w);
      first = false;
      const s = step(w, pre.inputs, ctx, NETWORK.TICK_MS);
      w = combat.postStep(s.world, s.events).world;
    }
  };
  return { credited, run };
}

describe('shared kill credit (D93 placeholder: every member in range rolls separately, x 1/sqrt(n))', () => {
  it('without a party the killer alone rolls with partySize 1 (the solo roll is unchanged)', () => {
    const r = killRig((id) => [id]);
    r.run();
    expect(r.credited.map((c) => c.killerId)).toEqual([1]);
  });

  it('the group rolls once each, in ascending id order, from the same drop stream, with partySize = group size', () => {
    const r = killRig(() => [3, 1, 2]);
    r.run();
    expect(r.credited.map((c) => c.killerId)).toEqual([1, 2, 3]);
    let st = rngFork(rngSeed(3), 'drop');
    const rng = () => {
      const [v, n] = rngFloat(st);
      st = n;
      return v;
    };
    const expected = [1, 2, 3].map(() =>
      resolveDrops({ source: 'field', monsterRealm: 1, realmGap: 0, partySize: 3 }, rng),
    );
    expect(r.credited.map((c) => c.rolls)).toEqual(expected);
  });

  it('a member that is not registered in combat is skipped, and the group size counts only who is credited', () => {
    const r = killRig(() => [1, 2, 99], [1, 2]);
    r.run();
    expect(r.credited.map((c) => c.killerId)).toEqual([1, 2]);
  });

  it('through the WorldNode: only members alive and within SHARE_RANGE_TILES of the killer share the kill', () => {
    const party = new PartyService();
    const seen: number[] = [];
    const n = new WorldNode({
      seed: 5,
      mapTiles: 64,
      spawn: { i0: 20, j0: 20, side: 1 },
      party,
      combat: { mobs: new OneMob(), onDrops: (d) => seen.push(d.killerId) },
    });
    // these transports never decode: the test teleports an entity, which a delta-decoding client would (rightly) reject
    const mk = (acct: string, name: string) => {
      const t = new Fake();
      t.send = () => undefined;
      return { t, id: n.addPlayer(t, acct, undefined, name) };
    };
    const a = mk('acc-a', 'alice');
    const b = mk('acc-b', 'bob');
    const c = mk('acc-c', 'carol');
    const send = (p: { t: Fake; id: number }, m: Parameters<typeof encode>[0]) => n.receive(p.id, encode(m), p.t);
    send(a, { type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 1, name: 'bob' });
    send(b, { type: 'party_cmd', op: PartyOp.Accept, clientMsgId: 1, name: 'alice' });
    send(a, { type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 2, name: 'carol' });
    send(c, { type: 'party_cmd', op: PartyOp.Accept, clientMsgId: 2, name: 'alice' });
    // carol is far away; bob is next to alice
    n.world = {
      ...n.world,
      entities: n.world.entities.map((e) => (e.id === c.id ? { ...e, i: e.i + PARTY.SHARE_RANGE_TILES + 5 } : e)),
    };
    n.tick(); // refresh the per-tick index of entities
    const killer = n.world.entities.find((e) => e.id === a.id)!;
    n.world = spawnEntity(n.world, { id: MOB, i: killer.i + 1.5, j: killer.j, hp: 1, mpMax: 0 });
    n.world = { ...n.world, entities: n.world.entities.map((e) => (e.id === a.id ? { ...e, facing: 0 } : e)) };
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    send(a, { type: 'skill_cast', seq: 1, skillId: kiem.id, targetId: 0, aim: null });
    for (let k = 0; k < 14; k++) n.tick();
    expect([...new Set(seen)].sort((x, y) => x - y)).toEqual([a.id, b.id].sort((x, y) => x - y));
  });
});
