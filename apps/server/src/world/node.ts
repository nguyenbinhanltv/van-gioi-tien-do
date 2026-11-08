/**
 * World Node skeleton (docs/08 §2, §4, §8): owns one `@vgtd/sim` world, steps it at a fixed 20 Hz, turns client
 * packets into sim inputs (never positions), runs the AOI at 10 Hz and sends per-client snapshots with distance bands.
 *
 * Clocks (`hrtime`, `setTimeout`) are used ONLY to schedule ticks and measure them; the simulation itself always
 * advances by the fixed `NETWORK.TICK_MS` (skill vgtd-sim-determinism).
 */
import { AOI, NETWORK, aoiCentre, inAoi, rngFloat, rngFork, rngSeed, toUW, type RngState } from '@vgtd/shared';
import {
  ErrorCode,
  ProtocolError,
  decode,
  encode,
  quantizePos,
  selfStateOf,
  snapshotEntityOf,
  type EnterEntity,
  type Message,
  type SnapshotEntity,
} from '@vgtd/protocol';
import {
  CastReason,
  TileGrid,
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
import { GATEWAY_CONFIG, WORLD_CONFIG } from '../config.js';
import { CombatSystem, type CombatOptions, type CombatResult } from './combat/index.js';

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
}

interface Client {
  id: number;
  accountId: string;
  transport: ClientTransport;
  inbox: SimInput[];
  lastRecvSeq: number | null;
  visible: Map<number, Visible>;
  /** slot -> entity id (0 = free) */
  slots: number[];
  /** slot -> last position/hp sent (delta baseline; the WebSocket delivers in order, so previous-sent is the baseline) */
  last: (Last | undefined)[];
  snapSeq: number;
  lastAckMs: number;
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
  /** Enable server-authoritative combat (D75). Omitted = the node only validates casts and answers `skill_result` with no hits. */
  combat?: CombatOptions;
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
  private spawnRng: RngState;
  private readonly spawn: { i0: number; j0: number; side: number };
  private readonly maxVisible: number;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private lastTickStart = 0;
  private byId = new Map<number, EntityState>();
  /** Combat core (cast resolution, HP, death / respawn, drops); null when the node was built without `opts.combat`. */
  readonly combat: CombatSystem | null;

