/**
 * ProgressionService: server-authoritative tu vi accumulation (dả tọa), stage state and breakthrough rolls.
 *
 * Authority: the client only sends intents (meditate_start/stop, breakthrough_start). The character is the one the
 * connection authenticated as; stats, tu vi, rates and rolls are all decided here with @vgtd/shared formulas and a seeded
 * PRNG stream. Time is the simulation clock passed in by the caller (`world.timeMs`), never the wall clock, so replays with
 * the same seed and inputs are identical.
 *
 * Hooks into the world node (all O(1)): `join`/`leave`, `onInput`, `onCombat`, `handle`, `tick`.
 */
import {
  BreakthroughKind,
  BreakthroughOutcome,
  CHAR_FLAG,
  ProgressionReason,
  type BreakthroughResultMsg,
  type CharStateMsg,
  type ColdClientMessage,
  type ColdServerMessage,
  type MeditateResultMsg,
} from '@vgtd/protocol';
import { ROOT_TYPES, rngFloat, rngFork, rngSeed, type RngState } from '@vgtd/shared';
import { PROGRESSION_CONFIG } from './config.js';
import {
  DEFAULT_ENV,
  advanceTuVi,
  applyBreakthrough,
  elementMask,
  isMaxStage,
  newRecord,
  planBreakthrough,
  rollSpiritRoot,
  stageOf,
  tuViRequired,
  type MeditationEnv,
  type ProgressRecord,
} from './state.js';
import { InMemoryProgressionStore, InMemoryRollLog, type ProgressionStore, type RollLog } from './store.js';

export interface Outbound {
  readonly entityId: number;
  readonly msg: ColdServerMessage;
}

export interface ProgressionOptions {
  /** PRNG seed of the `breakthrough` stream and of character-creation rolls (use a random seed in production) */
  seed?: number;
  store?: ProgressionStore;
  rollLog?: RollLog;
  /** spirit energy at the entity's spot; default: normal density, uniform land (Match = 1) */
  env?: (entityId: number) => MeditationEnv;
  /** world tick for the roll log */
  tickOf?: () => number;
  /** liveness of an entity; defaults to always alive until the world node attaches its own */
  isAlive?: (entityId: number) => boolean;
  /**
   * Fired once when a profile finishes loading and after every successful breakthrough, with the character's new
   * realm / sub-stage (so combat can re-derive stats from `statsAt(realm, subRealm)`).
   */
  onStageChange?: (entityId: number, realm: number, subRealm: number) => void;
  /** a record could not be stored even after reloading (version conflict twice): the caller should drop the session */
  onPersistFailure?: (entityId: number) => void;
  /**
   * Major breakthroughs (realm thresholds) need Tâm Ma and Lôi Kiếp (docs/01 §5), which are not built yet, so they are
   * refused with `ProgressionReason.TribulationRequired` unless this is true (tests / dev only).
   */
  allowMajorBreakthrough?: boolean;
  /** DEV / TEST ONLY: multiplies the tu vi gained per tick (default 1) so a headless run can fill a stage in seconds. Never a gameplay value. */
  devTuViSpeed?: number;
}

interface Session {
  readonly entityId: number;
  readonly characterId: string;
  rec: ProgressRecord | null;
  meditating: boolean;
  lastMoveMs: number;
  lastCombatMs: number;
  lastSentMs: number;
  lastSentExp: number;
  lastAttemptMs: number;
  lastSaveMs: number;
  dirty: boolean;
  /** last version known to be stored */
  version: number;
  saving: boolean;
  resave: boolean;
  savePromise: Promise<void> | null;
  tokens: number;
  tokenMs: number;
  answers: Map<string, ColdServerMessage>;
}

export interface ProgressionMetrics {
  joins: number;
  rejected: Record<number, number>;
  breakthroughs: number;
  successes: number;
  saves: number;
  saveConflicts: number;
  saveFailures: number;
}

const NEVER = -1e12;

