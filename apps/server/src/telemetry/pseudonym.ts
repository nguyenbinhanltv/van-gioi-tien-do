/**
 * Pseudonymous ids and event ids (D109, docs/17 §3.2 / §7).
 *
 * `player_pid` = HMAC-SHA256(key, account id), hex. One way: a pid never reveals an account id, and without the key nobody can
 * recompute it from an account id either (so a leaked event log alone cannot be joined to accounts). The key is a server secret: in
 * `STORE=file` mode it lives in the data directory (so pids are stable across restarts, which retention needs), otherwise it is
 * random per process. Event ids are UUID v7 (time-ordered, per docs/17 §3.2); the random part comes from the injected generator so
 * tests are reproducible.
 */
import { createHmac, randomBytes } from 'node:crypto';

export type RandomBytes = (n: number) => Uint8Array;
export const systemRandom: RandomBytes = (n) => randomBytes(n);

export function pseudonymise(key: string | Uint8Array, accountId: string): string {
  return createHmac('sha256', key).update(accountId).digest('hex');
}

/** The short form kept in rollups (64 bits of the pid). */
export const shortPid = (pid: string): string => pid.slice(0, 16);

export function uuid7(nowMs: number, rand: RandomBytes): string {
  const r = rand(10);
  const ts = Math.max(0, Math.floor(nowMs));
  const hex = (n: number, w: number): string => n.toString(16).padStart(w, '0');
  const t = BigInt(ts);
  const tsHex = t.toString(16).padStart(12, '0').slice(-12); // 48-bit big-endian millisecond timestamp
  const b = (i: number): number => r[i]! & 0xff;
  const verRand = hex(0x7000 | (((b(0) << 8) | b(1)) & 0x0fff), 4); // version 7 + 12 random bits
  const variant = hex(0x8000 | (((b(2) << 8) | b(3)) & 0x3fff), 4); // variant 10 + 14 random bits
  const tail = hex(b(4), 2) + hex(b(5), 2) + hex(b(6), 2) + hex(b(7), 2) + hex(b(8), 2) + hex(b(9), 2);
  return `${tsHex.slice(0, 8)}-${tsHex.slice(8)}-${verRand}-${variant}-${tail}`;
}
