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
  /** random source for request ids (default `Math.random`; request ids are not simulation state) */
  random?: () => number;
}

export type NetStatus = 'idle' | 'connecting' | 'online' | 'closed';

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
  /** builds the prediction grid from the map size the server announces in hello_ack */
  makeGrid: (mapTiles: number) => CollisionGrid;
  agi?: number;
  interpDelayMs?: number;
  events?: NetEvents;
}

const WS_OPEN = 1;

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

  constructor(private readonly o: NetOptions) {
    this.remote = new RemoteWorld(o.interpDelayMs);
    this.bag = new BagModel();
    this.events = o.events ?? {};
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
    try {
      const cred = { username: this.o.username, password: this.o.password };
      const reg = await this.post('/auth/register', cred);
      if (reg.status !== 201 && reg.status !== 409)
        throw new Error(`register: ${reg.status} ${String(reg.json.message ?? reg.json.error ?? '')}`);
      const login = await this.post('/auth/login', cred);
      if (login.status !== 200)
        throw new Error(`login: ${login.status} ${String(login.json.message ?? login.json.error ?? '')}`);
      await this.openSocket(String(login.json.token));
      this.status = 'online';
    } catch (e) {
      this.status = 'closed';
      this.bag.reset();
      this.lastError = (e as Error).message;
      throw e;
    }
  }

  private openSocket(token: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const url = `${this.o.baseUrl.replace(/^http/, 'ws')}/ws`;
      const ws = new this.o.deps.WebSocket(url);
      this.ws = ws;
      ws.binaryType = 'arraybuffer';
      let acked = false;
      ws.onopen = () => ws.send(JSON.stringify({ type: 'hello', protocolMin: PROTOCOL_VERSION, protocolMax: PROTOCOL_VERSION, token }));
      ws.onmessage = (ev) => {
        if (typeof ev.data === 'string') {
          const m = JSON.parse(ev.data) as { type?: string; entityId?: number; mapTiles?: number };
          if (m.type === 'hello_ack') {
            this.entityId = m.entityId ?? 0;
            this.mapTiles = m.mapTiles ?? 0;
            if (this.mapTiles <= 0) return reject(new Error('server did not announce mapTiles'));
            this.predictor = new Predictor(this.o.makeGrid(this.mapTiles), this.o.agi);
            acked = true;
            resolve();
          }
          return;
        }
        this.onBinary(new Uint8Array(ev.data as ArrayBuffer));
      };
      ws.onerror = () => {
        if (!acked) reject(new Error('socket error'));
      };
      ws.onclose = (ev) => {
        if (!acked) reject(new Error(`closed before hello_ack: ${ev.code} ${ev.reason}`));
        if (this.status !== 'closed') {
          this.status = 'closed';
          this.bag.reset();
          if (!this.lastError) this.lastError = `closed ${ev.code} ${ev.reason}`;
        }
      };
    });
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
    if (sent) ws.send(encode({ type: 'input', ack: this.lastSnapshotSeq, inputs: p.recent() }));
    const now = this.o.deps.now();
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

  /** Other entities interpolated at the current time. */
  remotes(): RemoteView[] {
    return this.remote.sample(this.o.deps.now()).filter((r) => r.entityId !== this.entityId);
  }

  close(): void {
    this.status = 'closed';
    this.bag.reset();
    this.ws?.close();
  }
}
