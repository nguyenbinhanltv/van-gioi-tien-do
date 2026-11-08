/**
 * Account service: register / login with the docs/25 §2 protections (policy, progressive lockout, per-IP limits,
 * constant-time answer for unknown names, bounded hash queue). Storage is in memory behind `AccountStore`
 * (PostgreSQL arrives with the persistence work; docs/23).
 */
import { randomBytes, randomUUID } from 'node:crypto';
import { AUTH_CONFIG } from '../config.js';
import { TokenService } from './jwt.js';
import {
  DEFAULT_SCRYPT,
  hashPassword,
  needsRehash,
  validatePassword,
  validateUsername,
  verifyPassword,
  type ScryptParams,
} from './password.js';

export class AuthError extends Error {
  constructor(
    readonly status: 400 | 401 | 409 | 429 | 503,
    readonly code: string,
    message: string,
    readonly retryAfterS?: number,
  ) {
    super(message);
  }
}

export interface Account {
  id: string;
  username: string;
  passwordHash: string;
  tokenVersion: number;
  failures: number;
  lockedUntilMs: number;
  lockLevel: number;
}

export interface AccountStore {
  create(a: Account): boolean;
  byUsername(username: string): Account | undefined;
  byId(id: string): Account | undefined;
}

export class InMemoryAccountStore implements AccountStore {
  private readonly byName = new Map<string, Account>();
  private readonly ids = new Map<string, Account>();
  create(a: Account): boolean {
    if (this.byName.has(a.username)) return false;
    this.byName.set(a.username, a);
    this.ids.set(a.id, a);
    return true;
  }
  byUsername(u: string): Account | undefined {
    return this.byName.get(u);
  }
  byId(id: string): Account | undefined {
    return this.ids.get(id);
  }
}

export interface AuthOptions {
  store?: AccountStore;
  tokens?: TokenService;
  now?: () => number;
  scrypt?: ScryptParams;
  /** 0 disables the limit (load tests); default 3 per IP per day */
  registerPerIpPerDay?: number;
  maxPendingHashes?: number;
  /** failed (or still unverified) logins per IP per 15 min before 429; default 10. Raise for load tests behind one IP. */
  ipFailLimit?: number;
}

export interface LoginResult {
  accountId: string;
  sessionId: string;
  token: string;
  expiresAtS: number;
}

export class AuthService {
  readonly store: AccountStore;
  readonly tokens: TokenService;
  private readonly now: () => number;
  private readonly scryptParams: ScryptParams;
  private readonly registerLimit: number;
  private readonly maxPending: number;
  private readonly ipFailLimit: number;
  private pending = 0;
  private readonly ipFails = new Map<string, number[]>();
  private readonly ipRegs = new Map<string, number[]>();
  private readonly revoked = new Set<string>();
  private readonly dummyHash: Promise<string>;

  constructor(opts: AuthOptions = {}) {
    this.store = opts.store ?? new InMemoryAccountStore();
    this.now = opts.now ?? (() => Date.now());
    this.tokens = opts.tokens ?? new TokenService(this.now);
    this.scryptParams = opts.scrypt ?? DEFAULT_SCRYPT;
    this.registerLimit = opts.registerPerIpPerDay ?? AUTH_CONFIG.REGISTER_PER_IP_PER_DAY;
    this.maxPending = opts.maxPendingHashes ?? AUTH_CONFIG.MAX_PENDING_HASHES;
    this.ipFailLimit = opts.ipFailLimit ?? AUTH_CONFIG.IP_FAIL_LIMIT;
    this.dummyHash = hashPassword(randomBytes(24).toString('base64'), this.scryptParams); // random per process, never a real credential;
  }

  /** Runs one hash job through the bounded queue (docs/25 §2.3). */
  private async job<T>(fn: () => Promise<T>): Promise<T> {
    if (this.pending >= this.maxPending) throw new AuthError(503, 'busy', 'server busy, retry later', 1);
    this.pending++;
    try {
      return await fn();
    } finally {
      this.pending--;
    }
  }

  private recent(map: Map<string, number[]>, key: string, windowMs: number): number[] {
    const t = this.now();
    const list = (map.get(key) ?? []).filter((x) => t - x < windowMs);
    map.set(key, list);
    return list;
  }

  /** Reserve one slot synchronously (before any await) so parallel requests are counted; returns the stamp. */
  private reserve(map: Map<string, number[]>, key: string, windowMs: number): number {
    const stamp = this.now();
    this.recent(map, key, windowMs).push(stamp);
    return stamp;
  }

  private release(map: Map<string, number[]>, key: string, windowMs: number, stamp: number): void {
    const list = this.recent(map, key, windowMs);
    const k = list.indexOf(stamp);
    if (k >= 0) list.splice(k, 1);
  }

