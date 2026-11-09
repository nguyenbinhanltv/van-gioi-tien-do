import { AuthService, type AuthOptions } from './auth/accounts.js';
import { createGateway, type GatewayHandle, type GatewayOptions } from './gateway.js';
import { ChatService, type ChatOptions } from './chat/service.js';
import { PartyService } from './party/service.js';
import { TutorialService, type TutorialOptions } from './tutorial/service.js';
import { TelemetryService, type TelemetryOptions } from './telemetry/service.js';
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
  /** tutorial / FTUE tracker options, or `false` to run without it (default: enabled, in-memory store: D105) */
  tutorial?: TutorialOptions | false;
  /** telemetry pipeline options, or `false` to run without it (default: enabled, in-memory log and rollups: D109) */
  telemetry?: TelemetryOptions | false;
  /** bearer token for `/dashboard` (default: only loopback connections are served) */
  dashboardToken?: string;
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
  const telemetry =
    opts.telemetry === false ? undefined : (opts.world?.telemetry ?? new TelemetryService(opts.telemetry));
  const tutorial =
    opts.tutorial === false
      ? undefined
      : (opts.world?.tutorial ??
        new TutorialService({
          mapTiles: opts.world?.mapTiles,
          ...(telemetry ? { onEvent: (account, r) => telemetry.ftue(account, r) } : {}),
          ...opts.tutorial,
        }));
  const world = new WorldNode({
    ...opts.world,
    ...(progression ? { progression } : {}),
    ...(chat ? { chat } : {}),
    ...(party ? { party } : {}),
    ...(tutorial ? { tutorial } : {}),
    ...(telemetry ? { telemetry } : {}),
  });
  if (telemetry && world.inventory) telemetry.attachLedger(world.inventory.ledger);
  const gateway = createGateway(auth, world, {
    ...opts.gateway,
    ...(telemetry ? { telemetry } : {}),
    ...(opts.dashboardToken ? { dashboardToken: opts.dashboardToken } : {}),
  });
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
