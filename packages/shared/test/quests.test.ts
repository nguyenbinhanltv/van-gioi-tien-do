import { describe, expect, it } from 'vitest';
import {
  DROP_TABLE,
  QUESTS,
  QUEST_DEFS,
  QUEST_NPCS,
  chapterCultBudgetMinutes,
  cultMinutesToTuVi,
  itemDefByKey,
  killMatches,
  mobDefByKey,
  objectiveTarget,
  questDayEpoch,
  questDefById,
  questNpc,
  questResetIn,
  questWeekEpoch,
  realm1ReqMinutes,
  realmReqMinutes,
  stoneWildHoursToStones,
  type DropItem,
  type QuestDef,
} from '../src/index.js';

const HOUR = 3_600_000;
/** 2026-11-09 is a Monday. Vietnam time = UTC + 7. */
const vn = (iso: string): number => Date.parse(`${iso}+07:00`);

describe('reset clock (docs/12 §2.1: 05:00 UTC+7, week on Monday 05:00)', () => {
  it('the day changes at 05:00 Vietnam time and not at midnight', () => {
    const before = vn('2026-11-10T04:59:59');
    const after = vn('2026-11-10T05:00:00');
    expect(questDayEpoch(after)).toBe(questDayEpoch(before) + 1);
    expect(questDayEpoch(vn('2026-11-10T00:00:00'))).toBe(questDayEpoch(vn('2026-11-09T23:00:00')));
    expect(questDayEpoch(vn('2026-11-10T23:59:59'))).toBe(questDayEpoch(after));
  });
  it('the week changes on Monday 05:00 only', () => {
    const monBefore = vn('2026-11-09T04:59:59');
    const monAfter = vn('2026-11-09T05:00:00');
    expect(questWeekEpoch(monAfter)).toBe(questWeekEpoch(monBefore) + 1);
    // the whole Monday 05:00 .. next Monday 04:59 is one week
    expect(questWeekEpoch(vn('2026-11-15T23:59:59'))).toBe(questWeekEpoch(monAfter));
    expect(questWeekEpoch(vn('2026-11-16T04:59:59'))).toBe(questWeekEpoch(monAfter));
    expect(questWeekEpoch(vn('2026-11-16T05:00:00'))).toBe(questWeekEpoch(monAfter) + 1);
  });
  it('countdowns point at the next reset', () => {
    expect(questResetIn(vn('2026-11-09T04:00:00')).daily).toBe(3600);
    expect(questResetIn(vn('2026-11-09T05:00:00')).daily).toBe(24 * 3600);
    expect(questResetIn(vn('2026-11-09T05:00:00')).weekly).toBe(7 * 24 * 3600);
    expect(questResetIn(vn('2026-11-15T05:00:00')).weekly).toBe(24 * 3600);
    expect(questResetIn(vn('2026-11-16T04:00:00')).weekly).toBe(3600);
  });
  it('is a pure function of the instant (no local timezone leaks in)', () => {
    const t = Date.UTC(2026, 10, 9, 21, 59, 59); // 04:59:59 VN
    expect(questDayEpoch(t + 1000)).toBe(questDayEpoch(t) + 1);
    expect(questDayEpoch(t + HOUR * 24)).toBe(questDayEpoch(t) + 1);
  });
});

