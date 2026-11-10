/**
 * Mob manager (D74): spawn tables per zone, respawn timers, leash and the basic AI, on top of the `@vgtd/sim` world.
 *
 * Mobs ARE sim entities (`world.entities`, ids `MOB_ID_BASE + slot`), so the existing AOI / snapshot path replicates them
 * unchanged; the manager only moves them (with `@vgtd/sim` `stepMove`, same collision as players) and spawns / despawns
 * them. All mutable AI state lives here, in slot order. The module is deterministic: fixed 20 Hz step, one seeded
 * `ai` PRNG stream drawn in a fixed order (spawn: slots ascending; per tick: respawns ascending, then AI ascending),
 * no clocks, ties by id. Nothing here reads `Math.random`, `Date.now` or `performance.now`.
 *
 * Content (D83): each tier lives in a distance band around the centre of the mob area (nothing spawns in the safe
 * zone around it); normal mobs spawn in packs around an anchor point. Threat (D83): `onDamage` (called by the combat step
 * through `MobPort`) adds threat on the attacker; a mob chases the player with the most threat, with a hysteresis ratio.
 * `kill()` is the hook the combat step calls; it despawns the mob and schedules its respawn.
 */
import {
  COLLIDER_RADIUS_TILES,
  MOB_AI,
  MOB_BANDS,
  MOB_PACK_RADIUS,
  MOB_THREAT,
  MOB_ENTITY_KIND,
  MOB_ID_BASE,
  MOB_RESPAWN_MS,
  NETWORK,
  ZONE_SPAWN_TABLES,
  mobDefByKey,
  mobDropSource,
  mobZoneMargin,
  elementWireId,
  mobRealm,
  mobStats,
  rngFloat,
  rngFork,
  rngInt,
  rngSeed,
  type DropSource,
  type ElementId,
  type MobDef,
  type MobZoneId,
  type RngState,
  type ZoneSpawnTable,
  type MobTier,
} from '@vgtd/shared';
import {
  circleBlocked,
  spawnEntity,
  stepMove,
  type CollisionGrid,
  type EntityState,
  type MoveState,
  type SimWorld,
} from '@vgtd/sim';
import { decide, newBrain, type MobBrain, type PlayerRef } from './ai.js';

/** A rectangle of the map (tile coordinates, `i0 <= i < i1`, `j0 <= j < j1`) that a zone's mobs spawn and live in. */
export interface MobZone {
  zone: MobZoneId;
  i0: number;
  j0: number;
  i1: number;
  j1: number;
}

export interface MobManagerOptions {
  seed: number;
  zones: readonly MobZone[];
  grid: CollisionGrid;
  /** spawn tables; defaults to `ZONE_SPAWN_TABLES` */
  tables?: readonly ZoneSpawnTable[];
  /** multiplies every table count (rounded; 0 disables the group). Default 1 */
  density?: number;
  /** centre of the mob area for the tier bands (tiles); default: the centre of the bounding box of `zones` */
  center?: { i: number; j: number };
}

/** What a combat step needs about a LIVING mob (the sim entity only holds the current HP). */
export interface MobCombatStats {
  /** DEF: 07 §1 curve at the mob's level x tier multiplier */
  defense: number;
  /** realm >= 1 */
  realm: number;
  /** element of THIS mob: the main element, or the variant element for the odd packs of a normal mob (docs/10 "Hệ chính / biến thể", D114) */
  element: ElementId | null;
  dropSource: DropSource;
  hpMax: number;
  /** docs/10 tier: bosses ignore control (D116) */
  tier?: MobTier;
}

export interface MobInfo {
  id: number;
  slot: number;
  def: MobDef;
  level: number;
  /** 0 = main element, 1 = variant element (normal mobs with two elements; D114) */
  variant: number;
  /** element of this mob (`def.elements[variant]`) */
  element: ElementId | null;
  maxHp: number;
  zone: MobZoneId;
  home: { i: number; j: number };
  alive: boolean;
  state: MobBrain['state'];
  target: number;
  /** tick at which a dead mob respawns (0 when alive) */
  respawnAtTick: number;
  /** threat on players, highest first (ties: lowest id) */
  threat: { id: number; value: number }[];
}

