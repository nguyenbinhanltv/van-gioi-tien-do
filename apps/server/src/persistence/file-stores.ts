/**
 * File-backed implementations of the store seams (D92): accounts, progression (character state incl. class) and inventories + ledger.
 * `STORE=file DATA_DIR=...` makes `npm run play` keep its players across restarts. Nothing here is a database: one JSON document per
 * store, written atomically and lazily (see `DocFile`), loaded fully at startup; fine for play-tests and a few thousand characters.
 * The production adapter is PostgreSQL behind the SAME interfaces (docs/08, docs/23); see the adapter notes in D92.
 *
 * What is NOT persisted: resume tokens and access tokens (a restart makes every client log in again, which the NetClient does by
 * itself), the progression roll log and the ledger idempotency keys (process lifetime only, see `Ledger.snapshot`).
 * Secrets: the account document holds scrypt password HASHES only (`Account.passwordHash`); there is no plaintext password anywhere.
 */
import { join } from 'node:path';
import type { Account, AccountStore } from '../auth/accounts.js';
import type { SectSnapshot, SectStore } from '../sect/store.js';
import type { FriendSnapshot, FriendStore } from '../friends/store.js';
import type { MarketSnapshot, MarketStore } from '../market/store.js';
import type { ProgressRecord } from '../progression/state.js';
import type { ProgressionStore } from '../progression/store.js';
import { Ledger, type LedgerSnapshot } from '../world/inventory/ledger.js';
import type { InventorySnapshot, InventoryStore } from '../world/inventory/store.js';
import type { TutorialRecord, TutorialStore } from '../tutorial/store.js';
import { TUTORIAL_ALL_MASK } from '@vgtd/shared';
import { readJsonFile, removeStray } from './atomic.js';
import { TxJournal, recoverJournal, type JournalOptions } from './journal.js';
import { DocFile, type DocFileOptions } from './doc-file.js';

const VERSION = 1;

function load<T>(path: string, what: string, check: (doc: Record<string, unknown>) => T): T | undefined {
  removeStray(path);
  const raw = readJsonFile(path);
  if (raw === undefined) return undefined;
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new Error(`${what}: not a JSON object`);
  const doc = raw as Record<string, unknown>;
  if (doc.v !== VERSION)
    throw new Error(
      `${what}: unsupported data version ${String(doc.v)} (this server reads ${VERSION}); refusing to start`,
    );
  return check(doc);
}

const isStr = (x: unknown): x is string => typeof x === 'string';
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);

function checkAccount(a: unknown): Account {
  const o = a as Record<string, unknown>;
  if (
    typeof a !== 'object' ||
    a === null ||
    !isStr(o.id) ||
    !isStr(o.username) ||
    !isStr(o.passwordHash) ||
    !isNum(o.tokenVersion) ||
    !isNum(o.failures) ||
    !isNum(o.lockedUntilMs) ||
    !isNum(o.lockLevel)
  )
    throw new Error('accounts: malformed account record');
  return {
    id: o.id,
    username: o.username,
    passwordHash: o.passwordHash,
    tokenVersion: o.tokenVersion,
    failures: 0, // transient (counts attempts still being verified): a restart starts with none in flight, see `serializeAccount`
    lockedUntilMs: o.lockedUntilMs,
    lockLevel: o.lockLevel,
  };
}

/**
 * `failures` is NOT persisted: the service increments it while a login is still being verified (so parallel guesses cannot beat the
 * limit) and decrements it again afterwards. A write that lands in that window would otherwise store an in-flight attempt as a real
 * failure, and a crash before the matching decrement would lock the account for good (the `failures >= LOCK_AFTER_FAILURES` check
 * has no expiry). The settled lockout state, `lockedUntilMs` and `lockLevel`, is what must survive a restart.
 */
const serializeAccount = (a: Account): Account => ({ ...a, failures: 0 });

