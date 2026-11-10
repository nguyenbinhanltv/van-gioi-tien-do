import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
// the helpers of `npm run play` live with the script (repo root scripts/), plain ESM
import * as lib from '../../../scripts/lib/play-lib.mjs';

const {
  DEFAULTS,
  buildOutcome,
  buildPhaseOf,
  buildUrls,
  editorActivityMs,
  idleLimitMin,
  isFirstBuild,
  makeBuildWatchdog,
  sourceFingerprint,
  checkNode,
  cocosEditorPath,
  controlLines,
  corsOrigins,
  installState,
  isBuildInput,
  lanAddresses,
  makeBuildLineFilter,
  needsRebuild,
  openCommand,
  newestSource,
  parseArgs,
  DATA_FILES,
  hasSavedData,
  resetCheck,
  resetData,
  storePlan,
  pickPort,
  reasonVi,
  variantOf,
} = lib as unknown as Record<string, any>;

type Opts = {
  offline: boolean;
  rebuild: boolean;
  dev: boolean;
  open: boolean;
  lan: boolean;
  smoke: boolean;
  memory: boolean;
  resetData: boolean;
  yes: boolean;
  help: boolean;
  clientPort: number;
  serverPort: number;
  buildTimeoutMin: number;
  buildTimeoutExplicit: boolean;
  clientPortExplicit: boolean;
  serverPortExplicit: boolean;
};
const parse = (...argv: string[]) => parseArgs(argv as never) as unknown as { opts: Opts; errors: string[] };

describe('play: argument parsing', () => {
  it('defaults: online, release, LAN on, ports 8456 / 8080 (not 7456, Cocos preview)', () => {
    const { opts, errors } = parse();
    expect(errors).toEqual([]);
    expect(opts).toEqual({
      offline: false,
      rebuild: false,
      dev: false,
      open: false,
      lan: true,
      smoke: false,
      memory: false,
      resetData: false,
      yes: false,
      help: false,
      clientPort: DEFAULTS.clientPort,
      serverPort: DEFAULTS.serverPort,
      buildTimeoutMin: 5,
      buildTimeoutExplicit: false,
      clientPortExplicit: false,
      serverPortExplicit: false,
    });
    expect(DEFAULTS).toMatchObject({ clientPort: 8456, serverPort: 8080 });
  });

  it('reads every flag, and ports in both `--port 1` and `--port=1` forms', () => {
    const { opts, errors } = parse(
      '--offline',
      '--rebuild',
      '--dev',
      '--open',
      '--no-lan',
      '--smoke',
      '--port',
      '9000',
      '--server-port=9001',
    );
    expect(errors).toEqual([]);
    expect(opts).toMatchObject({
      offline: true,
      rebuild: true,
      dev: true,
      open: true,
      lan: false,
      smoke: true,
      clientPort: 9000,
      serverPort: 9001,
    });
    expect(parse('--help').opts.help).toBe(true);
    expect(parse('-h').opts.help).toBe(true);
  });

  it('rejects unknown flags and bad ports instead of ignoring them', () => {
    expect(parse('--rebuilt').errors).toEqual(['unknown option "--rebuilt"']);
    expect(parse('--port').errors[0]).toMatch(/needs a port number/);
    expect(parse('--port', 'abc').errors[0]).toMatch(/got "abc"/);
    expect(parse('--port', '0').errors[0]).toMatch(/1-65535/);
    expect(parse('--server-port=70000').errors[0]).toMatch(/1-65535/);
    expect(parse('--port', '8080').errors).toEqual(['--port and --server-port must differ']);
    expect(parse('--offline', '--port', '8080').errors).toEqual([]); // no game server: no clash
  });

  it('knows whether a port was given explicitly (an explicit port is never moved)', () => {
    expect(parse().opts).toMatchObject({ clientPortExplicit: false, serverPortExplicit: false });
    expect(parse('--port', '9000').opts).toMatchObject({ clientPortExplicit: true, serverPortExplicit: false });
    expect(parse('--server-port=9001').opts).toMatchObject({ clientPortExplicit: false, serverPortExplicit: true });
    expect(parse('--port', '8456').opts.clientPortExplicit).toBe(true); // even when it equals the default
  });

  it('--build-timeout takes minutes 1-120 of NO progress, default 5 (and marks it as asked for)', () => {
    expect(parse().opts.buildTimeoutMin).toBe(5);
    expect(parse('--build-timeout', '3').opts.buildTimeoutExplicit).toBe(true);
    expect(parse('--build-timeout', '3').opts.buildTimeoutMin).toBe(3);
    expect(parse('--build-timeout=45').opts.buildTimeoutMin).toBe(45);
    for (const bad of ['0', '121', 'x', '-5'])
      expect(parse('--build-timeout', bad).errors[0], bad).toMatch(/minutes 1-120/);
    expect(parse('--build-timeout').errors[0]).toMatch(/got nothing/);
  });

  it('the build variant is release unless --dev', () => {
    expect(variantOf(parse().opts as never)).toBe('release');
    expect(variantOf(parse('--dev').opts as never)).toBe('dev');
  });
});

