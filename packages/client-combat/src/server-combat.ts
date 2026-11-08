/**
 * ServerCombat: the `CombatBackend` for online mode. The server is authoritative (apps/server world/combat, D75): this class only
 * predicts what the UI needs to feel responsive (cooldown / GCD start, cast bar) and shows what the server confirms (`skill_result`
 * hits, enemy HP from snapshots / AOI). It sends nothing itself: `send` is the transport hook the online client provides.
 *
 * Wire facts it relies on (docs/24, D75):
 *  - `skill_cast { seq, skillId, targetId }`; `skillId` = index of the active skill in data order (`wireSkillId`, same as `@vgtd/sim`'s
 *    `compileSkills`; a wire-compat test pins it).
 *  - `skill_result { seq, reason, skillId, readyAtMs, hits[] }`: reason 0 = accepted; an accepted cast answers when it RESOLVES (after the
 *    skill's cast time), a rejected one answers at once with the sim `CastReason`.
 *  - hit flags: bit0 crit, bit1 killed.
 *  - GAP: the protocol carries no self HP / MP yet, so `setSelfVitals` must be fed by whatever the online client has (OPEN-ITEMS).
 */
import { HIT_FLAG_CRIT, HIT_FLAG_KILL, skillDefinitions } from '@vgtd/shared';
import type { PathId, SkillDefinitions } from '@vgtd/shared';
import type { CombatBackend, EnemyView, PlayerView } from './backend.js';
import { Hotbar } from './hotbar.js';
import type { HotbarUndo } from './hotbar.js';
import type { CastBlock } from './hotbar.js';
import type { CombatEvent } from './mock-combat.js';
import { PLAYER_ID } from './mock-combat.js';
import { TargetSelector } from './targeting.js';
import type { TilePoint } from './targeting.js';

/** `CastReason` values of `@vgtd/sim` that the HUD maps to a `blocked` reason. */
const REASON_TO_BLOCK: Record<number, CastBlock> = {
  1: 'empty', // UnknownSkill
  2: 'cooldown',
  3: 'gcd',
  4: 'mp',
  5: 'dead', // Controlled (also what the server answers a dead player)
  6: 'range',
  7: 'range', // NoLineOfSight: shown as "out of range" until the HUD has a dedicated message
  8: 'no_target',
};

/** Wire skill id of every active skill, in data order (mirror of `compileSkills` in `@vgtd/sim`). */
export function wireSkillIds(defs: SkillDefinitions = skillDefinitions): Map<string, number> {
  const m = new Map<string, number>();
  let k = 0;
  for (const s of defs.skills) if (s.kind === 'active') m.set(s.id, k++);
  return m;
}

export interface SkillCastWire {
  seq: number;
  skillId: number;
  targetId: number;
}

export interface SkillResultWire {
  seq: number;
  reason: number;
  skillId: number;
  readyAtMs: number;
  hits: ReadonlyArray<{ targetIndex: number; damage: number; flags: number }>;
}

export interface ServerCombatOptions {
  path: PathId;
  send: (m: SkillCastWire) => void;
  defs?: SkillDefinitions;
}

interface Inflight {
  slot: number;
  sentAt: number;
  /** What the local prediction changed, to take back exactly that on a refusal. */
  undo: HotbarUndo | null;
}

export class ServerCombat implements CombatBackend {
  readonly hotbar: Hotbar;
  readonly target = new TargetSelector();
  readonly player: PlayerView = {
    id: PLAYER_ID,
    pos: { i: 0, j: 0 },
    alive: true,
    hostile: false,
    hp: 1,
    hpMax: 1,
    mp: 0,
    mpMax: 1,
    shield: 0,
    casting: null,
  };
  private readonly byId = new Map<number, EnemyView>();
  private readonly wire: Map<string, number>;
  private readonly inflight = new Map<number, Inflight>();
  private readonly out: CombatEvent[] = [];
  private seq = 0;
  /** Server time (ms) of the newest snapshot, so `readyAtMs` can be turned into a remaining cooldown. */
  private serverNowMs = 0;

  constructor(private readonly opts: ServerCombatOptions) {
    const defs = opts.defs ?? skillDefinitions;
    this.hotbar = new Hotbar(opts.path, defs);
    this.wire = wireSkillIds(defs);
  }

  get enemies(): readonly EnemyView[] {
    return [...this.byId.values()].sort((a, b) => a.id - b.id);
  }

  enemy(id: number): EnemyView | undefined {
    return this.byId.get(id);
  }

  setPlayerPos(p: TilePoint): void {
    this.player.pos.i = p.i;
    this.player.pos.j = p.j;
  }

  // ------------------------------------------------------------------ fed by the online client
  /** Newest snapshot's server time (`tick * TICK_MS`). */
  setServerTime(ms: number): void {
    this.serverNowMs = ms;
  }

  /** The protocol has no self HP / MP yet: the online client passes whatever it knows. */
  setSelfVitals(v: { hp: number; hpMax: number; mp: number; mpMax: number; alive?: boolean }): void {
    Object.assign(this.player, v);
    if (v.alive !== undefined) this.player.alive = v.alive;
  }

