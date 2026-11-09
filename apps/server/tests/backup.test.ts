/**
 * Backup / restore of the file store (D99, P5): the restore drill (play-ish writes -> backup -> more writes -> crash -> restore ->
 * the state equals the snapshot exactly), atomic publishing, rotation, verification, the refusal cases and the operator CLI.
 * No test prints or asserts on document content beyond equality: the documents hold password hashes.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  existsSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STONE_CURRENCY } from '@vgtd/shared';
import {
  AuthService,
  BackupError,
  DOC_NAMES,
  STORE_DOC_NAMES,
  InventoryService,
  backupIds,
  createBackup,
  newRecord,
  openFileStores,
  readLiveDocs,
  restoreBackup,
  rotateBackups,
  runCli,
  validateDocs,
  verifyBackup,
  writeFileAtomic,
  type BackupManifest,
  type Docs,
  type FileStores,
} from '../src/index.js';
import { TEST_ONLY_GOOD } from './fixtures.js';

// the drills register accounts (scrypt) and write many small files: allow for a loaded machine (the default is 5 s)
vi.setConfig({ testTimeout: 30_000 });

const HA = STONE_CURRENCY['stone_ha']!;
const FAST = { N: 1024, r: 8, p: 1 };
const dirs: string[] = [];
const tmp = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-backup-'));
  dirs.push(d);
  return d;
};
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const at = (k: number) => (): Date => new Date(Date.UTC(2026, 10, 9, 12, 0, k));
const read = (f: string): string => readFileSync(f, 'utf8');
const ROOT = { type: 'don', elements: ['moc'], mutation: null } as const;

interface World {
  stores: FileStores;
  inv: InventoryService;
  auth: AuthService;
  ids: Record<string, string>;
}

/** An open data directory with the real services on top of the file stores. */
function open(dir: string): World {
  const stores = openFileStores(dir, { flushMs: -1 });
  const inv = new InventoryService({ store: stores.inventories, ledger: stores.ledger });
  const auth = new AuthService({ store: stores.accounts, scrypt: FAST, registerPerIpPerDay: 0 });
  return { stores, inv, auth, ids: {} };
}
async function playFirstSession(w: World): Promise<void> {
  for (const name of ['alice_a', 'bob_b']) {
    const r = await w.auth.register(name, TEST_ONLY_GOOD, '127.0.0.1');
    w.ids[name] = r.accountId;
  }
  // characters (progression)
  await w.stores.progression.save(newRecord(w.ids.alice_a!, ROOT, 'kiem'), 0);
  await w.stores.progression.save({ ...newRecord(w.ids.bob_b!, ROOT, 'phap'), exp: 300, version: 1 }, 0);
  // bags and the stone ledger through real kills
  for (const [who, key] of [
    ['alice_a', 'k1'],
    ['alice_a', 'k2'],
    ['bob_b', 'k3'],
  ] as const) {
    w.inv.onJoin(w.ids[who]!);
    w.inv.grantDrops(
      w.ids[who]!,
      [
        { item: 'stone_ha', qty: 4 },
        { item: 'heal_pill', qty: 2, quality: 1 },
        { item: 'craft_material', qty: 7 },
      ],
      'field',
      key,
    );
  }
  // a sect join with a bought manual (D98) and a friendship plus a pending request (D96): the documents the review found missing from the first D99
  // draft. Written through the stores the services sit on, so the test needs no sockets.
  w.stores.sect.save({ members: [w.ids.alice_a!], manuals: [[w.ids.alice_a!, 'kiem_manual_1']] });
  w.stores.friends.save({ friends: [[w.ids.alice_a!, w.ids.bob_b!]], requests: [] });
  // the market book (D112): one escrowed listing of alice's, one sale and a shadow report: the document that holds items OUT of every bag
  w.stores.market.save({
    v: 1,
    nextId: 3,
    listings: [
      {
        id: 2,
        seller: w.ids.alice_a!,
        item: { defId: 1, quality: 0, qty: 5 },
        unitPrice: 20,
        listedAt: 1_700_000_000_000,
        expiresAt: 1_700_086_400_000,
        state: 'active',
      },
    ],
    trades: [{ at: 1_700_000_000_500, defId: 2, quality: 0, qty: 1, unitPrice: 50, total: 50, tax: 3 }],
    reports: [],
  });
  w.inv.flushAll();
  w.stores.flush();
}
/** Everything a restore must give back, in a comparable form (the hashes are compared, never printed). */
function stateOf(w: World): unknown {
  return {
    accounts: [...Object.keys(w.ids), 'carol_c']
      .map((n) => w.stores.accounts.byUsername(n))
      .filter(Boolean)
      .map((a) => ({ ...a! })),
    records: ['alice_a', 'bob_b'].map((n) => JSON.stringify(w.stores.progression['rows'].get(w.ids[n]!) ?? null)),
    bags: ['alice_a', 'bob_b'].map((n) => JSON.stringify(w.stores.inventories.load(w.ids[n]!) ?? null)),
    wallets: ['alice_a', 'bob_b'].map((n) => String(w.inv.wallet(w.ids[n]!, HA))),
    ledger: JSON.stringify(w.stores.ledger.snapshot()),
    sect: JSON.stringify(w.stores.sect.load() ?? null),
    friends: JSON.stringify(w.stores.friends.load() ?? null),
    market: JSON.stringify(w.stores.market.load() ?? null),
  };
}