export class FileAccountStore implements AccountStore {
  private readonly byName = new Map<string, Account>();
  private readonly ids = new Map<string, Account>();
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    const doc = load(path, 'accounts', (d) => {
      if (!Array.isArray(d.accounts)) throw new Error('accounts: missing list');
      return d.accounts.map(checkAccount);
    });
    for (const a of doc ?? []) {
      this.byName.set(a.username, a);
      this.ids.set(a.id, a);
    }
    this.file = new DocFile(
      path,
      () => JSON.stringify({ v: VERSION, accounts: [...this.byName.values()].map(serializeAccount) }),
      opts,
    );
  }
  create(a: Account): boolean {
    if (this.byName.has(a.username)) return false;
    this.byName.set(a.username, a);
    this.ids.set(a.id, a);
    this.file.markDirty();
    return true;
  }
  /** The service mutates the account object it got (lockout counters, rehash): it tells the store when that must reach the disk. */
  save(a: Account): void {
    if (this.ids.get(a.id) === a) this.file.markDirty();
  }
  byUsername(u: string): Account | undefined {
    return this.byName.get(u);
  }
  byId(id: string): Account | undefined {
    return this.ids.get(id);
  }
}

export class FileProgressionStore implements ProgressionStore {
  private readonly rows = new Map<string, ProgressRecord>();
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    const doc = load(path, 'progression', (d) => {
      if (!Array.isArray(d.records)) throw new Error('progression: missing records');
      return d.records as ProgressRecord[];
    });
    for (const r of doc ?? []) {
      if (typeof r?.characterId !== 'string' || !isNum(r.version)) throw new Error('progression: malformed record');
      this.rows.set(r.characterId, r);
    }
    this.file = new DocFile(path, () => JSON.stringify({ v: VERSION, records: [...this.rows.values()] }), opts);
  }
  async load(characterId: string): Promise<ProgressRecord | undefined> {
    const r = this.rows.get(characterId);
    return r ? structuredClone(r) : undefined;
  }
  async save(record: ProgressRecord, expectedVersion: number): Promise<boolean> {
    if ((this.rows.get(record.characterId)?.version ?? 0) !== expectedVersion) return false;
    this.rows.set(record.characterId, structuredClone(record));
    this.file.markDirty();
    return true;
  }
}

export class FileInventoryStore implements InventoryStore {
  private readonly rows = new Map<string, InventorySnapshot>();
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    const doc = load(path, 'inventories', (d) => {
      if (typeof d.owners !== 'object' || d.owners === null || Array.isArray(d.owners))
        throw new Error('inventories: missing owners');
      return d.owners as Record<string, InventorySnapshot>;
    });
    for (const [owner, snap] of Object.entries(doc ?? {})) {
      if ((snap as { v?: unknown } | null)?.v !== 1)
        throw new Error(`inventories: unsupported snapshot version for ${owner}`);
      this.rows.set(owner, snap);
    }
    this.file = new DocFile(path, () => JSON.stringify({ v: VERSION, owners: Object.fromEntries(this.rows) }), opts);
  }
  load(owner: string): InventorySnapshot | undefined {
    const s = this.rows.get(owner);
    return s === undefined ? undefined : structuredClone(s);
  }
  save(owner: string, snap: InventorySnapshot): void {
    // `InventoryService.flushAll()` (the periodic save of online players) re-saves unchanged bags: that must not cost a disk write
    const prev = this.rows.get(owner);
    if (prev !== undefined && JSON.stringify(prev) === JSON.stringify(snap)) return;
    this.rows.set(owner, structuredClone(snap));
    this.file.markDirty();
  }
}

