// Pure helpers of `npm run play` (scripts/play.mjs): argument parsing, "does the web client need a rebuild", preflight checks, URLs and
// the controls cheat sheet. No process spawning here, so everything is unit-tested (apps/client-cocos/test/play-lib.test.ts).
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, rmSync, rmdirSync, statSync } from 'node:fs';
import { homedir, networkInterfaces } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';

export const DEFAULTS = Object.freeze({
  clientPort: 8456,
  serverPort: 8080,
  minNodeMajor: 18,
  /** a build is stopped after this many minutes WITHOUT any sign of life (no new log line, no file written by the editor) */
  buildTimeoutMin: 5,
  /** the same, for the FIRST build (no asset database yet: the editor imports every asset, which is silent and slow) */
  firstBuildTimeoutMin: 20,
  /** hard cap on the whole build, however alive it looks */
  buildMaxMin: 120,
});

export const USAGE = `npm run play -- [options]

  --offline            client only (no game server): offline mode, mock combat with ?combat=1
  --rebuild            force a web client build even if the existing build looks up to date
  --dev                build the debug variant (inspector friendly, includes the dev animation-viewer art, ~230 MB bigger)
                       default is the RELEASE variant: minified, no dev art, loads much faster on phones over Wi-Fi
  --open               open the default browser on the online URL (offline URL with --offline)
  --no-lan             game server on 127.0.0.1 only (default: all interfaces, so phones on the same Wi-Fi can connect)
  --port <n>           client (static) port, default ${DEFAULTS.clientPort} (not 7456: that is Cocos Creator's own preview server)
  --server-port <n>    game server port, default ${DEFAULTS.serverPort}
                       a busy DEFAULT port is replaced by the next free one and the URLs show the real port; a busy port you
                       asked for explicitly is an error
  --build-timeout <m>  give up on a web client build after <m> minutes with NO progress (no new build-log line, no file written by the
                       editor; default ${DEFAULTS.buildTimeoutMin}, ${DEFAULTS.firstBuildTimeoutMin} for the first build, which imports every asset); a normal build takes 1-2 minutes
  --smoke              start, wait until healthy, print the URLs, then stop again (used to check the setup / CI)
  --memory             keep nothing between runs (STORE=memory). Default: STORE=file, accounts / characters / bags in
                       ./.vgtd-data (or $DATA_DIR) survive a restart
  --reset-data         delete the saved play-test data (only accounts.json, progression.json, inventories.json, sect.json, friends.json, quests.json, ledger.json, journal.json and
                       their .bak) before starting; with a custom $DATA_DIR it also needs --yes
  --yes                confirm --reset-data on a custom $DATA_DIR
  --help               this text
`;

/** @param {string} v */
function toPort(v) {
  if (!/^\d+$/.test(v)) return null;
  const n = Number(v);
  return n >= 1 && n <= 65535 ? n : null;
}

/**
 * Parse the CLI arguments (everything after `node scripts/play.mjs`). Unknown flags and bad values are collected in `errors`
 * instead of being ignored: a typo in `--rebuild` must not silently serve a stale build.
 * @param {readonly string[]} argv
 */
export function parseArgs(argv) {
  const opts = {
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
    buildTimeoutMin: DEFAULTS.buildTimeoutMin,
    buildTimeoutExplicit: false,
    // true when the port was given on the command line: an explicit port is never moved, a busy one is an error
    clientPortExplicit: false,
    serverPortExplicit: false,
  };
  /** @type {string[]} */
  const errors = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const eq = a.indexOf('=');
    const name = eq > 0 ? a.slice(0, eq) : a;
    const inline = eq > 0 ? a.slice(eq + 1) : undefined;
    const value = () => (inline !== undefined ? inline : argv[++i]);
    switch (name) {
      case '--offline':
        opts.offline = true;
        break;
      case '--rebuild':
        opts.rebuild = true;
        break;
      case '--dev':
        opts.dev = true;
        break;
      case '--open':
        opts.open = true;
        break;
      case '--no-lan':
        opts.lan = false;
        break;
      case '--smoke':
        opts.smoke = true;
        break;
      case '--memory':
        opts.memory = true;
        break;
      case '--reset-data':
        opts.resetData = true;
        break;
      case '--yes':
        opts.yes = true;
        break;
      case '--help':
      case '-h':
        opts.help = true;
        break;
      case '--build-timeout': {
        const raw = value();
        const m = raw !== undefined && /^\d+$/.test(raw) ? Number(raw) : 0;
        if (m < 1 || m > 120)
          errors.push(`--build-timeout needs minutes 1-120 (got ${raw === undefined ? 'nothing' : `"${raw}"`})`);
        else {
          opts.buildTimeoutMin = m;
          opts.buildTimeoutExplicit = true;
        }
        break;
      }
      case '--port':
      case '--server-port': {
        const raw = value();
        const p = raw === undefined ? null : toPort(raw);
        if (p === null)
          errors.push(`${name} needs a port number 1-65535 (got ${raw === undefined ? 'nothing' : `"${raw}"`})`);
        else if (name === '--port') {
          opts.clientPort = p;
          opts.clientPortExplicit = true;
        } else {
          opts.serverPort = p;
          opts.serverPortExplicit = true;
        }
        break;
      }
      default:
        errors.push(`unknown option "${a}"`);
    }
  }
  if (!opts.offline && opts.clientPort === opts.serverPort) errors.push('--port and --server-port must differ');
  if (opts.memory && opts.resetData) errors.push('--reset-data has nothing to reset with --memory');
  if (opts.yes && !opts.resetData) errors.push('--yes only confirms --reset-data');
  return { opts, errors };
}

