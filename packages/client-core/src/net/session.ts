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
  type ChatHistoryMsg,
  type ChatMsgMsg,
  type ChatResultMsg,
  type FriendResultMsg,
  type FriendStateMsg,
  type MarketBuyMsg,
  type MarketCancelMsg,
  type MarketListMsg,
  type MarketNoticeMsg,
  type MarketResultMsg,
  type MarketResultsMsg,
  type MarketSearchMsg,
  type PartyInviteMsg,
  type TradeInviteMsg,
  type TradeResultMsg,
  type TradeStateMsg,
  type SectResultMsg,
  type SectStateMsg,
  type PartyResultMsg,
  type PartyStateMsg,
  type PartyVitalsMsg,
  type CharStateMsg,
  type DaoTamMsg,
  type EnterEntity,
  type MeditateResultMsg,
  type InvResultMsg,
  type InvStateMsg,
  type Message,
  type SelfState,
  type SkillResultMsg,
  type BossPhaseMsg,
  type MajorEventMsg,
  type TribulationStrikeMsg,
  type SelfStatus,
  type StatusUpdateMsg,
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
  /** a boss in view entered a new phase (D91): `phase` is the new phase index (>= 1); the boss is invulnerable for `transformMs` */
  onBossPhase?(msg: BossPhaseMsg): void;
  /** another player's root / slow / poison mask changed (D94); also readable through `statusMaskOf` */
  onStatusUpdate?(msg: StatusUpdateMsg): void;
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
  /** the Đạo Tâm that counts (D103); sent on join and whenever it changes */
  onDaoTam?(msg: DaoTamMsg): void;
  onMeditateResult?(msg: MeditateResultMsg): void;
  onBreakthroughResult?(msg: BreakthroughResultMsg): void;
}

/**
 * Major breakthrough callbacks (D97), a SEPARATE object from `NetEvents` (the scene replaces `events` wholesale). The Tâm Ma / Lôi Kiếp
 * overlay listens here; a throwing hook never breaks the session.
 */
export interface MajorEvents {
  onMajorEvent?(msg: MajorEventMsg): void;
  onTribulationStrike?(msg: TribulationStrikeMsg): void;
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

/**
 * Chat callbacks (D87), a SEPARATE object from `NetEvents` for the same reason as `InventoryEvents` / `ProgressionEvents`: the scene
 * replaces `events` wholesale. A throwing hook never breaks the session.
 */
export interface ChatEvents {
  /** One delivered line (any channel, own whispers echoed back). */
  onChatMsg?(msg: ChatMsgMsg): void;
  /** The World channel's recent lines, once after joining. */
  onChatHistory?(msg: ChatHistoryMsg): void;
  /** The answer to a `sendChat` (0 = delivered, otherwise why not). */
  onChatResult?(msg: ChatResultMsg): void;
}

/** Trade callbacks (D102), a separate object like the other cold-family hooks. A throwing hook never breaks the session. */
export interface TradeEvents {
  /** The trade window changed (phase Open), was closed (Closed) or executed (Done). */
  onTradeState?(msg: TradeStateMsg): void;
  /** Someone asked to trade with you. */
  onTradeInvite?(msg: TradeInviteMsg): void;
  /** The answer to a `sendTrade` (0 = done, otherwise why not). */
  onTradeResult?(msg: TradeResultMsg): void;
}

/** Sect callbacks (D98), a separate object like the other cold-family hooks. A throwing hook never breaks the session. */
export interface SectEvents {
  /** The whole picture (membership, Cống hiến, library of this class), after every change. */
  onSectState?(msg: SectStateMsg): void;
  /** The answer to a `sendSect` (0 = done, otherwise why not). */
  onSectResult?(msg: SectResultMsg): void;
}

/** Vạn Bảo Lâu callbacks (D112), a separate object like the other cold-family hooks. A throwing hook never breaks the session. */
export interface MarketEvents {
  /** A page of listings (the answer to a `market_search`). */
  onMarketResults?(msg: MarketResultsMsg): void;
  /** The answer to a list / buy / cancel (or a refused search). */
  onMarketResult?(msg: MarketResultMsg): void;
  /** One of your listings sold or expired. */
  onMarketNotice?(msg: MarketNoticeMsg): void;
}

/** Friends callbacks (D96), a separate object like the other cold-family hooks. A throwing hook never breaks the session. */
export interface FriendEvents {
  /** The whole picture (friends with online status, requests received / sent), after every change. */
  onFriendState?(msg: FriendStateMsg): void;
  /** The answer to a `sendFriend` (0 = done, otherwise why not). */
  onFriendResult?(msg: FriendResultMsg): void;
}

/** Party callbacks (D93), a separate object from `NetEvents` like the other cold-family hooks. A throwing hook never breaks the session. */
export interface PartyEvents {
  /** The roster changed (0 members = you are in no party). */
  onPartyState?(msg: PartyStateMsg): void;
  /** Members' HP / MP. */
  onPartyVitals?(msg: PartyVitalsMsg): void;
  /** Someone invited you. */
  onPartyInvite?(msg: PartyInviteMsg): void;
  /** The answer to a `sendParty` (0 = done, otherwise why not). */
  onPartyResult?(msg: PartyResultMsg): void;
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
  /** own status block as received (D94) with the receipt time, for `ownStatus` */
  private selfStatusAt: { status: SelfStatus; at: number } | null = null;
  /** other entities' status masks (`StatusBit` flags), from `status_update` */
  private readonly otherStatus = new Map<number, number>();
  rttMs = 0;
  snapshots = 0;
  /** replaceable at any time (e.g. when combat is attached after the session started) */
  events: NetEvents;
  /** progression listeners (tu vi state, meditation / breakthrough answers); survives `events` being replaced */
  progressionEvents: ProgressionEvents = {};
  majorEvents: MajorEvents = {};
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
  /** Callbacks for chat (own object, see `ChatEvents`). */
  chatEvents: ChatEvents = {};
  /** Callbacks for the party (own object, see `PartyEvents`). */
  partyEvents: PartyEvents = {};
  /** Callbacks for the direct trade (own object, see `TradeEvents`). */
  tradeEvents: TradeEvents = {};
  /** Callbacks for the NPC sect (own object, see `SectEvents`). */
  sectEvents: SectEvents = {};
  /** Callbacks for the friends list (own object, see `FriendEvents`). */
  friendEvents: FriendEvents = {};
  /** Callbacks for Vạn Bảo Lâu (own object, see `MarketEvents`). */
  marketEvents: MarketEvents = {};

