/** Local dev entry: `PORT=8080 node <bundle>` (hosting is local-only for now, D27). */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { openFileStores } from './persistence/index.js';
import { InventoryService } from './world/inventory/index.js';
import { startServer } from './server.js';
import { parseTerrain, terrainGrid } from './world/terrain.js';

const port = Number(process.env.PORT ?? 8080);
// the Cocos web client is served from http://localhost:8456 (npm run serve -w client-cocos); override with CORS_ORIGINS=a,b
const corsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:8456,http://127.0.0.1:8456')
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
// STORE=file keeps accounts, characters (class, tu vi), bags and the stone ledger in DATA_DIR (default ./.vgtd-data, gitignored) so a restart
// keeps the players (D92); STORE=memory (default) is the old in-memory behaviour. Only password HASHES are written, never a password.
const storeKind = process.env.STORE ?? 'memory';
if (storeKind !== 'file' && storeKind !== 'memory')
  throw new Error(`STORE must be "file" or "memory", got "${storeKind}"`);
const stores =
  storeKind === 'file'
    ? openFileStores(process.env.DATA_DIR ?? join(process.cwd(), '.vgtd-data'), {
        onError: (e) => console.error('[vgtd/server] persistence write failed:', e),
      })
    : null;
// MAP_FILE=<terrain.json> (D95): the walkability grid the tile generator wrote, so water / lava block the server like they block the client
// (mobs spawn and walk on land, prediction sees the same obstacles). Default: an open map. A file that does not match MAP_TILES is refused.
let grid;
if (process.env.MAP_FILE) {
  const t = parseTerrain(JSON.parse(readFileSync(process.env.MAP_FILE, 'utf8')));
  if (mapTiles !== undefined && (t.width !== mapTiles || t.height !== mapTiles))
    throw new Error(`MAP_FILE is ${t.width}x${t.height} but MAP_TILES is ${mapTiles}`);
  grid = terrainGrid(t);
  console.log(
    `[vgtd/server] terrain from ${process.env.MAP_FILE}: ${t.width}x${t.height}, ${t.rows.join('').split('#').length - 1} blocked tiles`,
  );
}
const srv = await startServer({
  port,
  host: process.env.HOST ?? '127.0.0.1',
  gateway: { corsOrigins },
  world: {
    mapTiles,
    grid,
    spawn: spawnSide ? { i0: centre, j0: centre, side: spawnSide } : undefined,
    mobs: flag(process.env.MOBS),
    combat: flag(process.env.COMBAT) ? {} : undefined,
    inventory: flag(process.env.INVENTORY)
      ? new InventoryService(stores ? { store: stores.inventories, ledger: stores.ledger } : {})
      : undefined,
  },
  auth: { registerPerIpPerDay, ...(stores ? { store: stores.accounts } : {}) },
  // DEV ONLY: PROGRESSION_SPEED=2000 makes tu vi accumulate 2000x faster (headless capture of the progression HUD)
  progression: {
    ...(process.env.PROGRESSION_SPEED ? { devTuViSpeed: Number(process.env.PROGRESSION_SPEED) } : {}),
    ...(stores ? { store: stores.progression } : {}),
  },
});
if (stores) {
  console.log(`[vgtd/server] STORE=file: data in ${stores.dir}`);
  // online players' bags are saved when they leave; also save them every few seconds so a hard kill (npm run play stops its children
  // forcefully on Windows) loses seconds, not a whole session. Unchanged bags cost no disk write.
  setInterval(() => srv.world.inventory?.flushAll(), 5000).unref();
  // flush on a clean shutdown: let the gateway release its connections (they save their bags / progress), then write every document
  let closing = false;
  const shutdown = async (signal: string): Promise<void> => {
    if (closing) return;
    closing = true;
    console.log(`[vgtd/server] ${signal}: saving and stopping`);
    await srv.stop().catch(() => undefined);
    await new Promise((r) => setTimeout(r, 100));
    srv.world.inventory?.flushAll();
    stores.flush();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}
if (srv.world.dropSink)
  srv.world.dropSink.onGranted = (owner, e, r) =>
    console.log(
      `[vgtd/server] drops mob ${e.mobId} -> ${owner}: ` +
        [
          ...r.stones.map((s) => `${s.amount} ${s.currency}`),
          ...r.items.map((i) => `${i.qty}x item ${i.defId} q${i.quality} (${i.where})`),
        ].join(', '),
    );
// LOG_VIOLATIONS=1: print the anti-cheat violation counters whenever they change (debugging a client that gets kicked)
if (flag(process.env.LOG_VIOLATIONS)) {
  let last = '';
  setInterval(() => {
    const m = srv.world.metrics;
    const now = JSON.stringify({
      violations: m.violations,
      warns: m.warns,
      flags: m.flags,
      disconnects: m.disconnects,
    });
    if (now !== last) console.log(`[vgtd/server] anti-cheat ${now}`);
    last = now;
  }, 500).unref();
}
console.log(`[vgtd/server] listening on ${srv.port} (HTTP auth + WS /ws), tick 20 Hz`);