describe('play: does the web client need a build', () => {
  const build = { exists: true, mtimeMs: 1000, variant: 'release' };
  const src = { mtimeMs: 900, file: 'apps/client-cocos/assets/scripts/Combat.ts' };
  const decide = (over: Record<string, unknown> = {}) =>
    needsRebuild({ force: false, wantedVariant: 'release', build, newestSource: src, ...over } as never) as {
      rebuild: boolean;
      reason: string;
    };

  it('no rebuild when the build is there, the variant matches and no source is newer', () => {
    expect(decide()).toEqual({ rebuild: false, code: 'ok', reason: 'the build is up to date' });
    expect(decide({ newestSource: { ...src, mtimeMs: 1000 } }).rebuild).toBe(false); // same instant is not newer
    expect(decide({ newestSource: null }).rebuild).toBe(false);
  });

  it('rebuilds when there is no build yet', () => {
    expect(decide({ build: { exists: false } })).toEqual({ rebuild: true, code: 'none', reason: 'no build yet' });
  });

  it('rebuilds when a source is newer, naming the file', () => {
    const r = decide({ newestSource: { ...src, mtimeMs: 1001 } });
    expect(r.rebuild).toBe(true);
    expect(r.reason).toContain('Combat.ts');
  });

  it('every decision carries a code and a Vietnamese reason that names the file for stale sources', () => {
    expect(decide().code).toBe('ok');
    expect(decide({ build: { exists: false } }).code).toBe('none');
    expect(decide({ force: true }).code).toBe('forced');
    expect(decide({ wantedVariant: 'dev' }).code).toBe('variant');
    const stale = decide({ newestSource: { ...src, mtimeMs: 1001 } });
    expect(stale.code).toBe('stale');
    expect(reasonVi(stale)).toContain('Combat.ts');
    for (const d of [
      decide(),
      decide({ force: true }),
      decide({ build: { exists: false } }),
      decide({ wantedVariant: 'dev' }),
    ])
      expect(reasonVi(d).length).toBeGreaterThan(3);
  });

  it('--rebuild forces it even for an up-to-date build', () => {
    expect(decide({ force: true })).toEqual({ rebuild: true, code: 'forced', reason: 'forced by --rebuild' });
  });

  it('a different or unknown variant rebuilds (release <-> dev, or a build made by `npm run build:web`)', () => {
    expect(decide({ wantedVariant: 'dev' }).rebuild).toBe(true);
    expect(decide({ wantedVariant: 'dev' }).reason).toMatch(/"release", wanted "dev"/);
    const unknown = decide({ build: { exists: true, mtimeMs: 1000, variant: null } });
    expect(unknown.rebuild).toBe(true);
    expect(unknown.reason).toMatch(/"unknown"/);
  });
});

