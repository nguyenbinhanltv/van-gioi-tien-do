/**
 * Backup and restore of the file store (D99, P5).
 *
 * A backup is a directory `backup-<id>/` holding every store document (`STORE_DOC_NAMES`: accounts, progression, inventories, sect, friends,
 * ledger) and a `manifest.json` (format, version, creation time, size + sha256 of every document, and COUNTS only).
 *
 *  - Consistent: a live backup is made from `FileStores.snapshot()`, which serialises all four documents in ONE synchronous turn, so
 *    the files describe the same moment (never a ledger newer than the bags). `readLiveDocs` is the offline / cold copy of the files on
 *    disk: it re-reads until two reads are identical, so a file replaced while it was being copied is retried, never torn.
 *  - Atomic: everything is written into `.tmp-<id>/` (every file fsynced), then the directory is renamed to `backup-<id>/` and the parent
 *    is fsynced. A crash leaves either no new backup or a complete one; a stray `.tmp-*` is ignored and removed by the next backup.
 *  - Rotation: after a successful backup only the newest `keep` backups stay (never fewer than one).
 *  - Restore: the backup is verified (manifest, sha256, then the documents are opened by the SAME loaders the server uses, so version
 *    and schema are checked, the ledger is reconciled, bags are checked) before anything is touched; the current files are moved to
 *    `pre-restore-<id>/` (a safety copy), the verified documents are renamed into place, and the result is checked again.
 *
 * Secrets: the documents hold scrypt password HASHES. Nothing here prints document content: reports and errors carry file names,
 * counts and problem descriptions only. Files and directories are created with mode 0600 / 0700.
 */
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Bag } from '../world/inventory/bag.js';
import { INVENTORY_CONFIG } from '../world/inventory/service.js';
import type { InventorySnapshot } from '../world/inventory/store.js';
import { Ledger } from '../world/inventory/ledger.js';
import { STORE_DOC_NAMES, openFileStores, type StoreDocs } from './file-stores.js';

export const BACKUP_FORMAT = 'vgtd-backup';
export const BACKUP_VERSION = 1;
export const DOC_NAMES = STORE_DOC_NAMES;
export type DocName = (typeof DOC_NAMES)[number];
export type Docs = StoreDocs;

export interface BackupCounts {
  accounts: number;
  characters: number;
  inventories: number;
  ledgerAccounts: number;
  ledgerEntries: number;
  /** sect members / friendships / pending requests (D98, D96): counts only, no names */
  sectMembers: number;
  friendships: number;
  friendRequests: number;
}
export interface BackupManifest {
  format: typeof BACKUP_FORMAT;
  v: typeof BACKUP_VERSION;
  id: string;
  /** wall-clock ISO time of the backup (operations code, not simulation) */
  createdAt: string;
  /** `live`: from the running server's memory; `offline`: copied from the files on disk */
  source: 'live' | 'offline';
  files: Record<DocName, { bytes: number; sha256: string }>;
  counts: BackupCounts;
}

export class BackupError extends Error {
  constructor(
    message: string,
    readonly problems: string[] = [],
  ) {
    super(message);
  }
}

const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');

/** What an empty (first-start) store would hold, for a document that does not exist yet. */
const EMPTY_DOCS: Docs = {
  'accounts.json': JSON.stringify({ v: 1, accounts: [] }),
  'progression.json': JSON.stringify({ v: 1, records: [] }),
  'inventories.json': JSON.stringify({ v: 1, owners: {} }),
  'sect.json': JSON.stringify({ v: 1, members: [], manuals: [] }),
  'friends.json': JSON.stringify({ v: 1, friends: [], requests: [] }),
  'market.json': JSON.stringify({ v: 1, nextId: 1, listings: [], trades: [], reports: [] }),
  'ledger.json': JSON.stringify({ ...new Ledger().snapshot(), v: 1 }),
};

