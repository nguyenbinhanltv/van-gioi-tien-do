/**
 * Content audit (D114): the docs/10 §4 roster ("8 thường x 2 biến thể + 4 tinh anh + 2 boss") against what the code ships: mob defs
 * (`@vgtd/shared` `MOB_DEFS`), attack sets and phases (`mobAttacksOf`, `mobPhasesOf`), the zone spawn tables and what the real
 * `MobManager` spawns. The roster is PARSED from the markdown, so a change of the doc table without the data (or the reverse) fails here.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  MOB_COUNT_NORMAL,
  MOB_DEFS,
  MOB_PACK_NORMAL,
  ZONE_SPAWN_TABLES,
  mobAttacksOf,
  mobDefByKey,
  mobPhasesOf,
  type ElementId,
  type MobDef,
  type MobTier,
  type MobZoneId,
} from '@vgtd/shared';
import { TileGrid } from '@vgtd/sim';
import { MobManager, defaultMobZones } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, '../../../docs/10-mvp-scope.md'), 'utf8');

const ZONE_BY_NAME: Record<string, MobZoneId> = {
  'Bìa rừng': 'bia_rung',
  'Đầm lầy độc': 'dam_lay_doc',
  'Cổ thụ trung tâm': 'co_thu_trung_tam',
  'Độc Hỏa Đàm': 'doc_hoa_dam',
};
const ELEMENT: Record<string, ElementId> = { Kim: 'kim', Mộc: 'moc', Thủy: 'thuy', Hỏa: 'hoa', Thổ: 'tho' };
const TIER: Record<string, MobTier> = { Thường: 'normal', 'Tinh anh': 'elite', Boss: 'boss' };

interface DocRow {
  zone: MobZoneId;
  key: string;
  tier: MobTier;
  elements: ElementId[];
  levelMin: number;
  levelMax: number;
  footprint: number;
  skillsText: string;
}

/** Rows of the §4 roster table (between the "## 4." heading and the "Tổng:" line). */
function docRoster(): DocRow[] {
  const start = doc.indexOf('## 4. Quái, tinh anh, boss');
  const end = doc.indexOf('Tổng: **8 thường', start);
  expect(start).toBeGreaterThan(0);
  expect(end).toBeGreaterThan(start);
  const rows: DocRow[] = [];
  for (const line of doc.slice(start, end).split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    const key = /`((?:mob|elite|boss)_[a-z_]+)`/.exec(c[2] ?? '')?.[1];
    if (!key) continue;
    const zone = ZONE_BY_NAME[c[1]!];
    const tier = TIER[c[4]!.replace(/\*/g, '')];
    const elements = c[5]!.split('/').map((e) => ELEMENT[e.trim()]!);
    const [lo, hi] = c[6]!.split('–').map((x) => Number(x));
    const footprint = Number(/(\d)\s*×/.exec(c[7]!.replace(/\*/g, ''))![1]);
    if (!zone || !tier || elements.some((e) => !e)) throw new Error(`cannot parse roster row: ${line}`);
    rows.push({ zone, key, tier, elements, levelMin: lo!, levelMax: hi!, footprint, skillsText: c[8]! });
  }
  return rows;
}

const roster = docRoster();

describe('the docs/10 §4 roster is what MOB_DEFS ships', () => {
  it('has 8 normal + 4 elite + 2 boss = 14 defs, in the same order, with stable 1-based wire ids', () => {
    expect(roster).toHaveLength(14);
    const count = (t: MobTier) => roster.filter((r) => r.tier === t).length;
    expect([count('normal'), count('elite'), count('boss')]).toEqual([8, 4, 2]);
    expect(MOB_DEFS.map((d) => d.key)).toEqual(roster.map((r) => r.key));
    expect(MOB_DEFS.map((d) => d.id)).toEqual(Array.from({ length: 14 }, (_, k) => k + 1));
  });

  it.each(roster.map((r) => [r.key, r] as const))(
    '%s: zone, tier, elements, level band and footprint match the doc',
    (_k, r) => {
      const d = mobDefByKey(r.key)!;
      expect(d, 'def exists').toBeDefined();
      expect({
        zone: d.zone,
        tier: d.tier,
        elements: [...d.elements],
        levelMin: d.levelMin,
        levelMax: d.levelMax,
        footprint: d.footprint,
      }).toEqual({
        zone: r.zone,
        tier: r.tier,
        elements: r.elements,
        levelMin: r.levelMin,
        levelMax: r.levelMax,
        footprint: r.footprint,
      });
    },
  );

  it.each(roster.map((r) => [r.key, r] as const))(
    '%s: the special skills and phases of the doc exist (count, telegraph time)',
    (_k, r) => {
      const d = mobDefByKey(r.key)!;
      const skills = mobAttacksOf(d).filter((a) => a.kind === 'skill');
      const text = r.skillsText.replace(/\*/g, '');
      if (r.tier === 'boss') {
        const m = /(\d) skill, (\d) phase|(\d) kỹ năng|(\d) skill/.exec(text);
        const nSkills = Number(/(\d) skill/.exec(text)![1]);
        const nPhases = Number(/(\d) phase/.exec(text)![1]);
        expect(m).not.toBeNull();
        expect(skills).toHaveLength(nSkills);
        expect(mobPhasesOf(d)).toHaveLength(nPhases);
      } else {
        expect(mobPhasesOf(d)).toHaveLength(1);
        const expected = text.startsWith('—') ? 0 : text.replace(/\([^)]*\)/g, '').split(/\s\+\s|;/).length;
        expect(skills, text).toHaveLength(expected);
        // a normal mob's single skill carries the telegraph time the doc names ("800 ms", "1.000 ms")
        const ms = /(\d[\d.]*) ms/.exec(text);
        if (r.tier === 'normal' && ms) expect(skills[0]!.telegraphMs).toBe(Number(ms[1]!.replace('.', '')));
      }
    },
  );

  it('every skill is telegraphed (docs/10 §4 / 11 §3.5)', () => {
    for (const d of MOB_DEFS)
      for (const a of mobAttacksOf(d)) expect(a.telegraphMs, `${d.key} ${a.id}`).toBeGreaterThan(0);
  });
});

