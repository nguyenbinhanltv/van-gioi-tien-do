import { describe, it, expect } from 'vitest';
import { REALM_NAMES } from '@vgtd/shared';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import {
  PARTICLES,
  PARTICLE_NAMES,
  REALM_BADGE_COUNT,
  STATUS_ICON_IDS,
  particleSpec,
} from '../assets/scripts/ArtRegistry';

describe('Gemini art registries (PART 2)', () => {
  it('status icon ids are exactly the manifest grid order (4 x 3)', () => {
    expect([...STATUS_ICON_IDS]).toEqual(manifest.status.ids);
    expect(STATUS_ICON_IDS).toHaveLength(manifest.status.cols * manifest.status.rows);
  });

  it('there is one realm badge per realm, in REALM_NAMES order', () => {
    expect(REALM_BADGE_COUNT).toBe(REALM_NAMES.length);
    expect(manifest.realms.cols * manifest.realms.rows).toBe(REALM_BADGE_COUNT);
  });

  it('particle registry lists every exported particle once, each with a blend and a size', () => {
    expect([...PARTICLE_NAMES].sort()).toEqual([...manifest.particles.names].sort());
    expect(new Set(PARTICLE_NAMES).size).toBe(PARTICLE_NAMES.length);
    for (const p of PARTICLES) {
      expect(['additive', 'alpha']).toContain(p.blend);
      expect(p.size).toBeGreaterThan(0);
      expect(particleSpec(p.name)).toBe(p);
    }
    expect(particleSpec('p_nope')).toBeUndefined();
  });
});
