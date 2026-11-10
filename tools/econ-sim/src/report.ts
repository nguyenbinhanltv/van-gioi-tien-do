import { REALM_NAMES, SINK_SOURCE_RATIO_TARGET } from '@vgtd/shared';
import { ASSUMPTIONS, PARAMS_VERSION, QUALITY_NAMES, type SimParams } from './params.js';
import { analyze, type Analysis, type Flag } from './analyze.js';
import { FAUCET_CHANNELS, SINK_CHANNELS, type SimResult } from './sim.js';

/** one scenario of the report */
export interface Scenario {
  id: string;
  title: string;
  note: string;
  result: SimResult;
  analysis: Analysis;
}

const n = (x: number): string => Math.round(x).toLocaleString('en-US').replace(/,/g, '.');
const d1 = (x: number): string => x.toFixed(1).replace('.', ',');
const d2 = (x: number): string => x.toFixed(2).replace('.', ',');
const pct = (x: number): string => `${(x * 100).toFixed(1).replace('.', ',')}%`;

/** a text bar chart row, `width` cells = `max` */
export function bar(value: number, max: number, width = 32): string {
  const k = max > 0 ? Math.max(0, Math.min(width, Math.round((value / max) * width))) : 0;
  return '█'.repeat(k) + '░'.repeat(width - k);
}
function chart(rows: Array<[string, number, string]>, width = 32): string {
  const max = Math.max(...rows.map((r) => r[1]), 1e-9);
  const lw = Math.max(...rows.map((r) => r[0].length));
  return ['```text', ...rows.map(([l, v, t]) => `${l.padEnd(lw)} ${bar(v, max, width)} ${t}`), '```'].join('\n');
}

export function makeScenario(id: string, title: string, note: string, result: SimResult): Scenario {
  return { id, title, note, result, analysis: analyze(result) };
}

function summaryRow(s: Scenario): string {
  const a = s.analysis;
  const w = a.weeks;
  const last = w[w.length - 1]!;
  const wk4 = w[Math.min(3, w.length - 1)]!;
  return `| ${s.title} | ${d2(a.steadyRatio)} | ${n(wk4.medianWallet)} | ${n(last.medianWallet)} | ${n(last.p90Wallet)} | ${d2(last.gini)} | ${d1(last.pillMult)} | ${a.flags.filter((f) => f.severity === 'cao').length} |`;
}

function flagBlock(f: Flag): string {
  return `- **[${f.severity}] ${f.title}.** ${f.detail}`;
}

function paramsTable(p: SimParams): string {
  return [
    '| Tham số | Giá trị |',
    '| --- | --- |',
    `| Người chơi (thuần, một đoàn) | ${n(p.players)} |`,
    `| Số ngày | ${p.days} |`,
    `| Hạt giống | ${p.seed} |`,
    `| Nấc tối đa | ${p.maxStage} |`,
    `| Nhóm | ${p.groups.map((g) => `${g.id} ${pct(g.share)} (${g.hoursPerDay} giờ/ngày, chơi ${pct(g.playProb)} số ngày, rời ${pct(g.churnPerDay)}/ngày)`).join('; ')} |`,
  ].join('\n');
}

