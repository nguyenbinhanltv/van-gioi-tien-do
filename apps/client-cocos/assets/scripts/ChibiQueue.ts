/**
 * Download queue for chibi bundles (D71), engine-free so it can be unit-tested (`apps/client-cocos/test`).
 *
 * - at most `maxActive` jobs in flight;
 * - priority 0 (the local player) starts immediately, priority >= 1 (NPCs, prefetch) waits for `openBackground()`;
 * - jobs are keyed: asking again for a key that is still queued at a LOWER priority number promotes the queued job
 *   (the local player turning to a direction that was only prefetched must not wait behind the NPC queue);
 * - lowest priority number first, then first come first served.
 */
interface Job {
  priority: number;
  readonly seq: number;
  started: boolean;
  readonly run: () => Promise<unknown>;
  readonly promise: Promise<unknown>;
  done: (v: unknown) => void;
  fail: (e: unknown) => void;
}

export class JobQueue {
  /** Number of jobs in flight at once. */
  maxActive = 2;
  private active = 0;
  private seq = 0;
  private background = false;
  private readonly queue: Job[] = [];
  private readonly keyed = new Map<string, Job>();
  readonly log: Array<{ at: number; what: string }> = [];

  /**
   * Queues `run` under `key`. A second call with the same key returns the same promise and, if the job has not started
   * yet, raises its priority to `priority` when that is a lower number.
   */
  enqueue<T>(key: string, priority: number, what: string, run: () => Promise<T>): Promise<T> {
    const existing = this.keyed.get(key);
    if (existing) {
      this.promote(key, priority);
      return existing.promise as Promise<T>;
    }
    let done!: (v: unknown) => void;
    let fail!: (e: unknown) => void;
    const promise = new Promise<unknown>((resolve, reject) => {
      done = resolve;
      fail = reject;
    });
    const job: Job = {
      priority,
      seq: this.seq++,
      started: false,
      run: async () => {
        const v = await run();
        this.log.push({ at: Math.round(performance.now()), what });
        return v;
      },
      promise,
      done,
      fail,
    };
    this.queue.push(job);
    this.keyed.set(key, job);
    // forget the key once settled so a failed load can be retried
    const forget = (): void => {
      if (this.keyed.get(key) === job) this.keyed.delete(key);
    };
    promise.then(forget, forget);
    this.pump();
    return promise as Promise<T>;
  }

  /** Raises the priority of a still-queued job (no-op when absent, already started, or not an upgrade). */
  promote(key: string, priority: number): boolean {
    const job = this.keyed.get(key);
    if (!job || job.started || priority >= job.priority) return false;
    job.priority = priority;
    this.pump();
    return true;
  }

  openBackground(): void {
    if (this.background) return;
    this.background = true;
    this.log.push({ at: Math.round(performance.now()), what: 'background-open' });
    this.pump();
  }
  get backgroundOpen(): boolean {
    return this.background;
  }
  /** Jobs waiting to start (for tests / HUD). */
  get queued(): number {
    return this.queue.length;
  }

  private pump(): void {
    while (this.active < this.maxActive) {
      const eligible = this.queue.filter((j) => j.priority === 0 || this.background);
      if (eligible.length === 0) return;
      eligible.sort((a, b) => a.priority - b.priority || a.seq - b.seq);
      const job = eligible[0]!;
      this.queue.splice(this.queue.indexOf(job), 1);
      job.started = true;
      this.active++;
      job
        .run()
        .then(job.done, job.fail)
        .finally(() => {
          this.active--;
          this.pump();
        });
    }
  }
}
