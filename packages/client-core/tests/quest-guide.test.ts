import { describe, expect, it } from 'vitest';
import { MOB_STARTER_BAND, QUEST_DEFS, QUEST_NPCS, QuestStatus, mobAreaHalfSize, mobDefByKey } from '@vgtd/shared';
import type { QuestStateMsg } from '@vgtd/protocol';
import { QuestModel, arrivalRadius, edgeArrow, guideDistance, guideTarget, npcPlate } from '../src/index.js';

const N = 256;
const state = (over: Record<string, { status: number; progress?: number[] }>): QuestStateMsg => ({
  type: 'quest_state',
  dailyResetIn: 1,
  weeklyResetIn: 1,
  quests: QUEST_DEFS.map((d) => ({
    id: d.id,
    status: over[d.id]?.status ?? QuestStatus.Locked,
    progress: over[d.id]?.progress ?? d.objectives.map(() => 0),
  })),
});
const spawn = { i: N / 2, j: N / 2 };
const docTho = mobDefByKey('mob_doc_tho')!;

describe('guideTarget', () => {
  it('points at the giver of an acceptable quest, the turn-in NPC of a ready one', () => {
    const m = new QuestModel();
    m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Available } }));
    const g = guideTarget(m, N, spawn, [])!;
    expect(g).toMatchObject({ kind: 'npc', npc: 'npc_truong_lao_dan', label: 'Trưởng Lão' });
    const tl = QUEST_NPCS.find((n) => n.key === 'npc_truong_lao_dan')!;
    expect(g.tile).toEqual({ i: N / 2 + tl.offset[0], j: N / 2 + tl.offset[1] });
    m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Ready, progress: [1] } }));
    expect(guideTarget(m, N, spawn, [])).toMatchObject({ kind: 'npc', npc: 'npc_su_huynh' });
  });

  it('kill objective: the nearest known mob of the target, else the middle of its zone near the start', () => {
    const m = new QuestModel();
    m.applyState(state({ q_c1_san_doc_tho: { status: QuestStatus.Active, progress: [1] } }));
    const far = { defId: docTho.id, i: 60, j: 60 };
    const near = { defId: docTho.id, i: 110, j: 112 };
    const other = { defId: mobDefByKey('mob_hoi_lang')!.id, i: 127, j: 127 };
    expect(guideTarget(m, N, spawn, [far, near, other])).toMatchObject({ kind: 'mob', tile: { i: 110, j: 112 } });
    const z = guideTarget(m, N, spawn, [other])!;
    expect(z.kind).toBe('zone');
    // the zone anchor is inside the starter band, i.e. a short walk from the spawn (north-west quadrant for Bia Rung)
    const d = Math.max(Math.abs(z.tile.i - spawn.i), Math.abs(z.tile.j - spawn.j));
    expect(d).toBeGreaterThanOrEqual(MOB_STARTER_BAND.minFrac * mobAreaHalfSize(N));
    expect(d).toBeLessThanOrEqual(MOB_STARTER_BAND.maxFrac * mobAreaHalfSize(N));
    expect(z.tile.i).toBeLessThan(spawn.i);
    expect(z.tile.j).toBeLessThan(spawn.j);
  });

  it('skips finished objectives and objectives without a place; null when nothing is tracked', () => {
    const m = new QuestModel();
    expect(guideTarget(m, N, spawn, [])).toBeNull();
    m.applyState(state({ q_c1_van_khi: { status: QuestStatus.Active, progress: [10] } })); // cultivate: nowhere to walk
    expect(guideTarget(m, N, spawn, [])).toBeNull();
    m.applyState(state({ q_c1_ra_chan_nui: { status: QuestStatus.Active } })); // reach bia_rung
    expect(guideTarget(m, N, spawn, [])).toMatchObject({ kind: 'zone', label: 'Bìa Rừng' });
  });

  it('arrival radius: inside server reach for an NPC', () => {
    expect(arrivalRadius({ kind: 'npc', tile: spawn, label: '', questId: '' })).toBeLessThan(4);
    expect(arrivalRadius({ kind: 'zone', tile: spawn, label: '', questId: '' })).toBeLessThan(4);
  });
});

describe('edgeArrow', () => {
  it('sits on the target when it is on screen and on the edge ring when it is not', () => {
    const on = edgeArrow(spawn, { i: spawn.i + 1, j: spawn.j }, 800, 600, 1);
    expect(on.onScreen).toBe(true);
    const off = edgeArrow(spawn, { i: spawn.i - 60, j: spawn.j - 60 }, 800, 600, 1);
    expect(off.onScreen).toBe(false);
    // straight up on screen (-i, -j) -> arrow at the top edge, pointing up
    expect(off.y).toBeLessThan(60);
    expect(Math.abs(off.x - 400)).toBeLessThan(1);
    expect(off.angle).toBeCloseTo(-Math.PI / 2, 5);
    const east = edgeArrow(spawn, { i: spawn.i + 80, j: spawn.j - 80 }, 800, 600, 1);
    expect(east.x).toBeGreaterThan(700);
  });
  it('distance is rounded tiles', () => {
    expect(guideDistance({ i: 0, j: 0 }, { i: 3, j: 4 })).toBe(5);
  });
});

describe('npc plate and feedback', () => {
  it('plate = name + role', () => {
    expect(npcPlate('npc_ve_binh')).toBe('Vệ Binh · Gác Cổng');
    expect(npcPlate('npc_tho_ren')).toBe('Thợ Rèn · Luyện Khí');
  });
  it('queues objective progress and quest completion for the floating text', () => {
    const m = new QuestModel();
    m.applyState(state({ q_c1_san_doc_tho: { status: QuestStatus.Active, progress: [1] } }));
    expect(m.drainFeedback()).toEqual([]);
    m.applyState(state({ q_c1_san_doc_tho: { status: QuestStatus.Active, progress: [2] } }));
    expect(m.drainFeedback()).toEqual([
      { questId: 'q_c1_san_doc_tho', line: 'Hạ Độc Thố 2/5', objectiveDone: false, questDone: false },
    ]);
    m.applyState(state({ q_c1_san_doc_tho: { status: QuestStatus.Ready, progress: [5] } }));
    expect(m.drainFeedback()[0]).toMatchObject({ objectiveDone: true });
    m.applyState(state({ q_c1_san_doc_tho: { status: QuestStatus.Completed, progress: [5] } }));
    expect(m.drainFeedback()[0]).toMatchObject({ questDone: true, line: 'Săn Độc Thố' });
    expect(m.drainFeedback()).toEqual([]);
  });
});
