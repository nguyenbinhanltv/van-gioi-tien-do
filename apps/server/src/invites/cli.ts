/**
 * Operator CLI for closed-beta invite codes (D111): `npm run invites -w @vgtd/server -- <command>`.
 *
 *   mint   [--count N] [--days D] [--file F]   mint N codes (default 1, valid D days, default 14); prints the codes, ONCE
 *   list   [--file F]                          id, status, minted / expires / used-at (never a code, never a name)
 *   revoke <id> [--file F]                     revoke an unused code by id (or a unique prefix of >= 4 chars)
 *
 * F defaults to $INVITES_FILE, else `<DATA_DIR or ./.vgtd-data>/invites.jsonl`: the file the server reads with BETA_INVITE_ONLY=1.
 * The running server notices new / revoked codes by itself (the file is an append-only log). Exit code 0 ok, 1 usage, 2 refused.
 * Codes go to stdout one per line (pipe them to a file you hand out and delete); ids and notes go to stderr.
 */
import { join, resolve } from 'node:path';
import { INVITE_CONFIG } from '../config.js';
import { FileInviteLog } from './log.js';
import { InviteService } from './service.js';

export interface InviteCliIo {
  out(line: string): void;
  err(line: string): void;
}

const iso = (ms: number): string => new Date(ms).toISOString().slice(0, 16) + 'Z';

export function defaultInviteFile(env: Record<string, string | undefined>): string {
  return resolve(env.INVITES_FILE ?? join(env.DATA_DIR ?? join(process.cwd(), '.vgtd-data'), 'invites.jsonl'));
}

export function runInviteCli(
  argv: readonly string[],
  env: Record<string, string | undefined>,
  io: InviteCliIo,
  now: () => number = Date.now,
): number {
  const cmd = argv[0];
  const rest = argv.slice(1);
  const opt = (name: string): string | undefined => {
    const i = rest.indexOf(`--${name}`);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  const file = opt('file') ?? defaultInviteFile(env);
  const usage = (): number => {
    io.err('usage: invites mint [--count N] [--days D] | list | revoke <id>   [--file F]');
    return 1;
  };
  if (cmd !== 'mint' && cmd !== 'list' && cmd !== 'revoke') return usage();
  const svc = new InviteService({ log: new FileInviteLog(file), now });
  if (cmd === 'mint') {
    const count = Number(opt('count') ?? 1);
    const days = Number(opt('days') ?? INVITE_CONFIG.DEFAULT_TTL_DAYS);
    try {
      const codes = svc.mint(count, days);
      for (const c of codes) {
        io.out(c.code);
        io.err(`  id ${c.id}  expires ${iso(c.expiresMs)}`);
      }
      io.err(`minted ${codes.length} code(s) into ${file}. The codes above are shown once and cannot be recovered.`);
      return 0;
    } catch (e) {
      io.err((e as Error).message);
      return 2;
    }
  }
  if (cmd === 'revoke') {
    const id = rest.find((a) => !a.startsWith('--') && a !== opt('file'));
    if (!id) return usage();
    const r = svc.revoke(id);
    if (!r) {
      io.err(`no single code with id starting "${id}"`);
      return 2;
    }
    io.out(`revoked ${r.id} (${svc.statusOf(r)})`);
    return 0;
  }
  const rows = svc.list();
  io.out('id        status   minted            expires           used');
  for (const r of rows)
    io.out(
      `${r.id}  ${r.status.padEnd(7)}  ${iso(r.mintedMs)}  ${iso(r.expiresMs)}  ${r.usedMs !== undefined ? iso(r.usedMs) : '-'}`,
    );
  const n = (s: string): number => rows.filter((r) => r.status === s).length;
  io.err(
    `${rows.length} code(s): ${n('unused')} unused, ${n('used')} used, ${n('expired')} expired, ${n('revoked')} revoked`,
  );
  return 0;
}
