/**
 * Major breakthrough events (D97): the server-authoritative Tâm Ma and Lôi Kiếp of docs/01 §5.2-5.4 for the MVP thresholds.
 *
 *   breakthrough_start on a major threshold  (ProgressionService validates, then calls `start`)
 *     -> Tâm Ma   a shadow of the player (a real entity, stats x strength) appears beside them; the player must kill it with their own
 *                 skills within 90 s. It attacks every 2.5 s with a telegraphed circle on the player's position (dodgeable, D89 path).
 *                 Lost (it kills the player, the time runs out, the player leaves) = `TamMaLost`: no roll, no pity, 30 min lock.
 *     -> Thiên Mệnh  the roll, with the ordinary breakthrough chance / pill / PRNG stream / roll log (`ProgressionService.rollDestiny`)
 *     -> Lôi Kiếp (Kim Đan -> Nguyên Anh only)  the bolts of `boltSchedule`: a warning decal 1.2 s before each (telegraph events), then pure
 *                 damage `strikeDamage(HP_ref, κ, w)` that always hits the owner. Dying = `Died`, consequence by waves survived.
 *     -> ProgressionService.finishMajor applies the outcome and answers with `breakthrough_result`.
 *
 * Deterministic (skill `vgtd-sim-determinism`): every time is sim time, no randomness here (the only roll is the service's seeded stream),
 * events are processed by ascending entity id, `digest()` exposes the state. The class itself never touches the clock or `Math.random`.
 */
import {
  ELEMENTS,
  MAJOR_EVENT,
  MajorPhase,
  MajorResult,
  boltSchedule,
  damageBreakdown,
  hpRefOf,
  majorEventOf,
  tamMaStrength,
  type BoltPlan,
  type ElementId,
  type MajorEventSpec,
  type MobAttack,
} from '@vgtd/shared';
import { ProgressionReason, quantizePos, type MajorServerMessage } from '@vgtd/protocol';
import { circleBlocked, hypot, spawnEntity, type SimContext, type SimWorld } from '@vgtd/sim';
import type { CombatSystem } from '../combat/system.js';
import type { MobTelegraphEvent } from '../combat/mob-attacks.js';
import type { MajorEventPort, MajorStartInfo, Outbound, ProgressionService } from '../../progression/service.js';
import { SHADOW_ID_BASE, ShadowRegistry } from './shadows.js';

/** Wire telegraph ids of this module live above the mob attack counter's usual range (both are u16). */
const TELEGRAPH_ID_BASE = 0xf000;
const COLLIDER_RADIUS = 0.35;

interface Wind {
  id: number;
  resolveAtMs: number;
  i: number;
  j: number;
}

interface Active {
  info: MajorStartInfo;
  spec: MajorEventSpec;
  strength: number;
  phase: MajorPhase;
  phaseStartMs: number;
  // Tâm Ma
  spawned: boolean;
  shadowId: number;
  shadowDeadlineMs: number;
  nextShadowAttackMs: number;
  shadowWind: Wind | null;
  // Lôi Kiếp
  bolts: BoltPlan[];
  lightStartMs: number;
  /** index of the next bolt to HIT */
  boltIdx: number;
  /** warning telegraph id per bolt index (set when the warning started) */
  warned: Map<number, number>;
  waveAnnounced: number;
  announced: boolean;
}

export interface MajorStep {
  world: SimWorld;
  /** telegraph starts / ends (the node sends them to the clients that see the anchor) */
  telegraphs: MobTelegraphEvent[];
  /** messages for the players involved (progress, strikes, the final answer) */
  outbound: Outbound[];
}

export interface MajorOptions {
  ctx: SimContext;
  combat: CombatSystem;
  progression: ProgressionService;
  shadows: ShadowRegistry;
  /** the current world (used by `canStart`, which the progression service calls outside the tick) */
  world: () => SimWorld;
}

export class MajorBreakthroughs implements MajorEventPort {
  private readonly events = new Map<number, Active>();
  private readonly out: Outbound[] = [];
  private nextShadow = 0;
  private nextTelegraph = 0;

  constructor(private readonly o: MajorOptions) {}

