import { describe, expect, it } from 'vitest';
import { QUEST_DEFS, QUESTS, QuestStatus } from '@vgtd/shared';
import { QuestReason, type QuestStateMsg } from '@vgtd/protocol';
import { ChatLog, QUEST_DESC_KEY, QUEST_NAME_KEY, QUEST_REASON_KEY, questReasonText, QuestModel, questName, objectiveLine, parseChatInput, rewardLine } from '../src/index.js';

/** A state where every quest has `status` except the listed overrides. */
const state = (over: Record<string, { status: number; progress?: number[] }> = {}, base = QuestStatus.Locked): QuestStateMsg => ({
  type: 'quest_state',
  dailyResetIn: 3600,
  weeklyResetIn: 7200,
  quests: QUEST_DEFS.map((d) => ({
    id: d.id,
    status: over[d.id]?.status ?? base,
    progress: over[d.id]?.progress ?? d.objectives.map(() => 0),
  })),
});

describe('QuestModel', () => {
  it('is not ready until the first state; lists active / available / completed from the server picture', () => {
    const m = new QuestModel();
    expect(m.ready).toBe(false);
    expect(m.summaryLines()).toEqual(['Sổ nhiệm vụ chưa tải xong.']);
    m.applyState(
      state({
        q_c1_nhap_mon: { status: QuestStatus.Completed, progress: [1] },
        q_c1_van_khi: { status: QuestStatus.Active, progress: [90] },
        q_c1_ra_chan_nui: { status: QuestStatus.Available },
        q_daily_san_quai: { status: QuestStatus.Ready, progress: [8] },
      }),
    );
    expect(m.ready).toBe(true);
    expect(m.active().map((v) => v.id)).toEqual(['q_c1_van_khi', 'q_daily_san_quai']);
    expect(m.available().map((v) => v.id)).toEqual(['q_c1_ra_chan_nui']);
    expect(m.completedCount()).toBe(1);
    const vk = m.active()[0]!;
    expect(vk).toMatchObject({ name: 'Vận Khí Đầu Tiên', type: 'Chủ tuyến', status: QuestStatus.Active });
    expect(vk.lines).toEqual(['Đả tọa 1:30/3:00']);
    expect(m.summaryLines().join('\n')).toMatch(/Đang làm \(2\)/);
  });

  it('announces transitions (accepted, objectives done, completed) but not the first picture', () => {
    const m = new QuestModel();
    expect(m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Available } }))).toEqual([]);
    expect(m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Active, progress: [0] } }))).toEqual([
      'Đã nhận nhiệm vụ: Nhập Môn.',
    ]);
    expect(m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Ready, progress: [1] } }))).toEqual([
      'Đã đủ mục tiêu: Nhập Môn. Quay về gặp Sư Huynh.',
    ]);
    expect(m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Completed, progress: [1] } }))).toEqual([
      'Hoàn thành nhiệm vụ: Nhập Môn.',
    ]);
    // a progress change inside the same status says nothing
    expect(m.applyState(state({ q_c1_nhap_mon: { status: QuestStatus.Completed, progress: [1] } }))).toEqual([]);
  });

  it('markers: ? beats !, and only the right NPC shows one', () => {
    const m = new QuestModel();
    m.applyState(
      state({
        q_c1_van_khi: { status: QuestStatus.Available }, // giver su_huynh
        q_daily_tu_luyen: { status: QuestStatus.Available }, // giver su_huynh
        q_c1_nhap_mon: { status: QuestStatus.Ready, progress: [1] }, // turn in at su_huynh
        q_daily_san_quai: { status: QuestStatus.Available }, // ve_binh
      }),
    );
    expect(m.markerFor('npc_su_huynh')).toBe('?');
    expect(m.markerFor('npc_ve_binh')).toBe('!');
    expect(m.markerFor('npc_thuong_nhan')).toBeNull();
    expect(m.markerFor('npc_nobody')).toBeNull();
  });

  it('tracker: pinned first, then ready, then active; goTo points at the next NPC', () => {
    const m = new QuestModel();
    m.applyState(
      state({
        q_c1_nhap_mon: { status: QuestStatus.Active, progress: [0] },
        q_daily_san_quai: { status: QuestStatus.Ready, progress: [8] },
        q_daily_tu_luyen: { status: QuestStatus.Active, progress: [0] },
        q_weekly_tru_ma: { status: QuestStatus.Active, progress: [0] },
      }),
    );
    expect(m.tracker().map((v) => v.id)).toEqual(['q_daily_san_quai', 'q_c1_nhap_mon', 'q_daily_tu_luyen']);
    expect(m.tracker(1)).toHaveLength(1);
    m.pin('q_weekly_tru_ma');
    expect(m.tracker()[0]!.id).toBe('q_weekly_tru_ma');
    m.pin('q_weekly_tru_ma'); // toggles off
    expect(m.tracker()[0]!.id).toBe('q_daily_san_quai');
    const by = (id: string) => m.active().find((v) => v.id === id)!;
    expect(by('q_daily_san_quai')).toMatchObject({ goTo: 'npc_ve_binh', goToName: 'Vệ Binh' }); // ready: turn in
    expect(by('q_c1_nhap_mon')).toMatchObject({ goTo: 'npc_su_huynh' }); // talk objective not done yet
    expect(by('q_daily_tu_luyen').goTo).toBeNull(); // nothing to walk to
  });

  it('ignores quests this client has no text for (a newer server) and keeps counting down the reset', () => {
    const m = new QuestModel();
    const s = state();
    m.applyState({ ...s, quests: [...s.quests, { id: 'q_from_the_future', status: QuestStatus.Active, progress: [1] }] }, 1000);
    expect(m.active()).toEqual([]);
    expect(m.resetIn(1000)).toEqual({ daily: 3600, weekly: 7200 });
    expect(m.resetIn(62_000)).toEqual({ daily: 3539, weekly: 7139 });
    expect(m.resetIn(10_000_000)).toEqual({ daily: 0, weekly: 0 });
  });

  it('every refusal has Vietnamese text; done is silent', () => {
    const m = new QuestModel();
    expect(m.applyResult({ type: 'quest_result', clientMsgId: 1, reason: QuestReason.Ok })).toBeNull();
    for (const r of Object.values(QuestReason).filter((x): x is number => typeof x === 'number' && x > 0))
      expect(questReasonText(r), `reason ${r}`).toBeTruthy();
    expect(m.applyResult({ type: 'quest_result', clientMsgId: 1, reason: QuestReason.TooFar })).toBe('Bạn đứng quá xa NPC.');
    expect(m.applyResult({ type: 'quest_result', clientMsgId: 1, reason: 99 })).toMatch(/mã 99/);
  });

  it('nearestNpc: the closest one, and whether it is in reach', () => {
    const m = new QuestModel();
    const c = 128;
    expect(m.nearestNpc(null, 256)).toBeNull();
    expect(m.nearestNpc({ i: c - 5, j: c + 5 }, 256)).toMatchObject({ key: 'npc_su_huynh', name: 'Sư Huynh', inReach: true });
    const far = m.nearestNpc({ i: c + 40, j: c + 40 }, 256)!;
    expect(far.inReach).toBe(false);
    expect(far.dist).toBeGreaterThan(QUESTS.NPC_RANGE_TILES);
    expect(m.npcTile('npc_su_huynh', 256)).toEqual({ i: c - 5, j: c + 5 });
    expect(m.npcTile('nope', 256)).toBeNull();
  });

  it('objective and reward wording', () => {
    const o = QUEST_DEFS.find((d) => d.id === 'q_c1_san_doc_tho')!.objectives[0]!;
    expect(objectiveLine(o, 3)).toBe('Hạ Độc Thố 3/5');
    expect(objectiveLine(o, 99)).toBe('Hạ Độc Thố 5/5'); // never past the target
    expect(rewardLine(QUEST_DEFS.find((d) => d.id === 'q_c1_nhap_mon')!)).toBe('1 phút tu luyện · Hồi Huyết Đan ×2');
    expect(rewardLine(QUEST_DEFS.find((d) => d.id === 'q_sect_tuan_tra')!)).toMatch(/10 Cống hiến/);
    // no price / currency wording in any reward line
    for (const d of QUEST_DEFS) expect(rewardLine(d)).not.toMatch(/\$|USD|VND|mua|giá/i);
  });
});

describe('quest text is in the string table (D104)', () => {
  it('every quest has a name and a description key, every refusal reason has a key', () => {
    for (const d of QUEST_DEFS) {
      expect(QUEST_NAME_KEY[d.id], d.id).toBeTruthy();
      expect(QUEST_DESC_KEY[d.id], d.id).toBeTruthy();
      expect(questName(d.id)).not.toBe(d.id);
    }
    for (const r of Object.values(QuestReason).filter((x): x is number => typeof x === 'number'))
      expect(r in QUEST_REASON_KEY, `reason ${r}`).toBe(true);
  });
});

describe('/quest in the chat input', () => {
  it('parses /quest, /q, /nhiemvu and calls the panel hook', () => {
    for (const c of ['/quest', '/quests', '/q', '/nhiemvu']) expect(parseChatInput(c)).toEqual({ kind: 'quests' });
    let shown = 0;
    const l = new ChatLog({ myName: () => 'me', onQuests: () => shown++ });
    const never = () => false;
    expect(l.submit('/quest', never)).toBe(false);
    expect(shown).toBe(1);
  });
});
