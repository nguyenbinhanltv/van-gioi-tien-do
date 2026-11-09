/**
 * Minimal alchemy on the server (D108, docs/13 §4-§6, §9): the craft jobs of the players standing at the furnace NPC.
 *
 *  - a job is `count` (1..QUEUE_MAX) crafts of one recipe, one every `ALCHEMY.CRAFT_MS` of sim time; nothing is consumed until a craft
 *    COMPLETES, so cancelling (the player moves, enters combat, walks away from the furnace, asks to stop) never loses anything;
 *  - each completed craft is one atomic exchange in `InventoryService.craftExchange`: materials destroyed, furnace fee posted to the ledger
 *    (wallet -> `SYSTEM_SINK_CRAFT_FEE`), product added; a failed roll destroys 60 % of the materials and still pays the fee;
 *  - the roll is seeded from the server seed and a per-character SERVER counter (`craftNonce`, persisted), never from anything the client
 *    sends: a client cannot replay or scan for a good roll, and a reused command id is refused; every roll is recorded (`log`, plus `onLog`);
 *  - the server decides everything: realm, recipe, distance to the furnace, materials, stones, room in the bag, rate of commands.
 *
 * Deterministic: time comes from the caller (sim time), randomness from the seeded RNG. In-game items and stones only.
 */
import {
  CraftOp,
  CraftOutcome,
  CraftReason,
  CRAFT_ANSWER_INDEX,
  quantizePos,
  type ColdServerMessage,
  type CraftCmdMsg,
  type CraftResultMsg,
  type CraftStateMsg,
} from '@vgtd/protocol';
import {
  ALCHEMY,
  craftFee,
  craftScore,
  craftSuccessChance,
  failedMaterialLoss,
  itemDefByKey,
  masteryGain,
  recipeByWireId,
  RECIPES,
  rngFork,
  rngSeed,
  rollCraft,
  type Recipe,
} from '@vgtd/shared';
import type { InventoryService } from '../world/inventory/index.js';
import type { ProgressionService } from '../progression/service.js';

export interface CraftOutbound {
  readonly entityId: number;
  readonly msg: ColdServerMessage;
}

/** One recorded craft roll (docs/13 §4: every roll is logged for complaints). Internal: never sent to a client. */
export interface CraftLogEntry {
  characterId: string;
  requestId: string;
  index: number;
  recipe: string;
  score: number;
  chance: number;
  drawA: number;
  drawsB: readonly number[];
  success: boolean;
  quality: number;
  fee: number;
  lost: number;
  tick: number;
}

export const CRAFT_CONFIG = {
  /** commands per second a player may send: a token bucket (burst, refill per s). PROVISIONAL */
  CMD_BURST: 5,
  CMD_PER_S: 1,
  /** how many answers per player are kept for replay detection */
  ANSWERS_KEPT: 32,
  /** craft requestIds remembered per character in its saved record (a reused one is refused, also after a relog / restart) */
  REQUESTS_KEPT: 64,
  LOG_KEPT: 5000,
} as const;

export interface CraftServiceOptions {
  inventory: InventoryService;
  progression: ProgressionService;
  /** the furnace NPC position (tile space) */
  furnaceAt: { i: number; j: number };
  seed?: number;
  /** is this entity alive (a dead player cannot craft)? default: always */
  isAlive?: (entityId: number) => boolean;
  onLog?: (e: CraftLogEntry) => void;
  /** current world tick, for the log */
  tickOf?: () => number;
}

interface Job {
  requestId: string;
  recipe: Recipe;
  total: number;
  done: number;
  /** sim time the craft in progress completes */
  readyAtMs: number;
}
interface Session {
  readonly entityId: number;
  readonly accountId: string;
  job: Job | null;
  tokens: number;
  tokenMs: number;
  answers: Map<string, CraftResultMsg>;
  sentState: boolean;
}

const MATERIAL_KEY = 'craft_material' as const;

export class CraftService {
  readonly furnaceAt: { i: number; j: number };
  readonly log: CraftLogEntry[] = [];
  readonly metrics = { started: 0, succeeded: 0, failed: 0, cancelled: 0, rejected: 0 };
  private readonly sessions = new Map<number, Session>();
  private readonly baseRng: ReturnType<typeof rngFork>;
  private readonly materialDefId: number;

