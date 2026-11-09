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
  PROGRESSION_LIMITS,
  ProgressionReason,
  type BreakthroughResultMsg,
  type CharStateMsg,
  type BreakthroughStartMsg,
  type MeditateStartMsg,
  type MeditateStopMsg,
  type ColdServerMessage,
  type MeditateResultMsg,
} from '@vgtd/protocol';
import {
  DAO_TAM,
  ConsequenceTier,
  DEFAULT_CLASS,
  MAJOR_EVENT,
  MajorPhase,
  MajorResult,
  NETWORK,
  ROOT_TYPES,
  applyKarmaEvent,
  TIER_EXP_LOSS,
  consequenceTier,
  majorEventOf,
  tierLockMs,
  breakthroughPillChance,
  clampDaoTam,
  effectiveDaoTam,
  nghiepAnhCount,
  parseClass,
  rngFloat,
  rngFork,
  rngSeed,
  type KarmaEventId,
  type PathId,
  type RngState,
} from '@vgtd/shared';
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

/** What the major-event module needs to start an event (D97). */
export interface MajorStartInfo {
  entityId: number;
  requestId: string;
  realm: number;
  subRealm: number;
  karma: number;
  /** Đạo Tâm that counts (D103: under the ceiling of the Nghiệp band); omitted = `MAJOR_EVENT.DEFAULT_DAO_TAM` */
  daoTam?: number;
  nFail: number;
  fromStage: number;
  toStage: number;
  nowMs: number;
}
/** The world-node side of a major breakthrough: Tâm Ma shadow, bolts, timers (apps/server world/breakthrough). */
export interface MajorEventPort {
  /** can the event start for this entity right now? `Ok` = yes; otherwise the reason the attempt is refused (nothing is consumed) */
  canStart(entityId: number): ProgressionReason;
  /** begin the event; it ends with `ProgressionService.finishMajor` */
  start(info: MajorStartInfo): void;
}
/** How a major event ended, reported back by the event module. */
export interface MajorFinish {
  result: MajorResult;
  /** Lôi Kiếp: waves fully survived / total waves (for the consequence tier); 0 / 0 without a Kiếp */
  wavesSurvived: number;
  waves: number;
  strengthPct: number;
}

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
  /** quality of the breakthrough pill waiting for the next attempt (D90); session-only, not persisted */
  pill: number | null;
  /** Đạo Tâm last sent to the client (-1 = nothing sent yet); `dao_tam` goes out when the value that counts changes (D103) */
  lastSentDao: number;
  /** a major event (Tâm Ma / Lôi Kiếp, D97) is running for this character */
  event: { requestId: string; chance: number } | null;
  /** sim time until which the major breakthrough is locked (D97), null = not locked; persisted as the remaining time */
  lockUntilMs: number | null;
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
  /** the world-node half of major events (D97); without it a major threshold with an event is refused (`TribulationRequired`) */
  private major: MajorEventPort | null = null;
  private readonly devSpeed: number;
  /** in-flight writes per character: a new session of the same character loads only after the previous one is stored */
  private readonly pendingWrites = new Map<string, Promise<void>>();
  /** per-character chain of `resolveClass` calls (two logins of one account must not both create the character) */
  private readonly classLocks = new Map<string, Promise<unknown>>();

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

  /** Let the world node provide the Tâm Ma / Lôi Kiếp event machinery (D97). */
  attachMajor(port: MajorEventPort): void {
    this.major = port;
  }
  private simNow(): number {
    return this.tickOf() * NETWORK.TICK_MS;
  }
  /** Is a major event running for this entity? */
  isEventActive(entityId: number): boolean {
    return this.sessions.get(entityId)?.event != null;
  }
  /** Remaining major-breakthrough lock (ms) of a character, 0 = none (tests / HUD). */
  majorLockLeftMs(entityId: number, nowMs: number): number {
    const l = this.sessions.get(entityId)?.lockUntilMs ?? null;
    return l === null ? 0 : Math.max(0, l - nowMs);
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
      pill: null,
      lastSentDao: -1,
      event: null,
      lockUntilMs: null,
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
          if ((loaded.majorLockMs ?? 0) > 0) s.lockUntilMs = this.simNow() + loaded.majorLockMs!;
        } else {
          // creation roll: seeded by the character id, so it does not depend on login order
          const [root] = rollSpiritRoot(rngFork(rngSeed(this.seed), `root:${characterId}`));
          s.rec = newRecord(characterId, root, DEFAULT_CLASS);
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

  /**
   * Class of a character, decided once (D82): the stored class wins; a character with none yet gets `requested` (a class path id or
   * wire id; anything else counts as absent) or `DEFAULT_CLASS`, and it is stored before this resolves, so the choice sticks. Calls
   * for one character run one at a time and wait for an in-flight write of the previous session. The gateway awaits this BEFORE it
   * adds the player, which is why the world node can build the combat profile synchronously.
   */
  resolveClass(characterId: string, requested?: unknown): Promise<PathId> {
    const ask = parseClass(requested);
    const prev = this.classLocks.get(characterId) ?? Promise.resolve();
    const run = prev
      .catch(() => undefined)
      .then(async (): Promise<PathId> => {
        await (this.pendingWrites.get(characterId) ?? Promise.resolve());
        for (let attempt = 0; attempt < 3; attempt++) {
          const stored = await this.store.load(characterId);
          if (stored?.classId) return stored.classId;
          const classId = ask ?? DEFAULT_CLASS;
          const next: ProgressRecord = stored
            ? { ...stored, classId, version: stored.version + 1 } // a record from before D82 gets its class now
            : {
                ...newRecord(
                  characterId,
                  rollSpiritRoot(rngFork(rngSeed(this.seed), `root:${characterId}`))[0],
                  classId,
                ),
                version: 1,
              };
          if (await this.store.save(next, stored?.version ?? 0)) return classId;
          this.metrics.saveConflicts++; // somebody else wrote meanwhile: look again (their class wins)
        }
        throw new Error(`cannot store the class of ${characterId}`);
      });
    this.classLocks.set(characterId, run);
    const done = (): void => {
      if (this.classLocks.get(characterId) === run) this.classLocks.delete(characterId);
    };
    run.then(done, done);
    return run;
  }
  /** Class of a joined player (the stored one once its profile is loaded, else the default). */
  classOf(entityId: number): PathId {
    return this.sessions.get(entityId)?.rec?.classId ?? DEFAULT_CLASS;
  }

  /** char_state of a player (null until the profile is loaded). */
  stateOf(entityId: number): CharStateMsg | null {
    const s = this.sessions.get(entityId);
    return s?.rec ? this.stateMsg(s, s.rec) : null;
  }
  recordOf(entityId: number): ProgressRecord | null {
    return this.sessions.get(entityId)?.rec ?? null;
  }
  /** Alchemy mastery points (0..100) of a recipe key (D108); 0 for a character without any or before its profile loads. */
  masteryOf(entityId: number, recipeKey: string): number {
    return this.sessions.get(entityId)?.rec?.craftMastery?.[recipeKey] ?? 0;
  }
  /** The next craft nonce of a character (never repeats, persisted): the only thing a craft roll is seeded from besides the server seed. Null when not loaded. */
  takeCraftNonce(entityId: number): number | null {
    const s = this.sessions.get(entityId);
    if (!s?.rec) return null;
    const n = (s.rec.craftNonce ?? 0) + 1;
    s.rec = { ...s.rec, craftNonce: n };
    s.dirty = true;
    void this.save(s);
    return n;
  }
  /** Has this character already used `requestId` for a craft command (one of its last `craftRequests` ids)? */
  seenCraftRequest(entityId: number, requestId: string): boolean {
    return this.sessions.get(entityId)?.rec?.craftRequests?.includes(requestId) ?? false;
  }
  /** Remember a craft requestId (a ring of the last `keep`), persisted. */
  rememberCraftRequest(entityId: number, requestId: string, keep: number): void {
    const s = this.sessions.get(entityId);
    if (!s?.rec) return;
    const ring = [...(s.rec.craftRequests ?? []).filter((x) => x !== requestId), requestId].slice(-keep);
    s.rec = { ...s.rec, craftRequests: ring };
    s.dirty = true;
    void this.save(s);
  }
  /** All the character's mastery entries (recipe key -> points). */
  masteryAll(entityId: number): Readonly<Record<string, number>> {
    return this.sessions.get(entityId)?.rec?.craftMastery ?? {};
  }
  /** Add mastery points to a recipe (capped at `max`), saved like every progression change. Returns the new total, or null when not loaded. */
  addMastery(entityId: number, recipeKey: string, points: number, max: number): number | null {
    const s = this.sessions.get(entityId);
    if (!s?.rec) return null;
    const cur = s.rec.craftMastery?.[recipeKey] ?? 0;
    const next = Math.min(max, Math.max(0, cur + Math.trunc(points)));
    if (next !== cur) {
      s.rec = { ...s.rec, craftMastery: { ...s.rec.craftMastery, [recipeKey]: next } };
      s.dirty = true;
      void this.save(s);
    }
    return next;
  }

  // ------------------------------------------------------------------ Nghiệp Lực / Đạo Tâm (D103)
  /** Nghiệp Lực K of a joined player (0 until the profile is loaded). */
  karmaOf(entityId: number): number {
    return this.sessions.get(entityId)?.rec?.karma ?? 0;
  }
  /** The Đạo Tâm that counts for a joined player: the stored value under the ceiling of its Nghiệp band (the start value until loaded). */
  daoTamOf(entityId: number): number {
    const r = this.sessions.get(entityId)?.rec;
    return r ? effectiveDaoTam(r.daoTam ?? DAO_TAM.START, r.karma) : DAO_TAM.START;
  }
  /**
   * What the Tâm Ma needs (docs/01 §5.3): `tamMaStrength(inputs.daoTam, inputs.karma)`, plus the number of Nghiệp Ảnh shadows. This is the
   * adapter the major-breakthrough module calls instead of its provisional constant.
   */
  tamMaInputs(entityId: number): { karma: number; daoTam: number; nghiepAnh: number } {
    const karma = this.karmaOf(entityId);
    return { karma, daoTam: this.daoTamOf(entityId), nghiepAnh: nghiepAnhCount(karma) };
  }
  /**
   * Apply a documented K event (docs/14 §3.3) to a joined player. `day` is the server day number (the daily gain budget resets when it
   * changes). Returns the new K and the change, or null when the profile is not loaded. Persisted like every progression change.
   */
  applyKarma(entityId: number, event: KarmaEventId, day: number): { karma: number; delta: number } | null {
    const s = this.sessions.get(entityId);
    if (!s?.rec) return null;
    const r = s.rec;
    const used = r.karmaGain && r.karmaGain.day === day ? r.karmaGain.gained : 0;
    const out = applyKarmaEvent(r.karma, event, used);
    if (out.delta === 0 && out.gained === 0) return { karma: r.karma, delta: 0 };
    s.rec = {
      ...r,
      karma: out.karma,
      karmaGain:
        out.gained > 0 || (r.karmaGain && r.karmaGain.day === day) ? { day, gained: used + out.gained } : r.karmaGain,
    };
    this.changed(s);
    return { karma: out.karma, delta: out.delta };
  }
  /** Change the stored Đạo Tâm by `delta` (clamped 0..100). Returns the value that counts afterwards, or null when not loaded. */
  adjustDaoTam(entityId: number, delta: number): number | null {
    const s = this.sessions.get(entityId);
    if (!s?.rec) return null;
    const next = clampDaoTam((s.rec.daoTam ?? DAO_TAM.START) + delta);
    if (next !== (s.rec.daoTam ?? DAO_TAM.START)) {
      s.rec = { ...s.rec, daoTam: next };
      this.changed(s);
    }
    return this.daoTamOf(entityId);
  }
  private changed(s: Session): void {
    s.dirty = true;
    void this.save(s);
    this.queueState(s);
  }
  /**
   * A breakthrough pill (D90) of `quality` is drunk: its bonus applies to the NEXT breakthrough attempt of this character. One at a
   * time; session-only (not persisted). 'ok' = accepted (the caller consumes the item), otherwise nothing changed.
   */
  addBreakthroughPill(entityId: number, quality: number): 'ok' | 'not_ready' | 'active' {
    const s = this.sessions.get(entityId);
    if (!s?.rec) return 'not_ready';
    if (s.pill !== null) return 'active';
    s.pill = quality;
    return 'ok';
  }
  /** Quality of the waiting breakthrough pill, or null (tests / diagnostics). */
  pendingPill(entityId: number): number | null {
    return this.sessions.get(entityId)?.pill ?? null;
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
  handle(entityId: number, msg: BreakthroughStartMsg | MeditateStartMsg | MeditateStopMsg, nowMs: number): Outbound[] {
    const s = this.sessions.get(entityId);
    if (!s) return [];
    const cached = s.answers.get(msg.requestId);
    if (cached) return [{ entityId, msg: cached }]; // idempotent re-send: same answer, no second roll
    let reply: ColdServerMessage | null;
    if (msg.type === 'breakthrough_start') reply = this.breakthrough(s, msg.requestId, nowMs);
    else reply = this.meditateCommand(s, msg.type === 'meditate_start', msg.requestId, nowMs);
    // only a rolled breakthrough is cached: a re-send after a lost reply must not roll twice (docs/24 §5.1)
    if (reply && reply.type === 'breakthrough_result' && reply.outcome !== BreakthroughOutcome.Rejected) {
      s.answers.set(msg.requestId, reply);
      if (s.answers.size > PROGRESSION_CONFIG.RESULT_CACHE) s.answers.delete(s.answers.keys().next().value as string);
    }
    const out: Outbound[] = reply ? [{ entityId, msg: reply }] : []; // null: a major event started, its result comes when it ends
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
    if (s.event) return ProgressionReason.EventActive;
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

  private breakthrough(s: Session, requestId: string, nowMs: number): BreakthroughResultMsg | null {
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
    const ev = plan.kind === 'major' ? majorEventOf(r.realm) : undefined;
    if (plan.kind === 'major') {
      // major thresholds (D97): the MVP ones run a server-side event; `allowMajorBreakthrough` (tests) keeps the old instant roll
      if (s.lockUntilMs !== null && nowMs < s.lockUntilMs) return rejected(ProgressionReason.Locked);
      const eventRuns = !!this.major && !!ev && ev.kind !== 'none';
      if (!eventRuns && !this.allowMajor && !(this.major && ev?.kind === 'none'))
        return rejected(ProgressionReason.TribulationRequired);
    }
    if (nowMs - s.lastAttemptMs < PROGRESSION_CONFIG.BREAKTHROUGH_COOLDOWN_MS)
      return rejected(ProgressionReason.Cooldown);
    if (r.exp < tuViRequired(r)) return rejected(ProgressionReason.NotEnoughTuVi);

    if (plan.kind === 'major' && this.major && ev && ev.kind !== 'none') {
      const ready = this.major.canStart(s.entityId);
      if (ready !== ProgressionReason.Ok) return rejected(ready);
      if (s.meditating) this.stopMeditation(s, nowMs);
      s.lastAttemptMs = nowMs;
      s.event = { requestId, chance: 0 };
      this.major.start({
        entityId: s.entityId,
        requestId,
        realm: r.realm,
        subRealm: r.subRealm,
        karma: r.karma,
        daoTam: effectiveDaoTam(r.daoTam ?? DAO_TAM.START, r.karma),
        nFail: r.nFail,
        fromStage: plan.fromStage,
        toStage: plan.toStage,
        nowMs,
      });
      return null; // the answer comes with `finishMajor`
    }
    if (s.meditating) this.stopMeditation(s, nowMs);
    s.lastAttemptMs = nowMs;
    let draw: number;
    [draw, this.rng] = rngFloat(this.rng);
    const chance = s.pill === null ? plan.chance : breakthroughPillChance(plan.chance, s.pill);
    s.pill = null; // the pill is spent by the attempt, whatever the outcome
    const success = draw < chance;
    this.rollLog.append({
      stream: 'breakthrough',
      tick: this.tickOf(),
      characterId: s.characterId,
      kind: plan.kind,
      fromStage: plan.fromStage,
      chance,
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
      chance: Math.round(chance * 10_000),
      nFail: next.nFail,
    };
  }

  // ------------------------------------------------------------------ major events (D97)
  /**
   * The Thiên Mệnh roll of a running major event: the same success chance, pill bonus, `breakthrough` PRNG stream and roll log as an
   * ordinary breakthrough (docs/07 §2). Returns null when there is no running event.
   */
  rollDestiny(entityId: number): { success: boolean; chance: number; draw: number } | null {
    const s = this.sessions.get(entityId);
    if (!s?.rec || !s.event) return null;
    const plan = planBreakthrough(s.rec);
    if (!plan) return null;
    let draw: number;
    [draw, this.rng] = rngFloat(this.rng);
    const chance = s.pill === null ? plan.chance : breakthroughPillChance(plan.chance, s.pill);
    s.pill = null; // spent by the attempt, whatever the outcome
    const success = draw < chance;
    s.event.chance = chance;
    this.rollLog.append({
      stream: 'breakthrough',
      tick: this.tickOf(),
      characterId: s.characterId,
      kind: 'major',
      fromStage: plan.fromStage,
      chance,
      draw,
      success,
      nFailBefore: s.rec.nFail,
    });
    this.metrics.breakthroughs++;
    return { success, chance, draw };
  }

  /**
   * A major event ended: apply the outcome (stage up / pity / tu vi loss / lock), persist it, answer the `breakthrough_start` that began
   * it with the normal `breakthrough_result` and tell the client how it ended with the final `major_event`. Returns the messages to send.
   */
  finishMajor(entityId: number, f: MajorFinish, nowMs: number): Outbound[] {
    const s = this.sessions.get(entityId);
    if (!s?.rec || !s.event) return [];
    const r = s.rec;
    const plan = planBreakthrough(r)!;
    const requestId = s.event.requestId;
    const chance = s.event.chance;
    s.event = null;
    let next = r;
    let tier = ConsequenceTier.None;
    let lockMs = 0;
    let expLost = 0;
    if (f.result === MajorResult.Success) {
      next = applyBreakthrough(r, plan, true);
      this.metrics.successes++;
    } else if (f.result === MajorResult.TamMaLost) {
      lockMs = MAJOR_EVENT.TAM_MA_LOSS_LOCK_MS; // no roll happened: the pity counter is not touched (docs/01 §5.2)
    } else if (f.result === MajorResult.RollFailed) {
      next = applyBreakthrough(r, plan, false);
    } else if (f.result === MajorResult.Died) {
      next = applyBreakthrough(r, plan, false);
      tier = consequenceTier(f.wavesSurvived, f.waves);
      const frac = TIER_EXP_LOSS[tier];
      expLost = frac;
      next = { ...next, exp: Math.floor(next.exp * (1 - frac)) };
      lockMs = tierLockMs(tier);
    }
    if (lockMs > 0) {
      s.lockUntilMs = nowMs + lockMs;
      next = { ...next, majorLockMs: lockMs };
    }
    s.rec = next;
    s.dirty = true;
    s.lastAttemptMs = nowMs;
    const success = f.result === MajorResult.Success;
    if (success) this.onStageChange?.(entityId, next.realm, next.subRealm);
    void this.save(s);
    this.queueState(s);
    const result: BreakthroughResultMsg = {
      type: 'breakthrough_result',
      requestId,
      outcome: success ? BreakthroughOutcome.Success : BreakthroughOutcome.Failure,
      kind: BreakthroughKind.Major,
      reason: ProgressionReason.Ok,
      fromStage: plan.fromStage,
      toStage: success ? plan.toStage : plan.fromStage,
      chance: Math.round(chance * PROGRESSION_LIMITS.CHANCE_SCALE),
      nFail: next.nFail,
    };
    s.answers.set(requestId, result);
    if (s.answers.size > PROGRESSION_CONFIG.RESULT_CACHE) s.answers.delete(s.answers.keys().next().value as string);
    const out: Outbound[] = [
      {
        entityId,
        msg: {
          type: 'major_event',
          phase: MajorPhase.Ended,
          wave: f.wavesSurvived,
          waves: f.waves,
          remainingMs: 0,
          strengthPct: f.strengthPct,
          result: f.result,
          tier,
          expLostPct: Math.round(expLost * 100),
          lockMin: Math.round(lockMs / 60_000),
          tamMaId: 0,
        },
      },
      { entityId, msg: result },
    ];
    for (const o of this.outbox.splice(0)) out.push(o);
    return out;
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
    for (const s of this.sessions.values()) {
      if (s.lockUntilMs !== null && nowMs >= s.lockUntilMs && s.rec) {
        s.lockUntilMs = null; // the lock ran out: forget it (and the stored remainder)
        if ((s.rec.majorLockMs ?? 0) > 0) {
          s.rec = { ...s.rec, majorLockMs: 0 };
          s.dirty = true;
        }
      }
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
    const dao = effectiveDaoTam(s.rec.daoTam ?? DAO_TAM.START, s.rec.karma);
    if (dao !== s.lastSentDao) {
      s.lastSentDao = dao;
      this.outbox.push({ entityId: s.entityId, msg: { type: 'dao_tam', daoTam: dao } });
    }
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
          // the stored lock is the time LEFT as of this write (it is re-based on load), so it keeps running through a restart
          const left = s.lockUntilMs === null ? 0 : Math.max(0, s.lockUntilMs - this.simNow());
          const next = {
            ...rec,
            version: s.version + 1,
            ...(left > 0 || rec.majorLockMs ? { majorLockMs: left } : {}),
          };
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
