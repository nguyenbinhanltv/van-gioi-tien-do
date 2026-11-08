/**
 * World Node skeleton (docs/08 §2, §4, §8): owns one `@vgtd/sim` world, steps it at a fixed 20 Hz, turns client
 * packets into sim inputs (never positions), runs the AOI at 10 Hz and sends per-client snapshots with distance bands.
 *
 * Clocks (`hrtime`, `setTimeout`) are used ONLY to schedule ticks and measure them; the simulation itself always
 * advances by the fixed `NETWORK.TICK_MS` (skill vgtd-sim-determinism).
 */
import {
  AOI,
  DEFAULT_CLASS,
  MOB_ID_BASE,
  NETWORK,
  aoiCentre,
  classWireId,
  inAoiAt,
  uwDistSq,
  rngFloat,
  rngFork,
  rngSeed,
  toUW,
  type PathId,
  type RngState,
} from '@vgtd/shared';
import {
  ErrorCode,
  ProtocolError,
  decode,
  encode,
  dequantizePos,
  quantizePos,
  type SelfVitals,
  selfStateOf,
  snapshotEntityOf,
  type EnterEntity,
  type Message,
  type SnapshotEntity,
} from '@vgtd/protocol';
import {
  ANTICHEAT,
  type AntiCheatState,
  CastReason,
  TileGrid,
  budgetMs,
  compileSkills,
  createWorld,
  removeEntity,
  seqNewer,
  spawnEntity,
  step,
  type EntityState,
  type SimContext,
  type SimEvent,
  type SimInput,
  type SimWorld,
} from '@vgtd/sim';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import { GATEWAY_CONFIG, WORLD_CONFIG } from '../config.js';
import type { Outbound, ProgressionService } from '../progression/service.js';
import {
  CombatSystem,
  MobAttackSystem,
  type AimedInput,
  type CombatOptions,
  type CombatResult,
} from './combat/index.js';
import { MobManager, defaultMobZones, type MobZone } from './mobs/index.js';
import { DropSink, InventorySync, itemUseFor, type InventoryService } from './inventory/index.js';

/** No entity id left for a new player (D74: with mobs enabled, player ids stay below `MOB_ID_BASE`). */
export class WorldFullError extends Error {
  constructor(message = 'no free player entity id') {
    super(message);
    this.name = 'WorldFullError';
  }
}

export interface ClientTransport {
  send(data: Uint8Array): void;
  /** send an error packet (done by the node) then close the connection */
  close(code: ErrorCode, text: string): void;
  /** bytes queued but not yet flushed to the socket */
  buffered(): number;
}

export interface ClientStats {
  bytesOut: number;
  /** bytes including a WebSocket frame header estimate (2/4/10 B) */
  wireBytesOut: number;
  framesOut: number;
  bytesIn: number;
  packetsIn: number;
  snapshots: number;
  snapshotsSkipped: number;
  aoiEnter: number;
  aoiLeave: number;
  /** visible-entity count sampled at every AOI update */
  visibleSum: number;
  visibleSamples: number;
  visibleMax: number;
  badMessages: number;
}

interface Visible {
  index: number;
  /** 0 near (20 Hz), 1 mid (10 Hz), 2 far (5 Hz) */
  band: 0 | 1 | 2;
}

interface Last {
  qi: number;
  qj: number;
  hp: number;
  anim: number;
  dir: number;
}

/** Stands in for the transport of a player whose connection dropped and whose entity is being held: everything is discarded. */
const DETACHED: ClientTransport = { send: () => undefined, close: () => undefined, buffered: () => 0 };

/**
 * The sim's own sliding rule (docs/08 section 6), applied at the moment of a resume: when the time budget leads the claimed time by
 * more than `SLIDE_LAG_MS`, pull it back to `claimed + SLIDE_LAG_MS`. The time spent disconnected therefore cannot be banked as a
 * burst of fast movement, while claimed time, ratio windows, hot windows and the suspicion score carry over untouched.
 */
function slideBudget(ac: AntiCheatState, nowMs: number): AntiCheatState {
  const lag = budgetMs(ac, nowMs) - ac.claimedMs;
  if (lag <= ANTICHEAT.SLIDE_LAG_MS) return ac;
  return { ...ac, t0Ms: ac.t0Ms + (lag - ANTICHEAT.SLIDE_LAG_MS) / ANTICHEAT.BUDGET_RATE, lastSlideMs: nowMs };
}

