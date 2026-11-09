import { describe, it, expect } from 'vitest';
import { REALM_NAMES } from '@vgtd/shared';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import skills from '../../../packages/shared/src/data/skills.json';
import {
  EQUIP_ICON_IDS,
  FX_NAMES,
  MINIMAP_ICON_IDS,
  WORLD_MAP_REGIONS,
  worldMapPoint,
  worldMapRegionAt,
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

describe('Gemini art registries (PART 3)', () => {
  it('equipment, minimap and tribulation ids match the manifest', () => {
    expect([...EQUIP_ICON_IDS]).toEqual(manifest.equip.ids);
    expect(EQUIP_ICON_IDS).toHaveLength(manifest.equip.cols * manifest.equip.rows);
    expect([...MINIMAP_ICON_IDS]).toEqual(manifest.map.icons.ids);
    expect(MINIMAP_ICON_IDS).toHaveLength(manifest.map.icons.cols * manifest.map.icons.rows);
    expect([...FX_NAMES].sort()).toEqual(Object.keys(manifest.tribulation.fx).sort());
  });

  it('the six weapon types of skills.json each have an equipment icon', () => {
    const weapons = skills.classes.map((c: { weapon: string }) => c.weapon);
    for (const w of weapons) expect(EQUIP_ICON_IDS).toContain(w);
  });

  it('the world map places a player by region: every zone centre lands inside its painted region, the plaza in Son Mon', () => {
    const N = 256;
    const zones = [
      { id: 'bia_rung', i0: 8, i1: 120, j0: 8, j1: 120 },
      { id: 'dam_lay_doc', i0: 136, i1: 248, j0: 8, j1: 120 },
      { id: 'co_thu_trung_tam', i0: 8, i1: 120, j0: 136, j1: 248 },
      { id: 'doc_hoa_dam', i0: 136, i1: 248, j0: 136, j1: 248 },
    ];
    for (const z of zones) {
      const p = worldMapPoint((z.i0 + z.i1) / 2, (z.j0 + z.j1) / 2, N, zones);
      const r = WORLD_MAP_REGIONS[z.id as keyof typeof WORLD_MAP_REGIONS];
      expect(p.region).toBe(z.id);
      expect(p.x).toBeGreaterThan(r.x0);
      expect(p.x).toBeLessThan(r.x1);
      expect(p.y).toBeGreaterThan(r.y0);
      expect(p.y).toBeLessThan(r.y1);
    }
    expect(worldMapRegionAt(128, 128, N, zones)).toBe('son_mon');
    expect(worldMapRegionAt(2, 2, N, zones)).toBe('bia_rung'); // the margin belongs to the nearest zone
    const c = worldMapPoint(128, 128, N, zones);
    expect(c.x).toBeGreaterThan(WORLD_MAP_REGIONS.son_mon.x0);
    expect(c.x).toBeLessThan(WORLD_MAP_REGIONS.son_mon.x1);
    for (const r of Object.values(WORLD_MAP_REGIONS)) {
      expect(r.x0).toBeGreaterThanOrEqual(0);
      expect(r.x1).toBeLessThanOrEqual(1);
      expect(r.y0).toBeGreaterThanOrEqual(0);
      expect(r.y1).toBeLessThanOrEqual(1);
    }
  });
});
