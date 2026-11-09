/**
 * Server-authoritative mob attacks (D86). Runs once per tick after the mob AI step (`WorldNode.tick`), on the combat core:
 *
 *   for each living mob in `chase` whose AI target (D83 threat target, else the aggro target) is a living player:
 *     idle -> pick an attack (the first SKILL that is off cooldown and in reach, else the basic attack when in reach, with line of sight),
 *             LOCK the facing (cone / line) or the target's position (ground circle) and start the telegraph
 *     telegraph over -> every living player inside the shape takes `damageBreakdown(mob ATK x coeff vs the player's DEF)` through
 *             `CombatSystem.damagePlayer` (shield first, death, the combat core's respawn)
 *
 * Because the shape is fixed when the telegraph starts and tested again when it ends, moving out of it dodges the hit. A mob that dies
 * or despawns during its telegraph cancels the attack. Damage reaches the client through the own-vitals block of the snapshot (no wire
 * change); the telegraph itself goes out as `telegraph_start` / `telegraph_end` (protocol v5, D89): `step` reports them as
 * `telegraphs` and `WorldNode` sends them to the clients whose AOI holds the anchor.
 *
 * Determinism (skill `vgtd-sim-determinism`): no clocks, no ambient randomness. The only random input is the damage jitter, drawn from
 * a PRNG forked from the node seed ('mobatk'), one float per victim, victims in ascending id order, attacks resolved in
 * (resolve time, mob id) order. `digest()` exposes the state for the replay tests.
 */
import {
  MOB_ATTACK_GAP_MS,
  MOB_ID_BASE,
  damageBreakdown,
  mobPhasesOf,
  mobRealm,
  mobStats,
  rngFloat,
  rngFork,
  rngSeed,
  type MobAttack,
  type MobDef,
  type MobEffect,
  type MobPhase,
  type RngState,
} from '@vgtd/shared';
import { encodeDirection, hypot, lineOfSight, type EntityState, type SimContext, type SimWorld } from '@vgtd/sim';
import { inShape } from './geometry.js';
import type { CombatSystem } from './system.js';
import type { CombatEvent } from './types.js';

/** What the attack system needs to know about a mob (read-only; `MobManager.attackView` satisfies it without allocating). */
export interface MobAttackView {
  /** AI state: only `chase` attacks */
  state: string;
  /** chase target entity id (0 = none) */
  target: number;
  level: number;
  def: MobDef;
}
export interface MobAttackPort {
  /** undefined for dead / unknown mobs */
  attackView(id: number): MobAttackView | undefined;
  /** Optional: put threat on `attackerId` for mob `id` (pulls it onto that player). `MobManager.onDamage` has this exact signature: used by the call for help. */
  onDamage?(id: number, attackerId: number, amount: number): void;
}

/** A boss entered a new phase this tick (D91): the node turns it into a wire message. */
export interface MobPhaseChange {
  mobId: number;
  /** phase index, 1-based for a change (phase 0 is the spawn state) */
  phase: number;
  transformMs: number;
}

/** Threat the call for help puts on the attacked player for each helper (placeholder: any positive value pulls an idle mob onto the player). */
const CALL_HELP_THREAT = 100;

interface PhaseState {
  phase: number;
  /** invulnerable and attack-less until this sim time */
  transformUntilMs: number;
}

/** A telegraph that started or ended this tick (D89); the node turns it into wire messages. Not part of the simulation state. */
export type MobTelegraphEvent =
  | {
      kind: 'start';
      /** per-system counter (u16, wraps) */
      id: number;
      mobId: number;
      attack: MobAttack;
      facing: number;
      /** circle: the locked anchor; cone / line: the mob's position when the telegraph started */
      i: number;
      j: number;
      durationMs: number;
      /** only this client gets the decal (D97: a Tâm Ma shadow's attacks are the owner's business); absent = everyone whose view holds the anchor */
      audience?: number;
    }
  | { kind: 'end'; id: number; cancelled: boolean };

interface Windup {
  /** telegraph id on the wire */
  id: number;
  mobId: number;
  /** the player the attack was aimed at when it started (pool damage is sized against that player) */
  targetId: number;
  attack: MobAttack;
  resolveAtMs: number;
  facing: number;
  /** anchor of a `target` attack, or the mob's own position when the telegraph started */
  ai: number;
  aj: number;
  /** mob position when the telegraph started (cone / line origin) */
  ci: number;
  cj: number;
  atk: number;
  attackerRealm: number;
  element: MobDef['elements'][number] | null;
}

