import { AuthService, type AuthOptions } from './auth/accounts.js';
import { createGateway, type GatewayHandle, type GatewayOptions } from './gateway.js';
import { ChatService, type ChatOptions } from './chat/service.js';
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
  const world = new WorldNode({
    ...opts.world,
    ...(progression ? { progression } : {}),
    ...(chat ? { chat } : {}),
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
