/**
 * World Node skeleton (docs/08 §2, §4, §8): owns one `@vgtd/sim` world, steps it at a fixed 20 Hz, turns client
 * packets into sim inputs (never positions), runs the AOI at 10 Hz and sends per-client snapshots with distance bands.
 *
 * Clocks (`hrtime`, `setTimeout`) are used ONLY to schedule ticks and measure them; the simulation itself always
 * advances by the fixed `NETWORK.TICK_MS` (skill vgtd-sim-determinism).
 */
import {
  AOI,
  MOB_ID_BASE,
  NETWORK,
  aoiCentre,
  inAoi,
  rngFloat,
  rngFork,
  rngSeed,
  toUW,
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
import { CombatSystem, type AimedInput, type CombatOptions, type CombatResult } from './combat/index.js';
import { MobManager, defaultMobZones, type MobZone } from './mobs/index.js';
import { DropSink, type InventoryService } from './inventory/index.js';

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
  private spawnRng: RngState;
  private readonly spawn: { i0: number; j0: number; side: number };
  private readonly maxVisible: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTickStart = 0;
  private byId = new Map<number, EntityState>();
  readonly progression: ProgressionService | undefined;
  /** Combat core (cast resolution, HP, death / respawn, drops); null when the node was built without `opts.combat`. */
  readonly combat: CombatSystem | null;
  /** monster spawns / AI (D74); null when the node runs without mobs */
  readonly mobs: MobManager | null;
  /** inventory + drop sink (D77); null when the node runs without one */
  readonly inventory: InventoryService | null;
  /** combat `onDrops` -> `inventory.grantDrops` (needs both `combat` and `inventory`); null otherwise */
  readonly dropSink: DropSink | null;

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
    this.inventory = opts.inventory ?? null;
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

  addPlayer(transport: ClientTransport, accountId: string): number {
    const id = this.allocateId();
    const at = this.spawnPoint();
    const stats = this.combat?.addPlayer(id);
    this.world = spawnEntity(this.world, {
      id,
      i: at.i,
      j: at.j,
      hp: stats?.hpMax ?? WORLD_CONFIG.PLAYER_MAX_HP,
      mpMax: stats?.mpMax ?? WORLD_CONFIG.PLAYER_MAX_MP,
    });
    this.inventory?.onJoin(accountId);
    this.clients.set(id, {
      id,
      accountId,
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
      pktWindowStartMs: clock(),
      pktCount: 0,
      joinedTick: this.world.tick,
      dead: false,
      stats: emptyStats(),
    });
    this.progression?.join(id, accountId, this.world.timeMs);
    return id;
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
              ac: slideBudget(e.ac, now),
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
    const now = clock();
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
    const r = step(this.world, simInputs, this.ctx, NETWORK.TICK_MS);
    const t1 = clock();
    this.world = r.world;
    if (this.combat) {
      const post = this.combat.postStep(this.world, r.events);
      this.world = post.world;
      for (const res of post.results) this.sendCombatResult(res);
    }
    // mob AI after combat, so a mob killed this tick is already despawned (and its respawn timer running)
    if (this.mobs) this.world = this.mobs.step(this.world);
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

      // leaves: gone from the world, or outside the (hysteresis) exit area
      const leaves: number[] = [];
      for (const [eid, v] of c.visible) {
        const e = this.byId.get(eid);
        if (!e || !e.connected || !inAoi({ i: e.i, j: e.j }, centre, true)) {
          leaves.push(v.index);
          c.visible.delete(eid);
          c.slots[v.index] = 0;
          c.last[v.index] = undefined;
        }
      }

      // enters: nearest first, up to the per-client cap
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
            if (!inAoi({ i: e.i, j: e.j }, centre, false)) continue;
            const eu = toUW(e.i, e.j);
            cand.push({ e, d: (eu.u - u0) ** 2 + (eu.w - w0) ** 2 + e.id * 1e-9 });
          }
        }
      }
      cand.sort((a, b) => a.d - b.d);
      const enters: EnterEntity[] = [];
      for (const { e } of cand) {
        if (c.visible.size >= this.maxVisible) break;
        const index = c.slots.indexOf(0);
        if (index < 0) break;
        c.slots[index] = e.id;
        c.visible.set(e.id, { index, band: 0 });
        const qi = quantizePos(e.i);
        const qj = quantizePos(e.j);
        const hpPct = this.hpPct(e);
        const se = snapshotEntityOf(index, e, this.animOf(e), null);
        c.last[index] = { qi, qj, hp: hpPct, anim: se.anim, dir: se.dir };
        enters.push({
          index,
          entityId: e.id,
          kind: this.mobs?.kindOf(e.id) ?? 0,
          defId: this.mobs?.defIdOf(e.id) ?? 0,
          qi,
          qj,
          anim: se.anim,
          dir: se.dir,
          hpPct,
          maxHp: this.maxHpOf(e),
        });
      }

      // update-rate bands by tile distance to this player (D73): near 20 Hz, mid 10 Hz, far 5 Hz
      // in a crowd only the closest NEAR_MAX_ENTITIES keep the full rate; the rest of the near band drops to mid
      const ranked: { v: { band: number }; d: number; id: number }[] = [];
      for (const [eid, v] of c.visible) {
        const e = this.byId.get(eid)!;
        ranked.push({ v, d: Math.hypot(e.i - me.i, e.j - me.j), id: eid });
      }
      ranked.sort((x, y) => x.d - y.d || x.id - y.id);
      let nearUsed = 0;
      for (const { v, d } of ranked) {
        if (d > AOI.MID_BAND_TILES) v.band = 2;
        else if (d > AOI.NEAR_BAND_TILES || nearUsed >= AOI.NEAR_MAX_ENTITIES) v.band = 1;
        else {
          v.band = 0;
          nearUsed++;
        }
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
  private sendSnapshots(): void {
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
      const touched: { index: number; qi: number; qj: number; hp: number; anim: number; dir: number }[] = [];
      for (const [eid, v] of c.visible) {
        if (!resync && (this.world.tick + v.index) % BAND_PERIOD[v.band] !== 0) continue;
        const e = this.byId.get(eid);
        if (!e) continue;
        const last = c.last[v.index];
        const hp = this.hpPct(e);
        const se = snapshotEntityOf(v.index, e, this.animOf(e), !resync && last && last.hp === hp ? null : hp);
        // D73: nothing changed since the last record we sent for this slot -> the client keeps its state, send nothing
        if (
          !resync &&
          last &&
          se.hpPct === null &&
          last.qi === se.qi &&
          last.qj === se.qj &&
          last.anim === se.anim &&
          last.dir === se.dir
        )
          continue;
        entities.push(se);
        touched.push({ index: v.index, qi: se.qi, qj: se.qj, hp, anim: se.anim, dir: se.dir });
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
      for (const t of touched) c.last[t.index] = { qi: t.qi, qj: t.qj, hp: t.hp, anim: t.anim, dir: t.dir };
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
