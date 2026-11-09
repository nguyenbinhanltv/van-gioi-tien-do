/**
 * QuestService (D107, docs/12): the server-authoritative quest state machine - accept, progress, complete, claim - for the main chain,
 * the daily / weekly set and sect quests.
 *
 * Authority: a client can only send an intent (`quest_cmd`: accept / claim / abandon / talk). Progress comes from events the server
 * observes itself: `onKill` (combat's drop event, with the mob's definition), `onBreakthrough` (a successful roll), and a scan of the
 * live state (zone reached, meditation time, items in the bag). Standing near an NPC is checked against the server position.
 *
 * Rewards go through the same places as loot: Linh thạch hạ phẩm as ONE balanced ledger transaction from `SYSTEM_FAUCET_QUEST`, items
 * into the bag (pending queue when full), tu vi into the progression record, Cống hiến through the sect module when it is present. In-game
 * only: nothing here prices, sells or entitles anything.
 *
 * Claim safety (no duplicate rewards across a crash): the claim is written to the store and `commit()`ted BEFORE anything is paid. If that
 * fails nothing is paid and the quest stays claimable; if the process dies after it the reward may be lost, but it can never be paid twice
 * (the ledger idempotency keys do not survive a restart, the committed claim does). A multi-document journal (#257 `TxJournal`) would let
 * the payment and the claim land atomically; see OPEN-ITEMS.
 *
 * Anti-enumeration / abuse: every command takes a rate-limit token per ACCOUNT before quest ids or NPC keys are looked at. Time only
 * enters through the injected wall clock (the 05:00 UTC+7 resets) and the simulation clock handed in by `WorldNode`.
 */
import {
  NPC_TEXT,
  QUESTS,
  QUEST_DEFS,
  QuestStatus,
  cultMinutesToTuVi,
  killMatches,
  mobZoneAt,
  objectiveTarget,
  questDefById,
  questEpochOf,
  questNpc,
  questResetIn,
  stoneWildHoursToStones,
  itemDefByKey,
  type DropItem,
  type QuestDef,
} from '@vgtd/shared';
import {
  QuestOp,
  QuestReason,
  type QuestCmdMsg,
  type QuestResultMsg,
  type QuestServerMessage,
  type QuestStateMsg,
} from '@vgtd/protocol';
import type { InventoryService } from '../world/inventory/service.js';
import { QUESTS_CONFIG } from './config.js';
import { InMemoryQuestStore, type QuestEntrySnapshot, type QuestSnapshot, type QuestStore } from './store.js';

export interface QuestPeer {
  readonly entityId: number;
  readonly accountId: string;
}

export interface QuestHost {
  deliver(entityId: number, msg: QuestServerMessage): void;
  /** tile position of a player, undefined when gone */
  posOf(entityId: number): { i: number; j: number } | undefined;
  /** realm (1..9) and absolute stage (1..41) of a player, undefined until the profile is loaded */
  realmStage(entityId: number): { realm: number; stage: number } | undefined;
  isMeditating(entityId: number): boolean;
  /** tu vi reward: add `amount` (capped at the stage requirement), returns what was added */
  grantTuVi(entityId: number, amount: number): number;
}

/** The sect module (D98) when it is hosted: membership and Cống hiến. Without it sect quests stay locked. */
export interface QuestSectPort {
  isMember(accountId: string): boolean;
  /** pay `amount` Cống hiến; `key` makes it idempotent. False when it could not be paid. */
  grantContribution(accountId: string, amount: number, key: string): boolean;
}

export interface QuestServiceOptions {
  store?: QuestStore;
  inventory: InventoryService;
  sect?: QuestSectPort;
  /** wall clock in unix ms (resets at 05:00 UTC+7); the composition root passes `Date.now`, tests drive their own */
  clock: () => number;
  /** side of the (square) map in tiles: NPCs stand at an offset from its centre */
  mapTiles: number;
}

