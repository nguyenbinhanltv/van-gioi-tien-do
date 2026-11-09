import { describe, it, expect } from 'vitest';
import { REALM_NAMES } from '@vgtd/shared';
import manifest from '../../../tools/procgen/src/gemini/manifest.json';
import {
  CHAT_CHANNEL_ICON,
  HUD_ICON_IDS,
  ITEM_ICON_ALIASES,
  PARTICLES,
  PARTICLE_NAMES,
  REALM_BADGE_COUNT,
  STATUS_ICON_IDS,
  channelOfInput,
  itemIconKey,
  manualIconKey,
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
  it('HUD icon ids are exactly the manifest grid order (4 x 4), unique', () => {
    expect([...HUD_ICON_IDS]).toEqual(manifest.hud.ids);
    expect(HUD_ICON_IDS).toHaveLength(manifest.hud.cols * manifest.hud.rows);
    expect(new Set(HUD_ICON_IDS).size).toBe(HUD_ICON_IDS.length);
  });

  it('item icon grids: unique ids across icons and grids, filled grids', () => {
    const all = [...manifest.icons, ...manifest.itemGrids.flatMap((g) => g.ids)];
    expect(new Set(all).size).toBe(all.length);
    for (const g of manifest.itemGrids) expect(g.ids).toHaveLength(g.cols * g.rows);
    expect(manifest.itemGrids.flatMap((g) => g.ids)).toContain('cong_hien_token');
  });

  it('manual icons: 3 tiers x 3 forms exist in the manifest; the tier follows the level, the form the library position', () => {
    const ids = new Set(manifest.itemGrids.flatMap((g) => g.ids));
    for (const t of [1, 2, 3])
      for (const f of ['book', 'scroll', 'tablet']) expect(ids.has(`manual_t${t}_${f}`)).toBe(true);
    // the tome skills of the data sit at levels 20 / 31 / 40 / 51 / 65
    expect([20, 31, 40, 51, 65].map((lv, k) => manualIconKey(lv, k))).toEqual([
      'manual_t1_book',
      'manual_t1_scroll',
      'manual_t2_tablet',
      'manual_t2_book',
      'manual_t3_scroll',
    ]);
    for (let lv = 1; lv <= 70; lv++) for (let k = 0; k < 8; k++) expect(ids.has(manualIconKey(lv, k))).toBe(true);
    expect(manualIconKey(65, -1)).toBe('manual_t3_tablet'); // a negative index never throws or leaves the set
  });

  it('item aliases point at registered icons; an unknown key keeps its own name', () => {
    const ids = new Set([...manifest.icons, ...manifest.itemGrids.flatMap((g) => g.ids)]);
    for (const [item, icon] of Object.entries(ITEM_ICON_ALIASES))
      expect(ids.has(icon), `${item} -> ${icon}`).toBe(true);
    expect(itemIconKey('ho_mach_pill')).toBe('pill_green_mist');
    expect(itemIconKey('heal_pill')).toBe('heal_pill');
  });

  it('the chat channel icon follows what the typed line will use', () => {
    expect(channelOfInput('')).toBe('world');
    expect(channelOfInput('xin chao')).toBe('world');
    expect(channelOfInput('//literal slash')).toBe('world');
    expect(channelOfInput('/z ai do')).toBe('zone');
    expect(channelOfInput('  /w bob hi')).toBe('whisper');
    expect(channelOfInput('/r ok')).toBe('whisper');
    expect(channelOfInput('/p pull')).toBe('party');
    expect(channelOfInput('/nope')).toBe('world');
    for (const icon of Object.values(CHAT_CHANNEL_ICON)) expect(HUD_ICON_IDS).toContain(icon);
  });
});
