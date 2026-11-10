/**
 * The minimal KPI dashboard (D109, docs/17 §4.2; docs/10 §9.3 gate "dashboard KPI hoạt động"): one self-contained HTML page and the JSON it
 * reads, both served by the gateway at `/dashboard` and `/dashboard/summary.json`. No external resources, no framework, no third party.
 *
 * Access: the summary holds only aggregates (no pids), but it is still operator data. Without `DASHBOARD_TOKEN` only connections from the
 * machine itself (loopback) are served; with a token the request must carry `Authorization: Bearer <token>` (the page reads it from the
 * URL fragment `#token=...`, which a browser never sends to a server, and puts it in that header). `X-Forwarded-For` is ignored: a
 * reverse proxy on the same host would otherwise turn every outside visitor into "loopback", so behind a proxy a token is REQUIRED.
 */
import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage } from 'node:http';

const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);

export function dashboardAllowed(req: IncomingMessage, token: string | undefined): boolean {
  if (token) {
    const h = req.headers.authorization ?? '';
    const given = h.startsWith('Bearer ') ? h.slice(7) : '';
    const a = Buffer.from(given);
    const b = Buffer.from(token);
    return a.length === b.length && timingSafeEqual(a, b);
  }
  return LOOPBACK.has(req.socket.remoteAddress ?? '') && !req.headers['x-forwarded-for'];
}

export const DASHBOARD_CSP =
  "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'self'; base-uri 'none'";

