/**
 * Telemetry event schema (D109, docs/17 §3): the closed list of events the server may record, with their attributes. Names follow
 * `<domain>.<action>` (lowercase snake_case); attribute names are snake_case with the unit as a suffix; rates are 0..1. The server
 * REFUSES an event that is not in this catalogue, an attribute that is not declared for it, or a value of the wrong type, and counts
 * the refusal (a typo must show up in the dashboard's health line, not silently skew a KPI). Every event is PSEUDONYMOUS: the envelope
 * carries `player_pid` (HMAC of the account id, never the account id, username, IP, email or chat text) and the catalogue has no
 * attribute that could hold personal data; `TELEMETRY_FORBIDDEN_FIELDS` is checked on top of that.
 *
 * Adding an event: add it here (with the question it answers), then emit it; changing the meaning of an attribute needs a new
 * `TELEMETRY_SCHEMA_VERSION`. Events of docs/17 §3.3 that are NOT in this list are not recorded yet (OPEN-ITEMS "Telemetry (D109)").
 */
import { TUTORIAL_STEPS } from './tutorial.js';

export const TELEMETRY_SCHEMA_VERSION = '1.0.0';

export type TelemetrySource = 'client' | 'gateway' | 'world' | 'economy' | 'auth' | 'chat';

/** an attribute type: integer, finite number, boolean, short code string (a-z0-9_), or one of a fixed list */
export type TelemetryAttr = 'int' | 'num' | 'bool' | 'code' | { readonly enum: readonly string[] };

export interface TelemetryEventDef {
  source: TelemetrySource;
  /** who owns the event and what it answers (docs/17 §1.4: no event without a question) */
  question: string;
  attrs: Readonly<Record<string, TelemetryAttr>>;
}

const STEP_IDS = [...TUTORIAL_STEPS] as readonly string[];

export const TELEMETRY_EVENTS = {
  'session.start': {
    source: 'gateway',
    question: 'DAU, new players, retention cohorts (docs/17 §4.1 Thu hút, Giữ chân)',
    attrs: {},
  },
  'session.end': {
    source: 'gateway',
    question: 'session length (docs/17 §3.3 session)',
    attrs: { duration_s: 'int', reason: { enum: ['quit', 'kick'] } },
  },
  'account.register': {
    source: 'auth',
    question: 'sign-up funnel (docs/16 §7)',
    attrs: { method: { enum: ['password'] } },
  },
  'account.login': {
    source: 'auth',
    question: 'returning players (docs/17 §4.1)',
    attrs: { method: { enum: ['password'] } },
  },
  'character.create': {
    source: 'world',
    question: 'first time a pseudonymous player enters the world: the retention cohort day and the class mix',
    attrs: { class_id: 'int' },
  },
  'ftue.step': {
    source: 'world',
    question:
      'FTUE funnel per step (docs/16 §7); `step` is a TUTORIAL_STEPS id; elapsed_s since the first session start',
    attrs: { step: { enum: STEP_IDS }, elapsed_s: 'int' },
  },
  'ftue.complete': {
    source: 'world',
    question: 'FTUE completion rate and median time (docs/10 §7.1 gate)',
    attrs: { elapsed_s: 'int' },
  },
  'ftue.skip': {
    source: 'world',
    question: 'how many players dismiss the hints, and after how many steps',
    attrs: { steps_done_count: 'int' },
  },
  'cultivate.start': {
    source: 'world',
    question: 'meditation uptake (docs/17 §3.3 cultivate)',
    attrs: {},
  },
  'breakthrough.attempt': {
    source: 'world',
    question: 'compare the observed success rate with the rolled p_success (docs/17 §5.2 Tỷ lệ đột phá thực tế)',
    attrs: { to_stage: 'int', success: 'bool', p_success: 'num' },
  },
  'combat.kill': {
    source: 'world',
    question: 'kills per player (docs/17 §3.3 combat); one event per kill, skill_use is not recorded',
    attrs: { target_type: { enum: ['mob'] } },
  },
  'loot.drop': {
    source: 'economy',
    question: 'drop sanity (docs/17 §5.2 Tỷ lệ rơi thực tế); item_count = rolls of the kill',
    attrs: { source: { enum: ['field', 'elite', 'boss'] }, item_count: 'int' },
  },
  'economy.faucet': {
    source: 'economy',
    question: 'currency created, per currency and ledger channel (docs/17 §5.1 sink / source ratio)',
    attrs: { currency: 'code', amount: 'num', channel: 'code' },
  },
  'economy.sink': {
    source: 'economy',
    question: 'currency destroyed, per currency and ledger channel (docs/17 §5.1 sink / source ratio)',
    attrs: { currency: 'code', amount: 'num', channel: 'code' },
  },
} as const satisfies Record<string, TelemetryEventDef>;

export type TelemetryEventName = keyof typeof TELEMETRY_EVENTS;

/** Names that must never appear as an attribute (docs/17 §3.2 "trường cấm", §7). Checked in addition to the catalogue. */
export const TELEMETRY_FORBIDDEN_FIELDS: readonly string[] = [
  'email',
  'phone',
  'username',
  'user_name',
  'name',
  'ip',
  'password',
  'token',
  'text',
  'chat',
  'message',
  'account_id',
  'device_id',
];

const CODE_RE = /^[a-z0-9_]{1,48}$/;

/** `null` when `attrs` is a valid attribute set for `name`, otherwise why not. */
export function validateTelemetryAttrs(name: string, attrs: Readonly<Record<string, unknown>>): string | null {
  const def = (TELEMETRY_EVENTS as Record<string, TelemetryEventDef>)[name];
  if (!def) return `unknown event ${name}`;
  for (const [k, v] of Object.entries(attrs)) {
    if (TELEMETRY_FORBIDDEN_FIELDS.includes(k)) return `forbidden attribute ${k}`;
    const t = def.attrs[k];
    if (t === undefined) return `attribute ${k} is not declared for ${name}`;
    if (t === 'int') {
      if (typeof v !== 'number' || !Number.isInteger(v)) return `${k} must be an integer`;
    } else if (t === 'num') {
      if (typeof v !== 'number' || !Number.isFinite(v)) return `${k} must be a finite number`;
    } else if (t === 'bool') {
      if (typeof v !== 'boolean') return `${k} must be a boolean`;
    } else if (t === 'code') {
      if (typeof v !== 'string' || !CODE_RE.test(v)) return `${k} must be a short a-z0-9_ code`;
    } else if (typeof v !== 'string' || !t.enum.includes(v)) return `${k} must be one of ${t.enum.join('|')}`;
  }
  for (const k of Object.keys(def.attrs)) if (!(k in attrs)) return `attribute ${k} is missing for ${name}`;
  return null;
}