  constructor(private readonly o: CraftServiceOptions) {
    this.furnaceAt = o.furnaceAt;
    this.baseRng = rngFork(rngSeed(o.seed ?? 1), 'craft');
    this.materialDefId = itemDefByKey(MATERIAL_KEY)!.id;
  }

  join(entityId: number, accountId: string, nowMs = 0): void {
    this.sessions.set(entityId, {
      entityId,
      accountId,
      job: null,
      tokens: CRAFT_CONFIG.CMD_BURST,
      tokenMs: nowMs,
      answers: new Map(),
      sentState: false,
    });
  }
  leave(entityId: number): void {
    this.sessions.delete(entityId);
  }
  has(entityId: number): boolean {
    return this.sessions.has(entityId);
  }

  /** The player's craft_state (null until its progression profile is loaded). */
  stateOf(entityId: number, nowMs: number): CraftStateMsg | null {
    const s = this.sessions.get(entityId);
    if (!s || !this.o.progression.recordOf(entityId)) return null;
    const mastery = this.o.progression.masteryAll(entityId);
    return {
      type: 'craft_state',
      furnaceQi: quantizePos(this.furnaceAt.i),
      furnaceQj: quantizePos(this.furnaceAt.j),
      job: s.job
        ? {
            recipeId: s.job.recipe.wireId,
            done: s.job.done,
            total: s.job.total,
            remainingMs: Math.min(65_535, Math.max(0, Math.round(s.job.readyAtMs - nowMs))),
          }
        : { recipeId: 0, done: 0, total: 0, remainingMs: 0 },
      mastery: RECIPES.filter((r) => (mastery[r.key] ?? 0) > 0).map((r) => ({
        recipeId: r.wireId,
        points: mastery[r.key]!,
      })),
    };
  }

  // ------------------------------------------------------------------ commands
  handle(entityId: number, msg: CraftCmdMsg, nowMs: number, pos: { i: number; j: number } | null): CraftOutbound[] {
    const s = this.sessions.get(entityId);
    if (!s) return [];
    const replay = s.answers.get(msg.requestId);
    if (replay) return [{ entityId, msg: replay }]; // the same requestId always gets the same answer
    const out: CraftOutbound[] = [];
    const answer = (
      outcome: CraftOutcome,
      reason: CraftReason,
      recipeId = msg.recipeId,
      extra: Partial<CraftResultMsg> = {},
    ): void => {
      const m: CraftResultMsg = {
        type: 'craft_result',
        requestId: msg.requestId,
        index: CRAFT_ANSWER_INDEX,
        outcome,
        reason,
        recipeId,
        quality: 0,
        qty: 0,
        lost: 0,
        ...extra,
      };
      this.remember(s, m);
      if (outcome === CraftOutcome.Rejected) this.metrics.rejected++;
      out.push({ entityId, msg: m });
    };
    // command rate (a bucket per player)
    s.tokens = Math.min(CRAFT_CONFIG.CMD_BURST, s.tokens + ((nowMs - s.tokenMs) * CRAFT_CONFIG.CMD_PER_S) / 1000);
    s.tokenMs = nowMs;
    if (s.tokens < 1) {
      answer(CraftOutcome.Rejected, CraftReason.RateLimited);
      return out;
    }
    s.tokens -= 1;

    if (msg.op === CraftOp.Cancel) {
      if (s.job) out.push(...this.cancel(s, CraftReason.ByPlayer, nowMs, msg.requestId));
      else answer(CraftOutcome.Cancelled, CraftReason.Ok, 0);
      return out;
    }
    // Start: a command id is single use. Within a session the stored answer is replayed (above); an id this character used before (an older
    // one, or before a relog / restart) is refused, so no client-chosen value can ever repeat a craft.
    if (this.o.progression.seenCraftRequest(entityId, msg.requestId)) {
      answer(CraftOutcome.Rejected, CraftReason.Replayed);
      return out;
    }
    const recipe = recipeByWireId(msg.recipeId);
    const why = this.refusal(s, recipe, msg.count, pos);
    if (why !== CraftReason.Ok || !recipe) {
      answer(CraftOutcome.Rejected, why === CraftReason.Ok ? CraftReason.UnknownRecipe : why);
      return out;
    }
    this.o.progression.rememberCraftRequest(entityId, msg.requestId, CRAFT_CONFIG.REQUESTS_KEPT);
    s.job = { requestId: msg.requestId, recipe, total: msg.count, done: 0, readyAtMs: nowMs + ALCHEMY.CRAFT_MS };
    this.metrics.started++;
    answer(CraftOutcome.Accepted, CraftReason.Ok);
    this.pushState(out, s, nowMs);
    return out;
  }

