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

/**
 * Input hardening (D101, docs/25). One token bucket per message class per connection, on top of `GATEWAY_CONFIG.MAX_PACKETS_PER_S`. The
 * numbers leave honest clients plenty of room (the client sends ~20 input packets/s; a lag spike or a tab resume sends a short burst) and
 * only bite a client that floods: a frame over budget is dropped, a sustained flood (`FLOOD_MAX_DROPS` drops in `FLOOD_WINDOW_MS`) is kicked.
 * Cần game designer / vận hành duyệt khi có số liệu thật.
 */
export const SECURITY_CONFIG = {
  BUDGETS: {
    /** `input`: 20 Hz client, up to 3 inputs per packet; a burst allows ~1.5 s of catch-up after a stall */
    move: { burst: 40, perS: 30 },
    /** `skill_cast`: the GCD / cooldowns are the real limit (sim guard), this only caps spam */
    cast: { burst: 10, perS: 8 },
    ping: { burst: 5, perS: 2 },
    /** chat / party have their own per-account limiter that ANSWERS with a reason (chat/config.ts, party/config.ts): this outer cap is looser so that answer comes first and only a raw flood is dropped silently */
    chat: { burst: 30, perS: 10 },
    party: { burst: 30, perS: 10 },
    /** bag drag / drop / sort / use */
    inventory: { burst: 20, perS: 10 },
    progression: { burst: 6, perS: 2 },
  },
  /** malformed / unexpected frames tolerated in a rolling window before the kick (honest bugs age out) */
  MALFORMED_MAX: 5,
  MALFORMED_WINDOW_MS: 30_000,
  /** frames dropped over budget in a rolling window that count as a flood */
  FLOOD_MAX_DROPS: 40,
  FLOOD_WINDOW_MS: 10_000,
  /** same security log line / over-budget error reply at most this often per connection and key */
  LOG_THROTTLE_MS: 10_000,
} as const;

export type BudgetClass = keyof typeof SECURITY_CONFIG.BUDGETS;