describe('content table', () => {
  const ids = new Set(QUEST_DEFS.map((q) => q.id));
  it('has unique ids, text, valid npc and chain references', () => {
    expect(ids.size).toBe(QUEST_DEFS.length);
    expect(QUEST_DEFS.length).toBeLessThanOrEqual(QUESTS.MAX_ENTRIES);
    for (const q of QUEST_DEFS) {
      expect(q.id).toMatch(/^q_[a-z0-9_]+$/);
      expect(questNpc(q.giver), q.id).toBeDefined();
      expect(questNpc(q.turnIn), q.id).toBeDefined();
      expect(q.objectives.length).toBeGreaterThan(0);
      expect(q.objectives.length).toBeLessThanOrEqual(QUESTS.MAX_OBJECTIVES);
      for (const a of q.after ?? []) expect(ids.has(a), `${q.id} after ${a}`).toBe(true);
      if (q.maxRealm !== undefined) expect(q.maxRealm).toBeGreaterThanOrEqual(q.minRealm ?? 1);
    }
  });
  it('the prerequisite graph has no cycle', () => {
    const state = new Map<string, 1 | 2>();
    const visit = (id: string): void => {
      if (state.get(id) === 2) return;
      expect(state.get(id), `cycle through ${id}`).toBeUndefined();
      state.set(id, 1);
      for (const a of questDefById(id)!.after ?? []) visit(a);
      state.set(id, 2);
    };
    for (const q of QUEST_DEFS) visit(q.id);
  });
  it('objectives only name things that exist', () => {
    const zones = ['bia_rung', 'dam_lay_doc', 'co_thu_trung_tam', 'doc_hoa_dam'];
    for (const q of QUEST_DEFS)
      for (const o of q.objectives) {
        if (o.kind === 'kill')
          expect(
            o.target.startsWith('tier:')
              ? ['normal', 'elite', 'boss'].includes(o.target.slice(5))
              : !!mobDefByKey(o.target),
            q.id,
          ).toBe(true);
        if (o.kind === 'collect')
          expect(itemDefByKey(o.item as DropItem) ?? DROP_TABLE.field[o.item as DropItem], q.id).toBeTruthy();
        if (o.kind === 'talk') expect(questNpc(o.npc), q.id).toBeDefined();
        if (o.kind === 'reach') expect(zones).toContain(o.zone);
        expect(objectiveTarget(o)).toBeGreaterThanOrEqual(1);
      }
  });
  it('reward items exist and no reward carries a price / currency field', () => {
    for (const q of QUEST_DEFS) {
      for (const it of q.rewards.items ?? []) expect(itemDefByKey(it.item as DropItem), q.id).toBeDefined();
      expect(
        Object.keys(q.rewards).every((k) => ['cultMinutes', 'stoneWildHours', 'contribution', 'items'].includes(k)),
      ).toBe(true);
    }
  });
  it('repeatable quests are daily / weekly / sect, one-off quests are main', () => {
    for (const q of QUEST_DEFS) {
      if (q.type === 'daily') expect(q.repeat).toBe('daily');
      if (q.type === 'weekly') expect(q.repeat).toBe('weekly');
      if (q.type === 'main') expect(q.repeat).toBe('none');
      if (q.type === 'sect') expect(q.sectRequired).toBe(true);
    }
  });
  it('NPC table: unique keys, all within a plaza', () => {
    expect(new Set(QUEST_NPCS.map((n) => n.key)).size).toBe(QUEST_NPCS.length);
    for (const n of QUEST_NPCS) expect(Math.max(Math.abs(n.offset[0]), Math.abs(n.offset[1]))).toBeLessThanOrEqual(8);
  });
});

