/**
 * Online session: HTTP register/login -> WebSocket hello -> binary @vgtd/protocol frames. Engine-free: the browser
 * (or a test) injects `fetch`, a WebSocket constructor and a clock. The game loop calls `update(dtMs, intent)` every
 * frame and reads `selfPosition()` / `remotes(now)` to draw.
 */
import {
  ErrorCode,
  PROTOCOL_VERSION,
  LIMITS,
  decode,
  encode,
  type BreakthroughResultMsg,
  type CharStateMsg,
  type EnterEntity,
  type MeditateResultMsg,
  type InvResultMsg,
  type InvStateMsg,
  type Message,
  type SelfState,
  type SkillResultMsg,
  type SnapshotEntity,
} from '@vgtd/protocol';
import { NETWORK } from '@vgtd/shared';
import type { CollisionGrid } from '@vgtd/sim';
import { IDLE_INTENT, Predictor, type MoveIntent } from './predictor.js';
import { RemoteWorld, type RemoteView } from './remote.js';
import { BagModel, makeRequestId } from './bag.js';
import { TelegraphTracker, type TelegraphView } from './telegraphs.js';

/** The slice of the WebSocket API we use (browser WebSocket and `ws` both satisfy it). */
export interface SocketLike {
  binaryType: string;
  readyState: number;
  send(data: string | Uint8Array): void;
  close(code?: number, reason?: string): void;
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
}
export interface NetDeps {
  fetch: (
    url: string,
    init: { method: string; headers: Record<string, string>; body: string },
  ) => Promise<{
    status: number;
    json(): Promise<unknown>;
  }>;
  WebSocket: new (url: string) => SocketLike;
  now: () => number;
  /** timers for the reconnect loop; default: the global setTimeout / clearTimeout */
  setTimeout?: (fn: () => void, ms: number) => unknown;
  clearTimeout?: (handle: unknown) => void;
  /** random source for request ids (default `Math.random`; request ids are not simulation state) */
  random?: () => number;
}

/** `reconnecting`: the connection dropped and the client is trying to resume the session (or log in again). */
export type NetStatus = 'idle' | 'connecting' | 'online' | 'reconnecting' | 'closed';

/**
 * Callbacks for systems that follow the wire (server-driven combat, HUD, ...). They run synchronously inside the socket
 * handler, after `NetClient` has applied the message to its own state, so `entityOfIndex()` / `remote` already reflect it
 * (except `onAoiLeave`, see below). A throwing hook is caught and reported in `NetClient.lastError`; it never breaks the session.
 */
export interface NetEvents {
  onSkillResult?(msg: SkillResultMsg): void;
  onAoiEnter?(entities: readonly EnterEntity[]): void;
  /** Runs BEFORE the entities are dropped from `remote`, so `entityOfIndex(index)` still resolves each of them. */
  onAoiLeave?(indices: readonly number[]): void;
  /** `tick` is the simulation tick (x NETWORK.TICK_MS = server time); `entities` are the records in this snapshot only (unchanged ones are omitted, D73). */
  onSnapshot?(tick: number, entities: readonly SnapshotEntity[], self: SelfState | null): void;
  /** The connection dropped (before any reconnect attempt). */
  onConnectionLost?(): void;
  /**
   * The session is back after a drop. `resumed`: same character and entity id (the server held it); otherwise a fresh login (new
   * entity, maybe a new id). Runs after the client reset its own state (prediction, interpolation buffers, AOI slots): a layer that
   * keeps per-entity state (combat, HUD) should reset too, the server re-sends `aoi_enter` for everything in view.
   */
  onReconnect?(info: { resumed: boolean }): void;
}

export interface ReconnectOptions {
  /** give up after this long without a session (default 60 s) */
  maxMs?: number;
  /** pause before attempt n (the last value repeats); default 250, 500, 1000, 2000 ms */
  backoffMs?: readonly number[];
  /** treat the connection as dead after this long without any server frame while online (default 3 s; snapshots come every 50 ms) */
  staleMs?: number;
}

