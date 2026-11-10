/**
 * Crafting model (D108): what the client knows about alchemy, fed by the server's `craft_state` / `craft_result`. Engine-free and DOM-free: the
 * Cocos crafting panel only renders `recipes()`, `job()` and `toast()`. The server stays authoritative (realm, distance to the furnace, materials,
 * stones, bag room, the roll itself); this model shows the numbers of docs/13 from `@vgtd/shared` (the same formulas the server uses) so the player
 * can see the chance and the cost before pressing the button, and keeps no rules of its own: a button that looks enabled can still be refused.
 */
import {
  ALCHEMY,
  QUALITY_TIERS,
  RECIPES,
  craftFee,
  craftScore,
  craftSuccessChance,
  itemDefByKey,
  recipeByWireId,
  type Recipe,
} from '@vgtd/shared';
import {
  CRAFT_ANSWER_INDEX,
  CraftOp,
  CraftOutcome,
  CraftReason,
  type CraftJobView,
  type CraftResultMsg,
  type CraftStateMsg,
} from '@vgtd/protocol';
import { reasonTexts, t } from '../i18n/strings.js';

/** re-exported so engine scripts (which only see client-core) can name the ops */
export { CraftOp } from '@vgtd/protocol';

/** Text of every refusal / cancel reason (user-facing, from the string table; `{max}` = longest queue). */
export const CRAFT_REASON_TEXT: Readonly<Record<number, string>> = reasonTexts(
  {
    [CraftReason.Ok]: null,
    [CraftReason.NotReady]: 'craft.reason.not_ready',
    [CraftReason.TooFar]: 'craft.reason.too_far',
    [CraftReason.RealmTooLow]: 'craft.reason.realm_too_low',
    [CraftReason.UnknownRecipe]: 'craft.reason.unknown_recipe',
    [CraftReason.NotEnoughMaterials]: 'craft.reason.no_materials',
    [CraftReason.NotEnoughStones]: 'craft.reason.no_stones',
    [CraftReason.BagFull]: 'craft.reason.bag_full',
    [CraftReason.Busy]: 'craft.reason.busy',
    [CraftReason.BadCount]: 'craft.reason.bad_count',
    [CraftReason.RateLimited]: 'craft.reason.rate_limited',
    [CraftReason.Moved]: 'craft.reason.moved',
    [CraftReason.InCombat]: 'craft.reason.in_combat',
    [CraftReason.ByPlayer]: 'craft.reason.by_player',
    [CraftReason.Dead]: 'craft.reason.dead',
    [CraftReason.Interrupted]: 'craft.reason.interrupted',
    [CraftReason.Replayed]: 'craft.reason.replayed',
  },
  () => ({ max: ALCHEMY.QUEUE_MAX }),
);

export interface RecipeView {
  readonly wireId: number;
  readonly key: string;
  readonly name: string;
  readonly tier: number;
  readonly difficulty: number;
  /** materials one craft needs, how many the bag holds */
  readonly materials: number;
  readonly have: number;
  /** furnace fee in Linh thạch hạ and the wallet balance */
  readonly fee: number;
  readonly stones: number;
  readonly mastery: number;
  readonly score: number;
  /** success chance 0..1 at the current mastery (docs/13 §4.2) */
  readonly chance: number;
  /** name of the best quality a craft can reach (the recipe's ceiling) */
  readonly capName: string;
  /** a client-side hint that the server will probably accept a start (it decides): realm, stock, stones, near the furnace, idle */
  readonly canStart: boolean;
}

export interface CraftModelOptions {
  now: () => number;
  /** 32 lowercase hex characters; injected so tests are deterministic */
  newRequestId: () => string;
  /** units of an item (by def id) in the bag, any quality */
  bagCount: (defId: number) => number;
  /** Linh thạch hạ balance */
  stones: () => number;
  /** the character's realm (1..9), or null before the profile loads */
  realm: () => number | null;
  toastMs?: number;
}

export interface CraftToast {
  readonly text: string;
  readonly tone: 'good' | 'bad' | 'info';
  readonly untilMs: number;
}

const MATERIAL_ID = itemDefByKey('craft_material')!.id;
const IDLE: CraftJobView = { recipeId: 0, done: 0, total: 0, remainingMs: 0 };

export class CraftModel {
  /** bumps on every change, so a view can redraw only when needed */
  version = 0;
  furnace: { i: number; j: number } | null = null;
  private jobView: CraftJobView = IDLE;
  private jobAt = 0;
  private points = new Map<number, number>();
  private msg: CraftToast | null = null;
  private pending: { id: string; at: number } | null = null;
  private seen = false;
  private readonly toastMs: number;

  constructor(private readonly o: CraftModelOptions) {
    this.toastMs = o.toastMs ?? 4500;
  }

  get ready(): boolean {
    return this.seen;
  }

  // ---------------------------------------------------------------- server -> model
  applyState(m: CraftStateMsg): void {
    this.seen = true;
    this.furnace = { i: m.furnaceQi / 32, j: m.furnaceQj / 32 };
    this.jobView = m.job;
    this.jobAt = this.o.now();
    this.points = new Map(m.mastery.map((e) => [e.recipeId, e.points]));
    this.version++;
  }

