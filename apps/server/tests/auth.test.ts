import { describe, expect, it } from 'vitest';
import {
  AUTH_CONFIG,
  AuthError,
  AuthService,
  TokenError,
  TokenService,
  hashPassword,
  needsRehash,
  validatePassword,
  validateUsername,
  verifyPassword,
  type AuthOptions,
} from '../src/index.js';

import {
  TEST_ONLY_ASCII,
  TEST_ONLY_FULLWIDTH,
  TEST_ONLY_GOOD,
  TEST_ONLY_GOOD_NEAR,
  TEST_ONLY_OTHER,
  TEST_ONLY_SHORT,
  TEST_ONLY_USER,
  TEST_ONLY_WRONG,
} from './fixtures.js';

const FAST = { N: 1024, r: 8, p: 1 };

describe('password policy and hashing (docs/25 §2.2-2.3)', () => {
  it('username: 3-20 of [a-z0-9_], case-insensitive', () => {
    expect(validateUsername('Tu_Tien9')).toBeNull();
    for (const bad of ['ab', 'a'.repeat(21), 'has space', 'dấu', '', 42]) expect(validateUsername(bad)).not.toBeNull();
  });
  it('password: 10-128 chars (NFKC), not equal to the username, no composition rules', () => {
    expect(validatePassword('a'.repeat(10), TEST_ONLY_USER)).toBeNull();
    expect(validatePassword(TEST_ONLY_SHORT, TEST_ONLY_USER)).toMatch(/at least 10/);
    expect(validatePassword('x'.repeat(129), TEST_ONLY_USER)).toMatch(/at most 128/);
    expect(validatePassword(TEST_ONLY_GOOD.toUpperCase(), TEST_ONLY_GOOD)).toMatch(/differ/);
    expect(validatePassword(undefined, TEST_ONLY_USER)).not.toBeNull();
  });
  it('hash verifies, is salted, rejects wrong passwords, and flags weaker params for rehash', async () => {
    const a = await hashPassword(TEST_ONLY_GOOD, FAST);
    const b = await hashPassword(TEST_ONLY_GOOD, FAST);
    expect(a).not.toBe(b);
    expect(await verifyPassword(TEST_ONLY_GOOD, a)).toBe(true);
    expect(await verifyPassword(TEST_ONLY_GOOD_NEAR, a)).toBe(false);
    expect(await verifyPassword('x', 'garbage')).toBe(false);
    expect(needsRehash(a, FAST)).toBe(false);
    expect(needsRehash(a, { N: 2048, r: 8, p: 1 })).toBe(true);
  });
  it('NFKC: visually equivalent passwords hash the same', async () => {
    const h = await hashPassword(TEST_ONLY_FULLWIDTH, FAST); // full-width
    expect(await verifyPassword(TEST_ONLY_ASCII, h)).toBe(true);
  });
});

describe('access tokens: EdDSA JWT (docs/25 §3.1)', () => {
  it('round-trips claims and rejects tampering, wrong key, expiry and alg=none', () => {
    let now = 1_000_000;
    const ts = new TokenService(() => now);
    const { token, claims } = ts.issue('acc', 'sid', 3);
    expect(ts.verify(token)).toMatchObject({ sub: 'acc', sid: 'sid', ver: 3, aud: 'vgtd-world' });
    expect(claims.exp - claims.iat).toBe(AUTH_CONFIG.ACCESS_TOKEN_TTL_S);
    const [h, p, s] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ ...claims, sub: 'admin' })).toString('base64url');
    expect(() => ts.verify(`${h}.${forged}.${s}`)).toThrow(TokenError);
    expect(() => new TokenService(() => now).verify(token)).toThrow(/signature/);
    const none = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
    expect(() => ts.verify(`${none}.${p}.`)).toThrow(/alg/);
    expect(() => ts.verify('a.b')).toThrow(TokenError);
    now += (AUTH_CONFIG.ACCESS_TOKEN_TTL_S + AUTH_CONFIG.CLOCK_SKEW_S + 1) * 1000;
    expect(() => ts.verify(token)).toThrow(/expired/);
  });
});