interface MobCooldowns {
  /** per attack id: time (sim ms) the attack may start again */
  readyAt: Map<string, number>;
  /** no new attack before this time */
  gapUntilMs: number;
}

export class MobAttackSystem {
  private rng: RngState;
  private windups: Windup[] = [];
  private nextTelegraphId = 0;
  private readonly cooldowns = new Map<number, MobCooldowns>();
  private readonly phases = new Map<number, PhaseState>();
  private phaseChanges: MobPhaseChange[] = [];
  private nowMs = 0;

  constructor(
    private readonly ctx: SimContext,
    private readonly combat: CombatSystem,
    private readonly mobs: MobAttackPort,
    seed: number,
  ) {
    this.rng = rngFork(rngSeed(seed), 'mobatk');
  }

  /** The phase table row a mob is in now (phase 0 for every mob until a boss crosses an HP threshold). */
  private phaseOf(mobId: number, def: MobDef): MobPhase {
    const list = mobPhasesOf(def);
    return list[Math.min(this.phases.get(mobId)?.phase ?? 0, list.length - 1)]!;
  }

  /** A boss inside its phase-transform window cannot be hurt (`CombatOptions.isInvulnerable`) and does not attack. */
  isInvulnerable(mobId: number): boolean {
    const st = this.phases.get(mobId);
    return !!st && this.nowMs < st.transformUntilMs;
  }

  /** The phase a mob is in (0 = the first); for tests and the client hook. */
  phaseIndex(mobId: number): number {
    return this.phases.get(mobId)?.phase ?? 0;
  }

  /** Advance a mob to its next phase(s) when its HP crossed the thresholds: transform window, in-flight attacks cancelled. */
  private advancePhase(e: EntityState, def: MobDef, now: number, telegraphs: MobTelegraphEvent[]): void {
    const list = mobPhasesOf(def);
    if (list.length < 2) return;
    const hpMax = this.combat.mobHpMax(e.id);
    if (!hpMax) return;
    const frac = e.hp / hpMax;
    let st = this.phases.get(e.id);
    if (!st) {
      st = { phase: 0, transformUntilMs: 0 };
      this.phases.set(e.id, st);
    }
    let next = st.phase;
    while (next + 1 < list.length && frac <= list[next + 1]!.atHpFrac) next++;
    if (next === st.phase) return;
    st.phase = next;
    st.transformUntilMs = now + list[next]!.transformMs;
    // in-flight attacks of this mob are dropped: the client must stop drawing their decals (D89)
    const kept: Windup[] = [];
    for (const w of this.windups) {
      if (w.mobId === e.id) telegraphs.push({ kind: 'end', id: w.id, cancelled: true });
      else kept.push(w);
    }
    this.windups = kept;
    this.phaseChanges.push({ mobId: e.id, phase: next, transformMs: list[next]!.transformMs });
  }