/** Tutorial progress (D105): one tiny record per account. */
export class FileTutorialStore implements TutorialStore {
  private readonly rows = new Map<string, TutorialRecord>();
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    const doc = load(path, 'tutorial', (d) => {
      if (!Array.isArray(d.records)) throw new Error('tutorial: missing records');
      return d.records as unknown[];
    });
    for (const r of doc ?? []) {
      const o = r as Record<string, unknown>;
      if (
        typeof r !== 'object' ||
        r === null ||
        !isStr(o.accountId) ||
        !isNum(o.done) ||
        !Number.isInteger(o.done) ||
        o.done < 0 ||
        o.done > TUTORIAL_ALL_MASK ||
        !isNum(o.kills) ||
        typeof o.skipped !== 'boolean' ||
        typeof o.complete !== 'boolean' ||
        !isNum(o.sessions)
      )
        throw new Error('tutorial: malformed record');
      this.rows.set(o.accountId, {
        accountId: o.accountId,
        done: o.done,
        kills: o.kills,
        skipped: o.skipped,
        complete: o.complete,
        sessions: o.sessions,
      });
    }
    this.file = new DocFile(path, () => JSON.stringify({ v: VERSION, records: [...this.rows.values()] }), opts);
  }
  load(accountId: string): TutorialRecord | undefined {
    const r = this.rows.get(accountId);
    return r ? { ...r } : undefined;
  }
  save(record: TutorialRecord): void {
    const prev = this.rows.get(record.accountId);
    if (prev && JSON.stringify(prev) === JSON.stringify(record)) return;
    this.rows.set(record.accountId, { ...record });
    this.file.markDirty();
  }
  all(): TutorialRecord[] {
    return [...this.rows.values()].map((r) => ({ ...r }));
  }
}

/** Sect membership and bought manuals (D98): account ids and skill ids, see `SectSnapshot`. The Cống hiến balance is in the ledger. */
export class FileSectStore implements SectStore {
  private snap: SectSnapshot | undefined;
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    this.snap = load(path, 'sect', (d) => {
      if (!Array.isArray(d.members) || !d.members.every(isStr)) throw new Error('sect: malformed members');
      if (!Array.isArray(d.manuals)) throw new Error('sect: missing manuals');
      const manuals = d.manuals.map((p: unknown): [string, string] => {
        if (!Array.isArray(p) || p.length !== 2 || !isStr(p[0]) || !isStr(p[1]))
          throw new Error('sect: malformed manuals entry');
        return [p[0], p[1]];
      });
      return { members: d.members as string[], manuals };
    });
    this.file = new DocFile(
      path,
      () => JSON.stringify({ v: VERSION, members: this.snap?.members ?? [], manuals: this.snap?.manuals ?? [] }),
      opts,
    );
  }
  load(): SectSnapshot | undefined {
    return this.snap === undefined ? undefined : structuredClone(this.snap);
  }
  save(s: SectSnapshot): void {
    if (this.snap !== undefined && JSON.stringify(this.snap) === JSON.stringify(s)) return;
    this.snap = structuredClone(s);
    this.file.markDirty();
  }
}

/** Friendships and pending requests (D96): account id pairs, see `FriendSnapshot`. */
export class FileFriendStore implements FriendStore {
  private snap: FriendSnapshot | undefined;
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    const pairs = (v: unknown, what: string): [string, string][] => {
      if (!Array.isArray(v)) throw new Error(`friends: missing ${what}`);
      return v.map((p) => {
        if (!Array.isArray(p) || p.length !== 2 || !isStr(p[0]) || !isStr(p[1]))
          throw new Error(`friends: malformed ${what} entry`);
        return [p[0], p[1]];
      });
    };
    this.snap = load(path, 'friends', (d) => ({
      friends: pairs(d.friends, 'friends'),
      requests: pairs(d.requests, 'requests'),
    }));
    this.file = new DocFile(
      path,
      () => JSON.stringify({ v: VERSION, friends: this.snap?.friends ?? [], requests: this.snap?.requests ?? [] }),
      opts,
    );
  }
  load(): FriendSnapshot | undefined {
    return this.snap === undefined ? undefined : structuredClone(this.snap);
  }
  save(s: FriendSnapshot): void {
    if (this.snap !== undefined && JSON.stringify(this.snap) === JSON.stringify(s)) return;
    this.snap = structuredClone(s);
    this.file.markDirty();
  }
}