describe('the restore drill (P5 gate: no data lost in a restore trial)', () => {
  it('plays -> backs up while "running" -> plays more -> crashes -> restores: the state equals the snapshot exactly', async () => {
    const dir = tmp();
    const w1 = open(dir);
    await playFirstSession(w1);

    // BACKUP, taken from the live process memory (the bags are saved first), no flush to disk needed
    const docs = w1.stores.snapshot(() => w1.inv.flushAll());
    const info = createBackup(join(dir, 'backups'), docs, { keep: 5, now: at(1) });
    const expected = stateOf(w1);
    const walletAlice = w1.inv.wallet(w1.ids.alice_a!, HA);
    expect(walletAlice).toBe(8n);

    // MORE WRITES after the snapshot: a new account, more loot, a changed character, and some of it reaches the disk
    const c = await w1.auth.register('carol_c', TEST_ONLY_GOOD, '127.0.0.1');
    w1.ids.carol_c = c.accountId;
    w1.inv.grantDrops(w1.ids.alice_a!, [{ item: 'stone_ha', qty: 100 }], 'elite', 'k99');
    w1.inv.onJoin(w1.ids.carol_c);
    w1.inv.grantDrops(w1.ids.carol_c, [{ item: 'heal_pill', qty: 5 }], 'field', 'k100');
    await w1.stores.progression
      .save({ ...newRecord(w1.ids.alice_a!, ROOT, 'kiem'), exp: 999, version: 9 }, 1)
      .catch(() => undefined);
    w1.stores.sect.save({
      members: [w1.ids.alice_a!, w1.ids.bob_b!],
      manuals: [
        [w1.ids.alice_a!, 'kiem_manual_1'],
        [w1.ids.bob_b!, 'phap_manual_2'],
      ],
    });
    w1.stores.friends.save({ friends: [], requests: [[w1.ids.alice_a!, w1.ids.carol_c!]] });
    w1.inv.flushAll();
    w1.stores.accounts.file.flush();
    w1.stores.flush(); // the later state reaches the disk, then...
    expect(w1.inv.wallet(w1.ids.alice_a!, HA)).toBe(108n);
    // ...CRASH: the process dies in the middle of a write (a torn temp file is left behind), nothing else is flushed
    writeFileSync(join(dir, 'inventories.json.tmp'), '{"v":1,"owners":{"trunc');

    // RESTORE into the same data directory (the server is down; the files are fresh, so the live-write guard is lowered)
    const r = restoreBackup(info.dir, dir, { liveWindowMs: 0 });
    expect(r.preRestoreDir).not.toBeNull();
    expect(readdirSync(r.preRestoreDir!).sort()).toEqual(
      expect.arrayContaining(['accounts.json', 'sect.json', 'friends.json']),
    );

    // the restarted server sees exactly the snapshot
    const w2 = open(dir);
    w2.ids = { ...w1.ids };
    delete w2.ids.carol_c;
    expect(stateOf(w2)).toEqual(expected);
    // the sect and the friends came back exactly as they were at the snapshot, and the later changes are gone (but kept in the safety copy)
    expect(w2.stores.sect.load()).toEqual({ members: [w1.ids.alice_a], manuals: [[w1.ids.alice_a, 'kiem_manual_1']] });
    expect(w2.stores.friends.load()).toEqual({ friends: [[w1.ids.alice_a, w1.ids.bob_b]], requests: [] });
    expect(JSON.parse(read(join(r.preRestoreDir!, 'sect.json'))).members).toHaveLength(2);
    expect(JSON.parse(read(join(r.preRestoreDir!, 'friends.json'))).requests).toHaveLength(1);
    expect(w2.inv.wallet(w2.ids.alice_a!, HA)).toBe(walletAlice);
    expect(w2.stores.accounts.byUsername('carol_c')).toBeUndefined();
    expect(w2.stores.ledger.reconcile()).toEqual([]);
    // password hashes untouched: the same password still logs in, a wrong one does not
    await expect(w2.auth.login('alice_a', TEST_ONLY_GOOD, '127.0.0.1')).resolves.toMatchObject({
      accountId: w1.ids.alice_a,
    });
    await expect(w2.auth.login('alice_a', `${TEST_ONLY_GOOD}x`, '127.0.0.1')).rejects.toBeDefined();
    // and the later state was not thrown away: it is in the safety copy
    const safety = JSON.parse(read(join(r.preRestoreDir!, 'accounts.json'))) as {
      accounts: Array<{ username: string }>;
    };
    expect(safety.accounts.map((a) => a.username)).toContain('carol_c');
    // the restored server keeps working (the ledger accepts new work)
    w2.inv.onJoin(w2.ids.alice_a!);
    expect(() =>
      w2.inv.grantDrops(w2.ids.alice_a!, [{ item: 'stone_ha', qty: 1 }], 'field', 'after-restore'),
    ).not.toThrow();
  });

  it('a live snapshot is ONE moment: the wallet in the ledger and the bag always agree, even with unsaved changes', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    // loot that is only in memory (the bag is saved by the periodic flush, the ledger commits at once)
    w.inv.grantDrops(
      w.ids.alice_a!,
      [
        { item: 'stone_ha', qty: 6 },
        { item: 'heal_pill', qty: 3, quality: 1 },
      ],
      'field',
      'k50',
    );
    const docs = w.stores.snapshot(() => w.inv.flushAll());
    const info = createBackup(join(dir, 'backups'), docs, { now: at(2) });
    expect(info.manifest.counts).toMatchObject({
      accounts: 2,
      characters: 2,
      inventories: 2,
      sectMembers: 1,
      friendships: 1,
      friendRequests: 0,
    });
    expect(Object.keys(info.manifest.files).sort()).toEqual([...DOC_NAMES].sort()); // every store document is in the backup
    // open the backup as a server would: wallet and bag both contain the 6 stones' ledger entry and the 3 extra pills
    const b = tmp();
    for (const n of DOC_NAMES) writeFileSync(join(b, n), read(join(info.dir, n)));
    const w2 = open(b);
    expect(w2.inv.wallet(w.ids.alice_a!, HA)).toBe(w.inv.wallet(w.ids.alice_a!, HA));
    expect(
      w2.inv
        .bagOf(w.ids.alice_a!)
        .count(w.inv.bagOf(w.ids.alice_a!).slots.flatMap((s) => (s && s.kind === 'stack' ? [s.defId] : []))[0]!, 1),
    ).toBeGreaterThan(0);
    expect(w2.stores.ledger.reconcile()).toEqual([]);
  });
});

