/** Local dev entry: `PORT=8080 node <bundle>` (hosting is local-only for now, D27). */
import { InventoryService } from './world/inventory/index.js';
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
// COMBAT=1 turns on server-authoritative combat (D75), MOBS=1 spawns the monsters of the default zones (D74); both are off here by default
// (`npm run dev` turns them on). Combat with MOBS gives the player something to fight: the mob manager is the combat core's default MobPort.
// INVENTORY=1 (needs COMBAT) fills the killer's bag and wallet from mob drops (D77): in-memory only, lost on restart; there is no client view of it yet,
// so each grant is logged here.
const flag = (v: string | undefined): boolean => v === '1' || v === 'true';
const srv = await startServer({
  port,
  host: process.env.HOST ?? '127.0.0.1',
  gateway: { corsOrigins },
  world: {
    mapTiles,
    spawn: spawnSide ? { i0: centre, j0: centre, side: spawnSide } : undefined,
    mobs: flag(process.env.MOBS),
    combat: flag(process.env.COMBAT) ? {} : undefined,
    inventory: flag(process.env.INVENTORY) ? new InventoryService() : undefined,
  },
  auth: { registerPerIpPerDay },
  // DEV ONLY: PROGRESSION_SPEED=2000 makes tu vi accumulate 2000x faster (headless capture of the progression HUD)
  progression: process.env.PROGRESSION_SPEED ? { devTuViSpeed: Number(process.env.PROGRESSION_SPEED) } : undefined,
});
if (srv.world.dropSink)
  srv.world.dropSink.onGranted = (owner, e, r) =>
    console.log(
      `[vgtd/server] drops mob ${e.mobId} -> ${owner}: ` +
        [
          ...r.stones.map((s) => `${s.amount} ${s.currency}`),
          ...r.items.map((i) => `${i.qty}x item ${i.defId} q${i.quality} (${i.where})`),
        ].join(', '),
    );
console.log(`[vgtd/server] listening on ${srv.port} (HTTP auth + WS /ws), tick 20 Hz`);
