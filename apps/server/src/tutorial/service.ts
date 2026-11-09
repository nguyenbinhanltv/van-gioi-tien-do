/**
 * TutorialService (D105, docs/16): the server-side tracker of the first-session flow, login to first breakthrough. It reuses what the
 * D84 loop (`FIRST_SESSION`) measured on the client, but the SERVER decides: every step is something the server saw (a position, an
 * accepted cast, a kill credited by combat, a drop, an accepted meditation, a rolled breakthrough, an item used, a chat line sent, a
 * party joined). The client reports nothing but "skip". Progress is persisted per account through a `TutorialStore` (D92 file store
 * or in-memory) and survives reconnects and restarts.
 *
 * Steps are flags, not a strict sequence (a player may loot before reaching the field); the HUD points at the first unfinished one.
 * `complete` is set when every REQUIRED step (`TUTORIAL_REQUIRED_MASK`) is done; the optional tips (item, chat, party) never block it.
 * Skipping hides the hints for good but keeps recording progress (docs/16 §3: skipped steps still count).
 *
 * Counters are LOCAL ONLY: `funnel()` reads the store. docs/17 telemetry is not approved, nothing here is emitted anywhere.
 * Time-free and deterministic: no clock is read; the node feeds events.
 */
import {
  TUTORIAL,
  TUTORIAL_FLAG_COMPLETE,
  TUTORIAL_FLAG_SKIPPED,
  TUTORIAL_REQUIRED_MASK,
  TUTORIAL_STEPS,
  fieldBandStart,
  FIRST_SESSION,
  tutorialBit,
  type TutorialStepId,
} from '@vgtd/shared';
import type { TutorialStateMsg } from '@vgtd/protocol';
import { InMemoryTutorialStore, type TutorialRecord, type TutorialStore } from './store.js';

export type TutorialEvent = 'skill' | 'kill' | 'loot' | 'meditate' | 'breakthrough' | 'item' | 'chat' | 'party';

export interface TutorialOptions {
  store?: TutorialStore;
  /** map size in tiles: where the field band starts (`fieldBandStart`) */
  mapTiles?: number;
}

interface Session {
  rec: TutorialRecord;
  accountId: string;
  /** where the session started (tiles), for the `move` step; null until the first position is seen */
  start: { i: number; j: number } | null;
  dirty: boolean;
}

export interface TutorialFunnel {
  /** accounts that have a record (started the flow at least once) */
  accounts: number;
  completed: number;
  skipped: number;
  /** accounts that finished each step */
  byStep: Record<TutorialStepId, number>;
  /** total sessions started across accounts */
  sessions: number;
  /** completed / accounts (0 when there are none): the FTUE completion rate of the docs/10 gate, local only */
  completionRate: number;
}

const EVENT_STEP: Record<Exclude<TutorialEvent, 'kill'>, TutorialStepId> = {
  skill: 'skill',
  loot: 'loot',
  meditate: 'meditate',
  breakthrough: 'breakthrough',
  item: 'item',
  chat: 'chat',
  party: 'party',
};

export class TutorialService {
  private readonly store: TutorialStore;
  private readonly sessions = new Map<number, Session>();
  private readonly fieldAt: number;
  private readonly mapTiles: number;

  constructor(opts: TutorialOptions = {}) {
    this.store = opts.store ?? new InMemoryTutorialStore();
    this.mapTiles = opts.mapTiles ?? 256;
    this.fieldAt = fieldBandStart(this.mapTiles) + FIRST_SESSION.fieldMarginTiles;
  }

  // ------------------------------------------------------------------ sessions
  /** A player joined: load (or start) the account's record. The first `tutorial_state` goes out on the next `drain()`. */
  join(entityId: number, accountId: string): void {
    const rec: TutorialRecord = this.store.load(accountId) ?? {
      accountId,
      done: 0,
      kills: 0,
      skipped: false,
      complete: false,
      sessions: 0,
    };
    rec.sessions++;
    this.store.save(rec);
    this.sessions.set(entityId, { rec, accountId, start: null, dirty: true });
  }

  leave(entityId: number): void {
    this.sessions.delete(entityId);
  }