/** The market book (D112): active listings (each one holds its escrowed item), recent sales and the weekly shadow reports, see `MarketSnapshot`. */
export class FileMarketStore implements MarketStore {
  private snap: MarketSnapshot | undefined;
  readonly file: DocFile;
  constructor(path: string, opts: DocFileOptions = {}) {
    const arr = (v: unknown, what: string): Record<string, unknown>[] => {
      if (!Array.isArray(v)) throw new Error(`market: missing ${what}`);
      return v.map((x) => {
        if (typeof x !== 'object' || x === null || Array.isArray(x)) throw new Error(`market: malformed ${what} entry`);
        return x as Record<string, unknown>;
      });
    };
    this.snap = load(path, 'market', (d) => {
      if (!isNum(d.nextId) || d.nextId < 1) throw new Error('market: missing nextId');
      const listings = arr(d.listings, 'listings').map((l) => {
        const it = l.item as Record<string, unknown> | undefined;
        if (
          !isNum(l.id) ||
          !isStr(l.seller) ||
          !it ||
          !isNum(it.defId) ||
          !isNum(it.quality) ||
          !isNum(it.qty) ||
          !isNum(l.unitPrice) ||
          !isNum(l.listedAt) ||
          !isNum(l.expiresAt) ||
          (l.state !== 'active' && l.state !== 'returning')
        )
          throw new Error('market: malformed listing');
        return l as unknown as MarketSnapshot['listings'][number];
      });
      for (const t of arr(d.trades, 'trades'))
        if (![t.at, t.defId, t.quality, t.qty, t.unitPrice, t.total, t.tax].every(isNum))
          throw new Error('market: malformed trade');
      for (const r of arr(d.reports, 'reports'))
        if (![r.week, r.appliedBps, r.shadowBps, r.trades, r.volume].every(isNum) || !(r.cpi === null || isNum(r.cpi)))
          throw new Error('market: malformed report');
      return {
        v: 1 as const,
        nextId: d.nextId,
        listings,
        trades: d.trades as MarketSnapshot['trades'],
        reports: d.reports as MarketSnapshot['reports'],
      };
    });
    this.file = new DocFile(
      path,
      () =>
        JSON.stringify({
          v: VERSION,
          nextId: this.snap?.nextId ?? 1,
          listings: this.snap?.listings ?? [],
          trades: this.snap?.trades ?? [],
          reports: this.snap?.reports ?? [],
        }),
      opts,
    );
  }
  load(): MarketSnapshot | undefined {
    return this.snap === undefined ? undefined : structuredClone(this.snap);
  }
  save(s: MarketSnapshot): void {
    if (this.snap !== undefined && JSON.stringify(this.snap) === JSON.stringify(s)) return;
    this.snap = structuredClone(s);
    this.file.markDirty();
  }
}

/** The ledger lives in its own document (docs/23 §4.4: separate from the inventory snapshots). */
export function openFileLedger(path: string, opts: DocFileOptions = {}): { ledger: Ledger; file: DocFile } {
  const snap = load(path, 'ledger', (d) => d as unknown as LedgerSnapshot);
  const ledger = snap ? Ledger.restore({ ...snap, v: 1 }) : new Ledger();
  const file = new DocFile(path, () => JSON.stringify({ ...ledger.snapshot(), v: VERSION }), opts);
  ledger.onCommit = () => file.markDirty();
  return { ledger, file };
}

/**
 * Every document of the data directory, by file name. THE one list: backup, restore, verify and the live snapshot all use it, so a document
 * added to `openFileStores` cannot be forgotten by them (the sect and friends documents were, until D99 was reviewed).
 */
export const STORE_DOC_NAMES = [
  'accounts.json',
  'progression.json',
  'inventories.json',
  'tutorial.json',
  'sect.json',
  'friends.json',
  'market.json',
  'ledger.json',
] as const;
export type StoreDocName = (typeof STORE_DOC_NAMES)[number];
/** The store documents as text, by file name. */
export type StoreDocs = Record<StoreDocName, string>;