describe('play: which files count as build inputs', () => {
  it('sources count; .meta, generated output, tests, docs and build folders do not', () => {
    for (const ok of [
      'apps/client-cocos/assets/scripts/Combat.ts',
      'apps/client-cocos/assets/scenes/Bootstrap.scene',
      'packages/shared/src/iso.ts',
      'packages/client-combat/src/hotbar.ts',
      'apps/client-cocos/build-config.json',
    ])
      expect(isBuildInput(ok as never), ok).toBe(true);
    for (const no of [
      'apps/client-cocos/assets/scripts/Combat.ts.meta',
      'apps/client-cocos/assets/scripts/vendor/vgtd.mjs',
      'apps/client-cocos/assets/resources/world/iso-map.json',
      'apps/client-cocos/assets/chibi/x/y.json',
      'packages/shared/test/iso.test.ts',
      'packages/shared/README.md',
      'packages/shared/node_modules/x/index.js',
      'apps/client-cocos/build/web-mobile/index.html',
    ])
      expect(isBuildInput(no as never), no).toBe(false);
  });

  describe('newestSource on a real folder', () => {
    const dirs: string[] = [];
    afterEach(() => {
      for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
    });
    const touch = (root: string, rel: string, mtime: number) => {
      const p = join(root, rel);
      mkdirSync(join(p, '..'), { recursive: true });
      writeFileSync(p, 'x');
      utimesSync(p, mtime, mtime);
    };

    it('finds the newest real source and ignores newer .meta / generated / test files', () => {
      const root = mkdtempSync(join(tmpdir(), 'vgtd-play-'));
      dirs.push(root);
      touch(root, 'apps/client-cocos/assets/scripts/Old.ts', 1000);
      touch(root, 'packages/shared/src/new.ts', 2000); // newest real input
      touch(root, 'apps/client-cocos/assets/scripts/Old.ts.meta', 9000);
      touch(root, 'apps/client-cocos/assets/scripts/vendor/vgtd.mjs', 9000);
      touch(root, 'packages/shared/test/a.test.ts', 9000);
      touch(root, 'packages/shared/node_modules/p/index.js', 9000);
      const best = newestSource(root as never) as { mtimeMs: number; file: string };
      expect(best.file).toBe('packages/shared/src/new.ts');
      expect(best.mtimeMs).toBe(2000 * 1000);
    });

    it('returns null when there is nothing to look at', () => {
      const root = mkdtempSync(join(tmpdir(), 'vgtd-play-'));
      dirs.push(root);
      expect(newestSource(root as never)).toBeNull();
    });
  });
});

describe('play: preflight helpers', () => {
  it('Node version', () => {
    expect(checkNode('18.0.0' as never)).toMatchObject({ ok: true, major: 18 });
    expect(checkNode('22.3.1' as never)).toMatchObject({ ok: true });
    expect(checkNode('16.20.2' as never)).toMatchObject({ ok: false, major: 16, min: 18 });
    expect(checkNode('nope' as never)).toMatchObject({ ok: false });
  });

  it('npm ci state: missing, stale (lock newer than the install record), ok', () => {
    const st = (i: object) => installState(i as never);
    expect(st({ hasNodeModules: false, lockMtimeMs: 1, installMtimeMs: null })).toBe('missing');
    expect(st({ hasNodeModules: true, lockMtimeMs: 10_000, installMtimeMs: 5000 })).toBe('stale');
    expect(st({ hasNodeModules: true, lockMtimeMs: 5000, installMtimeMs: 10_000 })).toBe('ok');
    expect(st({ hasNodeModules: true, lockMtimeMs: 5500, installMtimeMs: 5000 })).toBe('ok'); // within the 1 s slack
    expect(st({ hasNodeModules: true, lockMtimeMs: 5000, installMtimeMs: null })).toBe('ok'); // no install record: no warning
  });

  it('Cocos editor path: COCOS_CREATOR_PATH wins, Windows has a default, other platforms need the variable', () => {
    const p = (env: object, platform: string) => cocosEditorPath(env as never, platform as never);
    expect(p({ COCOS_CREATOR_PATH: 'X:/c.exe' }, 'win32')).toBe('X:/c.exe');
    expect(p({}, 'win32')).toBe('C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe');
    expect(p({}, 'linux')).toBeNull();
  });
});