// ------------------------------------------------------------------------------------------------ persistent play-test data (D92)
/** The only files `--reset-data` ever deletes (file store documents + their `.bak` / `.tmp`), never anything else in the directory. */
export const DATA_FILES = Object.freeze([
  'accounts.json',
  'progression.json',
  'inventories.json',
  // the write-ahead journal of a multi-document commit (D102): a leftover one would be re-applied over a reset
  'journal.json',
  'sect.json',
  'friends.json',
  'quests.json',
  'ledger.json',
]);

/**
 * Which store the play-test server uses and where its data lives. `STORE=file` unless `--memory` (or `STORE=memory` in the
 * environment); `DATA_DIR` from the environment, else `<repo>/.vgtd-data` (gitignored).
 * @param {{ root: string, env: Record<string, string | undefined>, opts: { memory: boolean } }} i
 * @returns {{ store: 'file' | 'memory', dir: string, custom: boolean, error?: string }}
 */
export function storePlan({ root, env, opts }) {
  const def = join(root, '.vgtd-data');
  const fromEnv = env.DATA_DIR && env.DATA_DIR.trim() !== '' ? resolve(root, env.DATA_DIR) : null;
  const dir = fromEnv ?? def;
  const custom = fromEnv !== null && fromEnv !== def;
  const want = opts.memory ? 'memory' : (env.STORE ?? 'file');
  if (want !== 'file' && want !== 'memory')
    return { store: 'memory', dir, custom, error: `STORE must be "file" or "memory" (got "${want}")` };
  return { store: want, dir, custom };
}

/**
 * Is it safe to wipe this data directory? Only the known document names are ever removed (see `DATA_FILES`), so even a wrong path
 * cannot lose anything else; on top of that a custom directory needs `--yes`, and the repo root, its parents, the filesystem root
 * and the home directory are refused outright.
 * @param {{ root: string, dir: string, custom: boolean, yes: boolean, home?: string }} i
 * @returns {{ ok: true } | { ok: false, reason: string }}
 */
export function resetCheck({ root, dir, custom, yes, home = homedir() }) {
  const d = resolve(dir);
  if (!isAbsolute(d)) return { ok: false, reason: `"${dir}" is not an absolute path` };
  if (dirname(d) === d) return { ok: false, reason: 'that is a filesystem root' };
  const r = resolve(root);
  const inside = (parent, child) => {
    const rel = relative(parent, child);
    return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
  };
  if (inside(d, r)) return { ok: false, reason: 'that directory contains the repository' };
  if (resolve(home) === d || inside(d, resolve(home)))
    return { ok: false, reason: 'that is (or contains) your home directory' };
  if (custom && !yes)
    return { ok: false, reason: `${d} is a custom DATA_DIR: add --yes to confirm wiping its saved game data` };
  return { ok: true };
}

/**
 * Delete the saved play-test documents in `dir`. Returns the files removed. Removes the directory only if it is left empty.
 * @param {string} dir
 * @returns {string[]}
 */
export function resetData(dir) {
  const removed = [];
  for (const base of DATA_FILES) {
    for (const suffix of ['', '.bak', '.tmp']) {
      const f = join(dir, base + suffix);
      if (existsSync(f)) {
        rmSync(f, { force: true });
        removed.push(f);
      }
    }
  }
  try {
    rmdirSync(dir); // only succeeds when empty
  } catch {
    /* not empty or already gone: leave it */
  }
  return removed;
}