describe('the document list cannot drift from the file store', () => {
  it('every document openFileStores writes is in STORE_DOC_NAMES (and so in every backup), and nothing else', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w); // touches every store
    const onDisk = readdirSync(dir)
      .filter((n) => n.endsWith('.json'))
      .sort();
    expect(onDisk).toEqual([...STORE_DOC_NAMES].sort());
    expect([...DOC_NAMES]).toEqual([...STORE_DOC_NAMES]);
  });

  it('verify flags sect members and friend entries that name a missing account (counts only) and a restore into a new directory brings both documents back', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    w.stores.sect.save({ members: [w.ids.alice_a!, 'ghost-account'], manuals: [] });
    w.stores.friends.save({ friends: [[w.ids.alice_a!, 'ghost-account']], requests: [] });
    const info = createBackup(
      join(dir, 'backups'),
      w.stores.snapshot(() => w.inv.flushAll()),
      { now: at(7) },
    );
    const v = verifyBackup(info.dir);
    expect(v.ok).toBe(true);
    expect(v.warnings.join(' ')).toMatch(/1 sect member\(s\) without an account/);
    expect(v.warnings.join(' ')).toMatch(/1 friend entry naming a missing account/);
    expect(v.warnings.join(' ')).not.toContain('ghost-account'); // never a name or id
    const fresh = join(tmp(), 'new-data');
    restoreBackup(info.dir, fresh);
    expect(readdirSync(fresh).sort()).toEqual([...STORE_DOC_NAMES].sort());
    const w2 = open(fresh);
    expect(w2.stores.sect.load()?.members).toHaveLength(2);
    expect(w2.stores.friends.load()?.friends).toHaveLength(1);
  });
});

