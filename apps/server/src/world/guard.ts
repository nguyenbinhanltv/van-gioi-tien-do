/**
 * Per-connection input hardening (D101, docs/25): a token bucket per message class on top of the global packets-per-second limit, strike
 * windows for malformed / over-budget frames, and a throttle for security log lines. Pure bookkeeping: the caller passes the clock
 * (the node's `packetClock`), so tests drive it without real time. It never inspects message content.
 */
import { SECURITY_CONFIG, type BudgetClass } from '../config.js';

/** Which budget a decoded client message is charged to; null = not a client message (the caller rejects it as unexpected). */
export function budgetClassOf(type: string): BudgetClass | null {
  switch (type) {
    case 'input':
      return 'move';
    case 'skill_cast':
      return 'cast';
    case 'ping':
      return 'ping';
    case 'chat_send':
      return 'chat';
    case 'party_cmd':
      return 'party';
    case 'inv_cmd':
      return 'inventory';
    case 'sect_cmd':
      return 'sect';
    case 'friend_cmd':
      return 'friend';
    case 'market_search':
    case 'market_list':
    case 'market_buy':
    case 'market_cancel':
      return 'market';
    case 'trade_cmd':
      return 'trade';
    case 'meditate_start':
    case 'meditate_stop':
    case 'breakthrough_start':
      return 'progression';
    default:
      return null;
  }
}

interface Bucket {
  tokens: number;
  atMs: number;
}
interface Window {
  startMs: number;
  count: number;
}

export class ConnectionGuard {
  private readonly buckets = new Map<BudgetClass, Bucket>();
  private malformed: Window = { startMs: -Infinity, count: 0 };
  private flood: Window = { startMs: -Infinity, count: 0 };
  private readonly notified = new Map<string, number>();
  /** frames dropped for exceeding a budget, per class (for the log line and tests) */
  readonly dropped: Partial<Record<BudgetClass, number>> = {};

  /** Spend one token of `cls`; false = over budget (drop the frame). */
  take(cls: BudgetClass, nowMs: number): boolean {
    const cfg = SECURITY_CONFIG.BUDGETS[cls];
    let b = this.buckets.get(cls);
    if (!b) {
      b = { tokens: cfg.burst, atMs: nowMs };
      this.buckets.set(cls, b);
    }
    const dt = nowMs - b.atMs;
    if (dt > 0) {
      b.tokens = Math.min(cfg.burst, b.tokens + (dt * cfg.perS) / 1000);
      b.atMs = nowMs;
    }
    if (b.tokens < 1) {
      this.dropped[cls] = (this.dropped[cls] ?? 0) + 1;
      return false;
    }
    b.tokens -= 1;
    return true;
  }

  /** A malformed / unexpected frame. True = the connection has used up its strikes (kick). Honest bugs age out of the window. */
  strikeMalformed(nowMs: number): boolean {
    return this.strike(this.malformed, nowMs, SECURITY_CONFIG.MALFORMED_WINDOW_MS, SECURITY_CONFIG.MALFORMED_MAX);
  }

  /** A frame dropped for exceeding a budget. True = sustained flooding (kick); a short burst over the limit only drops frames. */
  strikeFlood(nowMs: number): boolean {
    return this.strike(this.flood, nowMs, SECURITY_CONFIG.FLOOD_WINDOW_MS, SECURITY_CONFIG.FLOOD_MAX_DROPS);
  }

  private strike(w: Window, nowMs: number, windowMs: number, max: number): boolean {
    if (nowMs - w.startMs >= windowMs) {
      w.startMs = nowMs;
      w.count = 0;
    }
    return ++w.count >= max;
  }

  /** True at most once per `SECURITY_CONFIG.LOG_THROTTLE_MS` per key: bounds both the log volume and the error replies an attacker can trigger. */
  due(key: string, nowMs: number, everyMs: number = SECURITY_CONFIG.LOG_THROTTLE_MS): boolean {
    const last = this.notified.get(key);
    if (last !== undefined && nowMs - last < everyMs) return false;
    this.notified.set(key, nowMs);
    return true;
  }
}
