/** Server-only tunables (network/AOI/tick constants come from @vgtd/shared). docs/25 and docs/24 §4 give the auth values. */
export const AUTH_CONFIG = {
  USERNAME_RE: /^[a-z0-9_]{3,20}$/,
  PASSWORD_MIN: 10,
  PASSWORD_MAX: 128,
  /** access token lifetime (docs/25 §3.1) */
  ACCESS_TOKEN_TTL_S: 600,
  CLOCK_SKEW_S: 60,
  /** consecutive failures before a progressive lock (docs/25 §2.4): 1 -> 5 -> 15 -> 60 minutes */
  LOCK_AFTER_FAILURES: 5,
  LOCK_STEPS_MIN: [1, 5, 15, 60] as readonly number[],
  IP_FAIL_LIMIT: 10,
  IP_FAIL_WINDOW_MS: 15 * 60_000,
  REGISTER_PER_IP_PER_DAY: 3,
  /** max queued password hashes before answering 503 (docs/25 §2.3) */
  MAX_PENDING_HASHES: 64,
} as const;

export const GATEWAY_CONFIG = {
  /** docs/24 §4: a connection that has not sent `hello` within 5 s is closed */
  HELLO_TIMEOUT_MS: 5000,
  /** inbound frame cap (binary input/cast/ping are < 32 B; hello JSON with a token is ~1.2 KB) */
  MAX_FRAME_BYTES: 2048,
  /** packets per rolling second above which the client is kicked */
  MAX_PACKETS_PER_S: 120,
  /** ws send buffer above which snapshots are skipped / the client is kicked */
  BACKPRESSURE_SKIP_BYTES: 256 * 1024,
  BACKPRESSURE_KICK_BYTES: 2 * 1024 * 1024,
  MAX_PLAYERS: 1000,
} as const;

export const WORLD_CONFIG = {
  /** entities one client may see (mobile budget, docs/08 §8) */
  MAX_VISIBLE: 120,
  PLAYER_MAX_HP: 1000,
  PLAYER_MAX_MP: 100,
  /** no ack for this long -> next snapshot is full (docs/08 §8) */
  ACK_TIMEOUT_MS: 1000,
  /** a released player entity id is not reused before this much sim time has passed (stale client indices, D74) */
  PLAYER_ID_QUARANTINE_MS: 30_000,
  /** a dropped player's entity is kept this long (sim time) so the client can resume the same session (docs/24 section 4) */
  RESUME_HOLD_MS: 10_000,
  /** the tick loop may run this far behind real time (scheduling jitter, a GC pause) without earning any anti-cheat lag credit: only real overload does */
  LAG_CREDIT_TOLERANCE_MS: 100,
  /** open test map side in tiles */
  DEFAULT_MAP_TILES: 256,
  /** tick duration samples kept for p50/p99 */
  TICK_SAMPLES: 20_000,
} as const;
