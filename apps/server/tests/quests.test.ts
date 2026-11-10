/**
 * Quest service (D107): the state machine, the events, the rewards, the resets and the claim safety, driven with a fake host and a
 * fake wall clock (deterministic: no real time anywhere).
 */
import { describe, expect, it } from 'vitest';
import {
  QUESTS,
  QUEST_DEFS,
  QuestStatus,
  cultMinutesToTuVi,
  itemDefByKey,
  mobZoneAt,
  questNpc,
  stoneWildHoursToStones,
  type DropItem,
  type MobLayoutZone,
} from '@vgtd/shared';
import { QuestOp, QuestReason, type QuestServerMessage, type QuestStateMsg } from '@vgtd/protocol';
import { InMemoryQuestStore, InventoryService, QuestService, QUESTS_CONFIG, type QuestHost } from '../src/index.js';

const MAP = 256;
const C = MAP / 2;
const vn = (iso: string): number => Date.parse(`${iso}+07:00`);

interface Rig {
  svc: QuestService;
  inv: InventoryService;
  store: InMemoryQuestStore;
  now: { ms: number };
  wall: { ms: number };
  pos: Map<number, { i: number; j: number }>;
  meditating: Set<number>;
  tuVi: Map<number, number>;
  sent: { id: number; msg: QuestServerMessage }[];
  realm: { realm: number; stage: number };
  cmd(entity: number, op: QuestOp, arg: string): QuestReason;
  at(entity: number, npc: string): void;
  step(ms?: number): void;
  state(account: string): QuestStateMsg;
  statusOf(account: string, id: string): QuestStatus;
}
function rig(opts: { store?: InMemoryQuestStore; inv?: InventoryService; wall?: number; sect?: boolean } = {}): Rig {
  const store = opts.store ?? new InMemoryQuestStore();
  const inv = opts.inv ?? new InventoryService();
  const now = { ms: 10_000 };
  const wall = { ms: opts.wall ?? vn('2026-11-09T12:00:00') };
  const pos = new Map<number, { i: number; j: number }>();
  const meditating = new Set<number>();
  const tuVi = new Map<number, number>();
  const sent: { id: number; msg: QuestServerMessage }[] = [];
  const realm = { realm: 1, stage: 1 };
  const members = new Set<string>(opts.sect ? ['acct1'] : []);
  const contributions: { acct: string; n: number; key: string }[] = [];
  const svc = new QuestService({
    store,
    inventory: inv,
    clock: () => wall.ms,
    mapTiles: MAP,
    ...(opts.sect
      ? {
          sect: {
            isMember: (a: string) => members.has(a),
            grantContribution: (acct: string, n: number, key: string) => {
              contributions.push({ acct, n, key });
              return true;
            },
          },
        }
      : {}),
  });
  const host: QuestHost = {
    deliver: (id, msg) => sent.push({ id, msg }),
    posOf: (id) => pos.get(id),
    realmStage: () => realm,
    isMeditating: (id) => meditating.has(id),
    grantTuVi: (id, n) => {
      tuVi.set(id, (tuVi.get(id) ?? 0) + n);
      return n;
    },
  };
  svc.attach(host);
  let msgId = 0;
  const r: Rig = {
    svc,
    inv,
    store,
    now,
    wall,
    pos,
    meditating,
    tuVi,
    sent,
    realm,
    cmd: (entity, op, arg) => {
      now.ms += 1000; // far apart: the rate limit is tested on its own
      const res = svc.handle(
        entity,
        {
          type: 'quest_cmd',
          op,
          clientMsgId: ++msgId,
          questId: op === QuestOp.Talk ? '' : arg,
          npc: op === QuestOp.Talk ? arg : '',
        },
        now.ms,
      );
      return res.reason;
    },
    at: (entity, npc) => {
      const n = questNpc(npc)!;
      pos.set(entity, { i: C + n.offset[0] + 0.5, j: C + n.offset[1] + 0.5 });
    },
    step: (ms = 600) => {
      now.ms += ms;
      svc.tick(now.ms);
    },
    state: (account) => svc.stateFor(account)!,
    statusOf: (account, id) => svc.statusOf(account, id),
  };
  void members;
  void contributions;
  (r as unknown as { members: Set<string>; contributions: typeof contributions }).members = members;
  (r as unknown as { members: Set<string>; contributions: typeof contributions }).contributions = contributions;
  return r;
}
const join = (r: Rig, entity = 1, account = 'acct1'): void => {
  r.inv.onJoin(account);
  r.svc.join({ entityId: entity, accountId: account });
  r.step();
};
const entryOf = (r: Rig, account: string, id: string) => r.state(account).quests.find((q) => q.id === id)!;
const heal = (r: Rig, account = 'acct1'): number =>
  r.inv.bagOf(account).count(itemDefByKey('heal_pill' as DropItem)!.id);

