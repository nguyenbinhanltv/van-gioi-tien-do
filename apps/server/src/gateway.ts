/**
 * Gateway: HTTP auth endpoints (docs/25: credentials never travel over the WebSocket URL) plus the WebSocket entry.
 *
 *  POST /auth/register  {username,password,inviteCode?}  -> 201 {accountId}; with BETA_INVITE_ONLY (D111) `inviteCode` is required: 403 invite_invalid / 429 invite_limited
 *  POST /auth/login     {username,password}  -> 200 {token, accountId, sessionId, expiresAtS}
 *  OPTIONS *            -> 204 CORS preflight (only for origins in GatewayOptions.corsOrigins)
 *  GET  /health         -> 200 {ok, players, tick}
 *  WS   /ws             first frame (text JSON, within 5 s): {"type":"hello","protocolMin":5,"protocolMax":5,"token":"...","classId"?}
 *                       `classId` (D82, optional): class path id or wire id; used only when the character does not exist yet (the stored
 *                       class wins afterwards); an invalid value is refused with BadMessage
 *                       reply (text JSON): {"type":"hello_ack","entityId","serverTimeMs","tickHz","protocol","mapTiles","classId",...}
 *                       afterwards: binary @vgtd/protocol frames only.
 *
 * `hello` is JSON here because docs/24 only proposes its Protobuf layout; D70 records this skeleton choice.
 */
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';
import { DEFAULT_CLASS, NETWORK, parseClass, type PathId } from '@vgtd/shared';
import { ErrorCode, PROTOCOL_VERSION, encode } from '@vgtd/protocol';
import { AuthError, type AuthService } from './auth/accounts.js';
import { TokenError } from './auth/jwt.js';
import { GATEWAY_CONFIG } from './config.js';
import { WorldFullError, type ClientTransport, type WorldNode } from './world/node.js';

export interface GatewayHandle {
  http: Server;
  wss: WebSocketServer;
  port(): number;
  close(): Promise<void>;
}

function json(res: ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'content-length': Buffer.byteLength(data), ...headers });
  res.end(data);
}

