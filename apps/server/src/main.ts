/** Local dev entry: `PORT=8080 node <bundle>` (hosting is local-only for now, D27). */
import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
const srv = await startServer({ port, host: process.env.HOST ?? '127.0.0.1' });
console.log(`[vgtd/server] listening on ${srv.port} (HTTP auth + WS /ws), tick 20 Hz`);
