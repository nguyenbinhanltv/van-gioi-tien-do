/**
 * Markdown report of the D49 class-kit simulation (docs/11 §4.5). Run with
 * `VGTD_SIM_REPORT=1 npx vitest run test/skill-sim-report.test.ts -w @vgtd/shared` to print it; the PR description embeds it.
 */
import { SIM, runDummy, summariseBoss, summariseSoloPack, type SimPlayerSpec } from './skill_sim.js';
import { PATHS, type PathId, staticTtkMatrix } from './skills.js';

const f = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d) : 'n/a');
const pct = (x: number) => `${Math.round(x * 100)}%`;

const solo = (path: PathId): SimPlayerSpec => ({ path, mode: 'solo' });
const team = (path: PathId): SimPlayerSpec => ({ path, mode: 'team' });

export function formatSkillSimReport(): string {
  const out: string[] = [];
  out.push('### 1. Solo rotation DPS vs a dummy (120 s, x basic attack of the same class)');
  out.push(
    '',
    '| Path | Solo ratio | Team ratio | Team/Solo DPS | Pet DPS | MP use %/s |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const p of PATHS) {
    const s = runDummy(solo(p));
    const t = runDummy(team(p));
    out.push(
      `| ${p} | ${f(s.ratio)} | ${f(t.ratio)} | ${f(t.dps / s.dps, 3)} | ${f(s.petDps, 0)} | ${f(s.mpPerS * 100, 1)} |`,
    );
  }
  out.push('', '### 2. Solo pack clear (6 mobs, 24 seeds, mob ATK 0.9-1.3x)');
  out.push(
    '',
    '| Path | Solo clear s | Solo death | Solo end HP | Team clear s | Team death |',
    '| --- | --- | --- | --- | --- | --- |',
  );
  for (const p of PATHS) {
    const s = summariseSoloPack(p, 'solo');
    const t = summariseSoloPack(p, 'team');
    out.push(
      `| ${p} | ${f(s.clearTimeS, 1)} | ${pct(s.deathRate)} | ${pct(s.meanEndHpPct)} | ${f(t.clearTimeS, 1)} | ${pct(t.deathRate)} |`,
    );
  }
  out.push('', '### 3. Group boss (24 seeds; nuke needs any hard CC / knockback interrupt)');
  out.push('', '| Team | Win | Kill s | Deaths/run | Team ETD |', '| --- | --- | --- | --- | --- |');
  const show = (name: string, team_: SimPlayerSpec[], opts = {}) => {
    const b = summariseBoss(team_, opts);
    out.push(`| ${name} | ${pct(b.winRate)} | ${f(b.killTimeS, 0)} | ${f(b.deathsPerRun)} | ${f(b.teamEtd, 0)} |`);
  };
  for (const p of PATHS) show(`4x ${p} (solo branch)`, [solo(p), solo(p), solo(p), solo(p)]);
  show('kiem+phap+thuong+dao (no tank/healer)', [solo('kiem'), solo('phap'), solo('thuong'), solo('dao')]);
  show('the+dan_phu solo + kiem+phap', [solo('the'), solo('dan_phu'), solo('kiem'), solo('phap')]);
  show('the+dan_phu TEAM + kiem+phap', [team('the'), team('dan_phu'), solo('kiem'), solo('phap')]);
  show('hard boss x1.6: all solo', [solo('the'), solo('dan_phu'), solo('kiem'), solo('phap')], { bossDmgMult: 1.6 });
  show('hard boss x1.6: tank+healer TEAM', [team('the'), team('dan_phu'), solo('kiem'), solo('phap')], {
    bossDmgMult: 1.6,
  });
  out.push(
    '',
    `Effective team DPS (ETD) = damage + damage others gained from the member's buffs + ${SIM.ETD_W} x HP healed/shielded/mitigated for others (+ aggro soak).`,
  );
  out.push('', '### 4. Team value: one member swapped solo -> team branch (3 solo reference allies)');
  out.push(
    '',
    '| Path | Team ETD solo br. | Team ETD team br. | Ratio | Kill s solo/team |',
    '| --- | --- | --- | --- | --- |',
  );
  for (const p of PATHS) {
    const allies = (['the', 'dan_phu', 'dao', 'kiem'] as PathId[])
      .filter((x) => x !== p)
      .slice(0, 3)
      .map(solo);
    const a = summariseBoss([solo(p), ...allies]);
    const b = summariseBoss([team(p), ...allies]);
    out.push(
      `| ${p} | ${f(a.teamEtd, 0)} | ${f(b.teamEtd, 0)} | ${f(b.teamEtd / a.teamEtd)} | ${f(a.killTimeS, 0)} / ${f(b.killTimeS, 0)} |`,
    );
  }
  out.push('', '### 5. Static TTK matrix (hits, c = 1, equal stage; band 23-51)', '');
  const m = staticTtkMatrix();
  out.push(`| atk \\ def | ${PATHS.join(' | ')} |`, `| --- | ${PATHS.map(() => '---').join(' | ')} |`);
  for (const a of PATHS) out.push(`| ${a} | ${PATHS.map((d) => m[a][d]).join(' | ')} |`);
  return out.join('\n');
}
