# @vgtd/server

Gateway + World Node skeleton (P2-2, docs/08, docs/24, docs/25, DECISIONS D70). One Node process; the authoritative
simulation is `@vgtd/sim` stepped at a fixed 20 Hz, the wire format is `@vgtd/protocol`.

```
HTTP  POST /auth/register {username,password}   -> 201 {accountId}
HTTP  POST /auth/login    {username,password}   -> 200 {token, accountId, sessionId, expiresAtS}
HTTP  GET  /health
WS    /ws   first frame (JSON text, <= 5 s): {"type":"hello","protocolMin":2,"protocolMax":2,"token":"<jwt>"}
            reply (JSON text): {"type":"hello_ack","entityId","serverTimeMs","tickHz","protocol"}
            then binary @vgtd/protocol frames: client -> input (20-30 Hz, 1-3 inputs), skill_cast, ping
                                               server -> snapshot, aoi_enter, aoi_leave, skill_result, error, pong
```

## Layout

| Path                          | What                                                                                                                                                                                          |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/auth/`                   | scrypt hashing + policy, EdDSA JWT, `AuthService` (lockout, per-IP limits, bounded hash queue), in-memory `AccountStore`                                                                      |
| `src/gateway.ts`              | HTTP auth endpoints, WebSocket handshake (hello timeout, one live connection per account, frame cap)                                                                                          |
| `src/world/node.ts`           | `WorldNode`: input intake (dedup by seq), `step()`, AOI at 10 Hz, per-band snapshots, kicks, tick/phase metrics                                                                               |
| `src/world/combat/`           | `CombatSystem`: skill ownership, cast time, shapes, damage (shared formulas), HP / death / respawn, mob kills via `MobPort`, drops (D75, docs/34)                                             |
| `src/world/inventory/`        | inventory + drop sink (D77): bag, double-entry stone ledger, `InventoryService.grantDrops`, store seam, `DropSink` (combat `onDrops` -> the killer's bag, `INVENTORY=1`, on in `npm run dev`) |
| `src/world/inventory/sync.ts` | the visible bag (D79): `inv_state` out (one per tick), `inv_cmd` in (move / claim, request-id replay, rate limit), `inv_result`                                                               |
| `src/loadtest/`               | headless `Bot` (speaks the real protocol), fleet runner, report (`summarize`/`formatReport`), CLI + worker thread                                                                             |
| `scripts/loadtest.mjs`        | bundles the TS entry with esbuild into `node_modules/.vgtd-loadtest/` and runs it                                                                                                             |
| `src/config.ts`               | server-only tunables (auth limits, frame/rate limits, visible cap). Network/AOI/tick constants come from `@vgtd/shared`.                                                                      |

`src/progression/` (D76) holds the tu vi module: `ProgressionService` (meditation, minor/major breakthrough, seeded rolls, anti-abuse,
idempotent `requestId`), pure rules in `state.ts` (all numbers from `@vgtd/shared`, docs/07 §2 §5), and the `ProgressionStore` / `RollLog`
persistence ports with in-memory implementations (docs/23). `WorldNode` takes it as `WorldNodeOptions.progression` (`startServer` enables
it by default) and only forwards inputs, casts, the six progression messages and the 20 Hz tick to it.

Server authority: clients send **intent only** (direction, magnitude, flags, declared dt). Positions, cooldowns, MP and
range/LOS are decided by `@vgtd/sim`; over-budget inputs are held, `dt` outside 8-50 ms is penalised, and the suspicion
score disconnects speedhackers (docs/08 §6). Clocks (`hrtime`, `setTimeout`) only schedule and measure ticks; the sim
always advances by the fixed 50 ms.

## Run

```bash
PORT=8080 node ...            # see src/main.ts (local-only hosting, D27)
npm test -w @vgtd/server      # auth, world node, gateway integration, load-test smoke
npm run loadtest -w @vgtd/server -- --bots 100
```

Load-test options: `--bots N` (default 100) `--duration S` (30) `--warmup S` (3) `--area TILES` (96, spawn/walk square;
smaller = denser) `--input-hz HZ` (20) `--speedhackers N` `--speed-factor X` (3; try 1.3 for a subtle clock hack)
`--teleporters N` (sends declared dt = 250 ms) `--seed N` `--json`. Exit code 1 if any P2 criterion fails.
(`-w server` does not resolve: the package follows the `@vgtd/<name>` convention, so use `-w @vgtd/server` or `-w apps/server`.)

The server runs in the main thread; all bots run in one worker thread (own event loop) over loopback. Bandwidth is
counted at the WebSocket frame layer (payload + 2/4/10 B header), **not** TCP/IP/TLS.

### Soak (P5)

`npm run soak -w @vgtd/server -- --preset smoke` runs 100 gameplay bots for 25 minutes on the real stack (file store, backups every
5 minutes in a separate process) and exits non-zero when a threshold is crossed: heap / RSS growth slope, tick p99 over budget,
`journal.json` not compacting, a failed / slow / unverifiable backup. `--preset full` is the 24 h run for a dedicated machine
(never in CI). Each sample records tick p50 / p99, event-loop lag, RSS / heap, file-store sizes and backup duration into
`samples.csv` / `samples.jsonl` / `summary.json` / `report.txt` under `--out`. Runbook: `docs/35-p5-load-test.md` section 6.

## Measured against the P2 exit criteria (docs/10 §12)

Windows 11 dev box (shared with other agent sessions), Node 24, 100 honest bots, 20 Hz input, 30 s window after 3 s
warm-up, bots + server on the same machine. Numbers vary run to run; `npm run loadtest` reproduces them.

| Criterion                               | Target    | Default density (area 96)                | Dense (area 48, ~90 visible)             |
| --------------------------------------- | --------- | ---------------------------------------- | ---------------------------------------- |
| 100 CCU stable                          | no drops  | 100/100 connected, 0 kicks               | 100/100 connected, 0 kicks               |
| Tick duration p99                       | <= 40 ms  | **7.4 ms** (p50 3.7, max 26)             | **8.9 ms** (p50 5.5, max 10)             |
| Downstream per player (worst, WS frame) | <= 8 KB/s | **3.4 KB/s** (mean 2.8)                  | **7.0 KB/s** (mean 6.1)                  |
| AOI measurable                          | reported  | 39.7 visible mean (max 74), ~2.2 enter/s | 90.3 visible mean (max 99), ~2.0 enter/s |
| Speedhack / teleport blocked            | blocked   | see below                                |                                          |
| Server CPU                              | -         | ~22% of one core, RSS ~190 MB            | ~25% of one core, RSS ~284 MB            |

Upstream is 0.4 KB/s per player; snapshots go out at 20/s per player. Tick time is dominated by snapshot encode + socket
writes (~2.8-4 ms mean for 100 clients); the sim step is ~0.35 ms and the AOI pass ~1.5-2 ms per AOI tick.

Cheaters (100 honest + 3 speedhack at 1.3x clock + 3 teleport with dt = 250 ms): all 6 disconnected (speedhack after ~11 s,
teleport after ~5 s), honest players unaffected, and the speedhackers' observed speed never exceeded honest walk speed
(4.55 vs 4.55 tiles/s). A 3x-clock speedhack is kicked within ~0.4 s (queue overflow).

Caveats, also recorded in `docs/OPEN-ITEMS.md`: one earlier run on a busier machine showed a single 122 ms tick (p99 was
still 31 ms), so p99 depends on host load; loopback means no real network latency/jitter; the Windows timer makes the
measured tick _interval_ jitter (p50 ~47 ms, p99 ~63 ms) while the simulation time stays exactly 50 ms/tick.

## Telemetry và dashboard KPI (D109)

Server ghi sự kiện giả danh (không PII, `player_pid` = HMAC của account id) theo danh mục đóng `TELEMETRY_EVENTS` (`@vgtd/shared`), lưu cục bộ (log JSON-lines 90 ngày + `rollups.json`; với `STORE=file` nằm trong `<DATA_DIR>/telemetry/`, kèm `pid.key` mode 0600). Trang KPI: `http://127.0.0.1:<port>/dashboard` (JSON: `/dashboard/summary.json`): CCU, DAU, phễu FTUE, giữ chân D1 / D7 / D30, kinh tế từ sổ cái. Chỉ loopback được xem nếu không đặt `DASHBOARD_TOKEN`; có token thì gửi `Authorization: Bearer` (hoặc mở `/dashboard#token=...`). Xem thử với dữ liệu giả: `npm run dashboard:demo -w @vgtd/server` (thêm `-- --check` để mở bằng Chrome thật và kiểm trang).
