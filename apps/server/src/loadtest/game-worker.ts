/**
 * Worker thread of the P5 soak: hosts a slice of the gameplay bots on its own event loop (away from the server's tick loop). One shared 30 Hz
 * timer drives every bot of the slice. Messages in: `{type:'stats'}` -> `{type:'stats', bots}`, `{type:'stop'}` -> `{type:'stopped', bots}`.
 */
import { parentPort, workerData } from 'node:worker_threads';
import { GameBot, pathOfBot, socialPaced, type GameBotStats } from './game-bot.js';

export interface GameWorkerConfig {
  baseUrl: string;
  /** bot numbers this worker runs (they name the bot and pick its class) */
  from: number;
  to: number;
  roster: readonly string[];
  prefix: string;
  seed: number;
  area: { i0: number; j0: number; side: number };
  /** connect this many bots per second (login hashing is the expensive part) */
  connectPerS: number;
  /** divides the social cadence (chat / party / bag); 1 = realistic, smaller = more traffic per second (CI smoke) */
  socialPace: number;
}

const cfg = workerData as GameWorkerConfig;
const port = parentPort!;
const bots: GameBot[] = [];
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
let timer: NodeJS.Timeout | null = null;

const snapshot = (): GameBotStats[] => bots.map((b) => ({ ...b.stats }));

port.on('message', (m: { type: 'stats' | 'stop' }) => {
  if (m.type === 'stats') port.postMessage({ type: 'stats', bots: snapshot() });
  if (m.type === 'stop') {
    if (timer) clearInterval(timer);
    const out = snapshot();
    for (const b of bots) b.close();
    port.postMessage({ type: 'stopped', bots: out });
  }
});

try {
  for (let n = cfg.from; n < cfg.to; n++) {
    const bot = new GameBot({
      baseUrl: cfg.baseUrl,
      name: cfg.roster[n]!,
      path: pathOfBot(n),
      seed: cfg.seed * 1000 + n,
      area: cfg.area,
      roster: cfg.roster,
      profile: socialPaced(cfg.socialPace),
    });
    bots.push(bot);
  }
  // the driver starts first so connected bots already play while the rest still log in
  const t0 = performance.now();
  let last = t0;
  timer = setInterval(() => {
    const now = performance.now();
    const dt = Math.min(100, now - last);
    last = now;
    for (const b of bots) b.update(now - t0, dt);
  }, 33);
  const gap = 1000 / Math.max(0.1, cfg.connectPerS);
  for (const bot of bots) {
    await bot.connect();
    await sleep(gap);
  }
  port.postMessage({ type: 'connected', n: bots.length });
} catch (e) {
  port.postMessage({ type: 'failed', message: (e as Error).message });
}
