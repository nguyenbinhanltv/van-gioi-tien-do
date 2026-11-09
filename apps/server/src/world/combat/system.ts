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
  COLLIDER_RADIUS_TILES,
  COMBAT_RULES,
  HIT_FLAG_CRIT,
  MOB_ID_BASE,
  SKILL_EFFECTS,
  damageBreakdown,
  effectActive,
  type SkillEffect,
  HIT_FLAG_KILL,
  resolveDrops,
  rngFloat,
  rngFork,
  rngSeed,
  ITEM_USE,
  NETWORK,
  REGEN,
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
  DIR_COS,
  DIR_SIN,
  circleBlocked,
  emptyCooldowns,
  hypot,
  lineOfSight,
  type EntityState,
  type SimContext,
  type SimEvent,
  type SimInput,
  type SimWorld,
} from '@vgtd/sim';
import { DEFAULT_PATH, makeProfile } from './profile.js';
import { StatusSystem } from './status.js';
import { EffectSystem } from './effects.js';
import { resolveCast, type CastOutcome, type ResolveTarget } from './resolve.js';
import {
  type AimedInput,
  type CombatEvent,
  type CombatOptions,
  type CombatProfile,
  type CombatResult,
} from './types.js';

interface PlayerCombat {
  profile: CombatProfile;
  hpMax: number;
  alive: boolean;
  respawnAtMs: number;
  shield: number;
  shieldUntilMs: number;
  /** the shield bursts into damage around the player when it ends or breaks (`explode` of the shield effect, D116) */
  shieldExplode: { coeff: number; radius: number; srcId: number } | null;
  /** sim time of the last damage dealt or taken (regeneration is slower in combat, D88) */
  lastCombatMs: number;
  /** sim time at which the shared pill cooldown ends (D90) */
  pillReadyAtMs: number;
  /** fractional HP / MP not yet applied (vitals are integers; the remainder carries over) */
  hpFrac: number;
  mpFrac: number;
}

interface Pending {
  resolveAtMs: number;
  casterId: number;
  seq: number;
  wireId: number;
  skill: SkillDef;
  targetId: number;
  aim: { i: number; j: number } | null;
  roll: number;
  readyAtMs: number;
}

export interface PostStep {
  world: SimWorld;
  results: CombatResult[];
  events: CombatEvent[];
}

const TWO_32 = 4294967296;
/** hurtbox radius used for the reach checks of state effects, as in `geometry.ts` */
const SKILL_HURTBOX = 0.45;
const castKey = (id: number, seq: number): number => id * 65536 + (seq & 0xffff);

