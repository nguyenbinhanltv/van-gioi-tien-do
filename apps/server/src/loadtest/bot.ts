/**
 * Headless bot client used by the load test and the integration tests. It speaks exactly what a real client speaks:
 * HTTP register/login -> WS hello -> binary input/skill_cast/ping, and decodes snapshots with the same
 * per-index baseline the server uses. Intent only: a bot can lie about time (speedhack) but never about position.
 */
import { WebSocket } from 'ws';
import { ErrorCode, decode, encode, type BaselinePos, type InputPacket, type Message } from '@vgtd/protocol';
import { NETWORK } from '@vgtd/shared';

export type BotKind = 'honest' | 'speedhack' | 'teleport';

export interface BotOptions {
  host: string;
  port: number;
  name: string;
  kind?: BotKind;
  /** input packets per second (PC 30, mobile 20) */
  inputHz?: number;
  /** keep walking inside this square (tile coords); omitted = wander freely */
  area?: { i0: number; j0: number; side: number };
  /** number of skills in the sim table (bots cast random ids) */
  skillCount?: number;
  /** deterministic behaviour stream */
  seed?: number;
  castEveryMs?: number;
  /** speedhack clock multiplier (declared input time / real time); 3 = three inputs per tick */
  speedFactor?: number;
}

export interface BotReport {
  name: string;
  kind: BotKind;
  entityId: number;
  /** payload bytes received after the measurement start */
  bytesIn: number;
  wireBytesIn: number;
  frames: number;
  snapshots: number;
  aoiEnter: number;
  aoiLeave: number;
  visibleSum: number;
  visibleSamples: number;
  visibleMax: number;
  rttMs: number[];
  /** highest displacement speed (tiles/s) seen over 1 s windows of self positions */
  maxSpeedTilesPerS: number;
  kicked: boolean;
  /** ms from measurement start to the kick (or null) */
  kickedAfterMs: number | null;
  errors: string[];
  castOk: number;
  castRejected: number;
  closedUnexpectedly: boolean;
}

const frameHeader = (n: number): number => (n < 126 ? 2 : n < 65536 ? 4 : 10);

/** mulberry-style tiny PRNG for bot behaviour only (not simulation) */
function behaviourRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function dirCode(di: number, dj: number): number {
  const a = Math.atan2(dj, di);
  const c = Math.round(((a / (2 * Math.PI)) * 256 + 256) % 256) % 256;
  return c === 255 ? 0 : c;
}

export class Bot {
  private ws!: WebSocket;
  private readonly kind: BotKind;
  private readonly inputHz: number;
  private readonly rnd: () => number;
  private readonly known = new Map<number, BaselinePos>();
  private readonly visible = new Set<number>();
  private seq = 0;
  private speedAcc = 0;
  private lastSnapshotSeq = 0;
  private recent: InputPacket[] = [];
  private dir = 0;
  private mag = 15;
  private nextTurnAt = 0;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private stopped = false;
  private self: { i: number; j: number } | null = null;
  private posWindow: { t: number; i: number; j: number } | null = null;
  private measuringFrom = 0;
  private nextCastAt = 0;
  private pings = new Map<number, number>();
  private nextPingAt = 0;
  /** skillId -> local time (ms) the skill is ready again, learned from skill_result */
  private readyLocal = new Map<number, number>();
  private serverTimeMs = 0;
  entityId = 0;
  readonly report: BotReport;

  constructor(private readonly o: BotOptions) {
    this.kind = o.kind ?? 'honest';
    this.inputHz = o.inputHz ?? 20;
    this.rnd = behaviourRng(o.seed ?? 1);
    this.report = {
      name: o.name,
      kind: this.kind,
      entityId: 0,
      bytesIn: 0,
      wireBytesIn: 0,
      frames: 0,
      snapshots: 0,
      aoiEnter: 0,
      aoiLeave: 0,
      visibleSum: 0,
      visibleSamples: 0,
      visibleMax: 0,
      rttMs: [],
      maxSpeedTilesPerS: 0,
      kicked: false,
      kickedAfterMs: null,
      errors: [],
      castOk: 0,
      castRejected: 0,
      closedUnexpectedly: false,
    };
  }

