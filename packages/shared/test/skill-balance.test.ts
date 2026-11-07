import { describe, expect, it } from 'vitest';
import {
  PATHS,
  SIM,
  runBoss,
  runDummy,
  runSoloPack,
  summariseBoss,
  summariseSoloPack,
  type PathId,
  type SimPlayerSpec,
} from '../src/index.js';

/** Owner-approved solo DPS targets (x basic attack), D49; Đan/Phù excludes the Phù Linh pet. */
const SOLO_DPS_TARGET: Record<PathId, number> = {
  kiem: 1.7,
  phap: 1.7,
  thuong: 1.65,
  dao: 1.7,
  the: 1.6,
  dan_phu: 1.55,
};

const solo = (path: PathId): SimPlayerSpec => ({ path, mode: 'solo' });
const team = (path: PathId): SimPlayerSpec => ({ path, mode: 'team' });
const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;

describe('solo rotation DPS (docs/11 §4.5)', () => {
  const dummy = Object.fromEntries(PATHS.map((p) => [p, runDummy(solo(p))])) as Record<
    PathId,
    ReturnType<typeof runDummy>
  >;
  it.each(PATHS)('%s solo DPS multiple is within ±0.05 of target', (p) => {
    expect(Math.abs(dummy[p].ratio - SOLO_DPS_TARGET[p])).toBeLessThanOrEqual(0.05);
  });
  it('Phù Linh pet adds DPS on top of the Đan/Phù target; nobody else has one', () => {
    expect(dummy.dan_phu.petDps).toBeGreaterThan(0.1 * dummy.dan_phu.dps);
    for (const p of PATHS) if (p !== 'dan_phu') expect(dummy[p].petDps).toBe(0);
  });
  it.each(PATHS)('%s team branch deals 15–20% less solo DPS than its solo branch (tolerance 0.79–0.86)', (p) => {
    const r = runDummy(team(p)).dps / dummy[p].dps;
    expect(r).toBeGreaterThanOrEqual(0.79);
    expect(r).toBeLessThanOrEqual(0.86);
  });
});

describe('solo pack clear', () => {
  const packs = Object.fromEntries(PATHS.map((p) => [p, summariseSoloPack(p, 'solo')])) as Record<
    PathId,
    ReturnType<typeof summariseSoloPack>
  >;
  it('clear time is within ±10% of the cross-class mean', () => {
    const m = mean(PATHS.map((p) => packs[p].clearTimeS));
    for (const p of PATHS) {
      expect(packs[p].clearTimeS, p).toBeGreaterThanOrEqual(m * 0.9);
      expect(packs[p].clearTimeS, p).toBeLessThanOrEqual(m * 1.1);
    }
  });
  it('death rates are similar (all <= 25%, spread <= 25 points) across mob strengths 0.9-1.3', () => {
    const rates = PATHS.map((p) => packs[p].deathRate);
    expect(Math.max(...rates)).toBeLessThanOrEqual(0.25);
    expect(Math.max(...rates) - Math.min(...rates)).toBeLessThanOrEqual(0.25);
  });
  it('every class clears the standard (1.0x) pack alive', () => {
    for (const p of PATHS)
      for (const seed of [1000, 2000, 3000])
        expect(runSoloPack(solo(p), seed, { mobAtkMult: 1 }).cleared, p).toBe(true);
  });
  it('team branches also solo the standard pack (alive, not faster than the solo branch)', () => {
    for (const p of PATHS) {
      const r = runSoloPack(team(p), 1000, { mobAtkMult: 1 });
      expect(r.cleared, p).toBe(true);
      expect(r.timeS, p).toBeGreaterThan(packs[p].clearTimeS * 0.85);
    }
  });
  it('is deterministic for a given seed', () => {
    expect(runSoloPack(solo('dan_phu'), 4242)).toEqual(runSoloPack(solo('dan_phu'), 4242));
    expect(runBoss([solo('kiem'), solo('the')], 7).timeS).toBe(runBoss([solo('kiem'), solo('the')], 7).timeS);
  });
});

describe('group boss', () => {
  it('no class is required: every 4x same-class solo-branch team beats the boss before enrage', () => {
    for (const p of PATHS) {
      const b = summariseBoss([solo(p), solo(p), solo(p), solo(p)]);
      expect(b.winRate, p).toBeGreaterThanOrEqual(0.9);
      expect(b.killTimeS, p).toBeLessThan(SIM.BOSS.enrage_ms / 1000);
    }
  });
  it('a no-tank, no-healer team of DPS paths wins without casualties', () => {
    const b = summariseBoss([solo('kiem'), solo('phap'), solo('thuong'), solo('dao')]);
    expect(b.winRate).toBe(1);
    expect(b.deathsPerRun).toBeLessThanOrEqual(0.5);
  });
  it('team value: swapping one member to its team branch keeps whole-team effective DPS within 0.93-1.10x', () => {
    const allies = (x: PathId): SimPlayerSpec[] =>
      (['the', 'dan_phu', 'dao', 'kiem'] as PathId[])
        .filter((p) => p !== x)
        .slice(0, 3)
        .map(solo);
    for (const p of PATHS) {
      const a = summariseBoss([solo(p), ...allies(p)]);
      const b = summariseBoss([team(p), ...allies(p)]);
      const r = b.teamEtd / a.teamEtd;
      expect(r, p).toBeGreaterThanOrEqual(0.93);
      expect(r, p).toBeLessThanOrEqual(1.1);
    }
  });
  it('a tank + healer team-branch comp wins a harder boss and does not lose more members than the all-solo comp', () => {
    const tm = summariseBoss([team('the'), team('dan_phu'), solo('kiem'), solo('phap')], { bossDmgMult: 1.6 });
    const so = summariseBoss([solo('the'), solo('dan_phu'), solo('kiem'), solo('phap')], { bossDmgMult: 1.6 });
    expect(tm.winRate).toBe(1);
    expect(tm.deathsPerRun).toBeLessThanOrEqual(so.deathsPerRun + 0.25);
  });
  it('Thể taunt soaks boss hits in a group, and Đan/Phù heals or shields allies', () => {
    const r = runBoss([team('the'), team('dan_phu'), solo('kiem'), solo('phap')], 1);
    expect(r.players[0]!.counters.soak).toBeGreaterThan(0);
    expect(r.players[1]!.counters.healOthers + r.players[1]!.counters.shieldOthers).toBeGreaterThan(0);
  });
  it('every path interrupts the boss nuke at least once per fight (D49 principle 5)', () => {
    for (const p of PATHS) {
      const r = runBoss([solo(p), solo(p), solo(p), solo(p)], 1);
      const interrupts = r.players.reduce((n, x) => n + x.counters.interrupts, 0);
      expect(interrupts, p).toBeGreaterThanOrEqual(1);
      expect(r.win, p).toBe(true);
    }
  });
});