export class CombatSystem {
  private readonly defs: SkillDefinitions;
  private readonly players = new Map<number, PlayerCombat>();
  private readonly dataByWire = new Map<number, SkillDef>();
  private readonly ownedByPath = new Map<PathId, Set<number>>();
  private readonly inflight = new Map<number, { targetId: number; aim: { i: number; j: number } | null }>();
  private pending: Pending[] = [];
  private dropRng: RngState;
  private readonly respawnDelayMs: number;
  /** root / slow / poison / pools put on players by elite and boss skills (D91) */
  readonly status = new StatusSystem();
  /** buffs, heal-over-time zones, pets, and the control / marks / debuffs / dots on mobs put by player skills (D116) */
  readonly effects = new EffectSystem();
  /** mobs whose current attack was interrupted (a hard CC or a knock-back on a boss): `MobAttackSystem` cancels their telegraph and clears this */
  readonly interrupted = new Set<number>();

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
      shieldExplode: null,
      lastCombatMs: -REGEN.outOfCombatDelayMs, // a new player starts out of combat
      pillReadyAtMs: 0,
      hpFrac: 0,
      mpFrac: 0,
    });
    this.effects.setPet(id, profile.pet ? { ...profile.pet, nextMs: 0 } : null);
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
    this.status.clear(id);
    this.effects.clearPlayer(id);
    this.effects.setPet(id, null);
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
  preStep(inputs: readonly AimedInput[], world: SimWorld): { inputs: SimInput[]; results: CombatResult[] } {
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
        if (p.alive) keep.push(this.status.adjustMove(inp, world.timeMs));
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
        this.inflight.set(key, { targetId: inp.targetId, aim: inp.aim ?? null });
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
        const cast = this.inflight.get(key);
        const targetId = cast?.targetId ?? 0;
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
          aim: cast?.aim ?? null,
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
    w = this.tickEffects(w, events);
    w = this.respawnDue(w, events);
    w = this.regenerate(w);
    w = this.applyStatus(w, events);
    this.inflight.clear(); // every entry belongs to this tick's inputs: anything left (no sim event) is stale
    return { world: w, results, events };
  }

  /** Poison and pool ticks that are due (D91): plain damage on living players, through `damagePlayer`. */
  private applyStatus(world: SimWorld, events: CombatEvent[]): SimWorld {
    const living: Array<{ id: number; i: number; j: number }> = [];
    for (const e of world.entities)
      if (e.hp > 0 && this.players.get(e.id)?.alive) living.push({ id: e.id, i: e.i, j: e.j });
    let w = world;
    for (const hit of this.status.tick(world.timeMs, living)) {
      const r = this.damagePlayer(w, hit.targetId, hit.amount, hit.sourceId);
      w = r.world;
      for (const ev of r.events) events.push(ev);
    }
    return w;
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
    p.lastCombatMs = world.timeMs;
    amount *= 1 - this.drOf(id, world.timeMs); // `dr_pct` buffs (D116)
    let dmg = Math.round(amount);
    let burst = false;
    if (world.timeMs < p.shieldUntilMs && p.shield > 0) {
      const absorbed = Math.min(p.shield, dmg);
      p.shield -= absorbed;
      dmg -= absorbed;
      burst = p.shield <= 0 && p.shieldExplode !== null;
    }
    const hp = Math.max(0, e.hp - dmg);
    const killed = hp <= 0;
    events.push({ type: 'damage', sourceId, targetId: id, amount: Math.round(amount), crit: false, killed });
    let w = patch(world, new Map([[id, { hp }]]));
    if (burst) w = this.explodeShield(w, id, events);
    if (killed) {
      p.alive = false;
      p.respawnAtMs = world.timeMs + this.respawnDelayMs;
      this.pending = this.pending.filter((c) => c.casterId !== id); // a dead caster's casts are cancelled
      events.push({ type: 'death', id, killerId: sourceId });
      w = patch(w, new Map([[id, { vi: 0, vj: 0, pending: [] }]]));
    }
    return { world: w, events };
  }

  // ------------------------------------------------------------------ item use (D90)
  /**
   * Drink a heal pill: `ITEM_USE.healPill.healPct` of max HP, shared cooldown `cooldownMs`. Refused (nothing changes, the caller keeps
   * the item) when the player is unknown, dead, at full HP or still cooling down. Healing is not combat (regeneration is unaffected).
   */
  usePill(
    world: SimWorld,
    id: number,
  ): {
    world: SimWorld;
    result: 'ok' | 'unknown' | 'dead' | 'full' | 'cooldown';
    healed: number;
    events: CombatEvent[];
  } {
    const p = this.players.get(id);
    const e = world.entities.find((x) => x.id === id);
    const none = (result: 'unknown' | 'dead' | 'full' | 'cooldown') => ({ world, result, healed: 0, events: [] });
    if (!p || !e) return none('unknown');
    if (!p.alive || e.hp <= 0) return none('dead');
    if (world.timeMs < p.pillReadyAtMs) return none('cooldown');
    if (e.hp >= p.hpMax) return none('full');
    const power = 1 + p.profile.potionPower; // `potion_power` passive (D116)
    const healed = Math.min(p.hpMax - e.hp, Math.max(1, Math.round(p.hpMax * ITEM_USE.healPill.healPct * power)));
    p.pillReadyAtMs = world.timeMs + ITEM_USE.healPill.cooldownMs;
    return {
      world: patch(world, new Map([[id, { hp: e.hp + healed }]])),
      result: 'ok',
      healed,
      events: [{ type: 'heal', targetId: id, amount: healed }],
    };
  }

  /** Milliseconds until the shared pill cooldown ends (0 = ready), for tests and diagnostics. */
  pillCooldownMs(id: number, nowMs: number): number {
    return Math.max(0, (this.players.get(id)?.pillReadyAtMs ?? 0) - nowMs);
  }

  // ------------------------------------------------------------------ regeneration (D88)
  /**
   * HP / MP regeneration, every `REGEN.periodTicks` ticks (the percentages are per second of the player's max). In combat (damage
   * dealt or taken within `REGEN.outOfCombatDelayMs`) only the trickle of MP applies; out of combat HP and MP regenerate, MP faster
   * while meditating. Dead players do not regenerate. Integer vitals: the fractional part is carried in the player's accumulators, so
   * the result depends only on the sim time and the damage history (no clocks, no randomness; entities are visited in id order).
   */
  private regenerate(world: SimWorld): SimWorld {
    if (world.tick % REGEN.periodTicks !== 0) return world;
    const dtS = (REGEN.periodTicks * NETWORK.TICK_MS) / 1000;
    let patches: Map<number, Partial<EntityState>> | null = null;
    for (const e of world.entities) {
      const p = this.players.get(e.id);
      if (!p || !p.alive || e.hp <= 0) continue;
      const inCombat = world.timeMs - p.lastCombatMs < REGEN.outOfCombatDelayMs;
      const hpPct = inCombat ? REGEN.hpCombatPctPerS : REGEN.hpIdlePctPerS;
      const mpPct = inCombat
        ? REGEN.mpCombatPctPerS
        : this.opts.isMeditating?.(e.id)
          ? REGEN.mpMeditationPctPerS
          : REGEN.mpIdlePctPerS;
      let hp = e.hp;
      let mp = e.mp;
      if (hp < p.hpMax && hpPct > 0) {
        p.hpFrac += p.hpMax * hpPct * dtS;
        const whole = Math.floor(p.hpFrac);
        p.hpFrac -= whole;
        hp = Math.min(p.hpMax, hp + whole);
      }
      if (hp >= p.hpMax) p.hpFrac = 0;
      if (mp < e.mpMax && mpPct > 0) {
        p.mpFrac += e.mpMax * mpPct * dtS;
        const whole = Math.floor(p.mpFrac);
        p.mpFrac -= whole;
        mp = Math.min(e.mpMax, mp + whole);
      }
      if (mp >= e.mpMax) p.mpFrac = 0;
      if (hp !== e.hp || mp !== e.mp) (patches ??= new Map()).set(e.id, { hp, mp });
    }
    return patches ? patch(world, patches) : world;
  }

  // ------------------------------------------------------------------ skill effects (D116)
  /** The caster and its living party members (alive players only), caster first. A solo player's group is just itself. */
  private groupOf(world: SimWorld, casterId: number, includeDead = false): number[] {
    const at = world.entities.find((e) => e.id === casterId);
    const out = [casterId];
    if (!at) return out;
    for (const id of [...new Set(this.opts.partyOf?.(casterId) ?? [])].sort((a, b) => a - b)) {
      const pl = this.players.get(id);
      if (id === casterId || !pl || (!includeDead && !pl.alive)) continue;
      const e = world.entities.find((x) => x.id === id);
      if (e && (includeDead || e.hp > 0) && hypot(e.i - at.i, e.j - at.j) <= SKILL_EFFECTS.GROUP_RANGE_TILES)
        out.push(id);
    }
    return out;
  }

  /** Outgoing-damage modifiers of a player from its buffs and passives (the design simulation's `dmgMods` / `critChance`). */
  private modsOf(id: number, nowMs: number, hp: number): { dmgMult: number; critBonus: number; penBonus: number } {
    const p = this.players.get(id);
    const low = p && hp < p.hpMax * SKILL_EFFECTS.LOW_HP ? p.profile.lowHpDmgPct : 0;
    return {
      dmgMult: 1 + this.effects.buffSum(id, 'dmg_pct', nowMs) + low,
      critBonus: this.effects.buffSum(id, 'crit_chance', nowMs),
      penBonus: this.effects.buffSum(id, 'pen', nowMs),
    };
  }
  private lifestealOf(id: number, nowMs: number): number {
    return (this.players.get(id)?.profile.lifesteal ?? 0) + this.effects.buffSum(id, 'lifesteal', nowMs);
  }
  /** Damage reduction of a player (`dr_pct` buffs), capped. */
  drOf(id: number, nowMs: number): number {
    return Math.min(SKILL_EFFECTS.DR_CAP, Math.max(0, this.effects.buffSum(id, 'dr_pct', nowMs)));
  }
  /** DEF a mob attack is resolved against: the realm DEF x (1 + def_pct of the passives and buffs), floored. */
  defenseOf(id: number, nowMs: number): number {
    const p = this.players.get(id);
    if (!p) return 0;
    return (
      p.profile.stats.def *
      Math.max(SKILL_EFFECTS.DEF_FACTOR_MIN, 1 + p.profile.defPct + this.effects.buffSum(id, 'def_pct', nowMs))
    );
  }

  private lifestealHeal(world: SimWorld, id: number, dealt: number, events: CombatEvent[]): SimWorld {
    const ls = this.lifestealOf(id, world.timeMs);
    const p = this.players.get(id);
    const e = world.entities.find((x) => x.id === id);
    if (ls <= 0 || dealt <= 0 || !p || !p.alive || !e || e.hp <= 0) return world;
    const healed = Math.min(p.hpMax - e.hp, Math.round(dealt * ls));
    if (healed <= 0) return world;
    events.push({ type: 'heal', targetId: id, amount: healed });
    return patch(world, new Map([[id, { hp: e.hp + healed }]]));
  }

  /** One fixed hit (no crit, mid jitter) of `coeff` x the caster's ATK on a mob: dot ticks, detonations, bursts, pets. */
  private fixedHit(world: SimWorld, casterId: number, mob: ResolveTarget, coeff: number, extraDmgMult = 1): number {
    const pc = this.players.get(casterId);
    if (!pc) return 0;
    const m = this.modsOf(casterId, world.timeMs, world.entities.find((e) => e.id === casterId)?.hp ?? pc.hpMax);
    const b = damageBreakdown({
      atk: pc.profile.stats.atk,
      def: mob.defense,
      cSkill: coeff,
      attackerElement: pc.profile.element,
      defenderElement: mob.element ?? undefined,
      pen: pc.profile.pen + m.penBonus,
      crit: false,
      attackerRealm: pc.profile.realm,
      defenderRealm: mob.realm,
      rand: 0.5,
    });
    return Math.max(1, Math.round(b.damage * m.dmgMult * extraDmgMult));
  }

  /** Damage a mob from a source that is not a cast hit: patch HP, event, threat, lifesteal, kill and loot. */
  private hurtMob(world: SimWorld, mobId: number, dmg: number, srcId: number, events: CombatEvent[]): SimWorld {
    const e = world.entities.find((x) => x.id === mobId);
    if (!e || e.hp <= 0 || dmg <= 0) return world;
    const hp = Math.max(0, e.hp - dmg);
    const dead = hp <= 0;
    events.push({ type: 'damage', sourceId: srcId, targetId: mobId, amount: dmg, crit: false, killed: dead });
    let w = patch(world, new Map([[mobId, { hp }]]));
    const pc = this.players.get(srcId);
    if (pc) pc.lastCombatMs = world.timeMs;
    if (!dead) this.opts.mobs?.onDamage?.(mobId, srcId, dmg);
    w = this.lifestealHeal(w, srcId, dmg, events);
    if (dead) {
      events.push({ type: 'death', id: mobId, killerId: srcId });
      if (pc) w = this.onMobKilled(w, mobId, srcId, pc, events);
    }
    return w;
  }

  private tierOf(mobId: number): string | undefined {
    return this.opts.mobs?.combatStats(mobId)?.tier;
  }

  /** Walk an entity up to `dist` tiles along (di, dj), stopping before anything blocked on the grid (walls, water, lava: D95 grid). */
  private moveEntity(world: SimWorld, id: number, di: number, dj: number, dist: number): SimWorld {
    const e = world.entities.find((x) => x.id === id);
    const len = hypot(di, dj);
    if (!e || len < 1e-9 || dist <= 0) return world;
    const ux = di / len;
    const uy = dj / len;
    const mob = id >= MOB_ID_BASE;
    let i = e.i;
    let j = e.j;
    for (let d = 0; d < dist - 1e-9;) {
      const step = Math.min(SKILL_EFFECTS.MOVE_STEP_TILES, dist - d);
      const ni = i + ux * step;
      const nj = j + uy * step;
      if (circleBlocked(this.ctx.grid, ni, nj, COLLIDER_RADIUS_TILES, e.layer, e.flying)) break;
      i = ni;
      j = nj;
      d += step;
    }
    if (i === e.i && j === e.j) return world;
    return patch(world, new Map([[id, mob ? { i, j } : { i, j, vi: 0, vj: 0 }]]));
  }

  private applyStateEffects(world: SimWorld, c: Pending, out: CastOutcome, events: CombatEvent[]): SimWorld {
    if (out.effects.length === 0) return world;
    let w = world;
    const now = world.timeMs;
    const casterId = c.casterId;
    const grouped = this.groupOf(world, casterId, true).length > 1; // the group context needs a party member near, alive or not (revive)
    const pc = this.players.get(casterId)!;
    const aimPt = c.skill.targeting.mode === 'ground' ? c.aim : null;
    for (const e of out.effects) {
      if (!effectActive(e, grouped)) continue;
      const me = w.entities.find((x) => x.id === casterId);
      if (!me) break;
      // the client's aim point is only trusted when it is finite, within the skill's range and (if needed) in sight, like `resolveCast`
      const range = c.skill.targeting.range_tiles ?? 0;
      const aimOk =
        !!aimPt &&
        Number.isFinite(aimPt.i) &&
        Number.isFinite(aimPt.j) &&
        (range <= 0 || hypot(aimPt.i - me.i, aimPt.j - me.j) <= range) &&
        (c.skill.targeting.requires_los === false ||
          lineOfSight(this.ctx.grid, me.i, me.j, aimPt.i, aimPt.j, me.layer, me.flying));
      const centre = aimOk ? aimPt! : { i: me.i, j: me.j };
      switch (e.type) {
        case 'status':
          for (const v of out.victims) this.applyMobStatus(v.id, e, now);
          break;
        case 'debuff':
          if (e.stat === 'def_shred')
            for (const v of out.victims) this.effects.shredMob(v.id, now, e.duration_ms ?? 0, e.magnitude ?? 0);
          break;
        case 'dot':
          if (e.scale)
            for (const v of out.victims)
              this.effects.dots.push({
                src: casterId,
                target: v.id,
                perTick: this.fixedHit(w, casterId, v, e.scale.coeff),
                intervalMs: Math.max(1, e.tick_interval_ms ?? 1000),
                nextMs: now + Math.max(1, e.tick_interval_ms ?? 1000),
                untilMs: now + (e.duration_ms ?? 0),
                skill: c.skill.id,
              });
          break;
        case 'mark':
          for (const v of out.victims) w = this.applyMark(w, casterId, v, e, events);
          break;
        case 'detonate': {
          const r = e.radius ?? 5;
          for (const t of this.enemiesNear(w, casterId)) {
            if (hypot(t.i - me.i, t.j - me.j) > r + SKILL_HURTBOX) continue;
            const stacks = this.effects.marksOf(t.id, e.mark_id ?? '', now);
            if (stacks <= 0 || !e.scale) continue;
            this.effects.clearMark(t.id, e.mark_id ?? '');
            for (let k = 0; k < stacks; k++)
              w = this.hurtMob(w, t.id, this.fixedHit(w, casterId, t, e.scale.coeff), casterId, events);
          }
          break;
        }
        case 'hot': {
          if (!e.scale) break;
          const stat = e.scale.stat === 'hp_max' ? pc.profile.stats.hp : pc.profile.stats.atk;
          const self = e.applies_to === 'self';
          this.effects.zones.push({
            src: casterId,
            group: self ? [casterId] : this.groupOf(w, casterId),
            i: centre.i,
            j: centre.j,
            radius: self ? 0 : (e.radius ?? 4),
            perTick: Math.round(stat * e.scale.coeff),
            intervalMs: Math.max(1, e.tick_interval_ms ?? 1000),
            nextMs: now + Math.max(1, e.tick_interval_ms ?? 1000),
            untilMs: now + (e.duration_ms ?? 0),
          });
          break;
        }
        case 'buff': {
          const recv =
            e.applies_to === 'all'
              ? this.groupOf(w, casterId).filter((id) => {
                  const q = w.entities.find((x) => x.id === id);
                  return !!q && hypot(q.i - centre.i, q.j - centre.j) <= (e.radius ?? 12);
                })
              : [casterId];
          for (const id of recv)
            this.effects.addBuff(id, {
              stat: e.stat ?? '',
              mag: e.magnitude ?? 0,
              untilMs: now + (e.duration_ms ?? 0),
              src: casterId,
            });
          break;
        }
        case 'restore_mp': {
          w = patch(
            w,
            new Map([[casterId, { mp: Math.min(me.mpMax, me.mp + Math.round(me.mpMax * (e.magnitude ?? 0))) }]]),
          );
          break;
        }
        case 'knockback':
          for (const v of out.victims) {
            if (this.tierOf(v.id) === 'boss') this.interrupted.add(v.id);
            else w = this.moveEntity(w, v.id, v.i - me.i, v.j - me.j, e.distance_tiles ?? 0);
          }
          break;
        case 'pull':
          for (const t of this.enemiesNear(w, casterId)) {
            const cur = hypot(t.i - me.i, t.j - me.j);
            if (cur > (e.radius ?? 4) + SKILL_HURTBOX || this.tierOf(t.id) === 'boss') continue;
            const go = Math.max(0, cur - Math.max(SKILL_EFFECTS.PULL_MIN_TILES, cur - (e.distance_tiles ?? 0)));
            w = this.moveEntity(w, t.id, me.i - t.i, me.j - t.j, go);
          }
          break;
        case 'taunt':
          for (const t of this.enemiesNear(w, casterId))
            if (hypot(t.i - me.i, t.j - me.j) <= (e.radius ?? 4) + SKILL_HURTBOX)
              this.effects.tauntMob(t.id, casterId, now, e.duration_ms ?? 0);
          break;
        case 'dash':
          w = this.dash(w, c, out, e);
          break;
        case 'revive': {
          const target = this.players.get(c.targetId);
          if (!target || target.alive || c.targetId === casterId) break;
          // only a party member, within the skill's reach, can be revived (the target id is client-supplied)
          if (!this.groupOf(w, casterId, true).includes(c.targetId)) break;
          const corpse = w.entities.find((x) => x.id === c.targetId);
          const reach = c.skill.targeting.range_tiles ?? 0;
          if (!corpse || (reach > 0 && hypot(corpse.i - me.i, corpse.j - me.j) > reach + SKILL_HURTBOX)) break;
          target.alive = true;
          target.respawnAtMs = 0;
          const hp = Math.max(1, Math.round(target.hpMax * (e.magnitude ?? 0.4)));
          w = patch(w, new Map([[c.targetId, { hp, invulnMs: 1000 }]]));
          events.push({ type: 'respawn', id: c.targetId });
          break;
        }
        default:
          break;
      }
    }
    return w;
  }

  /** Control on a mob. Bosses ignore it: a hard CC interrupts their current attack, a slow works at a share (D49, docs/11). */
  private applyMobStatus(mobId: number, e: SkillEffect, now: number): void {
    const ms = e.duration_ms ?? 0;
    const id = e.status_id;
    const hard = id === 'stun' || id === 'freeze' || id === 'knockup' || id === 'root';
    if (this.tierOf(mobId) === 'boss') {
      if (hard) this.interrupted.add(mobId);
      else if (id === 'slow') this.effects.slowMob(mobId, now, ms, (e.magnitude ?? 0) * SKILL_EFFECTS.BOSS_SLOW_MULT);
      return;
    }
    if (id === 'stun' || id === 'freeze' || id === 'knockup') this.effects.stunMob(mobId, now, ms);
    else if (id === 'root') this.effects.rootMob(mobId, now, ms);
    else if (id === 'slow') this.effects.slowMob(mobId, now, ms, e.magnitude ?? 0);
    // `silence`: mobs cast nothing a player can silence yet (and no skill of the data uses it)
  }

  private applyMark(
    world: SimWorld,
    casterId: number,
    v: ResolveTarget,
    e: SkillEffect,
    events: CombatEvent[],
  ): SimWorld {
    const id = e.mark_id ?? '';
    const now = world.timeMs;
    let w = world;
    const stacks = this.effects.stackMark(v.id, id, now, e.duration_ms ?? 0);
    if (stacks < (e.max_stacks ?? 3)) return w;
    // the last stack detonates at once: `stacks` hits on the marked mob, a share of it on its neighbours
    this.effects.clearMark(v.id, id);
    const coeff = e.detonate_coeff ?? 1;
    for (let k = 0; k < stacks; k++) w = this.hurtMob(w, v.id, this.fixedHit(w, casterId, v, coeff), casterId, events);
    const r = e.detonate_radius ?? 0;
    if (r > 0) {
      for (const o of this.enemiesNear(w, casterId)) {
        if (o.id === v.id || hypot(o.i - v.i, o.j - v.j) > r + SKILL_HURTBOX) continue;
        w = this.hurtMob(w, o.id, this.fixedHit(w, casterId, o, coeff, SKILL_EFFECTS.MARK_SPLASH), casterId, events);
      }
    }
    return w;
  }

  /** Dash of the caster (D95 grid: it stops at anything blocked). Forward: toward the aim / target / facing, stopping at the victims or short of the nearest mob. */
  private dash(world: SimWorld, c: Pending, out: CastOutcome, e: SkillEffect): SimWorld {
    const me = world.entities.find((x) => x.id === c.casterId);
    if (!me) return world;
    const d = e.distance_tiles ?? 0;
    const near = (list: ResolveTarget[]): ResolveTarget | undefined =>
      [...list].sort((a, b) => hypot(a.i - me.i, a.j - me.j) - hypot(b.i - me.i, b.j - me.j) || a.id - b.id)[0];
    const code = me.facing;
    if (e.direction === 'back') {
      const n = near(out.victims) ?? near(this.enemiesNear(world, c.casterId));
      const away = n ? { di: me.i - n.i, dj: me.j - n.j } : { di: -(DIR_COS[code] ?? 1), dj: -(DIR_SIN[code] ?? 0) };
      return this.moveEntity(world, c.casterId, away.di, away.dj, d);
    }
    const aim = c.aim && Number.isFinite(c.aim.i) && Number.isFinite(c.aim.j) ? c.aim : null;
    const tgt = c.targetId ? world.entities.find((x) => x.id === c.targetId) : undefined;
    const dir = aim
      ? { di: aim.i - me.i, dj: aim.j - me.j }
      : tgt && tgt.id >= MOB_ID_BASE
        ? { di: tgt.i - me.i, dj: tgt.j - me.j }
        : { di: DIR_COS[code] ?? 1, dj: DIR_SIN[code] ?? 0 };
    let go = d;
    // PROVISIONAL (the design simulation lets the dasher end on the farthest victim): stop DASH_STOP_TILES short of it instead of overlapping
    if (out.victims.length > 0)
      go = Math.max(
        0,
        Math.min(d, Math.max(...out.victims.map((v) => hypot(v.i - me.i, v.j - me.j))) - SKILL_EFFECTS.DASH_STOP_TILES),
      );
    else {
      const n = near(this.enemiesNear(world, c.casterId));
      if (n) go = Math.max(0, Math.min(d, hypot(n.i - me.i, n.j - me.j) - SKILL_EFFECTS.DASH_STOP_TILES));
    }
    return this.moveEntity(world, c.casterId, dir.di, dir.dj, go);
  }

  /** A shield that ended or broke bursts into damage around its owner (the `explode` of the shield effect). */
  private explodeShield(world: SimWorld, ownerId: number, events: CombatEvent[]): SimWorld {
    const p = this.players.get(ownerId);
    const x = p?.shieldExplode;
    const owner = world.entities.find((e) => e.id === ownerId);
    if (!p || !x || !owner) return world;
    p.shieldExplode = null;
    let w = world;
    for (const t of this.enemiesNear(world, x.srcId)) {
      if (hypot(t.i - owner.i, t.j - owner.j) > x.radius + SKILL_HURTBOX) continue;
      w = this.hurtMob(w, t.id, this.fixedHit(w, x.srcId, t, x.coeff), x.srcId, events);
    }
    return w;
  }

  /** Per tick: damage / heal over time, pets, shields that ran out, and housekeeping of expired effects. Deterministic order: dots, zones, pets, shields. */
  private tickEffects(world: SimWorld, events: CombatEvent[]): SimWorld {
    const now = world.timeMs;
    let w = world;
    const fx = this.effects;
    for (const d of [...fx.dots]) {
      while (d.nextMs <= now && d.nextMs <= d.untilMs) {
        d.nextMs += d.intervalMs;
        w = this.hurtMob(w, d.target, d.perTick, d.src, events);
      }
    }
    for (const z of [...fx.zones]) {
      while (z.nextMs <= now && z.nextMs <= z.untilMs) {
        z.nextMs += z.intervalMs;
        for (const id of z.group) {
          const p = this.players.get(id);
          const e = w.entities.find((x) => x.id === id);
          if (!p || !p.alive || !e || e.hp <= 0 || e.hp >= p.hpMax) continue;
          if (z.radius > 0 && hypot(e.i - z.i, e.j - z.j) > z.radius) continue;
          const healed = Math.min(p.hpMax - e.hp, z.perTick);
          if (healed <= 0) continue;
          events.push({ type: 'heal', targetId: id, amount: healed });
          w = patch(w, new Map([[id, { hp: e.hp + healed }]]));
        }
      }
    }
    for (const [id, pet] of fx.petsInOrder()) {
      const p = this.players.get(id);
      const me = w.entities.find((x) => x.id === id);
      if (!p || !p.alive || !me || me.hp <= 0 || now < pet.nextMs) continue;
      let best: ResolveTarget | undefined;
      let bd = Infinity;
      for (const t of this.enemiesNear(w, id)) {
        const dd = hypot(t.i - me.i, t.j - me.j);
        if (dd < SKILL_EFFECTS.PET_RANGE && dd < bd) {
          bd = dd;
          best = t;
        }
      }
      if (!best) continue; // nothing to strike: the pet waits (no interval is spent)
      pet.nextMs = now + pet.intervalMs;
      w = this.hurtMob(w, best.id, this.fixedHit(w, id, best, pet.coeff), id, events);
    }
    for (const [id, p] of [...this.players.entries()].sort((a, b) => a[0] - b[0])) {
      if (p.shield > 0 && now >= p.shieldUntilMs) {
        p.shield = 0;
        w = this.explodeShield(w, id, events);
      }
    }
    fx.prune(now);
    return w;
  }

  // ------------------------------------------------------------------ internals
  private enemiesNear(world: SimWorld, casterId: number): ResolveTarget[] {
    const mobs = this.opts.mobs;
    if (!mobs) return [];
    const out: ResolveTarget[] = [];
    for (const e of world.entities) {
      if (e.hp <= 0 || this.opts.isInvulnerable?.(e.id)) continue;
      if (this.opts.canTarget && !this.opts.canTarget(casterId, e.id)) continue;
      const s = mobs.combatStats(e.id);
      if (s)
        out.push({
          id: e.id,
          i: e.i,
          j: e.j,
          hpMax: s.hpMax,
          defense: s.defense * this.effects.defMult(e.id, world.timeMs), // `def_shred` debuffs (D116)
          realm: s.realm,
          element: s.element,
        });
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
      aim: c.aim,
      enemies: this.enemiesNear(world, c.casterId),
      rand,
      losClear: (a, b) => lineOfSight(this.ctx.grid, a.i, a.j, b.i, b.j, caster.layer, caster.flying),
      defs: this.defs,
      grouped: this.groupOf(world, c.casterId, true).length > 1,
      mods: this.modsOf(c.casterId, world.timeMs, caster.hp),
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
      pc.lastCombatMs = world.timeMs; // dealing damage is combat
      if (!dead) this.opts.mobs?.onDamage?.(h.targetId, c.casterId, h.damage);
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
    let overShield = 0;
    if (out.heal > 0) {
      const e = world.entities.find((x) => x.id === ally)!;
      const healed = Math.max(0, Math.min(out.heal, sup.hpMax - e.hp));
      patches.set(ally, { ...(patches.get(ally) ?? {}), hp: (patches.get(ally)?.hp ?? e.hp) + healed });
      events.push({ type: 'heal', targetId: ally, amount: healed });
      // `overheal_to_shield`: the part of the heal beyond max HP becomes a shield (PROVISIONAL: capped at the target's max HP)
      overShield = Math.min(sup.hpMax, Math.round((out.heal - healed) * out.overhealRatio));
    }
    const shieldAmount = out.shield + overShield;
    if (shieldAmount > 0) {
      sup.shield = shieldAmount;
      sup.shieldUntilMs = world.timeMs + Math.max(out.shieldDurationMs, overShield > 0 ? out.overhealShieldMs : 0);
      sup.shieldExplode = out.shield > 0 && out.shieldExplode ? { ...out.shieldExplode, srcId: c.casterId } : null;
      events.push({ type: 'shield', targetId: ally, amount: shieldAmount });
    }
    w = patch(w, patches);
    // lifesteal of the damage this cast dealt (class passive + buffs), then every other state effect of the skill
    w = this.lifestealHeal(
      w,
      c.casterId,
      out.hits.reduce((n, h) => n + h.damage, 0),
      events,
    );
    w = this.applyStateEffects(w, c, out, events);
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
    this.effects.clearMob(mobId);
    if (!mobs || !stats) return world;
    const rng = (): number => {
      const [v, n] = rngFloat(this.dropRng);
      this.dropRng = n;
      return v;
    };
    // personal loot (D93, docs/07 §6): every party member who shares the kill rolls on their own with partySize = the group size; without
    // a party the group is just the killer, so the roll and the rng draws are exactly the solo ones
    const group = [...new Set([killerId, ...(this.opts.partyOf?.(killerId) ?? [])])]
      .filter((id) => id === killerId || this.players.has(id))
      .sort((a, b) => a - b);
    for (const id of group) {
      const member = id === killerId ? killer : this.players.get(id)!;
      const ctx: DropContext = {
        source: stats.dropSource,
        monsterRealm: stats.realm,
        realmGap: Math.max(0, member.profile.realm - stats.realm),
        partySize: group.length,
      };
      const rolls = resolveDrops(ctx, rng);
      events.push({ type: 'drops', killerId: id, mobId, rolls });
      this.opts.onDrops?.({ killerId: id, mobId, rolls });
    }
    return mobs.kill(world, mobId);
  }

  private respawnDue(world: SimWorld, events: CombatEvent[]): SimWorld {
    let w = world;
    for (const [id, p] of [...this.players.entries()].sort((a, b) => a[0] - b[0])) {
      if (p.alive || world.timeMs < p.respawnAtMs) continue;
      const e = w.entities.find((x) => x.id === id);
      if (!e) continue;
      p.alive = true;
      this.status.clear(id);
      p.shield = 0;
      p.shieldUntilMs = 0;
      p.shieldExplode = null;
      this.effects.clearPlayer(id);
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
        .map(([id, p]) => [
          id,
          p.alive,
          p.respawnAtMs,
          p.shield,
          p.shieldUntilMs,
          p.lastCombatMs,
          p.hpFrac,
          p.mpFrac,
          p.pillReadyAtMs,
        ]),
      pending: this.pending.map((p) => [p.resolveAtMs, p.casterId, p.seq, p.wireId, p.targetId]),
      drop: this.dropRng,
      status: this.status.digest(),
      effects: this.effects.digest(),
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