describe('level bands per zone (docs/10 §3.1)', () => {
  const band: Record<MobZoneId, [number, number]> = {
    bia_rung: [5, 30],
    dam_lay_doc: [20, 50],
    co_thu_trung_tam: [40, 70],
    doc_hoa_dam: [50, 70],
  };
  it('the doc table gives these bands', () => {
    for (const [name, zone] of Object.entries(ZONE_BY_NAME)) {
      const line = doc.split('\n').find((l) => l.includes(`**${name}**`) && l.includes('Rừng Độc'))!;
      const [lo, hi] = line.split('|')[2]!.trim().split('–').map(Number);
      expect([lo, hi], name).toEqual(band[zone]);
    }
  });
  it('every def of a zone sits inside the zone band, and the defs together cover the band from its floor to its cap', () => {
    for (const [zone, [lo, hi]] of Object.entries(band) as Array<[MobZoneId, [number, number]]>) {
      const defs = MOB_DEFS.filter((d) => d.zone === zone);
      for (const d of defs) {
        expect(d.levelMin, d.key).toBeGreaterThanOrEqual(lo);
        expect(d.levelMax, d.key).toBeLessThanOrEqual(hi);
      }
      expect(Math.min(...defs.map((d) => d.levelMin)), zone).toBe(lo);
      expect(Math.max(...defs.map((d) => d.levelMax)), zone).toBe(hi);
    }
  });
});

describe('zone spawn tables', () => {
  it('one table per zone with exactly the defs of the doc for that zone and the tier counts (normal packs of 3, elite 2, boss 1)', () => {
    expect(ZONE_SPAWN_TABLES.map((t) => t.zone)).toEqual([
      'bia_rung',
      'dam_lay_doc',
      'co_thu_trung_tam',
      'doc_hoa_dam',
    ]);
    for (const t of ZONE_SPAWN_TABLES) {
      expect(t.groups.map((g) => g.def)).toEqual(roster.filter((r) => r.zone === t.zone).map((r) => r.key));
      for (const g of t.groups) {
        const d = mobDefByKey(g.def) as MobDef;
        expect(g.count, g.def).toBe(d.tier === 'normal' ? MOB_COUNT_NORMAL : d.tier === 'elite' ? 2 : 1);
        expect(g.pack, g.def).toBe(d.tier === 'normal' ? MOB_PACK_NORMAL : 1);
      }
    }
    // the per-zone mix of docs/10 §3.1: 3+1 / 2+1 / 2+1+boss / 1+1+boss
    const mix = (z: MobZoneId) =>
      (['normal', 'elite', 'boss'] as const).map((t) => MOB_DEFS.filter((d) => d.zone === z && d.tier === t).length);
    expect(mix('bia_rung')).toEqual([3, 1, 0]);
    expect(mix('dam_lay_doc')).toEqual([2, 1, 0]);
    expect(mix('co_thu_trung_tam')).toEqual([2, 1, 1]);
    expect(mix('doc_hoa_dam')).toEqual([1, 1, 1]);
  });
});

describe('elemental variants (docs/10 "8 loại x 2 biến thể", D114)', () => {
  const N = 256;
  const grid = TileGrid.fromRows(Array.from({ length: N }, () => '.'.repeat(N)));
  const m = new MobManager({ seed: 5, zones: defaultMobZones(N), grid });
  const infos = Array.from({ length: m.size }, (_, k) => m.info(1_000_000 + k)!);

  it('spawns every normal mob in BOTH of its elements, half and half (16 normal variants), and elites / bosses in their single element', () => {
    for (const d of MOB_DEFS.filter((x) => x.tier === 'normal')) {
      const mine = infos.filter((i) => i.def.key === d.key);
      expect(mine, d.key).toHaveLength(MOB_COUNT_NORMAL);
      const a = mine.filter((i) => i.element === d.elements[0]).length;
      const b = mine.filter((i) => i.element === d.elements[1]).length;
      expect([a, b], d.key).toEqual([MOB_COUNT_NORMAL / 2, MOB_COUNT_NORMAL / 2]);
      for (const i of mine) expect(i.variant).toBe(i.element === d.elements[0] ? 0 : 1);
    }
    for (const i of infos.filter((x) => x.def.tier !== 'normal')) {
      expect(i.variant).toBe(0);
      expect(i.element).toBe(i.def.elements[0]);
    }
  });

  it('a whole pack shares one element (the variant alternates pack by pack), and combat reads the variant element', () => {
    for (const d of MOB_DEFS.filter((x) => x.tier === 'normal')) {
      const mine = infos.filter((i) => i.def.key === d.key).sort((x, y) => x.slot - y.slot);
      for (let k = 0; k < mine.length; k += MOB_PACK_NORMAL) {
        const pack = mine.slice(k, k + MOB_PACK_NORMAL);
        expect(new Set(pack.map((p) => p.element)).size, `${d.key} pack ${k / MOB_PACK_NORMAL}`).toBe(1);
      }
    }
    for (const i of infos) expect(m.combatStats(i.id)!.element).toBe(i.element);
  });

  it('is deterministic and draws no extra randomness: positions and levels equal a manager built again', () => {
    const again = new MobManager({ seed: 5, zones: defaultMobZones(N), grid });
    expect(again.stateHash()).toBe(m.stateHash());
  });
});
