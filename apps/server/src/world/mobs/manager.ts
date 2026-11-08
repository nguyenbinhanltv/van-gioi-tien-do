/**
 * Mob manager (D74): spawn tables per zone, respawn timers, leash and the basic AI, on top of the `@vgtd/sim` world.
 *
 * Mobs ARE sim entities (`world.entities`, ids `MOB_ID_BASE + slot`), so the existing AOI / snapshot path replicates them
 * unchanged; the manager only moves them (with `@vgtd/sim` `stepMove`, same collision as players) and spawns / despawns
 * them. All mutable AI state lives here, in slot order. The module is deterministic: fixed 20 Hz step, one seeded
 * `ai` PRNG stream drawn in a fixed order (spawn: slots ascending; per tick: respawns ascending, then AI ascending),
 * no clocks, ties by id. Nothing here reads `Math.random`, `Date.now` or `performance.now`.
 *
 * No combat yet: mobs never take or deal damage. `kill()` is the hook the combat step will call; it despawns the mob
 * and schedules its respawn.
 */
import {
  COLLIDER_RADIUS_TILES,
  MOB_AI,
  MOB_ENTITY_KIND,
  MOB_ID_BASE,
  MOB_RESPAWN_MS,
  NETWORK,
  ZONE_SPAWN_TABLES,
  mobDefByKey,
  mobDropSource,
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
}

/** What a combat step needs about a LIVING mob (the sim entity only holds the current HP). */
export interface MobCombatStats {
  /** DEF: 07 §1 curve at the mob's level x tier multiplier */
  defense: number;
  /** realm >= 1 */
  realm: number;
  /** main element (docs/10 "Hệ chính") */
  element: ElementId | null;
  dropSource: DropSource;
  hpMax: number;
}

export interface MobInfo {
  id: number;
  slot: number;
  def: MobDef;
  level: number;
  maxHp: number;
  zone: MobZoneId;
  home: { i: number; j: number };
  alive: boolean;
  state: MobBrain['state'];
  target: number;
  /** tick at which a dead mob respawns (0 when alive) */
  respawnAtTick: number;
}

interface Slot {
  slot: number;
  id: number;
  def: MobDef;
  rect: MobZone;
  level: number;
  maxHp: number;
  defense: number;
  homeI: number;
  homeJ: number;
  alive: boolean;
  brain: MobBrain;
  respawnAtTick: number;
}

const SPAWN_ATTEMPTS = 20;
const TICK_MS = NETWORK.TICK_MS;
const respawnTicks = (ms: number): number => Math.max(1, Math.ceil(ms / TICK_MS));

export const isMobId = (id: number): boolean => id >= MOB_ID_BASE;

export class MobManager {
  private readonly slots: Slot[] = [];
  private readonly grid: CollisionGrid;
  private rng: RngState;

