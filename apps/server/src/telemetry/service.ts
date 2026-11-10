/**
 * TelemetryService (D109, docs/17): the server-side event pipeline. Other modules call `emitAccount` / `sessionStart` / `ftue`; this
 * service wraps each event in the docs/17 §3.2 envelope (event id, schema version, source, server time, pseudonymous player id, session
 * id, sequence number), refuses anything the catalogue (`@vgtd/shared` `TELEMETRY_EVENTS`) does not allow, appends it to the raw log,
 * and folds it into the rollups the dashboard reads. Server is the only source of truth: nothing a client sends becomes an event here.
 *
 * Privacy (docs/17 §1.3, §7): events carry `player_pid` (HMAC of the account id) only; no account id, username, IP, email or chat text
 * is ever written, and the catalogue has no attribute that could hold one. Local only: nothing is sent to any third party.
 *
 * The wall clock is injected (`now`), the random part of event ids too, so tests are exact. The simulation never reads this module.
 */
import {
  SINK_SOURCE_RATIO_TARGET,
  TELEMETRY_EVENTS,
  TELEMETRY_SCHEMA_VERSION,
  TUTORIAL_STEPS,
  validateTelemetryAttrs,
  type TelemetryEventName,
  type TutorialStepId,
} from '@vgtd/shared';
import type { Ledger } from '../world/inventory/ledger.js';
import { MemoryEventLog, type EventLog } from './log.js';
import { dayOf, MIN_COHORT, Rollups } from './rollups.js';
import { pseudonymise, shortPid, systemRandom, uuid7, type RandomBytes } from './pseudonym.js';

export type TelemetryPlatform = 'web' | 'ios' | 'android' | 'pc';
export type TelemetryAttrs = Readonly<Record<string, string | number | boolean>>;

/** The envelope of one stored event (docs/17 §3.2; the event's own attributes are nested under `attrs`). */
export interface TelemetryEnvelope {
  event_id: string;
  event_name: string;
  schema_version: string;
  source: string;
  ts_server_ms: number;
  ts_client_ms: null;
  player_pid: string;
  session_id: string;
  seq: number;
  platform: TelemetryPlatform;
  attrs: TelemetryAttrs;
}

export interface TelemetryOptions {
  /** HMAC key for pseudonyms; random per process when absent (then pids do not survive a restart) */
  key?: string | Uint8Array;
  now?: () => number;
  random?: RandomBytes;
  log?: EventLog;
  rollups?: Rollups;
  platform?: TelemetryPlatform;
  /** concurrent-users sample period (default 60 s, docs/17 §4.2) */
  ccuEveryMs?: number;
}

interface Session {
  sid: string;
  seq: number;
  startMs: number;
}

const NO_PID = '0'.repeat(64);
const NO_SESSION = '00000000';
const CCU_RING = 1440; // 24 h at one sample a minute

export interface TelemetrySummary {
  generatedAtMs: number;
  schemaVersion: string;
  /** the data is local to this server: it is not sent anywhere */
  localOnly: true;
  ccu: { now: number; peak24h: number; series: Array<[number, number]> };
  days: Array<{
    day: string;
    dau: number;
    newPlayers: number;
    sessions: number;
    avgSessionS: number;
    ccuPeak: number;
    ccuAvg: number;
  }>;
  ftue: {
    started: number;
    completed: number;
    skipped: number;
    completionRate: number | null;
    steps: Array<{ step: TutorialStepId; players: number; rate: number | null }>;
  };
  retention: Record<
    'd1' | 'd7' | 'd30',
    { cohort: number; retained: number; rate: number | null; insufficient: boolean }
  >;
  economy: {
    windowDays: number;
    targetRatio: readonly [number, number];
    currencies: Array<{
      currency: string;
      faucet: number;
      sink: number;
      ratio: number | null;
      inTarget: boolean | null;
      faucetChannels: Record<string, number>;
      sinkChannels: Record<string, number>;
    }>;
  };
  health: { refusedEvents: number; logErrors: number; minCohort: number };
}

export class TelemetryService {
  readonly rollups: Rollups;
  readonly log: EventLog;
  private readonly key: string | Uint8Array;
  private readonly now: () => number;
  private readonly random: RandomBytes;
  private readonly platform: TelemetryPlatform;
  private readonly ccuEveryMs: number;
  private readonly sessions = new Map<string, Session>();
  private readonly ccuSeries: Array<[number, number]> = [];
  private lastCcuAt = -Infinity;
  private ledger: Ledger | null = null;
  private ledgerAt = 0;
  /** events accepted / refused since this process started (test hook, ops) */
  accepted = 0;
  refusedHere = 0;

  constructor(opts: TelemetryOptions = {}) {
    this.random = opts.random ?? systemRandom;
    this.key = opts.key ?? this.random(32);
    this.now = opts.now ?? Date.now;
    this.log = opts.log ?? new MemoryEventLog();
    this.rollups = opts.rollups ?? new Rollups();
    this.platform = opts.platform ?? 'web';
    this.ccuEveryMs = opts.ccuEveryMs ?? 60_000;
  }

