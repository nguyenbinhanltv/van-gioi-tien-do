/**
 * Telemetry rollups (D109, docs/17 §4): the small aggregated tables the dashboard reads, built incrementally from events and persisted
 * as one document. Nothing in here identifies a person: players are the first 16 hex characters of their pseudonymous `player_pid`
 * (64 bits: collisions are negligible at beta scale and the value is still an HMAC output, not an account id). Days are UTC `YYYY-MM-DD`.
 *
 * Retention: for each player the rollup keeps the day they were first seen and a bitmask of which of the following 31 days they were
 * active, so D1 / D7 / D30 are exact without keeping per-player session lists. Rates only mean something with enough players: the
 * summary marks a figure `insufficient` below `MIN_COHORT` (docs/17 §4.1: targets are placeholders until closed beta data exists).
 */
export const ROLLUP_VERSION = 1;
export const MIN_COHORT = 20;
const MAX_DAYS = 400;

export interface DayRollup {
  dau: string[];
  newPlayers: string[];
  sessions: number;
  sessionSeconds: number;
  ccuPeak: number;
  ccuSum: number;
  ccuSamples: number;
  /** FTUE step id -> players who finished it that day */
  ftue: Record<string, string[]>;
  ftueComplete: string[];
  ftueSkip: string[];
  /** event name -> count */
  events: Record<string, number>;
  /** 'faucet' | 'sink' -> currency -> channel -> amount */
  econ: { faucet: Record<string, Record<string, number>>; sink: Record<string, Record<string, number>> };
}
export interface PlayerRollup {
  /** UTC day first seen */
  first: string;
  firstMs: number;
  /** bit k = active k days after `first` (k = 0..30) */
  active: number;
}
export interface RollupDoc {
  v: typeof ROLLUP_VERSION;
  days: Record<string, DayRollup>;
  players: Record<string, PlayerRollup>;
  /** events refused by the catalogue since the data started (a typo / forbidden field shows up here) */
  refused: number;
}

export const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10);
const dayNumber = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 86_400_000);

const emptyDay = (): DayRollup => ({
  dau: [],
  newPlayers: [],
  sessions: 0,
  sessionSeconds: 0,
  ccuPeak: 0,
  ccuSum: 0,
  ccuSamples: 0,
  ftue: {},
  ftueComplete: [],
  ftueSkip: [],
  events: {},
  econ: { faucet: {}, sink: {} },
});

export function emptyRollupDoc(): RollupDoc {
  return { v: ROLLUP_VERSION, days: {}, players: {}, refused: 0 };
}

/** Parse a stored document; throws on anything that is not a rollup document (the caller refuses to start rather than lose history). */
export function parseRollupDoc(raw: unknown): RollupDoc {
  const o = raw as Partial<RollupDoc> | null;
  if (typeof o !== 'object' || o === null || o.v !== ROLLUP_VERSION)
    throw new Error('telemetry rollups: unsupported version');
  if (typeof o.days !== 'object' || o.days === null || typeof o.players !== 'object' || o.players === null)
    throw new Error('telemetry rollups: malformed document');
  const doc = emptyRollupDoc();
  for (const [d, v] of Object.entries(o.days)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(d) || typeof v !== 'object' || v === null)
      throw new Error('telemetry rollups: malformed day');
    doc.days[d] = { ...emptyDay(), ...(v as DayRollup) };
  }
  for (const [p, v] of Object.entries(o.players)) {
    if (typeof v?.first !== 'string' || typeof v.firstMs !== 'number' || typeof v.active !== 'number')
      throw new Error('telemetry rollups: malformed player');
    doc.players[p] = v;
  }
  doc.refused = typeof o.refused === 'number' ? o.refused : 0;
  return doc;
}

const add = (list: string[], v: string): void => {
  if (!list.includes(v)) list.push(v);
};

export class Rollups {
  readonly doc: RollupDoc;
  /** set by the owner: called after any change (a file store marks its document dirty here) */
  onChange: (() => void) | null = null;

  constructor(doc: RollupDoc = emptyRollupDoc()) {
    this.doc = doc;
  }