/** The markdown report (Vietnamese). `base` is the main scenario; `others` are the comparison runs. */
export function renderReport(opts: {
  base: Scenario;
  others: Scenario[];
  full?: Scenario;
  repairMult: number | undefined;
  elapsedMs: number;
}): string {
  const { base, others, full, repairMult } = opts;
  const a = base.analysis;
  const P = base.result.params;
  const out: string[] = [];
  out.push('# Mô phỏng kinh tế (D113, P5)');
  out.push('');
  out.push(
    `> **Tệp sinh tự động** bởi \`tools/econ-sim\` (\`npm run sim -w @vgtd/econ-sim\`), phiên bản tham số ${PARAMS_VERSION}, hạt giống ${P.seed}, tất định: chạy lại cùng tham số cho đúng số này. Không đổi số liệu gameplay: chỉ **báo cáo và khuyến nghị**; mọi thay đổi đi qua \`vgtd-formula-change\` (DECISIONS trước). Phục vụ docs/10 §12 (P5 "mô phỏng kinh tế"), OPEN-ITEMS #7, docs/26 §8 (giai đoạn M0–M1).`,
  );
  out.push('');
  out.push('## 1. Tóm tắt');
  out.push('');
  const high = a.flags.filter((f) => f.severity === 'cao');
  out.push(
    `Một đoàn ${n(P.players)} người chơi mô phỏng ${P.days} ngày với công thức và bảng thật của \`@vgtd/shared\` (bảng rơi 07 §6, thuế chợ, phí niêm yết, phí truyền tống, sửa chữa, tốc độ tu vi, tỷ lệ đột phá). Kết quả kịch bản gốc (chỉ cơ chế đã có trong tài liệu): tỷ lệ tiêu hao / sinh ra ổn định **${d2(a.steadyRatio)}** (mục tiêu ${d1(SINK_SOURCE_RATIO_TARGET[0])}–${d1(SINK_SOURCE_RATIO_TARGET[1])}); ${high.length} cảnh báo mức cao.`,
  );
  out.push('');
  for (const f of high) out.push(`- ${f.title}`);
  out.push('');
  out.push('Khuyến nghị ngắn (chi tiết ở §7):');
  out.push('');
  out.push(
    repairMult === undefined
      ? '1. Chỉ chỉnh hệ số có sẵn (phí sửa chữa nhân tới 64 lần) **không đủ** để chạm 0,9: cần thêm kênh tiêu hao hằng ngày mới, không chỉ nâng hệ số.'
      : `1. Hệ số có sẵn: phí sửa chữa ×${d1(repairMult)} đưa tỷ lệ về 0,9 trong mô hình (vòng điều chỉnh hằng tuần của docs/07 §7 nhân 1,1 mỗi lần: cần ${Math.ceil(Math.log(Math.max(repairMult, 1.0001)) / Math.log(1.1))} lần liên tiếp).`,
  );
  out.push(
    '2. Kênh "đột phá 35%" không có cơ chế Linh thạch trong tài liệu; đột phá chỉ vài lần mỗi nhân vật nên không thể gánh tiêu hao hằng ngày: cần quyết định kênh tiêu hao **lặp lại** theo giờ chơi (§7).',
  );
  out.push(
    '3. Boss tuần chi phối thu nhập theo giờ và nửa giá trị rương là xổ số thượng phẩm: xem lại số boss khả dụng và dòng 12% × 10.000 (§6).',
  );
  out.push('');
  out.push('## 2. Phương pháp và giả định');
  out.push('');
  out.push(
    'Mô phỏng theo ngày, một đoàn người chơi (không có người vào mới). Mỗi ngày mỗi người chơi: săn (dã ngoại / tinh anh, đội, linh khí cạn kiệt, quái thấp hơn 1 cảnh giới), đánh boss tuần, làm nhiệm vụ (nhật, tuần, tông môn, phụ, chương chính), tu luyện (tu vi theo `minutesForStage`, đột phá nhỏ và lớn có pity và đan), sửa trang bị, truyền tống, đổi phẩm, chế tạo (thợ) và giao dịch ở chợ (đan đột phá, nguyên liệu; giá theo cung cầu, thuế τ theo CPI tuần). Sổ Linh thạch bảo toàn: tổng ví = tổng sinh ra − tổng tiêu hao (có test).',
  );
  out.push('');
  out.push(paramsTable(P));
  out.push('');
  out.push('Mọi con số mà tài liệu **không** nêu đều là giả định hành vi (cần game designer duyệt), liệt kê đầy đủ:');
  out.push('');
  for (const s of ASSUMPTIONS) out.push(`- ${s}`);
  out.push('');
  out.push('## 3. Kịch bản và so sánh');
  out.push('');
  out.push(
    '| Kịch bản | Tỷ lệ tiêu hao / sinh ra (ổn định) | Ví trung vị tuần 4 | Ví trung vị cuối | Ví p90 cuối | Gini cuối | Hệ số giá đan (r1–3) | Cảnh báo cao |',
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const s of [base, ...others]) out.push(summaryRow(s));
  out.push('');
  for (const s of [base, ...others]) out.push(`- **${s.title}:** ${s.note}`);
  out.push('');

  out.push('## 4. Kịch bản gốc: Linh thạch theo thời gian');
  out.push('');
  out.push('### 4.1 Tỷ lệ tiêu hao / sinh ra theo tuần');
  out.push('');
  out.push(
    chart(
      a.weeks.map((w) => [`tuần ${String(w.week).padStart(2)}`, w.ratio, d2(w.ratio)] as [string, number, string]),
      32,
    ),
  );
  out.push('');
  out.push(`Mục tiêu ${d1(SINK_SOURCE_RATIO_TARGET[0])}–${d1(SINK_SOURCE_RATIO_TARGET[1])} (docs/26 §7.1).`);
  out.push('');
  out.push('### 4.2 Linh thạch trong ví của người chơi còn hoạt động (hạ phẩm)');
  out.push('');
  out.push(
    '| Tuần | Sinh ra / người / ngày | Tiêu hao / người / ngày | Ví trung vị | Ví p90 | Gini | Giá đan (hệ số) | Giá nguyên liệu | τ |',
  );
  out.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const w of a.weeks)
    out.push(
      `| ${w.week} | ${n(w.faucetPerPlayerDay)} | ${n(w.sinkPerPlayerDay)} | ${n(w.medianWallet)} | ${n(w.p90Wallet)} | ${d2(w.gini)} | ${d1(w.pillMult)} | ${d1(w.matMult)} | ${pct(w.tau)} |`,
    );
  out.push('');
  out.push('Ví trung vị theo tuần:');
  out.push('');
  out.push(
    chart(
      a.weeks.map(
        (w) => [`tuần ${String(w.week).padStart(2)}`, w.medianWallet, n(w.medianWallet)] as [string, number, string],
      ),
      32,
    ),
  );
  out.push('');
  out.push('Hệ số giá đan đột phá (cảnh giới 1–3; 1 = V(r, q) của docs/13 §5.1):');
  out.push('');
  out.push(
    chart(
      a.weeks.map(
        (w) => [`tuần ${String(w.week).padStart(2)}`, w.pillMult, d1(w.pillMult)] as [string, number, string],
      ),
      32,
    ),
  );
  out.push('');
  out.push('### 4.3 Kênh sinh ra và tiêu hao (ổn định, từ tuần 5)');
  out.push('');
  const fTot = Object.values(a.steadyFaucet).reduce((x, y) => x + y, 0);
  const sTot = Object.values(a.steadySink).reduce((x, y) => x + y, 0);
  out.push('Sinh ra:');
  out.push('');
  out.push(
    chart(
      FAUCET_CHANNELS.map(
        (k) => [k, a.steadyFaucet[k]!, pct(fTot > 0 ? a.steadyFaucet[k]! / fTot : 0)] as [string, number, string],
      ),
    ),
  );
  out.push('');
  out.push('Tiêu hao:');
  out.push('');
  out.push(
    chart(
      SINK_CHANNELS.map(
        (k) => [k, a.steadySink[k]!, pct(sTot > 0 ? a.steadySink[k]! / sTot : 0)] as [string, number, string],
      ),
    ),
  );
  out.push('');
  out.push('### 4.4 Cơ cấu tiêu hao so với mục tiêu (docs/07 §7)');
  out.push('');
  out.push('| Nhóm | Mục tiêu | Mô hình | Cơ chế trong mô hình |');
  out.push('| --- | --- | --- | --- |');
  for (const t of a.sinkTargets)
    out.push(
      `| ${t.key} | ${pct(t.target)} | ${pct(t.modelled)} | ${t.channels.length ? t.channels.join(', ') : '(không có cơ chế)'} |`,
    );
  out.push('');
  out.push('## 5. Nhịp tu luyện (thời gian tới từng cảnh giới)');
  out.push('');
  out.push(
    'Ngày (kể từ ngày 1) mà người chơi vào cảnh giới, theo nhóm; "tới được" là tỷ lệ nhóm tới được trong thời gian mô phỏng.',
  );
  out.push('');
  out.push('| Nhóm | Cảnh giới | Tới được | p10 | Trung vị | p90 |');
  out.push('| --- | --- | --- | --- | --- | --- |');
  for (const p of a.pacing)
    out.push(`| ${p.group} | ${REALM_NAMES[p.realm - 1]} | ${pct(p.reached)} | ${p.p10} | ${p.p50} | ${p.p90} |`);
  out.push('');
  if (full) {
    out.push(`Toàn bộ 41 nấc (kịch bản "${full.title}", không giới hạn nấc):`);
    out.push('');
    out.push('| Nhóm | Cảnh giới | Tới được | Trung vị (ngày) |');
    out.push('| --- | --- | --- | --- |');
    for (const p of full.analysis.pacing)
      out.push(`| ${p.group} | ${REALM_NAMES[p.realm - 1]} | ${pct(p.reached)} | ${p.p50} |`);
    out.push('');
  }
  out.push('## 6. Thu nhập theo hoạt động và cảnh báo');
  out.push('');
  out.push('| Hoạt động | Giờ (cả đoàn) | Linh thạch | Hạ phẩm / giờ |');
  out.push('| --- | --- | --- | --- |');
  for (const x of a.activityPerHour) out.push(`| ${x.activity} | ${n(x.hours)} | ${n(x.stones)} | ${n(x.perHour)} |`);
  out.push('');
  out.push(
    chart(
      a.activityPerHour
        .filter((x) => x.hours > 0)
        .map((x) => [x.activity, x.perHour, `${n(x.perHour)} / giờ`] as [string, number, string]),
    ),
  );
  out.push('');
  out.push('(Nhiệm vụ không tính giờ riêng: đóng góp bằng Linh thạch ở bảng kênh.)');
  out.push('');
  for (const sev of ['cao', 'trung', 'thấp', 'thông tin'] as const) {
    const fl = a.flags.filter((f) => f.severity === sev);
    if (fl.length === 0) continue;
    out.push(`### Cảnh báo mức ${sev}`);
    out.push('');
    for (const f of fl) out.push(flagBlock(f));
    out.push('');
  }
  out.push('## 7. Khuyến nghị (không đổi số gameplay)');
  out.push('');
  const gap = a.weeks.length ? a.weeks.slice(Math.min(4, a.weeks.length - 1)) : [];
  const gapPerDay = gap.length
    ? gap.reduce((s, w) => s + (SINK_SOURCE_RATIO_TARGET[0] * w.faucetPerPlayerDay - w.sinkPerPlayerDay), 0) /
      gap.length
    : 0;
  out.push(
    `1. **Cần thêm khoảng ${n(Math.max(0, gapPerDay))} hạ phẩm tiêu hao mỗi người chơi mỗi ngày** (ở ổn định) để tới 0,9 mà không đổi nguồn sinh ra.`,
  );
  out.push(
    repairMult === undefined
      ? '2. Nâng hệ số sửa chữa (công cụ điều chỉnh có sẵn ở docs/07 §7) lên 64 lần vẫn không đủ: không thể chỉ dùng vòng điều chỉnh hằng tuần.'
      : `2. Chỉ bằng phí sửa chữa: ×${d1(repairMult)} mới tới 0,9; phí sửa chữa khi đó dễ làm người chơi ít giờ nản (sửa từ 0 lên 100% tốn ${n(repairMult * 40)}% giá trị món đồ). Nên chia gánh giữa nhiều kênh hơn là dồn vào một.`,
  );
  out.push(
    '3. **Quyết định thiết kế cần có** (game designer, rồi `vgtd-formula-change`): (a) có phí Linh thạch cho đột phá hay không, và nếu có thì nhỏ nhưng lặp (mỗi lần thử, kể cả thất bại, kèm pity), vì một lần mỗi cảnh giới không bù được dòng sinh ra hằng ngày; (b) có NPC mua đồ hay không (X7) và trần giá, vì không có thì đan hồi phục và bản vẽ thấp phẩm chỉ tích lũy; (c) kênh thay cho Hộ Sơn Đại Trận / Linh Mạch (15%) trong beta chỉ có tông môn NPC; (d) chợ cần phí hoặc giá sàn để giá đan không dao động hàng chục lần ở tuần đầu.',
  );
  const hasBoss = a.flags.some((f) => f.id === 'dominant-loop-boss' || f.id === 'dominant-faucet-drop_boss');
  const peakPill = Math.max(...a.weeks.map((w) => w.pillMult));
  let k = 4;
  if (hasBoss)
    out.push(
      `${k++}. Xem lại số boss khả dụng mỗi tuần và dòng thượng phẩm 12% (hoặc đổi thành vật phẩm / pity) để thu nhập không nằm ở xổ số.`,
    );
  if (peakPill > 3)
    out.push(
      `${k++}. Đan đột phá: giá đỉnh ×${d1(peakPill)} so với V(r, q) khi cả đoàn chạm ngưỡng cùng lúc, vì nhu cầu (2 đan mỗi ngưỡng) lớn hơn nhiều nguồn rơi 0,02–6% và công suất thợ: cân nhắc hạn mức NPC bán đan đầu game, hoặc giảm số đan khuyến nghị, để người chơi không phải chờ hay thử không đan.`,
    );
  out.push(
    `${k}. Chạy lại mô phỏng khi: có số liệu closed beta (M3), thay đổi bảng rơi / phí, hoặc chốt phí đột phá / NPC mua. \`npm run sim -w @vgtd/econ-sim -- --help\`.`,
  );
  out.push('');
  out.push('## 8. Giới hạn của mô hình');
  out.push('');
  out.push(
    '- Một đoàn cố định (không có người chơi mới vào) và hành vi giả định: con số tuyệt đối không phải dự báo, chỉ dùng để **so sánh kịch bản** và phát hiện cấu trúc lệch.',
  );
  out.push(
    '- Chưa có: gian lận (M2), đấu giá, Tiên Ngọc, Linh Mạch, pity chế tạo, nhiều vùng khác ρ, giá trị trang bị tăng theo cảnh giới (lấy từ ngoài vòng Linh thạch), người chơi không chơi đủ mọi nhóm nghề.',
  );
  out.push(`- Phẩm đan: ${QUALITY_NAMES.join(' / ')}; bản vẽ dùng làm vật phẩm tích lũy, không chế tạo trang bị.`);
  out.push(
    '- Cống hiến (CONG_HIEN) là tiền riêng, không vào tỷ lệ (docs/26 §7.1); cung được đếm riêng: ' +
      `${n(base.result.contribution.earned)} cho ${n(base.result.contribution.members)} thành viên.`,
  );
  out.push('');
  return out.join('\n');
}