describe('play: URLs and addresses', () => {
  const ifaces = {
    lo: [{ family: 'IPv4', internal: true, address: '127.0.0.1' }],
    'Wi-Fi': [
      { family: 'IPv6', internal: false, address: 'fe80::1' },
      { family: 'IPv4', internal: false, address: '192.168.1.20' },
    ],
    Ethernet: [{ family: 'IPv4', internal: false, address: '10.0.0.5' }],
    Link: [{ family: 'IPv4', internal: false, address: '169.254.3.4' }],
  };

  it('LAN addresses: IPv4 only, no loopback and no link-local, sorted by interface name', () => {
    expect(lanAddresses(ifaces as never)).toEqual([
      { name: 'Ethernet', address: '10.0.0.5' },
      { name: 'Wi-Fi', address: '192.168.1.20' },
    ]);
  });

  it('URLs: the default server port is implicit, another port adds &server=host:port per address', () => {
    const lan = [{ name: 'Wi-Fi', address: '192.168.1.20' }];
    const u = buildUrls({ clientPort: 8456, serverPort: 8080, lan } as never) as {
      local: string;
      lan: { name: string; url: string }[];
      offline: string;
      offlinePlain: string;
    };
    expect(u.local).toBe('http://localhost:8456/?online=1&combat=1');
    expect(u.lan).toEqual([{ name: 'Wi-Fi', url: 'http://192.168.1.20:8456/?online=1&combat=1' }]);
    expect(u.offline).toBe('http://localhost:8456/?combat=1');
    expect(u.offlinePlain).toBe('http://localhost:8456/');
    const custom = buildUrls({ clientPort: 9000, serverPort: 9001, lan } as never) as typeof u;
    expect(custom.local).toBe('http://localhost:9000/?online=1&combat=1&server=localhost:9001');
    expect(custom.lan[0]!.url).toBe('http://192.168.1.20:9000/?online=1&combat=1&server=192.168.1.20:9001');
  });

  it('the game server accepts the page origin from localhost, 127.0.0.1 and every LAN address', () => {
    expect(corsOrigins({ clientPort: 8456, lan: [{ name: 'a', address: '192.168.1.20' }] } as never)).toBe(
      'http://localhost:8456,http://127.0.0.1:8456,http://192.168.1.20:8456',
    );
    expect(corsOrigins({ clientPort: 8456, lan: [] } as never)).toBe('http://localhost:8456,http://127.0.0.1:8456');
  });

  it('the cheat sheet lists only the controls that exist, in Vietnamese and English', () => {
    const lines = controlLines() as unknown as { vi: string; en: string; enabled: boolean }[];
    expect(lines.length).toBeGreaterThanOrEqual(5);
    expect(lines.every((l) => l.enabled && l.vi.length > 0 && l.en.length > 0)).toBe(true);
    expect(lines.some((l) => /Tab/.test(l.en))).toBe(true);
    expect(lines.some((l) => /bag/i.test(l.en))).toBe(true); // B toggles the bag panel (online)
    expect(lines.some((l) => /meditate/i.test(l.en))).toBe(false); // the meditation key is not in the client yet
  });
});

