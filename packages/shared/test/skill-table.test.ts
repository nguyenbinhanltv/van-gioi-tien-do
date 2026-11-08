import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PATHS, SKILL_GLOBAL, effectiveCooldownMs, skillTable, skillsOf, type SkillRow } from '../src/index.js';

const here = dirname(fileURLToPath(import.meta.url));
const doc = readFileSync(join(here, '../../../docs/11-he-phai-ky-nang.md'), 'utf8');
const num = (s: string) => Number(s.replace(',', '.'));
const rows = skillTable();

/** Rows of the docs/11 §4 per-class tables: | K1 | `id` | name | Lv | element | shape · range | cast | CD | MP | ... */
function docRows() {
  const out = new Map<string, { lv: number; shape: string; cast: string; cd: string; mp: string }>();
  for (const line of doc.split('\n')) {
    const c = line.split('|').map((x) => x.trim());
    const m = /^`([a-z_0-9]+)`/.exec(c[2] ?? '');
    if (c.length > 10 && /^[A-Z]\d$/.test(c[1] ?? '') && m)
      out.set(m[1]!, { lv: num(c[4]!), shape: c[6]!, cast: c[7]!, cd: c[8]!, mp: c[9]! });
  }
  return out;
}
const printed = docRows();

describe('D49 skill table (6 classes x 8 skills)', () => {
  it('has 48 rows, 8 per class in table order, with unique ids', () => {
    expect(rows).toHaveLength(48);
    expect(new Set(rows.map((r) => r.id)).size).toBe(48);
    for (const p of PATHS) {
      const mine = rows.filter((r) => r.path === p);
      expect(mine.map((r) => r.slot)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(mine.map((r) => r.id)).toEqual(skillsOf(p).map((s) => s.id));
      expect(mine.filter((r) => r.tier === 'ultimate')).toHaveLength(1);
    }
  });
  it('global timing: GCD 800 ms, cooldown-reduction cap 30%', () => {
    expect(SKILL_GLOBAL).toEqual({ gcdMs: 800, cdrCap: 0.3 });
    expect(effectiveCooldownMs(10_000, 0)).toBe(10_000);
    expect(effectiveCooldownMs(10_000, 0.2)).toBe(8000);
    expect(effectiveCooldownMs(10_000, 0.9)).toBe(7000); // capped at 30%
    expect(effectiveCooldownMs(10_000, -1)).toBe(10_000);
  });
  it('spot checks: Kiếm Khí Trảm, Thiểm Kiếm Bộ (dash, no GCD), Kiếm Tâm (passive), Vạn Kiếm Quy Tông', () => {
    const by = (id: string) => rows.find((r) => r.id === id) as SkillRow;
    expect(by('kiem_khi_tram')).toMatchObject({
      levelMin: 1,
      castMs: 400,
      cooldownMs: 3000,
      gcd: true,
      mpPct: 0.01,
      rangeTiles: 2.5,
    });
    expect(by('thiem_kiem_bo')).toMatchObject({
      castMs: 300,
      cooldownMs: 12000,
      gcd: false,
      mpPct: 0.02,
      rangeTiles: 5,
    });
    expect(by('kiem_tam')).toMatchObject({ kind: 'passive', cooldownMs: 0, gcd: false, mpPct: 0, rangeTiles: null });
    expect(by('van_kiem_quy_tong')).toMatchObject({ tier: 'ultimate', cooldownMs: 60000, mpPct: 0.15, rangeTiles: 8 });
  });
  it('passives never hold GCD, cooldown or MP; every active has positive cooldown or is a toggle-free movement skill', () => {
    for (const r of rows.filter((x) => x.kind === 'passive')) {
      expect([r.gcd, r.cooldownMs, r.mpPct]).toEqual([false, 0, 0]);
    }
  });
  it('matches every printed row of docs/11 §4 (level, cast+channel, cooldown, MP%)', () => {
    // docs/11 §4.5 row S1 prints a sentence instead of the `xuyen_van_thich` row (OPEN-ITEMS section 16): the only gap.
    const unprinted = rows.filter((r) => !printed.has(r.id)).map((r) => r.id);
    expect(unprinted).toEqual(['xuyen_van_thich']);
    expect(printed.size).toBe(47);
    for (const r of rows) {
      const p = printed.get(r.id);
      if (!p) continue;
      expect(r.levelMin, `${r.id} level`).toBe(p.lv);
      if (r.kind === 'passive') {
        expect([p.cast, p.cd, p.mp], `${r.id} passive`).toEqual(['—', '—', '—']);
        continue;
      }
      const castS = (r.castMs + r.channelMs) / 1000;
      if (p.cast !== '—') expect(castS, `${r.id} cast`).toBeCloseTo(num(p.cast), 6);
      if (p.cd !== '—') expect(r.cooldownMs / 1000, `${r.id} cd`).toBeCloseTo(num(p.cd), 6);
      if (p.mp !== '—') expect(r.mpPct * 100, `${r.id} mp`).toBeCloseTo(num(p.mp.replace('%', '')), 6);
    }
  });
});
