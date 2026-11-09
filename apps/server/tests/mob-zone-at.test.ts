import { describe, expect, it } from 'vitest';
import { mobZoneAt } from '@vgtd/shared';
import { defaultMobZones } from '../src/world/mobs/index.js';

// The client dresses mob zones (PART 2 Gemini props) with mobZoneAt; it must agree with where the server spawns each zone.
describe('mobZoneAt vs defaultMobZones', () => {
  for (const n of [64, 96, 128, 256, 512]) {
    it('agrees on every tile of a ' + n + ' x ' + n + ' map', () => {
      const zones = defaultMobZones(n);
      const step = n >= 256 ? 3 : 1;
      for (let j = 0; j < n; j += step)
        for (let i = 0; i < n; i += step) {
          const z = zones.find((r) => i >= r.i0 && i < r.i1 && j >= r.j0 && j < r.j1);
          expect(mobZoneAt(i, j, n), i + ',' + j).toBe(z ? z.zone : null);
        }
    });
  }
});
