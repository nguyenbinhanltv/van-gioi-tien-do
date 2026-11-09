/**
 * `npm run sim -w @vgtd/econ-sim -- [--players N] [--days N] [--seed N] [--out FILE] [--quick]`
 * Runs the base scenario and the comparison scenarios, solves the repair multiplier that reaches the 0.9 ratio, prints the markdown
 * report to stdout or writes it to FILE. Deterministic: the same arguments give the same report.
 */
import { writeFileSync } from 'node:fs';
import { DEFAULT_PARAMS, type SimParams } from './params.js';
import { makeScenario, renderReport, type Scenario } from './report.js';
import { runSim } from './sim.js';
import { solveRepairMult } from './analyze.js';

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  console.log('usage: sim [--players N] [--days N] [--seed N] [--out FILE] [--quick]');
  process.exit(0);
}
const opt = (name: string): string | undefined => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const quick = args.includes('--quick');
const base: SimParams = {
  ...DEFAULT_PARAMS,
  players: Number(opt('players') ?? (quick ? 400 : DEFAULT_PARAMS.players)),
  days: Number(opt('days') ?? (quick ? 42 : DEFAULT_PARAMS.days)),
  seed: Number(opt('seed') ?? DEFAULT_PARAMS.seed),
};
const t0 = Date.now();
const run = (id: string, title: string, note: string, p: SimParams): Scenario =>
  makeScenario(id, title, note, runSim(p));

const baseSc = run(
  'base',
  'Gốc (chỉ cơ chế trong tài liệu)',
  'beta (đến cổng Kết Anh, nấc 18), không NPC mua đồ, đột phá không tốn Linh thạch.',
  base,
);
const others = [
  run(
    'npc',
    'NPC mua nguyên liệu 30%',
    'thêm faucet NPC_SELL (X7): mỗi nguyên liệu không bán được cho người chơi thì NPC mua với 30% giá gốc.',
    { ...base, npcBuyFrac: 0.3 },
  ),
  run('drop-', 'Tỷ lệ rơi −20%', 'quét tham số M1 (docs/26 §8): mọi xác suất rơi ×0,8.', { ...base, dropMult: 0.8 }),
  run('drop+', 'Tỷ lệ rơi +20%', 'mọi xác suất rơi ×1,2.', { ...base, dropMult: 1.2 }),
  run(
    'btcost',
    'Phí đột phá 0,5 × V_ref (giả định)',
    'mỗi lần thử đột phá lớn (kể cả thất bại) tốn 0,5 × 1610 × 1,5^(r−1) hạ phẩm; docs không có phí này, chỉ để đo xem một sink theo sự kiện bù được bao nhiêu.',
    { ...base, breakthroughCostMult: 0.5 },
  ),
  run(
    'repair2',
    'Phí sửa chữa ×2',
    'hệ số điều chỉnh có sẵn của docs/07 §7 nhân đôi (sau khoảng 7 lần vòng điều chỉnh ×1,1).',
    { ...base, repairMult: 2 },
  ),
];
const full = run('full', 'Toàn bộ 41 nấc', 'không giới hạn nấc: chỉ để đo nhịp tu luyện cả game.', {
  ...base,
  maxStage: 41,
});
const calib = { ...base, players: Math.min(base.players, 600), days: Math.min(base.days, 60) };
const repairMult = solveRepairMult(calib);
const md = renderReport({ base: baseSc, others, full, repairMult, elapsedMs: Date.now() - t0 });
const out = opt('out');
if (out) {
  writeFileSync(out, md);
  console.error(`wrote ${out} (${md.length} bytes) in ${Date.now() - t0} ms`);
} else console.log(md);
