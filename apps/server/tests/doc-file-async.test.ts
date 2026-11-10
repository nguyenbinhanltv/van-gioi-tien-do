/** DocFile writes in the background (D106): the loop is not blocked by the fsync, and the file protocol still never loses or reorders data. */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DocFile, fileWriteStats } from '../src/index.js';

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'vgtd-docfile-'));
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (f: string): unknown => JSON.parse(readFileSync(f, 'utf8'));

describe('DocFile background writes', () => {
  it('markDirty writes later without a synchronous disk write on the loop, and leaves no temp file', async () => {
    const path = join(dir, 'a.json');
    let state = 1;
    const doc = new DocFile(path, () => JSON.stringify({ state }), { flushMs: 5 });
    const syncBefore = fileWriteStats.count;
    doc.markDirty();
    expect(existsSync(path)).toBe(false); // nothing happens inside markDirty itself
    await doc.drain();
    expect(read(path)).toEqual({ state: 1 });
    expect(doc.writes).toBe(1);
    expect(fileWriteStats.asyncCount).toBeGreaterThan(0);
    expect(fileWriteStats.count - syncBefore).toBe(1); // only the commit renames ran on the loop
    state = 2;
    doc.markDirty();
    await doc.drain();
    expect(read(path)).toEqual({ state: 2 });
    expect(read(`${path}.bak`)).toEqual({ state: 1 }); // the previous good copy is kept
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('changes made while a write is in flight are written right after it, newest state last', async () => {
    const path = join(dir, 'b.json');
    let state = 1;
    const doc = new DocFile(path, () => JSON.stringify({ state }), { flushMs: 0 });
    doc.markDirty();
    const first = doc.flushAsync();
    state = 2; // after the first write took its copy
    doc.markDirty();
    await first;
    await doc.drain();
    expect(read(path)).toEqual({ state: 2 });
    expect(doc.writes).toBe(2);
  });

  it('a synchronous flush() supersedes a write in flight: the older one never overwrites the newer state', async () => {
    const path = join(dir, 'c.json');
    let state = 1;
    const doc = new DocFile(path, () => JSON.stringify({ state }), { flushMs: -1 });
    doc.markDirty();
    const inflight = doc.flushAsync(); // took its copy of state 1, now on the thread pool
    state = 2;
    doc.markDirty();
    doc.flush(); // shutdown path: state 2 is on disk when this returns
    expect(read(path)).toEqual({ state: 2 });
    await inflight;
    await doc.drain();
    expect(read(path)).toEqual({ state: 2 });
    expect(readdirSync(dir).filter((f) => f.endsWith('.tmp'))).toEqual([]);
  });

  it('flush() with a write in flight and nothing newer still puts the current state on disk', async () => {
    const path = join(dir, 'd.json');
    const doc = new DocFile(path, () => JSON.stringify({ state: 1 }), { flushMs: -1 });
    doc.markDirty();
    const inflight = doc.flushAsync();
    doc.flush();
    expect(read(path)).toEqual({ state: 1 });
    await inflight;
  });

  it('a failed background write is counted, reported, and retried by the next change', async () => {
    const path = join(dir, 'missing', 'x.json');
    const errors: unknown[] = [];
    let state = 1;
    const doc = new DocFile(path, () => JSON.stringify({ state }), { flushMs: -1, onError: (e) => errors.push(e) });
    // make the directory unusable: a FILE where the directory should be
    const { writeFileSync } = await import('node:fs');
    writeFileSync(join(dir, 'missing'), 'not a directory');
    doc.markDirty();
    await doc.flushAsync();
    expect(doc.errors).toBe(1);
    expect(errors).toHaveLength(1);
    rmSync(join(dir, 'missing'));
    state = 2;
    doc.markDirty();
    await doc.drain();
    expect(read(path)).toEqual({ state: 2 });
  });
});