/**
 * Progression wire hooks (D76). A separate object on purpose: `NetClient.events` is replaced wholesale by systems that attach
 * later (combat), so progression listeners must not live there. Same safety rule: a throwing hook never breaks the session.
 */
export interface ProgressionEvents {
  onCharState?(msg: CharStateMsg): void;
  onMeditateResult?(msg: MeditateResultMsg): void;
  onBreakthroughResult?(msg: BreakthroughResultMsg): void;
}

/**
 * Inventory callbacks (D79), a SEPARATE object from `NetEvents` on purpose: the scene replaces `events` wholesale (combat attaches its own),
 * which would silently drop hooks living there. Set `net.inventoryEvents`; `net.bag` is always up to date whether or not anyone listens.
 */
export interface InventoryEvents {
  /** The bag changed: `net.bag` already holds the new state. */
  onInventory?(msg: InvStateMsg): void;
  /** The server answered an inventory command (`net.bag.lastResult` is set). */
  onInvResult?(msg: InvResultMsg): void;
}

export interface NetOptions {
  /** e.g. `http://localhost:8080` */
  baseUrl: string;
  username: string;
  password: string;
  deps: NetDeps;
  /** Class to create the character with on its first login: a class path id (`'kiem'`) or its wire id (D82). Ignored for an existing character. */
  classId?: string | number;
  /** builds the prediction grid from the map size the server announces in hello_ack */
  makeGrid: (mapTiles: number) => CollisionGrid;
  agi?: number;
  interpDelayMs?: number;
  events?: NetEvents;
  /** auto-reconnect after a drop (default on); `false` keeps the old behaviour: the session just ends */
  reconnect?: ReconnectOptions | false;
}

const WS_OPEN = 1;

interface HelloAck {
  /** class the server holds for this character (wire id 1..6, D82); 0 = the server did not say */
  classId: number;
  entityId: number;
  mapTiles: number;
  resumed: boolean;
  resumeToken: string | null;
  resumeHoldMs: number;
}

/** Server errors after which retrying is pointless (kicked / wrong protocol / full): the session ends for good. */
const FATAL_CODES = new Set<number>([ErrorCode.Kicked, ErrorCode.BadVersion, ErrorCode.ServerFull]);

/** Aim point (tile coordinates) -> wire quantization, clamped to 0..POS_MAX_Q; null when absent or not finite. */
function quantizeAim(aim: { i: number; j: number } | null): { qi: number; qj: number } | null {
  if (!aim || !Number.isFinite(aim.i) || !Number.isFinite(aim.j)) return null;
  const q = (v: number): number => Math.min(LIMITS.POS_MAX_Q, Math.max(0, Math.round(v * LIMITS.POS_SCALE)));
  return { qi: q(aim.i), qj: q(aim.j) };
}

export class NetClient {
  status: NetStatus = 'idle';
  /** why the session ended (server error text, close reason, ...) */
  lastError = '';
  entityId = 0;
  /** Class asked for at the next login (initially `NetOptions.classId`); the scene may set it after a picker, before `connect()`. */
  classRequest: string | number | undefined;
  /** class of the local character as the SERVER holds it (wire id 1..6; 0 until the first hello_ack, D82) */
  classId = 0;
  mapTiles = 0;
  readonly remote: RemoteWorld;
  predictor: Predictor | null = null;
  rttMs = 0;
  snapshots = 0;
  /** replaceable at any time (e.g. when combat is attached after the session started) */
  events: NetEvents;
  /** progression listeners (tu vi state, meditation / breakthrough answers); survives `events` being replaced */
  progressionEvents: ProgressionEvents = {};
  private ws: SocketLike | null = null;
  private lastSnapshotSeq = 0;
  private acc = 0;
  private pingAt = 0;
  private readonly pings = new Map<number, number>();
  /** single-use secret for the next connection of this session (valid while the server holds the entity after a drop) */
  private resumeToken: string | null = null;
  private resumeHoldMs = 0;
  private userClosed = false;
  private fatal = false;
  /** the server answered a resume `hello` with an Unauthorized error frame: the token is unknown / the hold is over */
  private resumeRejected = false;
  private lastRxMs = 0;
  private readonly telegraph = new TelegraphTracker();
  /** wall time of the previous `update()`: a gap means the client's OWN loop stalled, not the link */
  private lastUpdateMs = 0;
  private reconnecting = false;
  /** number of times the session came back after a drop (resumed or re-logged-in) */
  reconnects = 0;

