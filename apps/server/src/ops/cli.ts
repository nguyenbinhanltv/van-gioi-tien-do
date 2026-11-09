/**
 * Operator commands for the file store (D99): `backup`, `verify`, `restore`, `list`. Run through `npm run backup|verify|restore|backups -w @vgtd/server`.
 *
 *   backup  [--data-dir D] [--backup-dir B] [--keep N]      copy the documents of D into a new rotated backup (offline / cold copy)
 *   verify  [--from latest|<id>|<path>] [--backup-dir B]    check a backup (manifest, sha256, the server's own loaders)
 *   verify  --data-dir D                                    check the live documents of D the same way
 *   restore --from latest|<id>|<path> --yes [--force] [--data-dir D] [--backup-dir B]
 *   list    [--backup-dir B]
 *
 * Defaults: D = $DATA_DIR or ./.vgtd-data, B = $BACKUP_DIR or D/backups, N = $BACKUP_KEEP or 10. Exit code 0 ok, 1 usage, 2 refused / failed.
 * The output carries ids, file names and COUNTS only: never document content (the documents hold password hashes).
 */
import { join, resolve } from 'node:path';
import {
  BackupError,
  backupIds,
  createBackup,
  readLiveDocs,
  resolveBackup,
  restoreBackup,
  validateDocs,
  verifyBackup,
  type BackupCounts,
} from '../persistence/backup.js';

export interface CliIo {
  out(line: string): void;
  err(line: string): void;
}

const countsLine = (c: BackupCounts): string =>
  `accounts ${c.accounts}, characters ${c.characters}, inventories ${c.inventories}, ledger accounts ${c.ledgerAccounts}, ledger entries ${c.ledgerEntries}`;

const COMMANDS = ['backup', 'verify', 'restore', 'list'];
const VALUE_OPTIONS = ['data-dir', 'backup-dir', 'keep', 'from'];

function parse(argv: string[]): { cmd: string; opt: Map<string, string>; flags: Set<string> } | string {
  const [cmd, ...rest] = argv;
  if (!cmd || !COMMANDS.includes(cmd))
    return 'usage: backup | verify | restore | list (see the header of src/ops/cli.ts)';
  const opt = new Map<string, string>();
  const flags = new Set<string>();
  for (let i = 0; i < rest.length; i++) {
    const a = rest[i]!;
    if (!a.startsWith('--')) return `unexpected argument: ${a}`;
    const key = a.slice(2);
    if (key === 'yes' || key === 'force') flags.add(key);
    else if (VALUE_OPTIONS.includes(key)) {
      const v = rest[++i];
      if (v === undefined || v.startsWith('--')) return `--${key} needs a value`;
      opt.set(key, v);
    } else return `unknown option: ${a}`;
  }
  return { cmd, opt, flags };
}

export function runCli(argv: string[], io: CliIo, env: Record<string, string | undefined> = process.env): number {
  const p = parse(argv);
  if (typeof p === 'string') {
    io.err(p);
    return 1;
  }
  const { cmd, opt, flags } = p;
  const dataDir = resolve(opt.get('data-dir') ?? env.DATA_DIR ?? join(process.cwd(), '.vgtd-data'));
  const backupDir = resolve(opt.get('backup-dir') ?? env.BACKUP_DIR ?? join(dataDir, 'backups'));
  const keepRaw = opt.get('keep') ?? env.BACKUP_KEEP ?? '10';
  const keep = Number(keepRaw);
  if (!Number.isInteger(keep) || keep < 1) {
    io.err(`--keep must be a whole number >= 1, got ${keepRaw}`);
    return 1;
  }
  try {
    if (cmd === 'list') {
      const ids = backupIds(backupDir);
      io.out(`${ids.length} backup(s) in ${backupDir}`);
      for (const id of ids) {
        const r = verifyBackup(join(backupDir, `backup-${id}`));
        io.out(`  ${id}  ${r.ok ? `ok  ${countsLine(r.counts)}` : `INVALID  (${r.problems[0]})`}`);
      }
      return 0;
    }
    if (cmd === 'backup') {
      const info = createBackup(backupDir, readLiveDocs(dataDir), { keep, source: 'offline' });
      io.out(`backup ${info.id} written to ${info.dir}`);
      io.out(`  ${countsLine(info.manifest.counts)}`);
      if (info.removed.length > 0) io.out(`  rotation removed ${info.removed.length} older backup(s), keeping ${keep}`);
      return 0;
    }
    if (cmd === 'verify') {
      if (opt.has('data-dir') && !opt.has('from')) {
        const r = validateDocs(readLiveDocs(dataDir));
        io.out(`${r.problems.length === 0 ? 'OK' : 'FAILED'}: live documents of ${dataDir}: ${countsLine(r.counts)}`);
        for (const w of r.warnings) io.out(`  warning: ${w}`);
        for (const x of r.problems) io.err(`  problem: ${x}`);
        return r.problems.length === 0 ? 0 : 2;
      }
      const dir = resolveBackup(backupDir, opt.get('from') ?? 'latest');
      const r = verifyBackup(dir);
      io.out(
        `${r.ok ? 'OK' : 'FAILED'}: ${dir}${r.createdAt ? ` (created ${r.createdAt})` : ''}: ${countsLine(r.counts)}`,
      );
      for (const w of r.warnings) io.out(`  warning: ${w}`);
      for (const x of r.problems) io.err(`  problem: ${x}`);
      return r.ok ? 0 : 2;
    }
    // restore
    const from = opt.get('from');
    if (!from) {
      io.err('restore needs --from latest|<id>|<path>');
      return 1;
    }
    if (!flags.has('yes')) {
      io.err(
        'restore replaces the data of the server: stop the server first, then pass --yes (the replaced files are kept in pre-restore-<id>/)',
      );
      return 1;
    }
    const dir = resolveBackup(backupDir, from);
    const r = restoreBackup(dir, dataDir, { force: flags.has('force') });
    io.out(`restored ${dir} into ${dataDir}`);
    io.out(`  ${countsLine(r.counts)}`);
    io.out(r.preRestoreDir ? `  the replaced files are in ${r.preRestoreDir}` : '  there was nothing to replace');
    return 0;
  } catch (e) {
    io.err(`${e instanceof BackupError ? 'refused' : 'error'}: ${e instanceof Error ? e.message : 'failed'}`);
    if (e instanceof BackupError) for (const x of e.problems) io.err(`  problem: ${x}`);
    return 2;
  }
}
