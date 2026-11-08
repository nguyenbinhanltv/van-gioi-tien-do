/**
 * In-process World Node tick benchmark (CLI): the cost of one tick (sim step + AOI + snapshot encode) at 100-300 players, without the
 * noise of sockets and a shared dev machine.
 *
 *   npm run bench:tick -w @vgtd/server -- [--players 200] [--ticks 600] [--area 40] [--mobs 150] [--runs 3] [--no-combat] [--no-mob-attacks] [--hash] [--json]
 *
 * Reports, per run: mean CPU ms per tick (process CPU time, not inflated when the process is descheduled), wall ms per tick (mean /
 * p50 / p99 / min), the phase split, and the bytes the world sent (bandwidth must not change when the code is optimised). Contention on
 * a shared machine only ever ADDS time: compare the BEST run of several. `--hash` additionally folds every byte of every message into a
 * checksum: two builds that print the same checksum sent byte-identical streams.
 */
import { runTickBench, type TickBenchResult } from './tick-bench-core.js';

function num(name: string, def: number): number {
  const i = process.argv.indexOf(`--${name}`);
  if (i < 0) return def;
  const v = Number(process.argv[i + 1]);
  if (!Number.isFinite(v) || v < 0) throw new Error(`--${name} needs a non-negative number`);
  return v;
}
const opts = {
  players: num('players', 200),
  ticks: num('ticks', 600),
  warm: num('warm', 60),
  area: num('area', 40),
  mobs: num('mobs', 150),
  hash: process.argv.includes('--hash'),
  combat: !process.argv.includes('--no-combat'),
  mobAttacks: !process.argv.includes('--no-mob-attacks'),
};
const runs = num('runs', 3);
const asJson = process.argv.includes('--json');

const results: TickBenchResult[] = [];
for (let r = 0; r < runs; r++) results.push(runTickBench(opts));
const best = results.reduce((a, b) => (b.wall.mean < a.wall.mean ? b : a));
const f = (n: number, d = 2): string => n.toFixed(d);
if (asJson) console.log(JSON.stringify({ ...opts, results, best }, null, 2));
else {
  console.log(
    `tick bench: ${opts.players} players, ${opts.area}x${opts.area} tiles, ${opts.mobs} mobs, ${opts.ticks} ticks x ${runs} runs`,
  );
  results.forEach((r, k) =>
    console.log(
      `  run ${k + 1}: cpu ${f(r.cpuMsPerTick)} ms/tick | wall mean ${f(r.wall.mean)} p50 ${f(r.wall.p50)} p99 ${f(r.wall.p99)} min ${f(r.wall.min)} | step ${f(r.phases.stepMean)} aoi ${f(r.phases.aoiMean)}/AOI tick snap ${f(r.phases.snapMean)} | ${f(r.bytesPerPlayerPerS / 1024)} KB/s/player, ${r.frames} frames, ${r.totalBytes} B${r.checksum ? `, checksum ${r.checksum}` : ''}`,
    ),
  );
  console.log(
    `best run: wall mean ${f(best.wall.mean)} ms, p99 ${f(best.wall.p99)} ms; min CPU ${f(Math.min(...results.map((r) => r.cpuMsPerTick)))} ms/tick`,
  );
}
process.exit(0);