describe('play: build output filter', () => {
  it('keeps our lines, results, errors and warnings; drops the Cocos chatter and the known harmless editor error', () => {
    const keep = makeBuildLineFilter();
    for (const ok of [
      'release stage /x/build/stage-release: 6 files copied, 0 removed, 232 MB of dev art left out',
      'prepared vendor bundle + tilemap',
      'CocosCreator exit code: 36',
      'OK -> build/web-mobile',
      '11-9-2026 01:00:36 - debug: ================ build Task (web-mobile) Finished in (49 s)ms ================',
      'Build failed: build/web-mobile/index.html is missing - check the log above.',
      'Error: something broke',
      'Warn: [Assets] a real warning',
    ])
      expect(keep(ok), ok).toBe(true);
    for (const no of [
      '[Package] engine@1.0.12 enable',
      'Request namespace: device-list',
      '11-9-2026 00:40:35 - debug(2): [compress astc]Child process exit width code 0',
      'Recovery window failed.',
      'SyntaxError: C:\\Users\\x\\.CocosCreator\\editor\\window.json: Unexpected end of JSON input',
      '    at JSON.parse (<anonymous>)',
      '(node:1) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true',
    ])
      expect(keep(no), no).toBe(false);
  });

  it('shows each distinct message once, even when timestamps, counters and process ids differ', () => {
    const keep = makeBuildLineFilter();
    const w = "The 'this' keyword is equivalent to 'undefined' at the top level of an ES module";
    expect(keep(`Warn: [Assets] [Rollup] ${w}`)).toBe(true);
    expect(keep(`Warn: [Assets] [Rollup] ${w}`)).toBe(false);
    expect(keep(`11-9-2026 01:00:31 - warn(13): [Assets] [Rollup] ${w}`)).toBe(false); // same message, other prefix / counter
    expect(keep(`11-9-2026 01:00:32 - warn(14): [Assets] [Rollup] ${w}`)).toBe(false);
    expect(keep('[27764:1109/005800.006:ERROR:cache_util_win.cc(20)] Unable to move the cache')).toBe(true);
    expect(keep('[31000:1109/005900.111:ERROR:cache_util_win.cc(20)] Unable to move the cache')).toBe(false);
  });
});

describe('play: port picking', () => {
  const busy =
    (...ports: number[]) =>
    (p: number) =>
      !ports.includes(p);
  const pick = (i: object) => pickPort(i as never) as Promise<{ ok: boolean; port: number; moved?: boolean }>;

  it('a free port is used as is', async () => {
    expect(await pick({ start: 8456, explicit: false, isFree: busy() })).toEqual({
      ok: true,
      port: 8456,
      moved: false,
    });
    expect(await pick({ start: 8456, explicit: true, isFree: busy() })).toEqual({ ok: true, port: 8456, moved: false });
  });

  it('a busy DEFAULT port moves to the next free one', async () => {
    expect(await pick({ start: 8456, explicit: false, isFree: busy(8456) })).toEqual({
      ok: true,
      port: 8457,
      moved: true,
    });
    expect(await pick({ start: 8456, explicit: false, isFree: busy(8456, 8457, 8458) })).toEqual({
      ok: true,
      port: 8459,
      moved: true,
    });
  });

  it('a busy EXPLICIT port is an error, never moved', async () => {
    expect(await pick({ start: 8456, explicit: true, isFree: busy(8456) })).toEqual({ ok: false, port: 8456 });
  });

  it('never lands on a port the other server of this run already took', async () => {
    expect(await pick({ start: 8080, explicit: false, isFree: busy(8080), taken: [8081] })).toEqual({
      ok: true,
      port: 8082,
      moved: true,
    });
    expect((await pick({ start: 8456, explicit: false, isFree: busy(), taken: [8456] })).port).toBe(8457);
  });

  it('gives up after maxTries and at the top of the port range', async () => {
    const none = () => false;
    expect(await pick({ start: 8456, explicit: false, isFree: none, maxTries: 3 })).toEqual({ ok: false, port: 8456 });
    expect(await pick({ start: 65535, explicit: false, isFree: busy(65535) })).toEqual({ ok: false, port: 65535 });
  });
});

describe('openCommand', () => {
  const url = 'http://localhost:8456/?online=1&combat=1&server=localhost:8081';
  it('never goes through cmd.exe on Windows, so `&` in the URL survives', () => {
    const [cmd, args] = openCommand('win32', url);
    expect(cmd).not.toMatch(/cmd/i);
    expect(args).toEqual(['url.dll,FileProtocolHandler', url]);
  });
  it('passes the URL as a single untouched argument on macOS and Linux', () => {
    expect(openCommand('darwin', url)).toEqual(['open', [url]]);
    expect(openCommand('linux', url)).toEqual(['xdg-open', [url]]);
  });
});