interface Entry {
  s: QuestStatus;
  p: number[];
  e: number;
}
interface Bucket {
  tokens: number;
  at: number;
}
interface Account {
  readonly id: string;
  /** quests not in the default state */
  entries: Map<string, Entry>;
  sessions: number[];
  /** the profile (realm) was known the last time the state was built */
  realmKnown: boolean;
  /** meditation time not yet counted as a whole second */
  medFraction: number;
}

export interface QuestMetrics {
  accepted: number;
  completed: number;
  /** claim written but the reward could not be paid afterwards (nothing was paid twice) */
  payFailures: number;
  /** an active quest of an older cycle was cancelled by a reset */
  expired: number;
  /** claim refused because the store could not commit it */
  commitFailures: number;
  refused: Record<number, number>;
}

const snapOf = (e: Entry): QuestEntrySnapshot => ({ s: e.s, p: [...e.p], e: e.e });

export class QuestService {
  readonly metrics: QuestMetrics = {
    accepted: 0,
    completed: 0,
    payFailures: 0,
    expired: 0,
    commitFailures: 0,
    refused: {},
  };
  private host: QuestHost | null = null;
  private readonly store: QuestStore;
  private readonly inventory: InventoryService;
  private readonly sect: QuestSectPort | undefined;
  private readonly clock: () => number;
  private readonly mapTiles: number;
  private readonly accounts = new Map<string, Account>();
  private readonly byEntity = new Map<number, Account>();
  private readonly dirty = new Set<string>();
  private readonly buckets = new Map<string, Bucket>();
  private lastScanMs = -1e12;

  constructor(opts: QuestServiceOptions) {
    this.store = opts.store ?? new InMemoryQuestStore();
    this.inventory = opts.inventory;
    this.sect = opts.sect;
    this.clock = opts.clock;
    this.mapTiles = opts.mapTiles;
  }

  attach(host: QuestHost): void {
    this.host = host;
  }

  // ------------------------------------------------------------------ lifecycle
  join(peer: QuestPeer): void {
    let a = this.accounts.get(peer.accountId);
    if (!a) {
      a = { id: peer.accountId, entries: this.load(peer.accountId), sessions: [], realmKnown: false, medFraction: 0 };
      this.accounts.set(peer.accountId, a);
    }
    a.sessions.push(peer.entityId);
    a.sessions.sort((x, y) => x - y);
    this.byEntity.set(peer.entityId, a);
    this.applyResets(a);
    this.dirty.add(a.id);
  }
  leave(entityId: number): void {
    const a = this.byEntity.get(entityId);
    if (!a) return;
    this.byEntity.delete(entityId);
    a.sessions = a.sessions.filter((x) => x !== entityId);
    if (a.sessions.length === 0) {
      this.save(a);
      this.accounts.delete(a.id);
      this.buckets.delete(a.id);
      this.dirty.delete(a.id);
    }
  }

  private load(owner: string): Map<string, Entry> {
    const m = new Map<string, Entry>();
    const snap = this.store.load(owner);
    for (const [id, e] of Object.entries(snap?.quests ?? {})) {
      const def = questDefById(id);
      if (!def || !Array.isArray(e.p) || e.p.length !== def.objectives.length) continue; // content changed: forget the stale entry
      if (e.s !== QuestStatus.Active && e.s !== QuestStatus.Ready && e.s !== QuestStatus.Completed) continue;
      m.set(id, { s: e.s, p: e.p.map((x) => Math.max(0, Math.floor(x))), e: e.e });
    }
    return m;
  }
  private save(a: Account): void {
    const quests: Record<string, QuestEntrySnapshot> = {};
    for (const id of [...a.entries.keys()].sort()) quests[id] = snapOf(a.entries.get(id)!);
    const snap: QuestSnapshot = { v: 1, quests };
    this.store.save(a.id, snap);
  }

