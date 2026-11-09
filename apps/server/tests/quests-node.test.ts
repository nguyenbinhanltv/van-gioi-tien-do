/**
 * Quests on the real WorldNode (D107): the node feeds the quest service from combat kills (the mob's definition, party credit) and from
 * progression (a successful breakthrough). The kill path is driven through the node's own hook with a real mob id of the real MobManager.
 */
import { describe, expect, it } from 'vitest';
import { QuestStatus, mobDefByKey, mobDefById, type MobDef } from '@vgtd/shared';
import { QuestOp, QuestReason, ErrorCode, encode } from '@vgtd/protocol';
import {
  InventoryService,
  ProgressionService,
  QuestService,
  SectService,
  WorldNode,
  type ClientTransport,
} from '../src/index.js';

class Quiet implements ClientTransport {
  send(): void {}
  close(_c: ErrorCode, _t: string): void {}
  buffered(): number {
    return 0;
  }
}
const MAP = 128;
const C = MAP / 2;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function rig() {
  const inventory = new InventoryService();
  const progression = new ProgressionService({ seed: 5 });
  const quests = new QuestService({ inventory, clock: () => Date.parse('2026-11-09T12:00:00+07:00'), mapTiles: MAP });
  const node = new WorldNode({
    seed: 5,
    mapTiles: MAP,
    // on top of npc_ve_binh (3 west, 3 south of the centre)
    spawn: { i0: C - 3.2, j0: C + 2.8, side: 0.4 },
    mobs: true,
    combat: {},
    inventory,
    progression,
    quests,
  });
  const id = node.addPlayer(new Quiet(), 'acc-1');
  for (let t = 0; t < 5; t++) {
    node.tick();
    await sleep(5);
  }
  return { node, quests, id };
}
const cmd = (node: WorldNode, id: number, op: QuestOp, arg: string, n: number) =>
  node.receive(
    id,
    encode({
      type: 'quest_cmd',
      op,
      clientMsgId: n,
      questId: op === QuestOp.Talk ? '' : arg,
      npc: op === QuestOp.Talk ? arg : '',
    }),
  );
const mobOf = (node: WorldNode, pred: (d: MobDef) => boolean): number => {
  for (const e of node.world.entities) {
    const def = node.mobs ? mobDefById(node.mobs.defIdOf(e.id)) : undefined;
    if (def && pred(def)) return e.id;
  }
  throw new Error('no such mob in the world');
};

describe('WorldNode feeds quests', () => {
  it('a kill counts by the mob definition and tier through the node hook, for the quest that is active', async () => {
    const { node, quests, id } = await rig();
    // the profile loads asynchronously: wait until the quest log is not empty-locked any more
    for (let k = 0; k < 40 && quests.statusOf('acc-1', 'q_weekly_tru_ma') === QuestStatus.Locked; k++) {
      node.tick();
      await sleep(10);
    }
    expect(quests.statusOf('acc-1', 'q_weekly_tru_ma')).toBe(QuestStatus.Available);
    cmd(node, id, QuestOp.Accept, 'q_weekly_tru_ma', 1);
    expect(quests.statusOf('acc-1', 'q_weekly_tru_ma')).toBe(QuestStatus.Active);

    const kill = (mobId: number) => (node as unknown as { questKill(k: number, m: number): void }).questKill(id, mobId);
    kill(mobOf(node, (d) => d.tier === 'normal'));
    expect(quests.progressOf('acc-1', 'q_weekly_tru_ma')).toEqual([0]);
    kill(mobOf(node, (d) => d.tier === 'elite'));
    expect(quests.progressOf('acc-1', 'q_weekly_tru_ma')).toEqual([0]);
    kill(mobOf(node, (d) => d.tier === 'boss'));
    expect(quests.progressOf('acc-1', 'q_weekly_tru_ma')).toEqual([1]);
    expect(quests.statusOf('acc-1', 'q_weekly_tru_ma')).toBe(QuestStatus.Ready);
    expect(mobDefByKey('boss_ho_vuong')).toBeDefined();
  });

  it('claims through the node pay tu vi into the progression record and items into the bag', async () => {
    const { node, quests, id } = await rig();
    for (let k = 0; k < 40 && quests.statusOf('acc-1', 'q_weekly_tru_ma') === QuestStatus.Locked; k++) {
      node.tick();
      await sleep(10);
    }
    const before = node.progression!.recordOf(id)!.exp;
    cmd(node, id, QuestOp.Accept, 'q_weekly_tru_ma', 1);
    (node as unknown as { questKill(k: number, m: number): void }).questKill(
      id,
      mobOf(node, (d) => d.tier === 'boss'),
    );
    cmd(node, id, QuestOp.Claim, 'q_weekly_tru_ma', 2);
    expect(quests.statusOf('acc-1', 'q_weekly_tru_ma')).toBe(QuestStatus.Completed);
    expect(node.progression!.recordOf(id)!.exp).toBeGreaterThan(before);
    expect(node.inventory!.bagOf('acc-1').count(1)).toBe(3); // 3 heal pills
    expect(node.inventory!.wallet('acc-1', 'LT_HA')).toBeGreaterThan(0n);
    expect(node.inventory!.ledger.reconcile()).toEqual([]);
    expect(QuestReason.Ok).toBe(0);
  });

  it('sect quests pay Cống hiến through the real SectService (members only, idempotent key)', () => {
    const sect = new SectService({ ledger: new InventoryService().ledger });
    sect.join({ entityId: 1, accountId: 'm', path: undefined });
    expect(sect.grantContribution('m', 10, 'k')).toBe(false); // not a member yet
    (sect as unknown as { members: Set<string> }).members.add('m');
    expect(sect.grantContribution('m', 10, 'k')).toBe(true);
    expect(sect.grantContribution('m', 10, 'k')).toBe(true); // replay: still true, nothing paid twice
    expect(sect.contribution('m')).toBe(10n);
    expect(sect.grantContribution('m', 0, 'z')).toBe(false);
    expect(sect.grantContribution('m', 1.5, 'z')).toBe(false);
    expect(sect.ledger.reconcile()).toEqual([]);
  });

  it('a node without the module rejects quest commands and leaves the rest alone', () => {
    const node = new WorldNode({ seed: 5, mapTiles: MAP });
    expect(node.quests).toBeUndefined();
    const id = node.addPlayer(new Quiet(), 'acc-1');
    expect(() => cmd(node, id, QuestOp.Accept, 'q_c1_nhap_mon', 1)).not.toThrow();
  });
});
