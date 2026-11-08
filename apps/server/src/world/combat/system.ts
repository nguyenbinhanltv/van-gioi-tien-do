/**
 * CombatSystem: the server-authoritative half of combat that sits around `@vgtd/sim` `step()` (D75).
 *
 * Per tick the World Node does
 *   inputs  = combat.preStep(inputs)            drop casts of dead players / skills the class does not own, drop dead players' moves
 *   {world, events} = step(world, inputs, ...)  sim: cooldown / GCD / MP / control / range / LOS, `cast_ok` carries the combat-stream roll
 *   post    = combat.postStep(world, events)    cast time, shapes, damage, HP, death, respawn, mob kills, drops -> CombatResult[]
 *
 * Determinism: no clocks, no ambient randomness. A cast's rolls come from a PRNG seeded with the sim's `cast_ok.roll` (so they depend only
 * on the world seed and the order of accepted casts), drops from a separate seeded `drop` stream, iteration order is by ascending id /
 * (resolve time, caster, seq). All state is plain data, `stateDigest()` exposes it for the replay tests.
 */
import {
  COMBAT_RULES,
  HIT_FLAG_CRIT,
  HIT_FLAG_KILL,
  resolveDrops,
  rngFloat,
  rngFork,
  rngSeed,
  skillDefinitions,
  skillsOf,
  type DropContext,
  type PathId,
  type RngState,
  type SkillDef,
  type SkillDefinitions,
} from '@vgtd/shared';
import {
  CastReason,
  emptyCooldowns,
  lineOfSight,
  type EntityState,
  type SimContext,
  type SimEvent,
  type SimInput,
  type SimWorld,
} from '@vgtd/sim';
import { DEFAULT_PATH, makeProfile } from './profile.js';
import { resolveCast, type ResolveTarget } from './resolve.js';
import { type CombatEvent, type CombatOptions, type CombatProfile, type CombatResult } from './types.js';

interface PlayerCombat {
  profile: CombatProfile;
  hpMax: number;
  alive: boolean;
  respawnAtMs: number;
  shield: number;
  shieldUntilMs: number;
}

interface Pending {
  resolveAtMs: number;
  casterId: number;
  seq: number;
  wireId: number;
  skill: SkillDef;
  targetId: number;
  roll: number;
  readyAtMs: number;
}

export interface PostStep {
  world: SimWorld;
  results: CombatResult[];
  events: CombatEvent[];
}

const TWO_32 = 4294967296;
const castKey = (id: number, seq: number): number => id * 65536 + (seq & 0xffff);

export class CombatSystem {
  private readonly defs: SkillDefinitions;
  private readonly players = new Map<number, PlayerCombat>();
  private readonly dataByWire = new Map<number, SkillDef>();
  private readonly ownedByPath = new Map<PathId, Set<number>>();
  private readonly inflight = new Map<number, number>();
  private pending: Pending[] = [];
  private dropRng: RngState;
  private readonly respawnDelayMs: number;

  constructor(
    private readonly ctx: SimContext,
    private readonly opts: CombatOptions = {},
  ) {
    this.defs = opts.defs ?? skillDefinitions;
    this.dropRng = rngFork(rngSeed(opts.seed ?? 1), 'drop');
    this.respawnDelayMs = opts.respawnDelayMs ?? COMBAT_RULES.RESPAWN_PVE_MS;
    for (const s of ctx.skills) {
      const d = this.defs.skills.find((x) => x.id === s.key);
      if (d) this.dataByWire.set(s.id, d);
    }
  }

  // ------------------------------------------------------------------ players
  /** Register a player; returns the stats the entity must be spawned with. */
  addPlayer(id: number, path: PathId = DEFAULT_PATH, realm = 1, substage = 1): { hpMax: number; mpMax: number } {
    const profile = makeProfile(path, realm, substage, this.defs);
    this.players.set(id, {
      profile,
      hpMax: profile.stats.hp,
      alive: true,
      respawnAtMs: 0,
      shield: 0,
      shieldUntilMs: 0,
    });
    return { hpMax: profile.stats.hp, mpMax: profile.stats.mp };
  }

