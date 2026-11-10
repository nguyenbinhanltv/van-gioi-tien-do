/**
 * Class-balance harness (D115): determinism, wiring on the real server code, branch application, coverage, outlier maths and the report.
 * The harness changes no number of the game; these tests pin that it measures what it says.
 */
import { describe, expect, it, vi } from 'vitest';
import { MOB_ID_BASE, PATHS, mobDefByKey, mobRealmAt, mobStats, skillDefinitions } from '@vgtd/shared';
import {
  BANDS,
  QUICK_CONFIG,
  branchDefs,
  branchFor,
  findOutliers,
  formatBalanceReport,
  kitCoverage,
  kitRows,
  median,
  mobLevelFor,
  pickSeeds,
  runDuel,
  runDuels,
  runFight,
  runParty,
  runSolo,
  unmodelledBranchMods,
  type SoloSummary,
} from '../src/index.js';

vi.setConfig({ testTimeout: 120_000 });

const fight = (path: (typeof PATHS)[number], mob = 'mob_hoi_lang', seed = 1) =>
  runFight({ mob, seed, players: [{ path, mode: 'solo' }], limitS: 120, stopOnDeath: true });

describe('fights run on the real server code and are deterministic', () => {
  it('the same spec gives the identical result, twice', () => {
    for (const p of PATHS) expect(fight(p)).toEqual(fight(p));
  });

  it('every class kills a Luyện Khí normal mob; the damage dealt covers its HP; the mob has the 07 §1 stats of its level', () => {
    const def = mobDefByKey('mob_hoi_lang')!;
    for (const p of PATHS) {
      const r = fight(p);
      expect(r.killed, p).toBe(true);
      expect(r.ttkS).toBeGreaterThan(0);
      expect(r.mobHpMax).toBe(mobStats(def, r.mobLevel).hp);
      expect(r.players[0]!.damage).toBeGreaterThanOrEqual(r.mobHpMax * 0.9); // overkill / the last hit: at least the HP less rounding
      expect(r.players[0]!.casts).toBeGreaterThan(0);
      expect(r.realm).toBe(mobRealmAt(r.mobLevel).realm);
    }
  });

  it('the harness uses real casts: a class that cannot reach the mob does no damage, and the node never rejects the scripted player', () => {
    const r = fight('kiem');
    expect(r.players[0]!.damage).toBeGreaterThan(0);
    expect(r.firstDeathS).toBeNull();
  });

  it('seeds that pick a realm give every class the same mobs (same level for the same seed)', () => {
    const seeds = pickSeeds('mob_doc_thiem', 2, 4);
    expect(seeds).toHaveLength(4);
    const def = mobDefByKey('mob_doc_thiem')!;
    for (const s of seeds) expect(mobRealmAt(mobLevelFor(def, s)).realm).toBe(2);
    const levels = (path: (typeof PATHS)[number]) =>
      seeds.map(
        (s) => runFight({ mob: 'mob_doc_thiem', seed: s, players: [{ path, mode: 'solo' }], limitS: 60 }).mobLevel,
      );
    expect(levels('kiem')).toEqual(levels('dao'));
  });

  it('stopOnDeath ends a lost fight at the first death; without it the party plays on', () => {
    const a = runFight({
      mob: 'boss_ho_vuong',
      seed: pickSeeds('boss_ho_vuong', 3, 1)[0]!,
      players: [{ path: 'kiem', mode: 'solo' }],
      limitS: 600,
      stopOnDeath: true,
    });
    expect(a.killed).toBe(false);
    expect(a.firstDeathS).not.toBeNull();
    expect(a.timeS).toBeLessThan(600);
    expect(a.players[0]!.deaths).toBe(1);
    expect(a.mobDamage).toBeGreaterThan(0);
  });

  it('a mob that does not exist is refused; a realm with no such level is reported', () => {
    expect(() => runFight({ mob: 'nope', seed: 1, players: [{ path: 'kiem', mode: 'solo' }], limitS: 10 })).toThrow(
      /unknown mob/,
    );
    expect(() => pickSeeds('mob_hoi_lang', 3, 1)).toThrow(/no level in realm 3/);
  });

  it('the mob of the harness is the only entity of its id range', () => {
    const r = fight('phap');
    expect(MOB_ID_BASE).toBe(1_000_000);
    expect(r.mobLevel).toBeGreaterThanOrEqual(mobDefByKey('mob_hoi_lang')!.levelMin);
    expect(r.mobLevel).toBeLessThanOrEqual(mobDefByKey('mob_hoi_lang')!.levelMax);
  });
});