async function readJson(req: IncomingMessage, limit = 4096): Promise<unknown> {
  const chunks: Buffer[] = [];
  let n = 0;
  for await (const ch of req) {
    const b = ch as Buffer;
    n += b.length;
    if (n > limit) throw new AuthError(400, 'too_large', 'request body too large');
    chunks.push(b);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch {
    throw new AuthError(400, 'bad_json', 'invalid JSON');
  }
}

function remoteIp(req: IncomingMessage): string {
  return req.socket.remoteAddress ?? 'unknown';
}

export interface GatewayOptions {
  helloTimeoutMs?: number;
  /** browser origins allowed to call the HTTP endpoints (the web client is served from another port); default none */
  corsOrigins?: readonly string[];
}

export function createGateway(auth: AuthService, world: WorldNode, opts: GatewayOptions = {}): GatewayHandle {
  const online = new Map<string, { ws: WebSocket; entityId: number; transport: ClientTransport }>();

  const cors = new Set(opts.corsOrigins ?? []);
  const http = createServer((req, res) => {
    void (async () => {
      try {
        const origin = req.headers.origin;
        if (origin && cors.has(origin)) {
          res.setHeader('access-control-allow-origin', origin);
          res.setHeader('vary', 'origin');
          res.setHeader('access-control-expose-headers', 'retry-after');
          if (req.method === 'OPTIONS') {
            res.setHeader('access-control-allow-methods', 'GET, POST, OPTIONS');
            res.setHeader('access-control-allow-headers', 'content-type');
            res.setHeader('access-control-max-age', '600');
            res.writeHead(204).end();
            return;
          }
        }
        if (req.method === 'GET' && req.url === '/health') {
          return json(res, 200, {
            ok: true,
            players: world.clients.size,
            tick: world.world.tick,
            inviteOnly: auth.inviteOnly,
          });
        }
        if (req.method === 'POST' && (req.url === '/auth/register' || req.url === '/auth/login')) {
          const body = (await readJson(req)) as { username?: unknown; password?: unknown; inviteCode?: unknown } | null;
          if (!body || typeof body !== 'object') throw new AuthError(400, 'bad_json', 'invalid JSON');
          if (req.url === '/auth/register') {
            const r = await auth.register(body.username, body.password, remoteIp(req), body.inviteCode);
            return json(res, 201, r);
          }
          const r = await auth.login(body.username, body.password, remoteIp(req));
          return json(res, 200, r);
        }
        json(res, 404, { error: 'not_found' });
      } catch (e) {
        if (e instanceof AuthError) {
          const headers: Record<string, string> = {};
          if (e.retryAfterS !== undefined) headers['retry-after'] = String(e.retryAfterS);
          return json(res, e.status, { error: e.code, message: e.message }, headers);
        }
        json(res, 500, { error: 'internal' });
      }
    })();
  });

  const wss = new WebSocketServer({
    server: http,
    path: '/ws',
    maxPayload: GATEWAY_CONFIG.MAX_FRAME_BYTES,
    perMessageDeflate: false, // docs/08 §8: no compression for snapshots
  });

  wss.on('connection', (ws) => {
    let entityId = 0;
    /** this connection's handle in the world: every call below is bound to it, never to the bare entity id (ids are recycled) */
    let transport: ClientTransport | undefined;
    let accountId = '';
    /** a fresh login is being completed (its class is being resolved): ignore any further hello on this socket */
    let joining = false;
    let authed: { accountId: string; sessionId: string; version: number } | undefined;
    const closeWith = (code: ErrorCode, text: string): void => {
      if (ws.readyState === ws.OPEN) {
        ws.send(encode({ type: 'error', code, text }), { binary: true });
        ws.close(1008, text.slice(0, 100));
      }
    };
    const makeTransport = (): ClientTransport => ({
      send: (bytes) => {
        if (ws.readyState === ws.OPEN) ws.send(bytes, { binary: true });
      },
      close: (code, text) => closeWith(code, text),
      buffered: () => ws.bufferedAmount,
    });
    const helloAck = (resumed: boolean, resumeToken: string | undefined): Record<string, unknown> => ({
      type: 'hello_ack',
      entityId,
      serverTimeMs: world.world.timeMs,
      tickHz: NETWORK.TICK_HZ,
      protocol: PROTOCOL_VERSION,
      mapTiles: world.ctx.grid.width,
      resumed,
      // single-use secret for the NEXT connection of this session, valid while the entity is held after a drop
      resumeToken: resumeToken ?? null,
      resumeHoldMs: world.resumeHoldMs,
      // class of the character as the server holds it (D82): the client builds its hotbar and body from THIS, not from what it asked for
      classId: world.classWireIdOf(entityId),
    });
    const helloTimer = setTimeout(() => {
      if (!entityId) ws.close(1008, 'hello timeout');
    }, opts.helloTimeoutMs ?? GATEWAY_CONFIG.HELLO_TIMEOUT_MS);

    ws.on('message', (data, isBinary) => {
      if (!entityId) {
        // handshake: exactly one text frame
        if (joining) return;
        if (isBinary) return closeWith(ErrorCode.Unauthorized, 'hello required');
        let hello: {
          type?: unknown;
          protocolMin?: unknown;
          protocolMax?: unknown;
          token?: unknown;
          /** D82: class path id or wire id the player asks for; only used when the character does not exist yet */
          classId?: unknown;
          resume?: { entityId?: unknown; token?: unknown } | null;
        };
        try {
          hello = JSON.parse(data.toString()) as typeof hello;
        } catch {
          return closeWith(ErrorCode.BadMessage, 'bad hello');
        }
        const resume = hello.resume && typeof hello.resume === 'object' ? hello.resume : null;
        if (hello.type !== 'hello' || (typeof hello.token !== 'string' && !resume))
          return closeWith(ErrorCode.BadMessage, 'bad hello');
        if (
          typeof hello.protocolMin !== 'number' ||
          typeof hello.protocolMax !== 'number' ||
          hello.protocolMin > PROTOCOL_VERSION ||
          hello.protocolMax < PROTOCOL_VERSION
        )
          return closeWith(ErrorCode.BadVersion, 'unsupported protocol');
        if (resume) {
          // resume of a held session (docs/24 section 4): the single-use resume token IS the credential (the access token may
          // have expired during a long session); a bad / expired token closes the socket and the client logs in again
          const rid = resume.entityId;
          const tr = makeTransport();
          const ok =
            typeof rid === 'number'
              ? world.resumePlayer(rid, resume.token, tr, (acc, stamp) => {
                  const st = stamp as { sessionId: string; version: number } | undefined;
                  return !!st && auth.isSessionCurrent(acc, st.sessionId, st.version);
                })
              : null;
          if (!ok || typeof rid !== 'number') return closeWith(ErrorCode.Unauthorized, 'resume rejected');
          transport = tr;
          entityId = rid;
          accountId = world.accountOf(rid) ?? '';
          clearTimeout(helloTimer);
          const prevLive = online.get(accountId);
          if (prevLive && prevLive.transport !== tr) setTimeout(() => prevLive.ws.terminate(), 1000).unref();
          online.set(accountId, { ws, entityId, transport });
          ws.send(JSON.stringify(helloAck(true, ok.token)));
          return;
        }
        try {
          authed = auth.authenticate(hello.token as string);
          accountId = authed.accountId;
        } catch (e) {
          const expired = e instanceof TokenError && e.code === 'expired';
          return closeWith(expired ? ErrorCode.SessionExpired : ErrorCode.Unauthorized, 'unauthorized');
        }
        if (hello.classId !== undefined && hello.classId !== null && parseClass(hello.classId) === null)
          return closeWith(ErrorCode.BadMessage, 'bad class');
        joining = true;
        void (async () => {
          // the class is a stored character property (D82): resolve it BEFORE the synchronous refuse / replace / add sequence below, so
          // that sequence keeps its existing atomicity (no await between replacing the old session and adding the new one)
          let classPath: PathId = parseClass(hello.classId) ?? DEFAULT_CLASS;
          if (world.progression) {
            try {
              classPath = await world.progression.resolveClass(accountId, hello.classId);
            } catch {
              return closeWith(ErrorCode.Internal, 'character storage error');
            }
          }
          if (ws.readyState !== ws.OPEN) return; // gone while the class was being resolved
          if (world.clients.size >= GATEWAY_CONFIG.MAX_PLAYERS) return closeWith(ErrorCode.ServerFull, 'server full');
          // refuse BEFORE replacing the older connection: a refused join must not also log the user out of the live session
          if (!world.canAcceptPlayer()) return closeWith(ErrorCode.ServerFull, 'server full');
          world.releaseSuspended(accountId); // a fresh login replaces a character still being held after a drop
          const prev = online.get(accountId);
          if (prev) {
            // one live connection per account: the newer login replaces the older
            world.removePlayer(prev.entityId, prev.transport);
            if (prev.ws.readyState === prev.ws.OPEN) {
              prev.ws.send(encode({ type: 'error', code: ErrorCode.Kicked, text: 'logged in elsewhere' }), {
                binary: true,
              });
              prev.ws.close(1008, 'replaced');
              // do not wait for a peer that never answers the close handshake
              setTimeout(() => prev.ws.terminate(), 1000).unref();
            }
          }
          clearTimeout(helloTimer);
          try {
            transport = makeTransport();
            entityId = world.addPlayer(transport, accountId, classPath, auth.usernameOf(accountId));
            world.stampSession(entityId, { sessionId: authed!.sessionId, version: authed!.version });
          } catch (e) {
            if (e instanceof WorldFullError) return closeWith(ErrorCode.ServerFull, 'server full');
            throw e;
          }
          online.set(accountId, { ws, entityId, transport });
          ws.send(JSON.stringify(helloAck(false, world.resumeTokenOf(entityId))));
        })()
          .catch(() => closeWith(ErrorCode.Internal, 'join failed'))
          .finally(() => {
            joining = false;
          });
        return;
      }
      if (!isBinary) return closeWith(ErrorCode.BadMessage, 'binary frames only');
      const buf = data as Buffer;
      world.receive(entityId, new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength), transport);
    });

    ws.on('close', (code) => {
      clearTimeout(helloTimer);
      if (entityId) {
        if (online.get(accountId)?.transport === transport) online.delete(accountId);
        // a deliberate close (1000, sent by `NetClient.close()`) leaves at once; any other end is a drop: hold the entity for a resume
        if (code === 1000 || !world.suspendPlayer(entityId, transport as ClientTransport))
          world.removePlayer(entityId, transport);
      }
    });
    ws.on('error', () => ws.terminate());
  });

  return {
    http,
    wss,
    port: () => {
      const a = http.address();
      return typeof a === 'object' && a ? a.port : 0;
    },
    close: () =>
      new Promise<void>((resolve) => {
        for (const c of wss.clients) c.terminate();
        wss.close(() => http.close(() => resolve()));
        http.closeAllConnections?.();
      }),
  };
}