  /** Why a Start (or the next craft of a running job) cannot happen now; `Ok` = it can. */
  private refusal(
    s: Session,
    recipe: Recipe | undefined,
    count: number,
    pos: { i: number; j: number } | null,
  ): CraftReason {
    const rec = this.o.progression.recordOf(s.entityId);
    if (!rec) return CraftReason.NotReady;
    if (s.job && count > 0) return CraftReason.Busy;
    if (!recipe) return CraftReason.UnknownRecipe;
    if (count < 1 || count > ALCHEMY.QUEUE_MAX) return CraftReason.BadCount;
    if (this.o.isAlive && !this.o.isAlive(s.entityId)) return CraftReason.Dead;
    if (!pos || Math.hypot(pos.i - this.furnaceAt.i, pos.j - this.furnaceAt.j) > ALCHEMY.FURNACE_RANGE_TILES)
      return CraftReason.TooFar;
    if (rec.realm < ALCHEMY.MIN_REALM || rec.realm < recipe.tier) return CraftReason.RealmTooLow;
    return this.stockReason(s, recipe);
  }
  private stockReason(s: Session, recipe: Recipe): CraftReason {
    const produce = this.productOf(recipe, recipe.qualityCap);
    const r = this.o.inventory.canCraft(
      s.accountId,
      this.materialDefId,
      recipe.materials,
      BigInt(craftFee(recipe)),
      produce,
    );
    if (r.ok) return CraftReason.Ok;
    return r.reason === 'NOT_ENOUGH_MATERIALS'
      ? CraftReason.NotEnoughMaterials
      : r.reason === 'NOT_ENOUGH_STONES'
        ? CraftReason.NotEnoughStones
        : CraftReason.BagFull;
  }
  private productOf(recipe: Recipe, quality: number): { defId: number; quality: number; qty: number } {
    return { defId: itemDefByKey(recipe.output)!.id, quality, qty: 1 };
  }

  /** The player moved or entered combat: the job is cancelled, nothing was consumed. */
  onMove(entityId: number, nowMs: number): CraftOutbound[] {
    const s = this.sessions.get(entityId);
    return s?.job ? this.cancel(s, CraftReason.Moved, nowMs) : [];
  }
  onCombat(entityId: number, nowMs: number): CraftOutbound[] {
    const s = this.sessions.get(entityId);
    return s?.job ? this.cancel(s, CraftReason.InCombat, nowMs) : [];
  }

  private cancel(s: Session, reason: CraftReason, nowMs: number, requestId?: string): CraftOutbound[] {
    const job = s.job;
    if (!job) return [];
    s.job = null;
    this.metrics.cancelled++;
    const m: CraftResultMsg = {
      type: 'craft_result',
      requestId: requestId ?? job.requestId,
      index: job.done,
      outcome: CraftOutcome.Cancelled,
      reason,
      recipeId: job.recipe.wireId,
      quality: 0,
      qty: 0,
      lost: 0,
    };
    if (requestId) this.remember(s, m);
    const out: CraftOutbound[] = [{ entityId: s.entityId, msg: m }];
    this.pushState(out, s, nowMs);
    return out;
  }

  // ------------------------------------------------------------------ the clock
  /** One world tick: complete the crafts that are due, send the first craft_state of a player whose profile just loaded. */
  tick(nowMs: number, posOf: (entityId: number) => { i: number; j: number } | null): CraftOutbound[] {
    const out: CraftOutbound[] = [];
    for (const s of this.sessions.values()) {
      if (!s.sentState && this.o.progression.recordOf(s.entityId)) {
        s.sentState = true;
        this.pushState(out, s, nowMs);
      }
      const job = s.job;
      if (!job || nowMs < job.readyAtMs) continue;
      // the craft is due: everything is checked again NOW (the player may have walked away, spent the stones, filled the bag)
      const why = this.refusal({ ...s, job: null }, job.recipe, 1, posOf(s.entityId));
      if (why !== CraftReason.Ok) {
        out.push(...this.cancel(s, why === CraftReason.TooFar ? CraftReason.Interrupted : why, nowMs));
        continue;
      }
      this.complete(s, job, nowMs, out);
    }
    return out;
  }