  // ------------------------------------------------------------------ queries
  /** Status of a quest for an account as the log shows it (Locked / Available are derived, the rest are stored). */
  statusOf(accountId: string, questId: string): QuestStatus {
    const a = this.accounts.get(accountId);
    const def = questDefById(questId);
    if (!a || !def) return QuestStatus.Locked;
    return this.status(a, def, a.sessions[0] !== undefined ? this.host?.realmStage(a.sessions[0]) : undefined);
  }
  progressOf(accountId: string, questId: string): readonly number[] {
    return this.accounts.get(accountId)?.entries.get(questId)?.p ?? [];
  }

  private cycleEpoch(def: QuestDef): number {
    return questEpochOf(def.repeat, this.clock());
  }

  private status(a: Account, def: QuestDef, rs: { realm: number; stage: number } | undefined): QuestStatus {
    const e = a.entries.get(def.id);
    if (e) {
      if (def.repeat === 'none' || e.e === this.cycleEpoch(def)) return e.s;
      // an entry of an older cycle is removed by `applyResets`; until then it counts as not there
    }
    if (!rs) return QuestStatus.Locked;
    if (def.minRealm !== undefined && rs.realm < def.minRealm) return QuestStatus.Locked;
    if (def.maxRealm !== undefined && rs.realm > def.maxRealm) return QuestStatus.Locked;
    for (const q of def.after ?? []) if (a.entries.get(q)?.s !== QuestStatus.Completed) return QuestStatus.Locked;
    if (def.sectRequired && !this.sect?.isMember(a.id)) return QuestStatus.Locked;
    return QuestStatus.Available;
  }

  // ------------------------------------------------------------------ resets (05:00 UTC+7)
  /** Drop every repeatable entry of an older cycle: finished ones come back as Available, unfinished ones are cancelled (docs/12 §4.3). */
  private applyResets(a: Account): boolean {
    let changed = false;
    for (const [id, e] of a.entries) {
      const def = questDefById(id);
      if (!def || def.repeat === 'none' || e.e === this.cycleEpoch(def)) continue;
      if (e.s === QuestStatus.Active || e.s === QuestStatus.Ready) this.metrics.expired++;
      a.entries.delete(id);
      changed = true;
    }
    if (changed) {
      this.save(a);
      this.dirty.add(a.id);
    }
    return changed;
  }

  // ------------------------------------------------------------------ commands
  private take(a: Account, nowMs: number): boolean {
    const c = QUESTS_CONFIG.RATE;
    let b = this.buckets.get(a.id);
    if (!b) {
      b = { tokens: c.burst, at: nowMs };
      this.buckets.set(a.id, b);
    }
    b.tokens = Math.min(c.burst, b.tokens + Math.max(0, nowMs - b.at) / c.refillMs);
    b.at = nowMs;
    if (b.tokens < 1) return false;
    b.tokens -= 1;
    return true;
  }

  private nearNpc(entityId: number, npcKey: string): boolean {
    const npc = questNpc(npcKey);
    const p = this.host?.posOf(entityId);
    if (!npc || !p) return false;
    const c = this.mapTiles / 2;
    return Math.hypot(p.i - (c + npc.offset[0]), p.j - (c + npc.offset[1])) <= QUESTS.NPC_RANGE_TILES;
  }

  handle(entityId: number, msg: QuestCmdMsg, nowMs: number): QuestResultMsg {
    const reply = (reason: QuestReason): QuestResultMsg => {
      if (reason !== QuestReason.Ok) this.metrics.refused[reason] = (this.metrics.refused[reason] ?? 0) + 1;
      return { type: 'quest_result', clientMsgId: msg.clientMsgId, reason };
    };
    const a = this.byEntity.get(entityId);
    if (!a) return reply(QuestReason.NotInWorld);
    if (!this.take(a, nowMs)) return reply(QuestReason.RateLimited); // before any id or key is looked at
    const rs = this.host?.realmStage(entityId);
    if (!rs) return reply(QuestReason.NotInWorld);
    this.applyResets(a);
    if (msg.op === QuestOp.Talk) return reply(this.talk(a, entityId, msg.npc));
    const def = questDefById(msg.questId);
    if (!def) return reply(QuestReason.NoSuchQuest);
    switch (msg.op) {
      case QuestOp.Accept:
        return reply(this.accept(a, entityId, def, rs));
      case QuestOp.Claim:
        return reply(this.claim(a, entityId, def, rs));
      default:
        return reply(this.abandon(a, def));
    }
  }