describe('play: persistent data flags (D92)', () => {
  it('parses --memory, --reset-data and --yes, and rejects contradictory or pointless combinations', () => {
    expect(parse('--memory').opts.memory).toBe(true);
    const r = parse('--reset-data', '--yes');
    expect([r.opts.resetData, r.opts.yes, r.errors]).toEqual([true, true, []]);
    expect(parse('--memory', '--reset-data').errors.join()).toMatch(/nothing to reset/);
    expect(parse('--yes').errors.join()).toMatch(/only confirms --reset-data/);
  });
});

describe('play: store plan', () => {
  const root = join(tmpdir(), 'vgtd-play-root');
  it('defaults to the file store in <repo>/.vgtd-data', () => {
    expect(storePlan({ root, env: {}, opts: { memory: false } })).toEqual({
      store: 'file',
      dir: join(root, '.vgtd-data'),
      custom: false,
    });
  });
  it('--memory and STORE=memory turn it off; a bad STORE is an error; DATA_DIR is custom unless it is the default', () => {
    expect(storePlan({ root, env: {}, opts: { memory: true } }).store).toBe('memory');
    expect(storePlan({ root, env: { STORE: 'memory' }, opts: { memory: false } }).store).toBe('memory');
    expect(storePlan({ root, env: { STORE: 'pg' }, opts: { memory: false } }).error).toMatch(/STORE must be/);
    const other = join(tmpdir(), 'vgtd-elsewhere');
    expect(storePlan({ root, env: { DATA_DIR: other }, opts: { memory: false } })).toMatchObject({
      dir: other,
      custom: true,
    });
    expect(storePlan({ root, env: { DATA_DIR: join(root, '.vgtd-data') }, opts: { memory: false } }).custom).toBe(
      false,
    );
  });
});

describe('play: --reset-data safety', () => {
  const dirs: string[] = [];
  const mk = (): string => {
    const d = mkdtempSync(join(tmpdir(), 'vgtd-reset-'));
    dirs.push(d);
    return d;
  };
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  const repo = join(tmpdir(), 'some', 'repo');
  const home = join(tmpdir(), 'some', 'home');

  it('allows the default data dir inside the repo without --yes, a custom one only with --yes', () => {
    const def = join(repo, '.vgtd-data');
    expect(resetCheck({ root: repo, dir: def, custom: false, yes: false, home })).toEqual({ ok: true });
    const other = join(tmpdir(), 'elsewhere', 'data');
    expect(resetCheck({ root: repo, dir: other, custom: true, yes: false, home })).toMatchObject({ ok: false });
    expect(resetCheck({ root: repo, dir: other, custom: true, yes: true, home })).toEqual({ ok: true });
  });

  it('refuses the repo itself, its parents, the filesystem root and the home directory, even with --yes', () => {
    for (const dir of [repo, join(repo, '..'), join(repo, '..', '..'), home, join(home, '..'), resolve('/')]) {
      const r = resetCheck({ root: repo, dir, custom: true, yes: true, home });
      expect(r.ok, dir).toBe(false);
    }
  });

  it('deletes ONLY the known documents (+ .bak / .tmp) and leaves every other file; removes the dir only when empty', () => {
    const d = mk();
    for (const f of DATA_FILES) writeFileSync(join(d, f), '{}');
    writeFileSync(join(d, 'accounts.json.bak'), '{}');
    writeFileSync(join(d, 'ledger.json.tmp'), '{');
    writeFileSync(join(d, 'notes.txt'), 'keep me');
    mkdirSync(join(d, 'sub'));
    expect(hasSavedData(d)).toBe(true);
    const removed = resetData(d) as string[];
    expect(removed).toHaveLength(DATA_FILES.length + 2);
    expect(hasSavedData(d)).toBe(false);
    expect(readdirSync(d).sort()).toEqual(['notes.txt', 'sub']);
    // a directory that only held game data goes away with it
    const e = mk();
    for (const f of DATA_FILES) writeFileSync(join(e, f), '{}');
    resetData(e);
    expect(existsSync(e)).toBe(false);
    // nothing to reset is not an error
    expect(resetData(join(e, 'missing'))).toEqual([]);
  });
});