/** Does a saved game already exist in `dir`? (for the banner: "continuing" vs "new") */
export const hasSavedData = (dir) =>
  existsSync(join(dir, 'accounts.json')) || existsSync(join(dir, 'accounts.json.bak'));

// ------------------------------------------------------------------------------------------------ rebuild decision
/** Which build variant `play` serves: release unless `--dev`. Recorded next to the build so a variant switch rebuilds. */
export const variantOf = (opts) => (opts.dev ? 'dev' : 'release');

/**
 * Does the web client need a (re)build?
 * @param {{ force: boolean, wantedVariant: string,
 *           build: { exists: boolean, mtimeMs?: number, variant?: string | null },
 *           newestSource: { mtimeMs: number, file: string } | null }} i
 * @returns {{ rebuild: boolean, code: 'forced' | 'none' | 'variant' | 'stale' | 'ok', reason: string, file?: string }}
 */
export function needsRebuild(i) {
  const r = decideRebuild(i);
  // timestamps moved (a `git switch`, a merge, a checkout touch every file) but the CONTENT is what the build was made from: reuse it
  if (r.code === 'stale' && i.sameSources === true)
    return {
      rebuild: false,
      code: 'ok',
      reason: 'the build is up to date (source timestamps changed, content did not)',
    };
  return r;
}
function decideRebuild(i) {
  if (i.force) return { rebuild: true, code: 'forced', reason: 'forced by --rebuild' };
  if (!i.build.exists) return { rebuild: true, code: 'none', reason: 'no build yet' };
  if (i.build.variant !== i.wantedVariant)
    return {
      rebuild: true,
      code: 'variant',
      reason: `the existing build is "${i.build.variant ?? 'unknown'}", wanted "${i.wantedVariant}"`,
    };
  const src = i.newestSource;
  if (src && src.mtimeMs > (i.build.mtimeMs ?? 0))
    return { rebuild: true, code: 'stale', file: src.file, reason: `sources are newer than the build (${src.file})` };
  return { rebuild: false, code: 'ok', reason: 'the build is up to date' };
}

/** Vietnamese twin of the `needsRebuild` reason (the English `reason` stays on the English line). */
export function reasonVi(decision) {
  switch (decision.code) {
    case 'forced':
      return 'do --rebuild';
    case 'none':
      return 'chưa có bản build';
    case 'variant':
      return 'bản build hiện có khác loại (release / dev)';
    case 'stale':
      return `mã nguồn mới hơn bản build (${decision.file})`;
    default:
      return 'bản build còn mới';
  }
}

/** Directories (relative to the repo root) whose files end up in the web client: scripts, scenes, art, the vendored packages. */
export const SOURCE_DIRS = Object.freeze([
  'apps/client-cocos/assets',
  'apps/client-cocos/settings',
  'apps/client-cocos/vendor-src',
  'apps/client-cocos/scripts',
  'apps/client-cocos/build-config.json',
  'packages',
  'tools/procgen/src',
]);

const SKIP_SEGMENTS = new Set(['node_modules', 'build', 'library', 'temp', 'dist', 'test', 'tests', 'coverage']);
// generated by `prepare.mjs` on every build: they must not count as changed sources
const GENERATED_PREFIXES = [
  'apps/client-cocos/assets/scripts/vendor',
  'apps/client-cocos/assets/resources/world',
  'apps/client-cocos/assets/chibi',
];

/** Is this repo-relative path (forward slashes) an input of the web client build? */
export function isBuildInput(rel) {
  if (rel.endsWith('.meta')) return false; // the Cocos editor rewrites .meta files when it opens or builds the project
  if (/\.test\.[cm]?[jt]s$/.test(rel) || rel.endsWith('.md')) return false;
  if (GENERATED_PREFIXES.some((p) => rel === p || rel.startsWith(`${p}/`))) return false;
  return !rel.split('/').some((seg) => SKIP_SEGMENTS.has(seg));
}

/**
 * Newest modification time among the build inputs.
 * @param {string} root repo root
 * @param {readonly string[]} [dirs]
 * @returns {{ mtimeMs: number, file: string } | null}
 */
