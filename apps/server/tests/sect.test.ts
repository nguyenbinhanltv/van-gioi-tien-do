/**
 * SectService (D98): join / leave at the NPC, Cống hiến through the double-entry ledger (kill rewards, purchases, idempotency, never
 * negative), the library per class, persistence, and the rate limit.
 */
import { describe, expect, it } from 'vitest';
import { SECT, skillDefinitions } from '@vgtd/shared';
import { SectOp, SectReason, type SectServerMessage, type SectStateMsg } from '@vgtd/protocol';
import {
  InMemorySectStore,
  Ledger,
  SECT_CONFIG,
  SectService,
  libraryOf,
  manualPrice,
  type SectStore,
} from '../src/index.js';

const NPC = { i: 50, j: 50 };
const NEAR = { i: 52, j: 51 };
const FAR = { i: 50 + SECT.NPC_RANGE_TILES + 1, j: 50 };

interface Rig {
  svc: SectService;
  ledger: Ledger;
  store: InMemorySectStore;
  pos: Map<number, { i: number; j: number }>;
  got: Map<number, SectServerMessage[]>;
  cmd(entity: number, op: number, manual?: number, now?: number): SectReason;
  /** flush and return the LAST state each entity got */
  flush(): Map<number, SectStateMsg>;
}

function rig(store: InMemorySectStore = new InMemorySectStore(), ledger: Ledger = new Ledger()): Rig {
  const svc = new SectService({ ledger, store, npc: NPC });
  const pos = new Map<number, { i: number; j: number }>([
    [1, NEAR],
    [2, NEAR],
  ]);
  const got = new Map<number, SectServerMessage[]>();
  svc.attach({
    deliver: (id, m) => {
      const l = got.get(id) ?? [];
      l.push(m);
      got.set(id, l);
    },
    posOf: (id) => pos.get(id),
    defaultNpc: { i: 0, j: 0 },
  });
  svc.join({ entityId: 1, accountId: 'acc-alice', path: 'kiem' });
  svc.join({ entityId: 2, accountId: 'acc-bob', path: 'phap' });
  svc.tick();
  got.clear();
  let id = 0;
  let clock = 100_000;
  return {
    svc,
    ledger,
    store,
    pos,
    got,
    cmd(entity, op, manual = 0, now = (clock += 2 * SECT_CONFIG.RATE.refillMs)) {
      return svc.handle(entity, { type: 'sect_cmd', op, clientMsgId: ++id, manual }, now).reason;
    },
    flush() {
      svc.tick();
      const last = new Map<number, SectStateMsg>();
      for (const [e, list] of got) for (const m of list) if (m.type === 'sect_state') last.set(e, m);
      got.clear();
      return last;
    },
  };
}
const ALICE = 1;
const BOB = 2;
let killNo = 0;
/** n kills by `account` of the given source, each with its own key */
const kills = (r: Rig, account: string, n: number, source: 'field' | 'elite' | 'boss' = 'field'): void => {
  for (let k = 0; k < n; k++) r.svc.onKill(account, source, `mob${++killNo}@${killNo}`);
};
const balance = (r: Rig, account: string): bigint => r.svc.contribution(account);