  constructor(opts: MobManagerOptions) {
    this.grid = opts.grid;
    this.rng = rngFork(rngSeed(opts.seed), 'ai');
    const tables = opts.tables ?? ZONE_SPAWN_TABLES;
    const density = opts.density ?? 1;
    for (const rect of opts.zones) {
      const table = tables.find((t) => t.zone === rect.zone);
      if (!table) continue;
      for (const g of table.groups) {
        const def = mobDefByKey(g.def);
        if (!def) throw new Error(`unknown mob def ${g.def}`);
        const n = Math.max(0, Math.round(g.count * density));
        for (let k = 0; k < n; k++) this.slots.push(this.makeSlot(this.slots.length, def, rect));
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
      maxHp: s.maxHp,
      zone: s.rect.zone,
      home: { i: s.homeI, j: s.homeJ },
      alive: s.alive,
      state: s.brain.state,
      target: s.brain.target,
      respawnAtTick: s.alive ? 0 : s.respawnAtTick,
    };
  }
  /** Combat attributes of a living mob, undefined for dead mobs and non-mobs (the seam for the combat step, #206). */
  combatStats(id: number): MobCombatStats | undefined {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id || !s.alive) return undefined;
    return {
      defense: s.defense,
      realm: mobRealm(s.level),
      element: s.def.elements[0] ?? null,
      dropSource: mobDropSource(s.def.tier),
      hpMax: s.maxHp,
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
  /** wire `EnterEntity.kind` of an entity id: 1 monster, 0 player */
  kindOf(id: number): number {
    return isMobId(id) ? MOB_ENTITY_KIND : 0;
  }

  // ------------------------------------------------------------------ spawning
  private drawPoint(rect: MobZone): [number, number] {
    for (let a = 0; a < SPAWN_ATTEMPTS; a++) {
      const [fa, r1] = rngFloat(this.rng);
      const [fb, r2] = rngFloat(r1);
      this.rng = r2;
      const i = rect.i0 + fa * (rect.i1 - rect.i0);
      const j = rect.j0 + fb * (rect.j1 - rect.j0);
      if (!circleBlocked(this.grid, i, j, COLLIDER_RADIUS_TILES, 0, false)) return [i, j];
    }
    return [(rect.i0 + rect.i1) / 2, (rect.j0 + rect.j1) / 2]; // fixed fallback: the rect centre
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

  /** RNG order for a (re)spawn: point (2 floats per attempt), level (1 int), first idle pause (1 int). */
  private makeSlot(slot: number, def: MobDef, rect: MobZone): Slot {
    const [homeI, homeJ] = this.drawPoint(rect);
    const level = this.drawLevel(def);
    const stats = mobStats(def, level);
    return {
      slot,
      id: MOB_ID_BASE + slot,
      def,
      rect,
      level,
      maxHp: stats.hp,
      defense: stats.def,
      homeI,
      homeJ,
      alive: true,
      brain: this.drawBrain(def),
      respawnAtTick: 0,
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

  // ------------------------------------------------------------------ combat hook
  /** The mob died (called by the combat step later): despawn it and schedule the respawn. */
  kill(world: SimWorld, id: number): SimWorld {
    const s = this.slots[id - MOB_ID_BASE];
    if (!s || s.id !== id || !s.alive) return world;
    s.alive = false;
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
        spawned.push(this.entityOf(world, s));
        continue;
      }
      const k = index.get(s.id);
      if (k === undefined) continue; // not in the world (e.g. removed externally)
      const e = (entities ?? world.entities)[k]!;
      const p = MOB_AI[s.def.tier];
      const d = decide(
        { i: e.i, j: e.j, homeI: s.homeI, homeJ: s.homeJ, slot: s.slot },
        s.brain,
        p,
        players,
        playerById,
        tick,
        TICK_MS,
        this.rng,
      );
      this.rng = d.rng;
      s.brain = d.brain;
      if (d.dir === 255 && e.vi === 0 && e.vj === 0) continue;
      const m = stepMove(e, { dtMs: TICK_MS, dir: d.dir, mag: d.mag, flags: 0 }, this.grid);
      if (!entities) entities = world.entities.slice();
      entities[k] = withMove(e, m);
    }
    if (!entities && spawned.length === 0) return world;
    let out = entities ?? world.entities;
    if (spawned.length > 0) out = [...out, ...spawned].sort((a, b) => a.id - b.id);
    return { ...world, entities: out };
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
  const m = Math.max(8, Math.floor(n / 32));
  return [
    { zone: 'bia_rung', i0: m, j0: m, i1: h - m, j1: h - m },
    { zone: 'dam_lay_doc', i0: h + m, j0: m, i1: n - m, j1: h - m },
    { zone: 'co_thu_trung_tam', i0: m, j0: h + m, i1: h - m, j1: n - m },
    { zone: 'doc_hoa_dam', i0: h + m, j0: h + m, i1: n - m, j1: n - m },
  ];
}