  step(world: SimWorld): {
    world: SimWorld;
    events: CombatEvent[];
    telegraphs: MobTelegraphEvent[];
    phases: MobPhaseChange[];
  } {
    const events: CombatEvent[] = [];
    const telegraphs: MobTelegraphEvent[] = [];
    const now = world.timeMs;
    this.nowMs = now;
    const byId = new Map<number, EntityState>();
    for (const e of world.entities) byId.set(e.id, e);

    // 1) start attacks
    for (const e of world.entities) {
      if (e.id < MOB_ID_BASE || e.hp <= 0) continue;
      const v = this.mobs.attackView(e.id);
      if (!v) continue;
      this.advancePhase(e, v.def, now, telegraphs);
      if (this.isInvulnerable(e.id)) continue; // transforming: no attacks
      if (v.state !== 'chase' || v.target === 0) continue;
      if (this.windups.some((w) => w.mobId === e.id)) continue; // one attack at a time
      const t = byId.get(v.target);
      if (!t || t.id >= MOB_ID_BASE || t.hp <= 0 || !this.combat.isAlive(t.id)) continue;
      const cd = this.cooldowns.get(e.id);
      if (cd && now < cd.gapUntilMs) continue;
      const d = hypot(t.i - e.i, t.j - e.j);
      const phase = this.phaseOf(e.id, v.def);
      const attack = this.pick(phase, cd, d, now);
      if (!attack) continue;
      if (!lineOfSight(this.ctx.grid, e.i, e.j, t.i, t.j, e.layer, e.flying)) continue;
      const stats = mobStats(v.def, v.level);
      const state = cd ?? { readyAt: new Map<string, number>(), gapUntilMs: 0 };
      state.readyAt.set(attack.id, now + Math.round(attack.cooldownMs * phase.cooldownMult));
      this.cooldowns.set(e.id, state);
      const id = this.nextTelegraphId;
      this.nextTelegraphId = (id + 1) & 0xffff;
      const facing = encodeDirection(t.i - e.i, t.j - e.j);
      const circle = attack.anchor === 'target';
      telegraphs.push({
        kind: 'start',
        id,
        mobId: e.id,
        attack,
        facing,
        i: circle ? t.i : e.i,
        j: circle ? t.j : e.j,
        durationMs: attack.telegraphMs,
      });
      this.windups.push({
        id,
        mobId: e.id,
        targetId: t.id,
        attack,
        resolveAtMs: now + attack.telegraphMs,
        facing,
        ai: attack.anchor === 'target' ? t.i : e.i,
        aj: attack.anchor === 'target' ? t.j : e.j,
        ci: e.i,
        cj: e.j,
        atk: Math.round(stats.atk * phase.atkMult),
        attackerRealm: mobRealm(v.level),
        element: v.def.elements[0] ?? null,
      });
    }

    // 2) resolve the telegraphs that are over; drop the ones whose mob is gone
    let w = world;
    if (this.windups.length > 0) {
      const due: Windup[] = [];
      const keep: Windup[] = [];
      for (const x of this.windups) {
        const mob = byId.get(x.mobId);
        if (!mob || mob.hp <= 0) {
          telegraphs.push({ kind: 'end', id: x.id, cancelled: true }); // the mob died / despawned: the attack is cancelled
          continue;
        }
        if (x.resolveAtMs <= now) due.push(x);
        else keep.push(x);
      }
      this.windups = keep;
      due.sort((a, b) => a.resolveAtMs - b.resolveAtMs || a.mobId - b.mobId);
      for (const x of due) {
        w = this.resolve(w, x, events);
        telegraphs.push({ kind: 'end', id: x.id, cancelled: false });
        const cd = this.cooldowns.get(x.mobId);
        if (cd) cd.gapUntilMs = now + MOB_ATTACK_GAP_MS;
      }
    }
    // forget the cooldowns and phases of mobs that are gone (a respawned mob starts fresh)
    if (this.cooldowns.size > 0) {
      for (const id of [...this.cooldowns.keys()]) if (!byId.has(id)) this.cooldowns.delete(id);
    }
    if (this.phases.size > 0) {
      for (const id of [...this.phases.keys()]) if (!byId.has(id)) this.phases.delete(id);
    }
    const phases = this.phaseChanges;
    this.phaseChanges = [];
    return { world: w, events, telegraphs, phases };
  }

  /** The first skill that is ready and in reach, else the basic attack when in reach (null = nothing to do yet). */
  private pick(phase: MobPhase, cd: MobCooldowns | undefined, dist: number, now: number): MobAttack | null {
    const list = phase.attacks;
    const ready = (a: MobAttack): boolean => now >= (cd?.readyAt.get(a.id) ?? 0);
    for (let k = 1; k < list.length; k++) {
      const a = list[k]!;
      if (dist <= a.rangeTiles && ready(a)) return a;
    }
    const b = list[0]!;
    return dist <= b.rangeTiles && ready(b) ? b : null;
  }

  private resolve(world: SimWorld, x: Windup, events: CombatEvent[]): SimWorld {
    let w = world;
    const origin = { i: x.ci, j: x.cj };
    const anchor = { i: x.ai, j: x.aj };
    const eff = x.attack.effect;
    for (const e of world.entities) {
      if (e.id >= MOB_ID_BASE || e.hp <= 0 || !this.combat.isAlive(e.id)) continue; // ascending id: entities are sorted
      if (!inShape(x.attack.shape, origin, x.facing, anchor, { i: e.i, j: e.j })) continue;
      const prof = this.combat.profileOf(e.id);
      if (!prof) continue;
      if (x.attack.coeff > 0) {
        const [jitter, next] = rngFloat(this.rng);
        this.rng = next;
        const b = damageBreakdown({
          atk: x.atk,
          cSkill: x.attack.coeff,
          def: prof.stats.def,
          attackerElement: x.element ?? undefined,
          defenderElement: prof.element,
          crit: false,
          attackerRealm: x.attackerRealm,
          defenderRealm: prof.realm,
          rand: jitter,
        });
        const hit = this.combat.damagePlayer(w, e.id, Math.max(1, Math.round(b.damage)), x.mobId);
        w = hit.world;
        for (const ev of hit.events) events.push(ev);
      }
      if (eff && this.combat.isAlive(e.id)) this.applyHitEffect(eff, e.id, prof.stats.def, prof.element, prof.realm, x);
    }
    if (eff?.type === 'pool') this.addPool(eff, x);
    else if (eff?.type === 'call_help') this.callHelp(world, eff, x);
    return w;
  }

