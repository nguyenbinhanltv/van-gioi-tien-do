/**
 * Worker thread for the login-storm scenario (docs/28 S7): registers `accounts` accounts, then on `go` fires `logins`
 * login requests evenly spread over `windowS` seconds and reports status codes and latencies. Runs on its own thread so
 * the HTTP client work does not steal time from the server's tick loop being measured.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { LOADTEST_PASSWORD } from './bot.js';

export interface StormConfig {
  host: string;
  port: number;
  accounts: number;
  logins: number;
  windowS: number;
  prefix: string;
}
export interface StormResult {
  /** HTTP status -> count; 0 = no answer (network error / timeout) */
  statuses: Record<string, number>;
  latenciesMs: number[];
  /** wall time from the first request to the last answer */
  totalS: number;
  /** requests sent / planned */
  sent: number;
  registered: number;
}

const cfg = workerData as StormConfig;
const port = parentPort!;
const url = (p: string): string => `http://${cfg.host}:${cfg.port}${p}`;
const name = (k: number): string => `${cfg.prefix}u${k}`;

async function post(path: string, body: unknown, timeoutMs = 20_000): Promise<number> {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url(path), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
    await r.arrayBuffer();
    return r.status;
  } catch {
    return 0;
  } finally {
    clearTimeout(t);
  }
}

let registered = 0;
const batch = 16; // registration is not the storm: keep it polite so it finishes before the storm starts
for (let k = 0; k < cfg.accounts; k += batch) {
  await Promise.all(
    Array.from({ length: Math.min(batch, cfg.accounts - k) }, async (_, q) => {
      const st = await post('/auth/register', { username: name(k + q), password: LOADTEST_PASSWORD });
      if (st === 201 || st === 409) registered++;
      else if (st === 503) {
        // busy: retry once after a pause
        await new Promise((r) => setTimeout(r, 500));
        if ((await post('/auth/register', { username: name(k + q), password: LOADTEST_PASSWORD })) === 201)
          registered++;
      }
    }),
  );
}
port.postMessage({ type: 'registered', n: registered });

port.on('message', async (m: { type: string }) => {
  if (m.type !== 'go') return;
  const statuses: Record<string, number> = {};
  const latenciesMs: number[] = [];
  const t0 = performance.now();
  const gap = (cfg.windowS * 1000) / Math.max(1, cfg.logins);
  const jobs: Promise<void>[] = [];
  for (let k = 0; k < cfg.logins; k++) {
    const due = t0 + k * gap;
    await new Promise((r) => setTimeout(r, Math.max(0, due - performance.now())));
    jobs.push(
      (async () => {
        const s0 = performance.now();
        const st = await post('/auth/login', {
          username: name(k % Math.max(1, registered)),
          password: LOADTEST_PASSWORD,
        });
        latenciesMs.push(performance.now() - s0);
        statuses[String(st)] = (statuses[String(st)] ?? 0) + 1;
      })(),
    );
  }
  await Promise.all(jobs);
  const result: StormResult = {
    statuses,
    latenciesMs,
    totalS: (performance.now() - t0) / 1000,
    sent: cfg.logins,
    registered,
  };
  port.postMessage({ type: 'result', result });
});