function writeSynced(file: string, data: string): void {
  const fd = openSync(file, 'w', 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
}
function fsyncDir(dir: string): void {
  try {
    const d = openSync(dir, 'r');
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  } catch {
    // not supported on every platform / filesystem (Windows): the files themselves are already synced
  }
}

// ---------------------------------------------------------------------------------------------------- validation
export interface DocsReport {
  /** the documents cannot be loaded by the server (empty = they can) */
  problems: string[];
  /** suspicious but loadable */
  warnings: string[];
  counts: BackupCounts;
}

/**
 * Open the documents with the server's own loaders in a scratch directory (version + schema checks, ledger I1-I3, bag consistency).
 * Returns descriptions only: never document content.
 */
export function validateDocs(docs: Docs): DocsReport {
  const problems: string[] = [];
  const warnings: string[] = [];
  const counts: BackupCounts = {
    accounts: 0,
    characters: 0,
    inventories: 0,
    ledgerAccounts: 0,
    ledgerEntries: 0,
    sectMembers: 0,
    friendships: 0,
    friendRequests: 0,
  };
  const scratch = mkdtempSync(join(tmpdir(), 'vgtd-validate-'));
  try {
    const parsed: Record<string, Record<string, unknown>> = {};
    for (const name of DOC_NAMES) {
      try {
        const j = JSON.parse(docs[name]) as unknown;
        if (typeof j !== 'object' || j === null || Array.isArray(j)) throw new Error('not a JSON object');
        parsed[name] = j as Record<string, unknown>;
        writeSynced(join(scratch, name), docs[name]);
      } catch (e) {
        problems.push(`${name}: ${e instanceof Error ? e.message : 'unreadable'}`);
      }
    }
    if (problems.length > 0) return { problems, warnings, counts };
    try {
      const stores = openFileStores(scratch, { flushMs: -1 }); // throws on a wrong version / malformed record / inconsistent ledger
      void stores;
    } catch (e) {
      problems.push(e instanceof Error ? e.message : 'the documents cannot be loaded');
      return { problems, warnings, counts };
    }
    const accounts = (parsed['accounts.json']!.accounts as Array<{ id: string }>) ?? [];
    const records = (parsed['progression.json']!.records as Array<{ characterId: string }>) ?? [];
    const owners = (parsed['inventories.json']!.owners as Record<string, InventorySnapshot>) ?? {};
    const ledger = parsed['ledger.json'] as { accounts?: unknown[]; entries?: unknown[] };
    counts.accounts = accounts.length;
    counts.characters = records.length;
    counts.inventories = Object.keys(owners).length;
    counts.ledgerAccounts = ledger.accounts?.length ?? 0;
    counts.ledgerEntries = ledger.entries?.length ?? 0;
    const members = (parsed['sect.json']!.members as string[]) ?? [];
    const friendPairs = (parsed['friends.json']!.friends as [string, string][]) ?? [];
    const requestPairs = (parsed['friends.json']!.requests as [string, string][]) ?? [];
    counts.sectMembers = members.length;
    counts.friendships = friendPairs.length;
    counts.friendRequests = requestPairs.length;
    let n = 0;
    for (const [owner, snap] of Object.entries(owners)) {
      n++;
      try {
        const bad = Bag.restore(INVENTORY_CONFIG.BAG_SLOTS, () => `${owner}#check`, snap.bag).check();
        if (bad.length > 0) problems.push(`inventories: bag #${n} is inconsistent (${bad[0]})`);
      } catch {
        problems.push(`inventories: bag #${n} is malformed`);
      }
    }
    const ids = new Set(accounts.map((a) => a.id));
    const orphanChars = records.filter((r) => !ids.has(r.characterId)).length;
    const orphanBags = Object.keys(owners).filter((o) => !ids.has(o)).length;
    if (orphanChars > 0) warnings.push(`${orphanChars} character record(s) without an account`);
    if (orphanBags > 0) warnings.push(`${orphanBags} inventor${orphanBags === 1 ? 'y' : 'ies'} without an account`);
    const orphanMembers = members.filter((m) => !ids.has(m)).length;
    const orphanFriends = [...friendPairs, ...requestPairs].filter(([a, b]) => !ids.has(a) || !ids.has(b)).length;
    if (orphanMembers > 0) warnings.push(`${orphanMembers} sect member(s) without an account`);
    const orphanListings = ((parsed['market.json']!.listings as Array<{ seller: string }>) ?? []).filter(
      (l) => !ids.has(l.seller),
    ).length;
    if (orphanListings > 0) warnings.push(`${orphanListings} market listing(s) of a missing account`);
    if (orphanFriends > 0)
      warnings.push(`${orphanFriends} friend entr${orphanFriends === 1 ? 'y' : 'ies'} naming a missing account`);
    return { problems, warnings, counts };
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

// ---------------------------------------------------------------------------------------------------- creating a backup
export interface CreateBackupOptions {
  /** how many backups to keep (default 10, at least 1) */
  keep?: number;
  source?: 'live' | 'offline';
  now?: () => Date;
  /** test hook: runs after the staging directory is complete and before it is published (a crash here leaves no backup) */
  beforePublish?: () => void;
}
export interface BackupInfo {
  id: string;
  dir: string;
  manifest: BackupManifest;
  /** ids of older backups removed by the rotation */
  removed: string[];
}

const idOf = (d: Date): string => d.toISOString().replace(/[-:]/g, '').replace('.', '');
const BACKUP_DIR_RE = /^backup-(\d{8}T\d{6}\d{3}Z(?:-\d+)?)$/;

/** Backup ids present in `root`, oldest first. */
export function backupIds(root: string): string[] {
  if (!existsSync(root)) return [];
  return readdirSync(root)
    .map((n) => BACKUP_DIR_RE.exec(n)?.[1])
    .filter((x): x is string => !!x)
    .sort();
}

/** Keep the newest `keep` backups (at least one); returns the removed ids. */
export function rotateBackups(root: string, keep: number): string[] {
  const k = Math.max(1, Math.trunc(keep));
  const ids = backupIds(root);
  const drop = ids.slice(0, Math.max(0, ids.length - k));
  for (const id of drop) rmSync(join(root, `backup-${id}`), { recursive: true, force: true });
  return drop;
}

/** Write a backup of `docs` into `root` atomically (see the file comment), then rotate. */
export function createBackup(root: string, docs: Docs, opts: CreateBackupOptions = {}): BackupInfo {
  for (const name of DOC_NAMES) if (typeof docs[name] !== 'string') throw new BackupError(`missing document ${name}`);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  for (const n of readdirSync(root)) if (n.startsWith('.tmp-')) rmSync(join(root, n), { recursive: true, force: true });
  const now = (opts.now ?? (() => new Date()))();
  let id = idOf(now);
  for (let k = 1; existsSync(join(root, `backup-${id}`)); k++) id = `${idOf(now)}-${k}`;
  const stage = join(root, `.tmp-${id}`);
  mkdirSync(stage, { mode: 0o700 });
  try {
    const report = validateDocs(docs);
    if (report.problems.length > 0)
      throw new BackupError('refusing to back up documents the server could not load', report.problems);
    const files = {} as BackupManifest['files'];
    for (const name of DOC_NAMES) {
      writeSynced(join(stage, name), docs[name]);
      files[name] = { bytes: Buffer.byteLength(docs[name]), sha256: sha256(docs[name]) };
    }
    const manifest: BackupManifest = {
      format: BACKUP_FORMAT,
      v: BACKUP_VERSION,
      id,
      createdAt: now.toISOString(),
      source: opts.source ?? 'live',
      files,
      counts: report.counts,
    };
    writeSynced(join(stage, 'manifest.json'), JSON.stringify(manifest, null, 2));
    fsyncDir(stage);
    opts.beforePublish?.();
    const dir = join(root, `backup-${id}`);
    renameSync(stage, dir);
    fsyncDir(root);
    const removed = rotateBackups(root, opts.keep ?? 10);
    return { id, dir, manifest, removed };
  } catch (e) {
    rmSync(stage, { recursive: true, force: true });
    throw e;
  }
}

function sleepSync(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** Text of a document on disk: the main file if it parses, else its `.bak`, else undefined. */
function readDocText(file: string): string | undefined {
  for (const f of [file, `${file}.bak`]) {
    if (!existsSync(f)) continue;
    try {
      const t = readFileSync(f, 'utf8');
      JSON.parse(t);
      return t;
    } catch {
      // try the next one
    }
  }
  if (existsSync(file) || existsSync(`${file}.bak`)) throw new BackupError(`${file} exists but cannot be read`);
  return undefined;
}

/**
 * The documents of a data directory as text (a missing one is an empty document). Used for an offline backup of a directory the server
 * may be writing: every file is replaced atomically, so a single read is never torn; the set is re-read until two reads are identical,
 * so a document replaced in between is picked up instead of mixing two moments.
 */
export function readLiveDocs(dataDir: string, tries = 8): Docs {
  const read = (): Docs => {
    const d = {} as Docs;
    for (const name of DOC_NAMES) d[name] = readDocText(join(dataDir, name)) ?? EMPTY_DOCS[name];
    return d;
  };
  let prev = read();
  for (let k = 0; k < tries; k++) {
    sleepSync(30);
    const cur = read();
    if (DOC_NAMES.every((n) => cur[n] === prev[n])) return cur;
    prev = cur;
  }
  throw new BackupError(
    'the data directory kept changing while it was being read: stop the server or use the live backup',
  );
}

// ---------------------------------------------------------------------------------------------------- verify
export interface VerifyReport extends DocsReport {
  ok: boolean;
  id?: string;
  createdAt?: string;
}

function readManifest(dir: string): BackupManifest {
  let m: BackupManifest;
  try {
    m = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8')) as BackupManifest;
  } catch {
    throw new BackupError('manifest.json is missing or unreadable');
  }
  if (m.format !== BACKUP_FORMAT) throw new BackupError(`not a ${BACKUP_FORMAT} directory`);
  if (m.v !== BACKUP_VERSION)
    throw new BackupError(`unsupported backup version ${String(m.v)} (this tool reads ${BACKUP_VERSION})`);
  return m;
}

/** Check a backup directory without changing anything: manifest, sizes, sha256, then the documents through the server's loaders. */
export function verifyBackup(dir: string): VerifyReport {
  const empty: BackupCounts = {
    accounts: 0,
    characters: 0,
    inventories: 0,
    ledgerAccounts: 0,
    ledgerEntries: 0,
    sectMembers: 0,
    friendships: 0,
    friendRequests: 0,
  };
  let m: BackupManifest;
  try {
    m = readManifest(dir);
  } catch (e) {
    return { ok: false, problems: [e instanceof Error ? e.message : 'unreadable'], warnings: [], counts: empty };
  }
  const problems: string[] = [];
  const docs = {} as Docs;
  for (const name of DOC_NAMES) {
    const f = join(dir, name);
    if (!existsSync(f)) {
      problems.push(`${name}: missing`);
      continue;
    }
    const text = readFileSync(f, 'utf8');
    const want = m.files?.[name];
    if (!want) problems.push(`${name}: not listed in the manifest`);
    else if (Buffer.byteLength(text) !== want.bytes) problems.push(`${name}: size differs from the manifest`);
    else if (sha256(text) !== want.sha256)
      problems.push(`${name}: checksum differs from the manifest (the file was modified)`);
    docs[name] = text;
  }
  if (problems.length > 0)
    return { ok: false, id: m.id, createdAt: m.createdAt, problems, warnings: [], counts: empty };
  const r = validateDocs(docs);
  return { ok: r.problems.length === 0, id: m.id, createdAt: m.createdAt, ...r };
}

// ---------------------------------------------------------------------------------------------------- restore
export interface RestoreOptions {
  /** restore over a data directory that was written in the last few seconds (a running server will overwrite it again) */
  force?: boolean;
  now?: () => Date;
  /** how recent a write counts as "the server is running" (ms, default 3000) */
  liveWindowMs?: number;
  /** test hook, called after each step ('staged', 'moved', 'installed'); throwing simulates a failure at that point */
  onStep?: (step: 'staged' | 'moved' | 'installed') => void;
}
export interface RestoreReport {
  id: string;
  /** where the replaced files were moved (the safety copy), or null when the data directory had none */
  preRestoreDir: string | null;
  counts: BackupCounts;
}

/**
 * Replace the documents of `dataDir` with the ones of a verified backup. Nothing is touched when the backup does not verify. The old
 * files (and their `.bak`) go to `pre-restore-<id>/`; if the swap fails half way the old files are put back.
 */
export function restoreBackup(backupDir: string, dataDir: string, opts: RestoreOptions = {}): RestoreReport {
  const report = verifyBackup(backupDir);
  if (!report.ok) throw new BackupError('the backup does not verify; nothing was changed', report.problems);
  const now = (opts.now ?? (() => new Date()))();
  const window = opts.liveWindowMs ?? 3000;
  if (!opts.force) {
    for (const name of DOC_NAMES) {
      const f = join(dataDir, name);
      if (existsSync(f) && now.getTime() - statSync(f).mtimeMs < window)
        throw new BackupError(
          `${name} was written in the last ${Math.round(window / 1000)} s: is the server still running? stop it first (or pass --force)`,
        );
    }
  }
  const docs = {} as Docs;
  for (const name of DOC_NAMES) docs[name] = readFileSync(join(backupDir, name), 'utf8');
  const id = idOf(now);
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const stage = join(dataDir, `.restore-stage-${id}`);
  const safety = join(dataDir, `pre-restore-${id}`);
  rmSync(stage, { recursive: true, force: true });
  mkdirSync(stage, { mode: 0o700 });
  const moved: Array<[string, string]> = [];
  const installed: string[] = [];
  let madeSafety = false;
  try {
    for (const name of DOC_NAMES) writeSynced(join(stage, name), docs[name]);
    fsyncDir(stage);
    opts.onStep?.('staged');
    // safety copy of what is there now: main file, .bak and any stray temp file
    for (const name of DOC_NAMES)
      for (const suffix of ['', '.bak', '.tmp']) {
        const from = join(dataDir, name + suffix);
        if (!existsSync(from)) continue;
        if (!madeSafety) {
          mkdirSync(safety, { mode: 0o700 });
          madeSafety = true;
        }
        const to = join(safety, name + suffix);
        renameSync(from, to);
        moved.push([from, to]);
      }
    opts.onStep?.('moved');
    for (const name of DOC_NAMES) {
      renameSync(join(stage, name), join(dataDir, name));
      installed.push(name);
    }
    fsyncDir(dataDir);
    opts.onStep?.('installed');
    rmSync(stage, { recursive: true, force: true });
    // the installed files must be exactly the verified ones
    const m = readManifest(backupDir);
    for (const name of DOC_NAMES)
      if (sha256(readFileSync(join(dataDir, name), 'utf8')) !== m.files[name].sha256)
        throw new BackupError(`${name}: the installed file differs from the backup`);
    return { id, preRestoreDir: madeSafety ? safety : null, counts: report.counts };
  } catch (e) {
    // put the old files back so the data directory is what it was before: remove ONLY what this restore installed (a file that was
    // never moved to the safety copy is still the original and must stay), then move the saved files back
    for (const name of installed) rmSync(join(dataDir, name), { force: true });
    for (const [from, to] of moved.reverse()) if (existsSync(to)) renameSync(to, from);
    rmSync(stage, { recursive: true, force: true });
    if (madeSafety) rmSync(safety, { recursive: true, force: true });
    throw e;
  }
}

/** Resolve `latest`, a backup id, or a path to a backup directory. */
export function resolveBackup(root: string, from: string): string {
  if (from === 'latest') {
    const ids = backupIds(root);
    if (ids.length === 0) throw new BackupError(`no backups in ${root}`);
    return join(root, `backup-${ids[ids.length - 1]}`);
  }
  const byId = join(root, from.startsWith('backup-') ? from : `backup-${from}`);
  if (existsSync(byId)) return byId;
  if (existsSync(from) && statSync(from).isDirectory()) return from;
  throw new BackupError(`backup "${from}" not found in ${root}`);
}
