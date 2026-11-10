import { appendFileSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { WebSocket } from 'ws';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js';
import { TileGrid } from '@vgtd/sim';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  AuthError,
  AuthService,
  FileInviteLog,
  INVITE_CONFIG,
  InviteService,
  normalizeInviteCode,
  runInviteCli,
  startServer,
  type RunningServer,
} from '../src/index.js';

const FAST = { N: 1024, r: 8, p: 1 };
const PW = 'correct horse battery';

function setup(now: { t: number }) {
  const invites = new InviteService({ now: () => now.t });
  const auth = new AuthService({ scrypt: FAST, invites, registerPerIpPerDay: 0, now: () => now.t });
  return { invites, auth };
}
const code = (e: unknown): string | undefined => (e instanceof AuthError ? e.code : undefined);
const fail = async (p: Promise<unknown>): Promise<AuthError> => {
  try {
    await p;
  } catch (e) {
    return e as AuthError;
  }
  throw new Error('expected a failure');
};

describe('invite codes', () => {
  it('normalises case, separators and look-alikes; rejects malformed codes', () => {
    expect(normalizeInviteCode('abcd-efgh-jkmn-pqrs')).toBe('ABCDEFGHJKMNPQRS');
    expect(normalizeInviteCode(' O1IL 0000 0000 0000 ')).toBe('0111000000000000');
    expect(normalizeInviteCode('short')).toBeUndefined();
    expect(normalizeInviteCode('UUUU-UUUU-UUUU-UUUU')).toBeUndefined(); // U is not in the alphabet
    expect(normalizeInviteCode(42)).toBeUndefined();
  });

  it('a code registers exactly one account; the second use is refused like any invalid code', async () => {
    const now = { t: 1_000_000 };
    const { invites, auth } = setup(now);
    const [c] = invites.mint(1);
    expect(auth.inviteOnly).toBe(true);
    const r = await auth.register('alice_1', PW, '1.1.1.1', c!.code.toLowerCase());
    expect(r.accountId).toBeTruthy();
    const e = await fail(auth.register('bob_1234', PW, '1.1.1.1', c!.code));
    expect(e.status).toBe(403);
    expect(e.code).toBe('invite_invalid');
    expect(invites.list()[0]).toMatchObject({ status: 'used', usedBy: r.accountId });
  });

  it('answers every kind of invalid code alike and does not reveal whether a username exists', async () => {
    const now = { t: 1_000_000 };
    const { invites, auth } = setup(now);
    const [a, b, expired, revoked] = invites.mint(4, 1);
    await auth.register('taken_name', PW, 'ip', a!.code);
    invites.revoke(revoked!.id);
    now.t += 2 * 86_400_000;
    const [fresh] = invites.mint(1);
    const answers = await Promise.all(
      [undefined, '', 'nope', 'ZZZZ-ZZZZ-ZZZZ-ZZZZ', a!.code, expired!.code, revoked!.code].map((c, i) =>
        fail(auth.register('taken_name', PW, 'ip' + i, c)).then((e) => [e.status, e.code, e.message]),
      ),
    );
    for (const x of answers) expect(x).toEqual([403, 'invite_invalid', 'invalid or expired invitation code']);
    // with a valid code the taken name is reported as usual, and the code is NOT consumed by that failure
    expect(code(await fail(auth.register('taken_name', PW, 'ipX', fresh!.code)))).toBe('username_taken');
    expect(invites.list().find((r) => r.id === fresh!.id)!.status).toBe('unused');
    expect(b).toBeDefined();
  });

  it('parallel registrations with one code: exactly one wins', async () => {
    const now = { t: 1_000_000 };
    const { invites, auth } = setup(now);
    const [c] = invites.mint(1);
    const results = await Promise.allSettled(
      ['user_aaa', 'user_bbb', 'user_ccc', 'user_ddd'].map((u, i) => auth.register(u, PW, 'ip' + i, c!.code)),
    );
    expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
  });

  it('rate limits invalid codes per IP (429 with retry-after), other IPs unaffected, resets after the window', async () => {
    const now = { t: 1_000_000 };
    const { invites, auth } = setup(now);
    for (let i = 0; i < INVITE_CONFIG.FAIL_LIMIT; i++)
      expect(code(await fail(auth.register('user_' + i + 'aa', PW, 'bad-ip', 'wrong')))).toBe('invite_invalid');
    const e = await fail(auth.register('user_zzzz', PW, 'bad-ip', invites.mint(1)[0]!.code));
    expect(e.status).toBe(429);
    expect(e.code).toBe('invite_limited');
    expect(e.retryAfterS).toBeGreaterThan(0);
    await expect(auth.register('user_ok_1', PW, 'other-ip', invites.mint(1)[0]!.code)).resolves.toBeTruthy();
    now.t += INVITE_CONFIG.FAIL_WINDOW_MS + 1;
    await expect(auth.register('user_ok_2', PW, 'bad-ip', invites.mint(1)[0]!.code)).resolves.toBeTruthy();
  });

  it('expired and revoked codes are refused; mint validates its arguments', () => {
    const now = { t: 1_000_000 };
    const { invites } = setup(now);
    const [c] = invites.mint(1, 1);
    now.t += 86_400_000;
    expect(() => invites.claim(c!.code, 'x')).toThrow(AuthError);
    expect(invites.list()[0]!.status).toBe('expired');
    expect(() => invites.mint(0)).toThrow(RangeError);
    expect(() => invites.mint(1, INVITE_CONFIG.MAX_TTL_DAYS + 1)).toThrow(RangeError);
    expect(() => invites.mint(INVITE_CONFIG.MAX_MINT + 1)).toThrow(RangeError);
    expect(invites.revoke('zz')).toBeUndefined();
  });

  it('a failed registration gives the code back', async () => {
    const now = { t: 1_000_000 };
    const { invites, auth } = setup(now);
    const [a, b] = invites.mint(2);
    await auth.register('dup_name1', PW, 'ip', a!.code);
    await fail(auth.register('dup_name1', PW, 'ip', b!.code)); // username_taken
    await expect(auth.register('dup_name2', PW, 'ip', b!.code)).resolves.toBeTruthy();
  });
});