  private accept(a: Account, entityId: number, def: QuestDef, rs: { realm: number; stage: number }): QuestReason {
    const st = this.status(a, def, rs);
    if (st === QuestStatus.Locked) return QuestReason.Locked;
    if (st !== QuestStatus.Available) return QuestReason.NotAvailable;
    if (!this.nearNpc(entityId, def.giver)) return QuestReason.TooFar;
    if (this.activeCount(a, def.type) >= (QUESTS.MAX_ACTIVE[def.type] ?? 1)) return QuestReason.TooManyActive;
    if (this.cycleCount(a, def) >= this.cycleCap(def)) return QuestReason.CycleCap;
    a.entries.set(def.id, { s: QuestStatus.Active, p: def.objectives.map(() => 0), e: this.cycleEpoch(def) });
    this.metrics.accepted++;
    this.refresh(a, def.id);
    this.save(a);
    this.dirty.add(a.id);
    return QuestReason.Ok;
  }

  private abandon(a: Account, def: QuestDef): QuestReason {
    const e = a.entries.get(def.id);
    if (!e || (e.s !== QuestStatus.Active && e.s !== QuestStatus.Ready)) return QuestReason.NotActive;
    a.entries.delete(def.id);
    this.save(a);
    this.dirty.add(a.id);
    return QuestReason.Ok;
  }

  private activeCount(a: Account, type: QuestDef['type']): number {
    let n = 0;
    for (const [id, e] of a.entries)
      if ((e.s === QuestStatus.Active || e.s === QuestStatus.Ready) && questDefById(id)?.type === type) n++;
    return n;
  }
  /** Completions of the same cap group (daily / weekly / sect daily / sect weekly) in the current cycle. */
  private cycleCount(a: Account, def: QuestDef): number {
    if (def.repeat === 'none') return 0;
    let n = 0;
    for (const [id, e] of a.entries) {
      const d = questDefById(id);
      if (
        d &&
        d.type === def.type &&
        d.repeat === def.repeat &&
        e.s === QuestStatus.Completed &&
        e.e === this.cycleEpoch(d)
      )
        n++;
    }
    return n;
  }
  private cycleCap(def: QuestDef): number {
    const c = QUESTS.MAX_PER_CYCLE;
    if (def.type === 'sect') return def.repeat === 'weekly' ? c.sect_weekly : c.sect_daily;
    if (def.type === 'weekly') return c.weekly;
    if (def.type === 'daily') return c.daily;
    return Infinity;
  }

  private talk(a: Account, entityId: number, npcKey: string): QuestReason {
    if (!questNpc(npcKey)) return QuestReason.NoSuchNpc;
    if (!this.nearNpc(entityId, npcKey)) return QuestReason.TooFar;
    let changed = false;
    for (const [id, e] of a.entries) {
      if (e.s !== QuestStatus.Active) continue;
      const def = questDefById(id)!;
      def.objectives.forEach((o, i) => {
        if (o.kind === 'talk' && o.npc === npcKey && e.p[i]! < 1) {
          e.p[i] = 1;
          changed = true;
        }
      });
      this.refresh(a, id);
    }
    if (changed) {
      this.save(a);
      this.dirty.add(a.id);
    }
    return QuestReason.Ok;
  }

