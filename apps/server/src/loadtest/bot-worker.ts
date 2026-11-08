/** Worker thread: runs the whole bot fleet on its own event loop, away from the server's tick loop. */
import { parentPort, workerData } from 'node:worker_threads';
import { connectFleet, type BotFleet, type BotRunConfig } from './runner.js';

const port = parentPort!;
let fleet: BotFleet | null = null;

port.on('message', (m: { type: 'measure' | 'stop' }) => {
  if (!fleet) return;
  if (m.type === 'measure') fleet.startMeasuring();
  if (m.type === 'stop') {
    port.postMessage({ type: 'reports', reports: fleet.stop() });
    fleet = null;
  }
});

try {
  fleet = await connectFleet(workerData as BotRunConfig, (n) => port.postMessage({ type: 'progress', n }));
  port.postMessage({ type: 'connected' });
} catch (e) {
  port.postMessage({ type: 'failed', message: (e as Error).message });
}