/** Play chapter 1 up to (not including) the quest `upTo`, finishing every earlier quest the way a player would. */
function playUntil(r: Rig, upTo: string, entity = 1, account = 'acct1'): void {
  for (const def of QUEST_DEFS.filter((d) => d.type === 'main')) {
    if (def.id === upTo) return;
    if (def.minRealm === 2) {
      r.realm.realm = 2; // chapters 2-3 are for Trúc Cơ
      r.realm.stage = 10;
    }
    r.at(entity, def.giver);
    expect(r.cmd(entity, QuestOp.Accept, def.id), `accept ${def.id}`).toBe(QuestReason.Ok);
    for (const o of def.objectives) {
      if (o.kind === 'talk') {
        r.at(entity, o.npc);
        expect(r.cmd(entity, QuestOp.Talk, o.npc)).toBe(QuestReason.Ok);
      } else if (o.kind === 'kill')
        for (let k = 0; k < o.count; k++)
          r.svc.onKill(
            entity,
            o.target.startsWith('tier:') ? 'x' : o.target,
            o.target.startsWith('tier:') ? o.target.slice(5) : 'normal',
          );
      else if (o.kind === 'cultivate') {
        r.meditating.add(entity);
        for (let k = 0; k < o.minutes * 120 + 2; k++) r.step(500);
        r.meditating.delete(entity);
      } else if (o.kind === 'reach') r.pos.set(entity, zoneTile(o.zone));
      else if (o.kind === 'collect')
        r.inv.grantQuestReward(
          account,
          { stones: 0n, items: [{ defId: itemDefByKey(o.item as DropItem)!.id, quality: 0, qty: o.count }] },
          `fill:${def.id}`,
        );
      else if (o.kind === 'breakthrough') r.svc.onBreakthrough(entity);
    }
    r.step();
    r.step();
    r.at(entity, def.turnIn);
    expect(r.cmd(entity, QuestOp.Claim, def.id), `claim ${def.id}`).toBe(QuestReason.Ok);
  }
}
function zoneTile(zone: MobLayoutZone): { i: number; j: number } {
  for (let i = 0; i < MAP; i += 4)
    for (let j = 0; j < MAP; j += 4) if (mobZoneAt(i, j, MAP) === zone) return { i: i + 0.5, j: j + 0.5 };
  throw new Error(`no tile in ${zone}`);
}