export class ProgressionService {
  readonly store: ProgressionStore;
  readonly rollLog: RollLog;
  readonly metrics: ProgressionMetrics = {
    joins: 0,
    rejected: {},
    breakthroughs: 0,
    successes: 0,
    saves: 0,
    saveConflicts: 0,
    saveFailures: 0,
  };
  private readonly seed: number;
  private rng: RngState;
  private readonly sessions = new Map<number, Session>();
  private readonly meditators = new Set<number>();
  private readonly outbox: Outbound[] = [];
  private envOf: (entityId: number) => MeditationEnv;
  private tickOf: () => number;
  private isAlive: (entityId: number) => boolean;
  private onStageChange: ((entityId: number, realm: number, subRealm: number) => void) | undefined;
  private onPersistFailure: ((entityId: number) => void) | undefined;
  private readonly allowMajor: boolean;
  private readonly devSpeed: number;
  /** in-flight writes per character: a new session of the same character loads only after the previous one is stored */
  private readonly pendingWrites = new Map<string, Promise<void>>();

  constructor(opts: ProgressionOptions = {}) {
    this.seed = opts.seed ?? 1;
    this.rng = rngFork(rngSeed(this.seed), 'breakthrough');
    this.store = opts.store ?? new InMemoryProgressionStore();
    this.rollLog = opts.rollLog ?? new InMemoryRollLog();
    this.envOf = opts.env ?? (() => DEFAULT_ENV);
    this.tickOf = opts.tickOf ?? (() => 0);
    this.isAlive = opts.isAlive ?? (() => true);
    this.onStageChange = opts.onStageChange;
    this.onPersistFailure = opts.onPersistFailure;
    this.allowMajor = opts.allowMajorBreakthrough ?? false;
    this.devSpeed = opts.devTuViSpeed !== undefined && opts.devTuViSpeed > 0 ? opts.devTuViSpeed : 1;
  }

  /** Let the world node provide liveness and the tick counter (kept optional so the service is testable alone). */
  attach(port: {
    isAlive?: (entityId: number) => boolean;
    tickOf?: () => number;
    onStageChange?: (entityId: number, realm: number, subRealm: number) => void;
    onPersistFailure?: (entityId: number) => void;
  }): void {
    if (port.onPersistFailure) this.onPersistFailure = port.onPersistFailure;
    if (port.onStageChange) this.onStageChange = port.onStageChange;
    if (port.isAlive) this.isAlive = port.isAlive;
    if (port.tickOf) this.tickOf = port.tickOf;
  }

  /** PRNG state of the `breakthrough` stream (for the world state hash and for tests). */
  rngState(): RngState {
    return this.rng;
  }

  // ------------------------------------------------------------------ lifecycle
  /** Register a connected player; the profile loads (or is created) asynchronously, commands answer NotReady until then. */
  join(entityId: number, characterId: string, nowMs = 0): void {
    this.sessions.set(entityId, {
      entityId,
      characterId,
      rec: null,
      meditating: false,
      lastMoveMs: NEVER,
      lastCombatMs: NEVER,
      lastSentMs: NEVER,
      lastSentExp: -1,
      lastAttemptMs: NEVER,
      lastSaveMs: nowMs,
      dirty: false,
      version: 0,
      saving: false,
      resave: false,
      savePromise: null,
      tokens: PROGRESSION_CONFIG.CMD_BUCKET,
      tokenMs: nowMs,
      answers: new Map(),
    });
    this.metrics.joins++;
    // load only after any in-flight write of the same character (re-login right after a leave) has finished
    const pending = this.pendingWrites.get(characterId) ?? Promise.resolve();
    void pending
      .then(() => this.store.load(characterId))
      .then(async (loaded) => {
        const s = this.sessions.get(entityId);
        if (!s || s.characterId !== characterId) return; // left (or replaced) while loading
        if (loaded) {
          s.rec = loaded;
          s.version = loaded.version;
        } else {
          // creation roll: seeded by the character id, so it does not depend on login order
          const [root] = rollSpiritRoot(rngFork(rngSeed(this.seed), `root:${characterId}`));
          s.rec = newRecord(characterId, root);
          s.dirty = true;
          await this.save(s);
        }
        this.queueState(s);
        this.onStageChange?.(entityId, s.rec.realm, s.rec.subRealm);
      });
  }