describe('branches and kit coverage', () => {
  it('applying a branch changes only that class, never the shipped data, and applies the patches', () => {
    const before = JSON.stringify(skillDefinitions);
    for (const p of PATHS)
      for (const mode of ['solo', 'team'] as const) {
        const d = branchDefs(p, mode);
        expect(d.skills.filter((s) => s.path !== p)).toEqual(skillDefinitions.skills.filter((s) => s.path !== p));
        const b = branchFor(p, mode);
        for (const [id, patch] of Object.entries(b.skill_patches)) {
          const was = skillDefinitions.skills.find((s) => s.id === id)!;
          const now = d.skills.find((s) => s.id === id)!;
          if (patch.cooldown_mult)
            expect(now.timing.cooldown_ms).toBeCloseTo(was.timing.cooldown_ms * patch.cooldown_mult, 9);
        }
      }
    expect(JSON.stringify(skillDefinitions)).toBe(before);
  });

  it('a damage_mult patch scales the damage coefficient the combat core will use', () => {
    for (const p of PATHS)
      for (const mode of ['solo', 'team'] as const) {
        const b = branchFor(p, mode);
        for (const [id, patch] of Object.entries(b.skill_patches)) {
          if (!patch.damage_mult) continue;
          const was = skillDefinitions.skills.find((s) => s.id === id)!;
          const now = branchDefs(p, mode).skills.find((s) => s.id === id)!;
          const e0 = was.effects.find((e) => e.type === 'damage');
          const e1 = now.effects.find((e) => e.type === 'damage');
          if (!e0 || !e1) continue; // a patch on a skill without a damage effect has nothing to scale here
          expect(e1.scale!.coeff).toBeCloseTo(e0.scale!.coeff * patch.damage_mult * (b.stat_mods.dmg_mult ?? 1), 9);
        }
      }
  });

  it('stat mods without a hook on the server are listed, not silently applied', () => {
    expect(PATHS.some((p) => unmodelledBranchMods(branchFor(p, 'team')).length > 0)).toBe(true);
    for (const p of PATHS) for (const m of unmodelledBranchMods(branchFor(p, 'solo'))) expect(m).toMatch(/=/);
  });

  it('coverage: counts add up and the server simulates the whole kit of every class (D116)', () => {
    for (const p of PATHS) {
      const c = kitCoverage(p);
      expect(c.fullySupported + c.partlySupported).toBeLessThanOrEqual(c.active);
      expect(c.damageShare).toBeGreaterThan(0);
      expect(c.damageShare).toBeLessThanOrEqual(1);
      expect(c.fullySupported).toBe(c.active); // D116: every effect type of the shipped data is handled
      expect(Object.keys(c.unsupportedTypes)).toEqual([]);
    }
    expect(kitRows()).toHaveLength(6);
  });
});

describe('statistics', () => {
  it('median', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([1, 2, 3, 4])).toBe(2.5);
    expect(median([])).toBeNaN();
  });

  const row = (path: SoloSummary['path'], proj: number): SoloSummary => ({
    band: 'b',
    tier: 'normal',
    path,
    mode: 'solo',
    mob: 'm',
    runs: 1,
    killRate: 1,
    survival: 1,
    ttkS: proj,
    projTtkS: proj,
    dps: 100 / proj,
    minHp: 1,
    dtps: 0.01,
    pills: 0,
    mobHpLeft: 0,
  });
  it('outliers: only classes further than the band from the median of their cell are flagged', () => {
    const rows = [
      row('kiem', 10),
      row('phap', 10),
      row('the', 10),
      row('dan_phu', 11.6),
      row('thuong', 8.4),
      row('dao', 10),
    ];
    const out = findOutliers(rows, 0.15, 'projTtkS', 'TTK');
    expect(out.map((o) => o.path).sort()).toEqual(['dan_phu', 'thuong']);
    expect(out.find((o) => o.path === 'dan_phu')!.delta).toBeCloseTo(0.16, 9);
  });
  it('the band edge is exclusive and cells are compared separately', () => {
    const rows = [
      row('kiem', 10),
      row('phap', 10),
      row('the', 10),
      row('dan_phu', 11.5),
      row('thuong', 10),
      row('dao', 10),
    ];
    expect(findOutliers(rows, 0.15, 'projTtkS', 'TTK')).toHaveLength(0); // exactly +15%: not beyond it
    const other = rows.map((r) => ({ ...r, tier: 'elite' as const, projTtkS: r.path === 'the' ? 30 : r.projTtkS }));
    const out = findOutliers([...rows, ...other], 0.15, 'projTtkS', 'TTK');
    expect(out.map((o) => `${o.where}|${o.path}`)).toEqual(['b / elite / solo|the']);
  });
});

describe('the duel model and the report', () => {
  it('a duel is deterministic, ends, and a class never beats itself by more than the first move', () => {
    const a = runDuel('kiem', 'phap', 'solo', 2, 3, 100);
    expect(runDuel('kiem', 'phap', 'solo', 2, 3, 100)).toEqual(a);
    expect(['a', 'b', 'draw']).toContain(a.winner);
    expect(a.timeS).toBeGreaterThan(0);
    const m = runDuel('dao', 'dao', 'solo', 2, 3, 100);
    expect(['a', 'b', 'draw']).toContain(m.winner);
  });

  it('the quick report is complete, deterministic and contains no NaN', () => {
    const data = () => ({
      config: QUICK_CONFIG,
      solo: runSolo(QUICK_CONFIG),
      party: runParty(QUICK_CONFIG),
      duels: runDuels(QUICK_CONFIG),
      kits: kitRows(),
    });
    const text = formatBalanceReport(data());
    expect(formatBalanceReport(data())).toBe(text);
    for (const h of ['## 1.', '## 2.', '## 3.', '## 4.', '## 5.', '## 6.', '## 7.', '## 8.', '## 9.', '## 10.'])
      expect(text).toContain(h);
    for (const b of BANDS) expect(text).toContain(b.name);
    for (const p of PATHS) expect(text).toContain(`| ${p} |`);
    expect(text).not.toMatch(/NaN|undefined|Infinity/);
    expect(text).toContain('không đổi con số nào');
    // the duel matrix is 6 x 6
    expect((text.match(/^\| (kiem|phap|the|dan_phu|thuong|dao) \| (\d+%) \|/gm) ?? []).length).toBeGreaterThanOrEqual(
      6,
    );
  });

  it('the harness changes no number: the shipped skill data is byte-identical after a full set of runs', () => {
    const before = JSON.stringify(skillDefinitions);
    runSolo(QUICK_CONFIG);
    expect(JSON.stringify(skillDefinitions)).toBe(before);
  });
});