const progressDirs: string[] = [];
afterEach(() => {
  for (const d of progressDirs.splice(0)) rmSync(d, { recursive: true, force: true });
});
const mk = (): string => {
  const d = mkdtempSync(join(tmpdir(), 'vgtd-progress-'));
  progressDirs.push(d);
  return d;
};

describe('play: a slow first build is not a hung build (progress-aware timeout)', () => {
  const MIN = 60_000;
  it('the watchdog only fires after a stretch WITHOUT any sign of life, and every sign of life restarts the clock', () => {
    const w = makeBuildWatchdog({ idleMs: 5 * MIN, maxMs: 120 * MIN, now: 0 });
    expect(w.check(4 * MIN)).toBeNull();
    w.touch(4 * MIN); // a log line / a file written by the editor
    expect(w.check(8 * MIN)).toBeNull(); // 8 minutes in, but only 4 since the last sign of life
    expect(w.check(9 * MIN)).toBe('idle');
    expect(w.idleSec(9 * MIN)).toBe(300);
    expect(w.elapsedSec(9 * MIN)).toBe(540);
    w.touch(3 * MIN); // an older timestamp never moves the clock back
    expect(w.check(9 * MIN)).toBe('idle');
  });

  it('a build that keeps showing activity is never idle-killed (the old fixed 10 minutes killed exactly this one), but the hard cap still ends a runaway', () => {
    const w = makeBuildWatchdog({ idleMs: 5 * MIN, maxMs: 120 * MIN, now: 0 });
    for (let t = 1; t <= 40; t++) {
      w.touch(t * 2 * MIN); // 80 minutes of a slow import that writes files
      expect(w.check(t * 2 * MIN)).toBeNull();
    }
    expect(w.check(120 * MIN)).toBe('max');
  });

  it('the first build (no asset database) gets a much bigger idle allowance; a number the user asked for is taken literally', () => {
    const plain = { buildTimeoutMin: DEFAULTS.buildTimeoutMin, buildTimeoutExplicit: false };
    expect(idleLimitMin(plain, false)).toBe(DEFAULTS.buildTimeoutMin);
    expect(idleLimitMin(plain, true)).toBe(DEFAULTS.firstBuildTimeoutMin);
    expect(DEFAULTS.firstBuildTimeoutMin).toBeGreaterThan(DEFAULTS.buildTimeoutMin * 2);
    expect(idleLimitMin({ buildTimeoutMin: 3, buildTimeoutExplicit: true }, true)).toBe(3);
  });

  it('detects a first build from a missing / empty library, and reads editor activity from library/, temp/ and the output', () => {
    const d = mk();
    expect(isFirstBuild(d)).toBe(true);
    mkdirSync(join(d, 'library'));
    expect(isFirstBuild(d)).toBe(true); // empty
    mkdirSync(join(d, 'library/ab'), { recursive: true });
    writeFileSync(join(d, 'library/ab/abcdef.json'), '{}');
    expect(isFirstBuild(d)).toBe(false);
    expect(editorActivityMs(join(d, 'nothing-here'))).toBe(0);
    utimesSync(join(d, 'library/ab'), 1000, 1000);
    utimesSync(join(d, 'library'), 1000, 1000);
    const before = editorActivityMs(d);
    writeFileSync(join(d, 'library/ab/another.json'), '{}'); // the import writes a file into a two-character folder
    expect(editorActivityMs(d)).toBeGreaterThanOrEqual(before);
    mkdirSync(join(d, 'temp'));
    const future = Math.floor(Date.now() / 1000) + 86_400;
    utimesSync(join(d, 'temp'), future, future);
    expect(editorActivityMs(d)).toBeGreaterThanOrEqual(future * 1000 - 1000);
  });

  it('exit code 36 + a Finished line + the output present is a SUCCESS; without the line or the output it is not', () => {
    expect(buildOutcome({ code: 0, indexExists: true, sawFinished: false })).toEqual({ ok: true, note: '' });
    const ok36 = buildOutcome({ code: 36, indexExists: true, sawFinished: true });
    expect(ok36.ok).toBe(true);
    expect(ok36.note).toContain('36');
    expect(buildOutcome({ code: 36, indexExists: true, sawFinished: false }).ok).toBe(false);
    expect(buildOutcome({ code: 0, indexExists: false, sawFinished: true }).ok).toBe(false);
    expect(buildOutcome({ code: 36, indexExists: false, sawFinished: true }).note).toContain('missing');
  });

  it('reads the phase from the build log (asset import, then build, then finished)', () => {
    expect(buildPhaseOf('Start importing asset db')).toBe('import');
    expect(buildPhaseOf('refresh asset-db')).toBe('import');
    expect(buildPhaseOf('Start build task: web-mobile')).toBe('build');
    expect(buildPhaseOf('build Task (web-mobile) Finished in 51 s')).toBe('finished');
    expect(buildPhaseOf('something unrelated')).toBeNull();
  });
});