describe('join / leave at the NPC', () => {
  it('join needs the NPC close by, then makes the account a member; the state says so and where the NPC stands', () => {
    const r = rig();
    r.pos.set(ALICE, FAR);
    expect(r.cmd(ALICE, SectOp.Join)).toBe(SectReason.TooFar);
    expect(r.svc.isMember('acc-alice')).toBe(false);
    r.pos.set(ALICE, NEAR);
    expect(r.cmd(ALICE, SectOp.Join)).toBe(SectReason.Ok);
    expect(r.svc.isMember('acc-alice')).toBe(true);
    expect(r.cmd(ALICE, SectOp.Join)).toBe(SectReason.AlreadyMember);
    const s = r.flush().get(ALICE)!;
    expect(s).toMatchObject({ member: true, contribution: 0, npcQi: NPC.i * 32, npcQj: NPC.j * 32 });
    expect(r.flush().has(BOB)).toBe(false); // somebody else's membership is not broadcast
  });

  it('leave needs the NPC too and a membership; it keeps the balance and the manuals but stops earning and buying', () => {
    const r = rig();
    expect(r.cmd(ALICE, SectOp.Leave)).toBe(SectReason.NotMember);
    r.cmd(ALICE, SectOp.Join);
    kills(r, 'acc-alice', 3, 'boss'); // 75 CH
    expect(r.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.Ok); // 60
    r.pos.set(ALICE, FAR);
    expect(r.cmd(ALICE, SectOp.Leave)).toBe(SectReason.TooFar);
    r.pos.set(ALICE, NEAR);
    expect(r.cmd(ALICE, SectOp.Leave)).toBe(SectReason.Ok);
    expect(r.svc.isMember('acc-alice')).toBe(false);
    expect(balance(r, 'acc-alice')).toBe(15n);
    expect(r.svc.owns('acc-alice', libraryOf('kiem')[0]!.skillId)).toBe(true);
    kills(r, 'acc-alice', 5, 'boss'); // no longer a member: nothing earned
    expect(balance(r, 'acc-alice')).toBe(15n);
    expect(r.cmd(ALICE, SectOp.Buy, 1)).toBe(SectReason.NotMember);
    // coming back restores everything
    r.cmd(ALICE, SectOp.Join);
    expect(balance(r, 'acc-alice')).toBe(15n);
    expect(r.flush().get(ALICE)!.library[0]!.owned).toBe(true);
  });
});

describe('Cống hiến from kills goes through the ledger', () => {
  it('only members earn, at the rate of the drop source; every credit is a balanced transaction from the sect faucet', () => {
    const r = rig();
    kills(r, 'acc-alice', 4, 'boss'); // not a member
    expect(balance(r, 'acc-alice')).toBe(0n);
    expect(r.ledger.entries).toHaveLength(0);
    r.cmd(ALICE, SectOp.Join);
    kills(r, 'acc-alice', 2, 'field');
    kills(r, 'acc-alice', 2, 'elite');
    kills(r, 'acc-alice', 1, 'boss');
    const expected = 2 * SECT.KILL_REWARD.field + 2 * SECT.KILL_REWARD.elite + SECT.KILL_REWARD.boss;
    expect(balance(r, 'acc-alice')).toBe(BigInt(expected));
    expect(r.ledger.reconcile()).toEqual([]); // I1 (each tx sums to 0) and I3 (balances = entries)
    const faucet = r.ledger.snapshot().accounts.find((a) => a.key.startsWith('SYSTEM_FAUCET_SECT_KILL'))!;
    expect(BigInt(faucet.balance)).toBe(-BigInt(expected)); // the value came FROM the faucet, nothing was minted
    expect(r.svc.metrics.earned).toBe(expected);
  });

  it('a repeated kill event (same key) replays instead of paying twice', () => {
    const r = rig();
    r.cmd(ALICE, SectOp.Join);
    r.svc.onKill('acc-alice', 'boss', 'mob7@100');
    r.svc.onKill('acc-alice', 'boss', 'mob7@100');
    r.svc.onKill('acc-alice', 'boss', 'mob7@100');
    expect(balance(r, 'acc-alice')).toBe(BigInt(SECT.KILL_REWARD.boss));
    r.svc.onKill('acc-alice', 'boss', 'mob8@100'); // another kill pays again
    expect(balance(r, 'acc-alice')).toBe(BigInt(2 * SECT.KILL_REWARD.boss));
  });

  it('a kill streak in one tick is ONE sect_state, with the new balance', () => {
    const r = rig();
    r.cmd(ALICE, SectOp.Join);
    r.flush();
    kills(r, 'acc-alice', 6, 'elite');
    r.svc.tick();
    expect(r.got.get(ALICE)).toHaveLength(1);
    expect((r.got.get(ALICE)![0] as SectStateMsg).contribution).toBe(6 * SECT.KILL_REWARD.elite);
  });
});