  async register(usernameRaw: unknown, password: unknown, ip: string): Promise<{ accountId: string }> {
    const uErr = validateUsername(usernameRaw);
    if (uErr) throw new AuthError(400, 'bad_username', uErr);
    const username = (usernameRaw as string).toLowerCase();
    const pErr = validatePassword(password, username);
    if (pErr) throw new AuthError(400, 'bad_password', pErr);
    const DAY = 24 * 3600_000;
    let stamp: number | null = null;
    if (this.registerLimit > 0) {
      if (this.recent(this.ipRegs, ip, DAY).length >= this.registerLimit)
        throw new AuthError(429, 'register_limited', 'too many registrations from this address', 3600);
      // counted before hashing: parallel requests from one IP cannot all pass the check
      stamp = this.reserve(this.ipRegs, ip, DAY);
    }
    let created = false;
    try {
      if (this.store.byUsername(username)) throw new AuthError(409, 'username_taken', 'username already taken');
      const passwordHash = await this.job(() => hashPassword(password as string, this.scryptParams));
      const account: Account = {
        id: randomUUID(),
        username,
        passwordHash,
        tokenVersion: 0,
        failures: 0,
        lockedUntilMs: 0,
        lockLevel: 0,
      };
      if (!this.store.create(account)) throw new AuthError(409, 'username_taken', 'username already taken');
      created = true;
      return { accountId: account.id };
    } finally {
      // failed attempts (taken name, busy server) do not consume the daily quota
      if (!created && stamp !== null) this.release(this.ipRegs, ip, DAY, stamp);
    }
  }

  async login(usernameRaw: unknown, password: unknown, ip: string): Promise<LoginResult> {
    const t = this.now();
    const W = AUTH_CONFIG.IP_FAIL_WINDOW_MS;
    const fails = this.recent(this.ipFails, ip, W);
    if (fails.length >= this.ipFailLimit)
      throw new AuthError(429, 'ip_limited', 'too many failed attempts', Math.ceil((W - (t - fails[0]!)) / 1000));
    const username = typeof usernameRaw === 'string' ? usernameRaw.toLowerCase() : '';
    if (typeof password !== 'string' || password.length > 1024) throw new AuthError(400, 'bad_request', 'bad request');
    const account = this.store.byUsername(username);
    if (account && account.lockedUntilMs > t)
      throw new AuthError(
        429,
        'account_locked',
        'account temporarily locked',
        Math.ceil((account.lockedUntilMs - t) / 1000),
      );
    // attempts still being verified count as failures until they succeed, so parallel guesses cannot beat the limits
    if (account && account.failures >= AUTH_CONFIG.LOCK_AFTER_FAILURES)
      throw new AuthError(429, 'account_locked', 'account temporarily locked', 60);
    const stamp = this.reserve(this.ipFails, ip, W);
    if (account) account.failures++;
    let ok = false;
    try {
      // unknown name: hash against a dummy so both failure paths cost the same
      const stored = account ? account.passwordHash : await this.dummyHash;
      ok = await this.job(() => verifyPassword(password, stored));
    } catch (e) {
      // a busy server (503) is not a failed guess by the caller
      this.release(this.ipFails, ip, W, stamp);
      if (account) account.failures = Math.max(0, account.failures - 1);
      throw e;
    }
    if (!account || !ok) {
      if (account && account.failures >= AUTH_CONFIG.LOCK_AFTER_FAILURES) {
        const steps = AUTH_CONFIG.LOCK_STEPS_MIN;
        const minutes = steps[Math.min(account.lockLevel, steps.length - 1)]!;
        account.lockedUntilMs = this.now() + minutes * 60_000;
        account.lockLevel++;
        account.failures = 0;
      }
      throw new AuthError(401, 'bad_credentials', 'invalid username or password');
    }
    this.release(this.ipFails, ip, W, stamp);
    account.failures = 0;
    account.lockLevel = 0;
    if (needsRehash(account.passwordHash, this.scryptParams)) {
      account.passwordHash = await this.job(() => hashPassword(password, this.scryptParams));
    }
    const sessionId = randomUUID();
    const { token, claims } = this.tokens.issue(account.id, sessionId, account.tokenVersion);
    return { accountId: account.id, sessionId, token, expiresAtS: claims.exp };
  }

  /** Gateway check: signature, expiry, token_version and revoked sessions (docs/25 §3.2). */
  authenticate(token: string): { accountId: string; sessionId: string; version: number } {
    const claims = this.tokens.verify(token);
    const account = this.store.byId(claims.sub);
    if (!account || account.tokenVersion !== claims.ver || this.revoked.has(claims.sid))
      throw new AuthError(401, 'session_revoked', 'session revoked');
    return { accountId: claims.sub, sessionId: claims.sid, version: claims.ver };
  }

  /**
   * Is a session that was authenticated earlier still valid (account exists, token_version unchanged, session not revoked)?
   * Resuming a held session presents no access token, so the gateway re-checks the stamp taken at login with this (docs/25 section 3.2).
   */
  isSessionCurrent(accountId: string, sessionId: string, version: number): boolean {
    const account = this.store.byId(accountId);
    return !!account && account.tokenVersion === version && !this.revoked.has(sessionId);
  }

  revokeSession(sessionId: string): void {
    this.revoked.add(sessionId);
  }
}