  isJoined(entityId: number): boolean {
    return this.sessions.has(entityId);
  }

  // ------------------------------------------------------------------ events (all decided by the server)
  /** Where the player is now (tiles); the node calls this a few times a second. Drives `move` and `field`. */
  observe(entityId: number, i: number, j: number): void {
    const s = this.sessions.get(entityId);
    if (!s || (this.hasStep(s, 'move') && this.hasStep(s, 'field'))) return;
    s.start ??= { i, j };
    if (!this.hasStep(s, 'move') && Math.max(Math.abs(i - s.start.i), Math.abs(j - s.start.j)) >= TUTORIAL.moveTiles)
      this.finish(s, 'move');
    const centre = this.mapTiles / 2;
    if (!this.hasStep(s, 'field') && Math.max(Math.abs(i - centre), Math.abs(j - centre)) >= this.fieldAt)
      this.finish(s, 'field');
  }

  /** Something happened to this player. A `kill` counts toward the `kills` step; every other event completes its step. */
  note(entityId: number, ev: TutorialEvent): void {
    const s = this.sessions.get(entityId);
    if (!s) return;
    if (ev === 'kill') {
      if (s.rec.kills < TUTORIAL.killTarget) {
        s.rec.kills++;
        s.dirty = true;
        if (s.rec.kills >= TUTORIAL.killTarget) this.finish(s, 'kills');
        else this.persist(s);
      }
      return;
    }
    this.finish(s, EVENT_STEP[ev]);
  }

  /** The player dismissed the hints. Idempotent; progress keeps being recorded. */
  skip(entityId: number): void {
    const s = this.sessions.get(entityId);
    if (!s || s.rec.skipped) return;
    s.rec.skipped = true;
    s.dirty = true;
    this.persist(s);
  }

  private hasStep(s: Session, id: TutorialStepId): boolean {
    return (s.rec.done & tutorialBit(id)) !== 0;
  }

  private finish(s: Session, id: TutorialStepId): void {
    if (this.hasStep(s, id)) return;
    s.rec.done |= tutorialBit(id);
    if (id === 'kills') s.rec.kills = TUTORIAL.killTarget;
    if (!s.rec.complete && (s.rec.done & TUTORIAL_REQUIRED_MASK) === TUTORIAL_REQUIRED_MASK) s.rec.complete = true;
    s.dirty = true;
    this.persist(s);
  }

  private persist(s: Session): void {
    this.store.save(s.rec);
  }

  // ------------------------------------------------------------------ output
  stateOf(entityId: number): TutorialStateMsg | undefined {
    const s = this.sessions.get(entityId);
    return s && toMsg(s.rec);
  }

  /** Players whose state changed since the last call (joins included), with the message to send each. */
  drain(): Array<{ entityId: number; msg: TutorialStateMsg }> {
    const out: Array<{ entityId: number; msg: TutorialStateMsg }> = [];
    for (const [entityId, s] of this.sessions) {
      if (!s.dirty) continue;
      s.dirty = false;
      out.push({ entityId, msg: toMsg(s.rec) });
    }
    return out;
  }

  // ------------------------------------------------------------------ local counters
  funnel(): TutorialFunnel {
    const rows = this.store.all();
    const byStep = Object.fromEntries(TUTORIAL_STEPS.map((id) => [id, 0])) as Record<TutorialStepId, number>;
    let completed = 0;
    let skipped = 0;
    let sessions = 0;
    for (const r of rows) {
      if (r.complete) completed++;
      if (r.skipped) skipped++;
      sessions += r.sessions;
      for (const id of TUTORIAL_STEPS) if (r.done & tutorialBit(id)) byStep[id]++;
    }
    return {
      accounts: rows.length,
      completed,
      skipped,
      byStep,
      sessions,
      completionRate: rows.length ? completed / rows.length : 0,
    };
  }
}

function toMsg(r: TutorialRecord): TutorialStateMsg {
  return {
    type: 'tutorial_state',
    done: r.done,
    kills: r.kills,
    flags: (r.skipped ? TUTORIAL_FLAG_SKIPPED : 0) | (r.complete ? TUTORIAL_FLAG_COMPLETE : 0),
  };
}