describe('the library', () => {
  it('lists the class "tome" skills of the data with price = level x SECT.MANUAL_PRICE_PER_LEVEL, and differs per class', () => {
    const kiem = libraryOf('kiem');
    const phap = libraryOf('phap');
    expect(kiem).toHaveLength(5);
    expect(phap).toHaveLength(5);
    const tome = skillDefinitions.skills.filter((s) => s.path === 'kiem' && s.unlock.source === 'tome');
    expect(kiem.map((m) => m.skillId)).toEqual(tome.map((s) => s.id));
    for (const m of kiem) expect(m.price).toBe(manualPrice(m.levelMin));
    expect(kiem.map((m) => m.price)).toEqual(kiem.map((m) => m.levelMin * SECT.MANUAL_PRICE_PER_LEVEL));
    expect(kiem[0]!.skillId).not.toBe(phap[0]!.skillId);
    // level-learned skills are not for sale
    expect(kiem.every((m) => skillDefinitions.skills.find((s) => s.id === m.skillId)!.unlock.source === 'tome')).toBe(
      true,
    );
  });

  it('buying: not enough Cống hiến changes nothing; enough pays the price once, unlocks the manual and the sink gets the value', () => {
    const r = rig();
    r.cmd(ALICE, SectOp.Join);
    const m0 = libraryOf('kiem')[0]!;
    expect(r.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.NotEnoughContribution);
    expect(r.svc.owns('acc-alice', m0.skillId)).toBe(false);
    expect(r.ledger.entries).toHaveLength(0);
    kills(r, 'acc-alice', 3, 'boss'); // 75
    const before = r.ledger.entries.length;
    expect(r.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.Ok);
    expect(balance(r, 'acc-alice')).toBe(BigInt(75 - m0.price));
    expect(r.svc.owns('acc-alice', m0.skillId)).toBe(true);
    expect(r.ledger.entries.length).toBe(before + 2); // exactly one balanced debit / credit pair
    const sinkRow = r.ledger.snapshot().accounts.find((a) => a.key.startsWith('SYSTEM_SINK_SECT_LIBRARY'))!;
    expect(BigInt(sinkRow.balance)).toBe(BigInt(m0.price));
    expect(r.ledger.reconcile()).toEqual([]);
    // the second purchase of the same manual is refused and costs nothing
    const bal = balance(r, 'acc-alice');
    expect(r.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.AlreadyOwned);
    expect(balance(r, 'acc-alice')).toBe(bal);
    const s = r.flush().get(ALICE)!;
    expect(s.library[0]).toMatchObject({ owned: true, price: m0.price });
    expect(s.library[1]!.owned).toBe(false);
    expect(s.contribution).toBe(Number(bal));
  });

  it('the balance never goes below zero: spending everything leaves exactly 0, one more is refused', () => {
    const r = rig();
    r.cmd(ALICE, SectOp.Join);
    const lib = libraryOf('kiem');
    const total = lib.reduce((n, m) => n + m.price, 0);
    kills(r, 'acc-alice', total, 'field'); // 1 CH per field kill
    for (let k = 0; k < lib.length; k++) expect(r.cmd(ALICE, SectOp.Buy, k)).toBe(SectReason.Ok);
    expect(balance(r, 'acc-alice')).toBe(0n);
    expect(r.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.AlreadyOwned);
    expect(r.ledger.reconcile()).toEqual([]);
    expect(
      r.ledger.snapshot().accounts.every((a) => !a.key.startsWith('PLAYER_WALLET') || BigInt(a.balance) >= 0n),
    ).toBe(true);
  });

  it('refuses a manual that is not in the library, and everything for a non-member or a character without a class', () => {
    const r = rig();
    expect(r.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.NotMember);
    r.cmd(ALICE, SectOp.Join);
    expect(r.cmd(ALICE, SectOp.Buy, 5)).toBe(SectReason.NoSuchManual);
    expect(r.cmd(ALICE, SectOp.Buy, 7)).toBe(SectReason.NoSuchManual);
    r.svc.join({ entityId: 9, accountId: 'acc-classless', path: undefined });
    r.pos.set(9, NEAR);
    r.cmd(9, SectOp.Join);
    expect(r.cmd(9, SectOp.Buy, 0)).toBe(SectReason.NoSuchManual);
    expect(r.svc.stateOf('acc-classless', undefined).library).toEqual([]);
  });

  it('each class buys its own manuals: the same index is a different skill, and one account never owns another’s', () => {
    const r = rig();
    r.cmd(ALICE, SectOp.Join);
    r.cmd(BOB, SectOp.Join);
    kills(r, 'acc-alice', 3, 'boss');
    kills(r, 'acc-bob', 3, 'boss');
    r.cmd(ALICE, SectOp.Buy, 0);
    r.cmd(BOB, SectOp.Buy, 0);
    expect(r.svc.owns('acc-alice', libraryOf('kiem')[0]!.skillId)).toBe(true);
    expect(r.svc.owns('acc-bob', libraryOf('phap')[0]!.skillId)).toBe(true);
    expect(r.svc.owns('acc-alice', libraryOf('phap')[0]!.skillId)).toBe(false);
  });
});