  // ------------------------------------------------------------------ MajorEventPort
  canStart(entityId: number): ProgressionReason {
    const e = this.o.world().entities.find((x) => x.id === entityId);
    if (!e) return ProgressionReason.NotReady;
    if (!this.o.combat.isAlive(entityId)) return ProgressionReason.Dead;
    const hpMax = this.o.combat.maxHpOf(entityId) ?? 0;
    if (hpMax <= 0 || e.hp < hpMax * MAJOR_EVENT.MIN_HP_FRACTION) return ProgressionReason.NotPrepared;
    return ProgressionReason.Ok;
  }

  start(info: MajorStartInfo): void {
    const spec = majorEventOf(info.realm);
    if (!spec || spec.kind === 'none') return;
    this.events.set(info.entityId, {
      info,
      spec,
      strength: tamMaStrength(info.daoTam ?? MAJOR_EVENT.DEFAULT_DAO_TAM, info.karma),
      phase: MajorPhase.TamMa,
      phaseStartMs: info.nowMs,
      spawned: false,
      shadowId: 0,
      shadowDeadlineMs: 0,
      nextShadowAttackMs: 0,
      shadowWind: null,
      bolts: [],
      lightStartMs: 0,
      boltIdx: 0,
      warned: new Map(),
      waveAnnounced: 0,
      announced: false,
    });
  }

  // ------------------------------------------------------------------ queries
  isActive(entityId: number): boolean {
    return this.events.has(entityId);
  }
  /** The `major_event` describing where a running event stands now (null when none runs): re-sent to a player who resumes a held session. */
  snapshotMsg(entityId: number, nowMs: number): MajorServerMessage | null {
    const a = this.events.get(entityId);
    if (!a) return null;
    let remaining = 0;
    let wave = 0;
    if (a.phase === MajorPhase.TamMa) remaining = a.spawned ? a.shadowDeadlineMs - nowMs : MAJOR_EVENT.TAM_MA_LIMIT_MS;
    else if (a.phase === MajorPhase.Destiny) remaining = MAJOR_EVENT.DESTINY_PAUSE_MS - (nowMs - a.phaseStartMs);
    else {
      remaining = a.lightStartMs - nowMs; // > 0 while the clouds gather, else 0
      wave = a.waveAnnounced;
    }
    return {
      type: 'major_event',
      phase: a.phase,
      wave,
      waves: a.spec.tribulation?.waves ?? 0,
      remainingMs: Math.max(0, Math.round(remaining)),
      strengthPct: Math.round(a.strength * 100),
      result: MajorResult.Running,
      tier: 0,
      expLostPct: 0,
      lockMin: 0,
      tamMaId: a.phase === MajorPhase.TamMa ? a.shadowId : 0,
    };
  }
  /** Shadow entity of a player's running Tâm Ma (0 = none). */
  shadowOf(entityId: number): number {
    return this.events.get(entityId)?.shadowId ?? 0;
  }
  get size(): number {
    return this.events.size;
  }

  /** The player left the world while an event runs: it counts as lost (a Tâm Ma loss, or a death in the Kiếp). Call BEFORE the service forgets them. */
  onLeave(world: SimWorld, entityId: number): MajorStep {
    const a = this.events.get(entityId);
    if (!a) return { world, telegraphs: [], outbound: [] };
    const tel: MobTelegraphEvent[] = [];
    const w = this.finish(
      world,
      a,
      a.phase === MajorPhase.Tribulation ? MajorResult.Died : MajorResult.TamMaLost,
      this.wavesSurvived(a),
      tel,
    );
    return { world: w, telegraphs: tel, outbound: this.out.splice(0) };
  }

  // ------------------------------------------------------------------ the tick
  step(world: SimWorld): MajorStep {
    const telegraphs: MobTelegraphEvent[] = [];
    let w = world;
    for (const id of [...this.events.keys()].sort((a, b) => a - b)) {
      const a = this.events.get(id);
      if (a) w = this.stepOne(w, a, telegraphs);
    }
    return { world: w, telegraphs, outbound: this.out.splice(0) };
  }

  private send(entityId: number, msg: MajorServerMessage): void {
    this.out.push({ entityId, msg });
  }