describe('invite log + CLI (shared file)', () => {
  it('stores only hashes, a running service sees codes minted and revoked by the CLI, and a use survives a restart', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-invites-'));
    const file = join(dir, 'invites.jsonl');
    try {
      const now = { t: 5_000_000 };
      const server = new InviteService({ log: new FileInviteLog(file), now: () => now.t });
      const auth = new AuthService({ scrypt: FAST, invites: server, registerPerIpPerDay: 0, now: () => now.t });
      // the operator CLI is another process: it only appends to the file
      const out: string[] = [];
      const err: string[] = [];
      const run = (argv: string[]): number =>
        runInviteCli(argv, { INVITES_FILE: file }, { out: (l) => out.push(l), err: (l) => err.push(l) }, () => now.t);
      expect(run(['mint', '--count', '2', '--days', '7'])).toBe(0);
      const codes = [...out];
      expect(codes).toHaveLength(2);
      const raw = readFileSync(file, 'utf8');
      for (const c of codes) expect(raw.replace(/-/g, '')).not.toContain(c.replace(/-/g, ''));
      expect(raw).not.toMatch(/alice|@/);

      await auth.register('alice_1', PW, 'ip', codes[0]); // the running server saw the minted code without a restart
      out.length = 0;
      expect(run(['list'])).toBe(0);
      expect(out.join('\n')).toMatch(/used/);
      expect(out.join('\n')).not.toMatch(/alice/); // no account name in the operator listing
      const id = server.list().find((r) => r.status === 'unused')!.id;
      expect(run(['revoke', id.slice(0, 5)])).toBe(0);
      expect(code(await fail(auth.register('bob_1234', PW, 'ip2', codes[1])))).toBe('invite_invalid'); // revoked by the CLI

      const restarted = new InviteService({ log: new FileInviteLog(file), now: () => now.t });
      expect(
        restarted
          .list()
          .map((r) => r.status)
          .sort(),
      ).toEqual(['revoked', 'used']);
      expect(run(['revoke', 'zzzz'])).toBe(2);
      expect(run(['mint', '--count', '0'])).toBe(2);
      expect(run(['bogus'])).toBe(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('ignores a torn last line and corrupt lines', () => {
    const dir = mkdtempSync(join(tmpdir(), 'vgtd-invites-'));
    const file = join(dir, 'invites.jsonl');
    try {
      const a = new InviteService({ log: new FileInviteLog(file) });
      a.mint(1);
      appendFileSync(file, 'not json\n{"t":"mint","id":"x"}\n{"t":"use","id":"abc');
      expect(new InviteService({ log: new FileInviteLog(file) }).list()).toHaveLength(1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('HTTP gate', () => {
  let srv: RunningServer;
  let invites: InviteService;
  const url = (p: string): string => `http://127.0.0.1:${srv.port}${p}`;
  const post = async (p: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> => {
    const r = await fetch(url(p), { method: 'POST', body: JSON.stringify(body) });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  };
  beforeAll(async () => {
    invites = new InviteService();
    srv = await startServer({
      port: 0,
      autoTick: false,
      auth: { scrypt: FAST, invites, registerPerIpPerDay: 0 },
      world: { mapTiles: 64 },
    });
  });
  afterAll(async () => {
    await srv.stop();
  });

  it('health says invite-only; register needs the code; login of an existing account needs none', async () => {
    expect((await (await fetch(url('/health'))).json()) as { inviteOnly: boolean }).toMatchObject({ inviteOnly: true });
    const none = await post('/auth/register', { username: 'tester_01', password: PW });
    expect(none.status).toBe(403);
    expect(none.json.error).toBe('invite_invalid');
    const c = invites.mint(1)[0]!.code;
    const ok = await post('/auth/register', { username: 'tester_01', password: PW, inviteCode: c });
    expect(ok.status).toBe(201);
    expect((await post('/auth/login', { username: 'tester_01', password: PW })).status).toBe(200);
    expect((await post('/auth/register', { username: 'tester_02', password: PW, inviteCode: c })).status).toBe(403);
  });

  it('without BETA_INVITE_ONLY registration is open and ignores a stray code', async () => {
    const open = await startServer({ port: 0, autoTick: false, auth: { scrypt: FAST }, world: { mapTiles: 64 } });
    try {
      const r = await fetch(`http://127.0.0.1:${open.port}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ username: 'open_user', password: PW, inviteCode: 'whatever' }),
      });
      expect(r.status).toBe(201);
    } finally {
      await open.stop();
    }
  });
});

describe('NetClient with an invitation code', () => {
  it('registers with the code, and a later session of the same account logs in without it', async () => {
    const invites = new InviteService();
    const srv = await startServer({
      port: 0,
      autoTick: false,
      auth: { scrypt: FAST, invites, registerPerIpPerDay: 0 },
      world: { mapTiles: 64 },
    });
    const deps: NetDeps = {
      fetch: (u, init) => fetch(u, init),
      WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
      now: () => performance.now(),
    };
    const make = (inviteCode?: string): NetClient =>
      new NetClient({
        baseUrl: `http://127.0.0.1:${srv.port}`,
        username: 'invited_01',
        password: PW,
        ...(inviteCode ? { inviteCode } : {}),
        deps,
        makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
      });
    try {
      await expect(make().connect()).rejects.toThrow(/403/); // no code: refused
      await expect(make('AAAA-BBBB-CCCC-DDDD').connect()).rejects.toThrow(/403/); // wrong code
      const first = make(invites.mint(1)[0]!.code);
      await first.connect();
      expect(first.status).toBe('online');
      first.close();
      const again = make(); // existing account, no code: register answers 403, login succeeds
      await again.connect();
      expect(again.status).toBe('online');
      again.close();
    } finally {
      await srv.stop();
    }
  });

  it('an existing account logs in 15+ times from one IP (register without a code on every login) and is never locked out', async () => {
    const invites = new InviteService();
    const srv = await startServer({
      port: 0,
      autoTick: false,
      auth: { scrypt: FAST, invites, registerPerIpPerDay: 0, ipFailLimit: 1_000_000 },
      world: { mapTiles: 64 },
    });
    const deps: NetDeps = {
      fetch: (u, init) => fetch(u, init),
      WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
      now: () => performance.now(),
    };
    const make = (name: string, inviteCode?: string): NetClient =>
      new NetClient({
        baseUrl: `http://127.0.0.1:${srv.port}`,
        username: name,
        password: PW,
        ...(inviteCode ? { inviteCode } : {}),
        deps,
        makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
      });
    try {
      const first = make('loop_user_1', invites.mint(1)[0]!.code);
      await first.connect();
      first.close();
      for (let i = 0; i < INVITE_CONFIG.FAIL_LIMIT + 6; i++) {
        const c = make('loop_user_1');
        await c.connect();
        expect(c.status).toBe('online');
        c.close();
      }
      // wrong codes still count and limit, but a code-less request is never limited: it keeps the same 403
      for (let i = 0; i < INVITE_CONFIG.FAIL_LIMIT; i++)
        await fetch(`http://127.0.0.1:${srv.port}/auth/register`, {
          method: 'POST',
          body: JSON.stringify({ username: 'x_user_' + i, password: PW, inviteCode: 'AAAA-AAAA-AAAA-AAAA' }),
        });
      const limited = await fetch(`http://127.0.0.1:${srv.port}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ username: 'x_user_z', password: PW, inviteCode: 'AAAA-AAAA-AAAA-AAAA' }),
      });
      expect(limited.status).toBe(429);
      const codeless = await fetch(`http://127.0.0.1:${srv.port}/auth/register`, {
        method: 'POST',
        body: JSON.stringify({ username: 'loop_user_1', password: PW }),
      });
      expect(codeless.status).toBe(403);
      const again = make('loop_user_1'); // the same IP is now invite-limited, and the existing account still gets in
      await again.connect();
      expect(again.status).toBe('online');
      again.close();
    } finally {
      await srv.stop();
    }
  });
});