  /** Remove a player: meditation ends and the record is written. Returns when the write finished. */
  async leave(entityId: number): Promise<void> {
    const s = this.sessions.get(entityId);
    if (!s) return;
    this.sessions.delete(entityId);
    this.meditators.delete(entityId);
    if (s.rec && s.dirty) await this.save(s);
  }

  /** char_state of a player (null until the profile is loaded). */
  stateOf(entityId: number): CharStateMsg | null {
    const s = this.sessions.get(entityId);
    return s?.rec ? this.stateMsg(s, s.rec) : null;
  }
  recordOf(entityId: number): ProgressRecord | null {
    return this.sessions.get(entityId)?.rec ?? null;
  }
  isMeditating(entityId: number): boolean {
    return this.sessions.get(entityId)?.meditating ?? false;
  }

  // ------------------------------------------------------------------ activity hooks (server-observed, never client-declared)
  /** An accepted movement input: magnitude > 0 interrupts meditation and blocks starting it. */
  onInput(entityId: number, mag: number, nowMs: number): void {
    const s = this.sessions.get(entityId);
    if (!s || mag <= 0) return;
    s.lastMoveMs = nowMs;
    if (s.meditating) this.stopMeditation(s, nowMs);
  }
  /** A cast, or damage dealt/taken. */
  onCombat(entityId: number, nowMs: number): void {
    const s = this.sessions.get(entityId);
    if (!s) return;
    s.lastCombatMs = nowMs;
    if (s.meditating) this.stopMeditation(s, nowMs);
  }

  // ------------------------------------------------------------------ commands
  handle(entityId: number, msg: ColdClientMessage, nowMs: number): Outbound[] {
    const s = this.sessions.get(entityId);
    if (!s) return [];
    const cached = s.answers.get(msg.requestId);
    if (cached) return [{ entityId, msg: cached }]; // idempotent re-send: same answer, no second roll
    let reply: ColdServerMessage;
    if (msg.type === 'breakthrough_start') reply = this.breakthrough(s, msg.requestId, nowMs);
    else reply = this.meditateCommand(s, msg.type === 'meditate_start', msg.requestId, nowMs);
    // only a rolled breakthrough is cached: a re-send after a lost reply must not roll twice (docs/24 §5.1)
    if (reply.type === 'breakthrough_result' && reply.outcome !== BreakthroughOutcome.Rejected) {
      s.answers.set(msg.requestId, reply);
      if (s.answers.size > PROGRESSION_CONFIG.RESULT_CACHE) s.answers.delete(s.answers.keys().next().value as string);
    }
    const out: Outbound[] = [{ entityId, msg: reply }];
    // flush any state change this command caused right behind the answer
    for (const o of this.outbox.splice(0)) out.push(o);
    return out;
  }

  private take(s: Session, nowMs: number): boolean {
    const c = PROGRESSION_CONFIG;
    s.tokens = Math.min(c.CMD_BUCKET, s.tokens + Math.max(0, nowMs - s.tokenMs) / c.CMD_REFILL_MS);
    s.tokenMs = nowMs;
    if (s.tokens < 1) return false;
    s.tokens -= 1;
    return true;
  }

  /** Why the player cannot sit or break through right now, or Ok. */
  private blocked(s: Session, nowMs: number): ProgressionReason {
    if (!s.rec) return ProgressionReason.NotReady;
    if (!this.isAlive(s.entityId)) return ProgressionReason.Dead;
    if (nowMs - s.lastCombatMs < PROGRESSION_CONFIG.COMBAT_LOCK_MS) return ProgressionReason.InCombat;
    if (nowMs - s.lastMoveMs < PROGRESSION_CONFIG.MOVE_GRACE_MS) return ProgressionReason.Moving;
    return ProgressionReason.Ok;
  }

  private reject(reason: ProgressionReason): void {
    this.metrics.rejected[reason] = (this.metrics.rejected[reason] ?? 0) + 1;
  }