describe('the rate limit is taken first', () => {
  it('rapid commands end in RateLimited even from far away (the token is spent before the NPC check)', () => {
    const r = rig();
    r.pos.set(ALICE, FAR);
    const burst = SECT_CONFIG.RATE.burst;
    const answers = Array.from({ length: burst + 3 }, () => r.cmd(ALICE, SectOp.Join, 0, 0));
    expect(answers.slice(0, burst).every((a) => a === SectReason.TooFar)).toBe(true);
    expect(answers.slice(burst).every((a) => a === SectReason.RateLimited)).toBe(true);
    expect(r.cmd(BOB, SectOp.Join, 0, 0)).toBe(SectReason.Ok); // per account
    expect(r.cmd(77, SectOp.Join)).toBe(SectReason.NotReady); // an entity that never joined
  });
});

describe('persistence', () => {
  it('membership, bought manuals and the ledger balance survive a restart; presence and rewards keys do not matter', () => {
    const store = new InMemorySectStore();
    const a = rig(store);
    a.cmd(ALICE, SectOp.Join);
    kills(a, 'acc-alice', 4, 'boss');
    a.cmd(ALICE, SectOp.Buy, 0);
    const snap = a.ledger.snapshot();
    expect(store.saves).toBeGreaterThan(0);
    // a "restart": the ledger from its snapshot (D92 file), the sect state from its store
    const b = rig(store, Ledger.restore(snap));
    expect(b.svc.isMember('acc-alice')).toBe(true);
    expect(b.svc.owns('acc-alice', libraryOf('kiem')[0]!.skillId)).toBe(true);
    expect(balance(b, 'acc-alice')).toBe(balance(a, 'acc-alice'));
    expect(b.cmd(ALICE, SectOp.Buy, 0)).toBe(SectReason.AlreadyOwned);
    // the first kill key after the restart pays again (kill keys only guard one process lifetime)
    b.svc.onKill('acc-alice', 'boss', 'mob1@1');
    expect(balance(b, 'acc-alice')).toBe(balance(a, 'acc-alice') + BigInt(SECT.KILL_REWARD.boss));
  });

  it('the snapshot is ids only and deterministic (no names, no balances: those are the ledger’s)', () => {
    const r = rig();
    r.cmd(BOB, SectOp.Join);
    r.cmd(ALICE, SectOp.Join);
    kills(r, 'acc-alice', 3, 'boss');
    r.cmd(ALICE, SectOp.Buy, 0);
    expect(r.svc.snapshot()).toEqual({
      members: ['acc-alice', 'acc-bob'],
      manuals: [['acc-alice', libraryOf('kiem')[0]!.skillId]],
    });
  });

  it('unknown store content is just ignored when empty, and the service starts with no members', () => {
    const empty: SectStore = { load: () => undefined, save: () => undefined };
    const svc = new SectService({ ledger: new Ledger(), store: empty, npc: NPC });
    expect(svc.isMember('x')).toBe(false);
    expect(svc.snapshot()).toEqual({ members: [], manuals: [] });
  });
});

describe('in-game currency only', () => {
  it('the wire state carries a balance, a library of names / levels / prices in Cống hiến, and the NPC position: no money fields', () => {
    const r = rig();
    r.cmd(ALICE, SectOp.Join);
    const s = r.flush().get(ALICE)!;
    expect(Object.keys(s).sort()).toEqual(['contribution', 'library', 'member', 'npcQi', 'npcQj', 'type']);
    for (const e of s.library) expect(Object.keys(e).sort()).toEqual(['levelMin', 'name', 'owned', 'price']);
    expect(SECT.CURRENCY).toBe('CONG_HIEN');
  });
});