  /**
   * The player reached a new realm / sub-stage (progression, #205 `onStageChange`): re-derive the combat profile and the max HP / MP,
   * keeping the current HP and MP ratios. Class (path) is kept. Returns the new world.
   */
  setRealm(world: SimWorld, id: number, realm: number, substage: number): SimWorld {
    const p = this.players.get(id);
    const e = world.entities.find((x) => x.id === id);
    if (!p || !e) return world;
    const hpRatio = p.hpMax > 0 ? e.hp / p.hpMax : 1;
    const mpRatio = e.mpMax > 0 ? e.mp / e.mpMax : 1;
    p.profile = makeProfile(p.profile.path, realm, substage, this.defs);
    p.hpMax = p.profile.stats.hp;
    const mpMax = p.profile.stats.mp;
    return patch(
      world,
      new Map([
        [id, { hp: p.alive ? Math.max(1, Math.round(p.hpMax * hpRatio)) : 0, mpMax, mp: Math.round(mpMax * mpRatio) }],
      ]),
    );
  }

  removePlayer(id: number): void {
    this.players.delete(id);
    this.pending = this.pending.filter((p) => p.casterId !== id);
  }

  isAlive(id: number): boolean {
    return this.players.get(id)?.alive ?? true;
  }

  /** Max HP of a registered player (undefined for anything else): the node uses it for `hpPct`. */
  maxHpOf(id: number): number | undefined {
    return this.players.get(id)?.hpMax;
  }

  /** Max HP of a living mob through the `MobPort` (undefined for anything else): the node uses it for `hpPct` / `maxHp` of mobs. */
  mobHpMax(id: number): number | undefined {
    return this.opts.mobs?.combatStats(id)?.hpMax;
  }

  profileOf(id: number): CombatProfile | undefined {
    return this.players.get(id)?.profile;
  }

  shieldOf(id: number, nowMs: number): number {
    const p = this.players.get(id);
    return p && nowMs < p.shieldUntilMs ? p.shield : 0;
  }

  private owns(path: PathId, wireId: number): boolean {
    let set = this.ownedByPath.get(path);
    if (!set) {
      const keys = new Set(skillsOf(path, this.defs).map((s) => s.id));
      set = new Set<number>();
      for (const s of this.ctx.skills) if (keys.has(s.key)) set.add(s.id);
      this.ownedByPath.set(path, set);
    }
    return set.has(wireId);
  }

  // ------------------------------------------------------------------ before the sim step
  /**
   * Filter the tick's inputs: a dead player neither moves nor casts (the cast is answered `Controlled`), and a player can only cast the
   * 8 skills of their class (`UnknownSkill` otherwise). Returns the inputs to feed `step()` and immediate rejections.
   */
  preStep(inputs: readonly SimInput[], world: SimWorld): { inputs: SimInput[]; results: CombatResult[] } {
    const keep: SimInput[] = [];
    const results: CombatResult[] = [];
    const seen = new Set<number>();
    for (const inp of inputs) {
      const p = this.players.get(inp.entityId);
      if (!p) {
        keep.push(inp); // not a combat-registered entity: leave it to the sim
        continue;
      }
      if (inp.kind === 'move') {
        if (p.alive) keep.push(inp);
        continue;
      }
      // a client seq is unique: a second cast with the same (entity, seq) in one tick is malformed, the first one wins
      const key = castKey(inp.entityId, inp.seq);
      if (seen.has(key)) continue;
      seen.add(key);
      const reject = (reason: CastReason): void => {
        results.push({
          entityId: inp.entityId,
          seq: inp.seq,
          skillId: inp.skillId,
          reason,
          readyAtMs: world.timeMs,
          hits: [],
        });
      };
      if (!p.alive) reject(CastReason.Controlled);
      else if (!this.owns(p.profile.path, inp.skillId)) reject(CastReason.UnknownSkill);
      else {
        this.inflight.set(key, inp.targetId);
        keep.push(inp);
      }
    }
    return { inputs: keep, results };
  }

  // ------------------------------------------------------------------ after the sim step
  postStep(world: SimWorld, simEvents: readonly SimEvent[]): PostStep {
    const events: CombatEvent[] = [];
    const results: CombatResult[] = [];
    const now = world.timeMs;
    for (const ev of simEvents) {
      if (ev.type === 'cast_ok') {
        const skill = this.dataByWire.get(ev.skillId);
        const key = castKey(ev.entityId, ev.seq);
        const targetId = this.inflight.get(key) ?? 0;
        this.inflight.delete(key);
        if (!skill || !this.players.has(ev.entityId)) continue;
        const castMs = skill.timing.cast_ms + (skill.timing.channel_ms ?? 0);
        this.pending.push({
          resolveAtMs: now + castMs,
          casterId: ev.entityId,
          seq: ev.seq,
          wireId: ev.skillId,
          skill,
          targetId,
          roll: ev.roll,
          readyAtMs: ev.readyAtMs,
        });
      } else if (ev.type === 'cast_rejected' || ev.type === 'cast_dropped') {
        this.inflight.delete(castKey(ev.entityId, ev.seq));
      }
    }

    let w = world;
    // casts whose cast time elapsed, in a fixed order
    const due = this.pending
      .filter((p) => p.resolveAtMs <= now)
      .sort((a, b) => a.resolveAtMs - b.resolveAtMs || a.casterId - b.casterId || a.seq - b.seq);
    this.pending = this.pending.filter((p) => p.resolveAtMs > now);
    for (const p of due) w = this.resolve(w, p, results, events);
    w = this.respawnDue(w, events);
    this.inflight.clear(); // every entry belongs to this tick's inputs: anything left (no sim event) is stale
    return { world: w, results, events };
  }

