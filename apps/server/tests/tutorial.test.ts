import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  TUTORIAL,
  TUTORIAL_FLAG_COMPLETE,
  TUTORIAL_FLAG_SKIPPED,
  TUTORIAL_REQUIRED_MASK,
  TUTORIAL_STEPS,
  fieldBandStart,
  FIRST_SESSION,
  tutorialBit,
  type TutorialStepId,
} from '@vgtd/shared';
import { ChatChannel, ErrorCode, PartyOp, decode, encode, type Message } from '@vgtd/protocol';
import { compileSkills, spawnEntity } from '@vgtd/sim';
import {
  FileTutorialStore,
  InMemoryTutorialStore,
  PartyService,
  TutorialService,
  WorldNode,
  type ClientTransport,
  type MobCombatStats,
  type MobPort,
} from '../src/index.js';
import type { SimWorld } from '@vgtd/sim';

const MAP = 256;
const done = (svc: TutorialService, id: number): TutorialStepId[] => {
  const m = svc.stateOf(id)!;
  return TUTORIAL_STEPS.filter((s) => (m.done & tutorialBit(s)) !== 0);
};
const finishRequired = (svc: TutorialService, id: number): void => {
  svc.observe(id, 100, 100);
  svc.observe(id, 100 + TUTORIAL.moveTiles, 100);
  svc.observe(id, MAP / 2 + MAP, MAP / 2); // far out: the field band
  svc.note(id, 'skill');
  for (let k = 0; k < TUTORIAL.killTarget; k++) svc.note(id, 'kill');
  svc.note(id, 'loot');
  svc.note(id, 'meditate');
  svc.note(id, 'breakthrough');
};

describe('step order and masks', () => {
  it('has the required steps first (wire-stable order) and the tips after', () => {
    expect([...TUTORIAL_STEPS]).toEqual([
      'move',
      'field',
      'skill',
      'kills',
      'loot',
      'meditate',
      'breakthrough',
      'item',
      'chat',
      'party',
    ]);
    expect(TUTORIAL_REQUIRED_MASK).toBe(0b1111111);
    expect(TUTORIAL.killTarget).toBe(FIRST_SESSION.killTarget);
  });
});