describe('accept / progress / claim', () => {
  it('chapter 1 plays through end to end and every reward arrives', () => {
    const r = rig();
    join(r);
    playUntil(r, 'q_c2_nhan_lenh'); // the whole of chapter 1
    for (const d of QUEST_DEFS.filter((q) => q.chapter === 1))
      expect(r.statusOf('acct1', d.id), d.id).toBe(QuestStatus.Completed);
    // tu vi: the sum of the cult minutes at stage 1
    const mins = QUEST_DEFS.filter((q) => q.chapter === 1).reduce((n, q) => n + (q.rewards.cultMinutes ?? 0), 0);
    expect(r.tuVi.get(1)).toBe(
      QUEST_DEFS.filter((q) => q.chapter === 1).reduce(
        (n, q) => n + cultMinutesToTuVi(q.rewards.cultMinutes ?? 0, 1),
        0,
      ),
    );
    expect(mins).toBeGreaterThan(0);
    // stones: balanced ledger entries from the quest faucet only
    const hours = QUEST_DEFS.filter((q) => q.chapter === 1).map((q) =>
      stoneWildHoursToStones(q.rewards.stoneWildHours ?? 0, 1),
    );
    expect(r.inv.wallet('acct1', 'LT_HA')).toBe(BigInt(hours.reduce((a, b) => a + b, 0)));
    expect(r.inv.ledger.reconcile()).toEqual([]);
    expect(r.inv.ledger.balance({ kind: 'SYSTEM_FAUCET_QUEST', ownerId: null, currency: 'LT_HA' })).toBe(
      -r.inv.wallet('acct1', 'LT_HA'),
    );
    // items: heal pills 2 + 1, the white breakthrough pill at the end
    expect(heal(r)).toBe(3);
    expect(r.inv.bagOf('acct1').count(itemDefByKey('breakthrough_pill' as DropItem)!.id)).toBe(1);
  });

  it('is gated: prerequisites, realm, distance, double accept, claim before done', () => {
    const r = rig();
    join(r);
    expect(r.statusOf('acct1', 'q_c1_nhap_mon')).toBe(QuestStatus.Available);
    expect(r.statusOf('acct1', 'q_c1_van_khi')).toBe(QuestStatus.Locked); // needs nhap_mon
    expect(r.statusOf('acct1', 'q_c2_bi_canh')).toBe(QuestStatus.Locked);
    r.pos.set(1, { i: C + 40, j: C + 40 });
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon')).toBe(QuestReason.TooFar);
    r.at(1, 'npc_truong_lao_dan');
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_van_khi')).toBe(QuestReason.Locked);
    expect(r.cmd(1, QuestOp.Accept, 'q_nope')).toBe(QuestReason.NoSuchQuest);
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon')).toBe(QuestReason.Ok);
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon')).toBe(QuestReason.NotAvailable);
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.NotReady);
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_van_khi')).toBe(QuestReason.NotActive);
    expect(r.cmd(1, QuestOp.Talk, 'npc_nobody')).toBe(QuestReason.NoSuchNpc);
    expect(r.cmd(1, QuestOp.Talk, 'npc_su_huynh')).toBe(QuestReason.TooFar); // standing at the elder, not at the senior
    // a realm 2 character no longer sees chapter 1 and chapter 2 opens
    r.realm.realm = 2;
    r.realm.stage = 10;
    expect(r.statusOf('acct1', 'q_c1_van_khi')).toBe(QuestStatus.Locked);
  });

  it('claiming is one-shot: a repeated claim pays nothing, and the talk objective needs the right NPC nearby', () => {
    const r = rig();
    join(r);
    r.at(1, 'npc_truong_lao_dan');
    r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon');
    r.at(1, 'npc_su_huynh');
    expect(r.cmd(1, QuestOp.Talk, 'npc_su_huynh')).toBe(QuestReason.Ok);
    expect(entryOf(r, 'acct1', 'q_c1_nhap_mon').status).toBe(QuestStatus.Ready);
    r.at(1, 'npc_ve_binh');
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.TooFar); // turn in at the senior, not the guard
    r.at(1, 'npc_su_huynh');
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.Ok);
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.NotActive);
    expect(heal(r)).toBe(2);
    expect(r.tuVi.get(1)).toBe(cultMinutesToTuVi(1, 1));
  });

  it('abandon drops the progress; the quest can be taken again', () => {
    const r = rig();
    join(r);
    r.at(1, 'npc_truong_lao_dan');
    r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon');
    expect(r.cmd(1, QuestOp.Abandon, 'q_c1_nhap_mon')).toBe(QuestReason.Ok);
    expect(r.cmd(1, QuestOp.Abandon, 'q_c1_nhap_mon')).toBe(QuestReason.NotActive);
    expect(r.statusOf('acct1', 'q_c1_nhap_mon')).toBe(QuestStatus.Available);
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon')).toBe(QuestReason.Ok);
  });
});