  /** Move bag slot `from` onto `to` (the server decides; the new state arrives as `inv_state`). False when the move is obviously invalid or the socket is not open. */
  sendBagMove(from: number, to: number): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    const cmd = this.bag.moveCmd(from, to, () => makeRequestId(this.o.deps.random ?? Math.random));
    if (!cmd) return false;
    ws.send(encode(cmd));
    return true;
  }
  /** Use the item in bag slot `slot` (a pill; the server validates, applies the effect and consumes one unit). False when not usable or the socket is not open. */
  sendBagUse(slot: number): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    const cmd = this.bag.useCmd(slot, () => makeRequestId(this.o.deps.random ?? Math.random));
    if (!cmd) return false;
    ws.send(encode(cmd));
    return true;
  }
  /** Quick-use: use the first stack of item `key` in the bag (the key bound to a pill). False when there is none or the socket is not open. */
  sendBagQuickUse(key: string): boolean {
    const slot = this.bag.slotOfKey(key);
    return slot === null ? false : this.sendBagUse(slot);
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
      await this.login((ack) => this.adopt(ack, false));
    } catch (e) {
      this.status = 'closed';
      this.bag.reset();
      this.telegraph.clear();
      this.lastError = (e as Error).message;
      throw e;
    }
  }

  /** register-or-login over HTTP, then a fresh `hello` with the access token */
  private async login(onAck: (ack: HelloAck) => void): Promise<HelloAck> {
    const cred = { username: this.o.username, password: this.o.password };
    const reg = await this.post('/auth/register', cred);
    if (reg.status !== 201 && reg.status !== 409)
      throw new Error(`register: ${reg.status} ${String(reg.json.message ?? reg.json.error ?? '')}`);
    const login = await this.post('/auth/login', cred);
    if (login.status !== 200)
      throw new Error(`login: ${login.status} ${String(login.json.message ?? login.json.error ?? '')}`);
    // `classId` only matters for a character that does not exist yet; the server's stored class wins afterwards (D82)
    return this.openSocket(
      {
        token: String(login.json.token),
        ...(this.classRequest !== undefined ? { classId: this.classRequest } : {}),
      },
      onAck,
    );
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
    this.selfStatusAt = null;
    this.otherStatus.clear();
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
  /**
   * `onAck` runs SYNCHRONOUSLY inside the socket's message handler, before the next frame is delivered: the server sends `aoi_enter` and the
   * first snapshot right behind `hello_ack`, and `ws` can deliver them in the same turn, before any promise continuation runs. Adopting
   * the session only after `await` would wipe those frames (`adopt` resets the remote world) and the server never re-announces them.
   */
  private openSocket(hello: Record<string, unknown>, onAck: (ack: HelloAck) => void): Promise<HelloAck> {
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
            const ack: HelloAck = {
              classId: typeof m.classId === 'number' ? m.classId : 0,
              entityId: m.entityId ?? 0,
              mapTiles,
              resumed: m.resumed === true,
              resumeToken: typeof m.resumeToken === 'string' ? m.resumeToken : null,
              resumeHoldMs: m.resumeHoldMs ?? 0,
            };
            onAck(ack);
            resolve(ack);
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
          const onAck = (ack: HelloAck): void => this.adopt(ack, true);
          if (canResume) await this.openSocket({ resume: { entityId: this.entityId, token: this.resumeToken } }, onAck);
          else await this.login(onAck);
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
        for (const i of msg.indices) {
          // an entity that left the view has no known status: its mask-0 `status_update` may never reach us (D94)
          const id = this.entityOfIndex(i);
          if (id !== undefined) this.otherStatus.delete(id);
        }
        this.remote.onLeave(msg);
        break;
      case 'telegraph_start':
        this.telegraph.start(msg, now);
        break;
      case 'telegraph_end':
        this.telegraph.end(msg);
        break;
      case 'boss_phase':
        this.emit(() => this.events.onBossPhase?.(msg));
        break;
      case 'status_update':
        if (msg.mask === 0) this.otherStatus.delete(msg.entityId);
        else this.otherStatus.set(msg.entityId, msg.mask);
        this.emit(() => this.events.onStatusUpdate?.(msg));
        break;
      case 'skill_result':
        this.emit(() => this.events.onSkillResult?.(msg));
        break;
      case 'char_state':
        this.emit(() => this.progressionEvents.onCharState?.(msg));
        break;
      case 'dao_tam':
        this.emit(() => this.progressionEvents.onDaoTam?.(msg));
        break;
      case 'meditate_result':
        this.emit(() => this.progressionEvents.onMeditateResult?.(msg));
        break;
      case 'major_event':
        this.emit(() => this.majorEvents.onMajorEvent?.(msg));
        break;
      case 'tribulation_strike':
        this.emit(() => this.majorEvents.onTribulationStrike?.(msg));
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
      case 'chat_msg':
        this.emit(() => this.chatEvents.onChatMsg?.(msg));
        break;
      case 'chat_history':
        this.emit(() => this.chatEvents.onChatHistory?.(msg));
        break;
      case 'chat_result':
        this.emit(() => this.chatEvents.onChatResult?.(msg));
        break;
      case 'party_state':
        this.emit(() => this.partyEvents.onPartyState?.(msg));
        break;
      case 'party_vitals':
        this.emit(() => this.partyEvents.onPartyVitals?.(msg));
        break;
      case 'party_invite':
        this.emit(() => this.partyEvents.onPartyInvite?.(msg));
        break;
      case 'party_result':
        this.emit(() => this.partyEvents.onPartyResult?.(msg));
        break;
      case 'trade_state':
        this.emit(() => this.tradeEvents.onTradeState?.(msg));
        break;
      case 'trade_invite':
        this.emit(() => this.tradeEvents.onTradeInvite?.(msg));
        break;
      case 'trade_result':
        this.emit(() => this.tradeEvents.onTradeResult?.(msg));
        break;
      case 'sect_state':
        this.emit(() => this.sectEvents.onSectState?.(msg));
        break;
      case 'sect_result':
        this.emit(() => this.sectEvents.onSectResult?.(msg));
        break;
      case 'friend_state':
        this.emit(() => this.friendEvents.onFriendState?.(msg));
        break;
      case 'friend_result':
        this.emit(() => this.friendEvents.onFriendResult?.(msg));
        break;
      case 'market_results':
        this.emit(() => this.marketEvents.onMarketResults?.(msg));
        break;
      case 'market_result':
        this.emit(() => this.marketEvents.onMarketResult?.(msg));
        break;
      case 'market_notice':
        this.emit(() => this.marketEvents.onMarketNotice?.(msg));
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
    if (self.status) this.selfStatusAt = { status: self.status, at: this.o.deps.now() };
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

  /**
   * Send one chat line (D87). `channel` is a `ChatChannel`; `target` is the whisper recipient's name ('' for the other channels);
   * `clientMsgId` (uint16) comes back in the `chat_result`. Returns false when the socket is not open or the line cannot be encoded
   * (over 256 bytes, bad channel...): the caller shows its own refusal instead of waiting for an answer that will never come.
   */
  sendChat(m: { channel: number; text: string; target?: string; clientMsgId: number }): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(
        encode({
          type: 'chat_send',
          channel: m.channel,
          clientMsgId: m.clientMsgId & 0xffff,
          target: m.target ?? '',
          text: m.text,
        }),
      );
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Send one party command (D93): `op` is a `PartyOp`, `name` the other player (invite / kick) or the inviter (accept / decline, '' = the
   * newest). `clientMsgId` (uint16) comes back in the `party_result`. False when the socket is not open or the command cannot be encoded.
   */
  sendParty(m: { op: number; name?: string; clientMsgId: number }): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(encode({ type: 'party_cmd', op: m.op, clientMsgId: m.clientMsgId & 0xffff, name: m.name ?? '' }));
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Send one trade command (D102): `op` is a `TradeOp`. `name` = the other player (invite) or the inviter (accept / decline, '' = the newest);
   * `slot` / `qty` = a bag slot and a quantity for set-item (qty 0 takes the line out); `currency` / `amount` for set-stones. `clientMsgId` (uint16)
   * comes back in the `trade_result`. False when the socket is not open or the command cannot be encoded.
   */
  sendTrade(m: { op: number; clientMsgId: number; name?: string; slot?: number; qty?: number; currency?: number; amount?: number }): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(
        encode({
          type: 'trade_cmd',
          op: m.op,
          clientMsgId: m.clientMsgId & 0xffff,
          name: m.name ?? '',
          slot: m.slot ?? 0,
          qty: m.qty ?? 0,
          currency: m.currency ?? 0,
          amount: m.amount ?? 0,
        }),
      );
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Send one sect command (D98): `op` is a `SectOp` (join / leave at the sect NPC, buy a library manual: `manual` = its index in the
   * `sect_state` library). `clientMsgId` (uint16) comes back in the `sect_result`. False when the socket is not open or it cannot be encoded.
   */
  sendSect(m: { op: number; manual?: number; clientMsgId: number }): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(encode({ type: 'sect_cmd', op: m.op, clientMsgId: m.clientMsgId & 0xffff, manual: m.manual ?? 0 }));
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Send one friend command (D96): `op` is a `FriendOp`, `name` the other player (request / remove) or the requester (accept / decline,
   * '' = the oldest). `clientMsgId` (uint16) comes back in the `friend_result`. False when the socket is not open or it cannot be encoded.
   */
  sendFriend(m: { op: number; name?: string; clientMsgId: number }): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(encode({ type: 'friend_cmd', op: m.op, clientMsgId: m.clientMsgId & 0xffff, name: m.name ?? '' }));
    } catch {
      return false;
    }
    return true;
  }

  /**
   * Send one Vạn Bảo Lâu command (D112): a search, list, buy or cancel built by `MarketModel`. `clientMsgId` comes back in the answer.
   * False when the socket is not open or it cannot be encoded.
   */
  sendMarket(m: MarketSearchMsg | MarketListMsg | MarketBuyMsg | MarketCancelMsg): boolean {
    const ws = this.ws;
    if (!ws || ws.readyState !== WS_OPEN) return false;
    try {
      ws.send(encode(m));
    } catch {
      return false;
    }
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
  /** Own root / slow / poison time left now (ms, 0 = not active): the last status block counted down by the time since it arrived. */
  ownStatus(): { rootMs: number; slowMs: number; slowPct: number; poisonMs: number } {
    const s = this.selfStatusAt;
    if (!s) return { rootMs: 0, slowMs: 0, slowPct: 0, poisonMs: 0 };
    const el = Math.max(0, this.o.deps.now() - s.at);
    const left = (ms: number): number => Math.max(0, Math.round(ms - el));
    const slowMs = left(s.status.slowMs);
    return { rootMs: left(s.status.rootMs), slowMs, slowPct: slowMs > 0 ? s.status.slowPct : 0, poisonMs: left(s.status.poisonMs) };
  }

  /** Another player's `StatusBit` flags (0 = none known), from `status_update`. */
  statusMaskOf(entityId: number): number {
    return this.otherStatus.get(entityId) ?? 0;
  }

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
