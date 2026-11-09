/**
 * Write-ahead journal for multi-document commits (D102): crash injection at every stage of a commit, recovery before anything is served,
 * and the guarantee that matters: after a restart a commit is either ALL there or NOT there, never half (no duplicated, no lost value).
 * Includes the real case: a trade (two bags + the ledger) killed between each of its writes.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { itemDefByKey } from '@vgtd/shared';
import { TradeOp } from '@vgtd/protocol';
import {
  DocFile,
  InventoryService,
  JOURNAL_FILE,
  TRADE_CONFIG,
  TradeService,
  TxJournal,
  openFileStores,
  recoverJournal,
  writeFileAtomic,
  type JournalStage,
} from '../src/index.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-journal-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

class Crash extends Error {
  constructor(readonly stage: string) {
    super(`injected crash at ${stage}`);
  }
}
const crashAt =
  (at: string) =>
  (stage: JournalStage): void => {
    if (stage === at) throw new Crash(stage);
  };
const STAGES: JournalStage[] = ['before-journal', 'journal-written', 'applied-1', 'applied-2', 'done'];

const read = (dir: string, f: string): unknown => JSON.parse(readFileSync(join(dir, f), 'utf8'));

describe('TxJournal: a commit over two documents', () => {
  /** two documents with a shared total: moving 30 from A to B must never be half done */
  function docs(dir: string, a: { n: number }, b: { n: number }): [DocFile, DocFile] {
    return [
      new DocFile(join(dir, 'a.json'), () => JSON.stringify({ v: 1, n: a.n }), { flushMs: -1 }),
      new DocFile(join(dir, 'b.json'), () => JSON.stringify({ v: 1, n: b.n }), { flushMs: -1 }),
    ];
  }

  it('without a crash: both documents are written, the journal is gone, the commit counter moves', () => {
    const dir = tmp();
    const a = { n: 100 };
    const b = { n: 0 };
    const [da, db] = docs(dir, a, b);
    a.n = 70;
    b.n = 30;
    const j = new TxJournal(dir);
    j.commit('move', [da, db]);
    expect([read(dir, 'a.json'), read(dir, 'b.json')]).toEqual([
      { v: 1, n: 70 },
      { v: 1, n: 30 },
    ]);
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(false);
    expect(j.commits).toBe(1);
    // the documents are clean: a flush right after writes nothing more
    const w = [da.writes, db.writes];
    da.flush();
    db.flush();
    expect([da.writes, db.writes]).toEqual(w);
  });

  it.each(STAGES)(
    'a crash at "%s": after recovery the move is entirely there or entirely not there, never half',
    (stage) => {
      const dir = tmp();
      const a = { n: 100 };
      const b = { n: 0 };
      const [da, db] = docs(dir, a, b);
      da.markDirty();
      db.markDirty();
      da.flush();
      db.flush(); // the "before" state is on disk
      a.n = 70;
      b.n = 30;
      expect(() => new TxJournal(dir, { crash: crashAt(stage) }).commit('move', [da, db])).toThrow(Crash);
      // --- the process is dead; a new one starts: recovery runs before anything is read
      const label = recoverJournal(dir);
      const [x, y] = [read(dir, 'a.json') as { n: number }, read(dir, 'b.json') as { n: number }];
      expect(x.n + y.n).toBe(100); // value is conserved whatever the stage
      if (stage === 'before-journal') {
        expect([x.n, y.n]).toEqual([100, 0]); // the commit never happened
        expect(label).toBeNull();
      } else {
        expect([x.n, y.n]).toEqual([70, 30]); // the commit was decided: rolled forward
        expect(label).toBe(stage === 'done' ? null : 'move');
      }
      expect(existsSync(join(dir, JOURNAL_FILE))).toBe(false);
      expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
      // recovery is idempotent: a second run (a crash during recovery itself) changes nothing
      expect(recoverJournal(dir)).toBeNull();
      expect([read(dir, 'a.json'), read(dir, 'b.json')]).toEqual([x, y]);
    },
  );

  it('control: WITHOUT the journal, plain per-document writes killed in between DO tear the commit (the dupe vector this closes)', () => {
    const dir = tmp();
    const a = { n: 100 };
    const b = { n: 0 };
    const [da, db] = docs(dir, a, b);
    da.markDirty();
    db.markDirty();
    da.flush();
    db.flush();
    // credit B first, die before A is debited: 130 now exist
    a.n = 70;
    b.n = 30;
    db.markDirty();
    db.flush();
    expect(recoverJournal(dir)).toBeNull(); // nothing to recover: no journal
    expect((read(dir, 'a.json') as { n: number }).n + (read(dir, 'b.json') as { n: number }).n).toBe(130);
  });

  it('a crash DURING recovery is harmless: the journal is still there and the next start finishes it', () => {
    const dir = tmp();
    const a = { n: 100 };
    const b = { n: 0 };
    const [da, db] = docs(dir, a, b);
    da.markDirty();
    db.markDirty();
    da.flush();
    db.flush();
    a.n = 70;
    b.n = 30;
    expect(() => new TxJournal(dir, { crash: crashAt('journal-written') }).commit('move', [da, db])).toThrow(Crash);
    // recovery dies after writing the first document only (simulated by applying it by hand and leaving the journal)
    const rec = read(dir, JOURNAL_FILE) as { docs: { file: string; data: string }[] };
    writeFileAtomic(join(dir, rec.docs[0]!.file), rec.docs[0]!.data);
    expect(recoverJournal(dir)).toBe('move');
    expect([read(dir, 'a.json'), read(dir, 'b.json')]).toEqual([
      { v: 1, n: 70 },
      { v: 1, n: 30 },
    ]);
  });

  it('a stray journal.json.tmp (a crash while writing the journal) is deleted and the commit never happened', () => {
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ v: 1, n: 5 }));
    writeFileSync(
      join(dir, `${JOURNAL_FILE}.tmp`),
      '{"v":1,"tx":"half","docs":[{"file":"a.json","data":"{\\"v\\":1,\\"n\\":9',
    );
    expect(recoverJournal(dir)).toBeNull();
    expect(existsSync(join(dir, `${JOURNAL_FILE}.tmp`))).toBe(false);
    expect(read(dir, 'a.json')).toEqual({ v: 1, n: 5 });
  });

  it('refuses to start on a journal it cannot trust: corrupt, wrong version, unsafe file names, non-JSON or unversioned documents', () => {
    const attempt = (content: string): (() => unknown) => {
      const dir = tmp();
      writeFileSync(join(dir, 'a.json'), JSON.stringify({ v: 1, n: 5 }));
      writeFileSync(join(dir, JOURNAL_FILE), content);
      return () => recoverJournal(dir);
    };
    expect(attempt('not json')).toThrow(/cannot be parsed/);
    expect(attempt(JSON.stringify({ v: 2, tx: 'x', docs: [{ file: 'a.json', data: '{"v":1}' }] }))).toThrow(
      /not a valid journal/,
    );
    expect(attempt(JSON.stringify({ v: 1, tx: 'x', docs: [] }))).toThrow(/not a valid journal/);
    expect(attempt(JSON.stringify({ v: 1, tx: 'x', docs: [{ file: '../evil.json', data: '{"v":1}' }] }))).toThrow(
      /not allowed/,
    );
    expect(attempt(JSON.stringify({ v: 1, tx: 'x', docs: [{ file: 'sub/a.json', data: '{"v":1}' }] }))).toThrow(
      /not allowed/,
    );
    expect(attempt(JSON.stringify({ v: 1, tx: 'x', docs: [{ file: 'a.txt', data: '{"v":1}' }] }))).toThrow(
      /not allowed/,
    );
    expect(attempt(JSON.stringify({ v: 1, tx: 'x', docs: [{ file: 'a.json', data: 'oops' }] }))).toThrow(
      /not valid JSON/,
    );
    expect(attempt(JSON.stringify({ v: 1, tx: 'x', docs: [{ file: 'a.json', data: '{"n":1}' }] }))).toThrow(
      /not a versioned document/,
    );
    // validation happens before anything is applied: a bad second document leaves the good first one untouched
    const dir = tmp();
    writeFileSync(join(dir, 'a.json'), JSON.stringify({ v: 1, n: 5 }));
    writeFileSync(
      join(dir, JOURNAL_FILE),
      JSON.stringify({
        v: 1,
        tx: 'x',
        docs: [
          { file: 'a.json', data: '{"v":1,"n":99}' },
          { file: 'b.json', data: 'oops' },
        ],
      }),
    );
    expect(() => recoverJournal(dir)).toThrow();
    expect(read(dir, 'a.json')).toEqual({ v: 1, n: 5 });
  });

  it('an unsafe document name is refused when committing too (the journal can only ever name plain *.json files)', () => {
    const dir = tmp();
    const bad = new DocFile(join(dir, 'Bad Name.json'), () => '{"v":1}', { flushMs: -1 });
    expect(() => new TxJournal(dir).commit('x', [bad])).toThrow(/unsafe document name/);
    expect(existsSync(join(dir, JOURNAL_FILE))).toBe(false);
  });
});

