import { AuthService, type AuthOptions } from './auth/accounts.js';
import { createGateway, type GatewayHandle, type GatewayOptions } from './gateway.js';
import { ChatService, type ChatOptions } from './chat/service.js';
import { PartyService } from './party/service.js';
import { SectService } from './sect/service.js';
import type { SectStore } from './sect/store.js';
import { Ledger } from './world/inventory/ledger.js';
import { FriendService } from './friends/service.js';
import type { FriendStore } from './friends/store.js';
import { ProgressionService, type ProgressionOptions } from './progression/service.js';
import { WorldNode, type WorldNodeOptions } from './world/node.js';

export interface ServerOptions {
  port?: number;
  host?: string;
  auth?: AuthOptions;
  world?: WorldNodeOptions;
  /** tu vi / breakthrough module options, or `false` to run without it (default: enabled, in-memory store) */
  progression?: ProgressionOptions | false;
  /** chat options, or `false` to run without chat (default: enabled, in-memory) */
  chat?: ChatOptions | false;
  /** `false` to run without parties (default: enabled, in-memory, session-only: D93) */
  party?: false;
  /** NPC sect options (D98): the persistence store (default in memory), or `false` to run without the sect */
  sect?: { store?: SectStore; ledger?: Ledger } | false;
  /** friends options (D96): the persistence store (default in memory), or `false` to run without friends */
  friends?: { store?: FriendStore } | false;
  gateway?: GatewayOptions;
  /** start the 20 Hz loop (tests drive `world.tick()` themselves when false) */
  autoTick?: boolean;
}

export interface RunningServer {
  auth: AuthService;
  world: WorldNode;
  gateway: GatewayHandle;
  port: number;
  stop(): Promise<void>;
}

export async function startServer(opts: ServerOptions = {}): Promise<RunningServer> {
  const auth = new AuthService(opts.auth);
  const progression =
    opts.progression === false
      ? undefined
      : (opts.world?.progression ?? new ProgressionService({ seed: opts.world?.seed, ...opts.progression }));
  const chat = opts.chat === false ? undefined : (opts.world?.chat ?? new ChatService(opts.chat));
  const party = opts.party === false ? undefined : (opts.world?.party ?? new PartyService());
  // Cống hiến lives in the same ledger as the stones, so one durable `ledger.json` (D92) covers both. `sect.ledger` is the ledger of the
  // file stores (given by main.ts whenever STORE=file, with or without an inventory); when an inventory is also given it MUST be the same
  // object, or stones and Cống hiến would be booked in two ledgers and only one of them would be durable.
  if (opts.sect && opts.sect.ledger && opts.world?.inventory && opts.sect.ledger !== opts.world.inventory.ledger)
    throw new Error(
      'sect.ledger and world.inventory.ledger must be the same Ledger (one durable ledger for stones and Cống hiến)',
    );
  const sect =
    opts.sect === false
      ? undefined
      : (opts.world?.sect ??
        new SectService({
          ledger: opts.sect?.ledger ?? opts.world?.inventory?.ledger ?? new Ledger(),
          ...(opts.sect?.store ? { store: opts.sect.store } : {}),
        }));
  const friends =
    opts.friends === false
      ? undefined
      : (opts.world?.friends ??
        new FriendService({
          ...(opts.friends?.store ? { store: opts.friends.store } : {}),
          // friendship hangs on account ids; the directory is the auth store (usernames are stored lower-cased)
          directory: {
            idOf: (nameLower) => auth.store.byUsername(nameLower)?.id,
            nameOf: (id) => auth.store.byId(id)?.username,
          },
        }));
  const world = new WorldNode({
    ...opts.world,
    ...(progression ? { progression } : {}),
    ...(chat ? { chat } : {}),
    ...(party ? { party } : {}),
    ...(sect ? { sect } : {}),
    ...(friends ? { friends } : {}),
  });
  const gateway = createGateway(auth, world, opts.gateway);
  await new Promise<void>((resolve, reject) => {
    gateway.http.once('error', reject);
    gateway.http.listen(opts.port ?? 0, opts.host ?? '127.0.0.1', resolve);
  });
  if (opts.autoTick !== false) world.start();
  return {
    auth,
    world,
    gateway,
    port: gateway.port(),
    stop: async () => {
      world.stop();
      await gateway.close();
    },
  };
}
