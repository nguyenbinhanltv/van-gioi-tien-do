import { AuthService, type AuthOptions } from './auth/accounts.js';
import { createGateway, type GatewayHandle, type GatewayOptions } from './gateway.js';
import { ChatService, type ChatOptions } from './chat/service.js';
import { PartyService } from './party/service.js';
import { FriendService } from './friends/service.js';
import type { FriendStore } from './friends/store.js';
import { QuestService, type QuestSectPort } from './quests/service.js';
import type { QuestStore } from './quests/store.js';
import { WORLD_CONFIG } from './config.js';
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
  /** friends options (D96): the persistence store (default in memory), or `false` to run without friends */
  friends?: { store?: FriendStore } | false;
  /** quests options (D107): store (default in memory), wall clock (default `Date.now`), sect port; `false` = no quests. Needs inventory + progression. */
  quests?: { store?: QuestStore; clock?: () => number; sect?: QuestSectPort } | false;
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
  const inventory = opts.world?.inventory;
  const quests =
    opts.quests === false || !inventory || !progression
      ? undefined
      : (opts.world?.quests ??
        new QuestService({
          ...(opts.quests?.store ? { store: opts.quests.store } : {}),
          ...(opts.quests?.sect ? { sect: opts.quests.sect } : {}),
          inventory,
          clock: opts.quests?.clock ?? (() => Date.now()),
          mapTiles: opts.world?.mapTiles ?? WORLD_CONFIG.DEFAULT_MAP_TILES,
        }));
  const world = new WorldNode({
    ...opts.world,
    ...(progression ? { progression } : {}),
    ...(chat ? { chat } : {}),
    ...(party ? { party } : {}),
    ...(friends ? { friends } : {}),
    ...(quests ? { quests } : {}),
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