  private day(ms: number): DayRollup {
    const k = dayOf(ms);
    let d = this.doc.days[k];
    if (!d) {
      d = emptyDay();
      this.doc.days[k] = d;
      const keys = Object.keys(this.doc.days).sort();
      for (const old of keys.slice(0, Math.max(0, keys.length - MAX_DAYS))) delete this.doc.days[old];
    }
    return d;
  }

  /** The player's rollup record, or undefined when they were never seen. */
  player(short: string): PlayerRollup | undefined {
    return this.doc.players[short];
  }

  /** A player was active at `ms` (a session started). Returns true when this is their first time ever. */
  seen(short: string, ms: number): boolean {
    const day = this.day(ms);
    add(day.dau, short);
    let p = this.doc.players[short];
    const isNew = !p;
    if (!p) {
      p = { first: dayOf(ms), firstMs: ms, active: 1 };
      this.doc.players[short] = p;
      add(day.newPlayers, short);
    } else {
      const k = dayNumber(dayOf(ms)) - dayNumber(p.first);
      if (k >= 0 && k <= 30) p.active |= 1 << k;
    }
    this.onChange?.();
    return isNew;
  }

  count(ms: number, name: string): void {
    const d = this.day(ms);
    d.events[name] = (d.events[name] ?? 0) + 1;
    this.onChange?.();
  }
  session(ms: number, durationS: number): void {
    const d = this.day(ms);
    d.sessions++;
    d.sessionSeconds += Math.max(0, durationS);
    this.onChange?.();
  }
  ccu(ms: number, n: number): void {
    const d = this.day(ms);
    d.ccuPeak = Math.max(d.ccuPeak, n);
    d.ccuSum += n;
    d.ccuSamples++;
    this.onChange?.();
  }
  ftueStep(ms: number, short: string, step: string): void {
    const d = this.day(ms);
    add((d.ftue[step] ??= []), short);
    this.onChange?.();
  }
  ftueDone(ms: number, short: string, kind: 'complete' | 'skip'): void {
    const d = this.day(ms);
    add(kind === 'complete' ? d.ftueComplete : d.ftueSkip, short);
    this.onChange?.();
  }
  economy(ms: number, kind: 'faucet' | 'sink', currency: string, channel: string, amount: number): void {
    const t = (this.day(ms).econ[kind][currency] ??= {}) as Record<string, number>;
    t[channel] = (t[channel] ?? 0) + amount;
    this.onChange?.();
  }
  refused(): void {
    this.doc.refused++;
    this.onChange?.();
  }

  // ------------------------------------------------------------------ reads
  /** Retention D`n`: of the players first seen on a day at least `n` days before `today`, the share active exactly `n` days later. */
  retention(
    n: 1 | 7 | 30,
    today: string,
  ): { cohort: number; retained: number; rate: number | null; insufficient: boolean } {
    const t = dayNumber(today);
    let cohort = 0;
    let retained = 0;
    for (const p of Object.values(this.doc.players)) {
      if (dayNumber(p.first) > t - n) continue;
      cohort++;
      if (p.active & (1 << n)) retained++;
    }
    return { cohort, retained, rate: cohort > 0 ? retained / cohort : null, insufficient: cohort < MIN_COHORT };
  }

  /** The FTUE funnel over every recorded day (distinct players per step). */
  ftueFunnel(): {
    started: number;
    completed: number;
    skipped: number;
    completionRate: number | null;
    byStep: Record<string, number>;
  } {
    const steps = new Map<string, Set<string>>();
    const complete = new Set<string>();
    const skip = new Set<string>();
    for (const d of Object.values(this.doc.days)) {
      for (const [s, list] of Object.entries(d.ftue)) {
        const set = steps.get(s) ?? new Set<string>();
        for (const p of list) set.add(p);
        steps.set(s, set);
      }
      for (const p of d.ftueComplete) complete.add(p);
      for (const p of d.ftueSkip) skip.add(p);
    }
    const started = Object.keys(this.doc.players).length;
    return {
      started,
      completed: complete.size,
      skipped: skip.size,
      completionRate: started > 0 ? complete.size / started : null,
      byStep: Object.fromEntries([...steps].map(([s, set]) => [s, set.size])),
    };
  }
}