  private meditateCommand(s: Session, start: boolean, requestId: string, nowMs: number): MeditateResultMsg {
    const result = (reason: ProgressionReason): MeditateResultMsg => {
      if (reason !== ProgressionReason.Ok) this.reject(reason);
      return { type: 'meditate_result', requestId, meditating: s.meditating, reason };
    };
    if (!this.take(s, nowMs)) return result(ProgressionReason.RateLimited);
    if (!start) {
      if (s.meditating) this.stopMeditation(s, nowMs);
      return result(ProgressionReason.Ok);
    }
    const why = this.blocked(s, nowMs);
    if (why !== ProgressionReason.Ok) return result(why);
    if (isMaxStage(s.rec!)) return result(ProgressionReason.AtMaxStage);
    // already full: nothing to absorb, the state flag BREAKTHROUGH_READY tells the client; stays idle
    if (s.rec!.exp >= tuViRequired(s.rec!)) return result(ProgressionReason.Ok);
    if (!s.meditating) {
      s.meditating = true;
      this.meditators.add(s.entityId);
      s.lastSentMs = NEVER;
      this.queueState(s);
    }
    return result(ProgressionReason.Ok);
  }

  private breakthrough(s: Session, requestId: string, nowMs: number): BreakthroughResultMsg {
    const rec = s.rec;
    const base = {
      type: 'breakthrough_result' as const,
      requestId,
      kind: BreakthroughKind.None as number,
      fromStage: rec ? stageOf(rec) : 1,
      toStage: rec ? stageOf(rec) : 1,
      chance: 0,
      nFail: rec?.nFail ?? 0,
    };
    const rejected = (reason: ProgressionReason): BreakthroughResultMsg => {
      this.reject(reason);
      return { ...base, outcome: BreakthroughOutcome.Rejected, reason };
    };
    if (!this.take(s, nowMs)) return rejected(ProgressionReason.RateLimited);
    const why = this.blocked(s, nowMs);
    if (why !== ProgressionReason.Ok) return rejected(why);
    const r = s.rec!;
    const plan = planBreakthrough(r);
    if (!plan) return rejected(ProgressionReason.AtMaxStage);
    if (plan.kind === 'major' && !this.allowMajor) return rejected(ProgressionReason.TribulationRequired);
    if (nowMs - s.lastAttemptMs < PROGRESSION_CONFIG.BREAKTHROUGH_COOLDOWN_MS)
      return rejected(ProgressionReason.Cooldown);
    if (r.exp < tuViRequired(r)) return rejected(ProgressionReason.NotEnoughTuVi);

    if (s.meditating) this.stopMeditation(s, nowMs);
    s.lastAttemptMs = nowMs;
    let draw: number;
    [draw, this.rng] = rngFloat(this.rng);
    const success = draw < plan.chance;
    this.rollLog.append({
      stream: 'breakthrough',
      tick: this.tickOf(),
      characterId: s.characterId,
      kind: plan.kind,
      fromStage: plan.fromStage,
      chance: plan.chance,
      draw,
      success,
      nFailBefore: r.nFail,
    });
    this.metrics.breakthroughs++;
    if (success) this.metrics.successes++;
    const next = applyBreakthrough(r, plan, success);
    s.rec = next;
    s.dirty = true;
    if (success) this.onStageChange?.(s.entityId, next.realm, next.subRealm);
    void this.save(s);
    this.queueState(s);
    return {
      ...base,
      outcome: success ? BreakthroughOutcome.Success : BreakthroughOutcome.Failure,
      kind: plan.kind === 'major' ? BreakthroughKind.Major : BreakthroughKind.Minor,
      reason: ProgressionReason.Ok,
      fromStage: plan.fromStage,
      toStage: success ? plan.toStage : plan.fromStage,
      chance: Math.round(plan.chance * 10_000),
      nFail: next.nFail,
    };
  }