  /** Damage a player from outside the cast pipeline (mob attacks, PvP, environment). Shields absorb first. */
  damagePlayer(
    world: SimWorld,
    id: number,
    amount: number,
    sourceId: number,
  ): { world: SimWorld; events: CombatEvent[] } {
    const events: CombatEvent[] = [];
    const p = this.players.get(id);
    const e = world.entities.find((x) => x.id === id);
    if (!p || !e || !p.alive || e.hp <= 0 || amount <= 0) return { world, events };
    let dmg = Math.round(amount);
    if (world.timeMs < p.shieldUntilMs && p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
    }
    const hp = Math.max(0, e.hp - dmg);
    const killed = hp <= 0;
    events.push({ type: 'damage', sourceId, targetId: id, amount: Math.round(amount), crit: false, killed });
    let w = patch(world, new Map([[id, { hp }]]));
    if (killed) {
      p.alive = false;
      p.respawnAtMs = world.timeMs + this.respawnDelayMs;
      this.pending = this.pending.filter((c) => c.casterId !== id); // a dead caster's casts are cancelled
      events.push({ type: 'death', id, killerId: sourceId });
      w = patch(w, new Map([[id, { vi: 0, vj: 0, pending: [] }]]));
    }
    return { world: w, events };
  }

  // ------------------------------------------------------------------ internals
  private enemiesNear(world: SimWorld): ResolveTarget[] {
    const mobs = this.opts.mobs;
    if (!mobs) return [];
    const out: ResolveTarget[] = [];
    for (const e of world.entities) {
      if (e.hp <= 0) continue;
      const s = mobs.combatStats(e.id);
      if (s)
        out.push({ id: e.id, i: e.i, j: e.j, hpMax: s.hpMax, defense: s.defense, realm: s.realm, element: s.element });
    }
    return out;
  }

  private resolve(world: SimWorld, c: Pending, results: CombatResult[], events: CombatEvent[]): SimWorld {
    const pc = this.players.get(c.casterId);
    const caster = world.entities.find((e) => e.id === c.casterId);
    const base: CombatResult = {
      entityId: c.casterId,
      seq: c.seq,
      skillId: c.wireId,
      reason: CastReason.Ok,
      readyAtMs: c.readyAtMs,
      hits: [],
    };
    if (!pc || !caster || !pc.alive || caster.hp <= 0) {
      events.push({ type: 'cast_cancelled', entityId: c.casterId, seq: c.seq });
      results.push({ ...base, reason: CastReason.Controlled, hits: [] });
      return world;
    }
    // the cast's own PRNG: seeded from the sim roll (a function of the world seed + accepted-cast order only)
    let st: RngState = rngSeed(Math.floor(c.roll * TWO_32) >>> 0);
    const rand = (): number => {
      const [v, n] = rngFloat(st);
      st = n;
      return v;
    };
    const out = resolveCast({
      casterId: c.casterId,
      caster: { i: caster.i, j: caster.j },
      facing: caster.facing,
      profile: pc.profile,
      skill: c.skill,
      targetId: c.targetId,
      enemies: this.enemiesNear(world),
      rand,
      losClear: (a, b) => lineOfSight(this.ctx.grid, a.i, a.j, b.i, b.j, caster.layer, caster.flying),
      defs: this.defs,
    });
    for (const u of new Set(out.unsupported))
      events.push({ type: 'unsupported_effect', skillKey: c.skill.id, effect: u });

    const patches = new Map<number, Partial<EntityState>>();
    let w = world;
    const killed: number[] = [];
    for (const h of out.hits) {
      const target = world.entities.find((e) => e.id === h.targetId)!;
      const hp = Math.max(0, target.hp - h.damage);
      patches.set(h.targetId, { hp });
      const dead = hp <= 0;
      events.push({
        type: 'damage',
        sourceId: c.casterId,
        targetId: h.targetId,
        amount: h.damage,
        crit: h.crit,
        killed: dead,
      });
      pushHit(base.hits, h.targetId, h.damage, h.crit, dead);
      if (dead) killed.push(h.targetId);
    }
    // heal / shield: the caster, or the targeted ally for `ally_or_self` skills
    const ally =
      c.skill.targeting.mode === 'ally_or_self' && c.targetId !== 0 && c.targetId !== c.casterId
        ? this.players.get(c.targetId) && this.players.get(c.targetId)!.alive
          ? c.targetId
          : c.casterId
        : c.casterId;
    const sup = this.players.get(ally)!;
    if (out.heal > 0) {
      const e = world.entities.find((x) => x.id === ally)!;
      const healed = Math.max(0, Math.min(out.heal, sup.hpMax - e.hp));
      patches.set(ally, { ...(patches.get(ally) ?? {}), hp: (patches.get(ally)?.hp ?? e.hp) + healed });
      events.push({ type: 'heal', targetId: ally, amount: healed });
    }
    if (out.shield > 0) {
      sup.shield = out.shield;
      sup.shieldUntilMs = world.timeMs + out.shieldDurationMs;
      events.push({ type: 'shield', targetId: ally, amount: out.shield });
    }
    w = patch(w, patches);
    for (const id of killed) {
      events.push({ type: 'death', id, killerId: c.casterId });
      w = this.onMobKilled(w, id, c.casterId, pc, events);
    }
    results.push(base);
    return w;
  }

