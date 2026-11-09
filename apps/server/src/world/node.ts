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
  PARTY,
  aoiCentre,
  classWireId,
  inAoiAt,
  uwDistSq,
  rngFloat,
  rngInt,
  rngFork,
  rngSeed,
  toUW,
  type PathId,
  type RngState,
  MajorResult,
  COLLIDER_RADIUS_TILES,
} from '@vgtd/shared';
import {
  ErrorCode,
  ProtocolError,
  decode,
  encode,
  encodeSnapshotRecords,
  SnapshotRecords,
  LIMITS,
  dequantizePos,
  quantizePos,
  type SelfVitals,
  selfStateOf,
  snapshotEntityOf,
  type ChatLine,
  type EnterEntity,
  type Message,
  type SnapshotEntity, // TEMP-AB
  TelegraphShape,
} from '@vgtd/protocol';
import {
  ANTICHEAT,
  type AntiCheatState,
  CastReason,
  TileGrid,
  TILE_WALKABLE,
  budgetMs,
  circleBlocked,
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
import { ConnectionGuard, budgetClassOf } from './guard.js';
import type { SecurityEvent } from './security-log.js';
import type { Outbound, ProgressionService } from '../progression/service.js';
import type { ChatService } from '../chat/service.js';
import type { PartyService } from '../party/service.js';
import type { TradeService } from '../trade/service.js';
import type { SectService } from '../sect/service.js';
import type { FriendService } from '../friends/service.js';
import type { MarketService } from '../market/service.js';
import {
  CombatSystem,
  MobAttackSystem,
  type MobPhaseChange,
  type MobTelegraphEvent,
  type AimedInput,
  type CombatOptions,
  type CombatResult,
} from './combat/index.js';
import { MobManager, defaultMobZones, type MobZone } from './mobs/index.js';
import { MajorBreakthroughs, SHADOW_DEF_ID, ShadowRegistry } from './breakthrough/index.js';
import { DropSink, InventorySync, dropKillKey, itemUseFor, type InventoryService } from './inventory/index.js';

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
  /** `StatusSystem.signature` of the own status block last sent ('' = nothing active): re-sent only on a change (D94) */
  lastStatusSig: string;
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
  /** token buckets, strike windows and log throttles of this connection (D101) */
  guard: ConnectionGuard;
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
  /** kicks for sustained over-budget flooding (D101) */
  kicksFlood: number;
  /** frames dropped for exceeding a per-class budget (D101) */
  budgetDrops: number;
  /** security log events emitted (D101) */
  securityEvents: number;
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
  /** chat module (D87): World / Zone / Whisper channels; absent = chat messages are rejected as unexpected */
  chat?: ChatService;
  /** party module (D93): invite / accept / leave / kick, Party chat audience, shared kill credit; absent = party commands are rejected as unexpected */
  party?: PartyService;
  /** direct trade module (D102): needs `inventory`; absent = trade commands are rejected as unexpected */
  trade?: TradeService;
  /** NPC sect module (D98): join / leave at the sect NPC, Cống hiến from kills, the library; absent = sect commands are rejected as unexpected */
  sect?: SectService;
  /** friends module (D96): requests / list with online status, persisted through its store; absent = friend commands are rejected as unexpected */
  friends?: FriendService;
  /** Vạn Bảo Lâu (D112): list / search / buy / cancel with escrow and fee + tax through the ledger; absent = market commands are rejected as unexpected */
  market?: MarketService;
  /** Enable server-authoritative combat (D75). Omitted = the node only validates casts and answers `skill_result` with no hits. */
  combat?: CombatOptions;
  /** sim time a released player id waits before it can be reused (default `WORLD_CONFIG.PLAYER_ID_QUARANTINE_MS`) */
  playerIdQuarantineMs?: number;
  /** how long (sim ms) a dropped player's entity is held for a resume; 0 disables resume (default `WORLD_CONFIG.RESUME_HOLD_MS`) */
  resumeHoldMs?: number;
  /** clock (ms) for the per-client packet-rate window; default real time. Tests and benchmarks that tick faster than real time drive it themselves. */
  packetClock?: () => number;
  /** structured security events (D101): kicks, over-budget drops, malformed frames, anti-cheat violations. No account, name, address or token is ever in an event. */
  securityLog?: (e: SecurityEvent) => void;
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
    kicksFlood: 0,
    budgetDrops: 0,
    securityEvents: 0,
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
  private readonly securityLog: ((e: SecurityEvent) => void) | undefined;
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
  /** tiles inside the spawn square a player may appear on (walkable, reachable from the square's centre, room for the body); null = every tile (an open map) */
  private readonly spawnTiles: { i: number; j: number }[] | null;
  private readonly spawnSet: Set<number> | null;
  /** the tile the reachability search started from (the centre of the spawn square, or the nearest walkable tile to it) */
  private readonly spawnStart: { i: number; j: number };
  private readonly maxVisible: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTickStart = 0;
  private byId = new Map<number, EntityState>();
  /** per-tick cache of what a snapshot says about each entity (see `currentOf`) */
  private readonly snapCache = new Map<number, { qi: number; qj: number; anim: number; dir: number; hp: number }>();
  /** the records of the snapshot being built, reused for every client of every tick (D119) */
  private readonly snapRec = new SnapshotRecords();
  /** per record of the snapshot being built: the shared per-tick state it was taken from (to update the client's `last` after encoding) */
  private readonly snapTouched: Array<{ qi: number; qj: number; anim: number; dir: number; hp: number }> = [];
  readonly progression: ProgressionService | undefined;
  /** Tâm Ma / Lôi Kiếp events of major breakthroughs (D97); null without combat + progression */
  readonly major: MajorBreakthroughs | null;
  /** Tâm Ma shadows as combat targets (the `MobPort` of the combat core wraps the mob manager); null without combat + progression */
  private readonly shadows: ShadowRegistry | null;
  readonly chat: ChatService | undefined;
  readonly party: PartyService | undefined;
  readonly trade: TradeService | undefined;
  readonly sect: SectService | undefined;
  readonly friends: FriendService | undefined;
  readonly market: MarketService | undefined;
  /**
   * players who joined and have not been sent the World chat history yet: the lines that existed AT JOIN TIME, sent on the next tick (after
   * `hello_ack`). A snapshot, so a line spoken between the join and that tick is delivered live only, never twice.
   */
  private readonly chatHistoryDue = new Map<number, ChatLine[]>();
  /** Major-event messages a player missed while held (D97): their final answer, kept until they resume. */
  private readonly heldMajor = new Map<number, Message[]>();
  /** Major-event state to re-send to resumed players on the next tick (after the client has reset its overlay on `hello_ack`). */
  private readonly majorDue = new Map<number, Message[]>();
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
    const area = this.computeSpawnArea(grid);
    this.spawnTiles = area.tiles;
    this.spawnSet = area.tiles ? new Set(area.tiles.map((t) => t.j * grid.width + t.i)) : null;
    this.spawnStart = area.start;
    this.maxVisible = opts.maxVisible ?? WORLD_CONFIG.MAX_VISIBLE;
    this.progression = opts.progression;
    this.chat = opts.chat;
    this.chat?.attach({
      deliver: (id, m) => {
        const c = this.clients.get(id);
        if (c && !c.dead) this.send(c, m);
      },
      posOf: (id) => this.byId.get(id),
      partyMembers: (id) => this.party?.membersOf(id) ?? [],
    });
    this.trade = opts.trade;
    this.trade?.attach({
      deliver: (id, m) => {
        const c = this.clients.get(id);
        if (c && !c.dead) this.send(c, m);
      },
      posOf: (id) => this.byId.get(id),
    });
    this.sect = opts.sect;
    this.sect?.attach({
      deliver: (id, m) => {
        const c = this.clients.get(id);
        if (c && !c.dead) this.send(c, m);
      },
      posOf: (id) => this.byId.get(id),
      // the sect NPC stands in the middle of the spawn area unless the sect service was told otherwise
      defaultNpc: { i: this.spawn.i0 + this.spawn.side / 2, j: this.spawn.j0 + this.spawn.side / 2 },
    });
    this.market = opts.market;
    this.market?.attach({
      deliver: (id, m) => {
        const c = this.clients.get(id);
        if (c && !c.dead) this.send(c, m);
      },
    });
    this.friends = opts.friends;
    this.friends?.attach({
      deliver: (id, m) => {
        const c = this.clients.get(id);
        if (c && !c.dead) this.send(c, m);
      },
    });
    this.party = opts.party;
    this.party?.attach({
      deliver: (id, m) => {
        const c = this.clients.get(id);
        if (c && !c.dead) this.send(c, m);
      },
      vitalsOf: (id) => {
        const e = this.byId.get(id);
        if (!e) return undefined;
        return {
          hp: Math.round(e.hp),
          hpMax: Math.round(this.maxHpOf(e)),
          mp: Math.round(e.mp),
          mpMax: Math.round(e.mpMax),
        };
      },
    });
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
    this.securityLog = opts.securityLog;
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
    const basePort = opts.combat?.mobs ?? this.mobs ?? undefined;
    // Tâm Ma shadows (D97) are combat targets too: the combat core talks to a registry that answers for them and forwards the rest
    this.shadows = opts.combat && this.progression ? new ShadowRegistry(basePort) : null;
    const mobPort = this.shadows ?? basePort;
    const shadows = this.shadows;
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
          partyOf: (id) => this.creditGroupOf(id),
          isInvulnerable: (id) => this.mobAttacks?.isInvulnerable(id) ?? false,
          canTarget: (casterId, mobId) => shadows?.canTarget(casterId, mobId) ?? true,
          ...opts.combat,
          mobs: mobPort,
          onDrops:
            sink || opts.sect
              ? (e) => {
                  if (shadows?.owns(e.mobId)) return; // a Tâm Ma shadow drops nothing
                  sink?.handle(e);
                  // a sect member's kill pays Cống hiến (D98); the kill key makes a repeated event a replay
                  const owner = this.clients.get(e.killerId)?.accountId;
                  if (owner !== undefined && opts.sect)
                    opts.sect.onKill(
                      owner,
                      mobPort?.combatStats(e.mobId)?.dropSource ?? 'field',
                      dropKillKey(e.mobId, this.world.tick),
                    );
                  opts.combat?.onDrops?.(e);
                }
              : (e) => {
                  if (shadows?.owns(e.mobId)) return;
                  opts.combat?.onDrops?.(e);
                },
        })
      : null;
    this.mobAttacks =
      this.combat && this.mobs && opts.combat?.mobAttacks !== false
        ? new MobAttackSystem(this.ctx, this.combat, this.mobs, seed)
        : null;
    this.major =
      this.combat && this.progression && this.shadows
        ? new MajorBreakthroughs({
            ctx: this.ctx,
            combat: this.combat,
            progression: this.progression,
            shadows: this.shadows,
            world: () => this.world,
          })
        : null;
    if (this.major) this.progression!.attachMajor(this.major);
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
  addPlayer(
    transport: ClientTransport,
    accountId: string,
    classPath: PathId = DEFAULT_CLASS,
    /** chat / whisper name (the unique username); defaults to a short form of the account id */
    displayName: string = accountId.slice(0, 12),
  ): number {
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
      lastStatusSig: '',
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
      guard: new ConnectionGuard(),
      stats: emptyStats(),
    });
    this.progression?.join(id, accountId, this.world.timeMs);
    this.party?.join({ entityId: id, accountId, name: displayName, classId: classWireId(classPath) });
    this.trade?.join({ entityId: id, accountId, name: displayName });
    this.sect?.join({ entityId: id, accountId, path: classPath });
    this.friends?.join({ entityId: id, accountId, name: displayName, classId: classWireId(classPath) });
    this.market?.join({ entityId: id, accountId });
    if (this.chat) {
      this.chat.join({ entityId: id, accountId, name: displayName });
      const lines = this.chat.history();
      if (lines.length) this.chatHistoryDue.set(id, lines);
    }
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

  /**
   * Which tiles of the spawn square a player may appear on (D95: the zone map has water and lava, and the default 96-tile square reaches
   * them). A tile qualifies when it is walkable and connected to the square's centre over walkable tiles (4-neighbour flood fill over the
   * whole map), and a body of the player's size fits there. An OPEN square (the old tests, an all-land dev area) returns `tiles: null`:
   * every tile qualifies and the spawn stream is exactly what it was before.
   */
  private computeSpawnArea(grid: TileGrid): {
    tiles: { i: number; j: number }[] | null;
    start: { i: number; j: number };
  } {
    const w = grid.width;
    const h = grid.height;
    const sq = this.spawn;
    const walkable = (i: number, j: number): boolean => (grid.flags(i, j) & TILE_WALKABLE) !== 0;
    const free = (i: number, j: number): boolean =>
      walkable(i, j) && !circleBlocked(grid, i + 0.5, j + 0.5, COLLIDER_RADIUS_TILES, 0);
    const clampI = (v: number): number => Math.min(w - 1, Math.max(0, v));
    const clampJ = (v: number): number => Math.min(h - 1, Math.max(0, v));
    const i0 = Math.floor(sq.i0);
    const j0 = Math.floor(sq.j0);
    const i1 = Math.min(w - 1, Math.ceil(sq.i0 + sq.side) - 1);
    const j1 = Math.min(h - 1, Math.ceil(sq.j0 + sq.side) - 1);
    // an open square needs no work (the common case: tests, the open dev map)
    let open = true;
    for (let j = Math.max(0, j0); j <= j1 && open; j++)
      for (let i = Math.max(0, i0); i <= i1; i++)
        if (!free(i, j)) {
          open = false;
          break;
        }
    const ci = clampI(Math.floor(sq.i0 + sq.side / 2));
    const cj = clampJ(Math.floor(sq.j0 + sq.side / 2));
    if (open) return { tiles: null, start: { i: ci, j: cj } };
    // the nearest walkable tile to the centre (the centre itself unless it is water)
    let start = { i: ci, j: cj };
    if (!walkable(ci, cj)) {
      let found = false;
      for (let rad = 1; rad <= Math.max(w, h) && !found; rad++)
        for (let dj = -rad; dj <= rad && !found; dj++)
          for (let di = -rad; di <= rad; di++) {
            if (Math.max(Math.abs(di), Math.abs(dj)) !== rad) continue;
            const ti = ci + di;
            const tj = cj + dj;
            if (ti >= 0 && tj >= 0 && ti < w && tj < h && walkable(ti, tj)) {
              start = { i: ti, j: tj };
              found = true;
              break;
            }
          }
    }
    const seen = new Uint8Array(w * h);
    const queue: number[] = [start.j * w + start.i];
    seen[queue[0]!] = 1;
    for (let q = 0; q < queue.length; q++) {
      const t = queue[q]!;
      const ti = t % w;
      const tj = (t - ti) / w;
      for (const [di, dj] of [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ] as const) {
        const ni = ti + di;
        const nj = tj + dj;
        if (ni < 0 || nj < 0 || ni >= w || nj >= h || seen[nj * w + ni] || !walkable(ni, nj)) continue;
        seen[nj * w + ni] = 1;
        queue.push(nj * w + ni);
      }
    }
    const tiles: { i: number; j: number }[] = [];
    for (let j = Math.max(0, j0); j <= j1; j++)
      for (let i = Math.max(0, i0); i <= i1; i++) if (seen[j * w + i] && free(i, j)) tiles.push({ i, j });
    return { tiles, start };
  }

  /**
   * A random point of the spawn region (join and respawn), drawn from the seeded `spawn` stream. On a map with obstacles the point is
   * re-drawn (from the same stream, so it stays deterministic) until it lands on a spawnable tile; after 32 misses a spawnable tile is
   * picked directly, and a region with none falls back to the tile the search started from.
   */
  private spawnPoint(): { i: number; j: number } {
    const g = this.ctx.grid;
    const ok = (p: { i: number; j: number }): boolean =>
      !this.spawnSet ||
      (this.spawnSet.has(Math.floor(p.j) * g.width + Math.floor(p.i)) &&
        !circleBlocked(g, p.i, p.j, COLLIDER_RADIUS_TILES, 0));
    for (let k = 0; k < 32; k++) {
      const [a, r1] = rngFloat(this.spawnRng);
      const [b, r2] = rngFloat(r1);
      this.spawnRng = r2;
      const p = { i: this.spawn.i0 + a * this.spawn.side, j: this.spawn.j0 + b * this.spawn.side };
      if (ok(p)) return p;
    }
    const tiles = this.spawnTiles;
    if (!tiles || tiles.length === 0) return { i: this.spawnStart.i + 0.5, j: this.spawnStart.j + 0.5 };
    const [pick, r3] = rngInt(this.spawnRng, tiles.length);
    this.spawnRng = r3;
    const t = tiles[pick]!;
    return { i: t.i + 0.5, j: t.j + 0.5 };
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
    if (this.major?.isActive(id)) {
      // leaving in the middle of a Tâm Ma / Kiếp counts as losing it (the outcome is applied before the character is written)
      const mj = this.major.onLeave(this.world, id);
      this.world = mj.world;
      if (mj.telegraphs.length > 0) this.sendTelegraphs(mj.telegraphs);
      this.deliver(mj.outbound);
    }
    void this.progression?.leave(id);
    this.chat?.leave(id);
    this.party?.leave(id);
    this.trade?.leave(id);
    this.sect?.leave(id);
    this.friends?.leave(id);
    this.market?.leave(id);
    this.chatHistoryDue.delete(id);
    this.heldMajor.delete(id);
    this.majorDue.delete(id);
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
    c.lastStatusSig = '';
    c.visible = new Map();
    c.slots.fill(0);
    c.last.fill(undefined);
    c.snapSeq = 0;
    c.lastAckMs = now;
    c.lastResyncMs = -Infinity;
    // a Tâm Ma / Kiếp that ran (or ended) while the player was held: tell the client where it stands, next tick (D97)
    const snap = this.major?.snapshotMsg(id, now);
    const missed = this.heldMajor.get(id);
    this.heldMajor.delete(id);
    if (snap || missed?.length) this.majorDue.set(id, snap ? [snap] : missed!);
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
      this.badFrame(c, e instanceof ProtocolError ? e.code : 'bad');
      return;
    }
    const cls = budgetClassOf(msg.type);
    if (cls && !c.guard.take(cls, now)) {
      this.metrics.budgetDrops++;
      if (c.guard.due(`drop:${cls}`, now)) {
        this.emitSecurity('budget_drop', c, cls, { dropped: c.guard.dropped[cls] ?? 0 });
        this.send(c, { type: 'error', code: ErrorCode.RateLimited, text: 'message rate limit' });
      }
      if (c.guard.strikeFlood(now)) {
        this.metrics.kicksFlood++;
        this.kick(c, ErrorCode.RateLimited, 'message flood');
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
          this.badFrame(c, 'unexpected');
        } else this.deliver(this.progression.handle(id, msg, this.world.timeMs));
        break;
      case 'chat_send':
        if (!this.chat) {
          this.badFrame(c, 'unexpected');
        } else this.send(c, this.chat.handle(id, msg, this.world.timeMs));
        break;
      case 'party_cmd':
        if (!this.party) {
          this.badFrame(c, 'unexpected');
        } else this.send(c, this.party.handle(id, msg, this.world.timeMs));
        break;
      case 'trade_cmd':
        if (!this.trade) {
          this.badFrame(c, 'unexpected');
        } else this.send(c, this.trade.handle(id, msg, this.world.timeMs));
        break;
      case 'sect_cmd':
        if (!this.sect) {
          this.badFrame(c, 'unexpected');
        } else this.send(c, this.sect.handle(id, msg, this.world.timeMs));
        break;
      case 'market_search':
      case 'market_list':
      case 'market_buy':
      case 'market_cancel':
        if (!this.market) {
          c.stats.badMessages++;
          this.send(c, { type: 'error', code: ErrorCode.BadMessage, text: 'unexpected message' });
        } else this.send(c, this.market.handle(id, msg, this.world.timeMs));
        break;
      case 'friend_cmd':
        if (!this.friends) {
          this.badFrame(c, 'unexpected');
        } else this.send(c, this.friends.handle(id, msg, this.world.timeMs));
        break;
      case 'inv_cmd':
        if (!this.invSync) {
          this.badFrame(c, 'unexpected');
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
        this.badFrame(c, 'unexpected');
    }
  }

  /** A malformed, unexpected or out-of-direction frame: answer once, count it, kick when the strikes of the rolling window are used up. */
  private badFrame(c: Client, why: string): void {
    c.stats.badMessages++;
    const now = this.packetClock();
    if (c.guard.due('bad', now)) this.emitSecurity('bad_frame', c, why, { total: c.stats.badMessages });
    this.send(c, {
      type: 'error',
      code: ErrorCode.BadMessage,
      text: why === 'unexpected' ? 'unexpected message' : why,
    });
    if (c.guard.strikeMalformed(now)) {
      this.metrics.kicksBadMessages++;
      this.kick(c, ErrorCode.BadMessage, 'too many malformed packets');
    }
  }

  /** One structured security event (D101): numeric entity id and fixed strings only, never account / name / address / token / payload. */
  private emitSecurity(ev: SecurityEvent['ev'], c: Client, reason: string, detail?: SecurityEvent['detail']): void {
    this.metrics.securityEvents++;
    if (!this.securityLog) return;
    try {
      this.securityLog({ ev, tick: this.world.tick, entity: c.id, reason, ...(detail ? { detail } : {}) });
    } catch {
      /* a failing log sink must never take the world down */
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
    if (this.mobAttacks) {
      const mobAtk = this.mobAttacks.step(this.world);
      this.world = mobAtk.world;
      if (mobAtk.telegraphs.length > 0) this.sendTelegraphs(mobAtk.telegraphs);
      if (mobAtk.phases.length > 0) this.sendBossPhases(mobAtk.phases);
    }
    if (this.major) {
      // Tâm Ma / Lôi Kiếp of running major breakthroughs (D97): after combat and mobs, so a killed shadow is already gone
      const mj = this.major.step(this.world);
      this.world = mj.world;
      if (mj.telegraphs.length > 0) this.sendTelegraphs(mj.telegraphs);
      if (mj.outbound.length > 0) this.deliver(mj.outbound);
    }
    this.byId = new Map(this.world.entities.map((e) => [e.id, e]));
    this.sendStatusUpdates(); // other players' root / slow / poison, on change (D94)
    this.metrics.ticks++;
    this.handleEvents(r.events);
    if (this.progression) this.deliver(this.progression.tick(this.world.timeMs, NETWORK.TICK_MS));
    if (this.chat && this.chatHistoryDue.size) this.sendChatHistory();
    if (this.majorDue.size) this.sendMajorDue();
    this.party?.tick(this.world.timeMs, this.world.tick);
    this.trade?.tick(this.world.timeMs);
    this.sect?.tick();
    this.friends?.tick();
    if (this.market && this.world.tick % 20 === 0) this.market.tick(); // expiry, returns and the weekly shadow report: about once a second
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

  /**
   * Who shares the credit (loot) of a kill by `killerId`: the killer's party members who are alive and within `PARTY.SHARE_RANGE_TILES` of the
   * killer, the killer always included, ascending. Without a party this is just `[killerId]`. PLACEHOLDER rule (D93, "cần game designer duyệt").
   */
  private creditGroupOf(killerId: number): number[] {
    const members = this.party?.membersOf(killerId) ?? [];
    if (members.length <= 1) return [killerId];
    const k = this.byId.get(killerId);
    const out: number[] = [];
    for (const m of members) {
      if (m === killerId) {
        out.push(m);
        continue;
      }
      const e = this.byId.get(m);
      if (!e || !k || e.hp <= 0) continue;
      if (Math.hypot(e.i - k.i, e.j - k.j) <= PARTY.SHARE_RANGE_TILES) out.push(m);
    }
    return out;
  }

  /** The World channel's recent lines go to each newly joined player once (not before the gateway's `hello_ack` is out: next tick). */
  private sendChatHistory(): void {
    for (const [id, lines] of this.chatHistoryDue) {
      const c = this.clients.get(id);
      if (c && !c.dead) this.send(c, { type: 'chat_history', lines });
    }
    this.chatHistoryDue.clear();
  }

  private sendMajorDue(): void {
    for (const [id, msgs] of this.majorDue) {
      const c = this.clients.get(id);
      if (c && !c.dead) for (const m of msgs) this.send(c, m);
    }
    this.majorDue.clear();
  }

  /** Send progression replies/state to their owners (a kicked or gone client is skipped). */
  private deliver(out: Outbound[]): void {
    for (const o of out) {
      const c = this.clients.get(o.entityId);
      if (!c || c.dead) continue;
      if (c.suspendedAtMs !== null) {
        // held player: the final answer of an event is kept for the resume (the rest is rebuilt from the live event)
        const m = o.msg;
        if ((m.type === 'major_event' && m.result !== MajorResult.Running) || m.type === 'breakthrough_result') {
          const q = this.heldMajor.get(o.entityId) ?? [];
          q.push(m);
          this.heldMajor.set(o.entityId, q);
        }
      }
      this.send(c, o.msg);
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
        case 'violation': {
          this.metrics.violations[ev.kind] = (this.metrics.violations[ev.kind] ?? 0) + 1;
          const vc = this.clients.get(ev.entityId);
          if (vc && vc.guard.due(`violation:${ev.kind}`, this.packetClock()))
            this.emitSecurity('violation', vc, ev.kind, { score: Math.round(ev.score) });
          break;
        }
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
    const hideShadows = !!this.shadows && this.shadows.size > 0;
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
              if (hideShadows && this.shadows!.hiddenFor(e.id, c.id)) continue; // a Tâm Ma shadow is seen by its owner only (D97)
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
            kind: this.mobs?.kindOf(e.id) ?? (this.shadows?.owns(e.id) ? 1 : 0),
            // monsters: their definition id; players: the class wire id (D82, 0 when unknown)
            defId:
              this.mobs?.defIdOf(e.id) || (this.shadows?.owns(e.id) ? SHADOW_DEF_ID : 0) || this.classWireIdOf(e.id),
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
        // an entity that comes into view with an active status: tell this client now (status_update otherwise only goes out on a change)
        for (const en of enters) {
          const mask = this.statusMasks.get(en.entityId);
          if (mask) this.send(c, { type: 'status_update', entityId: en.entityId, mask });
        }
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
  /** Live telegraphs (D89): wire id -> the clients that were told about the start (the end goes to the same ones). */
  private readonly telegraphAudience = new Map<number, number[]>();

  /**
   * Mob attack telegraphs (D89): `telegraph_start` goes only to the clients whose AOI holds the anchor (the circle centre, or the
   * mob for a cone / line), `telegraph_end` to exactly those that got the start (a client that left the area just drops the decal
   * when its time is up). A held (dropped) or dead connection is skipped.
   */
  private sendTelegraphs(list: readonly MobTelegraphEvent[]): void {
    for (const t of list) {
      if (t.kind === 'end') {
        const to = this.telegraphAudience.get(t.id);
        this.telegraphAudience.delete(t.id);
        if (!to) continue;
        const msg: Message = { type: 'telegraph_end', id: t.id, cancelled: t.cancelled };
        for (const id of to) {
          const c = this.clients.get(id);
          if (c && !c.dead && c.suspendedAtMs === null) this.send(c, msg);
        }
        continue;
      }
      const s = t.attack.shape;
      let shape: TelegraphShape;
      let size: number;
      let extra: number;
      if (s.type === 'circle') {
        shape = TelegraphShape.Circle;
        size = s.radius ?? 0;
        extra = 0;
      } else if (s.type === 'cone') {
        shape = TelegraphShape.Cone;
        size = s.radius ?? 0;
        extra = Math.round(s.angle_deg ?? 360);
      } else if (s.type === 'line') {
        shape = TelegraphShape.Line;
        size = s.length ?? 0;
        extra = Math.round((s.width ?? 1) * LIMITS.POS_SCALE);
      } else continue; // mob attacks only use circle / cone / line
      const msg: Message = {
        type: 'telegraph_start',
        id: t.id,
        mobEntityId: t.mobId,
        shape,
        qi: quantizePos(t.i),
        qj: quantizePos(t.j),
        facing: shape === TelegraphShape.Circle ? 0 : Math.min(254, t.facing),
        size: Math.min(0xffff, Math.round(size * LIMITS.POS_SCALE)),
        extra: Math.min(0xffff, extra),
        durationMs: Math.min(0xffff, t.durationMs),
      };
      const to: number[] = [];
      for (const c of this.clients.values()) {
        if (c.dead || c.suspendedAtMs !== null) continue;
        if (t.audience !== undefined && c.id !== t.audience) continue;
        const me = this.byId.get(c.id);
        if (!me) continue;
        const centre = aoiCentre({ i: me.i, j: me.j }, { i: me.vi, j: me.vj }, me.flying);
        const { u, w } = toUW(centre.i, centre.j);
        if (!inAoiAt(t.i, t.j, u, w, false)) continue;
        to.push(c.id);
        this.send(c, msg);
      }
      if (to.length > 0) this.telegraphAudience.set(t.id, to);
    }
  }

  /**
   * Boss phase changes (D91): `boss_phase` goes to the clients whose AOI holds the boss (the ones that see it), once per change. A held
   * (dropped) or dead connection is skipped.
   */
  private sendBossPhases(list: readonly MobPhaseChange[]): void {
    for (const p of list) {
      const boss = this.world.entities.find((e) => e.id === p.mobId);
      if (!boss) continue;
      const msg: Message = {
        type: 'boss_phase',
        mobEntityId: p.mobId,
        phase: Math.min(255, Math.max(1, p.phase)),
        transformMs: Math.min(0xffff, p.transformMs),
      };
      for (const c of this.clients.values()) {
        if (c.dead || c.suspendedAtMs !== null) continue;
        const me = this.byId.get(c.id);
        if (!me) continue;
        const centre = aoiCentre({ i: me.i, j: me.j }, { i: me.vi, j: me.vj }, me.flying);
        const { u, w } = toUW(centre.i, centre.j);
        if (inAoiAt(boss.i, boss.j, u, w, false)) this.send(c, msg);
      }
    }
  }

  /** Last status mask broadcast per entity (D94): `status_update` goes out only when it changes. */
  private readonly statusMasks = new Map<number, number>();

  /**
   * Other players' statuses (D94): when the root / slow / poison mask of an entity changes, `status_update` goes to every OTHER client whose
   * AOI holds it (the entity itself learns through its own status block). A dead or held connection is skipped.
   */
  private sendStatusUpdates(): void {
    const combat = this.combat;
    if (!combat) return;
    const now = this.world.timeMs;
    const ids = new Set<number>([...combat.status.affectedIds(), ...this.statusMasks.keys()]);
    for (const id of [...ids].sort((a, b) => a - b)) {
      const mask = combat.status.maskOf(id, now);
      const prev = this.statusMasks.get(id) ?? 0;
      if (mask === prev) {
        if (mask === 0) this.statusMasks.delete(id);
        continue;
      }
      if (mask === 0) this.statusMasks.delete(id);
      else this.statusMasks.set(id, mask);
      const e = this.byId.get(id);
      if (!e) continue;
      const msg: Message = { type: 'status_update', entityId: id, mask };
      for (const c of this.clients.values()) {
        if (c.id === id || c.dead || c.suspendedAtMs !== null) continue;
        const me = this.byId.get(c.id);
        if (!me) continue;
        const centre = aoiCentre({ i: me.i, j: me.j }, { i: me.vi, j: me.vj }, me.flying);
        const { u, w } = toUW(centre.i, centre.j);
        if (inAoiAt(e.i, e.j, u, w, false)) this.send(c, msg);
      }
    }
  }

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
    if (process.env.VGTD_OLD_SNAP) return this.sendSnapshotsOld(); // TEMP-AB
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
      // the records of this snapshot go into the node's ONE reusable parallel-array buffer (no per-entity object, D119)
      const rec = this.snapRec;
      const touched = this.snapTouched;
      let n = 0;
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
        rec.index[n] = v.index;
        rec.qi[n] = cur.qi;
        rec.qj[n] = cur.qj;
        rec.anim[n] = cur.anim;
        rec.dir[n] = cur.dir;
        rec.hp[n] = !resync && last && last.hp === hp ? -1 : hp;
        touched[n] = cur;
        n++;
      }
      rec.count = n;
      // own HP / MP / shield (wire v3): only when changed since what this client last got, or on a full / resync snapshot
      const vitals = this.vitalsOf(me);
      const sendVitals = vitals !== null && (full || resync || !sameVitals(c.lastVitals, vitals));
      // own root / slow / poison (D94): only on a change since what this client last got (or on a full / resync snapshot while something is active)
      const statusSig = this.combat ? this.combat.status.signature(me.id, this.world.timeMs) : '';
      const sendStatus = statusSig !== c.lastStatusSig || ((full || resync) && statusSig !== '');
      const seq = (c.snapSeq + 1) & 0xffff;
      const bytes = encodeSnapshotRecords(
        {
          seq,
          baselineSeq: full ? null : c.snapSeq & 0xffff,
          tick: this.world.tick,
          self: selfStateOf(
            me,
            sendVitals ? vitals : null,
            sendStatus && this.combat ? this.combat.status.statusOf(me.id, this.world.timeMs) : null,
          ),
        },
        rec,
        c.last,
      );
      // what this client now holds per slot: updated in place AFTER encoding (the encoder read the old positions as its delta baseline)
      for (let k = 0; k < n; k++) {
        const idx = rec.index[k]!;
        const cur = touched[k]!;
        const l = c.last[idx];
        if (l) {
          l.qi = cur.qi;
          l.qj = cur.qj;
          l.hp = cur.hp;
          l.anim = cur.anim;
          l.dir = cur.dir;
        } else c.last[idx] = { qi: cur.qi, qj: cur.qj, hp: cur.hp, anim: cur.anim, dir: cur.dir };
      }
      if (sendVitals) c.lastVitals = vitals;
      c.lastStatusSig = statusSig;
      c.snapSeq = seq;
      c.stats.snapshots++;
      this.write(c, bytes);
    }
  }

  // TEMP-AB-BEGIN
  private sendSnapshotsOld(): void {
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
      // own root / slow / poison (D94): only on a change since what this client last got (or on a full / resync snapshot while something is active)
      const statusSig = this.combat ? this.combat.status.signature(me.id, this.world.timeMs) : '';
      const sendStatus = statusSig !== c.lastStatusSig || ((full || resync) && statusSig !== '');
      const seq = (c.snapSeq + 1) & 0xffff;
      const bytes = encode(
        {
          type: 'snapshot',
          seq,
          baselineSeq: full ? null : c.snapSeq & 0xffff,
          tick: this.world.tick,
          self: selfStateOf(
            me,
            sendVitals ? vitals : null,
            sendStatus && this.combat ? this.combat.status.statusOf(me.id, this.world.timeMs) : null,
          ),
          entities,
        },
        { baseline: (index) => c.last[index] },
      );
      for (let k = 0; k < touchedIdx.length; k++) c.last[touchedIdx[k]!] = touchedLast[k];
      if (sendVitals) c.lastVitals = vitals;
      c.lastStatusSig = statusSig;
      c.snapSeq = seq;
      c.stats.snapshots++;
      this.write(c, bytes);
    }
  }

  // TEMP-AB-END

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
    this.emitSecurity('kick', c, text, { code });
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
