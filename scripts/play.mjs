#!/usr/bin/env node
// `npm run play`: one command to play-test the game. Checks the setup, builds the web client when needed, starts the dev game server
// (monsters, combat and drops on) and the client static server, waits until both answer, prints the URLs (local, LAN, offline) and the
// controls, and stops everything cleanly on Ctrl+C.
//
//   npm run play                  online play-test (local + LAN URLs)
//   npm run play -- --offline     client only, no game server
//   npm run play -- --rebuild     force a web client build        --dev   build the debug variant      --open   open the browser
//   npm run play -- --memory      keep nothing between runs     --reset-data   wipe the saved characters first
//   npm run play -- --help        every option
//
// The game server stores accounts, characters, bags and stones in ./.vgtd-data by default (D92), so a restart keeps them.
//
// Windows first (Git Bash and PowerShell), works on Linux / macOS. Pure Node: no dependencies, no shell.
import { spawn, spawnSync } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { connect, createServer } from 'node:net';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  USAGE,
  buildUrls,
  openCommand,
  checkNode,
  cocosEditorPath,
  controlLines,
  corsOrigins,
  hasSavedData,
  resetCheck,
  resetData,
  storePlan,
  installState,
  lanAddresses,
  makeBuildLineFilter,
  needsRebuild,
  newestSource,
  parseArgs,
  pickPort,
  reasonVi,
  variantOf,
} from './lib/play-lib.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const client = join(root, 'apps/client-cocos');
const buildDir = join(client, 'build/web-mobile');
const marker = join(buildDir, '.play-build.json');
const IS_WIN = process.platform === 'win32';

const { opts, errors } = parseArgs(process.argv.slice(2));
if (opts.help) {
  process.stdout.write(`${USAGE}`);
  process.exit(0);
}
if (errors.length) {
  for (const e of errors) console.error(`play: ${e}`);
  console.error(`\n${USAGE}`);
  process.exit(2);
}

/** Print a Vietnamese line and its English twin. */
const say = (vi, en) => {
  console.log(`  ${vi}`);
  if (en) console.log(`  ${en}`);
};
const fail = (vi, en, code = 1) => {
  console.error(`\n  LỖI / ERROR: ${vi}`);
  if (en) console.error(`               ${en}`);
  process.exit(code);
};

// ------------------------------------------------------------------------------------------------ child processes
/** @type {{ name: string, child: import('node:child_process').ChildProcess, exited: Promise<number | null> }[]} */
const children = [];
let shuttingDown = false;

function pipeLines(stream, prefix, write, keep = () => true) {
  let buf = '';
  stream.setEncoding('utf8');
  stream.on('data', (d) => {
    buf += d;
    let k;
    while ((k = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, k).replace(/\r$/, '');
      buf = buf.slice(k + 1);
      if (line.trim() && keep(line)) write(`${prefix} ${line}\n`);
    }
  });
}

