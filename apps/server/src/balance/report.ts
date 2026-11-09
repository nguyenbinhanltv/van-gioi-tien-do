/**
 * Class-balance harness (D115): the Markdown report. Pure formatting of the scenario results; the analysis (outliers, recommendations) is derived
 * from the numbers by documented rules, never hand-edited, so a re-run regenerates the whole document.
 */
import { PATHS, classOf, type PathId } from '@vgtd/shared';
import {
  BANDS,
  PARTY_BOSS,
  TIER_LIMIT_S,
  findOutliers,
  median,
  type BalanceConfig,
  type DuelMatrix,
  type KitRow,
  type PartySummary,
  type SoloSummary,
  type Tier,
} from './scenarios.js';

export interface BalanceData {
  config: BalanceConfig;
  solo: SoloSummary[];
  party: PartySummary[];
  duels: DuelMatrix;
  kits: KitRow[];
}

const f = (x: number, d = 1): string => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pct = (x: number, d = 0): string => (Number.isFinite(x) ? `${(x * 100).toFixed(d)}%` : 'n/a');
const signed = (x: number): string => (Number.isFinite(x) ? `${x >= 0 ? '+' : ''}${(x * 100).toFixed(0)}%` : 'n/a');
const TIER_NAME: Record<Tier, string> = { normal: 'quái thường', elite: 'tinh anh', boss: 'boss' };
const role = (p: PathId): string => classOf(p).role;

/** A horizontal bar `value / median` (1.00 = the median), 20 characters = 2.0x. */
function bar(ratio: number): string {
  const n = Math.max(0, Math.min(20, Math.round(ratio * 10)));
  return '█'.repeat(n) + '·'.repeat(20 - n);
}

function chart(title: string, rows: { path: PathId; v: number }[], higherIsBetter: boolean, band: number): string[] {
  const m = median(rows.map((r) => r.v));
  const out = [
    '```',
    `${title}  (1.00 = trung vị của 6 lớp; ${higherIsBetter ? 'cao hơn = mạnh hơn' : 'thấp hơn = nhanh hơn'}; | = ±${band * 100}%)`,
  ];
  for (const r of rows) {
    const ratio = r.v / m;
    const flag = Math.abs(ratio - 1) > band ? ' ◄ ngoài dải' : '';
    out.push(`${r.path.padEnd(8)} ${bar(ratio)} ${f(ratio, 2)}x${flag}`);
  }
  out.push('```');
  return out;
}