  private eventMsg(
    a: Active,
    phase: MajorPhase,
    remainingMs: number,
    extra: Partial<Extract<MajorServerMessage, { type: 'major_event' }>> = {},
  ): void {
    const waves = a.spec.tribulation?.waves ?? 0;
    this.send(a.info.entityId, {
      type: 'major_event',
      phase,
      wave: 0,
      waves,
      remainingMs: Math.max(0, Math.round(remainingMs)),
      strengthPct: Math.round(a.strength * 100),
      result: MajorResult.Running,
      tier: 0,
      expLostPct: 0,
      lockMin: 0,
      tamMaId: phase === MajorPhase.TamMa ? a.shadowId : 0,
      ...extra,
    });
  }

  private wavesSurvived(a: Active): number {
    const hit = a.bolts[a.boltIdx];
    return hit ? hit.wave - 1 : (a.spec.tribulation?.waves ?? 0);
  }

  private stepOne(world: SimWorld, a: Active, tel: MobTelegraphEvent[]): SimWorld {
    const id = a.info.entityId;
    const owner = world.entities.find((e) => e.id === id);
    if (!owner)
      return this.finish(
        world,
        a,
        a.phase === MajorPhase.Tribulation ? MajorResult.Died : MajorResult.TamMaLost,
        this.wavesSurvived(a),
        tel,
      );
    if (!this.o.combat.isAlive(id) || owner.hp <= 0)
      return this.finish(
        world,
        a,
        a.phase === MajorPhase.Tribulation ? MajorResult.Died : MajorResult.TamMaLost,
        this.wavesSurvived(a),
        tel,
      );

    if (a.phase === MajorPhase.TamMa) return this.stepTamMa(world, a, tel, owner.i, owner.j);
    if (a.phase === MajorPhase.Destiny) return this.stepDestiny(world, a, tel);
    return this.stepTribulation(world, a, tel, owner.i, owner.j);
  }

  // ------------------------------------------------------------------ Tâm Ma
  private stepTamMa(world: SimWorld, a: Active, tel: MobTelegraphEvent[], oi: number, oj: number): SimWorld {
    const now = world.timeMs;
    let w = world;
    const id = a.info.entityId;
    if (!a.spawned) {
      const prof = this.o.combat.profileOf(id);
      if (!prof) return this.finish(w, a, MajorResult.TamMaLost, 0, tel);
      a.spawned = true;
      a.shadowId = SHADOW_ID_BASE + this.nextShadow++;
      a.shadowDeadlineMs = now + MAJOR_EVENT.TAM_MA_LIMIT_MS;
      a.nextShadowAttackMs = now + MAJOR_EVENT.TAM_MA_ATTACK_INTERVAL_MS;
      const hpMax = Math.max(1, Math.round(prof.stats.hp * a.strength));
      const at = this.spawnPoint(w, oi, oj);
      w = spawnEntity(w, { id: a.shadowId, i: at.i, j: at.j, hp: hpMax, mpMax: 0 });
      this.o.shadows.add({
        id: a.shadowId,
        ownerId: id,
        defeated: false,
        stats: {
          defense: Math.round(prof.stats.def * a.strength),
          realm: prof.realm,
          element: (ELEMENTS as readonly string[]).includes(prof.element) ? (prof.element as ElementId) : null,
          dropSource: 'field',
          hpMax,
        },
      });
      this.eventMsg(a, MajorPhase.TamMa, MAJOR_EVENT.TAM_MA_LIMIT_MS);
      return w;
    }
    const shadow = this.o.shadows.get(a.shadowId);
    const entity = w.entities.find((e) => e.id === a.shadowId);
    // defeated: killed through the combat core (entity removed) or its HP ran out
    if (!shadow || shadow.defeated || !entity || entity.hp <= 0) {
      a.phase = MajorPhase.Destiny;
      a.phaseStartMs = now;
      w = this.removeShadow(w, a);
      this.eventMsg(a, MajorPhase.Destiny, MAJOR_EVENT.DESTINY_PAUSE_MS);
      return w;
    }
    if (now >= a.shadowDeadlineMs) return this.finish(w, a, MajorResult.TamMaLost, 0, tel);

    // the shadow's attack: warning decal on the player's position, then a circle hit if the player is still inside
    if (a.shadowWind) {
      const wind = a.shadowWind;
      if (now >= wind.resolveAtMs) {
        a.shadowWind = null;
        tel.push({ kind: 'end', id: wind.id, cancelled: false });
        if (hypot(oi - wind.i, oj - wind.j) <= MAJOR_EVENT.TAM_MA_RADIUS) {
          const prof = this.o.combat.profileOf(a.info.entityId);
          if (prof) {
            const b = damageBreakdown({
              atk: prof.stats.atk * a.strength,
              cSkill: MAJOR_EVENT.TAM_MA_COEFF,
              def: prof.stats.def,
              attackerElement: prof.element,
              defenderElement: prof.element,
              crit: false,
              attackerRealm: prof.realm,
              defenderRealm: prof.realm,
            });
            w = this.o.combat.damagePlayer(w, a.info.entityId, Math.max(1, Math.round(b.damage)), a.shadowId).world;
          }
        }
      }
    } else if (now >= a.nextShadowAttackMs) {
      const tid = this.telegraphId();
      a.shadowWind = { id: tid, resolveAtMs: now + MAJOR_EVENT.TAM_MA_WARN_MS, i: oi, j: oj };
      a.nextShadowAttackMs = now + MAJOR_EVENT.TAM_MA_ATTACK_INTERVAL_MS;
      tel.push({
        kind: 'start',
        id: tid,
        mobId: a.shadowId,
        attack: this.circleAttack('tam_ma', MAJOR_EVENT.TAM_MA_RADIUS, MAJOR_EVENT.TAM_MA_WARN_MS),
        facing: 0,
        i: oi,
        j: oj,
        durationMs: MAJOR_EVENT.TAM_MA_WARN_MS,
        audience: a.info.entityId, // the shadow's decals are for its owner only
      });
    }
    return w;
  }

