/**
 * TCP impairment proxy for the "bad network" scenario (docs/28 S6). Sits between the bots and the gateway and delays every
 * chunk of every connection (HTTP and WebSocket alike):
 *
 *  - `delayMs`   fixed one-way latency (300 ms RTT = 150 each way)
 *  - `jitterMs`  uniform +-jitter added per chunk (80 ms jitter = 80)
 *  - `lossPct`   WebSocket runs on TCP, where a lost packet is not lost but retransmitted: with this probability a chunk is
 *                held back an extra `rtoMs` (retransmission timeout), which also stalls everything behind it
 *                (head-of-line blocking). That is what the application sees of packet loss.
 *
 * Delivery order is always preserved (a later chunk never overtakes an earlier one), exactly like TCP.
 * Deterministic for a seed. Not a kernel-level emulator: no bandwidth cap, no real congestion control.
 */
import { createConnection, createServer, type Server, type Socket } from 'node:net';

export interface Impairment {
  delayMs: number;
  jitterMs: number;
  lossPct: number;
  rtoMs: number;
}

/** docs/28 S6: 5 % loss, 300 ms RTT, 80 ms jitter (RTO 300 ms ~ one RTT + margin). */
export const S6_IMPAIRMENT: Impairment = { delayMs: 150, jitterMs: 80, lossPct: 5, rtoMs: 300 };

export interface ImpairProxy {
  port: number;
  /** chunks that were held back for a simulated retransmission, and total chunks */
  stats: { chunks: number; stalled: number };
  close(): Promise<void>;
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

/**
 * One direction of one connection. Chunks go into ONE FIFO queue with their delivery time and a single timer drains the
 * head in order: separate setTimeout()s with slightly different delays can fire out of order (Node groups timers by
 * duration), which would reorder the byte stream and corrupt the WebSocket framing, something TCP never does.
 */
function delayedPipe(from: Socket, to: Socket, imp: Impairment, rnd: () => number, stats: ImpairProxy['stats']): void {
  const queue: { due: number; chunk: Buffer }[] = [];
  let lastDue = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let ended = false;
  const drain = (): void => {
    timer = null;
    const now = performance.now();
    while (queue.length > 0 && queue[0]!.due <= now) {
      const { chunk } = queue.shift()!;
      if (!to.destroyed) to.write(chunk);
    }
    if (queue.length > 0) timer = setTimeout(drain, Math.max(1, Math.ceil(queue[0]!.due - performance.now())));
    else if (ended) to.end();
  };
  from.on('data', (chunk: Buffer) => {
    stats.chunks++;
    let d = imp.delayMs + (rnd() * 2 - 1) * imp.jitterMs;
    if (rnd() * 100 < imp.lossPct) {
      d += imp.rtoMs;
      stats.stalled++;
    }
    const due = Math.max(lastDue, performance.now() + Math.max(0, d));
    lastDue = due;
    queue.push({ due, chunk });
    if (!timer) timer = setTimeout(drain, Math.max(1, Math.ceil(due - performance.now())));
  });
  const finish = (): void => {
    ended = true;
    if (queue.length === 0 && !timer) to.end();
  };
  from.on('end', finish);
  from.on('close', finish);
  from.on('error', () => to.destroy());
}

export function startImpairProxy(
  targetHost: string,
  targetPort: number,
  imp: Impairment,
  seed = 1,
): Promise<ImpairProxy> {
  const rnd = rngOf(seed);
  const stats = { chunks: 0, stalled: 0 };
  const sockets = new Set<Socket>();
  const server: Server = createServer((client) => {
    const up = createConnection({ host: targetHost, port: targetPort });
    sockets.add(client);
    sockets.add(up);
    for (const s of [client, up]) {
      s.setNoDelay(true);
      s.on('close', () => sockets.delete(s));
    }
    delayedPipe(client, up, imp, rnd, stats);
    delayedPipe(up, client, imp, rnd, stats);
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const a = server.address();
      resolve({
        port: typeof a === 'object' && a ? a.port : 0,
        stats,
        close: () =>
          new Promise<void>((done) => {
            for (const s of sockets) s.destroy();
            server.close(() => done());
          }),
      });
    });
  });
}
