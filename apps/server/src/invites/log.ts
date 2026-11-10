/**
 * Invite event log (D111): append-only JSONL, one event per line. State is the fold of the events (see `InviteService`), so two
 * processes (the running server marks a code used, the operator CLI mints / revokes) never overwrite each other: each only appends.
 * `readNew` returns the events written since the last call (it tracks the byte offset and ignores a torn last line).
 * Codes are never stored: only the SHA-256 of the normalised code (`h`) and its short id.
 */
import { appendFileSync, closeSync, existsSync, mkdirSync, openSync, readSync, statSync } from 'node:fs';
import { dirname } from 'node:path';

export type InviteEvent =
  | { t: 'mint'; id: string; h: string; at: number; exp: number }
  | { t: 'use'; id: string; at: number; by: string }
  | { t: 'revoke'; id: string; at: number };

export interface InviteLog {
  append(e: InviteEvent): void;
  /** events appended (by anyone) since the previous call; the first call returns everything */
  readNew(): InviteEvent[];
}

export class MemoryInviteLog implements InviteLog {
  private readonly events: InviteEvent[] = [];
  private seen = 0;
  append(e: InviteEvent): void {
    this.events.push(e);
  }
  readNew(): InviteEvent[] {
    const out = this.events.slice(this.seen);
    this.seen = this.events.length;
    return out;
  }
}

function valid(e: unknown): e is InviteEvent {
  if (typeof e !== 'object' || e === null) return false;
  const o = e as Record<string, unknown>;
  const num = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x);
  if (typeof o.id !== 'string' || !num(o.at)) return false;
  if (o.t === 'mint') return typeof o.h === 'string' && /^[0-9a-f]{64}$/.test(o.h) && num(o.exp);
  if (o.t === 'use') return typeof o.by === 'string';
  return o.t === 'revoke';
}

export class FileInviteLog implements InviteLog {
  private offset = 0;
  constructor(readonly file: string) {
    mkdirSync(dirname(file), { recursive: true });
  }

  append(e: InviteEvent): void {
    appendFileSync(this.file, JSON.stringify(e) + '\n', { mode: 0o600 });
  }

  readNew(): InviteEvent[] {
    if (!existsSync(this.file)) return [];
    const size = statSync(this.file).size;
    if (size <= this.offset) return [];
    const fd = openSync(this.file, 'r');
    try {
      const buf = Buffer.alloc(size - this.offset);
      readSync(fd, buf, 0, buf.length, this.offset);
      const text = buf.toString('utf8');
      const end = text.lastIndexOf('\n');
      if (end < 0) return []; // a line is still being written
      this.offset += Buffer.byteLength(text.slice(0, end + 1));
      const out: InviteEvent[] = [];
      for (const line of text.slice(0, end).split('\n')) {
        if (!line) continue;
        try {
          const e: unknown = JSON.parse(line);
          if (valid(e)) out.push(e);
        } catch {
          /* corrupt line: skipped, never fatal */
        }
      }
      return out;
    } finally {
      closeSync(fd);
    }
  }
}