  // ------------------------------------------------------------------ Thiên Mệnh
  private stepDestiny(world: SimWorld, a: Active, tel: MobTelegraphEvent[]): SimWorld {
    const now = world.timeMs;
    if (now - a.phaseStartMs < MAJOR_EVENT.DESTINY_PAUSE_MS) return world;
    const roll = this.o.progression.rollDestiny(a.info.entityId);
    if (!roll || !roll.success) return this.finish(world, a, MajorResult.RollFailed, 0, tel);
    const trib = a.spec.tribulation;
    if (!trib) return this.finish(world, a, MajorResult.Success, 0, tel);
    a.phase = MajorPhase.Tribulation;
    a.phaseStartMs = now;
    a.lightStartMs = now + MAJOR_EVENT.CLOUD_GATHER_MS;
    a.bolts = boltSchedule(trib, hpRefOf(a.info.realm));
    a.boltIdx = 0;
    this.eventMsg(a, MajorPhase.Tribulation, MAJOR_EVENT.CLOUD_GATHER_MS, { wave: 0 });
    return world;
  }

  // ------------------------------------------------------------------ Lôi Kiếp
  private stepTribulation(world: SimWorld, a: Active, tel: MobTelegraphEvent[], oi: number, oj: number): SimWorld {
    const now = world.timeMs;
    const el = now - a.lightStartMs;
    if (el < 0) return world; // the clouds are still gathering
    let w = world;
    const id = a.info.entityId;
    const waves = a.spec.tribulation!.waves;
    // warnings first (a bolt's warning starts `BOLT_WARN_MS` before it hits)
    for (let k = a.boltIdx; k < a.bolts.length; k++) {
      const b = a.bolts[k]!;
      if (b.warnAtMs > el) break;
      if (a.warned.has(k)) continue;
      const tid = this.telegraphId();
      a.warned.set(k, tid);
      if (b.wave > a.waveAnnounced) {
        a.waveAnnounced = b.wave;
        this.eventMsg(a, MajorPhase.Tribulation, 0, { wave: b.wave });
      }
      tel.push({
        kind: 'start',
        id: tid,
        mobId: 0,
        attack: this.circleAttack('loi_kiep', MAJOR_EVENT.BOLT_RADIUS, MAJOR_EVENT.BOLT_WARN_MS),
        facing: 0,
        i: oi,
        j: oj,
        durationMs: MAJOR_EVENT.BOLT_WARN_MS,
      });
    }
    // hits (several can be due in one tick on a long stall: in schedule order)
    while (a.boltIdx < a.bolts.length && a.bolts[a.boltIdx]!.hitAtMs <= el) {
      const b = a.bolts[a.boltIdx]!;
      const tid = a.warned.get(a.boltIdx);
      if (tid !== undefined) tel.push({ kind: 'end', id: tid, cancelled: false });
      const owner = w.entities.find((e) => e.id === id);
      const hit = this.o.combat.damagePlayer(w, id, b.damage, 0); // pure damage: the lightning ignores DEF (07 §3); a shield still absorbs
      w = hit.world;
      this.send(id, {
        type: 'tribulation_strike',
        wave: b.wave,
        waves,
        strike: b.strike,
        qi: quantizePos(owner?.i ?? oi),
        qj: quantizePos(owner?.j ?? oj),
        damage: b.damage,
      });
      a.boltIdx++;
      if (!this.o.combat.isAlive(id)) return this.finish(w, a, MajorResult.Died, b.wave - 1, tel);
    }
    if (a.boltIdx >= a.bolts.length) return this.finish(w, a, MajorResult.Success, waves, tel);
    return w;
  }