  private claim(a: Account, entityId: number, def: QuestDef, rs: { realm: number; stage: number }): QuestReason {
    const e = a.entries.get(def.id);
    if (!e || e.s === QuestStatus.Completed) return QuestReason.NotActive;
    if (e.s !== QuestStatus.Ready) return QuestReason.NotReady;
    if (!this.nearNpc(entityId, def.turnIn)) return QuestReason.TooFar;
    // 1) the claim is committed before anything is paid (see the header)
    const before = snapOf(e);
    e.s = QuestStatus.Completed;
    this.save(a);
    if (this.store.commit && !this.store.commit()) {
      a.entries.set(def.id, { s: before.s, p: before.p, e: before.e });
      this.save(a);
      this.metrics.commitFailures++;
      return QuestReason.RewardFailed;
    }
    this.metrics.completed++;
    // 2) pay
    try {
      this.pay(a, entityId, def, e.e, rs);
    } catch {
      this.metrics.payFailures++; // the claim stays committed: a lost reward is repaired by hand, a duplicated one cannot happen
    }
    this.dirty.add(a.id);
    return QuestReason.Ok;
  }

  private pay(a: Account, entityId: number, def: QuestDef, epoch: number, rs: { realm: number; stage: number }): void {
    const r = def.rewards;
    const items: { defId: number; quality: number; qty: number }[] = [];
    for (const it of r.items ?? []) {
      const d = itemDefByKey(it.item as DropItem);
      if (d) items.push({ defId: d.id, quality: it.quality ?? 0, qty: it.count });
    }
    const stones = BigInt(stoneWildHoursToStones(r.stoneWildHours ?? 0, rs.realm));
    const payKey = `quest:${a.id}:${def.id}:${epoch}`;
    if (stones > 0n || items.length > 0) this.inventory.grantQuestReward(a.id, { stones, items }, payKey);
    if (r.cultMinutes) this.host?.grantTuVi(entityId, cultMinutesToTuVi(r.cultMinutes, rs.stage));
    if (r.contribution && this.sect && !this.sect.grantContribution(a.id, r.contribution, payKey))
      this.metrics.payFailures++;
  }

  // ------------------------------------------------------------------ progress events
  /** A kill the account's player is credited for: `mobKey` is the definition key, `tier` its tier (`normal` / `elite` / `boss`). */
  onKill(entityId: number, mobKey: string, tier: string): void {
    const a = this.byEntity.get(entityId);
    if (a) this.bump(a, (o) => (o.kind === 'kill' && killMatches(o.target, mobKey, tier) ? 1 : 0));
  }
  /** A breakthrough roll succeeded for this player. */
  onBreakthrough(entityId: number): void {
    const a = this.byEntity.get(entityId);
    if (a) this.bump(a, (o) => (o.kind === 'breakthrough' ? 1 : 0));
  }
  private bump(a: Account, inc: (o: QuestDef['objectives'][number]) => number): void {
    let changed = false;
    for (const [id, e] of a.entries) {
      if (e.s !== QuestStatus.Active) continue;
      const def = questDefById(id)!;
      def.objectives.forEach((o, i) => {
        const n = inc(o);
        const target = objectiveTarget(o);
        if (n > 0 && e.p[i]! < target) {
          e.p[i] = Math.min(target, e.p[i]! + n);
          changed = true;
        }
      });
      this.refresh(a, id);
    }
    if (changed) {
      this.save(a);
      this.dirty.add(a.id);
    }
  }

  /** Active -> Ready when every objective reached its target. */
  private refresh(a: Account, id: string): void {
    const e = a.entries.get(id);
    const def = questDefById(id);
    if (!e || !def || e.s !== QuestStatus.Active) return;
    if (def.objectives.every((o, i) => e.p[i]! >= objectiveTarget(o))) e.s = QuestStatus.Ready;
  }