  private complete(s: Session, job: Job, nowMs: number, out: CraftOutbound[]): void {
    const { recipe } = job;
    const mastery = this.o.progression.masteryOf(s.entityId, recipe.key);
    const score = craftScore(mastery);
    // the roll is seeded from a SERVER counter of this character, never from the (client-chosen) requestId
    const nonce = this.o.progression.takeCraftNonce(s.entityId);
    if (nonce === null) {
      out.push(...this.cancel(s, CraftReason.NotReady, nowMs));
      return;
    }
    const [roll] = rollCraft(recipe, score, rngFork(this.baseRng, `${s.accountId}|n${nonce}`));
    const fee = craftFee(recipe);
    const lost = roll.success ? recipe.materials : failedMaterialLoss(recipe.materials);
    const ex = this.o.inventory.craftExchange(s.accountId, {
      key: `${s.accountId}:n${nonce}`,
      materialDefId: this.materialDefId,
      consume: lost,
      fee: BigInt(fee),
      produce: roll.success ? this.productOf(recipe, roll.quality) : null,
    });
    if (!ex.ok) {
      // the stock changed between the check and the exchange (cannot happen in one tick, but never half-apply): stop the job
      out.push(
        ...this.cancel(
          s,
          ex.reason === 'NOT_ENOUGH_MATERIALS'
            ? CraftReason.NotEnoughMaterials
            : ex.reason === 'NOT_ENOUGH_STONES'
              ? CraftReason.NotEnoughStones
              : CraftReason.BagFull,
          nowMs,
        ),
      );
      return;
    }
    if (ex.replayed) {
      // this nonce was already applied: nothing changed in the bag or the ledger, so this is NOT a craft (no mastery, no log, no success message)
      out.push(...this.cancel(s, CraftReason.Interrupted, nowMs));
      return;
    }
    if (roll.success) {
      this.o.progression.addMastery(s.entityId, recipe.key, masteryGain(mastery), ALCHEMY.MASTERY_MAX);
      this.metrics.succeeded++;
    } else this.metrics.failed++;
    const entry: CraftLogEntry = {
      characterId: s.accountId,
      requestId: job.requestId,
      index: job.done,
      recipe: recipe.key,
      score,
      chance: craftSuccessChance(recipe.difficulty, score),
      drawA: roll.drawA,
      drawsB: roll.drawsB,
      success: roll.success,
      quality: roll.quality,
      fee,
      lost: roll.success ? 0 : lost,
      tick: this.o.tickOf?.() ?? 0,
    };
    this.log.push(entry);
    if (this.log.length > CRAFT_CONFIG.LOG_KEPT) this.log.shift();
    this.o.onLog?.(entry);
    out.push({
      entityId: s.entityId,
      msg: {
        type: 'craft_result',
        requestId: job.requestId,
        index: job.done,
        outcome: roll.success ? CraftOutcome.Success : CraftOutcome.Failed,
        reason: CraftReason.Ok,
        recipeId: recipe.wireId,
        quality: roll.success ? roll.quality : 0,
        qty: roll.success ? 1 : 0,
        lost: roll.success ? 0 : lost,
      },
    });
    job.done++;
    if (job.done >= job.total) s.job = null;
    else job.readyAtMs = nowMs + ALCHEMY.CRAFT_MS;
    this.pushState(out, s, nowMs);
  }

  private pushState(out: CraftOutbound[], s: Session, nowMs: number): void {
    const st = this.stateOf(s.entityId, nowMs);
    if (st) out.push({ entityId: s.entityId, msg: st });
  }
  private remember(s: Session, m: CraftResultMsg): void {
    s.answers.set(m.requestId, m);
    if (s.answers.size > CRAFT_CONFIG.ANSWERS_KEPT) s.answers.delete(s.answers.keys().next().value as string);
  }
}