  // ------------------------------------------------------------------ helpers
  private telegraphId(): number {
    const id = TELEGRAPH_ID_BASE + this.nextTelegraph;
    this.nextTelegraph = (this.nextTelegraph + 1) & 0xfff;
    return id;
  }

  private circleAttack(id: string, radius: number, telegraphMs: number): MobAttack {
    return {
      id,
      kind: 'skill',
      shape: { type: 'circle', radius },
      anchor: 'target',
      rangeTiles: 0,
      telegraphMs,
      cooldownMs: 0,
      coeff: 0,
    };
  }

  /** A free spot `TAM_MA_SPAWN_DISTANCE` tiles from the player (first of +i, -i, +j, -j that is not blocked), else beside them. */
  private spawnPoint(world: SimWorld, oi: number, oj: number): { i: number; j: number } {
    const d = MAJOR_EVENT.TAM_MA_SPAWN_DISTANCE;
    const owner = world.entities.find((e) => e.i === oi && e.j === oj);
    const layer = owner?.layer ?? 0;
    for (const [di, dj] of [
      [d, 0],
      [-d, 0],
      [0, d],
      [0, -d],
    ] as const) {
      const i = oi + di;
      const j = oj + dj;
      if (i > 1 && j > 1 && !circleBlocked(this.o.ctx.grid, i, j, COLLIDER_RADIUS, layer, false)) return { i, j };
    }
    return { i: oi + 0.5, j: oj };
  }

  private removeShadow(world: SimWorld, a: Active): SimWorld {
    if (a.shadowId === 0) return world;
    this.o.shadows.drop(a.shadowId);
    return world.entities.some((e) => e.id === a.shadowId)
      ? { ...world, entities: world.entities.filter((e) => e.id !== a.shadowId) }
      : world;
  }

  /** End an event: despawn the shadow, cancel pending telegraphs, let the progression service apply the outcome. */
  private finish(
    world: SimWorld,
    a: Active,
    result: MajorResult,
    wavesSurvived: number,
    tel: MobTelegraphEvent[],
  ): SimWorld {
    const w = this.removeShadow(world, a);
    if (a.shadowWind) tel.push({ kind: 'end', id: a.shadowWind.id, cancelled: true });
    for (const [k, tid] of a.warned) if (k >= a.boltIdx) tel.push({ kind: 'end', id: tid, cancelled: true });
    this.events.delete(a.info.entityId);
    const waves = a.spec.tribulation?.waves ?? 0;
    const sent = this.o.progression.finishMajor(
      a.info.entityId,
      { result, wavesSurvived: Math.max(0, wavesSurvived), waves, strengthPct: Math.round(a.strength * 100) },
      world.timeMs,
    );
    for (const m of sent) this.out.push(m);
    return w;
  }

  /** Serializable digest of the running events (replay / determinism tests). */
  digest(): string {
    return JSON.stringify({
      next: [this.nextShadow, this.nextTelegraph],
      events: [...this.events.entries()]
        .sort((x, y) => x[0] - y[0])
        .map(([id, a]) => [
          id,
          a.phase,
          a.phaseStartMs,
          a.shadowId,
          a.shadowDeadlineMs,
          a.nextShadowAttackMs,
          a.shadowWind?.resolveAtMs ?? 0,
          a.boltIdx,
          [...a.warned.keys()],
          a.waveAnnounced,
        ]),
    });
  }
}