describe('TutorialService: the server decides every step', () => {
  it('a joining player gets one state (nothing done), then nothing more until something changes', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.join(1, 'acc-1');
    expect(svc.drain()).toEqual([{ entityId: 1, msg: { type: 'tutorial_state', done: 0, kills: 0, flags: 0 } }]);
    expect(svc.drain()).toEqual([]);
    svc.note(1, 'chat');
    expect(svc.drain()).toHaveLength(1);
    expect(svc.drain()).toEqual([]);
  });

  it('move needs TUTORIAL.moveTiles from where the session started; field needs the field band', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.join(1, 'a');
    svc.observe(1, 120, 120);
    svc.observe(1, 120 + TUTORIAL.moveTiles - 0.5, 120);
    expect(done(svc, 1)).toEqual([]);
    svc.observe(1, 120 + TUTORIAL.moveTiles, 120);
    expect(done(svc, 1)).toEqual(['move']);
    const edge = MAP / 2 + fieldBandStart(MAP) + FIRST_SESSION.fieldMarginTiles;
    svc.observe(1, MAP / 2, edge - 0.5);
    expect(done(svc, 1)).toEqual(['move']);
    svc.observe(1, MAP / 2, edge);
    expect(done(svc, 1)).toEqual(['move', 'field']);
  });

  it('kills count one by one and finish at the target (never past it)', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.join(1, 'a');
    for (let k = 1; k < TUTORIAL.killTarget; k++) {
      svc.note(1, 'kill');
      expect(svc.stateOf(1)).toMatchObject({ kills: k, done: 0 });
    }
    svc.note(1, 'kill');
    svc.note(1, 'kill');
    expect(svc.stateOf(1)).toMatchObject({ kills: TUTORIAL.killTarget });
    expect(done(svc, 1)).toEqual(['kills']);
  });

  it('completes when every required step is done, in any order; the tips never block it', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.join(1, 'a');
    svc.note(1, 'breakthrough');
    svc.note(1, 'meditate');
    svc.note(1, 'loot');
    expect(svc.stateOf(1)!.flags & TUTORIAL_FLAG_COMPLETE).toBe(0);
    svc.note(1, 'skill');
    for (let k = 0; k < TUTORIAL.killTarget; k++) svc.note(1, 'kill');
    svc.observe(1, MAP / 2, MAP / 2); // the centre: not the field band
    svc.observe(1, MAP / 2 + TUTORIAL.moveTiles, MAP / 2);
    expect(svc.stateOf(1)!.flags & TUTORIAL_FLAG_COMPLETE).toBe(0); // field is still missing
    svc.observe(1, MAP, MAP);
    expect(svc.stateOf(1)!.flags & TUTORIAL_FLAG_COMPLETE).toBe(TUTORIAL_FLAG_COMPLETE);
    expect(done(svc, 1)).not.toContain('item');
    svc.note(1, 'item');
    svc.note(1, 'chat');
    svc.note(1, 'party');
    expect(done(svc, 1)).toEqual([...TUTORIAL_STEPS]);
  });

  it('skip is idempotent, keeps recording progress, and is reported in the flags', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.join(1, 'a');
    svc.drain();
    svc.skip(1);
    svc.skip(1);
    expect(svc.drain()).toEqual([
      { entityId: 1, msg: { type: 'tutorial_state', done: 0, kills: 0, flags: TUTORIAL_FLAG_SKIPPED } },
    ]);
    finishRequired(svc, 1);
    expect(svc.stateOf(1)!.flags).toBe(TUTORIAL_FLAG_SKIPPED | TUTORIAL_FLAG_COMPLETE);
  });

  it('events for a player who is not in a session are ignored (no crash, no record)', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.note(9, 'kill');
    svc.observe(9, 1, 1);
    svc.skip(9);
    expect(svc.stateOf(9)).toBeUndefined();
    expect(svc.funnel().accounts).toBe(0);
  });

  it('progress survives leaving and joining again (same account, new entity id), and counts sessions', () => {
    const store = new InMemoryTutorialStore();
    const a = new TutorialService({ mapTiles: MAP, store });
    a.join(1, 'acc');
    a.note(1, 'skill');
    a.note(1, 'kill');
    a.note(1, 'kill');
    a.leave(1);
    const b = new TutorialService({ mapTiles: MAP, store }); // a "restart": a new service over the same store
    b.join(7, 'acc');
    expect(b.stateOf(7)).toMatchObject({ kills: 2 });
    expect(done(b, 7)).toEqual(['skill']);
    expect(store.load('acc')!.sessions).toBe(2);
    b.note(7, 'kill');
    expect(done(b, 7)).toEqual(['skill', 'kills']);
  });

  it('local counters: the funnel counts accounts, completions, skips, steps and sessions (nothing is emitted anywhere)', () => {
    const svc = new TutorialService({ mapTiles: MAP });
    svc.join(1, 'a');
    svc.join(2, 'b');
    svc.join(3, 'c');
    finishRequired(svc, 1);
    svc.note(2, 'chat');
    svc.skip(2);
    svc.leave(3);
    svc.join(4, 'c');
    const f = svc.funnel();
    expect(f).toMatchObject({ accounts: 3, completed: 1, skipped: 1, sessions: 4 });
    expect(f.completionRate).toBeCloseTo(1 / 3);
    expect(f.byStep.move).toBe(1);
    expect(f.byStep.breakthrough).toBe(1);
    expect(f.byStep.chat).toBe(1);
    expect(f.byStep.party).toBe(0);
    expect(new TutorialService({ mapTiles: MAP }).funnel()).toMatchObject({ accounts: 0, completionRate: 0 });
  });
});

