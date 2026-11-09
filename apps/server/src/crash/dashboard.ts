/**
 * Operator view of the crash numbers (D110). ADAPTER: the telemetry dashboard (#264, D109) is not in main yet, so this serves its own
 * small page and JSON with the same access rule as that dashboard (loopback, or `Authorization: Bearer <DASHBOARD_TOKEN>`). When #264
 * merges, replace `operatorAllowed` with its `dashboardAllowed` and render `crashPanel(service)` as one more panel of
 * `/dashboard/summary.json` (the shape is `CrashRollup`); the routes in the gateway can then be deleted.
 *
 * The HTML page works over loopback only (or behind a proxy that adds the credentials): its own fetch cannot send an `Authorization`
 * header. A token holder reads the JSON endpoint (`curl -H "Authorization: Bearer $DASHBOARD_TOKEN" .../ops/crash/summary.json`).
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { CrashRollup } from './rollup.js';
import type { CrashService } from './service.js';

export function operatorAllowed(req: IncomingMessage, token: string | undefined): boolean {
  if (token) {
    const m = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
    if (m) {
      const a = Buffer.from(m[1]!);
      const b = Buffer.from(token);
      return a.length === b.length && timingSafeEqual(a, b);
    }
  }
  const ip = req.socket.remoteAddress ?? '';
  const loopback = ip === '127.0.0.1' || ip === '::1' || ip === '::ffff:127.0.0.1';
  // behind a reverse proxy the socket is always loopback: a forwarded request must use the token
  return loopback && req.headers['x-forwarded-for'] === undefined;
}

/** the panel data: what the dashboard shows for stability */
export function crashPanel(service: CrashService, windowMs?: number): CrashRollup {
  return service.summary(windowMs);
}

/** a static page that fetches `summary.json` and renders only with textContent (crash text is attacker-controlled) */
export const CRASH_PAGE_HTML = `<!doctype html><html lang="vi"><head><meta charset="utf-8"><title>Crash-free sessions</title>
<style>body{font:14px system-ui;margin:24px;background:#111;color:#eee}td,th{padding:4px 10px;border-bottom:1px solid #333;text-align:left;vertical-align:top}
pre{margin:0;white-space:pre-wrap;max-width:60em;font-size:12px;color:#aaa}.bad{color:#f66}.ok{color:#6c6}</style></head><body>
<h1>Crash-free sessions</h1><p id="head"></p><h2>By build</h2><table id="builds"></table><h2>Top crashes</h2><table id="top"></table>
<script>
const el=(t,x,c)=>{const e=document.createElement(t);if(x!==undefined)e.textContent=String(x);if(c)e.className=c;return e};
const row=(tb,cells,head)=>{const tr=document.createElement('tr');for(const c of cells){const th=el(head?'th':'td');th.append(c instanceof Node?c:document.createTextNode(String(c)));tr.append(th)}tb.append(tr)};
fetch('/ops/crash/summary.json'+location.search).then(r=>r.json()).then(s=>{
 document.getElementById('head').append(el('b',s.crashFreePct+'%',s.crashFreePct>=s.target?'ok':'bad'),
  document.createTextNode(' crash-free (target '+s.target+'%): '+s.sessions+' sessions, '+s.crashedSessions+' crashed, '+s.liveSessions+' live, '+s.abandonedSessions+' abandoned'));
 const b=document.getElementById('builds');row(b,['build','sessions','crashed','crash-free %'],1);for(const x of s.byBuild)row(b,[x.build,x.sessions,x.crashed,x.crashFreePct]);
 const t=document.getElementById('top');row(t,['sessions','count','fatal','source','message / stack'],1);
 for(const x of s.top){const d=el('div');d.append(el('b',x.message),el('pre',x.stack));row(t,[x.sessions,x.occurrences,x.fatal?'yes':'no',x.source,d])}
});
</script></body></html>`;
