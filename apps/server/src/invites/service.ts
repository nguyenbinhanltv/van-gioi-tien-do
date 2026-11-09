/**
 * Closed-beta invite codes (D111): single use, expiring, hashed at rest, revocable.
 *
 * - A code is 16 random Crockford-base32 characters (80 bits) shown as `XXXX-XXXX-XXXX-XXXX`; only its SHA-256 is stored (a high-entropy
 *   random code needs no slow hash). The plaintext exists once, in the output of `mint`.
 * - Single use: `claim` reserves the code synchronously (parallel registrations cannot both pass), `commit(accountId)` records the use,
 *   `release` gives it back when the registration failed (taken name, busy server).
 * - Anti-enumeration (as the login limits, docs/25 section 2.4): a missing, malformed, unknown, expired, used or revoked code all answer the
 *   same 403 `invite_invalid`; invalid attempts count per IP and over `FAIL_LIMIT` per window answer 429. The check runs before any
 *   username lookup, so a caller without a code learns nothing about which names exist.
 * - No PII: a record holds the hash, the short id, three timestamps and, once used, the account id. No e-mail, no note, no IP.
 */
import { createHash, randomBytes } from 'node:crypto';
import { AuthError } from '../auth/accounts.js';
import { INVITE_CONFIG } from '../config.js';
import { MemoryInviteLog, type InviteEvent, type InviteLog } from './log.js';

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ'; // Crockford base32

export type InviteStatus = 'unused' | 'used' | 'expired' | 'revoked';

export interface InviteRecord {
  /** first 8 hex chars of the hash: what the operator sees, lists and revokes by (never enough to redeem) */
  id: string;
  hash: string;
  mintedMs: number;
  expiresMs: number;
  usedMs?: number;
  usedBy?: string;
  revokedMs?: number;
}

export interface InviteOptions {
  log?: InviteLog;
  now?: () => number;
  onError?: (e: unknown) => void;
}

export interface InviteClaim {
  /** the registration succeeded: record the use */
  commit(accountId: string): void;
  /** the registration failed: the code is usable again */
  release(): void;
}

/** upper-case, drop separators / spaces, fold the look-alikes Crockford folds (O->0, I/L->1); undefined when it cannot be a code */
export function normalizeInviteCode(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.length > 64) return undefined;
  const s = raw.toUpperCase().replace(/[\s-]/g, '').replace(/O/g, '0').replace(/[IL]/g, '1');
  if (s.length !== INVITE_CONFIG.CODE_CHARS) return undefined;
  for (const c of s) if (!ALPHABET.includes(c)) return undefined;
  return s;
}

const hashOf = (normalised: string): string => createHash('sha256').update(normalised).digest('hex');
const formatCode = (s: string): string => s.match(/.{4}/g)!.join('-');

export class InviteService {
  private readonly log: InviteLog;
  private readonly now: () => number;
  private readonly onError: (e: unknown) => void;
  private readonly byId = new Map<string, InviteRecord>();
  private readonly byHash = new Map<string, InviteRecord>();
  private readonly pending = new Set<string>();
  private readonly fails = new Map<string, number[]>();

  constructor(opts: InviteOptions = {}) {
    this.log = opts.log ?? new MemoryInviteLog();
    this.now = opts.now ?? (() => Date.now());
    this.onError = opts.onError ?? (() => undefined);
    this.refresh();
  }

  /** fold events other processes (the CLI) appended since the last look */
  refresh(): void {
    for (const e of this.log.readNew()) this.apply(e);
  }

  private apply(e: InviteEvent): void {
    if (e.t === 'mint') {
      if (this.byId.has(e.id)) return;
      const r: InviteRecord = { id: e.id, hash: e.h, mintedMs: e.at, expiresMs: e.exp };
      this.byId.set(e.id, r);
      this.byHash.set(e.h, r);
      return;
    }
    const r = this.byId.get(e.id);
    if (!r) return;
    if (e.t === 'use') {
      if (r.usedMs === undefined) {
        r.usedMs = e.at;
        r.usedBy = e.by;
      }
    } else if (r.revokedMs === undefined) r.revokedMs = e.at;
  }

  statusOf(r: InviteRecord, t = this.now()): InviteStatus {
    if (r.revokedMs !== undefined) return 'revoked';
    if (r.usedMs !== undefined) return 'used';
    return t >= r.expiresMs ? 'expired' : 'unused';
  }