  // ------------------------------------------------------------------ tick: scans, resets, output
  tick(nowMs: number): void {
    if (nowMs - this.lastScanMs >= QUESTS.SCAN_INTERVAL_MS) {
      const dtS = this.lastScanMs < -1e11 ? 0 : (nowMs - this.lastScanMs) / 1000;
      this.lastScanMs = nowMs;
      for (const a of this.accounts.values()) this.scan(a, dtS);
    }
    if (this.dirty.size === 0) return;
    for (const id of [...this.dirty].sort()) {
      const a = this.accounts.get(id);
      if (!a) continue;
      const msg = this.stateOf(a);
      for (const sid of a.sessions) this.host?.deliver(sid, msg);
    }
    this.dirty.clear();
  }

  /** Progress that comes from watching the live state: zone reached, meditation time, items held. */
  private scan(a: Account, dtS: number): void {
    const sid = a.sessions[0];
    if (sid === undefined || !this.host) return;
    this.applyResets(a);
    const rs = this.host.realmStage(sid);
    if (!!rs !== a.realmKnown) {
      a.realmKnown = !!rs;
      this.dirty.add(a.id);
    }
    const pos = this.host.posOf(sid);
    const zone = pos ? mobZoneAt(Math.floor(pos.i), Math.floor(pos.j), this.mapTiles) : null;
    const meditating = this.host.isMeditating(sid);
    let medSeconds = 0;
    if (meditating) {
      a.medFraction += dtS;
      medSeconds = Math.floor(a.medFraction);
      a.medFraction -= medSeconds;
    } else a.medFraction = 0;
    const bag = this.inventory.bagOf(a.id);
    let changed = false;
    for (const [id, e] of a.entries) {
      if (e.s !== QuestStatus.Active) continue;
      const def = questDefById(id)!;
      def.objectives.forEach((o, i) => {
        const target = objectiveTarget(o);
        let v = e.p[i]!;
        if (o.kind === 'reach' && zone === o.zone) v = target;
        else if (o.kind === 'cultivate' && meditating) v = Math.min(target, v + medSeconds);
        else if (o.kind === 'collect') {
          const d = itemDefByKey(o.item as DropItem);
          v = Math.max(v, Math.min(target, d ? bag.count(d.id) : 0)); // monotonic: handing the item on later does not undo it
        }
        if (v !== e.p[i]) {
          e.p[i] = v;
          changed = true;
        }
      });
      const was = e.s;
      this.refresh(a, id);
      if (e.s !== was) changed = true;
    }
    if (changed) {
      this.save(a);
      this.dirty.add(a.id);
    }
  }

  /** The whole log of an account as the wire carries it. */
  private stateOf(a: Account): QuestStateMsg {
    const rs = a.sessions[0] !== undefined ? this.host?.realmStage(a.sessions[0]) : undefined;
    const reset = questResetIn(this.clock());
    return {
      type: 'quest_state',
      dailyResetIn: reset.daily,
      weeklyResetIn: reset.weekly,
      quests: QUEST_DEFS.map((def) => {
        const status = this.status(a, def, rs);
        const e = a.entries.get(def.id);
        const stored = e !== undefined && status === e.s;
        return {
          id: def.id,
          status,
          progress: def.objectives.map((o, i) =>
            stored
              ? Math.min(objectiveTarget(o), e.p[i] ?? 0)
              : status === QuestStatus.Completed
                ? objectiveTarget(o)
                : 0,
          ),
        };
      }),
    };
  }

  /** Test / ops hook: the state message an account would be sent now. */
  stateFor(accountId: string): QuestStateMsg | undefined {
    const a = this.accounts.get(accountId);
    return a ? this.stateOf(a) : undefined;
  }
  /** Where the NPC stands in tile coordinates on this map (the client uses the same table through `@vgtd/shared`). */
  npcTile(npcKey: string): { i: number; j: number } | undefined {
    const n = questNpc(npcKey);
    return n ? { i: this.mapTiles / 2 + n.offset[0], j: this.mapTiles / 2 + n.offset[1] } : undefined;
  }
  /** Display name of an NPC key (diagnostics). */
  static npcName(key: string): string {
    return NPC_TEXT[key] ?? key;
  }
}