describe('creating backups', () => {
  const docs = (): Docs => readLiveDocs(tmp()); // an empty store: four empty documents

  it('publishes atomically: a crash before the rename leaves no backup and no stray directory, earlier backups are untouched', () => {
    const root = tmp();
    const first = createBackup(root, docs(), { now: at(1) });
    expect(() =>
      createBackup(root, docs(), {
        now: at(2),
        beforePublish: () => {
          throw new Error('power cut');
        },
      }),
    ).toThrow(/power cut/);
    expect(backupIds(root)).toEqual([first.id]);
    expect(readdirSync(root).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
    expect(verifyBackup(first.dir).ok).toBe(true);
  });

  it('a stray staging directory from a real crash is ignored by the listing and cleaned by the next backup', () => {
    const root = tmp();
    createBackup(root, docs(), { now: at(1) });
    writeFileAtomic(join(root, '.tmp-20260101T000000000Z', 'accounts.json'), '{"half');
    expect(backupIds(root)).toHaveLength(1);
    createBackup(root, docs(), { now: at(2) });
    expect(readdirSync(root).filter((n) => n.startsWith('.tmp-'))).toEqual([]);
    expect(backupIds(root)).toHaveLength(2);
  });

  it('rotation keeps the newest N (at least one), oldest first, and never removes the backup it just wrote', () => {
    const root = tmp();
    const made = [1, 2, 3, 4, 5].map((k) => createBackup(root, docs(), { keep: 3, now: at(k) }));
    expect(backupIds(root)).toEqual(made.slice(2).map((m) => m.id));
    expect(made[3]!.removed).toEqual([made[0]!.id]);
    expect(rotateBackups(root, 0)).toHaveLength(2); // keep < 1 still keeps one
    expect(backupIds(root)).toEqual([made[4]!.id]);
  });

  it('two backups in the same millisecond get distinct ids', () => {
    const root = tmp();
    const a = createBackup(root, docs(), { now: at(1) });
    const b = createBackup(root, docs(), { now: at(1) });
    expect(a.id).not.toBe(b.id);
    expect(backupIds(root)).toHaveLength(2);
  });

  it('refuses to back up documents the server could not load, and writes nothing', () => {
    const root = tmp();
    const bad = { ...docs(), 'accounts.json': JSON.stringify({ v: 7, accounts: [] }) };
    expect(() => createBackup(root, bad, { now: at(1) })).toThrow(BackupError);
    expect(backupIds(root)).toEqual([]);
    expect(readdirSync(root)).toEqual([]);
  });

  it('the manifest carries counts and checksums only: no account name, no hash', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const info = createBackup(
      join(dir, 'backups'),
      w.stores.snapshot(() => w.inv.flushAll()),
      { now: at(1) },
    );
    const text = read(join(info.dir, 'manifest.json'));
    const m = JSON.parse(text) as BackupManifest;
    expect(m).toMatchObject({ format: 'vgtd-backup', v: 1, source: 'live' });
    expect(Object.keys(m.files).sort()).toEqual([...DOC_NAMES].sort());
    const hash = w.stores.accounts.byUsername('alice_a')!.passwordHash;
    expect(text).not.toContain(hash);
    expect(text).not.toContain('alice_a');
  });

  it('readLiveDocs: a missing document is an empty one, a torn main file falls back to the .bak, and an unreadable pair refuses', () => {
    const d = tmp();
    const docsEmpty = readLiveDocs(d);
    expect(JSON.parse(docsEmpty['accounts.json'])).toEqual({ v: 1, accounts: [] });
    writeFileAtomic(join(d, 'accounts.json'), JSON.stringify({ v: 1, accounts: [] }));
    writeFileAtomic(join(d, 'accounts.json'), JSON.stringify({ v: 1, accounts: [], marker: 2 }));
    writeFileSync(join(d, 'accounts.json'), '{"torn');
    expect(readLiveDocs(d)['accounts.json']).toContain('"v":1'); // the .bak
    writeFileSync(join(d, 'accounts.json.bak'), 'also torn');
    expect(() => readLiveDocs(d)).toThrow(BackupError);
  });
});

