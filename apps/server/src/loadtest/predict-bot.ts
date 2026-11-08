/**
 * A bot that runs the REAL client netcode (client-core NetClient: prediction, reconciliation, interpolation) over a real
 * socket. Used by the bad-network scenario to measure what a player would see: how far the predicted position is from the
 * authoritative replay at every snapshot (`predictor.lastError`), and whether the session survives the impairment.
 */
import { WebSocket } from 'ws';
import { TileGrid } from '@vgtd/sim';
import { NetClient, type NetDeps } from '@vgtd/client-core/src/net/index.js';
import { dist, type Dist } from './stats.js';

export interface PredictBotReport {
  name: string;
  /** NetClient status at the end ('online' = survived) */
  status: string;
  lastError: string;
  snapshots: number;
  /** replay error (tiles) sampled at every snapshot that carried a self block */
  errorTiles: Dist;
  /** snapshots whose error exceeded the 0.15-tile "invisible" threshold of docs/08 section 5 */
  errorsOverSmall: number;
  /** snapshots whose error exceeded 2 tiles (the player would see a snap) */
  errorsOverSnap: number;
  /** other entities currently interpolated at the end */
  remotesSeen: number;
}

export interface PredictBotOptions {
  host: string;
  port: number;
  name: string;
  password: string;
  mapTiles: number;
  /** keep walking inside this square */
  area: { i0: number; j0: number; side: number };
  seed: number;
}

function rngOf(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export class PredictBot {
  readonly net: NetClient;
  private readonly errors: number[] = [];
  private timer: ReturnType<typeof setInterval> | null = null;
  private readonly rnd: () => number;
  private dir = 0;
  private mag = 15;
  private nextTurn = 0;
  private measuring = false;

  constructor(private readonly o: PredictBotOptions) {
    this.rnd = rngOf(o.seed);
    const deps: NetDeps = {
      fetch: (url, init) => fetch(url, init),
      WebSocket: WebSocket as unknown as NetDeps['WebSocket'],
      now: () => performance.now(),
    };
    this.net = new NetClient({
      baseUrl: `http://${o.host}:${o.port}`,
      username: o.name,
      password: o.password,
      deps,
      makeGrid: (n) => TileGrid.fromRows(Array.from({ length: n }, () => '.'.repeat(n))),
      events: {
        onSnapshot: (_tick, _ents, self) => {
          if (self && this.measuring) this.errors.push(this.net.predictor?.lastError ?? 0);
        },
      },
    });
  }

  async connect(): Promise<void> {
    await this.net.connect();
  }

  startMeasuring(): void {
    this.errors.length = 0;
    this.measuring = true;
  }

  /** ~60 fps game loop with a wandering intent */
  start(): void {
    let last = performance.now();
    this.timer = setInterval(() => {
      const now = performance.now();
      if (now >= this.nextTurn) {
        this.nextTurn = now + 1000 + this.rnd() * 2000;
        this.dir = this.rnd() < 0.15 ? 255 : Math.floor(this.rnd() * 255);
        this.mag = this.dir === 255 ? 0 : 15;
        const p = this.net.selfPosition();
        const a = this.o.area;
        if (p && (p.i < a.i0 + 3 || p.j < a.j0 + 3 || p.i > a.i0 + a.side - 3 || p.j > a.j0 + a.side - 3)) {
          const ang = Math.atan2(a.j0 + a.side / 2 - p.j, a.i0 + a.side / 2 - p.i);
          this.dir = Math.round(((ang / (2 * Math.PI)) * 256 + 256) % 256) % 255;
          this.mag = 15;
        }
      }
      this.net.update(now - last, { dir: this.dir, mag: this.mag, flags: 0 });
      last = now;
    }, 16);
  }

  report(): PredictBotReport {
    const e = this.errors;
    return {
      name: this.o.name,
      status: this.net.status,
      lastError: this.net.lastError,
      snapshots: this.net.snapshots,
      errorTiles: dist(e),
      errorsOverSmall: e.filter((x) => x > 0.15).length,
      errorsOverSnap: e.filter((x) => x > 2).length,
      remotesSeen: this.net.remotes().length,
    };
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.net.close();
  }
}