function newResumeToken(): string {
  return randomBytes(16).toString('hex');
}
function sameToken(a: string, b: unknown): boolean {
  if (typeof b !== 'string' || b.length !== a.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface Client {
  id: number;
  accountId: string;
  /** class of the character (D82); sent as `EnterEntity.defId` of this player and echoed in `hello_ack` */
  classPath: PathId;
  transport: ClientTransport;
  /** single-use secret that lets this player's NEXT connection resume the session; rotated on every (re)connect */
  resumeToken: string;
  /** what the gateway authenticated this session with (opaque here): re-validated on a resume, which presents no access token */
  authStamp: unknown;
  /** sim time the connection dropped while the entity is held for a resume; null = connected */
  suspendedAtMs: number | null;
  inbox: AimedInput[];
  /** own vitals last sent to this client: they are re-sent only when they change (or on a full / resync snapshot) */
  lastVitals: SelfVitals | null;
  lastRecvSeq: number | null;
  visible: Map<number, Visible>;
  /** slot -> entity id (0 = free) */
  slots: number[];
  /** slot -> last position/hp sent (delta baseline; the WebSocket delivers in order, so previous-sent is the baseline) */
  last: (Last | undefined)[];
  snapSeq: number;
  lastAckMs: number;
  /** server time of the last full resync (first snapshot or ack timeout); rate-limits the resync to one per ACK_TIMEOUT_MS */
  lastResyncMs: number;
  pktWindowStartMs: number;
  pktCount: number;
  joinedTick: number;
  /** tick-loop drift (ms) when this client joined: its lag credit is the drift that accumulated SINCE then */
  driftAtJoinMs: number;
  /** lag credit so far (ms): non-decreasing, handed to `step` as `StepOptions.lagMs` */
  lagCreditMs: number;
  dead: boolean;
  stats: ClientStats;
}

export interface WorldMetrics {
  ticks: number;
  violations: Record<string, number>;
  warns: number;
  flags: number;
  disconnects: number;
  castOk: number;
  castRejected: number;
  castDropped: number;
  kicksBadMessages: number;
  kicksRate: number;
  kicksBackpressure: number;
  /** `inv_state` sends that threw (state or encode); the world tick carried on */
  inventorySendErrors: number;
}

export interface WorldNodeOptions {
  seed?: number;
  /** tiles per side of the open test map */
  mapTiles?: number;
  grid?: TileGrid;
  skills?: SimContext['skills'];
  /** square spawn region (tile coords); defaults to the map centre, 96 tiles wide */
  spawn?: { i0: number; j0: number; side: number };
  maxVisible?: number;
  /** tu vi / breakthrough module (D76); absent = progression messages are rejected as unexpected */
  progression?: ProgressionService;
  /** Enable server-authoritative combat (D75). Omitted = the node only validates casts and answers `skill_result` with no hits. */
  combat?: CombatOptions;
  /** sim time a released player id waits before it can be reused (default `WORLD_CONFIG.PLAYER_ID_QUARANTINE_MS`) */
  playerIdQuarantineMs?: number;
  /** how long (sim ms) a dropped player's entity is held for a resume; 0 disables resume (default `WORLD_CONFIG.RESUME_HOLD_MS`) */
  resumeHoldMs?: number;
  /** clock (ms) for the per-client packet-rate window; default real time. Tests and benchmarks that tick faster than real time drive it themselves. */
  packetClock?: () => number;
  /**
   * Real-time clock (ms, monotonic) used ONLY to measure how far the tick loop runs behind real time (`lagCreditMs`); default real time.
   * Tests and benchmarks that tick faster than, or independently of, real time inject their own.
   */
  wallClock?: () => number;
  /** spawn monsters (D74): `true` = default zones and density 1; omit / false = a world without mobs */
  mobs?: boolean | { zones?: readonly MobZone[]; density?: number };
  /** inventory + drop sink (D77): loads an account's inventory on join and saves it on leave; omit = no inventory */
  inventory?: InventoryService;
}

const BAND_PERIOD = [1, 2, 4] as const;
const clock = (): number => Number(process.hrtime.bigint()) / 1e6;

/** Append and keep at most `cap` samples (oldest dropped in chunks, so removal is amortised O(1)). */
export function pushCapped(arr: number[], v: number, cap: number): void {
  arr.push(v);
  if (arr.length > cap) arr.splice(0, arr.length - cap + Math.max(1, Math.floor(cap / 10)));
}

function frameHeader(len: number): number {
  return len < 126 ? 2 : len < 65536 ? 4 : 10;
}

function emptyStats(): ClientStats {
  return {
    bytesOut: 0,
    wireBytesOut: 0,
    framesOut: 0,
    bytesIn: 0,
    packetsIn: 0,
    snapshots: 0,
    snapshotsSkipped: 0,
    aoiEnter: 0,
    aoiLeave: 0,
    visibleSum: 0,
    visibleSamples: 0,
    visibleMax: 0,
    badMessages: 0,
  };
}

/** Spatial hash key for an AOI cell (u = i − j, w = i + j in 16-tile cells). */
function cellKey(cu: number, cw: number): number {
  return (cu + 1024) * 4096 + (cw + 1024);
}

function sameVitals(a: SelfVitals | null, b: SelfVitals): boolean {
  return !!a && a.hp === b.hp && a.hpMax === b.hpMax && a.mp === b.mp && a.mpMax === b.mpMax && a.shield === b.shield;
}

export class WorldNode {
  world: SimWorld;
  readonly ctx: SimContext;
  readonly clients = new Map<number, Client>();
  readonly metrics: WorldMetrics = {
    ticks: 0,
    violations: {},
    warns: 0,
    flags: 0,
    disconnects: 0,
    castOk: 0,
    castRejected: 0,
    castDropped: 0,
    kicksBadMessages: 0,
    kicksRate: 0,
    kicksBackpressure: 0,
    inventorySendErrors: 0,
  };
  /** duration (ms) of each tick: sim step + AOI + encode + socket writes */
  readonly tickMs: number[] = [];
  /** time between consecutive tick starts (ms), scheduler jitter */
  readonly tickIntervalMs: number[] = [];
  /** cumulative ms per tick phase (sim step / AOI / snapshot encode+send) and the slowest single sample of each */
  readonly phases = { stepMs: 0, aoiMs: 0, snapMs: 0, aoiTicks: 0, maxStepMs: 0, maxAoiMs: 0, maxSnapMs: 0 };
  private nextId = 1;
  /** released player ids, oldest first, with the sim time from which each may be reused */
  private readonly freeIds: { id: number; reusableAtMs: number }[] = [];
  private readonly idQuarantineMs: number;
  /** sim ms a dropped player's entity is held (0 = no resume) */
  readonly resumeHoldMs: number;
  private readonly packetClock: () => number;
  private readonly wallClock: () => number;
  /**
   * wall time that corresponds to sim time 0, fixed at the FIRST tick (time before ticking started is not overload): drift = (wall) - (wall0)
   * - (sim time), which grows when the tick loop runs behind real time. NaN until the first tick.
   */
  private wall0 = Number.NaN;
  /** drift at the start of the current tick, shared by every client's credit this tick */
  private tickDriftMs = 0;
  private spawnRng: RngState;
  private readonly spawn: { i0: number; j0: number; side: number };
  private readonly maxVisible: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTickStart = 0;
  private byId = new Map<number, EntityState>();
  /** per-tick cache of what a snapshot says about each entity (see `currentOf`) */
  private readonly snapCache = new Map<number, { qi: number; qj: number; anim: number; dir: number; hp: number }>();
  readonly progression: ProgressionService | undefined;
  /** Combat core (cast resolution, HP, death / respawn, drops); null when the node was built without `opts.combat`. */
  readonly combat: CombatSystem | null;
  /** Mobs in chase hurt their target (D86); null without mobs + combat or with `combat.mobAttacks: false`. */
  readonly mobAttacks: MobAttackSystem | null;
  /** monster spawns / AI (D74); null when the node runs without mobs */
  readonly mobs: MobManager | null;
  /** inventory + drop sink (D77); null when the node runs without one */
  readonly inventory: InventoryService | null;
  /** combat `onDrops` -> `inventory.grantDrops` (needs both `combat` and `inventory`); null otherwise */
  readonly dropSink: DropSink | null;
  /** the visible bag (D79): `inv_state` out, `inv_cmd` in; null without an inventory */
  readonly invSync: InventorySync | null;

  constructor(opts: WorldNodeOptions = {}) {
    const seed = opts.seed ?? 1;
    const n = opts.mapTiles ?? WORLD_CONFIG.DEFAULT_MAP_TILES;
    const grid = opts.grid ?? TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n)));
    this.ctx = { grid, skills: opts.skills ?? compileSkills() };
    this.world = createWorld(seed);
    this.spawnRng = rngFork(rngSeed(seed), 'spawn');
    // default spawn: a 96-tile square at the map centre, shrunk to half the map on small maps (same result for 256)
    const side = Math.min(96, n / 2);
    this.spawn = opts.spawn ?? { i0: (n - side) / 2, j0: (n - side) / 2, side };
    this.maxVisible = opts.maxVisible ?? WORLD_CONFIG.MAX_VISIBLE;
    this.progression = opts.progression;
    this.progression?.attach({
      isAlive: (id) => (this.byId.get(id)?.hp ?? 1) > 0,
      tickOf: () => this.world.tick,
      // a character's realm / sub-stage (profile loaded, breakthrough done) re-derives its combat stats; `combat` exists by then
      // (the callback only runs after construction), and an id that already left is a no-op in `setRealm`
      onStageChange: (id, realm, subRealm) => {
        if (this.combat) this.world = this.combat.setRealm(this.world, id, realm, subRealm);
      },
      onPersistFailure: (id) => {
        const c = this.clients.get(id);
        if (c) this.kick(c, ErrorCode.Internal, 'progression storage error');
      },
    });
    this.idQuarantineMs = opts.playerIdQuarantineMs ?? WORLD_CONFIG.PLAYER_ID_QUARANTINE_MS;
    this.resumeHoldMs = opts.resumeHoldMs ?? WORLD_CONFIG.RESUME_HOLD_MS;
    this.packetClock = opts.packetClock ?? clock;
    this.wallClock = opts.wallClock ?? clock;
    this.inventory = opts.inventory ?? null;
    this.invSync = this.inventory ? new InventorySync(this.inventory) : null;
    this.inventory?.subscribe((owner) => this.invSync?.markDirty(owner));
    const mo = opts.mobs;
    if (mo) {
      const o = mo === true ? {} : mo;
      this.mobs = new MobManager({ seed, grid, zones: o.zones ?? defaultMobZones(n), density: o.density });
      this.world = this.mobs.populate(this.world);
    } else this.mobs = null;
    // the mob manager is the combat core's default `MobPort` (combatStats + kill); `opts.combat.mobs` overrides it
    const mobPort = opts.combat?.mobs ?? this.mobs ?? undefined;
    // kills fill the killer's bag: combat's `onDrops` feeds the inventory (the caller's own `onDrops` still runs)
    this.dropSink =
      opts.combat && this.inventory
        ? new DropSink({
            inventory: this.inventory,
            ownerOf: (entityId) => this.clients.get(entityId)?.accountId,
            tick: () => this.world.tick,
            mobs: mobPort,
          })
        : null;
    const sink = this.dropSink;
    this.combat = opts.combat
      ? new CombatSystem(this.ctx, {
          seed,
          respawnPoint: () => this.spawnPoint(),
          isMeditating: (id) => this.progression?.isMeditating(id) ?? false,
          ...opts.combat,
          mobs: mobPort,
          onDrops: sink
            ? (e) => {
                sink.handle(e);
                opts.combat?.onDrops?.(e);
              }
            : opts.combat.onDrops,
        })
      : null;
    this.mobAttacks =
      this.combat && this.mobs && opts.combat?.mobAttacks !== false
        ? new MobAttackSystem(this.ctx, this.combat, this.mobs, seed)
        : null;
  }

  // ------------------------------------------------------------------ players
  /**
   * Player ids: a released id is reused once it has been quarantined for `idQuarantineMs` of sim time (so a stale client
   * index / entity id is never confused with a new player); otherwise a fresh id is taken. With mobs on, ids stay below
   * `MOB_ID_BASE` (mob entity ids start there: a player id there would collide with mob slot 0), so the number of
   * usable ids is tied to concurrent players, not to the total number of joins.
   */
  private idLimit(): number {
    return this.mobs ? MOB_ID_BASE : 0xffffffff;
  }
  /** Is there an id for one more player right now? (the gateway checks this BEFORE it replaces an older connection) */
  canAcceptPlayer(): boolean {
    const head = this.freeIds[0];
    return (head !== undefined && head.reusableAtMs <= this.world.timeMs) || this.nextId < this.idLimit();
  }
  private allocateId(): number {
    const head = this.freeIds[0];
    if (head !== undefined && head.reusableAtMs <= this.world.timeMs) {
      this.freeIds.shift();
      return head.id;
    }
    if (this.nextId >= this.idLimit()) throw new WorldFullError();
    return this.nextId++;
  }

  /** `classPath`: the character's class (D82), resolved by the gateway from the stored character (`ProgressionService.resolveClass`). */
  addPlayer(transport: ClientTransport, accountId: string, classPath: PathId = DEFAULT_CLASS): number {
    const id = this.allocateId();
    const at = this.spawnPoint();
    const stats = this.combat?.addPlayer(id, classPath);
    this.world = spawnEntity(this.world, {
      id,
      i: at.i,
      j: at.j,
      hp: stats?.hpMax ?? WORLD_CONFIG.PLAYER_MAX_HP,
      mpMax: stats?.mpMax ?? WORLD_CONFIG.PLAYER_MAX_MP,
    });
    this.inventory?.onJoin(accountId);
    this.invSync?.markDirty(accountId); // the joining client gets its first inv_state this tick
    this.clients.set(id, {
      id,
      accountId,
      classPath,
      transport,
      resumeToken: newResumeToken(),
      authStamp: undefined,
      suspendedAtMs: null,
      inbox: [],
      lastVitals: null,
      lastRecvSeq: null,
      visible: new Map(),
      slots: new Array<number>(this.maxVisible).fill(0),
      last: new Array<Last | undefined>(this.maxVisible).fill(undefined),
      snapSeq: 0,
      lastAckMs: this.world.timeMs,
      lastResyncMs: -Infinity,
      pktWindowStartMs: this.packetClock(),
      pktCount: 0,
      joinedTick: this.world.tick,
      driftAtJoinMs: this.driftNow(), // the drift at the real join time: a client never earns credit for overload that predates it
      lagCreditMs: 0,
      dead: false,
      stats: emptyStats(),
    });
    this.progression?.join(id, accountId, this.world.timeMs);
    return id;
  }

  /** Class wire id (1..6) of a player entity, 0 for anything that is not a connected player. */
  classWireIdOf(entityId: number): number {
    const c = this.clients.get(entityId);
    return c ? classWireId(c.classPath) : 0;
  }
  classPathOf(entityId: number): PathId | undefined {
    return this.clients.get(entityId)?.classPath;
  }

  /** A random point of the spawn region (join and respawn), drawn from the seeded `spawn` stream. */
  private spawnPoint(): { i: number; j: number } {
    const [a, r1] = rngFloat(this.spawnRng);
    const [b, r2] = rngFloat(r1);
    this.spawnRng = r2;
    return { i: this.spawn.i0 + a * this.spawn.side, j: this.spawn.j0 + b * this.spawn.side };
  }

  /**
   * Remove a player. `from` (the connection's transport) makes the call connection-bound: a stale socket that still holds an
   * id which has since been recycled to someone else is ignored instead of removing the new owner. Internal callers (kick)
   * omit it.
   */
  removePlayer(id: number, from?: ClientTransport): void {
    const c = this.clients.get(id);
    if (!c || (from !== undefined && c.transport !== from)) return;
    this.clients.delete(id);
    this.inventory?.onLeave(c.accountId);
    if (this.inventory && !this.inventory.isOnline(c.accountId)) this.invSync?.forget(c.accountId);
    void this.progression?.leave(id);
    this.combat?.removePlayer(id);
    this.world = removeEntity(this.world, id);
    this.freeIds.push({ id, reusableAtMs: this.world.timeMs + this.idQuarantineMs });
  }

  /** The account that owns a player entity (the gateway needs it after a resume, which presents no access token). */
  accountOf(id: number): string | undefined {
    return this.clients.get(id)?.accountId;
  }

  /** Record what this session was authenticated with (the gateway calls it right after `addPlayer`); see `resumePlayer`. */
  stampSession(id: number, stamp: unknown): void {
    const c = this.clients.get(id);
    if (c) c.authStamp = stamp;
  }

  /** How far the tick loop is behind real time (ms; negative when ticks are driven faster than real time, as tests and benchmarks do). */
  private driftNow(): number {
    if (Number.isNaN(this.wall0)) return 0; // ticking has not started: time before the first tick is not overload
    return this.wallClock() - this.wall0 - this.world.timeMs;
  }

  /**
   * Server-overload credit of a client (ms): real time that passed without sim time passing since it joined, i.e. how far behind real
   * time this node's tick loop has been while the client was here. Honest clients are paced by the wall clock, the anti-cheat by sim
   * time, so an overloaded server would otherwise kick everybody (queue overflow, claimed-time budget, claimed/real ratio). Never
   * negative, never decreases (the guards' clock must not run backwards), capped by `ANTICHEAT.MAX_LAG_CREDIT_MS` inside `step`.
   */
  lagCreditOf(id: number): number {
    const c = this.clients.get(id);
    if (!c) return 0;
    const d = this.tickDriftMs - c.driftAtJoinMs - WORLD_CONFIG.LAG_CREDIT_TOLERANCE_MS;
    if (d > c.lagCreditMs) c.lagCreditMs = d;
    return Math.min(c.lagCreditMs, ANTICHEAT.MAX_LAG_CREDIT_MS);
  }

  /** The secret the gateway hands the client in `hello_ack` so its next connection can resume this session. */
  resumeTokenOf(id: number): string | undefined {
    return this.clients.get(id)?.resumeToken;
  }

  /**
   * The connection of `id` dropped: keep the entity (same id, standing still, still a target for mobs) for `resumeHoldMs` of sim
   * time instead of removing it. Combat / progression registrations stay untouched until the hold ends (`removePlayer` then
   * releases everything and quarantines the id). Returns false when nothing was held (resume disabled, stale `from`): the caller
   * then removes the player as before.
   */
  suspendPlayer(id: number, from: ClientTransport): boolean {
    const c = this.clients.get(id);
    if (this.resumeHoldMs <= 0 || !c || c.dead || c.suspendedAtMs !== null || c.transport !== from) return false;
    c.transport = DETACHED;
    c.suspendedAtMs = this.world.timeMs;
    c.inbox.length = 0;
    this.world = {
      ...this.world,
      entities: this.world.entities.map((e) => (e.id === id ? { ...e, pending: [], vi: 0, vj: 0 } : e)),
    };
    return true;
  }

  /**
   * Re-attach a new connection to a held (or, for a half-open zombie socket, still attached) player when `token` matches.
   * Same entity, same combat / progression registration (NOT re-added: that would reset profile, shield and alive state).
   * The client is treated as brand new for the wire (empty AOI -> full snapshot + `aoi_enter`s, vitals re-sent, input numbering
   * restarts). The anti-cheat accounting is NOT reset (claimed time, ratio windows, hot windows and the suspicion score carry over,
   * so dropping and resuming never launders a cheater's record); only the sim's sliding rule is applied once (`slideBudget`), so
   * that idle time cannot be banked as a burst of fast movement either.
   *
   * `valid(accountId, authStamp)` re-checks the session the token belongs to (account still exists, token_version unchanged,
   * session not revoked): a resume must not outlive a revocation. A token that matches but whose session is no longer valid
   * releases the held entity for good. Returns the rotated token, or null when rejected.
   */
  resumePlayer(
    id: number,
    token: unknown,
    transport: ClientTransport,
    valid?: (accountId: string, authStamp: unknown) => boolean,
  ): { token: string } | null {
    const c = this.clients.get(id);
    if (!c || c.dead || !sameToken(c.resumeToken, token)) return null;
    if (valid && !valid(c.accountId, c.authStamp)) {
      if (c.suspendedAtMs === null) c.transport.close(ErrorCode.Unauthorized, 'session revoked');
      this.removePlayer(id);
      return null;
    }
    if (c.suspendedAtMs === null) c.transport.close(ErrorCode.Kicked, 'resumed elsewhere'); // the old socket is dead weight
    const now = this.world.timeMs;
    c.transport = transport;
    c.suspendedAtMs = null;
    c.resumeToken = newResumeToken();
    c.inbox.length = 0;
    c.lastRecvSeq = null;
    c.lastVitals = null;
    c.visible = new Map();
    c.slots.fill(0);
    c.last.fill(undefined);
    c.snapSeq = 0;
    c.lastAckMs = now;
    c.lastResyncMs = -Infinity;
    this.world = {
      ...this.world,
      entities: this.world.entities.map((e) =>
        e.id === id
          ? {
              ...e,
              lastSeq: 0,
              pending: [],
              vi: 0,
              vj: 0,
              // on the clock `step()` judges the guards by (sim time + this client's lag credit), not on bare sim time
              ac: slideBudget(e.ac, now + this.lagCreditOf(id)),
            }
          : e,
      ),
    };
    return { token: c.resumeToken };
  }

  /** A fresh login of an account must not leave its old character standing in the world: release any entity held for it. */
  releaseSuspended(accountId: string): void {
    for (const c of [...this.clients.values()])
      if (c.suspendedAtMs !== null && c.accountId === accountId) this.removePlayer(c.id);
  }

  statsOf(id: number): ClientStats | undefined {
    return this.clients.get(id)?.stats;
  }

  // ------------------------------------------------------------------ inbound
  /** Handle one binary frame from a client (already length-limited by the gateway). */
  receive(id: number, data: Uint8Array, from?: ClientTransport): void {
    const c = this.clients.get(id);
    if (!c || c.dead) return;
    if (from !== undefined && c.transport !== from) return; // stale connection: the id now belongs to another player
    c.stats.bytesIn += data.length;
    c.stats.packetsIn++;
    const now = this.packetClock();
    if (now - c.pktWindowStartMs >= 1000) {
      c.pktWindowStartMs = now;
      c.pktCount = 0;
    }
    if (++c.pktCount > GATEWAY_CONFIG.MAX_PACKETS_PER_S) {
      this.metrics.kicksRate++;
      this.kick(c, ErrorCode.RateLimited, 'too many packets');
      return;
    }
    let msg: Message;
    try {
      msg = decode(data);
    } catch (e) {
      c.stats.badMessages++;
      this.send(c, { type: 'error', code: ErrorCode.BadMessage, text: e instanceof ProtocolError ? e.code : 'bad' });
      if (c.stats.badMessages >= 5) {
        this.metrics.kicksBadMessages++;
        this.kick(c, ErrorCode.BadMessage, 'too many malformed packets');
      }
      return;
    }
    switch (msg.type) {
      case 'input': {
        c.lastAckMs = this.world.timeMs;
        for (const p of msg.inputs) {
          if (p.mag > 0) this.progression?.onInput(id, p.mag, this.world.timeMs);
          // the packet re-sends the previous inputs; apply each seq once (uint16 wrap-aware)
          if (c.lastRecvSeq !== null && !seqNewer(p.seq, c.lastRecvSeq)) continue;
          c.lastRecvSeq = p.seq;
          c.inbox.push({
            kind: 'move',
            entityId: c.id,
            seq: p.seq,
            dtMs: p.dtMs,
            dir: p.dir,
            mag: p.mag,
            flags: p.flags,
          });
        }
        break;
      }
      case 'skill_cast':
        this.progression?.onCombat(id, this.world.timeMs);
        c.inbox.push({
          kind: 'cast',
          entityId: c.id,
          seq: msg.seq,
          skillId: msg.skillId,
          targetId: msg.targetId,
          rttMs: 0,
          aim: msg.aim ? { i: dequantizePos(msg.aim.qi), j: dequantizePos(msg.aim.qj) } : null,
        });
        break;
      case 'meditate_start':
      case 'meditate_stop':
      case 'breakthrough_start':
        if (!this.progression) {
          c.stats.badMessages++;
          this.send(c, { type: 'error', code: ErrorCode.BadMessage, text: 'unexpected message' });
        } else this.deliver(this.progression.handle(id, msg, this.world.timeMs));
        break;
      case 'inv_cmd':
        if (!this.invSync) {
          c.stats.badMessages++;
          this.send(c, { type: 'error', code: ErrorCode.BadMessage, text: 'unexpected message' });
        } else {
          // using an item (D90) acts on the sender's character: pills heal through the combat core / feed the next breakthrough
          const use = itemUseFor(
            {
              combat: this.combat,
              progression: this.progression,
              getWorld: () => this.world,
              setWorld: (w) => (this.world = w),
            },
            c.id,
          );
          this.send(c, this.invSync.handle(c.accountId, msg, this.world.timeMs, use));
        }
        break;
      case 'ping':
        this.send(c, { type: 'pong', clientTimeMs: msg.clientTimeMs, serverTimeMs: this.world.timeMs >>> 0 });
        break;
      default:
        c.stats.badMessages++;
        this.send(c, { type: 'error', code: ErrorCode.BadMessage, text: 'unexpected message' });
    }
  }

  // ------------------------------------------------------------------ tick
  /** One 20 Hz tick. Returns its wall-clock duration in ms. */
  tick(): number {
    const t0 = clock();
    if (this.lastTickStart > 0) pushCapped(this.tickIntervalMs, t0 - this.lastTickStart, WORLD_CONFIG.TICK_SAMPLES);
    this.lastTickStart = t0;

    // a dropped player whose hold ran out is released for good (combat / progression leave, id quarantined)
    for (const c of [...this.clients.values()]) {
      if (c.suspendedAtMs !== null && this.world.timeMs - c.suspendedAtMs >= this.resumeHoldMs) this.removePlayer(c.id);
    }

    const inputs: AimedInput[] = [];
    for (const c of this.clients.values()) {
      for (const i of c.inbox) inputs.push(i);
      c.inbox.length = 0;
    }
    let simInputs: SimInput[] = inputs;
    if (this.combat) {
      const pre = this.combat.preStep(inputs, this.world);
      simInputs = pre.inputs;
      for (const res of pre.results) this.sendCombatResult(res);
    }
    if (Number.isNaN(this.wall0)) this.wall0 = this.wallClock() - this.world.timeMs; // the wall clock starts counting at the first tick
    this.tickDriftMs = this.driftNow();
    const r = step(this.world, simInputs, this.ctx, NETWORK.TICK_MS, { lagMs: (id) => this.lagCreditOf(id) });
    const t1 = clock();
    this.world = r.world;
    if (this.combat) {
      const post = this.combat.postStep(this.world, r.events);
      this.world = post.world;
      for (const res of post.results) this.sendCombatResult(res);
    }
    // mob AI after combat, so a mob killed this tick is already despawned (and its respawn timer running)
    if (this.mobs) this.world = this.mobs.step(this.world);
    // mob attacks resolve after the AI moved the mobs: telegraphs start / land on the new positions
    if (this.mobAttacks) this.world = this.mobAttacks.step(this.world).world;
    this.byId = new Map(this.world.entities.map((e) => [e.id, e]));
    this.metrics.ticks++;
    this.handleEvents(r.events);
    if (this.progression) this.deliver(this.progression.tick(this.world.timeMs, NETWORK.TICK_MS));
    for (const e of this.world.entities) {
      if (!e.connected) {
        const c = this.clients.get(e.id);
        if (c) this.kick(c, ErrorCode.Kicked, 'anti-cheat');
      }
    }
    const t2 = clock();
    if (this.world.tick % 2 === 0) {
      this.updateAoi();
      this.phases.aoiTicks++;
    }
    const t3 = clock();
    this.flushInventory();
    this.sendSnapshots();
    const t4 = clock();
    const ph = this.phases;
    ph.stepMs += t1 - t0;
    ph.aoiMs += t3 - t2;
    ph.snapMs += t4 - t3;
    ph.maxStepMs = Math.max(ph.maxStepMs, t1 - t0);
    ph.maxAoiMs = Math.max(ph.maxAoiMs, t3 - t2);
    ph.maxSnapMs = Math.max(ph.maxSnapMs, t4 - t3);

    const dt = clock() - t0;
    pushCapped(this.tickMs, dt, WORLD_CONFIG.TICK_SAMPLES);
    return dt;
  }

  /** One `inv_state` per changed inventory per tick (D79), to the owner's live connection(s); offline owners just drop out. */
  private flushInventory(): void {
    const sync = this.invSync;
    if (!sync) return;
    for (const owner of sync.drain()) {
      // one owner's failure (state or encode) must never stop the world tick: count it and carry on with the others
      try {
        let msg: ReturnType<InventorySync['stateOf']> | null = null;
        for (const c of this.clients.values()) {
          if (c.accountId !== owner || c.dead) continue;
          msg ??= sync.stateOf(owner);
          this.send(c, msg);
        }
      } catch {
        this.metrics.inventorySendErrors++;
      }
    }
  }

  /** Send progression replies/state to their owners (a kicked or gone client is skipped). */
  private deliver(out: Outbound[]): void {
    for (const o of out) {
      const c = this.clients.get(o.entityId);
      if (c && !c.dead) this.send(c, o.msg);
    }
  }

  private handleEvents(events: SimEvent[]): void {
    for (const ev of events) {
      switch (ev.type) {
        case 'cast_ok': {
          this.metrics.castOk++;
          const c = this.clients.get(ev.entityId);
          // with combat on, the `skill_result` (with hits) is sent when the cast resolves
          if (c && !this.combat)
            this.send(c, {
              type: 'skill_result',
              seq: ev.seq,
              reason: CastReason.Ok,
              skillId: ev.skillId,
              readyAtMs: Math.max(0, Math.round(ev.readyAtMs)),
              casterIndex: 0,
              hits: [],
            });
          break;
        }
        case 'cast_rejected': {
          this.metrics.castRejected++;
          const c = this.clients.get(ev.entityId);
          if (c)
            this.send(c, {
              type: 'skill_result',
              seq: ev.seq,
              reason: ev.reason,
              skillId: ev.skillId,
              readyAtMs: Math.max(0, Math.round(ev.readyAtMs)),
              casterIndex: 0,
              hits: [],
            });
          break;
        }
        case 'cast_dropped': {
          this.metrics.castDropped++;
          const c = this.clients.get(ev.entityId);
          if (c) this.send(c, { type: 'error', code: ErrorCode.RateLimited, text: 'cast rate limit' });
          break;
        }
        case 'violation':
          this.metrics.violations[ev.kind] = (this.metrics.violations[ev.kind] ?? 0) + 1;
          break;
        case 'warn':
          this.metrics.warns++;
          break;
        case 'flag':
          this.metrics.flags++;
          break;
        case 'disconnect':
          this.metrics.disconnects++;
          break;
      }
    }
  }

  // ------------------------------------------------------------------ AOI (10 Hz)
  private updateAoi(): void {
    const cells = new Map<number, EntityState[]>();
    for (const e of this.world.entities) {
      if (!e.connected) continue;
      const { u, w } = toUW(e.i, e.j);
      const k = cellKey(Math.floor(u / AOI.HASH_CELL), Math.floor(w / AOI.HASH_CELL));
      const l = cells.get(k);
      if (l) l.push(e);
      else cells.set(k, [e]);
    }
    for (const c of this.clients.values()) {
      const me = this.byId.get(c.id);
      if (!me || c.dead || c.suspendedAtMs !== null) continue; // a held (dropped) player has nobody to send to
      const centre = aoiCentre({ i: me.i, j: me.j }, { i: me.vi, j: me.vj }, me.flying);
      const { u: u0, w: w0 } = toUW(centre.i, centre.j);

      // Update-rate bands by tile distance to this player (D73): near 20 Hz, mid 10 Hz, far 5 Hz; in a crowd only the closest
      // NEAR_MAX_ENTITIES keep the full rate, the rest of the near band drops to mid. Squared distances (no Math.hypot); farther
      // entities get their band from the thresholds alone and only the near-band subset is ever sorted. The band is assigned in the
      // same pass that decides who leaves, and for each new entry as it is added, so the visible set is walked once, not three times.
      const near2 = AOI.NEAR_BAND_TILES * AOI.NEAR_BAND_TILES;
      const mid2 = AOI.MID_BAND_TILES * AOI.MID_BAND_TILES;
      const nearBand: { v: Visible; d2: number; id: number }[] = [];
      const bandOf = (e: EntityState, v: Visible, eid: number): void => {
        const dx = e.i - me.i;
        const dy = e.j - me.j;
        const d2 = dx * dx + dy * dy;
        if (d2 > mid2) v.band = 2;
        else if (d2 > near2) v.band = 1;
        else nearBand.push({ v, d2, id: eid });
      };

      // leaves: gone from the world, or outside the (hysteresis) exit area
      const leaves: number[] = [];
      for (const [eid, v] of c.visible) {
        const e = this.byId.get(eid);
        if (!e || !e.connected || !inAoiAt(e.i, e.j, u0, w0, true)) {
          leaves.push(v.index);
          c.visible.delete(eid);
          c.slots[v.index] = 0;
          c.last[v.index] = undefined;
        } else bandOf(e, v, eid);
      }

      // enters: nearest first, up to the per-client cap. With no room left nothing can enter, so the (costly) candidate scan and
      // sort are skipped: in a crowd every client sits at the cap and this is most of the AOI cost.
      const enters: EnterEntity[] = [];
      if (c.visible.size < this.maxVisible) {
        const cu0 = Math.floor((u0 - AOI.HALF_U) / AOI.HASH_CELL);
        const cu1 = Math.floor((u0 + AOI.HALF_U) / AOI.HASH_CELL);
        const cw0 = Math.floor((w0 - AOI.HALF_W) / AOI.HASH_CELL);
        const cw1 = Math.floor((w0 + AOI.HALF_W) / AOI.HASH_CELL);
        const cand: { e: EntityState; d: number }[] = [];
        for (let cu = cu0; cu <= cu1; cu++) {
          for (let cw = cw0; cw <= cw1; cw++) {
            const l = cells.get(cellKey(cu, cw));
            if (!l) continue;
            for (const e of l) {
              if (e.id === c.id || c.visible.has(e.id)) continue;
              if (!inAoiAt(e.i, e.j, u0, w0, false)) continue;
              cand.push({ e, d: uwDistSq(e.i, e.j, u0, w0) + e.id * 1e-9 });
            }
          }
        }
        cand.sort((a, b) => a.d - b.d);
        for (const { e } of cand) {
          if (c.visible.size >= this.maxVisible) break;
          const index = c.slots.indexOf(0);
          if (index < 0) break;
          c.slots[index] = e.id;
          const entry: Visible = { index, band: 0 };
          c.visible.set(e.id, entry);
          bandOf(e, entry, e.id);
          const qi = quantizePos(e.i);
          const qj = quantizePos(e.j);
          const hpPct = this.hpPct(e);
          const se = snapshotEntityOf(index, e, this.animOf(e), null);
          c.last[index] = { qi, qj, hp: hpPct, anim: se.anim, dir: se.dir };
          enters.push({
            index,
            entityId: e.id,
            kind: this.mobs?.kindOf(e.id) ?? 0,
            // monsters: their definition id; players: the class wire id (D82, 0 when unknown)
            defId: this.mobs?.defIdOf(e.id) || this.classWireIdOf(e.id),
            qi,
            qj,
            anim: se.anim,
            dir: se.dir,
            hpPct,
            maxHp: this.maxHpOf(e),
          });
        }
      }

      if (nearBand.length <= AOI.NEAR_MAX_ENTITIES) {
        for (const x of nearBand) x.v.band = 0;
      } else {
        nearBand.sort((x, y) => x.d2 - y.d2 || x.id - y.id);
        for (let k = 0; k < nearBand.length; k++) nearBand[k]!.v.band = k < AOI.NEAR_MAX_ENTITIES ? 0 : 1;
      }

      if (leaves.length > 0) {
        this.send(c, { type: 'aoi_leave', indices: leaves });
        c.stats.aoiLeave += leaves.length;
      }
      if (enters.length > 0) {
        this.send(c, { type: 'aoi_enter', entities: enters });
        c.stats.aoiEnter += enters.length;
      }
      const n = c.visible.size;
      c.stats.visibleSum += n;
      c.stats.visibleSamples++;
      if (n > c.stats.visibleMax) c.stats.visibleMax = n;
    }
  }

  /** Max HP of an entity: a player's combat profile, a mob's (manager, else the `MobPort`), else the skeleton constant. */
  private maxHpOf(e: EntityState): number {
    return (
      this.combat?.maxHpOf(e.id) ??
      this.mobs?.maxHpOf(e.id) ??
      this.combat?.mobHpMax(e.id) ??
      WORLD_CONFIG.PLAYER_MAX_HP
    );
  }

  /** Turn a combat result into a `skill_result`: target / caster ids become the receiving client's visible-list indices. */
  private sendCombatResult(res: CombatResult): void {
    const c = this.clients.get(res.entityId);
    if (!c) return;
    const hits = [];
    for (const h of res.hits) {
      const v = c.visible.get(h.targetId);
      if (v) hits.push({ targetIndex: v.index, damage: h.damage, flags: h.flags });
    }
    this.send(c, {
      type: 'skill_result',
      seq: res.seq,
      reason: res.reason,
      skillId: res.skillId,
      readyAtMs: Math.max(0, Math.round(res.readyAtMs)),
      casterIndex: 0,
      hits,
    });
  }

  /** Own vitals for the wire (null when the node runs without combat: stats are the skeleton constants then). */
  private vitalsOf(e: EntityState): SelfVitals | null {
    const hpMax = this.combat?.maxHpOf(e.id);
    if (!this.combat || hpMax === undefined) return null;
    return {
      hp: Math.max(0, Math.round(e.hp)),
      hpMax: Math.round(hpMax),
      mp: Math.max(0, Math.round(e.mp)),
      mpMax: Math.round(e.mpMax),
      shield: Math.max(0, Math.round(this.combat.shieldOf(e.id, this.world.timeMs))),
    };
  }

  private hpPct(e: EntityState): number {
    return Math.max(0, Math.min(127, Math.round((e.hp / this.maxHpOf(e)) * 100)));
  }

  /** 0 idle, 1 run, 2 fly */
  private animOf(e: EntityState): number {
    if (e.flying) return 2;
    return Math.abs(e.vi) + Math.abs(e.vj) > 0.2 ? 1 : 0;
  }

  // ------------------------------------------------------------------ snapshots (20 / 10 / 5 Hz by band)
  /**
   * What a snapshot says about one entity this tick (quantised position, animation, direction, HP percent). It depends only on the
   * entity and the tick, so it is computed once per entity per tick and shared by every client that sees it, instead of once per
   * (client, visible entity) pair (about 70x fewer computations with 200 players in one crowd).
   */
  private currentOf(id: number): { qi: number; qj: number; anim: number; dir: number; hp: number } | undefined {
    let cur = this.snapCache.get(id);
    if (cur) return cur;
    const e = this.byId.get(id);
    if (!e) return undefined;
    const se = snapshotEntityOf(0, e, this.animOf(e), null);
    cur = { qi: se.qi, qj: se.qj, anim: se.anim, dir: se.dir, hp: this.hpPct(e) };
    this.snapCache.set(id, cur);
    return cur;
  }

  private sendSnapshots(): void {
    this.snapCache.clear();
    for (const c of this.clients.values()) {
      const me = this.byId.get(c.id);
      if (!me || c.dead || c.suspendedAtMs !== null) continue; // a held (dropped) player has nobody to send to
      if (c.transport.buffered() > GATEWAY_CONFIG.BACKPRESSURE_SKIP_BYTES) {
        c.stats.snapshotsSkipped++;
        if (c.transport.buffered() > GATEWAY_CONFIG.BACKPRESSURE_KICK_BYTES) {
          this.metrics.kicksBackpressure++;
          this.kick(c, ErrorCode.Internal, 'slow consumer');
        }
        continue;
      }
      const timedOut = this.world.timeMs - c.lastAckMs > WORLD_CONFIG.ACK_TIMEOUT_MS;
      const full = timedOut || c.snapSeq === 0;
      // D73: a resync (first snapshot, or no ack for ACK_TIMEOUT_MS) carries EVERY visible entity with absolute coordinates and HP,
      // ignoring band turns and the unchanged-record skip, so a client whose state is wrong recovers; once per ACK_TIMEOUT_MS
      const resync = c.snapSeq === 0 || (timedOut && this.world.timeMs - c.lastResyncMs >= WORLD_CONFIG.ACK_TIMEOUT_MS);
      if (resync) c.lastResyncMs = this.world.timeMs;
      const entities: SnapshotEntity[] = [];
      const touchedIdx: number[] = [];
      const touchedLast: Last[] = [];
      for (const [eid, v] of c.visible) {
        if (!resync && (this.world.tick + v.index) % BAND_PERIOD[v.band] !== 0) continue;
        const cur = this.currentOf(eid);
        if (!cur) continue;
        const last = c.last[v.index];
        const hp = cur.hp;
        // D73: nothing changed since the last record we sent for this slot -> the client keeps its state, send nothing
        if (
          !resync &&
          last &&
          last.hp === hp &&
          last.qi === cur.qi &&
          last.qj === cur.qj &&
          last.anim === cur.anim &&
          last.dir === cur.dir
        )
          continue;
        entities.push({
          index: v.index,
          qi: cur.qi,
          qj: cur.qj,
          anim: cur.anim,
          dir: cur.dir,
          hpPct: !resync && last && last.hp === hp ? null : hp,
        });
        touchedIdx.push(v.index);
        touchedLast.push({ qi: cur.qi, qj: cur.qj, hp, anim: cur.anim, dir: cur.dir });
      }
      // own HP / MP / shield (wire v3): only when changed since what this client last got, or on a full / resync snapshot
      const vitals = this.vitalsOf(me);
      const sendVitals = vitals !== null && (full || resync || !sameVitals(c.lastVitals, vitals));
      const seq = (c.snapSeq + 1) & 0xffff;
      const bytes = encode(
        {
          type: 'snapshot',
          seq,
          baselineSeq: full ? null : c.snapSeq & 0xffff,
          tick: this.world.tick,
          self: selfStateOf(me, sendVitals ? vitals : null),
          entities,
        },
        { baseline: (index) => c.last[index] },
      );
      for (let k = 0; k < touchedIdx.length; k++) c.last[touchedIdx[k]!] = touchedLast[k];
      if (sendVitals) c.lastVitals = vitals;
      c.snapSeq = seq;
      c.stats.snapshots++;
      this.write(c, bytes);
    }
  }

  // ------------------------------------------------------------------ output
  private send(c: Client, msg: Message): void {
    this.write(c, encode(msg));
  }

  private write(c: Client, bytes: Uint8Array): void {
    c.stats.bytesOut += bytes.length;
    c.stats.wireBytesOut += bytes.length + frameHeader(bytes.length);
    c.stats.framesOut++;
    c.transport.send(bytes);
  }

  private kick(c: Client, code: ErrorCode, text: string): void {
    if (c.dead) return;
    c.dead = true;
    c.transport.close(code, text);
    this.removePlayer(c.id);
  }

  // ------------------------------------------------------------------ scheduling
  /** Start the fixed-rate loop (drift-corrected; at most 3 catch-up ticks after a stall). */
  start(): void {
    if (this.running) return;
    this.running = true;
    let next = clock() + NETWORK.TICK_MS;
    const loop = (): void => {
      if (!this.running) return;
      let n = 0;
      while (clock() >= next && n < 3) {
        this.tick();
        next += NETWORK.TICK_MS;
        n++;
      }
      if (n === 3) next = clock() + NETWORK.TICK_MS; // give up catching up
      this.timer = setTimeout(loop, Math.max(0, next - clock()));
    };
    this.timer = setTimeout(loop, NETWORK.TICK_MS);
  }

  stop(): void {
    this.running = false;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
