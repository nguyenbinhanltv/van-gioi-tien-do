/**
 * Background DocFile writes (D106) against the write-ahead journal (D102), the live backup snapshot (D99) and market commits (D112): the ordering
 * rules must survive a write that is on the thread pool while a journal commit runs on the loop.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocFile, TxJournal, openFileStores, type JournalStage } from '../src/index.js';

const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-jbg-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const read = (f: string): unknown => JSON.parse(readFileSync(f, 'utf8'));

describe('a background write that is on the thread pool while a journal commit runs', () => {
  it("never overwrites the journal's newer content (the older snapshot is superseded, not committed)", async () => {
    const dir = tmp();
    const journal = new TxJournal(dir);
    let a = 1;
    let b = 1;
    const docA = new DocFile(join(dir, 'a.json'), () => JSON.stringify({ v: a }), {
      flushMs: -1,
      beforeWrite: () => journal.settle(),
    });
    const docB = new DocFile(join(dir, 'b.json'), () => JSON.stringify({ v: b }), {
      flushMs: -1,
      beforeWrite: () => journal.settle(),
    });
    docA.markDirty();
    const inflight = docA.flushAsync(); // took its copy of a = 1, now on the thread pool
    a = 2;
    b = 2;
    docA.markDirty();
    docB.markDirty();
    journal.commit('both', [docA, docB]); // synchronous: a = 2 and b = 2 are on disk when this returns
    expect(read(join(dir, 'a.json'))).toEqual({ v: 2 });
    await inflight; // the old a = 1 write finishes now: it must NOT land
    await docA.drain();
    expect(read(join(dir, 'a.json'))).toEqual({ v: 2 });
    expect(read(join(dir, 'b.json'))).toEqual({ v: 2 });
  });

  it('a pending journal (a commit that failed half way) is finished BEFORE a background write of one of its documents, and the write is then newest', async () => {
    const dir = tmp();
    let fail: JournalStage | null = 'applied-1';
    const journal = new TxJournal(dir, {
      crash: (s) => {
        if (s === fail) throw new Error('disk error');
      },
    });
    let a = 1;
    let b = 1;
    const opts = { flushMs: -1, beforeWrite: () => journal.settle() };
    const docA = new DocFile(join(dir, 'a.json'), () => JSON.stringify({ v: a }), opts);
    const docB = new DocFile(join(dir, 'b.json'), () => JSON.stringify({ v: b }), opts);
    a = 2;
    b = 2;
    docA.markDirty();
    docB.markDirty();
    expect(() => journal.commit('both', [docA, docB])).toThrow('disk error');
    expect(journal.pending).toBe(true); // journal on disk, b not applied yet
    fail = null;
    b = 3; // a LATER change of a journal document
    docB.markDirty();
    await docB.flushAsync(); // must settle the journal first (b = 2 from the journal), then write b = 3 on top
    expect(journal.pending).toBe(false);
    expect(read(join(dir, 'a.json'))).toEqual({ v: 2 });
    expect(read(join(dir, 'b.json'))).toEqual({ v: 3 });
    // a restart now must not roll a stale journal forward over b = 3
    const again = openFileStores(dir, { flushMs: -1 });
    void again;
    expect(read(join(dir, 'b.json'))).toEqual({ v: 3 });
  });

  it('a background write whose settle fails does not happen, stays dirty and is counted; it goes through once the disk works again', async () => {
    const dir = tmp();
    let broken = true;
    const errors: unknown[] = [];
    const x = 1;
    const doc = new DocFile(join(dir, 'x.json'), () => JSON.stringify({ v: x }), {
      flushMs: -1,
      beforeWrite: () => {
        if (broken) throw new Error('journal cannot be finished');
      },
      onError: (e) => errors.push(e),
    });
    doc.markDirty();
    await doc.flushAsync();
    expect(doc.errors).toBe(1);
    expect(errors).toHaveLength(1);
    expect(() => readFileSync(join(dir, 'x.json'))).toThrow(); // nothing was written
    broken = false;
    await doc.drain();
    expect(read(join(dir, 'x.json'))).toEqual({ v: 1 });
  });
});

describe('the live backup snapshot with background writes', () => {
  it('snapshot() serialises the live state of every document in one synchronous turn, whatever is on the thread pool', async () => {
    const dir = tmp();
    const stores = openFileStores(dir, { flushMs: 0 });
    stores.market.save({ v: 1, nextId: 5, listings: [], trades: [], reports: [] });
    const pending = stores.market.file.flushAsync(); // in flight
    stores.market.save({ v: 1, nextId: 9, listings: [], trades: [], reports: [] }); // changed after the write took its copy
    const docs = stores.snapshot();
    expect(JSON.parse(docs['market.json']).nextId).toBe(9); // the backup sees the LIVE state, not what the background write holds
    await pending;
    await stores.market.file.drain();
    expect(read(join(dir, 'market.json'))).toMatchObject({ nextId: 9 });
  });
});
