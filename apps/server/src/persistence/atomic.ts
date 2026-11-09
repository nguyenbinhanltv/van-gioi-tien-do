/**
 * Crash-safe file writes and reads for the file-backed stores (D92).
 *
 * `writeFileAtomic`: write a temp file in the SAME directory, fsync it, move the current file to `<file>.bak`, rename the temp file over
 * `<file>`, then fsync the directory (best effort: not supported on Windows). A crash at any point leaves either the old file, or the
 * old file as `.bak` plus a complete new temp file, or the new file; a half-written file is never the one that `readJsonFile` trusts.
 * `readJsonFile`: the main file if it parses, else the `.bak`, else undefined on a first start (throws when files exist but are
 * unreadable). Stray `*.tmp` files are ignored (and removed on the next start).
 * Files are created with mode 0600: they hold password HASHES and game state, never plaintext secrets.
 */
import {
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  writeSync,
} from 'node:fs';
import { open, rm } from 'node:fs/promises';
import { dirname } from 'node:path';

/**
 * Synchronous file-write cost since start (profiling, D106): every `writeFileAtomic` blocks the event loop for its open + write + fsync +
 * renames, so a store flush on the tick path is a stall of exactly this long. Read it, never reset it from game code.
 */
export const fileWriteStats = {
  /** writes that blocked the loop: whole synchronous writes (`writeFileAtomic`) and the on-loop commit of an async one */
  count: 0,
  totalMs: 0,
  maxMs: 0,
  /** time `DocFile` spent serialising documents (always on the loop) */
  serializeMs: 0,
  serializeMaxMs: 0,
  /** asynchronous writes (open + write + fsync run on the libuv pool, off the loop) and their wall time */
  asyncCount: 0,
  asyncTotalMs: 0,
};

export function writeFileAtomic(file: string, data: string): void {
  const t0 = performance.now();
  try {
    writeFileAtomicUntimed(file, data);
  } finally {
    const ms = performance.now() - t0;
    fileWriteStats.count++;
    fileWriteStats.totalMs += ms;
    if (ms > fileWriteStats.maxMs) fileWriteStats.maxMs = ms;
  }
}

function writeFileAtomicUntimed(file: string, data: string): void {
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.tmp`;
  const fd = openSync(tmp, 'w', 0o600);
  try {
    writeSync(fd, data);
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  if (existsSync(file)) renameSync(file, `${file}.bak`);
  renameSync(tmp, file);
  try {
    const d = openSync(dir, 'r');
    try {
      fsyncSync(d);
    } finally {
      closeSync(d);
    }
  } catch {
    // directory fsync is not available on every platform / filesystem: the data file itself is already synced
  }
}

/**
 * Same file protocol as `writeFileAtomic`, but the slow part (open + write + fsync of the temp file) runs on the libuv thread pool so
 * the tick loop keeps running; only the commit (move the current file to `.bak`, rename the temp file over it: two cheap metadata
 * operations) happens on the loop, in ONE synchronous segment together with `shouldCommit()`, so a newer synchronous write can never
 * be overwritten by this older one. The temp file is `<file>.a.tmp` (a synchronous write uses `<file>.tmp`), so the two never share a
 * file. Resolves true when committed, false when `shouldCommit()` said no (the temp file is removed). Rejects on I/O errors.
 */
export async function writeFileAtomicAsync(file: string, data: string, shouldCommit: () => boolean): Promise<boolean> {
  const t0 = performance.now();
  const dir = dirname(file);
  mkdirSync(dir, { recursive: true });
  const tmp = `${file}.a.tmp`;
  try {
    const fh = await open(tmp, 'w', 0o600);
    try {
      await fh.writeFile(data);
      await fh.sync();
    } finally {
      await fh.close();
    }
    if (!shouldCommit()) {
      await rm(tmp, { force: true });
      return false;
    }
    const c0 = performance.now();
    if (existsSync(file)) renameSync(file, `${file}.bak`);
    renameSync(tmp, file);
    const blocked = performance.now() - c0;
    fileWriteStats.count++;
    fileWriteStats.totalMs += blocked;
    if (blocked > fileWriteStats.maxMs) fileWriteStats.maxMs = blocked;
  } catch (e) {
    await rm(tmp, { force: true }).catch(() => undefined);
    throw e;
  } finally {
    fileWriteStats.asyncCount++;
    fileWriteStats.asyncTotalMs += performance.now() - t0;
  }
  try {
    const d = await open(dir, 'r'); // best-effort directory sync: not available everywhere
    try {
      await d.sync();
    } finally {
      await d.close();
    }
  } catch {
    // the data file itself is already synced
  }
  return true;
}

function tryParse(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as unknown;
  } catch {
    return undefined;
  }
}

/**
 * The last good document: `<file>`, else `<file>.bak`; undefined only on a genuine first start (neither file exists). When a file exists
 * but none of them parses this THROWS: starting empty would overwrite the player data on the next write, so the operator must look.
 */
export function readJsonFile(file: string): unknown {
  const main = tryParse(file);
  if (main !== undefined) return main;
  const bak = tryParse(`${file}.bak`);
  if (bak !== undefined) return bak;
  if (existsSync(file) || existsSync(`${file}.bak`))
    throw new Error(`${file} (and its .bak) exist but cannot be parsed: refusing to start empty over player data`);
  return undefined;
}

export function removeStray(file: string): void {
  rmSync(`${file}.tmp`, { force: true });
  rmSync(`${file}.a.tmp`, { force: true });
}
