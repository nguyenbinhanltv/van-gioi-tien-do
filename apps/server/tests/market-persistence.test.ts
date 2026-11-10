/** The market book on disk (D112, D92): `market.json` round trip, refusal of a damaged document, and its place in the backup document list. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  InventoryService,
  Ledger,
  MarketService,
  STORE_DOC_NAMES,
  openFileStores,
  type MarketSnapshot,
} from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vgtd-market-store-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const snap = (): MarketSnapshot => ({
  v: 1,
  nextId: 8,
  listings: [
    {
      id: 7,
      seller: 'acc-1',
      item: { defId: 3, quality: 2, qty: 1, instance: { durability: 4000, affixes: ['sharp'] } },
      unitPrice: 250,
      listedAt: 1_700_000_000_000,
      expiresAt: 1_700_086_400_000,
      state: 'active',
    },
  ],
  trades: [{ at: 1_700_000_000_500, defId: 2, quality: 0, qty: 3, unitPrice: 100, total: 300, tax: 15 }],
  reports: [{ week: 2800, cpi: 1.08, appliedBps: 500, shadowBps: 800, trades: 1, volume: 300 }],
});

describe('market.json (D92 file store)', () => {
  it('is one of the documents every backup / restore / verify covers', () => {
    expect(STORE_DOC_NAMES).toContain('market.json');
    const stores = openFileStores(dir, { flushMs: -1 });
    expect(Object.keys(stores.snapshot())).toContain('market.json');
  });

  it('round-trips the whole book through the file and writes nothing for an unchanged book', () => {
    const a = openFileStores(dir, { flushMs: -1 });
    expect(a.market.load()).toBeUndefined();
    a.market.save(snap());
    a.flush();
    expect(JSON.parse(readFileSync(join(dir, 'market.json'), 'utf8')).v).toBe(1);
    const b = openFileStores(dir, { flushMs: -1 });
    expect(b.market.load()).toEqual(snap());
    const before = b.market.file.writes;
    b.market.save(snap()); // identical: no disk write
    b.flush();
    expect(b.market.file.writes).toBe(before);
  });

  it('a market service restarted on the stored book finds its listing and keeps allocating fresh ids', () => {
    const a = openFileStores(dir, { flushMs: -1 });
    a.market.save(snap());
    a.flush();
    const b = openFileStores(dir, { flushMs: -1 });
    const svc = new MarketService({
      store: b.market,
      ledger: b.ledger,
      inventory: new InventoryService({ store: b.inventories, ledger: b.ledger }),
      directory: { idOf: () => undefined, nameOf: () => 'x' },
      now: () => 1_700_000_100_000,
    });
    expect(svc.listing(7)).toMatchObject({ seller: 'acc-1', unitPrice: 250, item: { instance: { durability: 4000 } } });
    expect(svc.shadowReports()).toEqual(snap().reports);
    expect(svc.snapshot().nextId).toBe(8);
    expect(new Ledger().reconcile()).toEqual([]);
  });

  it('refuses to start on a damaged or newer document instead of starting with an empty market over live listings', () => {
    const bad = (doc: unknown, why: RegExp): void => {
      writeFileSync(join(dir, 'market.json'), JSON.stringify(doc));
      expect(() => openFileStores(dir, { flushMs: -1 })).toThrow(why);
    };
    bad({ v: 2, nextId: 1, listings: [], trades: [], reports: [] }, /unsupported data version/);
    bad({ v: 1, listings: [], trades: [], reports: [] }, /nextId/);
    bad({ v: 1, nextId: 1, listings: 'x', trades: [], reports: [] }, /listings/);
    bad({ v: 1, nextId: 1, listings: [{ id: 1 }], trades: [], reports: [] }, /malformed listing/);
    const l = snap().listings[0]!;
    bad({ v: 1, nextId: 9, listings: [{ ...l, state: 'gone' }], trades: [], reports: [] }, /malformed listing/);
    bad({ v: 1, nextId: 9, listings: [], trades: [{ at: 1 }], reports: [] }, /malformed trade/);
    bad({ v: 1, nextId: 9, listings: [], trades: [], reports: [{ week: 1 }] }, /malformed report/);
    writeFileSync(join(dir, 'market.json'), '{ not json');
    expect(() => openFileStores(dir, { flushMs: -1 })).toThrow();
  });
});
