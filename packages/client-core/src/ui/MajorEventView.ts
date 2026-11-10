/**
 * HUD model of a major breakthrough event (D97): what the Tâm Ma / Lôi Kiếp overlay draws. Engine-free; it only mirrors the server's
 * `major_event` and `tribulation_strike` messages (the server decides everything) and counts the phase timer down locally.
 */
import { ConsequenceTier, MajorPhase, MajorResult } from '@vgtd/shared';
import type { MajorEventMsg, TribulationStrikeMsg } from '@vgtd/protocol';
import { t, type StringKey } from '../i18n/strings.js';

/** One lightning bolt to draw: where (1/32 tile), how hard, and when it arrived (the view's clock). */
export interface StrikeView {
  readonly atMs: number;
  readonly qi: number;
  readonly qj: number;
  readonly damage: number;
  readonly wave: number;
  readonly waves: number;
}

export interface MajorSnapshot {
  readonly phase: MajorPhase;
  readonly wave: number;
  readonly waves: number;
  readonly strengthPct: number;
  readonly tamMaId: number;
  /** ms left in the phase window (counted down from the last message); 0 when it has none */
  readonly remainingMs: number;
}

const RESULT_SHOW_MS = 9000;

const TIER_KEY: Readonly<Record<number, StringKey>> = {
  [ConsequenceTier.Light]: 'major.tier.light',
  [ConsequenceTier.Medium]: 'major.tier.medium',
  [ConsequenceTier.Heavy]: 'major.tier.heavy',
};

export class MajorEventView {
  private ev: MajorEventMsg | null = null;
  private evAtMs = 0;
  private final: { msg: MajorEventMsg; untilMs: number } | null = null;
  private strike: StrikeView | null = null;

  constructor(private readonly now: () => number) {}

  /** Is a Tâm Ma / Lôi Kiếp running (the overlay is up)? */
  get active(): boolean {
    return this.ev !== null;
  }

  apply(m: MajorEventMsg): void {
    const t = this.now();
    if (m.phase === MajorPhase.Ended) {
      this.ev = null;
      this.final = { msg: m, untilMs: t + RESULT_SHOW_MS };
      return;
    }
    this.final = null;
    this.ev = m;
    this.evAtMs = t;
  }

  applyStrike(m: TribulationStrikeMsg): void {
    this.strike = { atMs: this.now(), qi: m.qi, qj: m.qj, damage: m.damage, wave: m.wave, waves: m.waves };
  }

  /** Forget everything (reconnect). */
  reset(): void {
    this.ev = null;
    this.final = null;
    this.strike = null;
  }

  /**
   * `NetClient` `events.onReconnect` handler that forgets the event (the final `major_event` may have been lost with the old
   * connection; a resumed server re-sends the live state on the next tick). Runs `prev` first so an existing handler still works.
   */
  chainReconnect(prev?: (info: { resumed: boolean }) => void): (info: { resumed: boolean }) => void {
    return (info) => {
      prev?.(info);
      this.reset();
    };
  }

  current(): MajorSnapshot | null {
    const m = this.ev;
    if (!m) return null;
    return {
      phase: m.phase,
      wave: m.wave,
      waves: m.waves,
      strengthPct: m.strengthPct,
      tamMaId: m.tamMaId,
      remainingMs: Math.max(0, m.remainingMs - (this.now() - this.evAtMs)),
    };
  }

  /** The newest bolt, for as long as it is worth drawing (`maxAgeMs`), else null. */
  recentStrike(maxAgeMs = 700): StrikeView | null {
    const s = this.strike;
    return s && this.now() - s.atMs <= maxAgeMs ? s : null;
  }

  /** The headline of the overlay (Vietnamese), '' when nothing runs. */
  title(): string {
    const c = this.current();
    if (!c) return '';
    if (c.phase === MajorPhase.TamMa)
      return t('major.title.tam_ma', { pct: c.strengthPct, secs: Math.ceil(c.remainingMs / 1000) });
    if (c.phase === MajorPhase.Destiny) return t('major.title.destiny');
    if (c.wave === 0) return t('major.title.gathering');
    return t('major.title.wave', { wave: c.wave, waves: c.waves });
  }

  /** The result card after the event ended (null once it expired): lines of text and a tone. */
  resultCard(): { lines: string[]; tone: 'good' | 'bad' } | null {
    const f = this.final;
    if (!f || this.now() >= f.untilMs) return null;
    const m = f.msg;
    const lines: string[] = [];
    if (m.result === MajorResult.Success) return { lines: [t('major.result.success')], tone: 'good' };
    if (m.result === MajorResult.TamMaLost) lines.push(t('major.result.tam_ma_lost'));
    else if (m.result === MajorResult.RollFailed) lines.push(t('major.result.roll_failed'));
    else lines.push(t('major.result.died', { tier: TIER_KEY[m.tier] ? t(TIER_KEY[m.tier]!) : '?' }));
    if (m.expLostPct > 0) lines.push(t('major.result.exp_lost', { pct: m.expLostPct }));
    if (m.lockMin > 0)
      lines.push(
        m.lockMin >= 120
          ? t('major.result.lock_hours', { n: Math.round(m.lockMin / 60) })
          : t('major.result.lock_minutes', { n: m.lockMin }),
      );
    return { lines, tone: 'bad' };
  }
}
export { dequantizePos } from '@vgtd/protocol';
