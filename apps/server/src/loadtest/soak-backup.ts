/**
 * One backup of the soak's live file store, run as its OWN process (bundled next to `soak.mjs` by `scripts/soak.mjs`): the same thing the
 * `backup` operator command does (D99), so the time it takes is what an operator would see, and it never blocks the game loop being measured.
 *
 *   node soak-backup.mjs <data-dir> <backup-dir> <keep> [--verify]
 *
 * Prints ONE JSON line on stdout: `{ ok, ms, bytes, verified?, error? }` (`ms` = time inside this process for reading the live documents,
 * hashing / publishing the backup and rotating; node start-up is not counted). Exit code 0 ok, 2 failed.
 */
import { readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { createBackup, readLiveDocs, verifyBackup } from '../persistence/backup.js';

function dirBytes(dir: string): number {
  let n = 0;
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    n += e.isDirectory() ? dirBytes(p) : statSync(p).size;
  }
  return n;
}

const [dataDir, backupDir, keepArg, ...rest] = process.argv.slice(2);
try {
  if (!dataDir || !backupDir) throw new Error('usage: soak-backup <data-dir> <backup-dir> <keep> [--verify]');
  const t0 = performance.now();
  const info = createBackup(backupDir, readLiveDocs(dataDir), {
    keep: Math.max(1, Number(keepArg) || 3),
    source: 'live',
  });
  const ms = performance.now() - t0;
  const out: { ok: boolean; ms: number; bytes: number; verified?: boolean } = {
    ok: true,
    ms,
    bytes: dirBytes(info.dir),
  };
  if (rest.includes('--verify')) out.verified = verifyBackup(info.dir).ok;
  console.log(JSON.stringify(out));
} catch (e) {
  console.log(JSON.stringify({ ok: false, ms: 0, bytes: 0, error: e instanceof Error ? e.message : String(e) }));
  process.exit(2);
}