function start(name, args, env, { quiet = false, service = false, keep = () => true, tee = null } = {}) {
  const child = spawn(process.execPath, args, {
    cwd: root,
    env: { ...process.env, ...env },
    // the game server gets a stdin pipe: a clean stop is the line `quit` (no signals on Windows, no extra listening port)
    stdio: [name === 'server' ? 'pipe' : 'ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: !IS_WIN, // POSIX: its own process group, so the whole tree can be signalled
  });
  const exited = new Promise((res) => child.once('exit', (code) => res(code)));
  const entry = { name, child, exited };
  children.push(entry);
  if (tee) {
    child.stdout.pipe(tee, { end: false });
    child.stderr.pipe(tee, { end: false });
  }
  if (!quiet) pipeLines(child.stdout, `[${name}]`, (s) => process.stdout.write(s), keep);
  else child.stdout.resume();
  pipeLines(child.stderr, `[${name}]`, (s) => process.stderr.write(s), keep);
  // a long-running server that exits before we shut down is an error (the build step is expected to exit)
  if (service)
    child.once('exit', (code) => {
      if (!shuttingDown) {
        console.error(`\n  [${name}] đã dừng bất ngờ (mã ${code}) / exited unexpectedly (code ${code})`);
        void shutdown(1);
      }
    });
  return entry;
}

/** Kill a child and everything it spawned (dev.mjs starts the real server as a grandchild). */
function killTree(child) {
  if (child.exitCode !== null || child.pid === undefined) return;
  if (IS_WIN) {
    spawnSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try {
      child.kill('SIGTERM');
    } catch {
      /* already gone */
    }
  }
  setTimeout(() => {
    try {
      process.kill(-child.pid, 'SIGKILL');
    } catch {
      /* gone */
    }
  }, 4000).unref();
}

/** Does something already accept connections on this loopback address? */
function accepts(port, host) {
  return new Promise((res) => {
    const s = connect({ port, host });
    s.setTimeout(700, () => {
      s.destroy();
      res(false);
    });
    s.once('connect', () => {
      s.destroy();
      res(true);
    });
    s.once('error', () => res(false));
  });
}

/**
 * Is the port free? A wildcard bind alone is not enough: on Windows it succeeds even while another process holds the same port on
 * 127.0.0.1, so a listener on either loopback address counts as busy as well.
 */
async function isPortFree(port) {
  if ((await accepts(port, '127.0.0.1')) || (await accepts(port, '::1'))) return false;
  return new Promise((res) => {
    const s = createServer();
    s.once('error', () => res(false));
    s.listen(port, () => s.close(() => res(true)));
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitUntil(fn, timeoutMs, everyMs = 250) {
  const end = Date.now() + timeoutMs;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* not yet */
    }
    if (Date.now() > end) return false;
    await sleep(everyMs);
  }
}

const usedPorts = [];
async function shutdown(code = 0) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('\n  Đang dừng… / Stopping…');
  // ask the game server to save and exit first (it flushes the data directory), then kill whatever is still running
  const srv = children.find((c) => c.name === 'server');
  if (srv && srv.child.exitCode === null && srv.child.stdin && !srv.child.stdin.destroyed) {
    try {
      srv.child.stdin.write('quit\n');
    } catch {
      /* pipe already closed: the kill below handles it */
    }
    const clean = await Promise.race([srv.exited.then(() => true), sleep(3500).then(() => false)]);
    if (clean) say('Máy chủ đã lưu dữ liệu và thoát.', 'The game server saved its data and exited.');
  }
  for (const { child } of children) killTree(child);
  await Promise.race([Promise.all(children.map((c) => c.exited)), sleep(6000)]);
  const freed = await waitUntil(async () => (await Promise.all(usedPorts.map(isPortFree))).every(Boolean), 6000, 200);
  if (freed) say('Đã dừng, các cổng đã được giải phóng.', 'Stopped; the ports are free again.');
  else
    say(
      `Cảnh báo: cổng ${usedPorts.join(', ')} chưa được giải phóng.`,
      `Warning: port(s) ${usedPorts.join(', ')} still in use.`,
    );
  process.exit(code);
}
for (const sig of IS_WIN ? ['SIGINT', 'SIGTERM', 'SIGBREAK', 'SIGHUP'] : ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(sig, () => {
    if (shuttingDown) process.exit(130); // a second Ctrl+C: stop waiting
    void shutdown(0);
  });
}
// last resort if we are leaving for another reason: never leave the servers behind
process.on('exit', () => {
  for (const { child } of children) killTree(child);
});
process.on('uncaughtException', (e) => {
  console.error(e);
  void shutdown(1);
});

// ------------------------------------------------------------------------------------------------ preflight
console.log('\n  === Vạn Giới Tiên Đồ: chơi thử / play-test ===\n');

const node = checkNode(process.versions.node);
if (!node.ok)
  fail(
    `Cần Node.js >= ${node.min} (đang chạy ${process.versions.node}).`,
    `Node.js >= ${node.min} is required (running ${process.versions.node}).`,
    2,
  );

const mtime = (p) => {
  try {
    return statSync(p).mtimeMs;
  } catch {
    return null;
  }
};
const inst = installState({
  hasNodeModules: existsSync(join(root, 'node_modules')),
  lockMtimeMs: mtime(join(root, 'package-lock.json')),
  installMtimeMs: mtime(join(root, 'node_modules/.package-lock.json')),
});
if (inst === 'missing')
  fail(
    'Chưa cài thư viện. Chạy `npm ci` rồi thử lại.',
    'Dependencies are not installed. Run `npm ci`, then try again.',
    2,
  );
if (inst === 'stale')
  say(
    'Cảnh báo: package-lock.json mới hơn lần cài gần nhất. Nên chạy `npm ci` (script này không tự chạy).',
    'Warning: package-lock.json is newer than the last install. Consider running `npm ci` (this script never runs it for you).',
  );

const variant = variantOf(opts);
let buildInfo = {
  exists: existsSync(join(buildDir, 'index.html')),
  variant: null,
  mtimeMs: mtime(join(buildDir, 'index.html')) ?? 0,
};
try {
  buildInfo.variant = JSON.parse(readFileSync(marker, 'utf8')).variant ?? null;
} catch {
  /* built by `npm run build:web`, or not at all */
}
const decision = needsRebuild({
  force: opts.rebuild,
  wantedVariant: variant,
  build: buildInfo,
  newestSource: buildInfo.exists ? newestSource(root) : null,
});

const editor = cocosEditorPath(process.env, process.platform);
const editorOk = !!editor && existsSync(editor);
if (decision.rebuild && !editorOk)
  fail(
    `Cần build client nhưng không thấy Cocos Creator 3.8.8${editor ? ` tại ${editor}` : ''}. Cài Cocos Creator 3.8.8 hoặc đặt COCOS_CREATOR_PATH trỏ tới file CocosCreator.`,
    `The web client needs a build (${decision.reason}) but Cocos Creator 3.8.8 was not found${editor ? ` at ${editor}` : ''}. Install it or set COCOS_CREATOR_PATH to the CocosCreator executable.`,
    2,
  );
if (!decision.rebuild && !editorOk)
  say(
    'Ghi chú: không thấy Cocos Creator, dùng bản build sẵn có.',
    'Note: Cocos Creator not found, using the existing build.',
  );

// Ports: a busy DEFAULT port moves to the next free one (the URLs below show the real port); a busy port given with --port /
// --server-port is an error. 8456 is the client default because 7456 is Cocos Creator's own preview server.
const chosen = [];
const clientPick = await pickPort({ start: opts.clientPort, explicit: opts.clientPortExplicit, isFree: isPortFree });
if (!clientPick.ok)
  fail(
    `Cổng ${clientPick.port} đang bị chiếm. Tắt tiến trình đang dùng cổng đó hoặc chọn cổng khác bằng --port.`,
    `Port ${clientPick.port} is already in use. Stop whatever uses it or choose another with --port.`,
    2,
  );
opts.clientPort = clientPick.port;
chosen.push(clientPick.port);
if (clientPick.moved)
  say(
    `Cổng client mặc định bận, dùng cổng ${clientPick.port}.`,
    `The default client port was busy, using ${clientPick.port}.`,
  );
if (!opts.offline) {
  const serverPick = await pickPort({
    start: opts.serverPort,
    explicit: opts.serverPortExplicit,
    isFree: isPortFree,
    taken: chosen,
  });
  if (!serverPick.ok)
    fail(
      `Cổng ${serverPick.port} đang bị chiếm. Tắt tiến trình đang dùng cổng đó hoặc chọn cổng khác bằng --server-port.`,
      `Port ${serverPick.port} is already in use. Stop whatever uses it or choose another with --server-port.`,
      2,
    );
  opts.serverPort = serverPick.port;
  chosen.push(serverPick.port);
  if (serverPick.moved)
    say(
      `Cổng game server mặc định bận, dùng cổng ${serverPick.port} (URL đã kèm &server=).`,
      `The default game server port was busy, using ${serverPick.port} (the URLs carry &server=).`,
    );
}
usedPorts.push(...chosen);
say(
  `Kiểm tra xong: Node ${process.versions.node}, ${inst === 'ok' ? 'thư viện đã cài' : 'thư viện cần cập nhật'}, cổng ${usedPorts.join(' + ')} trống.`,
  `Preflight OK: Node ${process.versions.node}, dependencies ${inst === 'ok' ? 'installed' : 'maybe stale'}, port(s) ${usedPorts.join(' + ')} free.`,
);

// ------------------------------------------------------------------------------------------------ build
if (decision.rebuild) {
  say(
    `Build client (${variant === 'release' ? 'release: nhỏ, nhanh' : 'dev: debug, có art dev'}): ${reasonVi(decision)}. Mất khoảng 20-60 giây.`,
    `Building the web client (${variant}): ${decision.reason}. Takes about 20-60 s.`,
  );
  // Cocos Creator is very chatty: the console shows what matters (errors, warnings, the result), the whole log goes to a file
  mkdirSync(join(client, 'build'), { recursive: true });
  const logFile = join(client, 'build/play-build.log');
  const tee = createWriteStream(logFile);
  const quietCocos = makeBuildLineFilter();
  const build = start(
    'build',
    [join(client, 'scripts/build-web.mjs'), ...(variant === 'release' ? ['--release'] : [])],
    {},
    { keep: quietCocos, tee },
  );
  const startedAt = Date.now();
  const beat = setInterval(() => {
    const s = Math.round((Date.now() - startedAt) / 1000);
    say(`… đang build (${s} s) / still building (${s} s) …`);
  }, 15_000);
  // a build that never ends (for example a second Cocos Creator instance holding the editor's data) must not hang this command forever
  let timedOut = false;
  const killer = setTimeout(() => {
    timedOut = true;
    killTree(build.child);
  }, opts.buildTimeoutMin * 60_000);
  const code = await build.exited;
  clearInterval(beat);
  clearTimeout(killer);
  tee.end();
  if (shuttingDown) await new Promise(() => {}); // a signal arrived: shutdown() exits
  children.splice(children.indexOf(build), 1);
  if (timedOut)
    fail(
      `Build client quá ${opts.buildTimeoutMin} phút nên đã bị dừng. Hãy đóng các cửa sổ Cocos Creator khác (kể cả của dự án khác) rồi thử lại. Log đầy đủ: ${logFile}`,
      `The web client build took longer than ${opts.buildTimeoutMin} minutes and was stopped. Close other Cocos Creator instances (any project) and try again. Full log: ${logFile}`,
    );
  if (code !== 0 || !existsSync(join(buildDir, 'index.html')))
    fail(`Build client thất bại. Log đầy đủ: ${logFile}`, `The web client build failed. Full log: ${logFile}`);
  mkdirSync(buildDir, { recursive: true });
  writeFileSync(marker, JSON.stringify({ variant, at: new Date().toISOString() }));
  say('Build xong.', 'Build finished.');
} else {
  say(
    `Dùng bản build sẵn có (${variant}): ${reasonVi(decision)}. Muốn build lại: --rebuild.`,
    `Using the existing ${variant} build: ${decision.reason}. Use --rebuild to force a build.`,
  );
}

// ------------------------------------------------------------------------------------------------ start servers
const plan = storePlan({ root, env: process.env, opts });
if (plan.error) fail(plan.error, plan.error, 2);
if (!opts.offline && plan.store === 'file' && opts.resetData) {
  const check = resetCheck({ root, dir: plan.dir, custom: plan.custom, yes: opts.yes });
  if (!check.ok) fail(`Không xóa dữ liệu: ${check.reason}`, `Not resetting the saved data: ${check.reason}`, 2);
  const removed = resetData(plan.dir);
  if (removed.length === 0) say(`Không có dữ liệu để xóa trong ${plan.dir}.`, `Nothing to reset in ${plan.dir}.`);
  else
    say(
      `Đã xóa dữ liệu đã lưu (${removed.length} tệp) trong ${plan.dir}.`,
      `Reset the saved data (${removed.length} file(s)) in ${plan.dir}.`,
    );
}
const continuing = plan.store === 'file' && hasSavedData(plan.dir);

const lan = opts.lan ? lanAddresses() : [];
const urls = buildUrls({ clientPort: opts.clientPort, serverPort: opts.serverPort, lan });

if (!opts.offline) {
  // dev.mjs bundles and runs the game server; MOBS / COMBAT / INVENTORY are on there by default, set explicitly here so the play-test never
  // depends on those defaults. Registration limits are lifted: several tabs and phones share one IP in a play-test.
  start(
    'server',
    [join(root, 'apps/server/scripts/dev.mjs')],
    {
      PORT: String(opts.serverPort),
      HOST: opts.lan ? '0.0.0.0' : '127.0.0.1',
      CORS_ORIGINS: corsOrigins({ clientPort: opts.clientPort, lan }),
      REGISTER_PER_IP_PER_DAY: '0',
      MOBS: '1',
      COMBAT: '1',
      INVENTORY: '1',
      STORE: plan.store,
      ...(plan.store === 'file' ? { DATA_DIR: plan.dir } : {}),
      QUIT_ON_STDIN: '1',
    },
    { service: true },
  );
}
// the same server `npm run serve -w client-cocos` starts (its own LAN lines are replaced by ours below)
start('client', [join(client, 'scripts/serve.mjs'), String(opts.clientPort)], {}, { quiet: true, service: true });

say('Đang khởi động máy chủ… / Starting the servers…');
const clientUp = await waitUntil(async () => (await fetch(`http://127.0.0.1:${opts.clientPort}/`)).ok, 30_000);
if (!clientUp)
  fail(
    `Máy chủ client không trả lời ở cổng ${opts.clientPort}.`,
    `The client server did not answer on port ${opts.clientPort}.`,
  );
if (!opts.offline) {
  const serverChild = children.find((c) => c.name === 'server').child;
  const serverUp = await waitUntil(async () => {
    // our own server must still be alive: another process answering /health on that port does not count
    if (serverChild.exitCode !== null) return true;
    const r = await fetch(`http://127.0.0.1:${opts.serverPort}/health`, { signal: AbortSignal.timeout(2000) });
    return r.ok && (await r.json()).ok === true;
  }, 90_000);
  if (serverChild.exitCode !== null) await new Promise(() => {}); // the unexpected-exit handler is shutting down with the error
  if (!serverUp)
    fail(
      `Game server không sẵn sàng (/health) ở cổng ${opts.serverPort} sau 90 giây.`,
      `The game server did not become healthy (/health) on port ${opts.serverPort} within 90 s.`,
    );
}

// ------------------------------------------------------------------------------------------------ ready
const line = '  ' + '-'.repeat(78);
console.log(`\n${line}`);
say('SẴN SÀNG / READY', null);
if (!opts.offline) {
  say('Chơi online (cùng máy / same machine):', null);
  console.log(`    Local:   ${urls.local}`);
  if (lan.length > 0) {
    say('Điện thoại / máy khác cùng Wi-Fi / phones and other machines on the same Wi-Fi:', null);
    for (const l of urls.lan) console.log(`    LAN:     ${l.url}   (${l.name})`);
    say(
      'Lần đầu Windows có thể hỏi tường lửa: chọn "Allow access" cho Node.js (mạng Private).',
      'The first time, the Windows firewall may ask: choose "Allow access" for Node.js (Private network).',
    );
  } else if (opts.lan) {
    say('Không tìm thấy địa chỉ LAN (chưa nối Wi-Fi?).', 'No LAN address found (not on Wi-Fi?).');
  }
}
if (!opts.offline) {
  if (plan.store === 'file')
    say(
      `Dữ liệu lưu ở ${plan.dir} (${continuing ? 'tiếp tục dữ liệu cũ' : 'mới'}). Xóa bằng --reset-data, tắt bằng --memory.`,
      `Saved data: ${plan.dir} (${continuing ? 'continuing an earlier game' : 'new'}). Wipe it with --reset-data, turn it off with --memory.`,
    );
  else
    say(
      'Không lưu dữ liệu (--memory): khởi động lại là mất.',
      'Nothing is saved (--memory): a restart loses everything.',
    );
}
say('Chế độ offline (không cần game server, quái giả lập) / offline mode (no game server, mock monsters):', null);
console.log(`    Offline: ${urls.offline}`);
console.log(`    Offline (không combat / no combat): ${urls.offlinePlain}`);
console.log(`\n  Điều khiển / Controls:`);
for (const c of controlLines()) {
  console.log(`    - ${c.vi}`);
  console.log(`      ${c.en}`);
}
console.log(`${line}`);
say('Nhấn Ctrl+C để dừng tất cả.', 'Press Ctrl+C to stop everything.');

if (opts.open) {
  const target = opts.offline ? urls.offline : urls.local;
  const [cmd, args] = openCommand(process.platform, target);
  try {
    const opener = spawn(cmd, args, { stdio: 'ignore', detached: true, windowsHide: true });
    opener.on('error', () =>
      say(`Không mở được trình duyệt, hãy mở ${target}`, `Could not open the browser, open ${target} yourself.`),
    );
    opener.unref();
  } catch {
    say(`Không mở được trình duyệt, hãy mở ${target}`, `Could not open the browser, open ${target} yourself.`);
  }
}
if (opts.smoke) {
  say('SMOKE OK: các máy chủ đã chạy và trả lời. Đang dừng.', 'SMOKE OK: the servers came up and answered. Stopping.');
  await shutdown(0);
}