export function newestSource(root, dirs = SOURCE_DIRS) {
  let best = null;
  const visit = (abs) => {
    const rel = relative(root, abs).split(sep).join('/');
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      const base = rel.split('/').pop();
      if (SKIP_SEGMENTS.has(base) || GENERATED_PREFIXES.includes(rel)) return;
      for (const name of readdirSync(abs)) visit(join(abs, name));
    } else if (isBuildInput(rel) && (!best || st.mtimeMs > best.mtimeMs)) {
      best = { mtimeMs: st.mtimeMs, file: rel };
    }
  };
  for (const d of dirs) visit(join(root, d));
  return best;
}

// ------------------------------------------------------------------------------------------------ ports
/**
 * Choose the port to use. An explicit port is kept or rejected; a default port that is busy moves to the next free one (at most
 * `maxTries` further), never onto a port in `taken` (the other server of this run).
 * @param {{ start: number, explicit: boolean, isFree: (port: number) => Promise<boolean> | boolean,
 *           taken?: readonly number[], maxTries?: number }} i
 * @returns {Promise<{ ok: true, port: number, moved: boolean } | { ok: false, port: number }>}
 */
export async function pickPort({ start, explicit, isFree, taken = [], maxTries = 20 }) {
  if (!taken.includes(start) && (await isFree(start))) return { ok: true, port: start, moved: false };
  if (explicit) return { ok: false, port: start };
  for (let p = start + 1; p <= Math.min(65535, start + maxTries); p++) {
    if (!taken.includes(p) && (await isFree(p))) return { ok: true, port: p, moved: true };
  }
  return { ok: false, port: start };
}

// ------------------------------------------------------------------------------------------------ build output
/**
 * Console filter for the (very chatty) Cocos Creator build log: our own script lines, the result, errors and warnings pass; everything
 * else is left to the log file. Each distinct message is shown once (Cocos repeats the same warning dozens of times, with changing
 * timestamps and process ids). Returns a stateful predicate `(line) => boolean`.
 */