interface Slot {
  slot: number;
  id: number;
  def: MobDef;
  rect: MobZone;
  level: number;
  /** elemental variant (D114): 0 main, 1 the second element of docs/10 "Hệ chính / biến thể" */
  variant: number;
  maxHp: number;
  defense: number;
  homeI: number;
  homeJ: number;
  alive: boolean;
  brain: MobBrain;
  respawnAtTick: number;
  /** attacker id -> threat (D83); empty for a mob nobody has hurt */
  threat: Map<number, number>;
}

const SPAWN_ATTEMPTS = 20;
const THREAT_ENTRIES = 16;
const TICK_MS = NETWORK.TICK_MS;
const respawnTicks = (ms: number): number => Math.max(1, Math.ceil(ms / TICK_MS));

const byThreat = (a: { id: number; value: number }, b: { id: number; value: number }): number =>
  b.value - a.value || a.id - b.id;

export const isMobId = (id: number): boolean => id >= MOB_ID_BASE;

/** What player skills do to mobs, asked each tick (`CombatSystem.effects` satisfies it, D116): control, slows and taunts. */
export interface MobControl {
  isStunned(id: number, nowMs: number): boolean;
  isRooted(id: number, nowMs: number): boolean;
  /** speed factor 0..1 (1 = no slow) */
  speedFactor(id: number, nowMs: number): number;
  /** the player a mob is forced to attack (taunt), or 0 */
  taunter(id: number, nowMs: number): number;
}

export class MobManager {
  /** set by the node when combat is on: stun / root / slow / taunt from player skills */
  control: MobControl | null = null;
  private readonly slots: Slot[] = [];
  private readonly grid: CollisionGrid;
  private readonly centre: { i: number; j: number };
  /** half-size of the mob area: the distance the tier bands are fractions of */
  private readonly radius: number;
  private rng: RngState;

  constructor(opts: MobManagerOptions) {
    this.grid = opts.grid;
    this.rng = rngFork(rngSeed(opts.seed), 'ai');
    const tables = opts.tables ?? ZONE_SPAWN_TABLES;
    const density = opts.density ?? 1;
    const zones = opts.zones;
    const i0 = Math.min(...zones.map((z) => z.i0));
    const i1 = Math.max(...zones.map((z) => z.i1));
    const j0 = Math.min(...zones.map((z) => z.j0));
    const j1 = Math.max(...zones.map((z) => z.j1));
    this.centre = opts.center ?? { i: (i0 + i1) / 2, j: (j0 + j1) / 2 };
    this.radius = zones.length === 0 ? 1 : Math.max(1, Math.max(i1 - i0, j1 - j0) / 2);
    for (const rect of opts.zones) {
      const table = tables.find((t) => t.zone === rect.zone);
      if (!table) continue;
      for (const g of table.groups) {
        const def = mobDefByKey(g.def);
        if (!def) throw new Error(`unknown mob def ${g.def}`);
        const n = Math.max(0, Math.round(g.count * density));
        const pack = Math.max(1, Math.trunc(g.pack ?? 1));
        let anchor: [number, number] = [0, 0];
        for (let k = 0; k < n; k++) {
          // pack leader: a point in the tier band; the other members within MOB_PACK_RADIUS of it (draw order: see makeSlot)
          if (k % pack === 0) anchor = this.drawPoint(rect, def);
          const home = k % pack === 0 ? anchor : this.drawNear(anchor, rect);
          // variants (D114): the packs of a normal mob alternate between its two elements (docs/10 "8 loại x 2 biến thể"); no RNG is drawn
          const variant = def.tier === 'normal' && def.elements.length > 1 ? Math.floor(k / pack) % 2 : 0;
          this.slots.push(this.makeSlot(this.slots.length, def, rect, home, variant));
        }
      }
    }
  }

  get size(): number {
    return this.slots.length;
  }
  get alive(): number {
    let n = 0;
    for (const s of this.slots) if (s.alive) n++;
    return n;
  }