describe('AuthService', () => {
  const mk = (extra: AuthOptions = {}) => {
    const clock = { t: 1_000_000 };
    const svc = new AuthService({ scrypt: FAST, now: () => clock.t, ...extra });
    return { svc, clock };
  };
  const code = async (p: Promise<unknown>): Promise<string> => {
    try {
      await p;
      return 'ok';
    } catch (e) {
      return e instanceof AuthError ? e.code : `other:${String(e)}`;
    }
  };

  it('register then login returns a verifiable token; duplicates and weak passwords are rejected', async () => {
    const { svc } = mk();
    await svc.register('Alice', TEST_ONLY_GOOD, '1.1.1.1');
    expect(await code(svc.register('alice', TEST_ONLY_OTHER, '1.1.1.2'))).toBe('username_taken');
    expect(await code(svc.register(TEST_ONLY_USER, TEST_ONLY_SHORT, '1.1.1.3'))).toBe('bad_password');
    expect(await code(svc.register('b', TEST_ONLY_GOOD, '1.1.1.3'))).toBe('bad_username');
    const r = await svc.login('ALICE', TEST_ONLY_GOOD, '1.1.1.1');
    // `version` (the account's token_version at issue) is what a later resume re-checks via isSessionCurrent
    expect(svc.authenticate(r.token)).toEqual({ accountId: r.accountId, sessionId: r.sessionId, version: 0 });
    svc.revokeSession(r.sessionId);
    expect(() => svc.authenticate(r.token)).toThrow(/revoked/);
  });

  it('unknown user and wrong password give the same error', async () => {
    const { svc } = mk();
    await svc.register('carol', TEST_ONLY_GOOD, '2.2.2.2');
    expect(await code(svc.login('nobody', TEST_ONLY_OTHER, '2.2.2.2'))).toBe('bad_credentials');
    expect(await code(svc.login('carol', TEST_ONLY_WRONG, '2.2.2.2'))).toBe('bad_credentials');
  });

  it('5 consecutive failures lock the account progressively (1 -> 5 min), a success resets', async () => {
    const { svc, clock } = mk();
    await svc.register('dave', TEST_ONLY_GOOD, '3.3.3.3');
    for (let k = 0; k < AUTH_CONFIG.LOCK_AFTER_FAILURES; k++) {
      expect(await code(svc.login('dave', TEST_ONLY_WRONG, `3.3.3.${k + 10}`))).toBe('bad_credentials');
    }
    expect(await code(svc.login('dave', TEST_ONLY_GOOD, '3.3.3.99'))).toBe('account_locked');
    clock.t += 61_000; // first lock = 1 minute
    for (let k = 0; k < AUTH_CONFIG.LOCK_AFTER_FAILURES; k++)
      await code(svc.login('dave', TEST_ONLY_WRONG, `3.3.4.${k}`));
    clock.t += 61_000; // second lock = 5 minutes, still locked after 1 minute
    expect(await code(svc.login('dave', TEST_ONLY_GOOD, '3.3.4.99'))).toBe('account_locked');
    clock.t += 5 * 60_000;
    expect(await code(svc.login('dave', TEST_ONLY_GOOD, '3.3.4.99'))).toBe('ok');
  });

  it('10 failures from one IP in 15 minutes -> 429, even for a valid account', async () => {
    const { svc, clock } = mk();
    await svc.register('erin', TEST_ONLY_GOOD, '4.4.4.4');
    for (let k = 0; k < AUTH_CONFIG.IP_FAIL_LIMIT; k++) await code(svc.login(`ghost${k}`, TEST_ONLY_OTHER, '9.9.9.9'));
    expect(await code(svc.login('erin', TEST_ONLY_GOOD, '9.9.9.9'))).toBe('ip_limited');
    expect(await code(svc.login('erin', TEST_ONLY_GOOD, '4.4.4.4'))).toBe('ok');
    clock.t += AUTH_CONFIG.IP_FAIL_WINDOW_MS + 1;
    expect(await code(svc.login('erin', TEST_ONLY_GOOD, '9.9.9.9'))).toBe('ok');
  });

  it('max 3 registrations per IP per day', async () => {
    const { svc, clock } = mk();
    for (let k = 0; k < 3; k++) await svc.register(`user${k}`, TEST_ONLY_GOOD, '5.5.5.5');
    expect(await code(svc.register('user3', TEST_ONLY_GOOD, '5.5.5.5'))).toBe('register_limited');
    clock.t += 24 * 3600_000 + 1;
    expect(await code(svc.register('user3', TEST_ONLY_GOOD, '5.5.5.5'))).toBe('ok');
  });

  it('parallel logins cannot beat the per-IP failure limit (attempts are counted before the hash runs)', async () => {
    const { svc } = mk();
    await svc.register('frank', TEST_ONLY_GOOD, '7.7.7.7');
    const results = await Promise.all(
      Array.from({ length: 30 }, () => code(svc.login('frank', TEST_ONLY_WRONG, '8.8.8.8'))),
    );
    // only a handful may reach the hash; the rest are refused up front (account lock or IP limit)
    expect(results.filter((r) => r === 'bad_credentials').length).toBeLessThanOrEqual(AUTH_CONFIG.LOCK_AFTER_FAILURES);
    expect(results.filter((r) => r === 'account_locked' || r === 'ip_limited').length).toBeGreaterThanOrEqual(25);
  });

  it('parallel guesses on one account from many IPs hit the lock after 5 attempts', async () => {
    const { svc } = mk();
    await svc.register('grace', TEST_ONLY_GOOD, '7.7.7.8');
    const results = await Promise.all(
      Array.from({ length: 20 }, (_, k) => code(svc.login('grace', TEST_ONLY_WRONG, `10.0.0.${k}`))),
    );
    expect(results.filter((r) => r === 'bad_credentials')).toHaveLength(AUTH_CONFIG.LOCK_AFTER_FAILURES);
    expect(await code(svc.login('grace', TEST_ONLY_GOOD, '10.0.1.1'))).toBe('account_locked');
  });

  it('a successful login does not leave an IP failure entry behind', async () => {
    const { svc } = mk();
    await svc.register('heidi', TEST_ONLY_GOOD, '7.7.7.9');
    for (let k = 0; k < 25; k++) expect(await code(svc.login('heidi', TEST_ONLY_GOOD, '11.0.0.1'))).toBe('ok');
  });

  it('parallel registrations from one IP are capped at the daily limit (slot reserved before hashing)', async () => {
    const { svc } = mk();
    const results = await Promise.all(
      Array.from({ length: 10 }, (_, k) => code(svc.register(`par${k}`, TEST_ONLY_GOOD, '12.0.0.1'))),
    );
    expect(results.filter((r) => r === 'ok')).toHaveLength(3);
    expect(results.filter((r) => r === 'register_limited')).toHaveLength(7);
  });

  it('a rejected registration (taken name) does not consume the daily quota', async () => {
    const { svc } = mk();
    await svc.register('quota1', TEST_ONLY_GOOD, '13.0.0.1');
    for (let k = 0; k < 5; k++)
      expect(await code(svc.register('quota1', TEST_ONLY_GOOD, '13.0.0.1'))).toBe('username_taken');
    expect(await code(svc.register('quota2', TEST_ONLY_GOOD, '13.0.0.1'))).toBe('ok');
    expect(await code(svc.register('quota3', TEST_ONLY_GOOD, '13.0.0.1'))).toBe('ok');
    expect(await code(svc.register('quota4', TEST_ONLY_GOOD, '13.0.0.1'))).toBe('register_limited');
  });

  it('the hash queue is bounded: overflow answers 503', async () => {
    const { svc } = mk({ maxPendingHashes: 2, registerPerIpPerDay: 0 });
    const results = await Promise.all(
      Array.from({ length: 6 }, (_, k) => code(svc.register(`queued${k}`, TEST_ONLY_GOOD, '6.6.6.6'))),
    );
    expect(results.filter((r) => r === 'busy').length).toBeGreaterThan(0);
    expect(results.filter((r) => r === 'ok').length).toBeGreaterThan(0);
  });
});
