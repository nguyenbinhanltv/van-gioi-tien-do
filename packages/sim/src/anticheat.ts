/** Time budget, suspicion score and cast-rate limiter (docs/08 §6). All functions are pure. */
import { ANTICHEAT } from './constants.js';
import type { AntiCheatState, SimEvent } from './types.js';

export function newAntiCheat(nowMs: number): AntiCheatState {
  return {
    t0Ms: nowMs,
    claimedMs: 0,
    lastSlideMs: nowMs,
    windowStartMs: nowMs,
    windowClaimedMs: 0,
    hotWindows: 0,
    score: 0,
    warned: false,
    castTokens: ANTICHEAT.CAST_BUCKET,
    castRefillMs: nowMs,
  };
}

/** Budget(t) = 1.02 · (t − t_enter) + 250 ms. */
export function budgetMs(ac: AntiCheatState, nowMs: number): number {
  return ANTICHEAT.BUDGET_RATE * (nowMs - ac.t0Ms) + ANTICHEAT.BUDGET_SLACK_MS;
}

/** Would adding `dtMs` of declared time exceed the budget? (`nowMs` = server time at the end of the current tick.) */
export function overBudget(ac: AntiCheatState, dtMs: number, nowMs: number): boolean {
  return ac.claimedMs + dtMs > budgetMs(ac, nowMs);
}

/** +1 suspicion; emits `violation` and, on crossing thresholds, `warn` / `disconnect`. */
export function addViolation(
  ac: AntiCheatState,
  entityId: number,
  kind: Extract<SimEvent, { type: 'violation' }>['kind'],
  events: SimEvent[],
): { ac: AntiCheatState; disconnect: boolean } {
  const score = ac.score + 1;
  let warned = ac.warned;
  events.push({ type: 'violation', entityId, kind, score });
  if (score >= ANTICHEAT.SCORE_WARN && !warned) {
    warned = true;
    events.push({ type: 'warn', entityId, score });
  }
  const disconnect = score >= ANTICHEAT.SCORE_DISCONNECT;
  if (disconnect) events.push({ type: 'disconnect', entityId, reason: 'suspicion score' });
  return { ac: { ...ac, score, warned }, disconnect };
}

/**
 * End-of-tick housekeeping: score decay (−1/min), sliding budget (every 10 s), 60 s claimed/real ratio window.
 */
export function tickAntiCheat(
  ac: AntiCheatState,
  entityId: number,
  nowMs: number,
  dtMs: number,
  events: SimEvent[],
): { ac: AntiCheatState; disconnect: boolean } {
  let s = ac;
  const score = Math.max(0, s.score - dtMs * ANTICHEAT.SCORE_DECAY_PER_MS);
  s = { ...s, score, warned: score >= ANTICHEAT.SCORE_WARN ? s.warned : false };

  if (nowMs - s.lastSlideMs >= ANTICHEAT.SLIDE_PERIOD_MS) {
    let t0Ms = s.t0Ms;
    if (s.claimedMs < budgetMs(s, nowMs) - ANTICHEAT.SLIDE_LAG_MS) {
      // pull Budget down to Claimed + 1 s: 1.02·(now − t0) + 250 = claimed + 1000
      t0Ms = nowMs - (s.claimedMs + ANTICHEAT.SLIDE_LAG_MS - ANTICHEAT.BUDGET_SLACK_MS) / ANTICHEAT.BUDGET_RATE;
    }
    s = { ...s, t0Ms, lastSlideMs: nowMs };
  }

  let disconnect = false;
  const real = nowMs - s.windowStartMs;
  if (real >= ANTICHEAT.WINDOW_MS) {
    const ratio = s.windowClaimedMs / real;
    let hot = s.hotWindows;
    if (ratio > ANTICHEAT.RATIO_DISCONNECT) {
      disconnect = true;
      events.push({ type: 'disconnect', entityId, reason: `claimed/real ratio ${ratio.toFixed(3)}` });
    } else if (ratio > ANTICHEAT.RATIO_FLAG) {
      hot += 1;
      if (hot >= ANTICHEAT.RATIO_FLAG_WINDOWS) events.push({ type: 'flag', entityId, ratio });
    } else {
      hot = 0;
    }
    s = { ...s, windowStartMs: nowMs, windowClaimedMs: 0, hotWindows: hot };
  }
  return { ac: s, disconnect };
}

/** Token bucket for cast packets (10/s). Returns the updated state and whether the packet may pass. */
export function takeCastToken(ac: AntiCheatState, nowMs: number): { ac: AntiCheatState; ok: boolean } {
  // max(0, ...): with lag credit the clock handed in never goes backwards (the node keeps it monotonic), but never refill by a negative amount
  const refill = (Math.max(0, nowMs - ac.castRefillMs) / 1000) * ANTICHEAT.CAST_RATE_PER_S;
  const tokens = Math.min(ANTICHEAT.CAST_BUCKET, ac.castTokens + refill);
  if (tokens < 1) return { ac: { ...ac, castTokens: tokens, castRefillMs: nowMs }, ok: false };
  return { ac: { ...ac, castTokens: tokens - 1, castRefillMs: nowMs }, ok: true };
}
