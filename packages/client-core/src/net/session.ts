/**
 * Online session: HTTP register/login -> WebSocket hello -> binary @vgtd/protocol frames. Engine-free: the browser
 * (or a test) injects `fetch`, a WebSocket constructor and a clock. The game loop calls `update(dtMs, intent)` every
 * frame and reads `selfPosition()` / `remotes(now)` to draw.
 */
import {
  ErrorCode,
  PROTOCOL_VERSION,
  decode,
  encode,
  type EnterEntity,
  type Message,
  type SelfState,
  type SkillResultMsg,
  type SnapshotEntity,
} from '@vgtd/protocol';
import { NETWORK } from '@vgtd/shared';
import type { CollisionGrid } from '@vgtd/sim';
import { IDLE_INTENT, Predictor, type MoveIntent } from './predictor.js';
import { RemoteWorld, type RemoteView } from './remote.js';

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
  private ws: SocketLike | null = null;
  private lastSnapshotSeq = 0;
  private acc = 0;
  private pingAt = 0;
  private readonly pings = new Map<number, number>();

  constructor(private readonly o: NetOptions) {
    this.remote = new RemoteWorld(o.interpDelayMs);
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
    this.ws?.close();
  }
}
