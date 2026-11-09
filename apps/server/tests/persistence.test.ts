/**
 * File-backed stores (D92): atomic crash-safe writes, round trips of every store, refusal to start over unreadable / newer data,
 * no plaintext secrets, and a restart through the real gateway that keeps the character.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { STONE_CURRENCY, classWireId } from '@vgtd/shared';
import { PROTOCOL_VERSION } from '@vgtd/protocol';
import {
  AuthService,
  DocFile,
  FileAccountStore,
  FileProgressionStore,
  Ledger,
  newRecord,
  openFileStores,
  readJsonFile,
  startServer,
  writeFileAtomic,
  InventoryService,
  type Account,
  type FileStores,
  type RunningServer,
} from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

const HA = STONE_CURRENCY['stone_ha']!;
const FAST = { N: 1024, r: 8, p: 1 };
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-persist-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

describe('atomic writes', () => {
  it('round trips, keeps the previous version as .bak, and a half-written temp file never replaces good data', () => {
    const f = join(tmp(), 'a.json');
    expect(readJsonFile(f)).toBeUndefined(); // first start
    writeFileAtomic(f, JSON.stringify({ n: 1 }));
    writeFileAtomic(f, JSON.stringify({ n: 2 }));
    expect(readJsonFile(f)).toEqual({ n: 2 });
    expect(JSON.parse(readFileSync(`${f}.bak`, 'utf8'))).toEqual({ n: 1 });
    // crash while writing the next version: a truncated temp file is left behind
    writeFileSync(`${f}.tmp`, '{"n": 3, "trunc');
    expect(readJsonFile(f)).toEqual({ n: 2 });
  });

  it('a crash between "move current to .bak" and "rename tmp" is recovered from the .bak', () => {
    const f = join(tmp(), 'b.json');
    writeFileAtomic(f, JSON.stringify({ n: 1 }));
    writeFileAtomic(f, JSON.stringify({ n: 2 }));
    rmSync(f); // as if the process died right after the first rename
    expect(readJsonFile(f)).toEqual({ n: 1 });
  });

  it('a corrupt main file falls back to the .bak; both unreadable THROWS instead of starting empty', () => {
    const f = join(tmp(), 'c.json');
    writeFileAtomic(f, JSON.stringify({ n: 1 }));
    writeFileAtomic(f, JSON.stringify({ n: 2 }));
    writeFileSync(f, 'not json');
    expect(readJsonFile(f)).toEqual({ n: 1 });
    writeFileSync(`${f}.bak`, 'also not json');
    expect(() => readJsonFile(f)).toThrow(/refusing to start empty/);
  });

  it('DocFile coalesces a burst of changes into one write and survives a failing write', () => {
    const f = join(tmp(), 'd.json');
    let n = 0;
    const doc = new DocFile(f, () => JSON.stringify({ n }), { flushMs: -1 }); // -1: only explicit flush() writes
    for (let k = 0; k < 50; k++) {
      n++;
      doc.markDirty();
    }
    doc.flush();
    doc.flush(); // nothing changed: no second write
    expect(doc.writes).toBe(1);
    expect(readJsonFile(f)).toEqual({ n: 50 });
    // a path whose parent is a regular file cannot be written: counted, reported, never thrown into the caller
    const blocked = join(f, 'child.json');
    const errs: unknown[] = [];
    const bad = new DocFile(blocked, () => '{}', { flushMs: -1, onError: (e) => errs.push(e) });
    bad.markDirty();
    expect(() => bad.flush()).not.toThrow();
    expect(bad.errors).toBe(1);
    expect(errs).toHaveLength(1);
  });
});

const account = (id: string, name: string): Account => ({
  id,
  username: name,
  passwordHash: 'scrypt$fake$hash',
  tokenVersion: 0,
  failures: 0,
  lockedUntilMs: 0,
  lockLevel: 0,
});

describe('file stores round trip', () => {
  it('accounts: created, lockout state and lookups survive a reload', () => {
    const d = tmp();
    const a = new FileAccountStore(join(d, 'accounts.json'), { flushMs: -1 });
    const acc = account('id1', 'alice');
    acc.failures = 4; // attempts in flight at the moment of a write must not become a permanent lock
    expect(a.create(acc)).toBe(true);
    expect(a.create(account('id2', 'alice'))).toBe(false);
    acc.lockLevel = 2;
    acc.lockedUntilMs = 123456;
    a.save(acc);
    a.file.flush();
    const b = new FileAccountStore(join(d, 'accounts.json'), { flushMs: -1 });
    expect(b.byUsername('alice')).toEqual({ ...acc, failures: 0 });
    expect(b.byId('id1')?.lockLevel).toBe(2);
    expect(b.byUsername('nobody')).toBeUndefined();
  });

  it('progression: the record (incl. class) and its optimistic version survive; a stale version still conflicts', async () => {
    const d = tmp();
    const p = join(d, 'progression.json');
    const a = new FileProgressionStore(p, { flushMs: -1 });
    const rec = newRecord('char1', { type: 'don', elements: ['moc'], mutation: null }, 'phap');
    expect(await a.save(rec, 0)).toBe(true);
    const v1 = { ...rec, exp: 40, version: rec.version + 1 };
    expect(await a.save(v1, rec.version)).toBe(true);
    expect(await a.save({ ...rec, exp: 1 }, 0)).toBe(false); // stale
    a.file.flush();
    const b = new FileProgressionStore(p, { flushMs: -1 });
    expect(await b.load('char1')).toEqual(v1);
    expect(await b.save({ ...v1, exp: 50, version: v1.version + 1 }, v1.version)).toBe(true);
    expect(await b.save({ ...v1, exp: 99 }, 0)).toBe(false);
  });

  it('inventories + ledger: bags, pending loot and bigint balances come back exactly, and the ledger keeps working', () => {
    const d = tmp();
    const s1 = openFileStores(d, { flushMs: -1 });
    const inv1 = new InventoryService({ store: s1.inventories, ledger: s1.ledger });
    inv1.onJoin('acc');
    inv1.grantDrops(
      'acc',
      [
        { item: 'stone_ha', qty: 3 },
        { item: 'heal_pill', qty: 2, quality: 1 },
      ],
      'field',
      'k1',
    );
    const walletBefore = inv1.wallet('acc', HA);
    inv1.flushAll();
    s1.flush();

    const s2 = openFileStores(d, { flushMs: -1 });
    const inv2 = new InventoryService({ store: s2.inventories, ledger: s2.ledger });
    expect(inv2.wallet('acc', HA)).toBe(walletBefore);
    expect(s2.ledger.reconcile()).toEqual([]);
    expect(s2.ledger.entries.length).toBe(s1.ledger.entries.length);
    expect(inv2.bagOf('acc').snapshot()).toEqual(inv1.bagOf('acc').snapshot());
    // the restored ledger accepts new work, and a kill key reused after the restart (the tick counter restarts) is not rejected
    inv2.onJoin('acc');
    expect(() => inv2.grantDrops('acc', [{ item: 'stone_ha', qty: 5 }], 'field', 'k1')).not.toThrow();
    expect(inv2.wallet('acc', HA)).toBe(walletBefore + 5n);
    expect(s2.ledger.reconcile()).toEqual([]);
  });

  it('re-saving an unchanged bag (the periodic save of online players) costs no disk write', () => {
    const d = tmp();
    const s1 = openFileStores(d, { flushMs: -1 });
    const inv = new InventoryService({ store: s1.inventories, ledger: s1.ledger });
    inv.onJoin('acc');
    inv.grantDrops('acc', [{ item: 'heal_pill', qty: 1, quality: 1 }], 'field', 'k1');
    inv.flushAll();
    s1.flush();
    const writes = s1.inventories.file.writes;
    inv.flushAll();
    inv.flushAll();
    s1.flush();
    expect(s1.inventories.file.writes).toBe(writes);
  });

  it('refuses to start over a newer data version or a malformed record (never silently empties player data)', () => {
    const d = tmp();
    writeFileAtomic(join(d, 'accounts.json'), JSON.stringify({ v: 2, accounts: [] }));
    expect(() => new FileAccountStore(join(d, 'accounts.json'))).toThrow(/unsupported data version 2/);
    writeFileAtomic(join(d, 'progression.json'), JSON.stringify({ v: 1, records: [{ characterId: 5 }] }));
    expect(() => new FileProgressionStore(join(d, 'progression.json'))).toThrow(/malformed/);
    writeFileAtomic(
      join(d, 'ledger.json'),
      JSON.stringify({ v: 1, nextTx: 2, accounts: [], entries: [{ txId: 1, accountKey: 'x', delta: '5' }] }),
    );
    expect(() => openFileStores(d)).toThrow();
  });

  it('a ledger snapshot that does not balance is rejected', () => {
    const l = new Ledger();
    const snap = l.snapshot();
    snap.entries.push({ txId: 1, accountKey: 'PLAYER_WALLET|a|stone_ha', delta: '5' });
    expect(() => Ledger.restore(snap)).toThrow();
  });
});

describe('secrets', () => {
  it('registering writes a password HASH only: the plaintext password and a "password" field never reach the disk', async () => {
    const d = tmp();
    const stores = openFileStores(d, { flushMs: -1 });
    const auth = new AuthService({ store: stores.accounts, scrypt: FAST, registerPerIpPerDay: 0 });
    const secret = TEST_ONLY_GOOD;
    await auth.register('sec_user', secret, '127.0.0.1');
    stores.flush();
    const text = readFileSync(join(d, 'accounts.json'), 'utf8');
    expect(text).not.toContain(secret);
    expect(text).not.toMatch(/"password"/);
    expect(text).toContain('sec_user');
    expect(text).toMatch(/"passwordHash":"[^"]+"/);
    // no stray temp file left behind
    expect(readdirSync(d).filter((f) => f.endsWith('.tmp'))).toEqual([]);
    // and the account still logs in after a reload
    const again = new AuthService({
      store: openFileStores(d, { flushMs: -1 }).accounts,
      scrypt: FAST,
      registerPerIpPerDay: 0,
    });
    await expect(again.login('sec_user', secret, '127.0.0.1')).resolves.toMatchObject({
      accountId: expect.any(String),
    });
  });

  it('the file is created with owner-only permissions where the platform supports it', () => {
    if (process.platform === 'win32') return;
    const f = join(tmp(), 'p.json');
    writeFileAtomic(f, '{}');
    expect(readFileSyncMode(f) & 0o077).toBe(0);
  });
});
function readFileSyncMode(f: string): number {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  return (require('node:fs') as typeof import('node:fs')).statSync(f).mode;
}

describe('restart through the real gateway', () => {
  let live: { srv: RunningServer; stores: FileStores } | undefined;
  afterEach(async () => {
    if (live) await live.srv.stop();
    live = undefined;
  });
  async function boot(dir: string): Promise<{ srv: RunningServer; stores: FileStores }> {
    const stores = openFileStores(dir, { flushMs: -1 });
    const srv = await startServer({
      port: 0,
      auth: { scrypt: FAST, registerPerIpPerDay: 0, ipFailLimit: 1_000_000, store: stores.accounts },
      world: {
        mapTiles: 64,
        spawn: { i0: 20, j0: 20, side: 8 },
        inventory: new InventoryService({ store: stores.inventories, ledger: stores.ledger }),
      },
      progression: { store: stores.progression },
    });
    live = { srv, stores };
    return live;
  }
  async function login(s: RunningServer, name: string): Promise<string> {
    const cred = { username: name, password: TEST_ONLY_GOOD };
    const post = (p: string) =>
      fetch(`http://127.0.0.1:${s.port}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(cred),
      });
    await post('/auth/register'); // 201 the first time, 409 afterwards
    const r = await post('/auth/login');
    expect(r.status).toBe(200);
    return ((await r.json()) as { token: string }).token;
  }
  async function hello(
    s: RunningServer,
    token: string,
    classId: string,
  ): Promise<{ ack: Record<string, unknown>; ws: WebSocket }> {
    const ws = new WebSocket(`ws://127.0.0.1:${s.port}/ws`);
    return new Promise((resolve, reject) => {
      ws.on('open', () =>
        ws.send(
          JSON.stringify({
            type: 'hello',
            protocolMin: PROTOCOL_VERSION,
            protocolMax: PROTOCOL_VERSION,
            token,
            classId,
          }),
        ),
      );
      ws.on('message', (d, isBinary) => {
        if (!isBinary) resolve({ ack: JSON.parse(d.toString()) as Record<string, unknown>, ws });
      });
      ws.on('error', reject);
    });
  }
  const settle = (ms = 150): Promise<void> => new Promise((r) => setTimeout(r, ms));

  it('a character keeps its account, class and stones across a server restart (and a new login asking for another class does not change it)', async () => {
    const dir = tmp();
    let { srv, stores } = await boot(dir);
    const tok1 = await login(srv, 'persist_me');
    const first = await hello(srv, tok1, 'phap');
    expect(first.ack.classId).toBe(classWireId('phap'));
    const accountId = srv.world.clients.get(first.ack.entityId as number)!.accountId;
    srv.world.inventory!.grantDrops(accountId, [{ item: 'stone_ha', qty: 7 }], 'field', 'kill-1');
    const wallet = srv.world.inventory!.wallet(accountId, HA);
    expect(wallet).toBeGreaterThan(0n);
    first.ws.close(1000);
    await settle();
    // clean shutdown, as main.ts does on SIGINT / SIGTERM
    await srv.stop();
    srv.world.inventory!.flushAll();
    stores.flush();
    expect(existsSync(join(dir, 'accounts.json'))).toBe(true);

    ({ srv, stores } = await boot(dir)); // the same data dir, a brand-new process state
    const tok2 = await login(srv, 'persist_me'); // register -> 409, login with the persisted hash works
    const again = await hello(srv, tok2, 'dao'); // asks for another class: the stored one wins
    expect(again.ack.classId).toBe(classWireId('phap'));
    expect(srv.world.clients.get(again.ack.entityId as number)!.accountId).toBe(accountId);
    expect(srv.world.inventory!.wallet(accountId, HA)).toBe(wallet);
    again.ws.close(1000);
    void stores;
  });
});
