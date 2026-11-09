/**
 * Quest model (D107): what the client knows about its quest log, fed by the server's `quest_state` / `quest_result`. Engine-free and
 * DOM-free: the Cocos quest panel and tracker only render what this returns. The server stays authoritative (it decides every status,
 * every progress number, every refusal and every reward); this keeps no rules beyond ordering, wording and "which NPC to walk to".
 *
 * NPC markers: `markerFor(npcKey)` is '?' when a quest waits to be turned in at that NPC, '!' when one can be accepted there, else null.
 */
import {
  NPC_TEXT,
  QUESTS,
  QUEST_DEFS,
  QUEST_NPCS,
  QUEST_TARGET_TEXT,
  QUEST_TEXT,
  QuestStatus,
  objectiveTarget,
  questDefById,
  questNpc,
  type QuestDef,
  type QuestObjective,
} from '@vgtd/shared';
import { QuestReason, type QuestResultMsg, type QuestStateMsg } from '@vgtd/protocol';

/** re-exported so engine scripts (which only see client-core) can name the ops and statuses */
export { QuestOp, QuestReason } from '@vgtd/protocol';
export { QuestStatus } from '@vgtd/shared';

/** Vietnamese text of every quest refusal (user-facing). */
export const QUEST_REASON_TEXT: Readonly<Record<number, string>> = {
  [QuestReason.Ok]: '',
  [QuestReason.RateLimited]: 'Bạn thao tác quá nhanh, hãy chờ giây lát.',
  [QuestReason.NoSuchQuest]: 'Không có nhiệm vụ này.',
  [QuestReason.Locked]: 'Chưa đủ điều kiện nhận nhiệm vụ này (cảnh giới, nhiệm vụ trước hoặc tông môn).',
  [QuestReason.NotAvailable]: 'Nhiệm vụ này đã nhận hoặc đã hoàn thành trong chu kỳ này.',
  [QuestReason.TooFar]: 'Bạn đứng quá xa NPC.',
  [QuestReason.NotReady]: 'Chưa hoàn thành mục tiêu của nhiệm vụ.',
  [QuestReason.TooManyActive]: 'Bạn đang làm quá nhiều nhiệm vụ cùng loại.',
  [QuestReason.NotActive]: 'Bạn không đang làm nhiệm vụ này.',
  [QuestReason.NoSuchNpc]: 'Không có NPC này.',
  [QuestReason.NotInWorld]: 'Chưa vào game, chưa thao tác được.',
  [QuestReason.CycleCap]: 'Đã đạt giới hạn nhiệm vụ trong chu kỳ này.',
  [QuestReason.RewardFailed]: 'Chưa nhận được phần thưởng, hãy thử lại.',
};

export const QUEST_TYPE_TEXT: Readonly<Record<string, string>> = {
  main: 'Chủ tuyến',
  side: 'Chi tuyến',
  daily: 'Nhật thường',
  weekly: 'Chu thường',
  sect: 'Tông môn',
};
export const QUEST_STATUS_TEXT: Readonly<Record<number, string>> = {
  [QuestStatus.Locked]: 'Chưa mở',
  [QuestStatus.Available]: 'Có thể nhận',
  [QuestStatus.Active]: 'Đang làm',
  [QuestStatus.Ready]: 'Chờ trả nhiệm vụ',
  [QuestStatus.Completed]: 'Đã xong',
};

export const questName = (id: string): string => QUEST_TEXT[id]?.name ?? id;
export const npcName = (key: string): string => NPC_TEXT[key] ?? key;
const target = (key: string): string => QUEST_TARGET_TEXT[key] ?? key;

/** One objective as a line with its progress (`Hạ Độc Thố 3/5`). */
export function objectiveLine(o: QuestObjective, progress: number): string {
  const t = objectiveTarget(o);
  const p = Math.min(t, progress);
  switch (o.kind) {
    case 'kill':
      return `Hạ ${target(o.target)} ${p}/${t}`;
    case 'collect':
      return `Có ${target(o.item)} trong túi ${p}/${t}`;
    case 'talk':
      return `${p >= 1 ? '✓' : '·'} Gặp ${npcName(o.npc)}`;
    case 'reach':
      return `${p >= 1 ? '✓' : '·'} Tiến tới ${target(o.zone)}`;
    case 'breakthrough':
      return `${p >= 1 ? '✓' : '·'} Đột phá thành công`;
    case 'cultivate': {
      const m = (s: number): string => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
      return `Đả tọa ${m(p)}/${m(t)}`;
    }
  }
}