export function makeBuildLineFilter() {
  const seen = new Set();
  const normalise = (t) =>
    t
      .replace(/^\d{1,2}-\d{1,2}-\d{4} \d\d:\d\d:\d\d - /, '')
      .replace(/\[\d+:\d{4}\/[\d.]+:/g, '[')
      .replace(/\b(warn|debug|log)\(\d+\)/gi, '$1')
      .replace(/^(warn|debug|log): /i, '');
  return (line) => {
    const t = line.trim();
    // a corrupt editor window file makes Cocos print a harmless stack on every start (it stays in the log file)
    if (/Recovery window failed|window\.json|^at /.test(t)) return false;
    let keep = false;
    if (
      /^(release stage|OK ->|CocosCreator exit code|Build failed|prepared |chibi bundles|dragonbones-testrig|Cocos Creator not found)/.test(
        t,
      )
    )
      keep = true;
    else if (/build Task .* Finished/.test(t)) keep = true;
    else if (/\b(error|failed|exception|cannot|not found)\b/i.test(t)) keep = true;
    else if (/\bwarn(ing)?\b/i.test(t) && !/deprecat|DEP0/i.test(t)) keep = true;
    if (!keep) return false;
    const key = normalise(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  };
}

// ------------------------------------------------------------------------------------------------ preflight
/** @param {string} version e.g. process.versions.node */
export function checkNode(version, min = DEFAULTS.minNodeMajor) {
  const major = Number(String(version).split('.')[0]);
  return { ok: Number.isInteger(major) && major >= min, major, min };
}

/**
 * `npm ci` state from file times: missing node_modules is an error, a package-lock.json newer than npm's hidden install record warns.
 * @param {{ hasNodeModules: boolean, lockMtimeMs: number | null, installMtimeMs: number | null }} i
 * @returns {'missing' | 'stale' | 'ok'}
 */
export function installState(i) {
  if (!i.hasNodeModules) return 'missing';
  if (i.lockMtimeMs !== null && i.installMtimeMs !== null && i.lockMtimeMs > i.installMtimeMs + 1000) return 'stale';
  return 'ok';
}

/** Where the Cocos Creator editor is expected: `COCOS_CREATOR_PATH`, else the Windows install path build-web.mjs also defaults to. */
export function cocosEditorPath(env, platform) {
  if (env.COCOS_CREATOR_PATH) return env.COCOS_CREATOR_PATH;
  return platform === 'win32' ? 'C:/ProgramData/cocos/editors/Creator/3.8.8/CocosCreator.exe' : null;
}

// ------------------------------------------------------------------------------------------------ URLs
/** IPv4 addresses a phone on the same network can use (no loopback, no link-local). */
export function lanAddresses(ifaces = networkInterfaces()) {
  const out = [];
  for (const [name, list] of Object.entries(ifaces)) {
    for (const a of list ?? []) {
      if (a.family === 'IPv4' && !a.internal && !a.address.startsWith('169.254.'))
        out.push({ name, address: a.address });
    }
  }
  return out.sort((x, y) => x.name.localeCompare(y.name) || x.address.localeCompare(y.address));
}

/** The URLs to print. A non-default game server port needs `&server=host:port` (the page only talks to its own host or localhost). */
export function buildUrls({ clientPort, serverPort, lan }) {
  const q = (host) => `?online=1&combat=1${serverPort === DEFAULTS.serverPort ? '' : `&server=${host}:${serverPort}`}`;
  return {
    local: `http://localhost:${clientPort}/${q('localhost')}`,
    lan: lan.map((l) => ({ name: l.name, url: `http://${l.address}:${clientPort}/${q(l.address)}` })),
    offline: `http://localhost:${clientPort}/?combat=1`,
    offlinePlain: `http://localhost:${clientPort}/`,
  };
}

/** CORS origins the game server must accept: the page origin as seen locally and from each LAN address. */
export function corsOrigins({ clientPort, lan }) {
  return [
    `http://localhost:${clientPort}`,
    `http://127.0.0.1:${clientPort}`,
    ...lan.map((l) => `http://${l.address}:${clientPort}`),
  ].join(',');
}

// ------------------------------------------------------------------------------------------------ controls cheat sheet
/** One entry per control: Vietnamese, English. `enabled: false` entries are for features that are not in the client yet. */
export const CONTROLS = Object.freeze([
  { vi: 'Click chuột / WASD: di chuyển', en: 'Click / WASD: move', enabled: true },
  { vi: 'Giữ Shift: đi bộ (chậm)', en: 'Hold Shift: walk', enabled: true },
  {
    vi: 'Phím 1-8: dùng kỹ năng (chế độ combat); phím 1-6 đổi lớp khi không bật combat',
    en: 'Keys 1-8: skills (combat mode); keys 1-6 switch class when combat is off',
    enabled: true,
  },
  {
    vi: 'Tab / Shift+Tab: chọn mục tiêu kế / trước; click quái: chọn; Esc: bỏ chọn',
    en: 'Tab / Shift+Tab: next / previous target; click a monster: select; Esc: clear',
    enabled: true,
  },
  {
    vi: 'Con trỏ chuột = hướng / điểm ngắm của kỹ năng vùng và hình quạt',
    en: 'The mouse pointer is the aim of area and cone skills',
    enabled: true,
  },
  {
    vi: 'Điện thoại: thêm ?input=touch để dùng joystick; chạm ô kỹ năng để dùng',
    en: 'Phone: add ?input=touch for the joystick; tap a skill slot to cast',
    enabled: true,
  },
  // enable when the client has it (the meditation key):
  { vi: 'B: mở / đóng túi đồ (khi chơi online)', en: 'B: open / close the bag (online)', enabled: true },
  { vi: 'M: đả tọa (tu luyện)', en: 'M: meditate', enabled: false },
]);

export const controlLines = () => CONTROLS.filter((c) => c.enabled);

/**
 * Command + args that open `target` in the default browser. No shell is involved: on Windows `cmd /c start` would treat an
 * unquoted `&` in the URL as a command separator and cut the query string (`?online=1&combat=1`), so use the URL handler
 * through rundll32, which receives the URL as one argument.
 */
export function openCommand(platform, target) {
  if (platform === 'win32') return ['rundll32', ['url.dll,FileProtocolHandler', target]];
  if (platform === 'darwin') return ['open', [target]];
  return ['xdg-open', [target]];
}

// ------------------------------------------------------------------------------------------------ build progress
/**
 * Content fingerprint of the build inputs: sha1 over every input's repo-relative path and size, plus the CONTENT of every file up to 1 MiB
 * (code, scenes, small assets; a big binary asset is covered by path + size). Stored next to the build; when the timestamps say "stale" but the
 * fingerprint still matches, the build is reused (switching branches, merging, or a `touch` must not trigger a 1-60 minute rebuild, and
 * neither may a change that only the game SERVER cares about: `apps/server` is not an input at all).
 * @param {string} root repo root
 * @param {readonly string[]} [dirs]
 * @returns {string} hex digest
 */
export function sourceFingerprint(root, dirs = SOURCE_DIRS) {
  const h = createHash('sha1');
  const files = [];
  const visit = (abs) => {
    const rel = relative(root, abs).split(sep).join('/');
    let st;
    try {
      st = statSync(abs);
    } catch {
      return;
    }
    if (st.isDirectory()) {
      const base = rel.split('/').pop();
      if (SKIP_SEGMENTS.has(base) || GENERATED_PREFIXES.includes(rel)) return;
      for (const name of readdirSync(abs).sort()) visit(join(abs, name));
    } else if (isBuildInput(rel)) files.push([rel, abs, st.size]);
  };
  for (const d of dirs) visit(join(root, d));
  files.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  for (const [rel, abs, size] of files) {
    h.update(`${rel}\0${size}\0`);
    if (size <= 1_048_576) {
      try {
        h.update(readFileSync(abs));
      } catch {
        h.update('?');
      }
    }
  }
  return h.digest('hex');
}

/** True when the editor has no asset database for the project yet (no `library/`): its first build imports every asset, silently, for minutes. */
export function isFirstBuild(clientDir) {
  const lib = join(clientDir, 'library');
  try {
    return !statSync(lib).isDirectory() || readdirSync(lib).length === 0;
  } catch {
    return true;
  }
}

/**
 * Latest modification time of the places the editor writes while it imports / builds: `library/` and its immediate sub-directories (the
 * imported assets land in two-character folders), `temp/`, and the build output. A growing number means the editor is alive even while it
 * prints nothing. 0 when none exists.
 */
export function editorActivityMs(clientDir) {
  let best = 0;
  const touch = (p) => {
    try {
      best = Math.max(best, statSync(p).mtimeMs);
    } catch {
      /* missing */
    }
  };
  for (const top of ['library', 'temp', 'build/web-mobile']) {
    const dir = join(clientDir, top);
    touch(dir);
    let names = [];
    try {
      names = readdirSync(dir);
    } catch {
      continue;
    }
    for (const n of names.length > 600 ? names.slice(0, 600) : names) touch(join(dir, n));
  }
  return best;
}

/**
 * Progress-aware build watchdog. The build is "alive" while something new appears: `touch(now)` on every log line and whenever the editor's
 * files change. `check(now)` says `'idle'` after `idleMs` without a sign of life, `'max'` after `maxMs` in total, else null.
 */
export function makeBuildWatchdog({ idleMs, maxMs, now }) {
  const startedAt = now;
  let lastAt = now;
  return {
    touch(t) {
      if (t > lastAt) lastAt = t;
    },
    check(t) {
      if (t - startedAt >= maxMs) return 'max';
      if (t - lastAt >= idleMs) return 'idle';
      return null;
    },
    idleSec: (t) => Math.max(0, Math.round((t - lastAt) / 1000)),
    elapsedSec: (t) => Math.max(0, Math.round((t - startedAt) / 1000)),
  };
}

/** How many idle minutes a build gets: what the user asked for, else the default (much more for the first, asset-importing build). */
export function idleLimitMin(opts, firstBuild) {
  if (opts.buildTimeoutExplicit) return opts.buildTimeoutMin;
  return firstBuild ? DEFAULTS.firstBuildTimeoutMin : DEFAULTS.buildTimeoutMin;
}

/**
 * Did the build produce a usable client? Cocos Creator's exit code is unreliable (it reports 36 after a good build, 0 after errors): the
 * artifact is the truth. `build-web.mjs` deletes `index.html` before building, so one that exists was made by THIS build. Success = it exists
 * AND (exit code 0, or the build log said "build Task ... Finished").
 * @returns {{ ok: boolean, note: string }}
 */
export function buildOutcome({ code, indexExists, sawFinished }) {
  if (!indexExists) return { ok: false, note: 'index.html is missing' };
  if (code === 0) return { ok: true, note: '' };
  if (sawFinished)
    return {
      ok: true,
      note: `the editor exited with code ${code} but its log says the build finished and the output is there`,
    };
  return { ok: false, note: `exit code ${code} and no "Finished" line in the build log` };
}

/**
 * What the build is doing, from a log line: 'import' (asset database), 'build' (bundling / compiling), 'finished', or null when the line says
 * nothing new. Error / warning lines never name a phase (an error that mentions "import" is not the import phase).
 */
export function buildPhaseOf(line) {
  const t = line.trim();
  if (/\b(error|failed|exception|warn(ing)?)\b/i.test(t)) return null;
  if (/build Task .* Finished/.test(t)) return 'finished';
  if (/\b(import(ing)?|refresh(ing)?|asset-?db)\b/i.test(t)) return 'import';
  if (/\b(build|bundle|compil|minif|pack)/i.test(t)) return 'build';
  return null;
}