  constructor(private readonly o: NetOptions) {
    this.remote = new RemoteWorld(o.interpDelayMs);
    this.classRequest = o.classId;
    this.bag = new BagModel();
    this.events = o.events ?? {};
  }

  private get rc(): Required<ReconnectOptions> | null {
    if (this.o.reconnect === false) return null;
    const r = this.o.reconnect ?? {};
    return { maxMs: r.maxMs ?? 60_000, backoffMs: r.backoffMs ?? [250, 500, 1000, 2000], staleMs: r.staleMs ?? 3000 };
  }

  private sleep(ms: number): Promise<void> {
    const set = this.o.deps.setTimeout ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    return new Promise((resolve) => set(resolve, ms));
  }

  /** Entity id behind a local (per-client) index, or undefined when that slot is empty. */
  entityOfIndex(index: number): number | undefined {
    return this.remote.entities.get(index)?.entityId;
  }

  private emit(fn: () => void): void {
    try {
      fn();
    } catch (e) {
      this.lastError = `hook: ${(e as Error).message}`;
    }
  }

  /** The visible bag (D79): updated from `inv_state` / `inv_result`, read by the bag panel. */
  readonly bag: BagModel;
  /** Callbacks for the bag (own object, see `InventoryEvents`). */
  inventoryEvents: InventoryEvents = {};