  pidOf(accountId: string): string {
    return pseudonymise(this.key, accountId);
  }

  // ------------------------------------------------------------------ emitting
  /** Record one event for an account. Returns false (and counts the refusal) when the catalogue does not allow it. */
  emitAccount(accountId: string | null, name: TelemetryEventName, attrs: TelemetryAttrs = {}): boolean {
    const bad = validateTelemetryAttrs(name, attrs);
    if (bad !== null) {
      this.refusedHere++;
      this.rollups.refused();
      return false;
    }
    const ms = this.now();
    const sess = accountId === null ? undefined : this.sessions.get(accountId);
    const pid = accountId === null ? NO_PID : this.pidOf(accountId);
    const env: TelemetryEnvelope = {
      event_id: uuid7(ms, this.random),
      event_name: name,
      schema_version: TELEMETRY_SCHEMA_VERSION,
      source: TELEMETRY_EVENTS[name].source,
      ts_server_ms: ms,
      ts_client_ms: null,
      player_pid: pid,
      session_id: sess?.sid ?? NO_SESSION,
      seq: sess ? sess.seq++ : 0,
      platform: this.platform,
      attrs,
    };
    this.log.append(JSON.stringify(env), ms);
    this.rollups.count(ms, name);
    this.accepted++;
    return true;
  }

  /** A player entered the world: starts their session, counts them as active today, and records the first time a player is ever seen. */
  sessionStart(accountId: string, classId: number): void {
    if (this.sessions.has(accountId)) return;
    const ms = this.now();
    const hex = Array.from(this.random(8), (b) => b.toString(16).padStart(2, '0')).join('');
    this.sessions.set(accountId, { sid: hex, seq: 0, startMs: ms });
    this.emitAccount(accountId, 'session.start');
    const isNew = this.rollups.seen(shortPid(this.pidOf(accountId)), ms);
    if (isNew) this.emitAccount(accountId, 'character.create', { class_id: classId });
  }

  sessionEnd(accountId: string, reason: 'quit' | 'kick'): void {
    const s = this.sessions.get(accountId);
    if (!s) return;
    const ms = this.now();
    const duration = Math.max(0, Math.round((ms - s.startMs) / 1000));
    this.emitAccount(accountId, 'session.end', { duration_s: duration, reason });
    this.rollups.session(ms, duration);
    this.sessions.delete(accountId);
  }

  /** The tutorial moved (the FTUE funnel, docs/16 §7): `elapsed_s` is measured from the first time this player was ever seen. */
  ftue(
    accountId: string,
    ev: { kind: 'step'; step: TutorialStepId } | { kind: 'complete' } | { kind: 'skip'; stepsDone: number },
  ): void {
    const short = shortPid(this.pidOf(accountId));
    const ms = this.now();
    const first = this.rollups.player(short)?.firstMs ?? ms;
    const elapsed = Math.max(0, Math.round((ms - first) / 1000));
    if (ev.kind === 'step') {
      if (this.emitAccount(accountId, 'ftue.step', { step: ev.step, elapsed_s: elapsed }))
        this.rollups.ftueStep(ms, short, ev.step);
    } else if (ev.kind === 'complete') {
      if (this.emitAccount(accountId, 'ftue.complete', { elapsed_s: elapsed }))
        this.rollups.ftueDone(ms, short, 'complete');
    } else if (this.emitAccount(accountId, 'ftue.skip', { steps_done_count: ev.stepsDone }))
      this.rollups.ftueDone(ms, short, 'skip');
  }

  // ------------------------------------------------------------------ economy (read from the ledger)
  /** Watch a ledger: every committed entry on a `SYSTEM_FAUCET_*` / `SYSTEM_SINK_*` account becomes an economy event. */
  attachLedger(ledger: Ledger): void {
    this.ledger = ledger;
    this.ledgerAt = ledger.entries.length; // history before now is not recounted (a restart keeps its persisted rollups)
  }

  /** Fold the ledger entries committed since the last call into events + rollups. Cheap when nothing changed. */
  pollLedger(): void {
    const l = this.ledger;
    if (!l || l.entries.length <= this.ledgerAt) return;
    const batch = l.entries.slice(this.ledgerAt);
    this.ledgerAt = l.entries.length;
    // the recipient / payer wallet of a transaction is the player the system entry is attributed to
    const walletOf = new Map<number, string>();
    for (const e of batch) {
      const [kind, owner] = e.accountKey.split('|');
      if (kind === 'PLAYER_WALLET' && owner) walletOf.set(e.txId, owner);
    }
    for (const e of batch) {
      const [kind, , currency] = e.accountKey.split('|');
      if (!kind || !currency) continue;
      const faucet = kind.startsWith('SYSTEM_FAUCET_');
      const sink = kind.startsWith('SYSTEM_SINK_');
      if (!faucet && !sink) continue;
      const amount = faucet ? -e.delta : e.delta; // a faucet is debited when it creates value, a sink credited when it destroys it
      if (amount <= 0n) continue;
      const channel = kind.slice(faucet ? 'SYSTEM_FAUCET_'.length : 'SYSTEM_SINK_'.length).toLowerCase();
      const cur = currency.toLowerCase();
      const n = Number(amount);
      if (
        this.emitAccount(walletOf.get(e.txId) ?? null, faucet ? 'economy.faucet' : 'economy.sink', {
          currency: cur,
          amount: n,
          channel,
        })
      )
        this.rollups.economy(this.now(), faucet ? 'faucet' : 'sink', cur, channel, n);
    }
  }