  constructor(opts: WorldNodeOptions = {}) {
    const seed = opts.seed ?? 1;
    const n = opts.mapTiles ?? WORLD_CONFIG.DEFAULT_MAP_TILES;
    const grid = opts.grid ?? TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n)));
    this.ctx = { grid, skills: opts.skills ?? compileSkills() };
    this.world = createWorld(seed);
    this.spawnRng = rngFork(rngSeed(seed), 'spawn');
    this.spawn = opts.spawn ?? { i0: n / 2 - 48, j0: n / 2 - 48, side: 96 };
    this.maxVisible = opts.maxVisible ?? WORLD_CONFIG.MAX_VISIBLE;
    this.combat = opts.combat
      ? new CombatSystem(this.ctx, { seed, respawnPoint: () => this.spawnPoint(), ...opts.combat })
      : null;
  }

  // ------------------------------------------------------------------ players
  addPlayer(transport: ClientTransport, accountId: string): number {
    const id = this.nextId++;
    const at = this.spawnPoint();
    const stats = this.combat?.addPlayer(id);
    this.world = spawnEntity(this.world, {
      id,
      i: at.i,
      j: at.j,
      hp: stats?.hpMax ?? WORLD_CONFIG.PLAYER_MAX_HP,
      mpMax: stats?.mpMax ?? WORLD_CONFIG.PLAYER_MAX_MP,
    });
    this.clients.set(id, {
      id,
      accountId,
      transport,
      inbox: [],
      lastRecvSeq: null,
      visible: new Map(),
      slots: new Array<number>(this.maxVisible).fill(0),
      last: new Array<Last | undefined>(this.maxVisible).fill(undefined),
      snapSeq: 0,
      lastAckMs: this.world.timeMs,
      pktWindowStartMs: clock(),
      pktCount: 0,
      joinedTick: this.world.tick,
      dead: false,
      stats: emptyStats(),
    });
    return id;
  }

  /** A random point of the spawn region (join and respawn), drawn from the seeded `spawn` stream. */
  private spawnPoint(): { i: number; j: number } {
    const [a, r1] = rngFloat(this.spawnRng);
    const [b, r2] = rngFloat(r1);
    this.spawnRng = r2;
    return { i: this.spawn.i0 + a * this.spawn.side, j: this.spawn.j0 + b * this.spawn.side };
  }

  removePlayer(id: number): void {
    this.combat?.removePlayer(id);
    if (!this.clients.delete(id)) return;
    this.world = removeEntity(this.world, id);
  }

  statsOf(id: number): ClientStats | undefined {
    return this.clients.get(id)?.stats;
  }

  // ------------------------------------------------------------------ inbound
  /** Handle one binary frame from a client (already length-limited by the gateway). */
  receive(id: number, data: Uint8Array): void {
    const c = this.clients.get(id);
    if (!c || c.dead) return;
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
        c.inbox.push({
          kind: 'cast',
          entityId: c.id,
          seq: msg.seq,
          skillId: msg.skillId,
          targetId: msg.targetId,
          rttMs: 0,
        });
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

    const inputs: SimInput[] = [];
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
    this.byId = new Map(this.world.entities.map((e) => [e.id, e]));
    this.metrics.ticks++;
    this.handleEvents(r.events);
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
      if (!me || c.dead) continue;
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
        c.last[index] = { qi, qj, hp: hpPct };
        const se = snapshotEntityOf(index, e, this.animOf(e), null);
        enters.push({
          index,
          entityId: e.id,
          kind: 0,
          qi,
          qj,
          anim: se.anim,
          dir: se.dir,
          hpPct,
          maxHp: this.hpMaxOf(e),
        });
      }

      // bands for the update rate (docs/08 §2): near = on screen, far = beyond 80% of the radius
      for (const [eid, v] of c.visible) {
        const e = this.byId.get(eid)!;
        const eu = toUW(e.i, e.j);
        const fu = Math.abs(eu.u - u0) / AOI.HALF_U;
        const fw = Math.abs(eu.w - w0) / AOI.HALF_W;
        const f = Math.max(fu, fw);
        v.band = f > AOI.FAR_BAND_FRACTION ? 2 : f > 0.5 ? 1 : 0;
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

  /** Max HP of an entity: the combat profile's when combat is on, else the skeleton constant. */
  private hpMaxOf(e: EntityState): number {
    return this.combat?.maxHpOf(e.id) ?? WORLD_CONFIG.PLAYER_MAX_HP;
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

  private hpPct(e: EntityState): number {
    return Math.max(0, Math.min(127, Math.round((e.hp / this.hpMaxOf(e)) * 100)));
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
      if (!me || c.dead) continue;
      if (c.transport.buffered() > GATEWAY_CONFIG.BACKPRESSURE_SKIP_BYTES) {
        c.stats.snapshotsSkipped++;
        if (c.transport.buffered() > GATEWAY_CONFIG.BACKPRESSURE_KICK_BYTES) {
          this.metrics.kicksBackpressure++;
          this.kick(c, ErrorCode.Internal, 'slow consumer');
        }
        continue;
      }
      const full = this.world.timeMs - c.lastAckMs > WORLD_CONFIG.ACK_TIMEOUT_MS || c.snapSeq === 0;
      const entities: SnapshotEntity[] = [];
      const touched: { index: number; qi: number; qj: number; hp: number }[] = [];
      for (const [eid, v] of c.visible) {
        if ((this.world.tick + v.index) % BAND_PERIOD[v.band] !== 0) continue;
        const e = this.byId.get(eid);
        if (!e) continue;
        const last = c.last[v.index];
        const hp = this.hpPct(e);
        const se = snapshotEntityOf(v.index, e, this.animOf(e), last && last.hp === hp ? null : hp);
        entities.push(se);
        touched.push({ index: v.index, qi: se.qi, qj: se.qj, hp });
      }
      const seq = (c.snapSeq + 1) & 0xffff;
      const bytes = encode(
        {
          type: 'snapshot',
          seq,
          baselineSeq: full ? null : c.snapSeq & 0xffff,
          tick: this.world.tick,
          self: selfStateOf(me),
          entities,
        },
        { baseline: (index) => c.last[index] },
      );
      for (const t of touched) c.last[t.index] = { qi: t.qi, qj: t.qj, hp: t.hp };
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
