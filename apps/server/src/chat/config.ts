/**
 * Tunables of the chat module (docs/22 §7, docs/24 §7). Rates are the docs' proposals ("Đề xuất"): World 1 / 5 s, whisper 1 / 2 s; the Zone
 * channel is not in the table, so it gets the whisper rate. The limit is per ACCOUNT and per channel kind (a second connection of the same
 * account does not double it). `burst` is the bucket capacity: how many lines may go out back to back after a quiet spell.
 */
export const CHAT_CONFIG = {
  RATE: {
    world: { refillMs: 5000, burst: 2 },
    zone: { refillMs: 2000, burst: 3 },
    whisper: { refillMs: 2000, burst: 3 },
    /** party (D93): same placeholder rate as zone / whisper */
    party: { refillMs: 2000, burst: 3 },
  },
  /** lines kept for the World channel (docs/22 §7: ring of 200 per channel) */
  HISTORY_RING: 200,
  /** lines sent to a player who joins (wire cap: CHAT_LIMITS.MAX_HISTORY) */
  HISTORY_ON_JOIN: 30,
  /**
   * PLACEHOLDER banned words (matched without case or diacritics, as substrings). Deliberately fake: the real list is a content / moderation
   * decision (OPEN-ITEMS 20) and is injected through `ChatOptions.bannedWords`.
   */
  PLACEHOLDER_BANNED: ['placeholderbad', 'cursewordx'],
} as const;
