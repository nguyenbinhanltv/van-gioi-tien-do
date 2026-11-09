/**
 * Structured security events (D101, docs/25 §logging). One JSON object per event, no PII and no secrets: the entity is the numeric world id
 * (not the account id or the name), `reason` is a fixed string from the server code, `detail` holds counters only. Frame payloads, tokens,
 * password material, addresses and chat text never appear. The sink is injectable; `jsonLineSink` writes the production format.
 */
export interface SecurityEvent {
  ev: 'kick' | 'budget_drop' | 'bad_frame' | 'violation';
  /** world tick the event happened in */
  tick: number;
  /** numeric world entity id (recycled over time: pair it with the tick) */
  entity: number;
  reason: string;
  detail?: Record<string, number>;
}

/** `{"sec":1,"ev":"kick","tick":120,"entity":7,"reason":"message flood","detail":{"code":3}}` per line (the `sec` marker makes it greppable). */
export function jsonLineSink(write: (line: string) => void): (e: SecurityEvent) => void {
  return (e) => write(JSON.stringify({ sec: 1, ...e }));
}