describe('docs/12 §4.2 faucet budgets', () => {
  const sum = (qs: QuestDef[], f: (q: QuestDef) => number): number => qs.reduce((n, q) => n + f(q), 0);
  const of = (type: string, chapter?: number): QuestDef[] =>
    QUEST_DEFS.filter((q) => q.type === type && (chapter === undefined || q.chapter === chapter));
  it('chapter 1: tu vi <= 25 % of the realm Req and stones <= 1.0 wild hours', () => {
    const c1 = of('main', 1);
    expect(sum(c1, (q) => q.rewards.cultMinutes ?? 0)).toBeLessThanOrEqual(
      chapterCultBudgetMinutes(realm1ReqMinutes()),
    );
    expect(sum(c1, (q) => q.rewards.stoneWildHours ?? 0)).toBeLessThanOrEqual(1.0);
  });
  it('chapters 2 and 3: tu vi <= 25 % of the realm 2 Req (Trúc Cơ), and each has its Mở / Thân / Kết size', () => {
    for (const ch of [2, 3])
      expect(
        sum(of('main', ch), (q) => q.rewards.cultMinutes ?? 0),
        `chapter ${ch}`,
      ).toBeLessThanOrEqual(chapterCultBudgetMinutes(realmReqMinutes(2)));
    expect(of('main', 2)).toHaveLength(10);
    expect(of('main', 3)).toHaveLength(7);
    // one unbroken chain: every chapter 2-3 quest follows exactly the previous one
    const chain = QUEST_DEFS.filter((q) => q.type === 'main');
    chain.slice(1).forEach((q, i) => expect(q.after, q.id).toEqual([chain[i]!.id]));
  });
  it('every chapter stays within 1.0 stone hours', () => {
    for (const ch of [1, 2, 3])
      expect(sum(of('main', ch), (q) => q.rewards.stoneWildHours ?? 0)).toBeLessThanOrEqual(1.0);
  });
  it('daily: <= 20 tu vi minutes and <= 0.25 hours for the whole set', () => {
    expect(sum(of('daily'), (q) => q.rewards.cultMinutes ?? 0)).toBeLessThanOrEqual(20);
    expect(sum(of('daily'), (q) => q.rewards.stoneWildHours ?? 0)).toBeLessThanOrEqual(0.25);
    expect(of('daily').length).toBeLessThanOrEqual(QUESTS.MAX_PER_CYCLE.daily);
  });
  it('weekly: <= 60 tu vi minutes and <= 1.0 hours', () => {
    expect(sum(of('weekly'), (q) => q.rewards.cultMinutes ?? 0)).toBeLessThanOrEqual(60);
    expect(sum(of('weekly'), (q) => q.rewards.stoneWildHours ?? 0)).toBeLessThanOrEqual(1.0);
  });
  it('sect: daily part <= 10 minutes and <= 0.10 hours', () => {
    const d = QUEST_DEFS.filter((q) => q.type === 'sect' && q.repeat === 'daily');
    expect(sum(d, (q) => q.rewards.cultMinutes ?? 0)).toBeLessThanOrEqual(10);
    expect(sum(d, (q) => q.rewards.stoneWildHours ?? 0)).toBeLessThanOrEqual(0.1);
  });
  it('weekly faucet of an active player <= 15 % of 10 hours of hunting at realm 1 (docs/12 §4.2)', () => {
    const week =
      7 * sum(of('daily'), (q) => stoneWildHoursToStones(q.rewards.stoneWildHours ?? 0, 1)) +
      sum(of('weekly'), (q) => stoneWildHoursToStones(q.rewards.stoneWildHours ?? 0, 1)) +
      7 *
        sum(
          QUEST_DEFS.filter((q) => q.type === 'sect' && q.repeat === 'daily'),
          (q) => stoneWildHoursToStones(q.rewards.stoneWildHours ?? 0, 1),
        ) +
      sum(
        QUEST_DEFS.filter((q) => q.type === 'sect' && q.repeat === 'weekly'),
        (q) => stoneWildHoursToStones(q.rewards.stoneWildHours ?? 0, 1),
      );
    expect(week).toBeLessThanOrEqual(0.15 * 10 * QUESTS.STONES_PER_WILD_HOUR_R1);
  });
});

describe('reward units', () => {
  it('cult minutes = minutes x A_s with A_s = 100 x 1.25^(s-1)', () => {
    expect(cultMinutesToTuVi(4, 1)).toBe(400);
    expect(cultMinutesToTuVi(1, 2)).toBe(125);
    expect(cultMinutesToTuVi(0, 5)).toBe(0);
  });
  it('wild hours = n x 180 x 1.5^(r-1) stones', () => {
    expect(stoneWildHoursToStones(1, 1)).toBe(180);
    expect(stoneWildHoursToStones(0.25, 1)).toBe(45);
    expect(stoneWildHoursToStones(1, 2)).toBe(270);
    expect(stoneWildHoursToStones(0.05, 1)).toBe(9);
  });
  it('kill matching by key or tier', () => {
    expect(killMatches('mob_doc_tho', 'mob_doc_tho', 'normal')).toBe(true);
    expect(killMatches('mob_doc_tho', 'mob_hoi_lang', 'normal')).toBe(false);
    expect(killMatches('tier:elite', 'elite_lang_vuong', 'elite')).toBe(true);
    expect(killMatches('tier:boss', 'elite_lang_vuong', 'elite')).toBe(false);
  });
});