  applyResult(m: CraftResultMsg): void {
    if (m.index === CRAFT_ANSWER_INDEX && this.pending?.id === m.requestId) this.pending = null;
    const name = recipeByWireId(m.recipeId)?.name ?? t('craft.pill');
    switch (m.outcome) {
      case CraftOutcome.Rejected:
        this.say(CRAFT_REASON_TEXT[m.reason] || t('craft.toast.rejected'), 'bad');
        break;
      case CraftOutcome.Accepted:
        this.say(t('craft.toast.started', { name }), 'info');
        break;
      case CraftOutcome.Success:
        this.say(t('craft.toast.success', { name, quality: QUALITY_TIERS[m.quality]?.name ?? '?' }), 'good');
        break;
      case CraftOutcome.Failed:
        this.say(t('craft.toast.failed', { name, lost: m.lost }), 'bad');
        break;
      case CraftOutcome.Cancelled:
        this.say(CRAFT_REASON_TEXT[m.reason] || t('craft.toast.stopped'), 'info');
        break;
    }
  }

  private say(text: string, tone: CraftToast['tone']): void {
    this.msg = { text, tone, untilMs: this.o.now() + this.toastMs };
    this.version++;
  }

  // ---------------------------------------------------------------- queries
  toast(): CraftToast | null {
    if (this.msg && this.o.now() >= this.msg.untilMs) {
      this.msg = null;
      this.version++;
    }
    return this.msg;
  }
  /** The running job, with the time left counted down locally between server updates. */
  job(): (CraftJobView & { name: string }) | null {
    const j = this.jobView;
    if (j.recipeId === 0) return null;
    const left = Math.max(0, j.remainingMs - (this.o.now() - this.jobAt));
    return { ...j, remainingMs: left, name: recipeByWireId(j.recipeId)?.name ?? '' };
  }
  masteryOf(wireId: number): number {
    return this.points.get(wireId) ?? 0;
  }
  nearFurnace(pos: { i: number; j: number } | null): boolean {
    if (!pos || !this.furnace) return false;
    return Math.hypot(pos.i - this.furnace.i, pos.j - this.furnace.j) <= ALCHEMY.FURNACE_RANGE_TILES;
  }

  recipes(pos: { i: number; j: number } | null = null): RecipeView[] {
    const realm = this.o.realm();
    const have = this.o.bagCount(MATERIAL_ID);
    const stones = this.o.stones();
    const idle = this.jobView.recipeId === 0 && this.pending === null;
    const near = pos === null ? true : this.nearFurnace(pos);
    return RECIPES.map((r: Recipe) => {
      const mastery = this.masteryOf(r.wireId);
      const score = craftScore(mastery);
      const fee = craftFee(r);
      return {
        wireId: r.wireId,
        key: r.key,
        name: r.name,
        tier: r.tier,
        difficulty: r.difficulty,
        materials: r.materials,
        have,
        fee,
        stones,
        mastery,
        score,
        chance: craftSuccessChance(r.difficulty, score),
        capName: QUALITY_TIERS[r.qualityCap]?.name ?? '?',
        canStart:
          idle &&
          near &&
          realm !== null &&
          realm >= ALCHEMY.MIN_REALM &&
          realm >= r.tier &&
          have >= r.materials &&
          stones >= fee,
      };
    });
  }

  /** One line for the panel footer. */
  statusLine(pos: { i: number; j: number } | null): string {
    if (!this.seen) return t('craft.status.loading');
    if (!this.nearFurnace(pos)) return t('craft.status.too_far', { range: ALCHEMY.FURNACE_RANGE_TILES });
    const realm = this.o.realm();
    if (realm !== null && realm < ALCHEMY.MIN_REALM) return t('craft.status.realm');
    const j = this.job();
    if (j)
      return t('craft.status.running', {
        name: j.name,
        done: j.done,
        total: j.total,
        left: (j.remainingMs / 1000).toFixed(1),
      });
    return t('craft.status.pick');
  }

  // ---------------------------------------------------------------- model -> server
  /** Ask for `count` crafts; one command in flight (a lost answer times out after 5 s). `send` returns false when the socket is closed. */
  start(
    wireId: number,
    count: number,
    send: (m: { op: number; requestId: string; recipeId: number; count: number }) => boolean,
  ): boolean {
    const now = this.o.now();
    if (this.pending && now - this.pending.at < 5000) return false;
    if (this.jobView.recipeId !== 0) return false;
    const n = Math.min(ALCHEMY.QUEUE_MAX, Math.max(1, Math.floor(count)));
    const id = this.o.newRequestId();
    if (!send({ op: CraftOp.Start, requestId: id, recipeId: wireId, count: n })) return false;
    this.pending = { id, at: now };
    this.version++;
    return true;
  }
  cancel(send: (m: { op: number; requestId: string; recipeId: number; count: number }) => boolean): boolean {
    if (this.jobView.recipeId === 0) return false;
    return send({ op: CraftOp.Cancel, requestId: this.o.newRequestId(), recipeId: 0, count: 0 });
  }
}