describe('chapters 2 and 3 play through (data + existing objectives only)', () => {
  it('the whole main chain completes in order and ends on the Kim Đan breakthrough', () => {
    const r = rig();
    join(r);
    playUntil(r, 'no_such_quest'); // every main quest, chapter 1 then 2 then 3
    for (const d of QUEST_DEFS.filter((q) => q.type === 'main'))
      expect(r.statusOf('acct1', d.id), d.id).toBe(QuestStatus.Completed);
    expect(r.inv.ledger.reconcile()).toEqual([]);
  });
  it('chapter 2 stays locked for a Luyện Khí character', () => {
    const r = rig();
    join(r);
    expect(r.statusOf('acct1', 'q_c2_nhan_lenh')).toBe(QuestStatus.Locked);
  });
});

describe('objectives come from server events only', () => {
  it('kills count by mob key and by tier, only while the quest is active, and are capped at the target', () => {
    const r = rig();
    join(r);
    playUntil(r, 'q_c1_san_doc_tho');
    r.svc.onKill(1, 'mob_doc_tho', 'normal'); // before accepting: does not count
    r.at(1, 'npc_ve_binh');
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_san_doc_tho')).toBe(QuestReason.Ok);
    r.svc.onKill(1, 'mob_hoi_lang', 'normal'); // another mob: no
    for (let k = 0; k < 4; k++) r.svc.onKill(1, 'mob_doc_tho', 'normal');
    r.step();
    expect(entryOf(r, 'acct1', 'q_c1_san_doc_tho')).toMatchObject({ status: QuestStatus.Active, progress: [4] });
    r.svc.onKill(1, 'mob_doc_tho', 'normal');
    r.svc.onKill(1, 'mob_doc_tho', 'normal');
    r.step();
    expect(entryOf(r, 'acct1', 'q_c1_san_doc_tho')).toMatchObject({ status: QuestStatus.Ready, progress: [5] });
  });

  it('tier objectives: elite counts for tier:elite, not for tier:boss', () => {
    const r = rig();
    join(r);
    r.at(1, 'npc_ve_binh');
    expect(r.cmd(1, QuestOp.Accept, 'q_weekly_tru_ma')).toBe(QuestReason.Ok);
    r.svc.onKill(1, 'elite_lang_vuong', 'elite');
    r.step();
    expect(entryOf(r, 'acct1', 'q_weekly_tru_ma').progress).toEqual([0]);
    r.svc.onKill(1, 'boss_ho_vuong', 'boss');
    r.step();
    expect(entryOf(r, 'acct1', 'q_weekly_tru_ma').status).toBe(QuestStatus.Ready);
  });

  it('a kill for an unknown / absent player is ignored', () => {
    const r = rig();
    r.svc.onKill(99, 'mob_doc_tho', 'normal');
    r.svc.onBreakthrough(99);
    join(r);
    r.svc.leave(1);
    r.svc.onKill(1, 'mob_doc_tho', 'normal');
  });

  it('scan objectives: zone reached, meditation seconds (not while moving), items held', () => {
    const r = rig();
    join(r);
    // reach
    playUntil(r, 'q_c1_ra_chan_nui');
    r.at(1, 'npc_ve_binh');
    r.cmd(1, QuestOp.Accept, 'q_c1_ra_chan_nui');
    r.pos.set(1, { i: C + 0.5, j: C + 0.5 }); // the plaza is no zone
    r.step();
    expect(entryOf(r, 'acct1', 'q_c1_ra_chan_nui').status).toBe(QuestStatus.Active);
    r.pos.set(1, zoneTile('bia_rung'));
    r.step();
    expect(entryOf(r, 'acct1', 'q_c1_ra_chan_nui').status).toBe(QuestStatus.Ready);
    // meditate + collect through the daily set
    r.at(1, 'npc_su_huynh');
    r.cmd(1, QuestOp.Accept, 'q_daily_tu_luyen');
    for (let k = 0; k < 20; k++) r.step(500); // not meditating: nothing
    expect(entryOf(r, 'acct1', 'q_daily_tu_luyen').progress).toEqual([0]);
    r.meditating.add(1);
    for (let k = 0; k < 20; k++) r.step(500); // 10 s
    const p = entryOf(r, 'acct1', 'q_daily_tu_luyen').progress[0]!;
    expect(p).toBeGreaterThanOrEqual(9);
    expect(p).toBeLessThanOrEqual(11);
    r.at(1, 'npc_thuong_nhan');
    r.cmd(1, QuestOp.Accept, 'q_daily_hai_thuoc');
    const cm = itemDefByKey('craft_material' as DropItem)!.id;
    r.inv.grantQuestReward('acct1', { stones: 0n, items: [{ defId: cm, quality: 0, qty: 3 }] }, 'k1');
    r.step();
    expect(entryOf(r, 'acct1', 'q_daily_hai_thuoc').progress).toEqual([3]);
    r.inv.grantQuestReward('acct1', { stones: 0n, items: [{ defId: cm, quality: 0, qty: 2 }] }, 'k2');
    r.step();
    expect(entryOf(r, 'acct1', 'q_daily_hai_thuoc').status).toBe(QuestStatus.Ready);
  });
});