/** Rewards as one line (`+4 phút tu luyện · 9 Linh thạch hạ phẩm tương đương · Hồi Huyết Đan ×2`), in the units of docs/12 §4.1. */
export function rewardLine(def: QuestDef): string {
  const r = def.rewards;
  const parts: string[] = [];
  if (r.cultMinutes) parts.push(`${r.cultMinutes} phút tu luyện`);
  if (r.stoneWildHours) parts.push(`${r.stoneWildHours} giờ Linh thạch dã ngoại`);
  if (r.contribution) parts.push(`${r.contribution} Cống hiến`);
  for (const it of r.items ?? []) parts.push(`${target(it.item)} ×${it.count}`);
  return parts.join(' · ');
}

export interface QuestView {
  def: QuestDef;
  id: string;
  name: string;
  desc: string;
  type: string;
  status: QuestStatus;
  progress: readonly number[];
  /** one line per objective, with progress */
  lines: string[];
  reward: string;
  /** the NPC to walk to next: the giver while the quest can be accepted, the turn-in NPC when it is ready, the objective NPC for talk */
  goTo: string | null;
  goToName: string;
}

export class QuestModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  private entries = new Map<string, { status: number; progress: readonly number[] }>();
  private seen = false;
  private dailyAt = 0;
  private weeklyAt = 0;
  private receivedMs = 0;
  /** the quest the player pinned in the tracker ('' = the first active one) */
  pinned = '';

  get ready(): boolean {
    return this.seen;
  }

  /**
   * The log changed. Returns system lines for what is worth announcing (an objective list completed, a quest finished, a new quest
   * available), or [] . `nowMs` is any monotonic clock, only used by `resetIn`.
   */
  applyState(m: QuestStateMsg, nowMs = 0): string[] {
    const had = this.seen;
    const lines: string[] = [];
    const prev = this.entries;
    const next = new Map<string, { status: number; progress: readonly number[] }>();
    for (const q of m.quests) {
      if (!questDefById(q.id)) continue; // a newer server's quest this client has no text for
      next.set(q.id, { status: q.status, progress: [...q.progress] });
      const was = prev.get(q.id)?.status;
      if (!had || was === undefined || was === q.status) continue;
      if (q.status === QuestStatus.Ready) lines.push(`Đã đủ mục tiêu: ${questName(q.id)}. Quay về gặp ${npcName(questDefById(q.id)!.turnIn)}.`);
      else if (q.status === QuestStatus.Completed) lines.push(`Hoàn thành nhiệm vụ: ${questName(q.id)}.`);
      else if (q.status === QuestStatus.Active && was === QuestStatus.Available) lines.push(`Đã nhận nhiệm vụ: ${questName(q.id)}.`);
    }
    this.entries = next;
    this.dailyAt = m.dailyResetIn;
    this.weeklyAt = m.weeklyResetIn;
    this.receivedMs = nowMs;
    this.seen = true;
    this.version++;
    return lines;
  }

  /** The answer to a command: the line to show when refused, null when done. */
  applyResult(m: QuestResultMsg): string | null {
    if (m.reason === QuestReason.Ok) return null;
    return QUEST_REASON_TEXT[m.reason] ?? `Thao tác bị từ chối (mã ${m.reason}).`;
  }

  statusOf(id: string): QuestStatus {
    return (this.entries.get(id)?.status ?? QuestStatus.Locked) as QuestStatus;
  }

  private view(def: QuestDef): QuestView {
    const e = this.entries.get(def.id);
    const status = (e?.status ?? QuestStatus.Locked) as QuestStatus;
    const progress = e?.progress ?? def.objectives.map(() => 0);
    let goTo: string | null = null;
    if (status === QuestStatus.Available) goTo = def.giver;
    else if (status === QuestStatus.Ready) goTo = def.turnIn;
    else if (status === QuestStatus.Active) {
      const talk = def.objectives.find((o, i) => o.kind === 'talk' && (progress[i] ?? 0) < 1);
      goTo = talk && talk.kind === 'talk' ? talk.npc : null;
    }
    return {
      def,
      id: def.id,
      name: questName(def.id),
      desc: QUEST_TEXT[def.id]?.desc ?? '',
      type: QUEST_TYPE_TEXT[def.type] ?? def.type,
      status,
      progress,
      lines: def.objectives.map((o, i) => objectiveLine(o, progress[i] ?? 0)),
      reward: rewardLine(def),
      goTo,
      goToName: goTo ? npcName(goTo) : '',
    };
  }

  /** Every quest in a status, in table order. */
  list(status: QuestStatus | readonly QuestStatus[]): QuestView[] {
    const set = new Set(Array.isArray(status) ? status : [status as QuestStatus]);
    return QUEST_DEFS.filter((d) => set.has(this.statusOf(d.id))).map((d) => this.view(d));
  }
  /** The quests being worked on or waiting for a turn-in: the log's "Đang làm" tab. */
  active(): QuestView[] {
    return this.list([QuestStatus.Ready, QuestStatus.Active]);
  }
  /** Quests that can be accepted now. */
  available(): QuestView[] {
    return this.list(QuestStatus.Available);
  }
  completedCount(): number {
    return this.list(QuestStatus.Completed).length;
  }

  /** At most `n` quests for the on-screen tracker: the pinned one first, then ready ones, then active ones. */
  tracker(n = 3): QuestView[] {
    const act = this.active();
    const rank = (v: QuestView): number => (v.id === this.pinned ? 0 : v.status === QuestStatus.Ready ? 1 : 2);
    return act.sort((a, b) => rank(a) - rank(b)).slice(0, n);
  }
  pin(id: string): void {
    this.pinned = this.pinned === id ? '' : id;
    this.version++;
  }

  /** '?' = a quest waits to be turned in at this NPC, '!' = one can be accepted here, null = nothing. */
  markerFor(npcKey: string): '?' | '!' | null {
    let accept = false;
    for (const d of QUEST_DEFS) {
      const st = this.statusOf(d.id);
      if (st === QuestStatus.Ready && d.turnIn === npcKey) return '?';
      if (st === QuestStatus.Available && d.giver === npcKey) accept = true;
    }
    return accept ? '!' : null;
  }

  /** Seconds to the next daily / weekly reset, counted down from the last state (`nowMs` on the same clock as `applyState`). */
  resetIn(nowMs: number): { daily: number; weekly: number } {
    const gone = this.seen ? Math.max(0, Math.floor((nowMs - this.receivedMs) / 1000)) : 0;
    return { daily: Math.max(0, this.dailyAt - gone), weekly: Math.max(0, this.weeklyAt - gone) };
  }

  /**
   * The NPC nearest to a position, with the distance in tiles and whether it is in reach (the server decides for real; this only drives
   * the "Gặp NPC (E)" hint). `mapTiles`: side of the square map the NPC offsets are relative to the centre of.
   */
  nearestNpc(pos: { i: number; j: number } | null, mapTiles: number): { key: string; name: string; dist: number; inReach: boolean } | null {
    if (!pos) return null;
    let best: { key: string; dist: number } | null = null;
    for (const n of QUEST_NPCS) {
      const d = Math.hypot(pos.i - (mapTiles / 2 + n.offset[0]), pos.j - (mapTiles / 2 + n.offset[1]));
      if (!best || d < best.dist) best = { key: n.key, dist: d };
    }
    return best ? { key: best.key, name: npcName(best.key), dist: best.dist, inReach: best.dist <= QUESTS.NPC_RANGE_TILES } : null;
  }
  /** Tile of an NPC key on a map of `mapTiles`, for pointing the player at it. */
  npcTile(key: string, mapTiles: number): { i: number; j: number } | null {
    const n = questNpc(key);
    return n ? { i: mapTiles / 2 + n.offset[0], j: mapTiles / 2 + n.offset[1] } : null;
  }

  /** The log as plain lines (for `/quest` in the chat log). */
  summaryLines(): string[] {
    if (!this.seen) return ['Sổ nhiệm vụ chưa tải xong.'];
    const lines: string[] = [];
    const act = this.active();
    lines.push(act.length ? `Đang làm (${act.length}):` : 'Chưa nhận nhiệm vụ nào đang làm.');
    for (const v of act) {
      lines.push(`  ${v.status === QuestStatus.Ready ? '?' : '·'} ${v.name}${v.goTo ? ` → ${v.goToName}` : ''}`);
      for (const l of v.lines) lines.push(`      ${l}`);
    }
    const av = this.available();
    if (av.length) lines.push(`Có thể nhận (${av.length}): ${av.map((v) => `${v.name} [${v.goToName}]`).join(' · ')}`);
    return lines;
  }
}