  /** Move bag slot `from` onto `to` (the server decides; the new state arrives as `inv_state`). False when the move is obviously invalid or the socket is not open. */
  sendBagMove(from: number, to: number): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    const cmd = this.bag.moveCmd(from, to, () => makeRequestId(this.o.deps.random ?? Math.random));
    if (!cmd) return false;
    ws.send(encode(cmd));
    return true;
  }
  /** Ask the server to move pending loot into the bag. False when nothing is pending or the socket is not open. */
  sendBagClaim(): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    const cmd = this.bag.claimCmd(() => makeRequestId(this.o.deps.random ?? Math.random));
    if (!cmd) return false;
    ws.send(encode(cmd));
    return true;
  }

  private async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const r = await this.o.deps.fetch(`${this.o.baseUrl}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: ((await r.json().catch(() => ({}))) as Record<string, unknown>) ?? {} };
  }

  /** Register (a taken name is fine: we then just log in), log in, open the socket, resolve after `hello_ack`. */
  async connect(): Promise<void> {
    this.status = 'connecting';
    this.userClosed = false;
    try {
      const ack = await this.login();
      this.adopt(ack, false);
    } catch (e) {
      this.status = 'closed';
      this.bag.reset();
      this.telegraph.clear();
      this.lastError = (e as Error).message;
      throw e;
    }
  }

  /** register-or-login over HTTP, then a fresh `hello` with the access token */
  private async login(): Promise<HelloAck> {
    const cred = { username: this.o.username, password: this.o.password };
    const reg = await this.post('/auth/register', cred);
    if (reg.status !== 201 && reg.status !== 409)
      throw new Error(`register: ${reg.status} ${String(reg.json.message ?? reg.json.error ?? '')}`);
    const login = await this.post('/auth/login', cred);
    if (login.status !== 200)
      throw new Error(`login: ${login.status} ${String(login.json.message ?? login.json.error ?? '')}`);
    // `classId` only matters for a character that does not exist yet; the server's stored class wins afterwards (D82)
    return this.openSocket({
      token: String(login.json.token),
      ...(this.classRequest !== undefined ? { classId: this.classRequest } : {}),
    });
  }

  /** Take over a (re)connected session: reset everything that belonged to the old connection and go online. */
  private adopt(ack: HelloAck, isReconnect: boolean): void {
    this.entityId = ack.entityId;
    this.classId = ack.classId;
    this.mapTiles = ack.mapTiles;
    this.resumeToken = ack.resumeToken;
    this.resumeHoldMs = ack.resumeHoldMs;
    // a new connection starts from the server's state: no stale prediction, interpolation buffers, baselines or acks
    this.predictor = new Predictor(this.o.makeGrid(ack.mapTiles), this.o.agi);
    this.remote.clear();
    this.bag.reset();
    this.telegraph.clear();
    this.lastSnapshotSeq = 0;
    this.acc = 0;
    this.pings.clear();
    this.lastRxMs = this.o.deps.now();
    this.fatal = false;
    this.status = 'online';
    if (isReconnect) {
      this.reconnects++;
      this.lastError = '';
      this.emit(() => this.events.onReconnect?.({ resumed: ack.resumed }));
    }
  }

  /** Open a socket and say `hello` (`{ token }` for a login, `{ resume: { entityId, token } }` for a resume); resolves on `hello_ack`. */
  private openSocket(hello: Record<string, unknown>): Promise<HelloAck> {
    return new Promise((resolve, reject) => {
      const url = `${this.o.baseUrl.replace(/^http/, 'ws')}/ws`;
      const ws = new this.o.deps.WebSocket(url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      let acked = false;
      ws.onopen = () =>
        ws.send(
          JSON.stringify({ type: 'hello', protocolMin: PROTOCOL_VERSION, protocolMax: PROTOCOL_VERSION, ...hello }),
        );
      ws.onmessage = (ev) => {
        if (ws !== this.ws) return; // a socket we already replaced
        if (typeof ev.data === 'string') {
          const m = JSON.parse(ev.data) as Partial<HelloAck> & { type?: string };
          if (m.type === 'hello_ack') {
            const mapTiles = m.mapTiles ?? 0;
            if (mapTiles <= 0) return reject(new Error('server did not announce mapTiles'));
            acked = true;
            resolve({
              classId: typeof m.classId === 'number' ? m.classId : 0,
              entityId: m.entityId ?? 0,
              mapTiles,
              resumed: m.resumed === true,
              resumeToken: typeof m.resumeToken === 'string' ? m.resumeToken : null,
              resumeHoldMs: m.resumeHoldMs ?? 0,
            });
          }
          return;
        }
        this.lastRxMs = this.o.deps.now();
        this.onBinary(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onerror = () => {
        if (!acked) reject(new Error('socket error'));
      };
      ws.onclose = (ev) => {
        if (!acked) reject(new Error(`closed before hello_ack: ${ev.code} ${ev.reason}`));
        if (ws !== this.ws) return; // closed because we replaced it
        this.onSocketClosed(ev);
      };
    });
  }

  private onSocketClosed(ev: { code: number; reason: string }): void {
    if (this.status === 'online') {
      // an unexpected drop of a live session: try to come back unless we were kicked / closed on purpose
      if (!this.userClosed && !this.fatal && this.rc) {
        this.lastError = `connection lost (${ev.code} ${ev.reason})`;
        this.bag.reset(); // belonged to the lost connection; the server re-sends state to the next one
        this.telegraph.clear();
        this.emit(() => this.events.onConnectionLost?.());
        void this.reconnectLoop();
        return;
      }
      this.status = 'closed';
      this.bag.reset();
      this.telegraph.clear();
      if (!this.lastError) this.lastError = `closed ${ev.code} ${ev.reason}`;
    }
  }

  /**
   * Come back after a drop: first RESUME the held session (same entity) while the server still holds it, otherwise log in
   * again with the stored credentials. Backs off between attempts and gives up after `maxMs`.
   */
  private async reconnectLoop(): Promise<void> {
    const rc = this.rc;
    if (!rc || this.reconnecting) return;
    this.reconnecting = true;
    this.status = 'reconnecting';
    const t0 = this.o.deps.now();
    let attempt = 0;
    try {
      while (!this.userClosed && this.o.deps.now() - t0 < rc.maxMs) {
        await this.sleep(rc.backoffMs[Math.min(attempt, rc.backoffMs.length - 1)]!);
        attempt++;
        if (this.userClosed) break;
        const canResume = this.resumeToken !== null && this.o.deps.now() - t0 < this.resumeHoldMs;
        this.resumeRejected = false;
        try {
          const ack = canResume
            ? await this.openSocket({ resume: { entityId: this.entityId, token: this.resumeToken } })
            : await this.login();
          this.adopt(ack, true);
          return;
        } catch (e) {
          this.lastError = `reconnect: ${(e as Error).message}`;
          // only an explicit rejection by the server burns the token; a network failure keeps it for the next attempt
          if (canResume && this.resumeRejected) this.resumeToken = null;
          if (this.fatal) break;
        }
      }
      if (!this.userClosed) this.lastError = `${this.lastError || 'connection lost'} (gave up reconnecting)`;
      this.status = 'closed';
      this.bag.reset();
      this.telegraph.clear();
    } finally {
      this.reconnecting = false;
    }
  }

  private onBinary(bytes: Uint8Array): void {
    let msg: Message;
    try {
      msg = decode(bytes, { baseline: this.remote.baseline });
    } catch (e) {
      this.lastError = `decode: ${(e as Error).message}`;
      return;
    }
    const now = this.o.deps.now();
    switch (msg.type) {
      case 'snapshot':
        this.snapshots++;
        this.lastSnapshotSeq = msg.seq;
        this.remote.onSnapshot(msg, now);
        if (msg.self) this.onSelf(msg.self);
        this.emit(() => this.events.onSnapshot?.(msg.tick, msg.entities, msg.self));
        break;
      case 'aoi_enter':
        this.remote.onEnter(msg, now);
        this.emit(() => this.events.onAoiEnter?.(msg.entities));
        break;
      case 'aoi_leave':
        this.emit(() => this.events.onAoiLeave?.(msg.indices)); // before removal: indices still resolve
        this.remote.onLeave(msg);
        break;
      case 'telegraph_start':
        this.telegraph.start(msg, now);
        break;
      case 'telegraph_end':
        this.telegraph.end(msg);
        break;
      case 'skill_result':
        this.emit(() => this.events.onSkillResult?.(msg));
        break;
      case 'char_state':
        this.emit(() => this.progressionEvents.onCharState?.(msg));
        break;
      case 'meditate_result':
        this.emit(() => this.progressionEvents.onMeditateResult?.(msg));
        break;
      case 'breakthrough_result':
        this.emit(() => this.progressionEvents.onBreakthroughResult?.(msg));
        break;
      case 'inv_state':
        this.bag.applyState(msg);
        this.emit(() => this.inventoryEvents.onInventory?.(msg));
        break;
      case 'inv_result':
        this.bag.applyResult(msg);
        this.emit(() => this.inventoryEvents.onInvResult?.(msg));
        break;
      case 'pong': {
        const t0 = this.pings.get(msg.clientTimeMs);
        if (t0 !== undefined) {
          this.rttMs = now - t0;
          this.pings.delete(msg.clientTimeMs);
        }
        break;
      }
      case 'error':
        this.lastError = `server: ${msg.text} (${ErrorCode[msg.code] ?? msg.code})`;
        if (FATAL_CODES.has(msg.code)) this.fatal = true; // kicked / wrong protocol: do not reconnect
        else if (msg.code === ErrorCode.Unauthorized && this.status === 'reconnecting') this.resumeRejected = true;
        break;
      default:
        break;
    }
  }

  private onSelf(self: SelfState): void {
    const p = this.predictor;
    if (!p) return;
    if (!p.ready) {
      // first sight of ourselves: adopt the server position
      p.reconcile(self);
      return;
    }
    p.reconcile(self);
  }

  /**
   * Call every frame. Emits one 50 ms input per elapsed tick (the same quantum the server steps with, so the claimed
   * time equals real time and the anti-cheat budget never trips), steps the prediction and sends the newest 1-3 inputs.
   */
  update(dtMs: number, intent: MoveIntent = IDLE_INTENT): void {
    const p = this.predictor;
    if (!p || this.status !== 'online') return;
    p.advance(dtMs);
    if (!p.ready) return;
    // a long stall must not turn into a burst of claimed time: drop whatever exceeds 3 ticks
    this.acc = Math.min(this.acc + dtMs, NETWORK.TICK_MS * 3 + 1);
    let sent = false;
    while (this.acc >= NETWORK.TICK_MS) {
      this.acc -= NETWORK.TICK_MS;
      if (p.push(intent, NETWORK.TICK_MS)) sent = true;
    }
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return;
    const now = this.o.deps.now();
    // If this loop itself was starved (busy tab / CPU-starved host) frames sat unread in the socket queue: silence we cannot
    // attribute to the link. Forgive the gap instead of tearing down a healthy connection.
    const rcStale = this.rc?.staleMs ?? 0;
    if (this.lastUpdateMs > 0 && rcStale > 0 && now - this.lastUpdateMs > rcStale / 2 && this.lastRxMs > 0) this.lastRxMs = now;
    this.lastUpdateMs = now;
    // half-open connection: the server sends a snapshot every tick, so silence means the link is dead
    const rc = this.rc;
    if (rc && this.lastRxMs > 0 && now - this.lastRxMs > rc.staleMs) {
      this.lastError = `no server frames for ${Math.round(now - this.lastRxMs)} ms`;
      this.emit(() => this.events.onConnectionLost?.());
      this.ws = null;
      ws.close();
      void this.reconnectLoop();
      return;
    }
    if (sent) ws.send(encode({ type: 'input', ack: this.lastSnapshotSeq, inputs: p.recent() }));
    if (now >= this.pingAt) {
      this.pingAt = now + 2000;
      const id = Math.floor(now) >>> 0;
      this.pings.set(id, now);
      ws.send(encode({ type: 'ping', clientTimeMs: id }));
    }
  }

  /**
   * Send a skill cast (wire v3). `aim` is in tile coordinates, quantized here to 1/32 tile and clamped to what the wire can carry (a pointer
   * past the map edge must not throw: the server re-validates reach anyway; a non-finite aim is dropped). Returns false when the socket is not open,
   * so the caller can refuse the cast locally instead of waiting for a `skill_result` that will never come.
   */
  sendSkillCast(m: { seq: number; skillId: number; targetId: number; aim: { i: number; j: number } | null }): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    ws.send(
      encode({
        type: 'skill_cast',
        seq: m.seq & 0xffff,
        skillId: m.skillId,
        targetId: m.targetId,
        aim: quantizeAim(m.aim),
      }),
    );
    return true;
  }

  /** Ask the server to start or stop meditation (D76). Returns false when the socket is not open. `requestId`: 32 lowercase hex characters. */
  sendMeditate(start: boolean, requestId: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    ws.send(encode({ type: start ? 'meditate_start' : 'meditate_stop', requestId }));
    return true;
  }

  /** Ask the server for a breakthrough attempt (D76); the server picks minor / major and rolls. False when the socket is not open. */
  sendBreakthrough(requestId: string): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    ws.send(encode({ type: 'breakthrough_start', requestId }));
    return true;
  }

  /** Where to draw the local character (prediction + decaying correction), or null before the first snapshot. */
  selfPosition(): { i: number; j: number } | null {
    return this.predictor?.display() ?? null;
  }

  /** Mob attack danger areas to draw this frame (D89); empty offline / when no mob is winding up near the player. */
  telegraphs(): TelegraphView[] {
    return this.telegraph.active(this.o.deps.now());
  }

  /** Other entities interpolated at the current time. */
  remotes(): RemoteView[] {
    return this.remote.sample(this.o.deps.now()).filter((r) => r.entityId !== this.entityId);
  }

  close(): void {
    this.userClosed = true;
    this.status = 'closed';
    this.bag.reset();
    this.telegraph.clear();
    this.ws?.close(1000, 'bye'); // a normal close: the server removes the character at once instead of holding it for a resume
  }
}
