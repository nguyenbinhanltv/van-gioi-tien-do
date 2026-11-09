/**
 * `QUIT_ON_STDIN=1` (set by `npm run play`): the line `quit` on the server's stdin is a clean stop that flushes the data directory.
 * Runs the real dev entry (esbuild bundle + main.ts), the same process `npm run play` starts.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TEST_ONLY_GOOD } from './fixtures.js';

const dev = join(dirname(fileURLToPath(import.meta.url)), '../scripts/dev.mjs');
const live: ChildProcess[] = [];
const dirs: string[] = [];
afterEach(() => {
  for (const c of live.splice(0)) c.kill();
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
});

const freePort = (): Promise<number> =>
  new Promise((res, rej) => {
    const s = createServer();
    s.once('error', rej);
    s.listen(0, '127.0.0.1', () => {
      const p = (s.address() as { port: number }).port;
      s.close(() => res(p));
    });
  });

async function boot(stdin: 'pipe' | 'ignore'): Promise<{ child: ChildProcess; port: number; dir: string }> {
  const dir = mkdtempSync(join(tmpdir(), 'vgtd-quit-'));
  dirs.push(dir);
  const port = await freePort();
  const child = spawn(process.execPath, [dev], {
    stdio: [stdin, 'pipe', 'inherit'],
    env: {
      ...process.env,
      PORT: String(port),
      HOST: '127.0.0.1',
      STORE: 'file',
      DATA_DIR: dir,
      QUIT_ON_STDIN: '1',
      REGISTER_PER_IP_PER_DAY: '0',
    },
  });
  live.push(child);
  await new Promise<void>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('server did not start in 60 s')), 60_000);
    child.stdout!.on('data', (d) => {
      if (String(d).includes('listening')) {
        clearTimeout(t);
        resolve();
      }
    });
    child.once('exit', (c) => reject(new Error(`server exited early with ${String(c)}`)));
  });
  return { child, port, dir };
}

const register = (port: number): Promise<Response> =>
  fetch(`http://127.0.0.1:${port}/auth/register`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'quit_user', password: TEST_ONLY_GOOD }),
  });

describe('clean stop through stdin', () => {
  it('the line "quit" saves the data directory at once (before the 250 ms write delay) and exits with 0', async () => {
    const { child, port, dir } = await boot('pipe');
    expect((await register(port)).status).toBe(201);
    const exited = new Promise<number | null>((r) => child.once('exit', (c) => r(c)));
    child.stdin!.write('quit\n');
    const code = await Promise.race([exited, new Promise<string>((r) => setTimeout(() => r('timeout'), 15_000))]);
    expect(code).toBe(0);
    expect(existsSync(join(dir, 'accounts.json'))).toBe(true);
  }, 90_000);

  it('end of input is NOT a quit: a closed stdin never stops the server', async () => {
    const { child, port } = await boot('ignore');
    await new Promise((r) => setTimeout(r, 1500));
    expect(child.exitCode).toBeNull();
    expect((await register(port)).status).toBe(201); // still serving
  }, 90_000);
});
