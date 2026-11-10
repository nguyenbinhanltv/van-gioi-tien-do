import { PATHS, classStatsAt } from '@vgtd/shared';
import { describe, expect, it } from 'vitest';
import { makeProfile } from '../src/world/combat/profile.js';

describe('makeProfile applies the class stat_weights (D117)', () => {
  it('every class profile carries its own weighted stats at every realm', () => {
    for (const path of PATHS)
      for (const [r, k] of [
        [1, 1],
        [3, 4],
        [5, 4],
      ] as const)
        expect(makeProfile(path, r, k).stats).toEqual(classStatsAt(path, r, k));
  });

  it('HP / MP / ATK / DEF differ between classes of the same realm', () => {
    const at = (p: (typeof PATHS)[number]) => makeProfile(p, 4, 3).stats;
    const hps = new Set(PATHS.map((p) => at(p).hp));
    const atks = new Set(PATHS.map((p) => at(p).atk));
    expect(hps.size).toBeGreaterThan(1);
    expect(atks.size).toBeGreaterThan(1);
    expect(at('the').hp).toBeGreaterThan(at('phap').hp);
    expect(at('the').def).toBeGreaterThan(at('phap').def);
  });

  it('is deterministic', () => {
    expect(makeProfile('dao', 3, 2)).toEqual(makeProfile('dao', 3, 2));
  });
});
