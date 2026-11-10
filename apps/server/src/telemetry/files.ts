/**
 * File-backed telemetry (D109, `STORE=file`): the HMAC key, the rollups document and the raw event log live in `<DATA_DIR>/telemetry/`.
 *  - `pid.key`            random 32 bytes (hex), created once with mode 0600: pseudonyms stay stable across restarts (retention needs it);
 *                         whoever holds it can map accounts to pids, so it is an operator secret and never exposed by any endpoint;
 *  - `rollups.json`       the aggregated tables (atomic, lazy writes through `DocFile`, like the other documents);
 *  - `events-YYYY-MM-DD.jsonl`  the raw log, deleted after 90 days (docs/17 §7).
 * A rollups document that cannot be read is an error at startup (the caller refuses to start) rather than silently starting empty.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { readJsonFile, removeStray } from '../persistence/atomic.js';
import { DocFile, type DocFileOptions } from '../persistence/doc-file.js';
import { FileEventLog } from './log.js';
import { emptyRollupDoc, parseRollupDoc, Rollups } from './rollups.js';
import { systemRandom } from './pseudonym.js';

export interface TelemetryFiles {
  readonly dir: string;
  readonly key: string;
  readonly rollups: Rollups;
  readonly log: FileEventLog;
  readonly file: DocFile;
  flush(): void;
}

export function openTelemetryFiles(
  dataDir: string,
  opts: DocFileOptions & { retentionDays?: number; now?: () => number } = {},
): TelemetryFiles {
  const dir = join(dataDir, 'telemetry');
  mkdirSync(dir, { recursive: true });
  const keyPath = join(dir, 'pid.key');
  let key: string;
  if (existsSync(keyPath)) {
    key = readFileSync(keyPath, 'utf8').trim();
    if (!/^[0-9a-f]{64}$/.test(key))
      throw new Error('telemetry: pid.key is not a 64-hex-character key; refusing to start');
  } else {
    key = Buffer.from(systemRandom(32)).toString('hex');
    writeFileSync(keyPath, key + '\n', { mode: 0o600 });
    try {
      chmodSync(keyPath, 0o600);
    } catch {
      /* best effort (Windows ignores POSIX modes) */
    }
  }
  const docPath = join(dir, 'rollups.json');
  removeStray(docPath);
  const raw = readJsonFile(docPath);
  const rollups = new Rollups(raw === undefined ? emptyRollupDoc() : parseRollupDoc(raw));
  const file = new DocFile(docPath, () => JSON.stringify(rollups.doc), opts);
  rollups.onChange = () => file.markDirty();
  const log = new FileEventLog(dir, { retentionDays: opts.retentionDays, onError: opts.onError });
  log.prune((opts.now ?? Date.now)());
  return {
    dir,
    key,
    rollups,
    log,
    file,
    flush: () => {
      log.flush();
      file.flush();
    },
  };
}