  /** An enemy came into view or its state changed (`aoi_enter` / snapshot `hpPct`). */
  upsertEnemy(e: { id: number; name: string; pos: TilePoint; hpPct: number; hpMax: number }): void {
    const cur = this.byId.get(e.id);
    const hp = Math.round((Math.max(0, Math.min(100, e.hpPct)) / 100) * e.hpMax);
    if (cur) {
      cur.pos = e.pos;
      cur.hp = hp;
      cur.hpMax = e.hpMax;
      cur.alive = hp > 0;
    } else
      this.byId.set(e.id, { id: e.id, name: e.name, pos: e.pos, alive: hp > 0, hostile: true, hp, hpMax: e.hpMax });
  }

  removeEnemy(id: number): void {
    this.byId.delete(id);
  }

  /** `skill_result` from the server. `entityOfIndex` maps `hits[].targetIndex` (visible-list index) to an entity id. */
  applySkillResult(res: SkillResultWire, nowMs: number, entityOfIndex: (index: number) => number | undefined): void {
    const sent = this.inflight.get(res.seq);
    this.inflight.delete(res.seq);
    const slot = sent?.slot ?? this.hotbar.slots.findIndex((s) => this.wire.get(s.skill.id) === res.skillId);
    if (this.player.casting && this.player.casting.slot === slot) this.player.casting = null;
    if (res.reason !== 0) {
      // the server refused: take back ONLY this cast's prediction (other slots' cooldowns are real), then let the server's
      // numbers win for the two reasons that carry one (`readyAtMs` is the skill cooldown for Cooldown, the GCD for Gcd)
      if (sent?.undo) this.hotbar.undo(sent.undo);
      if (slot >= 0 && res.reason === 2) this.syncCooldown(slot, res.readyAtMs, nowMs);
      else if (res.reason === 3) this.hotbar.setGcdRemaining(nowMs, res.readyAtMs - this.serverNowMs);
      this.out.push({ type: 'blocked', slot, reason: REASON_TO_BLOCK[res.reason] ?? 'busy', atMs: nowMs });
      return;
    }
    if (slot >= 0) this.syncCooldown(slot, res.readyAtMs, nowMs);
    for (const h of res.hits) {
      const id = entityOfIndex(h.targetIndex);
      if (id === undefined) continue;
      this.out.push({
        type: 'damage',
        targetId: id,
        amount: h.damage,
        crit: (h.flags & HIT_FLAG_CRIT) !== 0,
        sourceId: PLAYER_ID,
        atMs: nowMs,
      });
      if (h.flags & HIT_FLAG_KILL) {
        const e = this.byId.get(id);
        if (e) {
          e.hp = 0;
          e.alive = false;
        }
        this.out.push({ type: 'death', id, atMs: nowMs });
      }
    }
    if (slot >= 0) this.out.push({ type: 'cast_done', slot, atMs: nowMs });
  }

  /** Make the slot's cooldown agree with the server's `readyAtMs`. */
  private syncCooldown(slot: number, readyAtMs: number, nowMs: number): void {
    const remaining = Math.max(0, readyAtMs - this.serverNowMs);
    this.hotbar.setCooldownRemaining(slot, nowMs, remaining);
  }

  // ------------------------------------------------------------------ CombatBackend
  cast(slot: number, nowMs: number): CombatEvent[] {
    const s = this.hotbar.slot(slot);
    let reason: CastBlock | null = null;
    if (!s) reason = 'empty';
    else if (!this.player.alive) reason = 'dead';
    else if (!s.castable) reason = 'passive';
    else reason = this.hotbar.blockedBy(slot, nowMs);
    if (!reason && s && this.player.mp < Math.round((s.skill.cost?.mp_pct ?? 0) * this.player.mpMax)) reason = 'mp';
    if (reason) return [{ type: 'blocked', slot, reason, atMs: nowMs }];
    const skill = s!.skill;
    const targetId = this.target.current ?? 0;
    const seq = ++this.seq & 0xffff;
    const undo = this.hotbar.commit(slot, nowMs); // predicted; the result corrects it
    this.inflight.set(seq, { slot, sentAt: nowMs, undo });
    const castMs = skill.timing.cast_ms + (skill.timing.channel_ms ?? 0);
    if (castMs > 0) this.player.casting = { slot, startedAt: nowMs, endsAt: nowMs + castMs };
    this.opts.send({ seq, skillId: this.wire.get(skill.id)!, targetId });
    return [{ type: 'cast_start', slot, castMs, atMs: nowMs }];
  }

  update(nowMs: number): CombatEvent[] {
    // a result that never arrives must not freeze the cast bar
    if (this.player.casting && nowMs > this.player.casting.endsAt + 1500) this.player.casting = null;
    for (const [seq, f] of this.inflight) if (nowMs - f.sentAt > 5000) this.inflight.delete(seq);
    this.target.validate([...this.byId.values()]);
    const ev = this.out.splice(0, this.out.length);
    return ev;
  }
}
