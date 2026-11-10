import { director } from 'cc';
import { core } from './vendor/vgtd.mjs';

/**
 * Crash reporting wiring (D110): installs the engine-free `core.CrashReporter` on `window` (uncaught error, unhandled rejection,
 * `console.error` where the Cocos engine logs its own errors, `pagehide`) and sends batches to `POST <server>/crash/report`.
 * On only when the client talks to a server (`?online=1`) or with `?crash=1`; `?crash=0` turns it off. `?crashtest=1` throws one
 * uncaught error 1.5 s after the start (the forced-error check of `npm run crash-smoke -w client-cocos`).
 * No PII: see `CrashReporter`. The build id comes from `globalThis.__VGTD_BUILD__` (set by the release page), else `dev`.
 */
let reporter: InstanceType<typeof core.CrashReporter> | null = null;
let currentClass: string | undefined;

function randomId(): string {
  const a = new Uint8Array(8);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** the class path id of the character (set once the server told it); sent with later batches */
export function setCrashClass(id: string | undefined): void {
  currentClass = id;
}

export function installCrashReporting(): void {
  if (reporter || typeof window === 'undefined') return;
  const q = new URLSearchParams(location.search);
  const flag = q.get('crash');
  if (flag === '0' || (flag !== '1' && q.get('online') !== '1')) return;
  const url = `${core.resolveServer(q.get('server'), location.hostname).origin}/crash/report`;
  const raw = (globalThis as { __VGTD_BUILD__?: unknown }).__VGTD_BUILD__;
  const build = typeof raw === 'string' && /^[A-Za-z0-9._:+@-]{1,48}$/.test(raw) ? raw : 'dev';
  const r = new core.CrashReporter({
    build,
    sid: randomId(),
    getScene: () => director.getScene()?.name ?? 'boot',
    getClass: () => currentClass,
    send: (json, final) => {
      // text/plain keeps it a CORS "simple" request (no preflight), which is also what sendBeacon sends
      if (final && typeof navigator.sendBeacon === 'function' && navigator.sendBeacon(url, json)) return;
      void fetch(url, { method: 'POST', body: json, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(
        () => undefined,
      );
    },
    schedule: (fn, ms) => void setTimeout(fn, ms),
  });
  reporter = r;
  core.installCrashHooks(r, window, console);
  r.start();
  if (q.get('crashtest') === '1') {
    // i18n-exempt: developer-only forced error for the crash-report smoke test
    setTimeout(() => {
      throw new Error('forced crash test');
    }, 1500);
  }
}