describe('verifying', () => {
  async function made(): Promise<{ root: string; info: ReturnType<typeof createBackup>; w: World; dir: string }> {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const info = createBackup(
      join(dir, 'backups'),
      w.stores.snapshot(() => w.inv.flushAll()),
      { now: at(1) },
    );
    return { root: join(dir, 'backups'), info, w, dir };
  }

  it('a good backup verifies with counts; a flipped byte, a missing file and a wrong manifest are caught', async () => {
    const { info } = await made();
    const ok = verifyBackup(info.dir);
    expect(ok).toMatchObject({ ok: true, problems: [], counts: { accounts: 2, characters: 2, inventories: 2 } });
    const f = join(info.dir, 'accounts.json');
    const original = read(f);
    writeFileSync(f, original.replace('alice_a', 'alice_b'));
    expect(verifyBackup(info.dir).problems.join(' ')).toMatch(/accounts\.json: checksum differs/);
    writeFileSync(f, original);
    rmSync(join(info.dir, 'ledger.json'));
    expect(verifyBackup(info.dir).problems).toContain('ledger.json: missing');
    expect(verifyBackup(join(info.dir, 'nope')).ok).toBe(false);
  });

  it('a document with a newer data version is refused even when its checksum is right (same loaders as the server)', async () => {
    const { info } = await made();
    const m = JSON.parse(read(join(info.dir, 'manifest.json'))) as BackupManifest;
    const bad = JSON.stringify({ v: 2, accounts: [] });
    writeFileSync(join(info.dir, 'accounts.json'), bad);
    const { createHash } = await import('node:crypto');
    m.files['accounts.json'] = {
      bytes: Buffer.byteLength(bad),
      sha256: createHash('sha256').update(bad).digest('hex'),
    };
    writeFileSync(join(info.dir, 'manifest.json'), JSON.stringify(m));
    const r = verifyBackup(info.dir);
    expect(r.ok).toBe(false);
    expect(r.problems.join(' ')).toMatch(/unsupported data version 2/);
  });

  it('an unsupported backup format version is refused', async () => {
    const { info } = await made();
    const m = JSON.parse(read(join(info.dir, 'manifest.json'))) as Record<string, unknown>;
    writeFileSync(join(info.dir, 'manifest.json'), JSON.stringify({ ...m, v: 2 }));
    expect(verifyBackup(info.dir).problems.join(' ')).toMatch(/unsupported backup version 2/);
  });

  it('validateDocs finds an unbalanced ledger and an inconsistent bag, and warns about records without an account', async () => {
    const { w } = await made();
    const docs = w.stores.snapshot(() => w.inv.flushAll());
    const ledger = JSON.parse(docs['ledger.json']) as {
      entries: Array<{ txId: number; accountKey: string; delta: string }>;
    };
    ledger.entries.push({ txId: 999, accountKey: ledger.entries[0]!.accountKey, delta: '5' });
    expect(validateDocs({ ...docs, 'ledger.json': JSON.stringify(ledger) }).problems.length).toBeGreaterThan(0);
    const inv = JSON.parse(docs['inventories.json']) as { owners: Record<string, { bag: { slots: unknown[] } }> };
    const owner = Object.keys(inv.owners)[0]!;
    inv.owners[owner]!.bag.slots[0] = { kind: 'instance', id: 'ghost' };
    expect(validateDocs({ ...docs, 'inventories.json': JSON.stringify(inv) }).problems.join(' ')).toMatch(/bag #1/);
    const orphan = JSON.parse(docs['progression.json']) as { records: Array<Record<string, unknown>> };
    orphan.records.push({ ...orphan.records[0]!, characterId: 'ghost-account' });
    expect(validateDocs({ ...docs, 'progression.json': JSON.stringify(orphan) }).warnings.join(' ')).toMatch(
      /without an account/,
    );
  });
});

describe('restoring', () => {
  it('an invalid backup changes nothing in the data directory', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const info = createBackup(
      join(dir, 'backups'),
      w.stores.snapshot(() => w.inv.flushAll()),
      { now: at(1) },
    );
    writeFileSync(join(info.dir, 'inventories.json'), '{"v":1,"owners":{}}'); // tampered after the fact
    const before = DOC_NAMES.map((n) => read(join(dir, n)));
    expect(() => restoreBackup(info.dir, dir, { force: true })).toThrow(/does not verify/);
    expect(DOC_NAMES.map((n) => read(join(dir, n)))).toEqual(before);
    expect(readdirSync(dir).filter((n) => n.startsWith('pre-restore-') || n.startsWith('.restore-stage-'))).toEqual([]);
  });

  it('refuses a data directory that was just written (a running server would overwrite the restore) unless forced', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const info = createBackup(
      join(dir, 'backups'),
      w.stores.snapshot(() => w.inv.flushAll()),
      { now: at(1) },
    );
    expect(() => restoreBackup(info.dir, dir)).toThrow(/is the server still running/);
    const old = new Date(Date.now() - 60_000);
    for (const n of DOC_NAMES) utimesSync(join(dir, n), old, old);
    expect(() => restoreBackup(info.dir, dir)).not.toThrow();
  });

  it.each(['staged', 'moved', 'installed'] as const)(
    'a failure after the %s step leaves the data directory byte-identical (nothing deleted for good)',
    async (step) => {
      const dir = tmp();
      const w = open(dir);
      await playFirstSession(w);
      const info = createBackup(
        join(dir, 'backups'),
        w.stores.snapshot(() => w.inv.flushAll()),
        { now: at(1) },
      );
      // later state, so the restore would change every file
      await w.auth.register('carol_c', TEST_ONLY_GOOD, '127.0.0.1');
      w.stores.flush();
      const names = (): string[] =>
        readdirSync(dir)
          .filter((n) => n !== 'backups')
          .sort();
      const before = names().map((n) => [n, read(join(dir, n))]);
      expect(() =>
        restoreBackup(info.dir, dir, {
          force: true,
          onStep: (s) => {
            if (s === step) throw new Error('disk full');
          },
        }),
      ).toThrow(/disk full/);
      expect(names().map((n) => [n, read(join(dir, n))])).toEqual(before);
    },
  );

  it('restores into an empty / new directory (disaster recovery) and leaves no staging directory behind', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const info = createBackup(
      join(dir, 'backups'),
      w.stores.snapshot(() => w.inv.flushAll()),
      { now: at(1) },
    );
    const fresh = join(tmp(), 'new-data');
    const r = restoreBackup(info.dir, fresh);
    expect(r.preRestoreDir).toBeNull();
    expect(readdirSync(fresh).sort()).toEqual([...DOC_NAMES].sort());
    const w2 = open(fresh);
    expect(w2.stores.accounts.byUsername('bob_b')).toBeDefined();
    expect(existsSync(join(fresh, 'pre-restore-x'))).toBe(false);
    expect(statSync(fresh).isDirectory()).toBe(true);
  });
});