// ------------------------------------------------------------------------------------------------ the real case: a trade
const PILL = itemDefByKey('heal_pill')!.id;
const BLUEPRINT = itemDefByKey('blueprint_white_green')!.id;
const MAT = itemDefByKey('craft_material')!.id;

describe('a trade killed at every point of its commit: items and stones are conserved after the restart', () => {
  const snapshotOf = (inv: InventoryService) => ({
    pillsA: inv.bagOf('acc-a').count(PILL),
    pillsB: inv.bagOf('acc-b').count(PILL),
    bpA: inv.bagOf('acc-a').count(BLUEPRINT),
    bpB: inv.bagOf('acc-b').count(BLUEPRINT),
    matA: inv.bagOf('acc-a').count(MAT),
    matB: inv.bagOf('acc-b').count(MAT),
    haA: inv.wallet('acc-a', 'LT_HA'),
    haB: inv.wallet('acc-b', 'LT_HA'),
    sink: BigInt(inv.ledger.snapshot().accounts.find((x) => x.key.startsWith('SYSTEM_SINK_TRADE_TAX'))?.balance ?? '0'),
  });
  const PRE = { pillsA: 10, pillsB: 0, bpA: 1, bpB: 0, matA: 0, matB: 20, haA: 1000n, haB: 50n, sink: 0n };
  // alice gives 6 pills + the blueprint + 400 stones, bob gives 15 materials + 30 stones; tax 12 + 1 = 13
  const POST = {
    pillsA: 4,
    pillsB: 6,
    bpA: 0,
    bpB: 1,
    matA: 15,
    matB: 5,
    haA: 1000n - 400n + 29n,
    haB: 50n - 30n + 388n,
    sink: 13n,
  };

  function run(dir: string, stage: JournalStage): void {
    const stores = openFileStores(dir, { flushMs: -1, crash: crashAt(stage) });
    const inv = new InventoryService({ store: stores.inventories, ledger: stores.ledger, durable: stores.durable });
    // setup (committed normally BEFORE the crash is armed: the hook only fires inside the trade's commit, see below)
    for (const o of ['acc-a', 'acc-b']) inv.onJoin(o);
    inv.grantDrops(
      'acc-a',
      [
        { item: 'heal_pill', qty: 10, quality: 1 },
        { item: 'blueprint_white_green', qty: 1, quality: 2 },
        { item: 'stone_ha', qty: 1000 },
      ],
      'field',
      'g1',
    );
    inv.grantDrops(
      'acc-b',
      [
        { item: 'craft_material', qty: 20, quality: 0 },
        { item: 'stone_ha', qty: 50 },
      ],
      'field',
      'g2',
    );
    inv.flushAll();
    stores.flush(); // the pre-trade state is on disk
    expect(snapshotOf(inv)).toEqual(PRE);
    const trade = new TradeService({ inventory: inv });
    const pos = { i: 5, j: 5 };
    trade.attach({ deliver: () => undefined, posOf: () => pos });
    trade.join({ entityId: 1, accountId: 'acc-a', name: 'alice' });
    trade.join({ entityId: 2, accountId: 'acc-b', name: 'bob' });
    let now = 10_000;
    const cmd = (
      e: number,
      op: number,
      o: { name?: string; slot?: number; qty?: number; amount?: number } = {},
    ): void => {
      now += 2 * TRADE_CONFIG.RATE.refillMs;
      trade.handle(
        e,
        {
          type: 'trade_cmd',
          op,
          clientMsgId: 1,
          name: o.name ?? '',
          slot: o.slot ?? 0,
          qty: o.qty ?? 0,
          currency: 0,
          amount: o.amount ?? 0,
        },
        now,
      );
    };
    const slotOf = (owner: string, defId: number): number =>
      inv
        .bagOf(owner)
        .slots.findIndex(
          (s) => s && (s.kind === 'stack' ? s.defId === defId : inv.bagOf(owner).instances.get(s.id)!.defId === defId),
        );
    cmd(1, TradeOp.Invite, { name: 'bob' });
    cmd(2, TradeOp.Accept, { name: 'alice' });
    cmd(1, TradeOp.SetItem, { slot: slotOf('acc-a', PILL), qty: 6 });
    cmd(1, TradeOp.SetItem, { slot: slotOf('acc-a', BLUEPRINT), qty: 1 });
    cmd(1, TradeOp.SetStones, { amount: 400 });
    cmd(2, TradeOp.SetItem, { slot: slotOf('acc-b', MAT), qty: 15 });
    cmd(2, TradeOp.SetStones, { amount: 30 });
    for (const e of [1, 2]) cmd(e, TradeOp.Lock);
    for (const e of [1, 2]) cmd(e, TradeOp.Confirm); // the second confirm executes the trade; its durable commit is killed at `stage`
    // NO flush, NO clean shutdown: the process just dies here
  }

  const reopen = (dir: string): { stores: ReturnType<typeof openFileStores>; inv: InventoryService } => {
    const stores = openFileStores(dir, { flushMs: -1 });
    return {
      stores,
      inv: new InventoryService({ store: stores.inventories, ledger: stores.ledger, durable: stores.durable }),
    };
  };

  it.each(STAGES)(
    'killed at "%s": after the restart the trade is all there or not there at all (no duplicate, no loss)',
    (stage) => {
      const dir = tmp();
      run(dir, stage);
      const { stores, inv } = reopen(dir);
      const got = snapshotOf(inv);
      expect(got).toEqual(stage === 'before-journal' ? PRE : POST);
      if (stage === 'before-journal' || stage === 'done') expect(stores.recovered).toBeNull();
      else expect(stores.recovered).toMatch(/^exchange:trade:/);
      // conservation, whatever the stage: the same pills / blueprint / materials exist once, stones only left through the tax
      expect(got.pillsA + got.pillsB).toBe(10);
      expect(got.bpA + got.bpB).toBe(1);
      expect(got.matA + got.matB).toBe(20);
      expect(got.haA + got.haB + got.sink).toBe(1050n);
      expect(inv.ledger.reconcile()).toEqual([]);
      expect(inv.bagOf('acc-a').check()).toEqual([]);
      expect(inv.bagOf('acc-b').check()).toEqual([]);
      expect(existsSync(join(dir, JOURNAL_FILE))).toBe(false);
    },
  );

  it('after a recovered trade the same accounts can trade again and nothing was applied twice', () => {
    const dir = tmp();
    run(dir, 'applied-1');
    const { inv } = reopen(dir);
    // a SECOND recovery-less restart sees the same committed state (idempotent)
    const again = reopen(dir);
    expect(snapshotOf(again.inv)).toEqual(snapshotOf(inv));
    expect(snapshotOf(again.inv)).toEqual(POST);
  });
});