export interface FileStores {
  accounts: FileAccountStore;
  progression: FileProgressionStore;
  inventories: FileInventoryStore;
  tutorial: FileTutorialStore;
  sect: FileSectStore;
  friends: FileFriendStore;
  market: FileMarketStore;
  ledger: Ledger;
  /** write every document now (shutdown, tests) */
  flush(): void;
  /**
   * Every document as text, serialised in ONE synchronous turn: nothing can change between them, so they always describe the same
   * moment (a drop never shows in the ledger but not in the bag). `prepare` runs first (the server passes the save of online bags).
   * This is what a live backup is made of (D99); it does not touch the files on disk.
   */
  snapshot(prepare?: () => void): StoreDocs;
  readonly dir: string;
  /**
   * Make the current state of several documents durable as ONE unit (write-ahead journal, `TxJournal`): after a crash either all of it or none
   * of it is on disk. Used by a trade (bags + ledger); a sect purchase (sect + ledger) or an item use (bag + ledger) can use it too.
   */
  commitAtomic(label: string, docs: readonly DocFile[]): void;
  /** The hook `InventoryService` calls after an exchange: commits the inventories and the ledger together. */
  readonly durable: { commit(label: string): void };
  /**
   * The hook `MarketService` calls after every change of the book (D112): commits `market.json`, `inventories.json` and `ledger.json` together, so a
   * crash can never leave the listing, the stones and the item disagreeing (a sale that is half on disk would be an item dupe or a lost payment).
   */
  readonly durableMarket: { commit(label: string): void };
  /** True while a multi-document commit's journal is still waiting to be finished after an error (it is finished before the next write). */
  readonly journalPending: () => boolean;
  /** The journal recovered at open (the label of the interrupted commit it finished), or null. */
  readonly recovered: string | null;
}

/** Open (or create) the data directory: `accounts.json`, `progression.json`, `inventories.json`, `sect.json`, `tutorial.json`, `friends.json`, `market.json`, `ledger.json`. */
export function openFileStores(dir: string, opts: DocFileOptions & JournalOptions = {}): FileStores {
  // FIRST finish a commit a crash interrupted: every document below is then loaded in its committed state
  const recovered = recoverJournal(dir);
  const journal = new TxJournal(dir, opts);
  // every ordinary document write first finishes a pending journal (see `DocFileOptions.beforeWrite`)
  opts = { ...opts, beforeWrite: () => journal.settle() };
  const accounts = new FileAccountStore(join(dir, 'accounts.json'), opts);
  const progression = new FileProgressionStore(join(dir, 'progression.json'), opts);
  const inventories = new FileInventoryStore(join(dir, 'inventories.json'), opts);
  const sect = new FileSectStore(join(dir, 'sect.json'), opts);
  const tutorial = new FileTutorialStore(join(dir, 'tutorial.json'), opts);
  const friends = new FileFriendStore(join(dir, 'friends.json'), opts);
  const market = new FileMarketStore(join(dir, 'market.json'), opts);
  const { ledger, file: ledgerFile } = openFileLedger(join(dir, 'ledger.json'), opts);
  const commitAtomic = (label: string, docs: readonly DocFile[]): void => journal.commit(label, docs);
  return {
    accounts,
    progression,
    inventories,
    tutorial,
    sect,
    friends,
    market,
    ledger,
    dir,
    recovered,
    commitAtomic,
    journalPending: () => journal.pending,
    durable: { commit: (label) => commitAtomic(label, [inventories.file, ledgerFile]) },
    durableMarket: { commit: (label) => commitAtomic(label, [market.file, inventories.file, ledgerFile]) },
    flush: () => {
      accounts.file.flush();
      progression.file.flush();
      inventories.file.flush();
      tutorial.file.flush();
      sect.file.flush();
      friends.file.flush();
      market.file.flush();
      ledgerFile.flush();
    },
    snapshot: (prepare) => {
      prepare?.();
      return {
        'accounts.json': accounts.file.serializeNow(),
        'progression.json': progression.file.serializeNow(),
        'inventories.json': inventories.file.serializeNow(),
        'tutorial.json': tutorial.file.serializeNow(),
        'sect.json': sect.file.serializeNow(),
        'friends.json': friends.file.serializeNow(),
        'market.json': market.file.serializeNow(),
        'ledger.json': ledgerFile.serializeNow(),
      };
    },
  };
}