describe('the operator CLI', () => {
  const io = () => {
    const out: string[] = [];
    const err: string[] = [];
    return { out, err, io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) } };
  };

  it('backup -> list -> verify -> (more writes) -> restore --yes: exit codes, rotation and the restored state', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const opts = ['--data-dir', dir, '--keep', '2'];
    const a = io();
    expect(runCli(['backup', ...opts], a.io, {})).toBe(0);
    expect(a.out.join('\n')).toMatch(/backup \d{8}T\d{9}Z written/);
    expect(runCli(['backup', ...opts], io().io, {})).toBe(0);
    expect(runCli(['backup', ...opts], io().io, {})).toBe(0);
    const l = io();
    expect(runCli(['list', '--data-dir', dir], l.io, {})).toBe(0);
    expect(l.out[0]).toMatch(/^2 backup\(s\)/); // rotated down to --keep 2
    const v = io();
    expect(runCli(['verify', '--data-dir', dir, '--from', 'latest'], v.io, {})).toBe(0);
    expect(v.out[0]).toMatch(/^OK:/);
    expect(runCli(['verify', '--data-dir', dir], io().io, {})).toBe(0); // the live documents

    // more writes, a crash, then restore from the latest backup
    const expected = stateOf(w);
    await w.auth.register('carol_c', TEST_ONLY_GOOD, '127.0.0.1');
    w.stores.flush();
    const refused = io();
    expect(runCli(['restore', '--from', 'latest', ...opts], refused.io, {})).toBe(1); // no --yes
    expect(refused.err.join(' ')).toMatch(/--yes/);
    const done = io();
    expect(runCli(['restore', '--from', 'latest', '--yes', '--force', ...opts], done.io, {})).toBe(0);
    expect(done.out.join('\n')).toMatch(/restored .*backup-/);
    const w2 = open(dir);
    w2.ids = { alice_a: w.ids.alice_a!, bob_b: w.ids.bob_b! };
    expect(stateOf(w2)).toEqual(expected);
  });

  it('usage errors are exit 1, a bad or tampered backup is exit 2, and nothing printed contains a password hash', async () => {
    const dir = tmp();
    const w = open(dir);
    await playFirstSession(w);
    const hash = w.stores.accounts.byUsername('alice_a')!.passwordHash;
    const all: string[] = [];
    const run = (argv: string[]): number => {
      const c = io();
      const code = runCli(argv, c.io, {});
      all.push(...c.out, ...c.err);
      return code;
    };
    expect(run([])).toBe(1);
    expect(run(['frobnicate'])).toBe(1);
    expect(run(['backup', '--keep', '0', '--data-dir', dir])).toBe(1);
    expect(run(['backup', '--bogus'])).toBe(1);
    expect(run(['restore', '--data-dir', dir])).toBe(1); // no --from
    expect(run(['backup', '--data-dir', dir])).toBe(0);
    expect(run(['verify', '--data-dir', dir, '--from', 'latest'])).toBe(0);
    expect(run(['verify', '--data-dir', dir, '--from', 'does-not-exist'])).toBe(2);
    const id = backupIds(join(dir, 'backups'))[0]!;
    writeFileSync(join(dir, 'backups', `backup-${id}`, 'accounts.json'), '{"v":1,"accounts":[]}');
    expect(run(['verify', '--data-dir', dir, '--from', id])).toBe(2);
    expect(run(['restore', '--from', id, '--yes', '--force', '--data-dir', dir])).toBe(2);
    expect(all.join('\n')).not.toContain(hash);
    expect(all.join('\n')).not.toContain('alice_a');
  });
});