  /** Damage of one status tick: `atk * coeff` through `damageBreakdown` against a defender, no jitter (fixed when the effect is applied). */
  private tickDamage(
    coeff: number,
    x: Windup,
    def: number,
    element: Parameters<typeof damageBreakdown>[0]['defenderElement'],
    realm: number,
  ): number {
    const b = damageBreakdown({
      atk: x.atk,
      cSkill: coeff,
      def,
      attackerElement: x.element ?? undefined,
      defenderElement: element,
      crit: false,
      attackerRealm: x.attackerRealm,
      defenderRealm: realm,
    });
    return Math.max(1, Math.round(b.damage));
  }

  /** root / slow / poison on one victim that was hit (D91). */
  private applyHitEffect(
    eff: MobEffect,
    victim: number,
    def: number,
    element: Parameters<typeof damageBreakdown>[0]['defenderElement'],
    realm: number,
    x: Windup,
  ): void {
    const st = this.combat.status;
    const now = this.nowMs;
    if (eff.type === 'root') st.rootPlayer(victim, now, eff.ms);
    else if (eff.type === 'slow') st.slowPlayer(victim, now, eff.ms, eff.factor);
    else if (eff.type === 'poison')
      st.poisonPlayer(victim, now, eff.ms, eff.tickMs, this.tickDamage(eff.coeff, x, def, element, realm), x.mobId);
  }

  /** A ground poison pool on the anchor (D91); its tick damage is sized against the player the attack was aimed at. */
  private addPool(eff: Extract<MobEffect, { type: 'pool' }>, x: Windup): void {
    const prof = this.combat.profileOf(x.targetId);
    if (!prof) return;
    this.combat.status.addPool(
      {
        i: x.ai,
        j: x.aj,
        radius: eff.radius,
        ms: eff.ms,
        tickMs: eff.tickMs,
        amount: this.tickDamage(eff.coeff, x, prof.stats.def, prof.element, prof.realm),
        sourceId: x.mobId,
      },
      this.nowMs,
    );
  }

  /**
   * "Tru gọi" (D91): the `count` nearest mobs of `defKey` within `radius` of the caller that are alive are put on the attacked player's
   * threat table, so they chase that player. Nothing is spawned (placeholder for a real summon, OPEN-ITEMS).
   */
  private callHelp(world: SimWorld, eff: Extract<MobEffect, { type: 'call_help' }>, x: Windup): void {
    if (!this.mobs.onDamage || !this.combat.isAlive(x.targetId)) return;
    const near: Array<{ id: number; d: number }> = [];
    for (const e of world.entities) {
      if (e.id < MOB_ID_BASE || e.id === x.mobId || e.hp <= 0) continue;
      const d = hypot(e.i - x.ci, e.j - x.cj);
      if (d > eff.radius || this.mobs.attackView(e.id)?.def.key !== eff.defKey) continue;
      near.push({ id: e.id, d });
    }
    near.sort((a, b) => a.d - b.d || a.id - b.id);
    for (const n of near.slice(0, eff.count)) this.mobs.onDamage(n.id, x.targetId, CALL_HELP_THREAT);
  }

  /** Serializable digest of the state (replay / determinism tests). */
  digest(): string {
    return JSON.stringify({
      windups: this.windups.map((x) => [x.mobId, x.attack.id, x.resolveAtMs, x.facing, x.ai, x.aj]),
      cooldowns: [...this.cooldowns.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, c]) => [id, [...c.readyAt.entries()].sort(), c.gapUntilMs]),
      rng: this.rng,
      phases: [...this.phases.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, p]) => [id, p.phase, p.transformUntilMs]),
    });
  }
}