describe('resets at 05:00 UTC+7', () => {
  it('a finished daily quest is available again after the reset, an unfinished one is cancelled, the weekly one waits for Monday', () => {
    const r = rig({ wall: vn('2026-11-10T04:00:00') }); // Tuesday 04:00, one hour before the daily reset
    join(r);
    r.at(1, 'npc_ve_binh');
    r.cmd(1, QuestOp.Accept, 'q_daily_san_quai');
    for (let k = 0; k < 8; k++) r.svc.onKill(1, 'mob_doc_tho', 'normal');
    r.step();
    r.at(1, 'npc_thuong_nhan');
    r.cmd(1, QuestOp.Accept, 'q_daily_hai_thuoc'); // stays unfinished
    r.at(1, 'npc_ve_binh');
    r.cmd(1, QuestOp.Accept, 'q_weekly_tru_ma');
    expect(r.cmd(1, QuestOp.Claim, 'q_daily_san_quai')).toBe(QuestReason.Ok);
    expect(r.statusOf('acct1', 'q_daily_san_quai')).toBe(QuestStatus.Completed);
    // cannot take it twice in one cycle
    expect(r.cmd(1, QuestOp.Accept, 'q_daily_san_quai')).toBe(QuestReason.NotAvailable);
    r.wall.ms = vn('2026-11-10T05:00:00');
    r.step(600);
    r.step(600);
    expect(r.statusOf('acct1', 'q_daily_san_quai')).toBe(QuestStatus.Available);
    expect(r.statusOf('acct1', 'q_daily_hai_thuoc')).toBe(QuestStatus.Available); // cancelled, not rewarded
    expect(r.statusOf('acct1', 'q_weekly_tru_ma')).toBe(QuestStatus.Active); // same week
    expect(r.svc.metrics.expired).toBe(1);
    r.at(1, 'npc_ve_binh');
    expect(r.cmd(1, QuestOp.Accept, 'q_daily_san_quai')).toBe(QuestReason.Ok);
    // the new cycle pays again (a different idempotency key)
    for (let k = 0; k < 8; k++) r.svc.onKill(1, 'mob_doc_tho', 'normal');
    r.step();
    expect(r.cmd(1, QuestOp.Claim, 'q_daily_san_quai')).toBe(QuestReason.Ok);
    expect(r.inv.wallet('acct1', 'LT_HA')).toBe(BigInt(2 * stoneWildHoursToStones(0.03, 1)));
    // Monday 05:00: the weekly one is cancelled
    r.wall.ms = vn('2026-11-16T05:00:00');
    r.step(600);
    r.step(600);
    expect(r.statusOf('acct1', 'q_weekly_tru_ma')).toBe(QuestStatus.Available);
  });

  it('resets are applied when an account comes back after the reset, and one-off quests are never reset', () => {
    const store = new InMemoryQuestStore();
    const inv = new InventoryService();
    const a = rig({ store, inv, wall: vn('2026-11-09T20:00:00') });
    join(a);
    playUntil(a, 'q_c1_van_khi');
    a.at(1, 'npc_ve_binh');
    a.cmd(1, QuestOp.Accept, 'q_daily_san_quai');
    a.svc.leave(1);
    const b = rig({ store, inv, wall: vn('2026-11-12T20:00:00') });
    join(b);
    expect(b.statusOf('acct1', 'q_daily_san_quai')).toBe(QuestStatus.Available);
    expect(b.statusOf('acct1', 'q_c1_nhap_mon')).toBe(QuestStatus.Completed);
    expect(b.statusOf('acct1', 'q_c1_van_khi')).toBe(QuestStatus.Available);
  });
});