  // ------------------------------------------------------------------ tick
  /** One world tick: accumulate tu vi for meditators (ascending entity id), emit progress and autosave. */
  tick(nowMs: number, dtMs: number): Outbound[] {
    const c = PROGRESSION_CONFIG;
    for (const id of Array.from(this.meditators).sort((a, b) => a - b)) {
      const s = this.sessions.get(id);
      if (!s?.rec || !s.meditating) continue;
      if (!this.isAlive(id)) {
        this.stopMeditation(s, nowMs);
        continue;
      }
      const { exp, full } = advanceTuVi(s.rec, dtMs * this.devSpeed, this.envOf(id));
      s.rec = { ...s.rec, exp };
      s.dirty = true;
      if (full)
        this.stopMeditation(s, nowMs); // stage requirement reached: ready to break through
      else if (nowMs - s.lastSentMs >= c.PROGRESS_INTERVAL_MS) this.queueState(s, nowMs);
    }
    for (const s of this.sessions.values())
      if (s.dirty && s.rec && !s.saving && nowMs - s.lastSaveMs >= c.AUTOSAVE_MS) {
        s.lastSaveMs = nowMs;
        void this.save(s);
      }
    return this.outbox.splice(0);
  }

  private stopMeditation(s: Session, nowMs: number): void {
    if (!s.meditating) return;
    s.meditating = false;
    this.meditators.delete(s.entityId);
    s.dirty = true;
    this.queueState(s, nowMs);
    if (s.rec) void this.save(s);
  }

  private stateMsg(s: Session, r: ProgressRecord): CharStateMsg {
    const req = tuViRequired(r);
    return {
      type: 'char_state',
      stage: stageOf(r),
      flags:
        (s.meditating ? CHAR_FLAG.MEDITATING : 0) |
        (!isMaxStage(r) && r.exp >= req ? CHAR_FLAG.BREAKTHROUGH_READY : 0) |
        (isMaxStage(r) ? CHAR_FLAG.MAX_STAGE : 0),
      nFail: Math.min(255, r.nFail),
      rootType: ROOT_TYPES.findIndex((t) => t.id === r.spiritRoot.type),
      elements: elementMask(r.spiritRoot),
      mutation:
        r.spiritRoot.mutation === 'phong'
          ? 1
          : r.spiritRoot.mutation === 'loi'
            ? 2
            : r.spiritRoot.mutation === 'bang'
              ? 3
              : 0,
      karma: r.karma,
      tuVi: r.exp,
      tuViReq: req,
    };
  }

  private queueState(s: Session, nowMs?: number): void {
    if (!s.rec) return;
    s.lastSentMs = nowMs ?? s.lastSentMs;
    s.lastSentExp = s.rec.exp;
    this.outbox.push({ entityId: s.entityId, msg: this.stateMsg(s, s.rec) });
  }

  /**
   * Write the record with optimistic concurrency. One write at a time per player: a change made while a write is in
   * flight is written right after it, so the stored version always follows the in-memory state. A version conflict
   * means something else wrote this character: reload the stored version once and write again (the online session is
   * the authoritative writer of its character); a second conflict is reported through `onPersistFailure` instead of
   * continuing silently without persistence.
   */
  private save(s: Session): Promise<void> {
    if (s.saving) {
      s.resave = true;
      return s.savePromise!;
    }
    s.saving = true;
    const run: Promise<void> = (async () => {
      try {
        let conflicts = 0;
        do {
          s.resave = false;
          const rec = s.rec;
          if (!rec) break;
          const next = { ...rec, version: s.version + 1 };
          const ok = await this.store.save(next, s.version);
          if (!ok) {
            this.metrics.saveConflicts++;
            const latest = await this.store.load(s.characterId);
            if (conflicts++ < 1 && latest) {
              s.version = latest.version;
              s.resave = true;
              continue;
            }
            this.metrics.saveFailures++;
            this.onPersistFailure?.(s.entityId);
            break;
          }
          this.metrics.saves++;
          s.version = next.version;
          s.dirty = s.rec !== rec; // changed again while writing: still dirty
          if (s.dirty) s.resave = true;
        } while (s.resave);
      } finally {
        s.saving = false;
        // deferred: when the body finished without awaiting, `run` is not assigned yet
        void Promise.resolve().then(() => {
          if (this.pendingWrites.get(s.characterId) === run) this.pendingWrites.delete(s.characterId);
        });
      }
    })();
    s.savePromise = run;
    this.pendingWrites.set(s.characterId, run);
    return run;
  }
}