  private onMobKilled(
    world: SimWorld,
    mobId: number,
    killerId: number,
    killer: PlayerCombat,
    events: CombatEvent[],
  ): SimWorld {
    const mobs = this.opts.mobs;
    const stats = mobs?.combatStats(mobId);
    if (!mobs || !stats) return world;
    const ctx: DropContext = {
      source: stats.dropSource,
      monsterRealm: stats.realm,
      realmGap: Math.max(0, killer.profile.realm - stats.realm),
      partySize: 1,
    };
    const rng = (): number => {
      const [v, n] = rngFloat(this.dropRng);
      this.dropRng = n;
      return v;
    };
    const rolls = resolveDrops(ctx, rng);
    events.push({ type: 'drops', killerId, mobId, rolls });
    this.opts.onDrops?.({ killerId, mobId, rolls });
    return mobs.kill(world, mobId);
  }

  private respawnDue(world: SimWorld, events: CombatEvent[]): SimWorld {
    let w = world;
    for (const [id, p] of [...this.players.entries()].sort((a, b) => a[0] - b[0])) {
      if (p.alive || world.timeMs < p.respawnAtMs) continue;
      const e = w.entities.find((x) => x.id === id);
      if (!e) continue;
      p.alive = true;
      p.shield = 0;
      p.shieldUntilMs = 0;
      const at = this.opts.respawnPoint?.(id) ?? { i: e.i, j: e.j };
      w = patch(
        w,
        new Map([
          [
            id,
            {
              hp: p.hpMax,
              mp: e.mpMax,
              i: at.i,
              j: at.j,
              vi: 0,
              vj: 0,
              dashLeftMs: 0,
              invulnMs: 0,
              stunMs: 0,
              pending: [],
              cooldowns: emptyCooldowns(),
              gcdReadyAt: 0,
            },
          ],
        ]),
      );
      events.push({ type: 'respawn', id });
    }
    return w;
  }

  /** Serializable digest of the combat state (replay / determinism tests). */
  stateDigest(): string {
    return JSON.stringify({
      players: [...this.players.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([id, p]) => [id, p.alive, p.respawnAtMs, p.shield, p.shieldUntilMs]),
      pending: this.pending.map((p) => [p.resolveAtMs, p.casterId, p.seq, p.wireId, p.targetId]),
      drop: this.dropRng,
    });
  }
}

function pushHit(hits: CombatResult['hits'], targetId: number, damage: number, crit: boolean, killed: boolean): void {
  hits.push({ targetId, damage, flags: (crit ? HIT_FLAG_CRIT : 0) | (killed ? HIT_FLAG_KILL : 0) });
}

/** Immutable entity patch keeping `entities` sorted and untouched ids shared. */
function patch(world: SimWorld, patches: ReadonlyMap<number, Partial<EntityState>>): SimWorld {
  if (patches.size === 0) return world;
  return {
    ...world,
    entities: world.entities.map((e) => {
      const p = patches.get(e.id);
      return p ? { ...e, ...p } : e;
    }),
  };
}