// ------------------------------------------------------------------ the WorldNode, over the binary protocol
class Fake implements ClientTransport {
  msgs: Message[] = [];
  closed: { code: ErrorCode; text: string } | null = null;
  send(d: Uint8Array): void {
    try {
      this.msgs.push(decode(d));
    } catch {
      /* a snapshot after a test teleport: not what these tests look at */
    }
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
function world(opts: { tutorial?: TutorialService | null; combat?: boolean; party?: boolean } = {}) {
  const tutorial = opts.tutorial === null ? undefined : (opts.tutorial ?? new TutorialService({ mapTiles: 160 }));
  const n = new WorldNode({
    mapTiles: 160,
    spawn: { i0: 78, j0: 78, side: 4 },
    ...(tutorial ? { tutorial } : {}),
    ...(opts.party ? { party: new PartyService() } : {}),
    ...(opts.combat ? { combat: { mobs: new OneMob() } } : {}),
  });
  const mk = (account: string, name = account) => {
    const t = new Fake();
    return { t, id: n.addPlayer(t, account, undefined, name) };
  };
  const send = (p: { t: Fake; id: number }, m: Parameters<typeof encode>[0]) => n.receive(p.id, encode(m), p.t);
  return { n, mk, send, tutorial };
}
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

describe('tutorial over the wire (WorldNode)', () => {
  it('a joining client gets its state on the first tick; skip is answered with a fresh state', () => {
    const w = world();
    const a = w.mk('acc-a');
    expect(a.t.of('tutorial_state')).toEqual([]);
    w.n.tick();
    expect(a.t.of('tutorial_state')).toEqual([{ type: 'tutorial_state', done: 0, kills: 0, flags: 0 }]);
    w.send(a, { type: 'tutorial_skip' });
    w.n.tick();
    expect(a.t.of('tutorial_state').at(-1)).toEqual({
      type: 'tutorial_state',
      done: 0,
      kills: 0,
      flags: TUTORIAL_FLAG_SKIPPED,
    });
    w.n.tick();
    expect(a.t.of('tutorial_state')).toHaveLength(2); // nothing changed: nothing sent
  });

  it('chat and party steps come from what the server accepted, not from a client report', () => {
    const w = world({ party: true });
    const a = w.mk('acc-a', 'alice');
    const b = w.mk('acc-b', 'bob');
    w.n.tick();
    w.send(a, { type: 'chat_send', channel: ChatChannel.World, clientMsgId: 1, target: '', text: 'hi' });
    w.n.tick();
    // no chat module on this node: the line is refused, so the step is NOT done
    expect(w.n.tutorial!.stateOf(a.id)!.done & tutorialBit('chat')).toBe(0);
    w.send(a, { type: 'party_cmd', op: PartyOp.Invite, clientMsgId: 2, name: 'bob' });
    w.send(b, { type: 'party_cmd', op: PartyOp.Accept, clientMsgId: 3, name: 'alice' });
    w.n.tick();
    for (const p of [a, b]) expect(w.n.tutorial!.stateOf(p.id)!.done & tutorialBit('party')).toBe(tutorialBit('party'));
    expect(b.t.of('tutorial_state').at(-1)!.done & tutorialBit('party')).toBe(tutorialBit('party'));
  });

  it('moving far enough completes move and field on the server (a client cannot claim them)', () => {
    const w = world();
    const a = w.mk('acc-a');
    w.n.tick();
    w.n.world = {
      ...w.n.world,
      entities: w.n.world.entities.map((e) => (e.id === a.id ? { ...e, i: 150, j: 150 } : e)),
    };
    for (let k = 0; k < 8; k++) w.n.tick();
    const st = w.n.tutorial!.stateOf(a.id)!;
    expect(st.done & tutorialBit('move')).toBe(tutorialBit('move'));
    expect(st.done & tutorialBit('field')).toBe(tutorialBit('field'));
  });

  it('a kill credited by combat counts, and so does the skill that made it', () => {
    const w = world({ combat: true });
    const a = w.mk('acc-a');
    w.n.tick();
    const me = w.n.world.entities.find((e) => e.id === a.id)!;
    w.n.world = spawnEntity(w.n.world, { id: MOB, i: me.i + 1.5, j: me.j, hp: 1, mpMax: 0 });
    w.n.world = { ...w.n.world, entities: w.n.world.entities.map((e) => (e.id === a.id ? { ...e, facing: 0 } : e)) };
    const kiem = compileSkills().find((s) => s.key === 'kiem_khi_tram')!;
    w.send(a, { type: 'skill_cast', seq: 1, skillId: kiem.id, targetId: 0, aim: null });
    for (let k = 0; k < 14; k++) w.n.tick();
    const st = w.n.tutorial!.stateOf(a.id)!;
    expect(st.kills).toBe(1);
    expect(st.done & tutorialBit('skill')).toBe(tutorialBit('skill'));
  });

  it('a node without the module rejects tutorial_skip like any unexpected message', () => {
    const w = world({ tutorial: null });
    const a = w.mk('acc-a');
    w.send(a, { type: 'tutorial_skip' });
    expect(a.t.of('error')).toMatchObject([{ code: ErrorCode.BadMessage }]);
  });

  it('progress follows the account to a new connection of the same account', () => {
    const w = world();
    const a = w.mk('acc-a');
    w.n.tick();
    w.send(a, { type: 'tutorial_skip' });
    w.n.tick();
    w.n.removePlayer(a.id, a.t);
    const again = w.mk('acc-a');
    w.n.tick();
    expect(again.t.of('tutorial_state').at(-1)).toMatchObject({ flags: TUTORIAL_FLAG_SKIPPED });
  });
});

// ------------------------------------------------------------------ persistence (D92 file store)
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-tutorial-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('FileTutorialStore', () => {
  it('round trips records through tutorial.json and a new service continues from them', () => {
    const path = join(tmp(), 'tutorial.json');
    const s1 = new FileTutorialStore(path, { flushMs: -1 });
    const a = new TutorialService({ mapTiles: MAP, store: s1 });
    a.join(1, 'acc');
    a.note(1, 'meditate');
    a.note(1, 'kill');
    a.skip(1);
    s1.file.flush();
    const s2 = new FileTutorialStore(path, { flushMs: -1 });
    expect(s2.load('acc')).toEqual({
      accountId: 'acc',
      done: tutorialBit('meditate'),
      kills: 1,
      skipped: true,
      complete: false,
      sessions: 1,
    });
    const b = new TutorialService({ mapTiles: MAP, store: s2 });
    b.join(5, 'acc');
    expect(b.stateOf(5)).toMatchObject({ kills: 1, flags: TUTORIAL_FLAG_SKIPPED });
    expect(b.funnel()).toMatchObject({ accounts: 1, skipped: 1, sessions: 2 });
  });

  it('refuses to start over a malformed record instead of silently dropping progress', () => {
    const dir = tmp();
    const bad = (rec: unknown) => {
      writeFileSync(join(dir, 'tutorial.json'), JSON.stringify({ v: 1, records: [rec] }));
      expect(() => new FileTutorialStore(join(dir, 'tutorial.json'))).toThrow(/malformed|unsupported/);
    };
    bad({ accountId: 'a', done: 1 << 20, kills: 0, skipped: false, complete: false, sessions: 1 }); // unknown step bits
    bad({ accountId: 'a', done: 0, kills: 'x', skipped: false, complete: false, sessions: 1 });
    bad(null);
    writeFileSync(join(dir, 'tutorial.json'), JSON.stringify({ v: 99, records: [] }));
    expect(() => new FileTutorialStore(join(dir, 'tutorial.json'))).toThrow(/unsupported data version/);
  });

  it('writes nothing when a save changes nothing (the join / leave churn costs no disk write)', () => {
    const path = join(tmp(), 'tutorial.json');
    const s = new FileTutorialStore(path, { flushMs: -1 });
    const rec = { accountId: 'a', done: 0, kills: 0, skipped: false, complete: false, sessions: 1 };
    s.save(rec);
    s.file.flush();
    const w = s.file.writes;
    s.save({ ...rec });
    s.file.flush();
    expect(s.file.writes).toBe(w);
  });
});