/** The page. Everything it shows is drawn with `textContent` / SVG attributes (no innerHTML), from `/dashboard/summary.json`. */
export const DASHBOARD_HTML = `<!doctype html>
<html lang="vi"><head><meta charset="utf-8"><title>Vạn Giới Tiên Đồ - KPI</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
body{font:14px/1.4 system-ui,sans-serif;margin:16px;background:#0e1118;color:#e6e9f0}
h1{font-size:18px;margin:0 0 4px}h2{font-size:15px;margin:22px 0 6px;color:#e8c872}
.muted{color:#8a93a8;font-size:12px}table{border-collapse:collapse;margin:4px 0}
td,th{padding:3px 10px;text-align:right;border-bottom:1px solid #232a3a}th:first-child,td:first-child{text-align:left}
.bar{display:inline-block;height:10px;background:#4a90e2;vertical-align:middle}
.warn{color:#ff8f85}.ok{color:#8fe0a0}.pill{background:#33405a;border-radius:4px;padding:1px 6px;font-size:11px}
.cards{display:flex;gap:12px;flex-wrap:wrap}.card{background:#161b27;border:1px solid #232a3a;border-radius:8px;padding:8px 14px}
.card b{display:block;font-size:22px}
</style></head><body>
<h1>Vạn Giới Tiên Đồ - KPI</h1>
<div class="muted" id="meta">đang tải...</div>
<h2>Trực tiếp</h2><div class="cards" id="live"></div><svg id="spark" width="360" height="50" role="img"></svg>
<h2>Theo ngày</h2><table id="days"></table>
<h2>FTUE (hành trình đầu tiên)</h2><div class="muted" id="ftueNote"></div><table id="ftue"></table>
<h2>Giữ chân</h2><table id="ret"></table>
<h2>Kinh tế (sổ cái)</h2><div class="muted" id="econNote"></div><table id="econ"></table>
<h2>Ổn định (crash-free, D110)</h2><div class="muted" id="crashNote"></div><table id="crashBuilds"></table><table id="crashTop"></table>
<h2>Sức khỏe dữ liệu</h2><div id="health" class="muted"></div>
<script>
(function(){
var token=(location.hash.match(/token=([^&]+)/)||[])[1];
var headers=token?{Authorization:'Bearer '+decodeURIComponent(token)}:{};
function el(t,txt,cls){var e=document.createElement(t);if(txt!==undefined)e.textContent=txt;if(cls)e.className=cls;return e}
function pct(v){return v===null||v===undefined?'-':(Math.round(v*1000)/10)+'%'}
function fill(table,head,rows){while(table.firstChild)table.removeChild(table.firstChild);
 var h=el('tr');head.forEach(function(x){h.appendChild(el('th',x))});table.appendChild(h);
 rows.forEach(function(r){var tr=el('tr');r.forEach(function(c){tr.appendChild(c instanceof Node?c:el('td',String(c)))});table.appendChild(tr)})}
function cell(txt,cls){return el('td',txt,cls)}
function render(s){
 document.getElementById('meta').textContent='schema '+s.schemaVersion+' - dữ liệu chỉ nằm trên máy chủ này - cập nhật '+new Date(s.generatedAtMs).toLocaleTimeString();
 var live=document.getElementById('live');while(live.firstChild)live.removeChild(live.firstChild);
 [['CCU hiện tại',s.ccu.now],['CCU đỉnh 24 giờ',s.ccu.peak24h]].forEach(function(c){var d=el('div',undefined,'card');d.appendChild(el('b',String(c[1])));d.appendChild(el('span',c[0],'muted'));live.appendChild(d)});
 var sp=document.getElementById('spark');while(sp.firstChild)sp.removeChild(sp.firstChild);
 var ser=s.ccu.series,max=Math.max.apply(null,ser.map(function(p){return p[1]}).concat([1]));
 if(ser.length>1){var pts=ser.map(function(p,i){return (i*360/(ser.length-1)).toFixed(1)+','+(48-p[1]*46/max).toFixed(1)}).join(' ');
  var pl=document.createElementNS('http://www.w3.org/2000/svg','polyline');pl.setAttribute('points',pts);pl.setAttribute('fill','none');pl.setAttribute('stroke','#4a90e2');sp.appendChild(pl)}
 fill(document.getElementById('days'),['Ngày (UTC)','DAU','Mới','Phiên','TB phiên (s)','CCU đỉnh','CCU TB'],
  s.days.map(function(d){return [d.day,d.dau,d.newPlayers,d.sessions,d.avgSessionS,d.ccuPeak,d.ccuAvg]}));
 document.getElementById('ftueNote').textContent='Đã vào: '+s.ftue.started+' - hoàn thành: '+s.ftue.completed+' ('+pct(s.ftue.completionRate)+') - bỏ qua: '+s.ftue.skipped+'. Mục tiêu gate: >= 85% (placeholder, docs/10 §7.1).';
 var max2=Math.max.apply(null,s.ftue.steps.map(function(x){return x.players}).concat([1]));
 fill(document.getElementById('ftue'),['Bước','Người chơi','Tỷ lệ',''],s.ftue.steps.map(function(x){
  var td=el('td');var b=el('span',undefined,'bar');b.style.width=Math.round(x.players*160/max2)+'px';td.appendChild(b);return [x.step,x.players,pct(x.rate),td]}));
 fill(document.getElementById('ret'),['Mốc','Nhóm','Quay lại','Tỷ lệ',''],['d1','d7','d30'].map(function(k){var r=s.retention[k];
  return [k.toUpperCase(),r.cohort,r.retained,pct(r.rate),cell(r.insufficient?'placeholder (nhóm < '+s.health.minCohort+')':'',r.insufficient?'warn':'ok')]}));
 document.getElementById('econNote').textContent='Cửa sổ '+s.economy.windowDays+' ngày; mục tiêu tiêu hao / sinh ra '+s.economy.targetRatio[0]+' - '+s.economy.targetRatio[1]+' (docs/07 §7).';
 fill(document.getElementById('econ'),['Tiền tệ','Sinh ra','Tiêu hao','Tiêu hao / sinh ra','Kênh sinh ra','Kênh tiêu hao'],s.economy.currencies.map(function(c){
  var cls=c.inTarget===null?'':(c.inTarget?'ok':'warn');
  return [c.currency,c.faucet,c.sink,cell(c.ratio===null?'-':c.ratio.toFixed(2),cls),JSON.stringify(c.faucetChannels),JSON.stringify(c.sinkChannels)]}));
 var cn=document.getElementById('crashNote');
 if(s.crash){var c=s.crash;
  cn.textContent='Phiên không sập: '+c.crashFreePct+'% (đích '+c.target+'%) - '+c.sessions+' phiên, '+c.crashedSessions+' sập, '+c.liveSessions+' đang chạy, '+c.abandonedSessions+' bỏ dở (24 giờ)';
  cn.className=c.crashFreePct>=c.target?'ok':'warn';
  fill(document.getElementById('crashBuilds'),['Bản dựng','Phiên','Sập','Không sập %'],c.byBuild.map(function(x){return [x.build,x.sessions,x.crashed,x.crashFreePct]}));
  fill(document.getElementById('crashTop'),['Top crash','Phiên','Lần','Nguồn','Thông điệp'],c.top.map(function(x){return [x.fatal?'sập':'lỗi',x.sessions,x.occurrences,x.source,x.message]}));
 }else cn.textContent='chưa bật nhận báo cáo sập';
 document.getElementById('health').textContent='Sự kiện bị từ chối bởi lược đồ: '+s.health.refusedEvents+' - lỗi ghi log: '+s.health.logErrors;
}
function load(){fetch('/dashboard/summary.json',{headers:headers,cache:'no-store'}).then(function(r){if(!r.ok)throw new Error(r.status);return r.json()}).then(render).catch(function(e){document.getElementById('meta').textContent='không tải được: '+e.message})}
load();setInterval(load,15000);
})();
</script></body></html>`;