export function formatBalanceReport(d: BalanceData): string {
  const band = d.config.outlierBand;
  const o: string[] = [];
  const solo = d.solo.filter((r) => r.mode === 'solo');
  const team = d.solo.filter((r) => r.mode === 'team');
  const cell = (rows: SoloSummary[], b: string, t: Tier): SoloSummary[] =>
    PATHS.map((p) => rows.find((r) => r.band === b && r.tier === t && r.path === p)!).filter(Boolean);

  o.push('# Báo cáo cân bằng 6 Đạo Lộ (D115)');
  o.push('');
  o.push(
    '> **Tự sinh** bởi `npm run balance -w @vgtd/server` (xem mục 10). Không sửa tay: chạy lại để cập nhật. **Báo cáo này không đổi con số nào**; đề xuất chỉnh ở mục 9 chỉ là gợi ý, mọi thay đổi đi qua `vgtd-formula-change` sau khi chủ dự án duyệt. Mọi số trong `skills.json` vẫn là "Đề xuất – chờ duyệt" (D49).',
  );
  o.push('');
  o.push('## 1. Phương pháp và giới hạn');
  o.push('');
  o.push(
    `- **Chạy trên mã máy chủ thật**: \`WorldNode\` (lõi chiến đấu \`CombatSystem\`, \`MobManager\` + AI, đòn của quái và telegraph, hồi phục, luật cast của \`@vgtd/sim\`) trên bản đồ trống với **đúng một quái** của def được chọn (docs/10 §4) và người chơi ở **cùng cảnh giới / tầng** với quái (trận cân sức). Người chơi gửi khung \`skill_cast\` thật qua \`node.receive\`, mỗi tick một quyết định; thời gian là giờ sim (20 Hz), ngẫu nhiên là các luồng có seed: kết quả là hàm thuần của cấu hình, chạy lại ra đúng số này.`,
  );
  o.push(
    `- **Người chơi kịch bản** (\`rotation.ts\`): chỉ dựa vào dữ liệu kỹ năng, không dựa id kỹ năng. Hồi khi ai đó dưới 65% HP, khiên khi sẵn sàng, còn lại chọn kỹ năng sát thương có (sát thương / giây thi triển) cao nhất trong số đang sẵn sàng; luôn đứng yên (không né telegraph, không di chuyển), uống đan hồi máu (18%, 3 viên, hồi chiêu 8 s) khi dưới 40% HP. Kỹ năng mà **mọi** hiệu ứng đều bị máy chủ bỏ qua thì không được dùng (mục 2).`,
  );
  o.push(
    `- **Dải cảnh giới**: Luyện Khí (quái thường ${BANDS[0]!.mobs.normal}, tinh anh ${BANDS[0]!.mobs.elite}), Trúc Cơ (${BANDS[1]!.mobs.normal}, ${BANDS[1]!.mobs.elite}), Kim Đan (${BANDS[2]!.mobs.normal}, ${BANDS[2]!.mobs.elite}, boss ${BANDS[2]!.mobs.boss}). Chỉ Kim Đan có boss trong docs/10. Mỗi ô chạy ${d.config.seeds.normal} / ${d.config.seeds.elite} / ${d.config.seeds.boss} hạt giống (quái thường / tinh anh / boss); hạt giống chỉ đổi cấp của quái trong cùng cảnh giới, và **mọi lớp gặp đúng các quái đó**. Số trong bảng là **trung vị** qua các hạt giống.`,
  );
  o.push(
    `- **Dải ngoại lệ**: một lớp bị gắn cờ khi số đo lệch quá **±${band * 100}%** so với trung vị của 6 lớp trong cùng ô. Lớp tank / hỗ trợ cố ý chậm hơn về sát thương (docs/11): cờ của chúng cần đọc cùng cột "vai trò".`,
  );
  o.push(
    '- **Giới hạn của người chơi kịch bản**: không né telegraph (nên boss gây nhiều sát thương hơn người chơi thật gặp), không đổi vị trí, không dùng kỹ năng dịch chuyển, không có phối hợp. So sánh giữa các lớp công bằng (cùng người chơi, cùng quái), nhưng con số tuyệt đối (đặc biệt boss) là **cận dưới sống sót**.',
  );
  o.push(
    '- **Nhánh (solo / team)**: máy chủ chưa có nhánh (D49). Harness áp nhánh lên dữ liệu kỹ năng (`damage_mult`, `cooldown_mult`, `shield_mult` và `dmg_mult` / `heal_mult` / `shield_mult` của nhánh) rồi đưa cho **chính lõi chiến đấu**; các chỉ số nhánh máy chủ không biểu diễn được (`dmg_taken_mult`, `threat_mult`, `lifesteal_add`, `ally_crit_bonus`, `team_dmg`, `team_dr`) **không** được áp (mục 2 liệt kê).',
  );
  o.push('');

  // ----------------------------------------------------------------------------------------------- 2 coverage
  o.push('## 2. Máy chủ mô phỏng được bao nhiêu bộ kỹ năng');
  o.push('');
  o.push(
    '`resolveCast` chỉ xử lý hiệu ứng `damage`, `heal`, `shield`. Mọi hiệu ứng khác (dot, trạng thái khống chế, buff, đánh dấu, triệu hồi, dịch chuyển, khiêu khích ...) hiện **không có tác dụng** trên máy chủ. Bảng: số kỹ năng chủ động dùng được đầy đủ / một phần / tổng, và phần sát thương thiết kế (theo "đòn cơ bản tương đương") mà máy chủ tính được.',
  );
  o.push('');
  o.push(
    '| Lớp | Vai trò | Đủ / một phần / tổng | Sát thương máy chủ tính được | Hiệu ứng bị bỏ qua (số kỹ năng) | Khống chế cứng thiết kế (tiềm năng) |',
  );
  o.push('| --- | --- | --- | --- | --- | --- |');
  for (const k of d.kits)
    o.push(
      `| ${k.path} | ${k.role} | ${k.fullySupported} / ${k.partlySupported} / ${k.active} | ${pct(k.damageShare)} | ${
        Object.entries(k.unsupportedTypes)
          .map(([t, n]) => `${t} ×${n}`)
          .join(', ') || '—'
      } | ${k.ccSkills} kỹ năng, ${pct(k.designedCcPotential)} thời gian |`,
    );
  o.push('');
  o.push(
    `Chỉ số nhánh không áp được: ${d.kits.map((k) => `${k.path} (solo: ${k.unmodelledSolo.join(', ') || '—'}; team: ${k.unmodelledTeam.join(', ') || '—'})`).join('; ')}.`,
  );
  o.push('');
  o.push(
    '**Phát hiện**: hồ sơ chiến đấu của máy chủ (`makeProfile`) lấy chỉ số cảnh giới thô (`roundedStatsAt`) và **không áp `stat_weights` của lớp** (docs/11: HP / MP / ATK / DEF khác nhau theo lớp): mọi lớp cùng cảnh giới có đúng cùng HP, MP, ATK, DEF. Bản sắc lớp trên máy chủ hôm nay chỉ đến từ kỹ năng.',
  );
  o.push('');

  // ----------------------------------------------------------------------------------------------- 3 solo PvE
  o.push('## 3. PvE một mình: thời gian hạ quái (TTK)');
  o.push('');
  o.push(
    'Nhánh solo, người chơi cùng cảnh giới với quái, đứng cạnh quái. **TTK** = trung vị số giây tới khi quái chết (chỉ tính các lần hạ được); **TTK dự phóng** = TTK khi hạ được, nếu không thì (thời gian đã đánh) / (phần HP quái đã trừ): so sánh được kể cả khi người chơi chết giữa chừng. DPS = sát thương / giây của cả trận.',
  );
  for (const b of BANDS) {
    for (const t of ['normal', 'elite', 'boss'] as const) {
      const rows = cell(solo, b.id, t);
      if (rows.length === 0) continue;
      const m = median(rows.map((r) => r.projTtkS));
      o.push(
        '',
        `### 3.${BANDS.indexOf(b) + 1}${t === 'normal' ? 'a' : t === 'elite' ? 'b' : 'c'} ${b.name}: ${TIER_NAME[t]} \`${rows[0]!.mob}\` (giới hạn ${TIER_LIMIT_S[t]} s)`,
        '',
      );
      o.push('| Lớp | Vai trò | Hạ được | TTK (s) | TTK dự phóng (s) | so trung vị | DPS | HP quái còn lại |');
      o.push('| --- | --- | --- | --- | --- | --- | --- | --- |');
      for (const r of rows)
        o.push(
          `| ${r.path} | ${role(r.path)} | ${pct(r.killRate)} | ${f(r.ttkS)} | ${f(r.projTtkS)} | ${signed(r.projTtkS / m - 1)}${Math.abs(r.projTtkS / m - 1) > band ? ' ◄' : ''} | ${f(r.dps, 0)} | ${pct(r.mobHpLeft)} |`,
        );
      o.push(
        '',
        ...chart(
          'TTK dự phóng',
          rows.map((r) => ({ path: r.path, v: r.projTtkS })),
          false,
          band,
        ),
      );
    }
  }
  o.push('');
  o.push('### 3.4 Nhánh solo so với nhánh team (TTK dự phóng, team / solo)');
  o.push('');
  o.push(
    `| Lớp | ${BANDS.flatMap((b) => (['normal', 'elite'] as const).map((t) => `${b.name} ${TIER_NAME[t]}`)).join(' | ')} |`,
  );
  o.push(`| --- | ${BANDS.flatMap(() => ['---', '---']).join(' | ')} |`);
  for (const p of PATHS)
    o.push(
      `| ${p} | ${BANDS.flatMap((b) =>
        (['normal', 'elite'] as const).map((t) => {
          const s = solo.find((r) => r.band === b.id && r.tier === t && r.path === p);
          const tm = team.find((r) => r.band === b.id && r.tier === t && r.path === p);
          return s && tm ? `${f(tm.projTtkS / s.projTtkS, 2)}x` : 'n/a';
        }),
      ).join(' | ')} |`,
    );
  o.push('');
  o.push(
    '(>1 = nhánh team chậm hơn khi đánh một mình, đúng thiết kế: nhánh team đổi sát thương cá nhân lấy giá trị cho đội.)',
  );
  o.push('');

  // ----------------------------------------------------------------------------------------------- 4 survivability
  o.push('## 4. Sống sót khi đánh một mình');
  o.push('');
  o.push(
    '"Sống sót" = không chết trước khi hạ quái hoặc hết giờ. "HP thấp nhất" = trung vị mức HP thấp nhất đã chạm (0% = chết hoặc suýt chết). "Sát thương nhận" = % HP tối đa mất mỗi giây (trung vị). Người chơi không né telegraph nên số này cao hơn thực tế.',
  );
  for (const b of BANDS) {
    for (const t of ['normal', 'elite', 'boss'] as const) {
      const rows = cell(solo, b.id, t);
      if (rows.length === 0) continue;
      const m = median(rows.map((r) => r.dtps));
      o.push('', `**${b.name} · ${TIER_NAME[t]}**`, '');
      o.push('| Lớp | Sống sót | HP thấp nhất | Sát thương nhận (%HP/s) | so trung vị | Đan dùng |');
      o.push('| --- | --- | --- | --- | --- | --- |');
      for (const r of rows)
        o.push(
          `| ${r.path} | ${pct(r.survival)} | ${pct(r.minHp)} | ${f(r.dtps * 100, 2)} | ${signed(r.dtps / m - 1)}${Math.abs(r.dtps / m - 1) > band ? ' ◄' : ''} | ${f(r.pills, 1)} |`,
        );
    }
  }
  o.push('');

  // ----------------------------------------------------------------------------------------------- 5 party
  o.push('## 5. Đóng góp trong tổ đội');
  o.push('');
  o.push(
    `Một thành viên (lớp thử, nhánh solo hoặc team) cộng ba đồng đội tham chiếu cố định (the, dan_phu, dao, kiem, bỏ lớp đang thử) đánh \`${PARTY_BOSS.mob}\` (boss Kim Đan, giới hạn ${PARTY_BOSS.limitS} s). Đội 4 người cùng cảnh giới, không né đòn, **không đội nào hạ được boss trong giới hạn thời gian** (đội chết rồi hồi sinh liên tục): số đo đáng tin là phần đóng góp, không phải tỷ lệ thắng. "Phần" = (sát thương + hồi + khiên) của lớp thử / tổng của đội. Hồi và khiên được ghi cho người thi triển kỹ năng hồi / khiên trong cùng bước (chia đều nếu nhiều người).`,
  );
  o.push('');
  o.push(
    '| Lớp | Nhánh | Hạ boss | Thời gian trận (s) | Chết cả đội / trận | HP boss còn | DPS | Hồi/s | Khiên/s | Phần đóng góp |',
  );
  o.push('| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |');
  for (const p of d.party)
    o.push(
      `| ${p.path} | ${p.mode} | ${pct(p.killRate)} | ${f(p.wipeS, 0)} | ${f(p.deathsPerRun, 1)} | ${pct(p.bossHpLeft)} | ${f(p.dps, 0)} | ${f(p.hps, 0)} | ${f(p.sps, 0)} | ${pct(p.share)} |`,
    );
  o.push('');
  o.push(
    '**Khống chế (uptime)**: máy chủ không áp khống chế lên quái (mục 2) nên không đo được trên mã thật. Cột "Khống chế cứng thiết kế" ở mục 2 là tiềm năng theo dữ liệu (tổng thời lượng / hồi chiêu của các hiệu ứng stun, freeze, knock-up, root), không phải kết quả chạy.',
  );
  o.push('');

  // ----------------------------------------------------------------------------------------------- 6 duels
  o.push('## 6. Ma trận đấu tay đôi 6×6 (chỉ để tham khảo)');
  o.push('');
  o.push(
    `Máy chủ chưa có PvP, nên đây **không** chạy trên \`WorldNode\` mà là mô hình hai thân thể trên chính \`makeProfile\` + \`resolveCast\` + cùng người chơi kịch bản (\`duel.ts\`): cooldown, GCD, MP, thời gian cast, khiên và HP đúng như lõi chiến đấu; không di chuyển, không trạng thái, không đan, không hệ số PvP. Cảnh giới ${d.duels.realm} tầng ${d.duels.subStage}, ${d.duels.runs} hạt giống mỗi cặp, nhánh solo. Ô = tỷ lệ thắng của **hàng** trước **cột** (hòa tính nửa).`,
  );
  o.push('');
  o.push(`| hàng \\ cột | ${PATHS.join(' | ')} | trung bình |`);
  o.push(`| --- | ${PATHS.map(() => '---').join(' | ')} | --- |`);
  for (const a of PATHS) {
    const vals = PATHS.map((b) => d.duels.winRate[a][b]);
    o.push(`| ${a} | ${vals.map((v) => pct(v)).join(' | ')} | ${pct(vals.reduce((x, y) => x + y, 0) / vals.length)} |`);
  }
  o.push('');
  o.push('Thời gian trận (s, trung vị):');
  o.push('');
  o.push(`| hàng \\ cột | ${PATHS.join(' | ')} |`);
  o.push(`| --- | ${PATHS.map(() => '---').join(' | ')} |`);
  for (const a of PATHS) o.push(`| ${a} | ${PATHS.map((b) => f(d.duels.timeS[a][b], 0)).join(' | ')} |`);
  o.push('');

  // ----------------------------------------------------------------------------------------------- 7 design vs server
  o.push('## 7. Mô phỏng thiết kế (docs/11 §4.5) so với máy chủ');
  o.push('');
  o.push(
    'Mô phỏng thiết kế (`skill_sim.ts`) chạy **đủ** bộ kỹ năng; cột máy chủ là DPS trung vị ở Kim Đan, quái thường, nhánh solo. Cả hai chuẩn hoá theo trung vị của 6 lớp: chênh lệch lớn nghĩa là phần bộ kỹ năng chưa cài làm đổi thứ hạng lớp.',
  );
  o.push('');
  const srv = cell(solo, 'kim_dan', 'normal');
  const mDesign = median(d.kits.map((k) => k.designRatio));
  const mSrv = median(srv.map((r) => r.dps));
  o.push(
    '| Lớp | Mô phỏng thiết kế (x đòn cơ bản) | so trung vị | DPS máy chủ | so trung vị | Chênh (máy chủ − thiết kế) |',
  );
  o.push('| --- | --- | --- | --- | --- | --- |');
  for (const k of d.kits) {
    const s = srv.find((r) => r.path === k.path)!;
    const a = k.designRatio / mDesign - 1;
    const b = s.dps / mSrv - 1;
    o.push(`| ${k.path} | ${f(k.designRatio, 2)} | ${signed(a)} | ${f(s.dps, 0)} | ${signed(b)} | ${signed(b - a)} |`);
  }
  o.push('');

  // ----------------------------------------------------------------------------------------------- 8 outliers
  o.push(`## 8. Ngoại lệ ngoài dải ±${band * 100}%`);
  o.push('');
  const outs = [
    ...findOutliers(solo, band, 'projTtkS', 'TTK dự phóng'),
    ...findOutliers(solo, band, 'dtps', 'sát thương nhận'),
  ];
  if (outs.length === 0) o.push('Không có.');
  else {
    o.push('| Ô | Lớp | Vai trò | Chỉ số | Giá trị | Trung vị | Lệch |');
    o.push('| --- | --- | --- | --- | --- | --- | --- |');
    for (const x of outs)
      o.push(
        `| ${x.where} | ${x.path} | ${role(x.path)} | ${x.metric} | ${x.metric === 'sát thương nhận' ? `${f(x.value * 100, 2)} %HP/s` : `${f(x.value, 1)} s`} | ${x.metric === 'sát thương nhận' ? `${f(x.median * 100, 2)} %HP/s` : `${f(x.median, 1)} s`} | ${signed(x.delta)} |`,
      );
  }
  o.push('');
  o.push('### 8.1 Độ lệch theo lớp (trung bình nhân của TTK dự phóng / trung vị, quái thường và tinh anh, nhánh solo)');
  o.push('');
  const skew = PATHS.map((p) => {
    const rs = solo.filter((r) => r.path === p && r.tier !== 'boss');
    const ratios = rs.map(
      (r) => r.projTtkS / median(solo.filter((x) => x.band === r.band && x.tier === r.tier).map((x) => x.projTtkS)),
    );
    const g = Math.exp(ratios.reduce((a, b) => a + Math.log(b), 0) / ratios.length);
    return { path: p, g };
  });
  o.push(
    '```',
    ...skew.map(
      (s) =>
        `${s.path.padEnd(8)} ${bar(s.g)} ${f(s.g, 2)}x  ${s.g > 1 + band ? '(chậm hơn dải)' : s.g < 1 - band ? '(nhanh hơn dải)' : '(trong dải)'}`,
    ),
    '```',
  );
  o.push('');

  // ----------------------------------------------------------------------------------------------- 9 recommendations
  o.push('## 9. Đề xuất chỉnh (chưa áp dụng)');
  o.push('');
  o.push(
    'Sinh theo quy tắc từ các số trên; **cần chủ dự án / game designer duyệt** trước khi đổi bất kỳ số nào (skill `vgtd-formula-change`: DECISIONS trước, rồi `skills.json`, test, tài liệu). Hệ số gợi ý = nhân sát thương với độ lệch để đưa TTK của lớp về trung vị (TTK tỷ lệ nghịch với sát thương); đây là bước đầu thô, chưa tính tương tác với sống sót và đội.',
  );
  o.push('');
  o.push('| # | Lớp | Quan sát | Đề xuất |');
  o.push('| --- | --- | --- | --- |');
  let n = 0;
  for (const s of skew) {
    const r = role(s.path);
    const support = /tank|support/.test(r);
    if (s.g > 1 + band)
      o.push(
        `| ${++n} | ${s.path} | chậm hơn trung vị ${pct(s.g - 1)} về TTK${support ? ` (vai trò ${r}: một phần là chủ ý)` : ''} | ${support ? 'giữ nếu đóng góp đội (mục 5) bù lại; nếu không, tăng sát thương ≈ ' : 'tăng sát thương (hệ số kỹ năng) ≈ '}${signed(s.g - 1)} |`,
      );
    else if (s.g < 1 - band)
      o.push(
        `| ${++n} | ${s.path} | nhanh hơn trung vị ${pct(1 - s.g)} về TTK | giảm sát thương ≈ ${signed(s.g - 1)}, hoặc tăng chi phí MP / hồi chiêu |`,
      );
  }
  const lowCov = d.kits.filter((k) => k.fullySupported < k.active);
  o.push(
    `| ${++n} | cả 6 | bộ kỹ năng chỉ cài một phần (${lowCov.map((k) => `${k.path} ${k.fullySupported}/${k.active}`).join(', ')}) | cài hiệu ứng còn thiếu trên máy chủ (dot, trạng thái khống chế, buff, đánh dấu, triệu hồi) **trước** khi chỉnh số: mọi so sánh trên bị lệch bởi phần chưa cài |`,
  );
  o.push(
    `| ${++n} | cả 6 | \`stat_weights\` của lớp bị bỏ qua | quyết định: áp \`stat_weights\` vào \`makeProfile\` (docs/11 mong muốn) hay bỏ khỏi dữ liệu; rồi chạy lại báo cáo này |`,
  );
  o.push(
    `| ${++n} | cả 6 | nhánh solo / team không có trên máy chủ | cài nhánh (chỉ số \`dmg_taken_mult\`, \`threat_mult\`, \`team_dmg\` ... chưa có chỗ áp) để mục 3.4 và 5 phản ánh đúng thiết kế |`,
  );
  o.push(
    `| ${++n} | boss | không đội 4 người không né nào hạ được \`${PARTY_BOSS.mob}\` | kiểm tra lại HP × 45 / ATK × 1,5 của boss (docs/10 §4.1) cùng telegraph; hoặc đo lại khi harness biết né |`,
  );
  o.push('');

  // ----------------------------------------------------------------------------------------------- 10 reproduce
  o.push('## 10. Chạy lại');
  o.push('');
  o.push('```bash');
  o.push('npm run balance -w @vgtd/server                       # bản đầy đủ, ghi docs/36-bao-cao-can-bang-dao-lo.md');
  o.push('npm run balance -w @vgtd/server -- --quick --out -    # bản nhanh, in ra màn hình');
  o.push('```');
  o.push('');
  o.push(
    `Cấu hình: hạt giống quái thường / tinh anh / boss = ${d.config.seeds.normal} / ${d.config.seeds.elite} / ${d.config.seeds.boss}, ${d.config.duelSeeds} hạt giống mỗi cặp đấu tay đôi, dải ngoại lệ ±${band * 100}%. Mã: \`apps/server/src/balance/\`; thử nghiệm: \`apps/server/tests/balance.test.ts\`.`,
  );
  return o.join('\n') + '\n';
}