describe('play: an up-to-date build is reused (only timestamps moved, or only server code changed)', () => {
  it('needsRebuild reuses a "stale by mtime" build when the content fingerprint matches, and still rebuilds when it does not', () => {
    const build = { exists: true, variant: 'release', mtimeMs: 1000 };
    const src = { mtimeMs: 2000, file: 'apps/client-cocos/assets/scripts/Combat.ts' };
    const decide = (over: Record<string, unknown>) =>
      needsRebuild({ force: false, wantedVariant: 'release', build, newestSource: src, ...over } as never) as {
        rebuild: boolean;
        code: string;
        reason: string;
      };
    expect(decide({}).code).toBe('stale');
    expect(decide({ sameSources: false }).rebuild).toBe(true);
    const same = decide({ sameSources: true });
    expect(same).toMatchObject({ rebuild: false, code: 'ok' });
    expect(same.reason).toContain('content did not');
    // never overrides the other reasons to rebuild
    expect(decide({ sameSources: true, force: true }).rebuild).toBe(true);
    expect(decide({ sameSources: true, wantedVariant: 'dev' }).rebuild).toBe(true);
  });

  it('the fingerprint ignores touches, server code and generated output, and changes with the content of any client input', () => {
    const root = mk();
    const f = (rel: string, text: string) => {
      mkdirSync(join(root, rel, '..'), { recursive: true });
      writeFileSync(join(root, rel), text);
    };
    f('apps/client-cocos/assets/scripts/Combat.ts', 'export const a = 1;');
    f('packages/shared/src/x.ts', 'export const x = 1;');
    f('apps/server/src/world/node.ts', 'server code v1');
    f('apps/client-cocos/assets/scripts/Combat.ts.meta', 'meta v1');
    const h0 = sourceFingerprint(root);
    expect(h0).toMatch(/^[0-9a-f]{40}$/);
    // only timestamps moved (a branch switch / merge / touch)
    for (const rel of ['apps/client-cocos/assets/scripts/Combat.ts', 'packages/shared/src/x.ts'])
      utimesSync(join(root, rel), 5_000_000_000, 5_000_000_000);
    expect(sourceFingerprint(root)).toBe(h0);
    // the game SERVER, .meta files, tests and docs are not inputs of the web client
    f('apps/server/src/world/node.ts', 'server code v2, much longer than before');
    f('apps/client-cocos/assets/scripts/Combat.ts.meta', 'meta v2');
    f('packages/shared/test/x.test.ts', 'a test');
    f('packages/shared/README.md', 'docs');
    expect(sourceFingerprint(root)).toBe(h0);
    // a real change to a client input changes it, even with the same size and the same mtime
    f('apps/client-cocos/assets/scripts/Combat.ts', 'export const a = 2;');
    utimesSync(join(root, 'apps/client-cocos/assets/scripts/Combat.ts'), 5_000_000_000, 5_000_000_000);
    expect(sourceFingerprint(root)).not.toBe(h0);
    // adding / removing a file changes it too
    const h1 = sourceFingerprint(root);
    f('packages/shared/src/y.ts', 'new');
    expect(sourceFingerprint(root)).not.toBe(h1);
  });
});
