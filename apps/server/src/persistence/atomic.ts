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
import { dirname } from 'node:path';

export function writeFileAtomic(file: string, data: string): void {
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
}