  // ------------------------------------------------------------------ queries
  info(id: number): MobInfo | undefined {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id) return undefined;
    return {
      id: s.id,
      slot: s.slot,
      def: s.def,
      level: s.level,
      variant: s.variant,
      element: s.def.elements[s.variant] ?? s.def.elements[0] ?? null,
      maxHp: s.maxHp,
      zone: s.rect.zone,
      home: { i: s.homeI, j: s.homeJ },
      alive: s.alive,
      state: s.brain.state,
      target: s.brain.target,
      respawnAtTick: s.alive ? 0 : s.respawnAtTick,
      threat: [...s.threat.entries()].map(([id, value]) => ({ id, value })).sort(byThreat),
    };
  }
  /** Combat attributes of a living mob, undefined for dead mobs and non-mobs (the seam for the combat step, #206). */
  combatStats(id: number): MobCombatStats | undefined {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id || !s.alive) return undefined;
    return {
      defense: s.defense,
      realm: mobRealm(s.level),
      element: s.def.elements[s.variant] ?? s.def.elements[0] ?? null,
      dropSource: mobDropSource(s.def.tier),
      hpMax: s.maxHp,
      tier: s.def.tier,
    };
  }
  /** max HP of a mob entity (no allocation: used per entity per snapshot) */
  maxHpOf(id: number): number | undefined {
    const s = this.slots[id - MOB_ID_BASE];
    return s && s.id === id ? s.maxHp : undefined;
  }
  /** wire `EnterEntity.defId` of a mob entity (0 for anything else) */
  defIdOf(id: number): number {
    const s = this.slots[id - MOB_ID_BASE];
    return s && s.id === id ? s.def.id : 0;
  }
  /** wire `EnterEntity.element` of a mob (D120): its own element (variant, D114) as `elementWireId`, 0 for anything else or an elementless mob */
  elementWireIdOf(id: number): number {
    const s = this.slots[id - MOB_ID_BASE];
    return s && s.id === id ? elementWireId(s.def.elements[s.variant] ?? s.def.elements[0] ?? null) : 0;
  }
  /** wire `EnterEntity.kind` of an entity id: 1 monster, 0 player */
  kindOf(id: number): number {
    return isMobId(id) ? MOB_ENTITY_KIND : 0;
  }
  /** What the mob attack system reads (D86): AI state, chase target, level, def and the mob's own element (variant, D114). No allocation; undefined for dead / unknown mobs. */
  attackView(
    id: number,
  ): { state: MobBrain['state']; target: number; level: number; def: MobDef; element: ElementId | null } | undefined {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id || !s.alive) return undefined;
    return {
      state: s.brain.state,
      target: s.brain.target,
      level: s.level,
      def: s.def,
      element: s.def.elements[s.variant] ?? s.def.elements[0] ?? null,
    };
  }

  // ------------------------------------------------------------------ spawning
  /** Chebyshev distance of a point from the centre of the mob area, in tiles. */
  private fromCentre(i: number, j: number): number {
    return Math.max(Math.abs(i - this.centre.i), Math.abs(j - this.centre.j));
  }

  /**
   * A walkable point inside `rect` and inside the tier's distance band (D83). Up to SPAWN_ATTEMPTS tries (2 floats each);
   * when none lands in the band the last WALKABLE point is used, else the rect centre.
   */
  private drawPoint(rect: MobZone, def: MobDef): [number, number] {
    const band = MOB_BANDS[def.tier];
    const lo = band.minFrac * this.radius;
    const hi = band.maxFrac * this.radius;
    let walkable: [number, number] | null = null;
    for (let a = 0; a < SPAWN_ATTEMPTS; a++) {
      const [fa, r1] = rngFloat(this.rng);
      const [fb, r2] = rngFloat(r1);
      this.rng = r2;
      const i = rect.i0 + fa * (rect.i1 - rect.i0);
      const j = rect.j0 + fb * (rect.j1 - rect.j0);
      if (circleBlocked(this.grid, i, j, COLLIDER_RADIUS_TILES, 0, false)) continue;
      walkable = [i, j];
      const d = this.fromCentre(i, j);
      if (d >= lo && d <= hi) return [i, j];
    }
    return walkable ?? [(rect.i0 + rect.i1) / 2, (rect.j0 + rect.j1) / 2];
  }

  /** A walkable point within MOB_PACK_RADIUS of `anchor` and inside `rect` (up to 10 tries, 2 floats each); else the anchor. */
  private drawNear(anchor: [number, number], rect: MobZone): [number, number] {
    for (let a = 0; a < 10; a++) {
      const [fa, r1] = rngFloat(this.rng);
      const [fb, r2] = rngFloat(r1);
      this.rng = r2;
      const i = anchor[0] + (fa * 2 - 1) * MOB_PACK_RADIUS;
      const j = anchor[1] + (fb * 2 - 1) * MOB_PACK_RADIUS;
      if (i < rect.i0 || i >= rect.i1 || j < rect.j0 || j >= rect.j1) continue;
      if (!circleBlocked(this.grid, i, j, COLLIDER_RADIUS_TILES, 0, false)) return [i, j];
    }
    return anchor;
  }

  private drawLevel(def: MobDef): number {
    const [n, r] = rngInt(this.rng, def.levelMax - def.levelMin + 1);
    this.rng = r;
    return def.levelMin + n;
  }

  private drawBrain(def: MobDef): MobBrain {
    const p = MOB_AI[def.tier];
    const span = p.idleMaxMs - p.idleMinMs;
    let ms = p.idleMinMs;
    if (span > 0) {
      const [n, r] = rngInt(this.rng, span + 1);
      this.rng = r;
      ms += n;
    }
    return { ...newBrain(), timerMs: ms };
  }

  /** RNG order for a spawn: home point (drawn by the caller: pack anchor / pack member), then level (1 int), first idle pause (1 int). */
  private makeSlot(slot: number, def: MobDef, rect: MobZone, home: [number, number], variant: number): Slot {
    const [homeI, homeJ] = home;
    const level = this.drawLevel(def);
    const stats = mobStats(def, level);
    return {
      slot,
      id: MOB_ID_BASE + slot,
      def,
      rect,
      level,
      variant,
      maxHp: stats.hp,
      defense: stats.def,
      homeI,
      homeJ,
      alive: true,
      brain: this.drawBrain(def),
      respawnAtTick: 0,
      threat: new Map(),
    };
  }

  private entityOf(world: SimWorld, s: Slot): EntityState {
    const p = MOB_AI[s.def.tier];
    const empty: SimWorld = { ...world, entities: [] };
    return spawnEntity(empty, { id: s.id, i: s.homeI, j: s.homeJ, hp: s.maxHp, mpMax: 0, mp: 0, agi: p.agi })
      .entities[0]!;
  }

  /** Spawns every alive slot into `world` (call once after construction). */
  populate(world: SimWorld): SimWorld {
    const have = new Set(world.entities.map((e) => e.id));
    const add = this.slots.filter((s) => s.alive && !have.has(s.id)).map((s) => this.entityOf(world, s));
    if (add.length === 0) return world;
    return { ...world, entities: [...world.entities, ...add].sort((a, b) => a.id - b.id) };
  }

  // ------------------------------------------------------------------ combat hooks
  /**
   * `attackerId` hurt mob `id` for `amount`: add that much threat on the attacker (D83). Ignored for dead / unknown mobs,
   * attackers that are mobs, and non-positive amounts. At most THREAT_ENTRIES attackers are tracked per mob (the lowest
   * threat is dropped).
   */
  onDamage(id: number, attackerId: number, amount: number): void {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id || !s.alive || isMobId(attackerId) || !(amount > 0)) return;
    s.threat.set(attackerId, (s.threat.get(attackerId) ?? 0) + amount);
    if (s.threat.size > THREAT_ENTRIES) {
      let lowest = -1;
      let lowV = Infinity;
      for (const [k, v] of s.threat) {
        if (k !== attackerId && (v < lowV || (v === lowV && k > lowest))) {
          lowest = k;
          lowV = v;
        }
      }
      s.threat.delete(lowest);
    }
  }

  /** The mob died (called by the combat step later): despawn it and schedule the respawn. */
  kill(world: SimWorld, id: number): SimWorld {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id || !s.alive) return world;
    s.alive = false;
    s.threat.clear();
    s.brain = newBrain();
    s.respawnAtTick = world.tick + respawnTicks(MOB_RESPAWN_MS[s.def.tier]);
    return { ...world, entities: world.entities.filter((e) => e.id !== id) };
  }

  // ------------------------------------------------------------------ per tick
  /** Advance every mob by one fixed tick. Call after the player step, with the world it returned. */
  step(world: SimWorld): SimWorld {
    if (this.slots.length === 0) return world;
    const tick = world.tick;
    const players: PlayerRef[] = [];
    const index = new Map<number, number>();
    world.entities.forEach((e, k) => {
      index.set(e.id, k);
      if (!isMobId(e.id) && e.connected && e.hp > 0) players.push({ id: e.id, i: e.i, j: e.j });
    });
    const playerById = (id: number): PlayerRef | undefined => {
      const k = index.get(id);
      if (k === undefined) return undefined;
      const e = world.entities[k]!;
      return isMobId(e.id) || !e.connected || e.hp <= 0 ? undefined : { id: e.id, i: e.i, j: e.j };
    };

    let entities: EntityState[] | null = null;
    const spawned: EntityState[] = [];
    for (const s of this.slots) {
      if (!s.alive) {
        if (tick < s.respawnAtTick) continue;
        // respawn: same home, new level, fresh brain (draw order: level, pause)
        s.level = this.drawLevel(s.def);
        const st = mobStats(s.def, s.level);
        s.maxHp = st.hp;
        s.defense = st.def;
        s.brain = this.drawBrain(s.def);
        s.alive = true;
        s.respawnAtTick = 0;
        s.threat.clear();
        spawned.push(this.entityOf(world, s));
        continue;
      }
      const k = index.get(s.id);
      if (k === undefined) continue; // not in the world (e.g. removed externally)
      const e = (entities ?? world.entities)[k]!;
      const p = MOB_AI[s.def.tier];
      const now = world.timeMs;
      // a stunned (or knocked-up) mob does nothing at all this tick
      if (this.control?.isStunned(s.id, now)) continue;
      // taunt: the mob is forced onto the taunting player while it lasts
      const forced = this.control?.taunter(s.id, now) ?? 0;
      if (forced !== 0 && playerById(forced) && s.brain.state !== 'return')
        s.brain = { state: 'chase', timerMs: 0, target: forced, wi: 0, wj: 0 };
      else if (s.threat.size > 0) s.brain = this.applyThreat(s, e, playerById);
      const d = decide(
        { i: e.i, j: e.j, homeI: s.homeI, homeJ: s.homeJ, slot: s.slot },
        s.brain,
        p,
        players,
        playerById,
        tick,
        TICK_MS,
        this.rng,
        s.threat.has(s.brain.target),
      );
      this.rng = d.rng;
      // a chase that ended (lost / leash: chase -> return, or on to idle in the same tick) forgets all threat, so the mob
      // does not turn around again at the leash edge
      if (s.threat.size > 0 && s.brain.state === 'chase' && d.brain.state !== 'chase') s.threat.clear();
      s.brain = d.brain;
      if (d.dir === 255 && e.vi === 0 && e.vj === 0) continue;
      // root: no movement; slow: the movement magnitude is scaled
      const rooted = this.control?.isRooted(s.id, now) ?? false;
      const mag = rooted ? 0 : Math.round(d.mag * (this.control?.speedFactor(s.id, now) ?? 1));
      const m = stepMove(e, { dtMs: TICK_MS, dir: d.dir, mag, flags: 0 }, this.grid);
      if (!entities) entities = world.entities.slice();
      entities[k] = withMove(e, m);
    }
    if (!entities && spawned.length === 0) return world;
    let out = entities ?? world.entities;
    if (spawned.length > 0) out = [...out, ...spawned].sort((a, b) => a.id - b.id);
    return { ...world, entities: out };
  }

  /**
   * Threat bookkeeping for one mob with a non-empty table (D83), no RNG: drop attackers that are gone, decay the ones far
   * away, then point the brain at the highest threat (a returning mob gives up and forgets everything).
   */
  private applyThreat(s: Slot, e: EntityState, playerById: (id: number) => PlayerRef | undefined): MobBrain {
    const b = s.brain;
    if (b.state === 'return') {
      s.threat.clear();
      return b;
    }
    const decay = 1 - MOB_THREAT.decayPerS * (TICK_MS / 1000);
    for (const [id, v] of [...s.threat]) {
      const pl = playerById(id);
      if (!pl) {
        s.threat.delete(id);
        continue;
      }
      if (Math.hypot(pl.i - e.i, pl.j - e.j) > MOB_THREAT.forgetRadius) {
        const nv = v * decay;
        if (nv < MOB_THREAT.minThreat) s.threat.delete(id);
        else s.threat.set(id, nv);
      }
    }
    if (s.threat.size === 0) return b;
    let top = 0;
    let topV = -1;
    for (const [id, v] of s.threat) {
      if (v > topV || (v === topV && id < top)) {
        top = id;
        topV = v;
      }
    }
    if (b.state === 'chase' && (b.target === top || topV <= (s.threat.get(b.target) ?? 0) * MOB_THREAT.switchRatio))
      return b;
    return { state: 'chase', timerMs: 0, target: top, wi: 0, wj: 0 };
  }

  // ------------------------------------------------------------------ tests / diagnostics
  /** Hash of all mob state (AI + slots + PRNG), for same-seed-same-state tests. */
  stateHash(): string {
    let h1 = 0x811c9dc5;
    let h2 = 0x01000193 ^ 0xdeadbeef;
    const buf = new DataView(new ArrayBuffer(8));
    const num = (x: number): void => {
      buf.setFloat64(0, x, true);
      for (let k = 0; k < 8; k++) {
        const b = buf.getUint8(k);
        h1 = Math.imul(h1 ^ b, 0x01000193) >>> 0;
        h2 = Math.imul(h2 ^ (b + 0x9e), 0x85ebca6b) >>> 0;
      }
    };
    for (const w of this.rng) num(w);
    for (const s of this.slots) {
      num(s.id);
      num(s.level);
      num(s.homeI);
      num(s.homeJ);
      num(s.alive ? 1 : 0);
      num(s.respawnAtTick);
      num(['idle', 'wander', 'chase', 'return'].indexOf(s.brain.state));
      num(s.brain.timerMs);
      num(s.brain.target);
      num(s.brain.wi);
      num(s.brain.wj);
      for (const t of [...s.threat.entries()].sort((a, b) => a[0] - b[0])) {
        num(t[0]);
        num(t[1]);
      }
    }
    return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
  }
}

function withMove(e: EntityState, m: MoveState): EntityState {
  return {
    ...e,
    i: m.i,
    j: m.j,
    vi: m.vi,
    vj: m.vj,
    layer: m.layer,
    flying: m.flying,
    qinggong: m.qinggong,
    facing: m.facing,
    agi: m.agi,
    dashLeftMs: m.dashLeftMs,
    dashCdMs: m.dashCdMs,
    invulnMs: m.invulnMs,
  };
}

/**
 * Default zone layout for the open test map (`n` x `n` tiles): the four zones of docs/10 §4 as the corners' inner squares
 * around the map centre, so mobs live near where the players spawn. A real map supplies its own rectangles.
 */
export function defaultMobZones(n: number): MobZone[] {
  const h = n / 2;
  const m = mobZoneMargin(n);
  return [
    { zone: 'bia_rung', i0: m, j0: m, i1: h - m, j1: h - m },
    { zone: 'dam_lay_doc', i0: h + m, j0: m, i1: n - m, j1: h - m },
    { zone: 'co_thu_trung_tam', i0: m, j0: h + m, i1: h - m, j1: n - m },
    { zone: 'doc_hoa_dam', i0: h + m, j0: h + m, i1: n - m, j1: n - m },
  ];
}
