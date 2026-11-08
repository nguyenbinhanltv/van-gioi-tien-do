/** Local dev entry: `PORT=8080 node <bundle>` (hosting is local-only for now, D27). */
import { startServer } from './server.js';

const port = Number(process.env.PORT ?? 8080);
// the Cocos web client is served from http://localhost:7456 (npm run serve -w client-cocos); override with CORS_ORIGINS=a,b
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:7456,http://127.0.0.1:7456')
  .split(',')
  .filter(Boolean);
// MAP_TILES must match the client map (apps/client-cocos draws a 256x256 map; 256 is also the server default); REGISTER_PER_IP_PER_DAY=0 lifts the
// anti-abuse registration cap for local multi-tab testing (default 3).
const mapTiles = process.env.MAP_TILES ? Number(process.env.MAP_TILES) : undefined;
const registerPerIpPerDay = process.env.REGISTER_PER_IP_PER_DAY
  ? Number(process.env.REGISTER_PER_IP_PER_DAY)
  : undefined;
// SPAWN_SIDE: side (tiles) of the square at the map centre where players spawn; default 96, `npm run dev` uses 24 so two
// local tabs start inside each other's AOI
const spawnSide = process.env.SPAWN_SIDE ? Number(process.env.SPAWN_SIDE) : undefined;
const centre = ((mapTiles ?? 256) - (spawnSide ?? 0)) / 2;
const srv = await startServer({
  port,
  host: process.env.HOST ?? '127.0.0.1',
  gateway: { corsOrigins },
  world: { mapTiles, spawn: spawnSide ? { i0: centre, j0: centre, side: spawnSide } : undefined },
  auth: { registerPerIpPerDay },
});
console.log(`[vgtd/server] listening on ${srv.port} (HTTP auth + WS /ws), tick 20 Hz`);