describe('claim safety and persistence', () => {
  it('survives a restart: progress and completed quests are kept', () => {
    const store = new InMemoryQuestStore();
    const inv = new InventoryService();
    const a = rig({ store, inv });
    join(a);
    playUntil(a, 'q_c1_san_doc_tho');
    a.at(1, 'npc_ve_binh');
    a.cmd(1, QuestOp.Accept, 'q_c1_san_doc_tho');
    for (let k = 0; k < 3; k++) a.svc.onKill(1, 'mob_doc_tho', 'normal');
    a.step();
    a.svc.leave(1);
    const b = rig({ store, inv });
    join(b);
    expect(entryOf(b, 'acct1', 'q_c1_san_doc_tho')).toMatchObject({ status: QuestStatus.Active, progress: [3] });
    expect(b.statusOf('acct1', 'q_c1_ra_chan_nui')).toBe(QuestStatus.Completed);
  });

  it('the claim is committed before it is paid: a failing store pays nothing and keeps the quest claimable', () => {
    const r = rig();
    join(r);
    r.at(1, 'npc_truong_lao_dan');
    r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon');
    r.at(1, 'npc_su_huynh');
    r.cmd(1, QuestOp.Talk, 'npc_su_huynh');
    r.store.failCommit = true;
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.RewardFailed);
    expect(heal(r)).toBe(0);
    expect(r.tuVi.get(1)).toBeUndefined();
    expect(r.statusOf('acct1', 'q_c1_nhap_mon')).toBe(QuestStatus.Ready);
    expect(r.svc.metrics.commitFailures).toBe(1);
    r.store.failCommit = false;
    expect(r.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.Ok);
    expect(heal(r)).toBe(2);
  });

  it('a crash after the committed claim but before the payment can lose the reward but never pays it twice', () => {
    const store = new InMemoryQuestStore();
    const inv = new InventoryService();
    const a = rig({ store, inv });
    join(a);
    a.at(1, 'npc_truong_lao_dan');
    a.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon');
    a.at(1, 'npc_su_huynh');
    a.cmd(1, QuestOp.Talk, 'npc_su_huynh');
    // the process dies inside the payment: the host's tu vi grant is the last step, make the ledger / bag step throw first
    inv.grantQuestReward = () => {
      throw new Error('crash');
    };
    expect(a.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.Ok);
    expect(a.svc.metrics.payFailures).toBe(1);
    // restart on the same store: the claim is committed, so it can never be claimed (= paid) again
    const b = rig({ store, inv: new InventoryService() });
    join(b);
    expect(b.statusOf('acct1', 'q_c1_nhap_mon')).toBe(QuestStatus.Completed);
    b.at(1, 'npc_su_huynh');
    expect(b.cmd(1, QuestOp.Claim, 'q_c1_nhap_mon')).toBe(QuestReason.NotActive);
    expect(heal(b)).toBe(0);
  });

  it('forgets entries of quests that no longer exist or changed shape instead of crashing', () => {
    const store = new InMemoryQuestStore();
    store.save('acct1', {
      v: 1,
      quests: {
        q_gone: { s: 2, p: [1], e: 0 },
        q_c1_nhap_mon: { s: 2, p: [1, 2, 3], e: 0 }, // wrong objective count
        q_c1_van_khi: { s: 99, p: [0], e: 0 }, // bogus status
        q_c1_ra_chan_nui: { s: 4, p: [1], e: 0 },
      },
    });
    const r = rig({ store });
    join(r);
    expect(r.statusOf('acct1', 'q_c1_nhap_mon')).toBe(QuestStatus.Available);
    expect(r.statusOf('acct1', 'q_c1_ra_chan_nui')).toBe(QuestStatus.Completed);
  });
});