  // ------------------------------------------------------------------ periodic
  /** Called every world tick with the number of connected players: samples CCU once a period and folds in new ledger entries. */
  tick(ccu: number): void {
    const ms = this.now();
    if (ms - this.lastCcuAt >= this.ccuEveryMs) {
      this.lastCcuAt = ms;
      this.ccuSeries.push([ms, ccu]);
      if (this.ccuSeries.length > CCU_RING) this.ccuSeries.splice(0, this.ccuSeries.length - CCU_RING);
      this.rollups.ccu(ms, ccu);
    }
    this.pollLedger();
  }

  flush(): void {
    this.pollLedger();
    this.log.flush();
  }

  // ------------------------------------------------------------------ read model for the dashboard
  summary(windowDays = 7): TelemetrySummary {
    const ms = this.now();
    const today = dayOf(ms);
    const keys = Object.keys(this.rollups.doc.days).sort();
    const days = keys.slice(-14).map((day) => {
      const d = this.rollups.doc.days[day]!;
      return {
        day,
        dau: d.dau.length,
        newPlayers: d.newPlayers.length,
        sessions: d.sessions,
        avgSessionS: d.sessions > 0 ? Math.round(d.sessionSeconds / d.sessions) : 0,
        ccuPeak: d.ccuPeak,
        ccuAvg: d.ccuSamples > 0 ? Math.round((d.ccuSum / d.ccuSamples) * 10) / 10 : 0,
      };
    });
    const f = this.rollups.ftueFunnel();
    const cutoff = dayOf(ms - (windowDays - 1) * 86_400_000);
    const econ = new Map<string, { faucet: Record<string, number>; sink: Record<string, number> }>();
    for (const [day, d] of Object.entries(this.rollups.doc.days)) {
      if (day < cutoff) continue;
      for (const kind of ['faucet', 'sink'] as const)
        for (const [cur, channels] of Object.entries(d.econ[kind])) {
          const e = econ.get(cur) ?? { faucet: {}, sink: {} };
          for (const [ch, v] of Object.entries(channels)) e[kind][ch] = (e[kind][ch] ?? 0) + v;
          econ.set(cur, e);
        }
    }
    const [lo, hi] = SINK_SOURCE_RATIO_TARGET;
    const sum = (o: Record<string, number>): number => Object.values(o).reduce((a, b) => a + b, 0);
    const lastCcu = this.ccuSeries[this.ccuSeries.length - 1]?.[1] ?? 0;
    return {
      generatedAtMs: ms,
      schemaVersion: TELEMETRY_SCHEMA_VERSION,
      localOnly: true,
      ccu: {
        now: this.sessions.size || lastCcu,
        peak24h: this.ccuSeries.reduce((m, [, n]) => Math.max(m, n), 0),
        series: this.ccuSeries.slice(-120),
      },
      days,
      ftue: {
        started: f.started,
        completed: f.completed,
        skipped: f.skipped,
        completionRate: f.completionRate,
        steps: TUTORIAL_STEPS.map((step) => ({
          step,
          players: f.byStep[step] ?? 0,
          rate: f.started > 0 ? (f.byStep[step] ?? 0) / f.started : null,
        })),
      },
      retention: {
        d1: this.rollups.retention(1, today),
        d7: this.rollups.retention(7, today),
        d30: this.rollups.retention(30, today),
      },
      economy: {
        windowDays,
        targetRatio: SINK_SOURCE_RATIO_TARGET,
        currencies: [...econ]
          .sort(([a], [b]) => (a < b ? -1 : 1))
          .map(([currency, e]) => {
            const faucet = sum(e.faucet);
            const sink = sum(e.sink);
            const ratio = faucet > 0 ? sink / faucet : null;
            return {
              currency,
              faucet,
              sink,
              ratio,
              inTarget: ratio === null ? null : ratio >= lo && ratio <= hi,
              faucetChannels: e.faucet,
              sinkChannels: e.sink,
            };
          }),
      },
      health: {
        refusedEvents: this.rollups.doc.refused,
        logErrors: (this.log as { errors?: number }).errors ?? 0,
        minCohort: MIN_COHORT,
      },
    };
  }
}