  private async post(path: string, body: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
    const r = await fetch(`http://${this.o.host}:${this.o.port}${path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    return { status: r.status, json: (await r.json()) as Record<string, unknown> };
  }

  /** Register (idempotent), log in, open the socket, say hello. Resolves after `hello_ack`. */
  async connect(password = 'correct horse battery'): Promise<void> {
    const reg = await this.post('/auth/register', { username: this.o.name, password });
    if (reg.status !== 201 && reg.status !== 409)
      throw new Error(`register failed: ${reg.status} ${JSON.stringify(reg.json)}`);
    const login = await this.post('/auth/login', { username: this.o.name, password });
    if (login.status !== 200) throw new Error(`login failed: ${login.status} ${JSON.stringify(login.json)}`);
    const token = login.json.token as string;
    await this.openSocket(token);
  }

  /** Open the socket with an explicit token (tests use this for bad-token cases). */
  openSocket(token: string, hello: Record<string, unknown> = {}): Promise<void> {
    return new Promise((resolve, reject) => {
      const ws = new WebSocket(`ws://${this.o.host}:${this.o.port}/ws`, { perMessageDeflate: false });
      this.ws = ws;
      ws.binaryType = 'nodebuffer';
      let acked = false;
      ws.on('open', () => ws.send(JSON.stringify({ type: 'hello', protocolMin: 1, protocolMax: 1, token, ...hello })));
      ws.on('message', (data, isBinary) => {
        if (!isBinary) {
          const m = JSON.parse(data.toString()) as { type?: string; entityId?: number };
          if (m.type === 'hello_ack') {
            acked = true;
            this.entityId = m.entityId ?? 0;
            this.report.entityId = this.entityId;
            resolve();
          }
          return;
        }
        const buf = data as Buffer;
        this.onBinary(new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength));
      });
      ws.on('error', (e) => {
        this.report.errors.push(String(e.message));
        if (!acked) reject(e);
      });
      ws.on('close', (code, reason) => {
        if (!acked) reject(new Error(`closed before hello_ack: ${code} ${reason.toString()}`));
        else if (!this.stopped && !this.report.kicked) this.report.closedUnexpectedly = true;
        this.closeInfo = { code, reason: reason.toString() };
      });
    });
  }

  closeInfo: { code: number; reason: string } | null = null;

  get socket(): WebSocket {
    return this.ws;
  }

  private onBinary(bytes: Uint8Array): void {
    const r = this.report;
    r.bytesIn += bytes.length;
    r.wireBytesIn += bytes.length + frameHeader(bytes.length);
    r.frames++;
    let msg: Message;
    try {
      msg = decode(bytes, { baseline: (i) => this.known.get(i) });
    } catch (e) {
      r.errors.push(`decode: ${(e as Error).message}`);
      return;
    }
    switch (msg.type) {
      case 'snapshot': {
        r.snapshots++;
        this.lastSnapshotSeq = msg.seq;
        this.serverTimeMs = msg.tick * NETWORK.TICK_MS;
        for (const e of msg.entities) this.known.set(e.index, { qi: e.qi, qj: e.qj });
        if (msg.self) this.onSelf(msg.self.i, msg.self.j);
        break;
      }
      case 'aoi_enter':
        for (const e of msg.entities) {
          this.known.set(e.index, { qi: e.qi, qj: e.qj });
          this.visible.add(e.index);
        }
        r.aoiEnter += msg.entities.length;
        break;
      case 'aoi_leave':
        for (const i of msg.indices) {
          this.known.delete(i);
          this.visible.delete(i);
        }
        r.aoiLeave += msg.indices.length;
        this.sampleVisible();
        break;
      case 'skill_result':
        if (msg.reason === 0) r.castOk++;
        else r.castRejected++;
        // an honest client waits for the cooldown the server reports
        this.readyLocal.set(msg.skillId, performance.now() + Math.max(0, msg.readyAtMs - this.serverTimeMs));
        break;
      case 'pong': {
        const t0 = this.pings.get(msg.clientTimeMs);
        if (t0 !== undefined) {
          r.rttMs.push(performance.now() - t0);
          this.pings.delete(msg.clientTimeMs);
        }
        break;
      }
      case 'error':
        r.errors.push(`server error ${msg.code}: ${msg.text}`);
        if (msg.code === ErrorCode.Kicked || msg.code === ErrorCode.RateLimited) {
          r.kicked = true;
          r.kickedAfterMs = performance.now() - this.measuringFrom;
        }
        break;
    }
  }

  private sampleVisible(): void {
    const n = this.visible.size;
    this.report.visibleSum += n;
    this.report.visibleSamples++;
    if (n > this.report.visibleMax) this.report.visibleMax = n;
  }

  private onSelf(i: number, j: number): void {
    this.self = { i, j };
    const now = performance.now();
    if (!this.posWindow) this.posWindow = { t: now, i, j };
    else if (now - this.posWindow.t >= 1000) {
      const d = Math.hypot(i - this.posWindow.i, j - this.posWindow.j);
      const v = d / ((now - this.posWindow.t) / 1000);
      if (v > this.report.maxSpeedTilesPerS) this.report.maxSpeedTilesPerS = v;
      this.posWindow = { t: now, i, j };
    }
  }

  /** Zero the counters (called once every bot is connected) so warm-up is excluded. */
  startMeasuring(): void {
    const r = this.report;
    r.bytesIn = r.wireBytesIn = r.frames = r.snapshots = r.aoiEnter = r.aoiLeave = 0;
    r.visibleSum = r.visibleSamples = r.visibleMax = 0;
    r.rttMs = [];
    r.maxSpeedTilesPerS = 0;
    r.castOk = r.castRejected = 0;
    this.measuringFrom = performance.now();
    this.posWindow = null;
  }

  // ------------------------------------------------------------------ behaviour
  private chooseDirection(nowMs: number): void {
    if (nowMs < this.nextTurnAt) return;
    this.nextTurnAt = nowMs + 1000 + this.rnd() * 2000;
    const a = this.o.area;
    if (a && this.self) {
      const margin = a.side * 0.1;
      const oi = this.self.i - a.i0;
      const oj = this.self.j - a.j0;
      if (oi < margin || oj < margin || oi > a.side - margin || oj > a.side - margin) {
        this.dir = dirCode(a.i0 + a.side / 2 - this.self.i, a.j0 + a.side / 2 - this.self.j);
        this.mag = 15;
        return;
      }
    }
    this.dir = this.rnd() < 0.15 ? 255 : Math.floor(this.rnd() * 255);
    this.mag = this.dir === 255 ? 0 : 15;
  }

  /** Start sending inputs. Drift-corrected so the long-run claimed time equals real time for honest bots. */
  startInputs(): void {
    const period = 1000 / this.inputHz;
    let next = performance.now() + period;
    const tick = (): void => {
      if (this.stopped) return;
      const now = performance.now();
      this.chooseDirection(now);
      let fresh = 1;
      if (this.kind === 'speedhack') {
        this.speedAcc += this.o.speedFactor ?? 3;
        fresh = Math.min(3, Math.floor(this.speedAcc));
        this.speedAcc -= fresh;
      }
      for (let k = 0; k < fresh; k++) {
        this.seq = (this.seq + 1) & 0xffff;
        this.recent.push({
          seq: this.seq,
          dtMs: this.kind === 'teleport' ? 250 : Math.round(NETWORK.TICK_MS),
          dir: this.dir,
          mag: this.mag,
          flags: 0,
        });
      }
      this.recent = this.recent.slice(-3);
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(encode({ type: 'input', ack: this.lastSnapshotSeq, inputs: this.recent }), { binary: true });
        if (now >= this.nextCastAt && (this.o.skillCount ?? 0) > 0) {
          this.nextCastAt = now + (this.o.castEveryMs ?? 1500) * (0.5 + this.rnd());
          const ready: number[] = [];
          for (let id = 0; id < this.o.skillCount!; id++) if ((this.readyLocal.get(id) ?? 0) <= now) ready.push(id);
          if (this.kind !== 'honest' || ready.length > 0) {
            const skillId = ready.length > 0 ? ready[Math.floor(this.rnd() * ready.length)]! : 0;
            this.ws.send(encode({ type: 'skill_cast', seq: this.seq, skillId, targetId: 0 }), { binary: true });
          }
        }
        if (now >= this.nextPingAt) {
          this.nextPingAt = now + 2000;
          const id = Math.floor(now) >>> 0;
          this.pings.set(id, now);
          this.ws.send(encode({ type: 'ping', clientTimeMs: id }), { binary: true });
        }
      }
      next += period;
      this.timer = setTimeout(tick, Math.max(0, next - performance.now()));
    };
    this.timer = setTimeout(tick, period);
    this.sampleTimer = setInterval(() => this.sampleVisible(), 100);
  }

  private sampleTimer: ReturnType<typeof setInterval> | null = null;

  stop(): void {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.sampleTimer) clearInterval(this.sampleTimer);
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close();
  }
}