describe('collect objectives are handed in (no farming by passing items around)', () => {
  const cm = (r: Rig) => r.inv.bagOf('acct1').count(itemDefByKey('craft_material' as DropItem)!.id);
  const give = (r: Rig, acct: string, qty: number, key: string) =>
    r.inv.grantQuestReward(
      acct,
      { stones: 0n, items: [{ defId: itemDefByKey('craft_material' as DropItem)!.id, quality: 0, qty }] },
      key,
    );

  it('the claim takes the items; with fewer in the bag the claim is refused and the quest stays claimable', () => {
    const r = rig();
    join(r);
    r.at(1, 'npc_thuong_nhan');
    r.cmd(1, QuestOp.Accept, 'q_daily_hai_thuoc');
    give(r, 'acct1', 7, 'a');
    r.step();
    expect(entryOf(r, 'acct1', 'q_daily_hai_thuoc').status).toBe(QuestStatus.Ready);
    // the player hands 4 away (a trade) before turning in
    expect(r.inv.takeStackable('acct1', itemDefByKey('craft_material' as DropItem)!.id, 4)).toBe(true);
    expect(r.cmd(1, QuestOp.Claim, 'q_daily_hai_thuoc')).toBe(QuestReason.MissingItems);
    expect(r.statusOf('acct1', 'q_daily_hai_thuoc')).toBe(QuestStatus.Ready);
    expect(r.tuVi.get(1)).toBeUndefined();
    give(r, 'acct1', 2, 'b'); // 5 again
    expect(r.cmd(1, QuestOp.Claim, 'q_daily_hai_thuoc')).toBe(QuestReason.Ok);
    expect(cm(r)).toBe(0); // all 5 handed in
  });

  it('a second account cannot complete the quest with the same items handed over', () => {
    const r = rig();
    join(r, 1, 'acct1');
    join(r, 2, 'acct2');
    const id = itemDefByKey('craft_material' as DropItem)!.id;
    give(r, 'acct1', 5, 'a');
    r.at(1, 'npc_thuong_nhan');
    r.at(2, 'npc_thuong_nhan');
    r.cmd(1, QuestOp.Accept, 'q_daily_hai_thuoc');
    r.step();
    expect(r.cmd(1, QuestOp.Claim, 'q_daily_hai_thuoc')).toBe(QuestReason.Ok);
    // the same five items would now be passed to acct2 (a trade): there are none left to pass, the first claim consumed them
    expect(r.inv.takeStackable('acct1', id, 5)).toBe(false);
    r.cmd(2, QuestOp.Accept, 'q_daily_hai_thuoc');
    r.step();
    expect(r.statusOf('acct2', 'q_daily_hai_thuoc')).toBe(QuestStatus.Active);
    expect(r.cmd(2, QuestOp.Claim, 'q_daily_hai_thuoc')).toBe(QuestReason.NotReady);
    // and the farming loop "trade the stack to the other account after the first claim" no longer pays twice: only real new items count
    expect(r.inv.wallet('acct2', 'LT_HA')).toBe(0n);
  });

  it('a failing commit takes nothing from the bag', () => {
    const r = rig();
    join(r);
    r.at(1, 'npc_thuong_nhan');
    r.cmd(1, QuestOp.Accept, 'q_daily_hai_thuoc');
    give(r, 'acct1', 5, 'a');
    r.step();
    r.store.failCommit = true;
    expect(r.cmd(1, QuestOp.Claim, 'q_daily_hai_thuoc')).toBe(QuestReason.RewardFailed);
    expect(cm(r)).toBe(5);
  });
});