  /** Mint `count` codes valid for `ttlDays`. Returns the plaintext codes: the only time they exist. */
  mint(
    count: number,
    ttlDays: number = INVITE_CONFIG.DEFAULT_TTL_DAYS,
  ): Array<{ id: string; code: string; expiresMs: number }> {
    if (!Number.isInteger(count) || count < 1 || count > INVITE_CONFIG.MAX_MINT)
      throw new RangeError(`count must be 1..${INVITE_CONFIG.MAX_MINT}`);
    if (!(ttlDays > 0) || ttlDays > INVITE_CONFIG.MAX_TTL_DAYS)
      throw new RangeError(`days must be > 0 and <= ${INVITE_CONFIG.MAX_TTL_DAYS}`);
    this.refresh();
    const at = this.now();
    const exp = at + Math.round(ttlDays * 86_400_000);
    const out: Array<{ id: string; code: string; expiresMs: number }> = [];
    while (out.length < count) {
      const bytes = randomBytes(INVITE_CONFIG.CODE_CHARS);
      let s = '';
      for (let i = 0; i < INVITE_CONFIG.CODE_CHARS; i++) s += ALPHABET[bytes[i]! & 31];
      const h = hashOf(s);
      const id = h.slice(0, 8);
      if (this.byId.has(id)) continue; // 1 in 4 billion: draw again
      const e: InviteEvent = { t: 'mint', id, h, at, exp };
      this.log.append(e);
      this.apply(e);
      out.push({ id, code: formatCode(s), expiresMs: exp });
    }
    return out;
  }

  /** Revoke an unused code by its id (or a unique prefix of >= 4 chars). Returns the record, or undefined when none / ambiguous. */
  revoke(idPrefix: string): InviteRecord | undefined {
    this.refresh();
    const p = idPrefix.toLowerCase();
    if (!/^[0-9a-f]{4,8}$/.test(p)) return undefined;
    const hits = [...this.byId.values()].filter((r) => r.id.startsWith(p));
    if (hits.length !== 1) return undefined;
    const r = hits[0]!;
    if (r.revokedMs === undefined) {
      const e: InviteEvent = { t: 'revoke', id: r.id, at: this.now() };
      this.log.append(e);
      this.apply(e);
    }
    return r;
  }

  list(): Array<InviteRecord & { status: InviteStatus }> {
    this.refresh();
    const t = this.now();
    return [...this.byId.values()]
      .sort((a, b) => a.mintedMs - b.mintedMs || (a.id < b.id ? -1 : 1))
      .map((r) => ({ ...r, status: this.statusOf(r, t) }));
  }

  private recentFails(ip: string): number[] {
    const t = this.now();
    const W = INVITE_CONFIG.FAIL_WINDOW_MS;
    const list = (this.fails.get(ip) ?? []).filter((x) => t - x < W);
    this.fails.set(ip, list);
    if (this.fails.size > 10_000) for (const [k, v] of this.fails) if (v.every((x) => t - x >= W)) this.fails.delete(k);
    return list;
  }

  /**
   * Reserve a code for one registration. Throws `AuthError` 429 (too many invalid codes from this IP) or 403 `invite_invalid` (one
   * answer for every kind of invalid code). The caller must call `commit` or `release` on the result.
   */
  claim(raw: unknown, ip: string): InviteClaim {
    const W = INVITE_CONFIG.FAIL_WINDOW_MS;
    // No code at all: nothing to guess, so it is neither counted nor limited (existing accounts re-register on every login / reconnect
    // and must not lock their own IP out); the answer is the same 403 as for a wrong code
    if (raw === undefined || raw === null || raw === '')
      throw new AuthError(403, 'invite_invalid', 'invalid or expired invitation code');
    const fails = this.recentFails(ip);
    if (fails.length >= INVITE_CONFIG.FAIL_LIMIT)
      throw new AuthError(
        429,
        'invite_limited',
        'too many invalid invitation codes',
        Math.ceil((W - (this.now() - fails[0]!)) / 1000),
      );
    this.refresh();
    const norm = normalizeInviteCode(raw);
    const rec = norm ? this.byHash.get(hashOf(norm)) : undefined;
    if (!rec || this.pending.has(rec.id) || this.statusOf(rec) !== 'unused') {
      fails.push(this.now());
      throw new AuthError(403, 'invite_invalid', 'invalid or expired invitation code');
    }
    this.pending.add(rec.id); // synchronous: a parallel request with the same code now fails
    let done = false;
    return {
      commit: (accountId) => {
        if (done) return;
        done = true;
        this.pending.delete(rec.id);
        const e: InviteEvent = { t: 'use', id: rec.id, at: this.now(), by: accountId };
        this.apply(e); // in memory first: even if the disk write fails the code cannot be used twice by this process
        try {
          this.log.append(e);
        } catch (err) {
          this.onError(err);
        }
      },
      release: () => {
        if (done) return;
        done = true;
        this.pending.delete(rec.id);
      },
    };
  }
}