describe('abuse', () => {
  it('rate limit first: a burst of bogus ids is refused for rate before any id or NPC is looked at', () => {
    const r = rig();
    join(r);
    const reasons: QuestReason[] = [];
    for (let k = 0; k < QUESTS_CONFIG.RATE.burst + 6; k++) {
      const res = r.svc.handle(
        1,
        { type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: k, questId: `q_probe_${k}`, npc: '' },
        50_000,
      );
      reasons.push(res.reason);
    }
    expect(reasons.slice(0, QUESTS_CONFIG.RATE.burst).every((x) => x === QuestReason.NoSuchQuest)).toBe(true);
    expect(reasons.slice(QUESTS_CONFIG.RATE.burst).every((x) => x === QuestReason.RateLimited)).toBe(true);
    // and the bucket refills with time
    const later = r.svc.handle(
      1,
      { type: 'quest_cmd', op: QuestOp.Accept, clientMsgId: 1, questId: 'q_x', npc: '' },
      50_000 + QUESTS_CONFIG.RATE.refillMs * 2,
    );
    expect(later.reason).toBe(QuestReason.NoSuchQuest);
  });

  it('a player that is not in the world gets NotInWorld, a profile that is not loaded too', () => {
    const r = rig();
    expect(r.cmd(7, QuestOp.Accept, 'q_c1_nhap_mon')).toBe(QuestReason.NotInWorld);
    join(r);
    (r.svc as unknown as { host: QuestHost }).host.realmStage = () => undefined;
    expect(r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon')).toBe(QuestReason.NotInWorld);
  });

  it('two accounts never share progress', () => {
    const r = rig();
    join(r, 1, 'acct1');
    join(r, 2, 'acct2');
    r.at(1, 'npc_ve_binh');
    r.cmd(1, QuestOp.Accept, 'q_weekly_tru_ma');
    r.svc.onKill(2, 'boss_ho_vuong', 'boss');
    r.step();
    expect(entryOf(r, 'acct1', 'q_weekly_tru_ma').progress).toEqual([0]);
    expect(r.statusOf('acct2', 'q_weekly_tru_ma')).toBe(QuestStatus.Available);
  });
});

describe('sect quests (Cống hiến through the sect port)', () => {
  it('are locked without a sect module / membership, and pay Cống hiến with an idempotent key when claimed', () => {
    const none = rig();
    join(none);
    expect(none.statusOf('acct1', 'q_sect_tuan_tra')).toBe(QuestStatus.Locked);

    const r = rig({ sect: true });
    join(r);
    expect(r.statusOf('acct1', 'q_sect_tuan_tra')).toBe(QuestStatus.Available);
    r.at(1, 'npc_chuong_mon');
    expect(r.cmd(1, QuestOp.Accept, 'q_sect_tuan_tra')).toBe(QuestReason.Ok);
    for (let k = 0; k < 10; k++) r.svc.onKill(1, 'mob_doc_tho', 'normal');
    r.step();
    expect(r.cmd(1, QuestOp.Claim, 'q_sect_tuan_tra')).toBe(QuestReason.Ok);
    const c = (r as unknown as { contributions: { acct: string; n: number; key: string }[] }).contributions;
    expect(c).toHaveLength(1);
    expect(c[0]).toMatchObject({ acct: 'acct1', n: 10 });
    expect(c[0]!.key).toContain('q_sect_tuan_tra');
  });
});

describe('quest_state', () => {
  it('is sent on join and after changes (coalesced per tick), lists the whole table and carries the reset countdowns', () => {
    const r = rig({ wall: vn('2026-11-09T04:00:00') });
    join(r);
    const first = r.sent.filter((s) => s.msg.type === 'quest_state');
    expect(first.length).toBeGreaterThanOrEqual(1);
    const m = r.state('acct1');
    expect(m.quests.map((q) => q.id)).toEqual(QUEST_DEFS.map((q) => q.id));
    expect(m.quests.length).toBeLessThanOrEqual(QUESTS.MAX_ENTRIES);
    expect(m.dailyResetIn).toBe(3600);
    expect(m.weeklyResetIn).toBe(3600); // Monday 04:00: one hour to Monday 05:00
    const n = r.sent.length;
    r.step();
    expect(r.sent.length).toBe(n); // nothing changed: nothing sent
    r.at(1, 'npc_truong_lao_dan');
    r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon');
    r.cmd(1, QuestOp.Abandon, 'q_c1_nhap_mon');
    r.cmd(1, QuestOp.Accept, 'q_c1_nhap_mon');
    r.svc.tick(r.now.ms + 1);
    expect(r.sent.length).toBe(n + 1); // three changes, one message
    // the status of a completed daily shows its target as progress, locked ones are all zero
    expect(m.quests.find((q) => q.id === 'q_c1_van_khi')).toMatchObject({ status: QuestStatus.Locked, progress: [0] });
  });
});
